const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const KNOWLEDGE_DIRECTORY = __dirname;
const REPOSITORY_ROOT = path.resolve(__dirname, "../../..");
const LEGACY_HELP_SOURCE = path.join(
  REPOSITORY_ROOT,
  "apps/writer/frontend/src/app-shell/help-data.js",
);
const USER_HELP_SOURCE = path.join(
  KNOWLEDGE_DIRECTORY,
  "user-help-topics.json",
);
const HELP_FRONTEND_OUTPUT = path.join(
  REPOSITORY_ROOT,
  "apps/writer/frontend/src/app-shell/help-topics.generated.js",
);
const HELP_SCREENSHOT_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  "apps/writer/frontend/src/assets/help/screenshots",
);
const DETAIL_SOURCE = path.join(
  KNOWLEDGE_DIRECTORY,
  "ai-assistant-details.md",
);
const OUTPUT_FILE = path.join(
  KNOWLEDGE_DIRECTORY,
  "runtime-index.generated.json",
);
const PACKAGE_FILE = path.join(
  REPOSITORY_ROOT,
  "apps/writer/electron/package.json",
);

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
}

function extractArray(source, declaration) {
  const start = source.indexOf(declaration);
  if (start < 0) throw new Error(`找不到知识源声明：${declaration}`);
  const arrayStart = source.indexOf("[", start);
  if (arrayStart < 0) throw new Error(`知识源声明缺少数组：${declaration}`);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = arrayStart; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "[") depth += 1;
    if (character === "]") {
      depth -= 1;
      if (depth === 0) return source.slice(arrayStart, index + 1);
    }
  }
  throw new Error(`知识源数组未闭合：${declaration}`);
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\r\n?/g, "\n")
    .trim();
}

function loadUserHelpSource() {
  const source = JSON.parse(readUtf8(USER_HELP_SOURCE));
  const topics = source?.topics;
  if (!Array.isArray(topics) || topics.length !== 29) {
    throw new Error("用户帮助知识源必须完整保留 29 个主题");
  }
  if (source.schemaVersion !== 1 || !source.appVersion) {
    throw new Error("用户帮助知识源缺少版本标记");
  }
  const ids = new Set();
  for (const topic of topics) {
    if (!topic?.id || ids.has(topic.id)) throw new Error(`帮助主题 ID 重复或为空：${topic?.id || ""}`);
    ids.add(topic.id);
    if (!topic.categoryId || !topic.title || !topic.summary || !Array.isArray(topic.steps) || !Array.isArray(topic.tips)) {
      throw new Error(`帮助主题结构不完整：${topic.id}`);
    }
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(topic.sinceVersion || "")) {
      throw new Error(`帮助主题缺少有效适用版本：${topic.id}`);
    }
    const illustrations = [topic.illustration, ...(topic.illustrations || []).map((item) => item?.type)].filter(Boolean);
    for (const illustration of illustrations) {
      if (!fs.existsSync(path.join(HELP_SCREENSHOT_DIRECTORY, `${illustration}.webp`))) {
        throw new Error(`帮助主题截图引用失效：${topic.id} -> ${illustration}`);
      }
    }
  }
  return source;
}

function loadHelpEntries() {
  const source = loadUserHelpSource();
  const { topics } = source;
  return topics.map((topic) => ({
    id: `help:${topic.id}`,
    kind: "help",
    title: normalizeText(topic.title),
    keywords: [topic.title, topic.categoryId]
      .map(normalizeText)
      .filter(Boolean),
    helpTopicIds: [String(topic.id || "")],
    sinceVersion: String(topic.sinceVersion || source.appVersion),
    body: normalizeText([
      topic.summary,
      Array.isArray(topic.steps) && topic.steps.length
        ? `怎么用：\n${topic.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`
        : "",
      Array.isArray(topic.tips) && topic.tips.length
        ? `注意：\n${topic.tips.map((tip) => `- ${tip}`).join("\n")}`
        : "",
    ].filter(Boolean).join("\n\n")),
    sourceRefs: ["apps/writer/knowledge/user-help-topics.json"],
  }));
}

function loadDetailEntries() {
  const source = readUtf8(DETAIL_SOURCE);
  const expression = /<!--\s*KNOWLEDGE\s*([\s\S]*?)-->\s*##\s+([^\r\n]+)\s*([\s\S]*?)(?=<!--\s*KNOWLEDGE|$)/g;
  const entries = [];
  for (const match of source.matchAll(expression)) {
    let metadata;
    try {
      metadata = JSON.parse(match[1].trim());
    } catch (error) {
      throw new Error(`AI 知识段元数据不是有效 JSON：${error.message}`);
    }
    entries.push({
      id: `detail:${String(metadata.id || "").trim()}`,
      kind: "detail",
      title: normalizeText(match[2]),
      keywords: (Array.isArray(metadata.keywords) ? metadata.keywords : [])
        .map(normalizeText)
        .filter(Boolean),
      helpTopicIds: (Array.isArray(metadata.helpTopicIds)
        ? metadata.helpTopicIds
        : []).map((value) => String(value || "").trim()).filter(Boolean),
      sinceVersion: String(metadata.sinceVersion || "").trim(),
      alwaysInclude: metadata.alwaysInclude === true,
      body: normalizeText(match[3]),
      sourceRefs: (Array.isArray(metadata.sourceRefs)
        ? metadata.sourceRefs
        : []).map((value) => String(value || "").trim()).filter(Boolean),
    });
  }
  if (!entries.length) throw new Error("AI 详尽知识文档没有可编译段落");
  return entries;
}

function validateEntries(entries) {
  const ids = new Set();
  const helpTopicIds = new Set(
    entries.filter((entry) => entry.kind === "help")
      .flatMap((entry) => entry.helpTopicIds),
  );
  for (const entry of entries) {
    if (!entry.id || ids.has(entry.id)) throw new Error(`知识 ID 重复或为空：${entry.id}`);
    ids.add(entry.id);
    if (!entry.title || !entry.body) throw new Error(`知识段缺少标题或正文：${entry.id}`);
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(entry.sinceVersion)) {
      throw new Error(`知识段缺少有效适用版本：${entry.id}`);
    }
    if (!entry.helpTopicIds.length) throw new Error(`知识段未关联帮助主题：${entry.id}`);
    for (const topicId of entry.helpTopicIds) {
      if (!helpTopicIds.has(topicId)) {
        throw new Error(`知识段关联了不存在的帮助主题：${entry.id} -> ${topicId}`);
      }
    }
    if (!entry.sourceRefs.length) throw new Error(`知识段缺少源码引用：${entry.id}`);
    for (const sourceRef of entry.sourceRefs) {
      const resolved = path.resolve(REPOSITORY_ROOT, sourceRef);
      if (!resolved.startsWith(`${REPOSITORY_ROOT}${path.sep}`) || !fs.existsSync(resolved)) {
        throw new Error(`知识段源码引用失效：${entry.id} -> ${sourceRef}`);
      }
    }
    const publicContent = [entry.title, ...(entry.keywords || []), entry.body].join("\n");
    if (/[A-Za-z]:\\Users\\|\/Users\/|-----BEGIN [A-Z ]+PRIVATE KEY-----|(?:api[_ -]?key|secret|token)\s*[:=]\s*[A-Za-z0-9_\-]{16,}/i.test(publicContent)) {
      throw new Error(`知识段包含本机路径或敏感材料：${entry.id}`);
    }
  }
}

function createKnowledgeIndex() {
  const appVersion = JSON.parse(readUtf8(PACKAGE_FILE)).version;
  if (loadUserHelpSource().appVersion !== appVersion) {
    throw new Error(`用户帮助版本与应用版本不一致：${loadUserHelpSource().appVersion} != ${appVersion}`);
  }
  const entries = [...loadHelpEntries(), ...loadDetailEntries()];
  validateEntries(entries);
  return {
    schemaVersion: 1,
    appVersion,
    generatedFrom: [
      "apps/writer/knowledge/user-help-topics.json",
      "apps/writer/knowledge/ai-assistant-details.md",
    ],
    entries,
  };
}

function serializedKnowledgeIndex() {
  return `${JSON.stringify(createKnowledgeIndex(), null, 2)}\n`;
}

function serializedFrontendTopics() {
  const { appVersion, topics } = loadUserHelpSource();
  return [
    "// Generated by apps/writer/knowledge/build-knowledge.cjs. Do not edit directly.",
    `export const HELP_TOPICS_VERSION = ${JSON.stringify(appVersion)};`,
    `export const HELP_TOPICS = ${JSON.stringify(topics, null, 2)};`,
    "",
  ].join("\n");
}

function checkKnowledgeIndex() {
  const expected = serializedKnowledgeIndex();
  const actual = fs.existsSync(OUTPUT_FILE) ? readUtf8(OUTPUT_FILE) : "";
  if (actual !== expected) {
    throw new Error("AI精灵知识索引已过期，请运行 node apps/writer/knowledge/build-knowledge.cjs");
  }
  const expectedFrontend = serializedFrontendTopics();
  const actualFrontend = fs.existsSync(HELP_FRONTEND_OUTPUT) ? readUtf8(HELP_FRONTEND_OUTPUT) : "";
  if (actualFrontend !== expectedFrontend) {
    throw new Error("帮助中心生成数据已过期，请运行 node apps/writer/knowledge/build-knowledge.cjs");
  }
  return OUTPUT_FILE;
}

function writeKnowledgeIndex() {
  fs.writeFileSync(OUTPUT_FILE, serializedKnowledgeIndex(), "utf8");
  fs.writeFileSync(HELP_FRONTEND_OUTPUT, serializedFrontendTopics(), "utf8");
  return OUTPUT_FILE;
}

function migrateLegacyHelpSource() {
  const source = readUtf8(LEGACY_HELP_SOURCE);
  const declaration = "export const HELP_TOPICS =";
  const declarationStart = source.indexOf(declaration);
  if (declarationStart < 0) throw new Error("旧帮助主题已经迁移或不存在");
  const arrayText = extractArray(source, declaration);
  const topics = vm.runInNewContext(`(${arrayText})`, Object.create(null), { timeout: 1000 });
  const appVersion = JSON.parse(readUtf8(PACKAGE_FILE)).version;
  fs.writeFileSync(USER_HELP_SOURCE, `${JSON.stringify({
    schemaVersion: 1,
    appVersion,
    topics: topics.map((topic) => ({ sinceVersion: appVersion, ...topic })),
  }, null, 2)}\n`, "utf8");
  const arrayStart = source.indexOf("[", declarationStart);
  const arrayEnd = arrayStart + arrayText.length;
  const declarationEnd = source[arrayEnd] === ";" ? arrayEnd + 1 : arrayEnd;
  const nextSource = `${source.slice(0, declarationStart)}export { HELP_TOPICS } from "./help-topics.generated.js";${source.slice(declarationEnd)}`;
  fs.writeFileSync(LEGACY_HELP_SOURCE, nextSource, "utf8");
  return writeKnowledgeIndex();
}

if (require.main === module) {
  const migrating = process.argv.includes("--migrate-help");
  const checking = process.argv.includes("--check");
  const output = migrating
    ? migrateLegacyHelpSource()
    : checking
      ? checkKnowledgeIndex()
      : writeKnowledgeIndex();
  console.log(`${migrating ? "Migrated and built" : checking ? "Checked" : "Built"} ${output}`);
}

module.exports = {
  checkKnowledgeIndex,
  createKnowledgeIndex,
  loadDetailEntries,
  loadHelpEntries,
  loadUserHelpSource,
  migrateLegacyHelpSource,
  writeKnowledgeIndex,
};
