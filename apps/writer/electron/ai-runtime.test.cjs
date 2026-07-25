const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

async function sourceOf(fileName) {
  return fs.readFile(path.join(__dirname, fileName), "utf8");
}

function occurrences(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

test("one AI runtime owns config, HTTP, generation, and shutdown state while main only composes facades", async () => {
  const [
    main,
    aiRuntime,
    configRuntime,
    generationRuntime,
    httpRuntime,
    configIpc,
    generationIpc,
  ] = await Promise.all([
    sourceOf("main.cjs"),
    sourceOf("ai-runtime.cjs"),
    sourceOf("ai-config-runtime.cjs"),
    sourceOf("ai-generation-runtime.cjs"),
    sourceOf("ai-http-runtime.cjs"),
    sourceOf("ai-config-ipc.cjs"),
    sourceOf("ai-generation-ipc.cjs"),
  ]);

  assert.match(main, /require\("\.\/ai-runtime\.cjs"\)/);
  assert.equal(
    occurrences(main, /createAiRuntime\(\{/g),
    1,
  );
  assert.match(main, /configFacade:\s*aiRuntime\.configFacade/);
  assert.match(
    main,
    /generationFacade:\s*aiRuntime\.generationFacade/,
  );
  assert.match(main, /await aiRuntime\.initialize\(\)/);
  assert.match(main, /aiRuntime\.abortAll\(\)/);
  assert.doesNotMatch(
    main,
    /activeAiRequests|aiConfigMutationTail|codexRuntimeStatus/,
  );
  assert.doesNotMatch(
    main,
    /function (?:resolveAiProvider|readAiConfig|publicAiConfigWithRuntime|queueAiConfigMutation|persistAiConfig|migratePlaintextAiSecrets|refreshCodexCliConfig|validateAiRequestParamsPatch|mergeAndValidateAiTaskModels|saveAiConfig|createAiProvider|deleteAiProvider|storedAiTestConfigIdentity|updateAiProviderTestState|readAiErrorBody|assertAiResponseOk|aiFetch|readAiStreamChunk|testAiConfig|normalizeAiMessages|aiApplyResolverMessages|resolveAiApplyWithModel|streamAiCompletion|streamCodexForPayload)/,
  );

  assert.match(aiRuntime, /createAiHttpRuntime\(\{/);
  assert.match(aiRuntime, /createAiConfigRuntime\(\{/);
  assert.match(aiRuntime, /createAiGenerationRuntime\(\{/);
  assert.match(configRuntime, /let aiConfigMutationTail = Promise\.resolve\(\)/);
  assert.match(configRuntime, /let codexRuntimeStatus = \{/);
  assert.match(
    configRuntime,
    /const latest = await readAiConfig\(\)/,
  );
  assert.match(
    configRuntime,
    /expectedIdentity[\s\S]*commitAiTestResultIfCurrent/,
  );
  assert.match(
    generationRuntime,
    /const activeAiRequests = new Map\(\)/,
  );
  assert.match(
    generationRuntime,
    /activeAiRequests\.get\(requestId\) !== controller/,
  );
  assert.match(
    generationRuntime,
    /activeAiRequests\.get\(requestId\) === controller/,
  );
  assert.match(generationRuntime, /function abortAll\(\)/);
  assert.match(
    httpRuntime,
    /streamMaxMs:\s*10 \* 60 \* 1000/,
  );
  assert.match(
    httpRuntime,
    /streamInputMaxBytes:\s*64 \* 1024 \* 1024/,
  );

  for (const source of [
    aiRuntime,
    configRuntime,
    generationRuntime,
    httpRuntime,
  ]) {
    assert.doesNotMatch(
      source,
      /require\("\.\/(?:document|autosave|workspace)-runtime\.cjs"\)/,
    );
  }
  assert.match(configIpc, /configFacade\.(?:getConfig|testConfig)/);
  assert.match(
    generationIpc,
    /generationFacade\.(?:generate|cancel)/,
  );
});
