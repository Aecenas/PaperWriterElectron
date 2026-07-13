const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  codexExecArgs,
  codexExecutableCandidates,
  codexPrompt,
  codexUsage,
  findCodexExecutable,
  isolatedCodexEnvironment,
  mergeCodexRefreshedModels,
  parseCodexVersion,
  reconcileCodexModels,
  runCodex,
  streamCodexCompletion,
  supportsSecureCodexVersion,
} = require("./codex-cli-provider.cjs");

test("prioritizes executable Codex installations and ignores PowerShell shims", () => {
  const candidates = codexExecutableCandidates({ PATH: "C:\\Tools", APPDATA: "C:\\Users\\Test\\AppData\\Roaming" }, "win32");
  assert.equal(candidates.some((candidate) => candidate.endsWith("codex.ps1")), false);
  assert.ok(candidates.some((candidate) => candidate.endsWith("codex.exe")));
  assert.ok(candidates.some((candidate) => candidate.endsWith("codex.cmd")));
  assert.ok(candidates.findIndex((candidate) => candidate.includes("codex-win32-x64")) < candidates.findIndex((candidate) => candidate.endsWith("codex.cmd")));
});

test("reconciles catalog models and preserves supported reasoning effort", () => {
  const models = reconcileCodexModels([{ model: "gpt-test", reasoningEffort: "high" }], [{
    id: "gpt-test",
    model: "gpt-test",
    displayName: "GPT Test",
    description: "测试模型",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "快" },
      { reasoningEffort: "high", description: "深" },
    ],
    isDefault: true,
    hidden: false,
  }]);
  assert.equal(models[0].reasoningEffort, "high");
  assert.equal(models[0].catalogDefault, true);
  assert.equal(models[0].catalogManaged, true);
});

test("falls back to catalog default effort when a saved effort disappears", () => {
  const models = reconcileCodexModels([{ model: "gpt-test", reasoningEffort: "ultra" }], [{
    id: "gpt-test",
    model: "gpt-test",
    displayName: "GPT Test",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "默认" }],
  }]);
  assert.equal(models[0].reasoningEffort, "medium");
});

test("bounds untrusted Codex catalog size and metadata", () => {
  const catalog = Array.from({ length: 1100 }, (_value, index) => ({
    id: `model-${index}-${"x".repeat(400)}`,
    model: `gpt-${index}`,
    displayName: "N".repeat(400),
    description: "D".repeat(3000),
    supportedReasoningEfforts: Array.from({ length: 40 }, () => ({ reasoningEffort: "high", description: "deep" })),
  }));
  const models = reconcileCodexModels([], catalog);
  assert.equal(models.length, 1000);
  assert.equal(models[0].id.length, 256);
  assert.equal(models[0].name.length, 256);
  assert.equal(models[0].description.length, 2000);
  assert.equal(models[0].supportedReasoningEfforts.length, 32);
});

test("merges a refreshed catalog with the latest saved reasoning effort", () => {
  const models = mergeCodexRefreshedModels([
    { id: "latest-id", model: "gpt-test", reasoningEffort: "high" },
  ], [{
    id: "catalog-id",
    name: "GPT Test",
    model: "gpt-test",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: [
      { reasoningEffort: "medium", description: "默认" },
      { reasoningEffort: "high", description: "深入" },
    ],
    catalogDefault: true,
  }]);
  assert.equal(models[0].id, "catalog-id");
  assert.equal(models[0].reasoningEffort, "high");
  assert.equal(models[0].catalogDefault, true);
});

test("builds a fail-closed text-only Codex exec command", () => {
  const cwd = path.join("C:\\写作 项目", "资料");
  const imagePaths = [path.join("C:\\临时 图片", "图一.png"), path.join("C:\\临时 图片", "image-2.jpg")];
  const args = codexExecArgs({ model: "gpt-test", reasoningEffort: "xhigh" }, cwd, imagePaths);
  assert.deepEqual(args.slice(0, 4), ["exec", "-", "--json", "--ephemeral"]);
  assert.ok(args.includes("--ignore-user-config"));
  assert.ok(args.includes("--ignore-rules"));
  assert.ok(args.includes("--strict-config"));
  assert.equal(args.includes("--sandbox"), false);
  assert.equal(args[args.indexOf("-C") + 1], cwd);
  assert.ok(args.includes('approval_policy="never"'));
  assert.ok(args.includes('web_search="disabled"'));
  assert.ok(args.includes('default_permissions="paperwriter_text_only"'));
  assert.ok(args.includes('permissions.paperwriter_text_only.filesystem={ ":root" = "deny" }'));
  assert.ok(args.includes('permissions.paperwriter_text_only.network={ enabled = false }'));
  assert.ok(args.includes('shell_environment_policy.inherit="none"'));
  ["apps", "browser_use", "code_mode_host", "computer_use", "multi_agent", "shell_tool", "unified_exec"].forEach((feature) => {
    const index = args.findIndex((value, valueIndex) => value === "--disable" && args[valueIndex + 1] === feature);
    assert.notEqual(index, -1, `missing disabled feature: ${feature}`);
  });
  assert.ok(args.includes('model_reasoning_effort="xhigh"'));
  assert.deepEqual(args.reduce((paths, value, index) => value === "--image" ? [...paths, args[index + 1]] : paths, []), imagePaths);
});

test("formats writing-only prompts and maps token usage", () => {
  const prompt = codexPrompt([{ role: "user", content: "润色这段文字" }], { mode: "workspace", relativePath: "" });
  assert.match(prompt, /不得修改、创建或删除任何文件/);
  assert.match(prompt, /没有本地文件或目录访问能力/);
  assert.doesNotMatch(prompt, /当前工作目录|工作区资料/);
  assert.match(prompt, /润色这段文字/);
  const documentOnlyPrompt = codexPrompt([{ role: "user", content: "只看信笺" }], { mode: "document-only", relativePath: "" });
  assert.match(documentOnlyPrompt, /全部依据/);
  const imagePrompt = codexPrompt([{ role: "user", content: "分析图片" }], { mode: "workspace", relativePath: "" }, [
    { number: 2, caption: "结构示意", attachmentIndex: 1 },
  ]);
  assert.match(imagePrompt, /显式附加的当前信笺图片/);
  assert.match(imagePrompt, /附件1 = 图2\.结构示意/);
  assert.deepEqual(codexUsage({ usage: { input_tokens: 12, output_tokens: 8, reasoning_output_tokens: 3 } }), {
    prompt_tokens: 12,
    completion_tokens: 8,
    total_tokens: 20,
  });
});

test("requires a Codex version with permission-profile support", () => {
  assert.deepEqual(parseCodexVersion("codex-cli 0.144.3"), [0, 144, 3]);
  assert.equal(supportsSecureCodexVersion("codex-cli 0.138.0"), true);
  assert.equal(supportsSecureCodexVersion("codex-cli 0.137.9"), false);
  assert.equal(supportsSecureCodexVersion("unknown"), false);
});

test("uses a private temp environment without leaking the host temp roots", () => {
  const environment = isolatedCodexEnvironment("C:\\isolated", {
    PATH: "C:\\bin",
    TEMP: "C:\\host-temp",
    Tmp: "C:\\host-tmp",
    TMPDIR: "C:\\host-tmpdir",
    OPENAI_API_KEY: "kept-for-the-cli-process",
    AWS_SECRET_ACCESS_KEY: "must-not-reach-codex",
  });
  assert.equal(environment.PATH, "C:\\bin");
  assert.equal(environment.OPENAI_API_KEY, "kept-for-the-cli-process");
  assert.equal(environment.TEMP, "C:\\isolated");
  assert.equal(environment.TMP, "C:\\isolated");
  assert.equal(environment.TMPDIR, "C:\\isolated");
  assert.equal(Object.hasOwn(environment, "Tmp"), false);
  assert.equal(Object.hasOwn(environment, "AWS_SECRET_ACCESS_KEY"), false);
});

test("terminates Codex status probes whose output exceeds the safety limit", async () => {
  await assert.rejects(
    () => runCodex(process.execPath, ["-e", "process.stdout.write('x'.repeat(3 * 1024 * 1024))"], { timeoutMs: 10000 }),
    /输出超过安全上限/,
  );
});

test("handles stdin pipe errors when a status process exits before a large input is written", async () => {
  await assert.rejects(
    () => runCodex(process.execPath, ["-e", "process.exit(0)"], {
      timeoutMs: 10000,
      input: "x".repeat(8 * 1024 * 1024),
    }),
    /Codex CLI 输入失败/,
  );
});

test("handles stdin pipe errors when a streaming process exits before a large prompt is written", async () => {
  await assert.rejects(
    () => streamCodexCompletion({
      executable: process.execPath,
      config: { model: "gpt-test", reasoningEffort: "medium" },
      messages: [{ role: "user", content: "x".repeat(8 * 1024 * 1024) }],
      scope: { mode: "document-only", relativePath: "" },
      onDelta: () => {},
    }),
    /Codex CLI 输入失败/,
  );
});

test("launches the standard npm .cmd fallback without losing quoted arguments", { skip: process.platform !== "win32" }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-codex-cmd-test-"));
  const shimPath = path.join(root, "codex.cmd");
  const scriptPath = path.join(root, "node_modules", "@openai", "codex", "bin", "codex.js");
  try {
    await fs.mkdir(path.dirname(scriptPath), { recursive: true });
    await fs.writeFile(shimPath, "@echo off\r\nexit /b 99\r\n", "utf8");
    await fs.writeFile(scriptPath, [
      "if (process.argv.includes('--version')) { process.stdout.write('codex-cli 0.144.3\\n'); process.exit(0); }",
      "let input = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', (chunk) => { input += chunk; });",
      "process.stdin.on('end', () => process.stdout.write(JSON.stringify({ args: process.argv.slice(2), input })));",
    ].join("\n"), "utf8");

    assert.equal(await findCodexExecutable({ candidates: [shimPath] }), path.resolve(shimPath));
    const sensitiveArg = 'permissions.paperwriter_text_only.filesystem={ ":root" = "deny" }';
    const result = await runCodex(shimPath, ["exec", "-c", sensitiveArg], { input: "正文" });
    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse(result.stdout), { args: ["exec", "-c", sensitiveArg], input: "正文" });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
