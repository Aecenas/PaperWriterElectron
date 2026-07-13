const childProcess = require("node:child_process");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const CODEX_STATUS_TIMEOUT_MS = 20000;
const CODEX_STREAM_MAX_MS = 10 * 60 * 1000;
const CODEX_STREAM_IDLE_TIMEOUT_MS = 2 * 60 * 1000;
const CODEX_STREAM_BUFFER_MAX_CHARS = 1024 * 1024;
const CODEX_STREAM_OUTPUT_MAX_CHARS = 8 * 1024 * 1024;
const CODEX_STREAM_STDERR_MAX_CHARS = 64 * 1024;
const CODEX_STATUS_OUTPUT_MAX_CHARS = 2 * 1024 * 1024;
const CODEX_APP_SERVER_BUFFER_MAX_CHARS = 2 * 1024 * 1024;
const CODEX_MODEL_CATALOG_MAX_ITEMS = 1000;
const CODEX_MODEL_CATALOG_MAX_PAGES = 20;
const CODEX_PROVIDER_ID = "codex-cli";
const CODEX_MIN_SECURE_VERSION = [0, 138, 0];
const CODEX_TEXT_ONLY_PERMISSION_PROFILE = "paperwriter_text_only";
const CODEX_DISABLED_FEATURES = [
  "apps",
  "browser_use",
  "code_mode_host",
  "computer_use",
  "image_generation",
  "multi_agent",
  "shell_snapshot",
  "shell_tool",
  "tool_suggest",
  "unified_exec",
  "workspace_dependencies",
];

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
  const text = String(value);
  if (/[\0\r\n"%]/u.test(text)) {
    throw new Error("Codex .cmd 路径或参数包含不安全字符");
  }
  return `"${text}"`;
}

function codexNpmShimScript(executable) {
  return path.join(path.dirname(executable), "node_modules", "@openai", "codex", "bin", "codex.js");
}

function nodeExecutableForNpmShim(executable) {
  const localNode = path.join(path.dirname(executable), process.platform === "win32" ? "node.exe" : "node");
  if (fsSync.existsSync(localNode)) return localNode;
  if (!process.versions.electron && process.execPath) return process.execPath;
  return process.platform === "win32" ? "node.exe" : "node";
}

function spawnCodex(executable, args, options = {}) {
  if (process.platform === "win32" && path.extname(executable).toLowerCase() === ".cmd") {
    const npmShimScript = codexNpmShimScript(executable);
    if (fsSync.existsSync(npmShimScript)) {
      return childProcess.spawn(nodeExecutableForNpmShim(executable), [npmShimScript, ...args], options);
    }
    const commandLine = [quoteCmdArg(executable), ...args.map(quoteCmdArg)].join(" ");
    return childProcess.spawn(
      process.env.ComSpec || "cmd.exe",
      ["/d", "/s", "/v:off", "/c", `"${commandLine}"`],
      { ...options, windowsVerbatimArguments: true },
    );
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

function endChildInputSafely(child, input, finish, isSettled = () => false) {
  const stdin = child?.stdin;
  if (!stdin) {
    if (!isSettled()) finish(new Error("Codex CLI 输入流不可用"));
    return;
  }
  const fail = (error) => {
    if (!error || isSettled()) return;
    terminateProcessTree(child);
    finish(new Error(`Codex CLI 输入失败：${error.message || error.code || "未知错误"}`, { cause: error }));
  };
  stdin.on("error", fail);
  try {
    stdin.end(input, (error) => fail(error));
  } catch (error) {
    fail(error);
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
      terminateProcessTree(child);
      finish(new Error("Codex CLI 响应超时"));
    }, timeoutMs);
    const appendOutput = (target, chunk) => {
      const text = chunk.toString("utf8");
      if (target.length + text.length > CODEX_STATUS_OUTPUT_MAX_CHARS) {
        terminateProcessTree(child);
        finish(new Error("Codex CLI 状态输出超过安全上限"));
        return target;
      }
      return target + text;
    };
    child.stdout.on("data", (chunk) => { if (!settled) stdout = appendOutput(stdout, chunk); });
    child.stderr.on("data", (chunk) => { if (!settled) stderr = appendOutput(stderr, chunk); });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => finish(null, { code, stdout, stderr }));
    endChildInputSafely(child, input, finish, () => settled);
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
    const text = chunk.toString("utf8");
    if (buffer.length + text.length > CODEX_APP_SERVER_BUFFER_MAX_CHARS) {
      buffer = "";
      terminateProcessTree(child);
      rejectAll(new Error("Codex App Server 输出超过安全上限"));
      return;
    }
    buffer += text;
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
    let pageCount = 0;
    const seenCursors = new Set();
    do {
      if (cursor && seenCursors.has(cursor)) throw new Error("Codex 模型目录返回了重复游标");
      if (cursor) seenCursors.add(cursor);
      pageCount += 1;
      if (pageCount > CODEX_MODEL_CATALOG_MAX_PAGES) throw new Error("Codex 模型目录分页过多");
      const response = await client.request("model/list", { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) });
      const page = Array.isArray(response?.data) ? response.data : [];
      if (models.length + page.length > CODEX_MODEL_CATALOG_MAX_ITEMS) throw new Error("Codex 模型目录项目过多");
      models.push(...page);
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
  return catalog.filter((model) => !model.hidden && model.model).slice(0, CODEX_MODEL_CATALOG_MAX_ITEMS).map((model, index) => {
    const previous = previousByModel.get(model.model) || {};
    const efforts = (model.supportedReasoningEfforts || []).slice(0, 32).map((option) => ({
      reasoningEffort: String(option.reasoningEffort || "").slice(0, 64),
      description: String(option.description || "").slice(0, 500),
    })).filter((option) => option.reasoningEffort);
    const supported = new Set(efforts.map((option) => option.reasoningEffort));
    const defaultEffort = String(model.defaultReasoningEffort || efforts[0]?.reasoningEffort || "").slice(0, 64);
    const reasoningEffort = supported.has(previous.reasoningEffort) ? previous.reasoningEffort : defaultEffort;
    return {
      id: String(model.id || `${CODEX_PROVIDER_ID}-${index + 1}`).slice(0, 256),
      name: String(model.displayName || model.model).slice(0, 256),
      model: String(model.model).slice(0, 256),
      description: String(model.description || "").slice(0, 2000),
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

function parseCodexVersion(value) {
  const match = String(value || "").match(/\b(\d+)\.(\d+)\.(\d+)\b/);
  return match ? match.slice(1, 4).map(Number) : null;
}

function supportsSecureCodexVersion(value) {
  const version = parseCodexVersion(value);
  if (!version) return false;
  for (let index = 0; index < CODEX_MIN_SECURE_VERSION.length; index += 1) {
    if (version[index] > CODEX_MIN_SECURE_VERSION[index]) return true;
    if (version[index] < CODEX_MIN_SECURE_VERSION[index]) return false;
  }
  return true;
}

function mergeCodexRefreshedModels(currentModels = [], refreshedModels = []) {
  return reconcileCodexModels(currentModels, refreshedModels.map((model) => ({
    ...model,
    displayName: model.displayName || model.name || model.model,
    isDefault: Boolean(model.isDefault || model.catalogDefault),
    hidden: false,
  })));
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
  if (!supportsSecureCodexVersion(version)) {
    return {
      installed: true,
      authenticated: false,
      ready: false,
      catalogFresh: false,
      executablePath: resolvedExecutable,
      version,
      models: previousModels,
      checkedAt,
      message: "Codex CLI 版本过低或无法确认；请升级到 0.138.0 或更高版本以启用安全文件隔离",
    };
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
  void scope;
  const transcript = messages.map((message) => `[${message.role}]\n${message.content}`).join("\n\n");
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
  const scopeInstruction = hasAttachments
    ? "本次只允许使用下方对话中提供的当前信笺内容与显式附加的当前信笺图片。本次没有本地文件或目录访问能力，不要尝试调用任何工具。"
    : "本次只允许使用下方对话中提供的当前信笺内容。本次没有本地文件或目录访问能力，不要尝试调用任何工具。";
  const attachmentInstruction = hasAttachments
    ? [
        "当前信笺正文、用户标记文字和图片附件是本次问答的全部依据。",
        "图片附件与信笺图号的对应关系如下：",
        ...attachments.map((image) => `附件${image.attachmentIndex || image.number} = 图${image.number}.${image.caption || "图片"}`),
      ].join("\n")
    : "当前信笺正文和用户标记文字是本次问答的全部依据。";
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
    "--strict-config", "--skip-git-repo-check", "-C", cwd, "-m", config.model,
    ...imageArgs,
    "-c", 'approval_policy="never"',
    "-c", 'web_search="disabled"',
    "-c", `default_permissions="${CODEX_TEXT_ONLY_PERMISSION_PROFILE}"`,
    "-c", `permissions.${CODEX_TEXT_ONLY_PERMISSION_PROFILE}.filesystem={ ":root" = "deny" }`,
    "-c", `permissions.${CODEX_TEXT_ONLY_PERMISSION_PROFILE}.network={ enabled = false }`,
    "-c", 'shell_environment_policy.inherit="none"',
    ...CODEX_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
    ...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : []),
  ];
}

function isolatedCodexEnvironment(directory, environment = process.env) {
  const allowedKeys = new Set([
    "appdata", "comspec", "codex_home", "home", "homedrive", "homepath",
    "http_proxy", "https_proxy", "lang", "lc_all", "localappdata",
    "no_proxy", "node_extra_ca_certs", "openai_api_key", "openai_base_url",
    "openai_org_id", "openai_project_id", "path", "pathext", "programdata",
    "ssl_cert_file", "systemroot", "userprofile", "windir", "xdg_config_home",
  ]);
  const result = {};
  Object.entries(environment || {}).forEach(([key, value]) => {
    if (allowedKeys.has(key.toLowerCase())) result[key] = value;
  });
  return { ...result, TEMP: directory, TMP: directory, TMPDIR: directory };
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
  void cwd;
  const isolationRoot = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-codex-run-"));
  const workingDirectory = path.join(isolationRoot, "private-tmp");
  await fs.mkdir(workingDirectory);
  const args = codexExecArgs(config, workingDirectory, imagePaths);
  let child;
  try {
    child = spawnCodex(executable, args, {
      cwd: workingDirectory,
      env: isolatedCodexEnvironment(workingDirectory),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    await fs.rm(isolationRoot, { recursive: true, force: true });
    throw error;
  }
  return new Promise((resolve, reject) => {
    let buffer = "";
    let stderr = "";
    let usage = null;
    let emittedText = "";
    let completed = false;
    let settled = false;
    let totalOutputCharacters = 0;
    let idleTimer;
    const totalTimer = setTimeout(() => {
      terminateProcessTree(child);
      finish(new Error("Codex CLI 生成超时"));
    }, CODEX_STREAM_MAX_MS);
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        terminateProcessTree(child);
        finish(new Error("Codex CLI 长时间没有响应"));
      }, CODEX_STREAM_IDLE_TIMEOUT_MS);
    };
    const abort = () => terminateProcessTree(child);
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      clearTimeout(idleTimer);
      signal?.removeEventListener("abort", abort);
      fs.rm(isolationRoot, { recursive: true, force: true })
        .catch(() => {})
        .finally(() => {
          if (error) reject(error); else resolve(result);
        });
    };
    resetIdleTimer();
    signal?.addEventListener("abort", abort, { once: true });
    child.stderr.on("data", (chunk) => {
      if (settled) return;
      resetIdleTimer();
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-CODEX_STREAM_STDERR_MAX_CHARS);
    });
    child.stdout.on("data", (chunk) => {
      if (settled) return;
      resetIdleTimer();
      buffer += chunk.toString("utf8");
      if (buffer.length > CODEX_STREAM_BUFFER_MAX_CHARS) {
        terminateProcessTree(child);
        finish(new Error("Codex CLI 流式事件过大"));
        return;
      }
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      lines.forEach((line) => {
        if (settled) return;
        let event;
        try { event = JSON.parse(line); } catch { return; }
        if (event.type === "item.completed" && event.item?.type === "agent_message") {
          const text = String(event.item.text || "");
          const delta = text.startsWith(emittedText) ? text.slice(emittedText.length) : text;
          totalOutputCharacters += delta.length;
          if (totalOutputCharacters > CODEX_STREAM_OUTPUT_MAX_CHARS) {
            terminateProcessTree(child);
            finish(new Error("Codex CLI 生成内容超过安全上限"));
            return;
          }
          if (delta) onDelta(delta);
          emittedText = text;
        } else if (event.type === "item.updated" && event.item?.type === "agent_message") {
          const text = String(event.item.text || event.delta || "");
          const delta = text.startsWith(emittedText) ? text.slice(emittedText.length) : String(event.delta || "");
          totalOutputCharacters += delta.length;
          if (totalOutputCharacters > CODEX_STREAM_OUTPUT_MAX_CHARS) {
            terminateProcessTree(child);
            finish(new Error("Codex CLI 生成内容超过安全上限"));
            return;
          }
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
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (signal?.aborted) return finish(new Error("已停止生成"));
      if (code !== 0 || !completed) return finish(new Error(stderr.trim() || `Codex CLI 生成失败 (${code ?? "unknown"})`));
      return finish(null, usage);
    });
    endChildInputSafely(child, codexPrompt(messages, scope, attachments), finish, () => settled);
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
  isolatedCodexEnvironment,
  mergeCodexRefreshedModels,
  parseCodexVersion,
  reconcileCodexModels,
  refreshCodexStatus,
  runCodex,
  startCodexLogin,
  streamCodexCompletion,
  supportsSecureCodexVersion,
};
