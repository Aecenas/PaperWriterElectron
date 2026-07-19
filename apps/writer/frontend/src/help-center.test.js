import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("./App.jsx", import.meta.url);
const screenshotsUrl = new URL("./assets/help/screenshots/", import.meta.url);

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return source.slice(start, end);
}

function objectLiterals(source) {
  const objects = [];
  let depth = 0;
  let start = -1;
  let quote = "";
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) objects.push(source.slice(start, index + 1));
    }
  }
  return objects;
}

function stringField(object, field) {
  return object.match(new RegExp(`\\b${field}:\\s*"((?:\\\\.|[^"\\\\])*)"`))?.[1] || "";
}

function stringArrayField(object, field) {
  const body = object.match(new RegExp(`\\b${field}:\\s*\\[([\\s\\S]*?)\\]`))?.[1] || "";
  return [...body.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((match) => match[1]);
}

function illustrationArrayField(object) {
  const body = object.match(/\billustrations:\s*\[([\s\S]*?)\]\s*,\s*steps:/)?.[1] || "";
  return objectLiterals(body).map((item) => ({
    type: stringField(item, "type"),
    alt: stringField(item, "alt"),
    caption: stringField(item, "caption"),
  }));
}

async function helpSource() {
  const app = await readFile(appUrl, "utf8");
  return {
    app,
    screenshots: section(app, "const HELP_SCREENSHOTS = {", "const HELP_CATEGORIES = ["),
    categories: section(app, "const HELP_CATEGORIES = [", "const AI_CHAT_PROMPT_PRESETS = ["),
    topics: section(app, "const HELP_TOPICS = [", "const PAPER_SLICES = {"),
  };
}

function parseScreenshots(source) {
  return [...source.matchAll(/^\s*(?:"([^"]+)"|([A-Za-z][\w-]*)):\s*new URL\("\.\/assets\/help\/screenshots\/([^"]+)"/gm)]
    .map((match) => ({ key: match[1] || match[2], file: match[3] }));
}

function parseTopics(source) {
  return objectLiterals(source).map((object) => ({
    id: stringField(object, "id"),
    categoryId: stringField(object, "categoryId"),
    title: stringField(object, "title"),
    summary: stringField(object, "summary"),
    illustration: stringField(object, "illustration"),
    illustrationAlt: stringField(object, "illustrationAlt"),
    illustrationCaption: stringField(object, "illustrationCaption"),
    illustrations: illustrationArrayField(object),
    steps: stringArrayField(object, "steps"),
    tips: stringArrayField(object, "tips"),
  }));
}

test("help center has five valid categories and 24 complete topics with valid screenshot coverage", async () => {
  const source = await helpSource();
  const categoryIds = [...source.categories.matchAll(/\{\s*id:\s*"([^"]+)"/g)].map((match) => match[1]);
  const screenshots = parseScreenshots(source.screenshots);
  const topics = parseTopics(source.topics);

  assert.deepEqual(categoryIds, ["files", "writing", "research", "ai", "view"]);
  assert.equal(topics.length, 24);
  assert.equal(new Set(topics.map((topic) => topic.id)).size, topics.length, "topic ids must be unique");
  assert.equal(new Set(screenshots.map((item) => item.key)).size, screenshots.length, "screenshot keys must be unique");
  assert.equal(new Set(topics.map((topic) => topic.illustration)).size, topics.length, "each topic needs its own screenshot");

  const screenshotKeys = new Set(screenshots.map((item) => item.key));
  const referencedScreenshots = [];
  for (const topic of topics) {
    assert.ok(categoryIds.includes(topic.categoryId), `${topic.id} has an invalid category`);
    assert.ok(screenshotKeys.has(topic.illustration), `${topic.id} references a missing screenshot key`);
    referencedScreenshots.push(topic.illustration);
    for (const field of ["id", "title", "summary", "illustrationAlt", "illustrationCaption"]) {
      assert.ok(topic[field].trim(), `${topic.id || "unknown topic"} has an empty ${field}`);
    }
    for (const illustration of topic.illustrations) {
      assert.ok(screenshotKeys.has(illustration.type), `${topic.id} references a missing extra screenshot key`);
      assert.ok(illustration.alt.trim(), `${topic.id} has an extra screenshot without alt text`);
      assert.ok(illustration.caption.trim(), `${topic.id} has an extra screenshot without a caption`);
      referencedScreenshots.push(illustration.type);
    }
    assert.ok(topic.steps.length > 0 && topic.steps.every((item) => item.trim()), `${topic.id} needs non-empty steps`);
    assert.ok(topic.tips.length > 0 && topic.tips.every((item) => item.trim()), `${topic.id} needs non-empty tips`);
  }

  assert.deepEqual(new Set(referencedScreenshots), screenshotKeys, "every mapped screenshot must be used by a help topic");
  for (const topicId of ["comments", "ai-modes", "codex-cli", "ai-optimize", "templates-gallery", "template-editor", "status-cache-update"]) {
    assert.ok(topics.find((topic) => topic.id === topicId)?.illustrations.length > 0, `${topicId} needs multiple screenshots`);
  }
});

test("help screenshots exist one-to-one without orphans or duplicate image content", async () => {
  const source = await helpSource();
  const screenshots = parseScreenshots(source.screenshots);
  const mappedFiles = screenshots.map((item) => item.file).sort();
  const actualFiles = (await readdir(screenshotsUrl)).filter((name) => name.endsWith(".webp")).sort();

  assert.equal(screenshots.length, 33);
  assert.deepEqual(actualFiles, mappedFiles, "screenshot folder must contain exactly the mapped help images");

  const hashes = await Promise.all(mappedFiles.map(async (file) => {
    const bytes = await readFile(new URL(file, screenshotsUrl));
    assert.ok(bytes.length > 0, `${file} is empty`);
    return createHash("sha256").update(bytes).digest("hex");
  }));
  assert.equal(new Set(hashes).size, hashes.length, "help screenshots must not reuse identical image content");
});

test("help preserves the 0.9.8 user-visible boundaries and rejects stale 0.9.2 guidance", async () => {
  const { topics } = await helpSource();
  const required = [
    "导入结果始终成为未保存的新信笺",
    "通用导出不包含评注和 AI 记录",
    "来自未来版本的信笺以只读方式打开",
    "保留磁盘版本",
    "资料与网页不会自动进入任何 AI 请求",
    "红蓝修改对比",
    "一次 `Ctrl+Z` 完整撤销",
  ];
  required.forEach((copy) => assert.ok(topics.includes(copy), `missing protected help copy: ${copy}`));

  const stale = [
    "右分屏只允许一个",
    "向右分屏",
    "选择工作区子目录",
    "信笺所在目录",
    "整个工作区",
    "导出弹窗可输出 **PDF** 或[[分页图片]]",
    "文件树和大纲",
    "顶部约 6 像素热区",
    "窗口顶端保留细窄唤出热区",
  ];
  stale.forEach((copy) => assert.ok(!topics.includes(copy), `stale help copy returned: ${copy}`));
});
