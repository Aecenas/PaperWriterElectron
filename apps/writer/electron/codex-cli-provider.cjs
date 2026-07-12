const childProcess = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const CODEX_STATUS_TIMEOUT_MS = 20000;
const CODEX_PROVIDER_ID = "codex-cli";

function unique(values) {
  return [...new Set(values.filter(Boolean).map((value) => path.resolve(value)))];
}

function codexExecutableCandidates(env = process.env, platform = process.platform) {
  const pathEntries = String(env.PATH || "").split(path.delimiter).filter(Boolean);
  const candidates = [];
  if (platform === "win32") {
    pathEntries.forEach((entry) => candidates.push(path.join(entry, "codex.exe")));
    const npmRoot = env.APPDATA ? path.join(env.APPDATA, "npm") : "";
    if (npmRoot) {
      candidates.push(
        path.join(npmRoot, "node_modules", "@openai", "codex", "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe"),
        path.join(npmRoot, "node_modules", "@openai", "codex", "node_modules", "@openai", "codex-win32-arm64", "vendor", "aarch64-pc-windows-msvc", "bin", "codex.exe"),
        path.join(npmRoot, "codex.cmd"),
      );
    }
    pathEntries.forEach((entry) => candidates.push(path.join(entry, "codex.cmd")));
  } else {
    pathEntries.forEach((entry) => candidates.push(path.join(entry, "codex")));
    if (env.HOME) candidates.push(path.join(env.HOME, ".local", "bin", "codex"));
  }
  return unique(candidates);
}

async function findCodexExecutable(options = {}) {
  const candidates = options.candidates || codexExecutableCandidates(options.env, options.platform);
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      const probe = await runCodex(candidate, ["--version"], { timeoutMs: 4000 });
      if (probe.code === 0) return candidate;
    } catch {
      // Continue scanning standard locations.
    }
  }
  return "";
}

function quoteCmdArg(value) {
  return `"${String(value).replace(/%/g, "%%").replace(/"/g, '""')}"`;
}

function spawnCodex(executable, args, options = {}) {
  if (process.platform === "win32" && path.extname(executable).toLowerCase() === ".cmd") {
    const commandLine = [quoteCmdArg(executable), ...args.map(quoteCmdArg)].join(" ");
    return childProcess.spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", commandLine], options);
  }
  return childProcess.spawn(executable, args, options);
}

function terminateProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    childProcess.spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

function runCodex(executable, args, { timeoutMs = CODEX_STATUS_TIMEOUT_MS, input = "", cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnCodex(executable, args, { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("Codex CLI 响应超时"));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => finish(null, { code, stdout, stderr }));
    child.stdin.end(input);
  });
}

function createJsonRpcClient(child, timeoutMs = CODEX_STATUS_TIMEOUT_MS) {
  let nextId = 1;
  let buffer = "";
  const pending = new Map();
  const rejectAll = (error) => {
    pending.forEach(({ reject, timer }) => {
      clearTimeout(timer);
      reject(error);
    });
    pending.clear();
  };
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    lines.forEach((line) => {
      let payload;
      try { payload = JSON.parse(line); } catch { return; }
      if (payload.id == null || !pending.has(payload.id)) return;
      const request = pending.get(payload.id);
      pending.delete(payload.id);
      clearTimeout(request.timer);
      if (payload.error) request.reject(new Error(payload.error.message || "Codex App Server 请求失败"));
      else request.resolve(payload.result);
    });
  });
  child.on("error", rejectAll);
  child.on("close", (code) => rejectAll(new Error(`Codex App Server 已退出 (${code ?? "unknown"})`)));
  return {
    request(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Codex App Server 请求超时：${method}`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
      });
    },
    notify(method, params = {}) {
      child.stdin.write(`${JSON.stringify({ method, params })}\n`);
    },
    close() {
      rejectAll(new Error("Codex App Server 已关闭"));
    },
  };
}

async function inspectCodexAppServer(executable, options = {}) {
  const child = spawnCodex(executable, ["app-server"], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();
  const client = createJsonRpcClient(child, options.timeoutMs);
  try {
    await client.request("initialize", {
      clientInfo: { name: "paperwriter", title: "笺间", version: options.appVersion || "0.0.0" },
      capabilities: { experimentalApi: false },
    });
    client.notify("initialized");
    const account = await client.request("account/read", { refreshToken: false });
    const models = [];
    let cursor = null;
    do {
      const response = await client.request("model/list", { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) });
      models.push(...(Array.isArray(response?.data) ? response.data : []));
      cursor = response?.nextCursor || null;
    } while (cursor);
    return { account, models };
  } finally {
    client.close();
    child.kill();
  }
}

function reconcileCodexModels(previousModels = [], catalog = []) {
  const previousByModel = new Map(previousModels.map((model) => [model.model, model]));
  return catalog.filter((model) => !model.hidden && model.model).map((model, index) => {
    const previous = previousByModel.get(model.model) || {};
    const efforts = (model.supportedReasoningEfforts || []).map((option) => ({
      reasoningEffort: String(option.reasoningEffort || ""),
      description: String(option.description || ""),
    })).filter((option) => option.reasoningEffort);
    const supported = new Set(efforts.map((option) => option.reasoningEffort));
    const defaultEffort = String(model.defaultReasoningEffort || efforts[0]?.reasoningEffort || "");
    const reasoningEffort = supported.has(previous.reasoningEffort) ? previous.reasoningEffort : defaultEffort;
    return {
      id: String(model.id || `${CODEX_PROVIDER_ID}-${index + 1}`),
      name: String(model.displayName || model.model),
      model: String(model.model),
      description: String(model.description || ""),
      reasoningEffort,
      defaultReasoningEffort: defaultEffort,
      supportedReasoningEfforts: efforts,
      catalogManaged: true,
      catalogDefault: Boolean(model.isDefault),
      testedOk: true,
      testedAt: new Date().toISOString(),
      testMessage: "Codex CLI 可用",
    };
  });
}

async function refreshCodexStatus({ previousModels = [], appVersion = "0.0.0", executable = "" } = {}) {
  const checkedAt = new Date().toISOString();
  const resolvedExecutable = executable || await findCodexExecutable();
  if (!resolvedExecutable) {
    return { installed: false, authenticated: false, ready: false, catalogFresh: false, checkedAt, message: "未检测到 Codex CLI" };
  }
  let version = "";
  try {
    const versionResult = await runCodex(resolvedExecutable, ["--version"]);
    version = (versionResult.stdout || versionResult.stderr).trim();
  } catch {
    // App-server inspection below provides the actionable error.
  }
  try {
    const inspected = await inspectCodexAppServer(resolvedExecutable, { appVersion });
    const account = inspected.account?.account || null;
    const authenticated = Boolean(account);
    const models = reconcileCodexModels(previousModels, inspected.models);
    return {
      installed: true,
      authenticated,
      ready: authenticated && models.length > 0,
      catalogFresh: true,
      executablePath: resolvedExecutable,
      version,
      accountType: account?.type || "",
      planType: account?.planType || "",
      email: account?.email || "",
      models,
      checkedAt,
      message: authenticated ? (models.length ? "Codex CLI 可用" : "未发现可用模型") : "Codex CLI 尚未登录",
    };
  } catch (error) {
    let authenticated = false;
    try {
      const loginStatus = await runCodex(resolvedExecutable, ["login", "status"]);
      authenticated = loginStatus.code === 0 && /logged in|已登录/i.test(`${loginStatus.stdout}\n${loginStatus.stderr}`);
    } catch {
      // Preserve the App Server error as the primary diagnostic.
    }
    return {
      installed: true,
      authenticated,
      ready: authenticated && previousModels.length > 0,
      catalogFresh: false,
      executablePath: resolvedExecutable,
      version,
      models: previousModels,
      checkedAt,
      message: previousModels.length ? `模型目录刷新失败，继续使用上次结果：${error.message}` : `Codex CLI 检查失败：${error.message}`,
      error: error.message,
    };
  }
}

function codexPrompt(messages, scope = { mode: "workspace", relativePath: "" }, attachments = []) {
  const transcript = messages.map((message) => `[${message.role}]\n${message.content}`).join("\n\n");
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
  const scopeInstruction = scope.mode === "document-only"
    ? (hasAttachments
      ? "本次只允许使用下方对话中提供的当前信笺内容与显式附加的当前信笺图片。不要读取任何其他本地文件或目录。"
      : "本次只允许使用下方对话中提供的当前信笺内容。不要读取任何本地文件或目录。")
    : "你可以按需读取当前工作目录及其子目录中的资料，但不得读取父目录、工作目录外的绝对路径或其他项目。";
  const attachmentInstruction = hasAttachments
    ? [
        "当前信笺正文、用户标记文字和图片附件是本次问答的主要依据；工作区资料仅作补充。",
        "图片附件与信笺图号的对应关系如下：",
        ...attachments.map((image) => `附件${image.attachmentIndex || image.number} = 图${image.number}.${image.caption || "图片"}`),
      ].join("\n")
    : "当前信笺正文和用户标记文字是本次问答的主要依据；工作区资料仅作补充。";
  return [
    "你正在作为笺间的写作模型运行。只完成用户要求的写作、优化或问答任务。",
    scopeInstruction,
    attachmentInstruction,
    "不得修改、创建或删除任何文件，不得请求执行授权。",
    "不要描述工具调用或工作过程，只输出最终给用户看的内容。",
    "以下是完整对话：",
    transcript,
  ].join("\n\n");
}

function codexExecArgs(config, cwd, imagePaths = []) {
  const effort = String(config.reasoningEffort || "").replace(/[^a-zA-Z0-9_-]/g, "");
  const imageArgs = Array.isArray(imagePaths)
    ? imagePaths.filter((imagePath) => typeof imagePath === "string" && imagePath).flatMap((imagePath) => ["--image", imagePath])
    : [];
  return [
    "exec", "-", "--json", "--ephemeral", "--ignore-user-config", "--ignore-rules",
    "--sandbox", "read-only", "--skip-git-repo-check", "-C", cwd, "-m", config.model,
    ...imageArgs,
    "-c", 'approval_policy="never"',
    ...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : []),
  ];
}

function codexUsage(payload) {
  const usage = payload?.usage;
  if (!usage) return null;
  const promptTokens = Number(usage.input_tokens || 0);
  const completionTokens = Number(usage.output_tokens || 0);
  return { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens };
}

async function streamCodexCompletion({ executable, config, messages, cwd, scope, attachments = [], imagePaths = [], signal, onDelta }) {
  if (!executable) throw new Error("未检测到 Codex CLI");
  if (!config.model) throw new Error("请选择 Codex 模型");
  const workingDirectory = cwd || os.tmpdir();
  const args = codexExecArgs(config, workingDirectory, imagePaths);
  return new Promise((resolve, reject) => {
    const child = spawnCodex(executable, args, { cwd: workingDirectory, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "";
    let stderr = "";
    let usage = null;
    let emittedText = "";
    let completed = false;
    const abort = () => terminateProcessTree(child);
    signal?.addEventListener("abort", abort, { once: true });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      lines.forEach((line) => {
        let event;
        try { event = JSON.parse(line); } catch { return; }
        if (event.type === "item.completed" && event.item?.type === "agent_message") {
          const text = String(event.item.text || "");
          const delta = text.startsWith(emittedText) ? text.slice(emittedText.length) : text;
          if (delta) onDelta(delta);
          emittedText = text;
        } else if (event.type === "item.updated" && event.item?.type === "agent_message") {
          const text = String(event.item.text || event.delta || "");
          const delta = text.startsWith(emittedText) ? text.slice(emittedText.length) : String(event.delta || "");
          if (delta) onDelta(delta);
          if (text) emittedText = text;
        } else if (event.type === "turn.completed") {
          usage = codexUsage(event) || usage;
          completed = true;
        } else if (event.type === "turn.failed" || event.type === "error") {
          stderr = event.error?.message || event.message || stderr;
        }
      });
    });
    child.on("error", reject);
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) return reject(new Error("已停止生成"));
      if (code !== 0 || !completed) return reject(new Error(stderr.trim() || `Codex CLI 生成失败 (${code ?? "unknown"})`));
      resolve(usage);
    });
    child.stdin.end(codexPrompt(messages, scope, attachments));
  });
}

function startCodexLogin(executable, onExit) {
  if (!executable) throw new Error("未检测到 Codex CLI");
  const child = spawnCodex(executable, ["login"], { windowsHide: false, detached: process.platform === "win32", stdio: "ignore" });
  child.once("close", () => onExit?.());
  return { started: true };
}

module.exports = {
  CODEX_PROVIDER_ID,
  codexExecArgs,
  codexExecutableCandidates,
  codexPrompt,
  codexUsage,
  findCodexExecutable,
  reconcileCodexModels,
  refreshCodexStatus,
  startCodexLogin,
  streamCodexCompletion,
};
