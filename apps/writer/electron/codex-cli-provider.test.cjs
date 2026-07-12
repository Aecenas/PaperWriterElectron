const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  codexExecArgs,
  codexExecutableCandidates,
  codexPrompt,
  codexUsage,
  reconcileCodexModels,
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

test("builds an isolated read-only Codex exec command", () => {
  const cwd = path.join("C:\\写作 项目", "资料");
  const imagePaths = [path.join("C:\\临时 图片", "图一.png"), path.join("C:\\临时 图片", "image-2.jpg")];
  const args = codexExecArgs({ model: "gpt-test", reasoningEffort: "xhigh" }, cwd, imagePaths);
  assert.deepEqual(args.slice(0, 4), ["exec", "-", "--json", "--ephemeral"]);
  assert.ok(args.includes("--ignore-user-config"));
  assert.ok(args.includes("--ignore-rules"));
  assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
  assert.equal(args[args.indexOf("-C") + 1], cwd);
  assert.ok(args.includes('approval_policy="never"'));
  assert.ok(args.includes('model_reasoning_effort="xhigh"'));
  assert.deepEqual(args.reduce((paths, value, index) => value === "--image" ? [...paths, args[index + 1]] : paths, []), imagePaths);
});

test("formats writing-only prompts and maps token usage", () => {
  const prompt = codexPrompt([{ role: "user", content: "润色这段文字" }]);
  assert.match(prompt, /不得修改、创建或删除任何文件/);
  assert.match(prompt, /当前工作目录及其子目录/);
  assert.match(prompt, /润色这段文字/);
  const documentOnlyPrompt = codexPrompt([{ role: "user", content: "只看信笺" }], { mode: "document-only", relativePath: "" });
  assert.match(documentOnlyPrompt, /不要读取任何本地文件或目录/);
  const imagePrompt = codexPrompt([{ role: "user", content: "分析图片" }], { mode: "workspace", relativePath: "" }, [
    { number: 2, caption: "结构示意", attachmentIndex: 1 },
  ]);
  assert.match(imagePrompt, /图片附件.*主要依据/);
  assert.match(imagePrompt, /附件1 = 图2\.结构示意/);
  assert.deepEqual(codexUsage({ usage: { input_tokens: 12, output_tokens: 8, reasoning_output_tokens: 3 } }), {
    prompt_tokens: 12,
    completion_tokens: 8,
    total_tokens: 20,
  });
});
