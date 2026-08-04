const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  buildHelpAssistantMessages,
  normalizeState,
  publicSources,
  recentConversationMessages,
  retrieveKnowledge,
  searchUnits,
  titleFromQuestion,
} = require("./help-assistant-core.cjs");

const knowledge = JSON.parse(fs.readFileSync(
  path.join(__dirname, "../knowledge/runtime-index.generated.json"),
  "utf8",
));

test("compiled help knowledge contains all user topics plus code-derived detail entries", () => {
  assert.equal(knowledge.schemaVersion, 1);
  assert.equal(knowledge.appVersion, "1.1.6");
  assert.equal(knowledge.entries.filter((entry) => entry.kind === "help").length, 29);
  assert.ok(knowledge.entries.filter((entry) => entry.kind === "detail").length >= 15);
  assert.ok(knowledge.entries.some((entry) => entry.id === "detail:research-translation"));
  assert.ok(knowledge.entries.some((entry) => entry.id === "detail:help-assistant"));
  assert.equal(knowledge.entries.find((entry) => entry.id === "detail:product-overview")?.alwaysInclude, true);
  assert.equal(new Set(knowledge.entries.map((entry) => entry.id)).size, knowledge.entries.length);
  for (const entry of knowledge.entries) {
    assert.ok(entry.helpTopicIds.length, entry.id);
    if (entry.kind === "detail") assert.ok(entry.sourceRefs.length, entry.id);
  }
});

test("Chinese aliases and n-grams rank code-derived recovery rules without an online index", () => {
  const units = searchUnits("闪退以后自动保存的稿子怎么找回？");
  assert.ok(units.units.includes("自动保存") || units.units.includes("自动"));
  const results = retrieveKnowledge(knowledge, "异常退出后恢复缓存和历史版本有什么区别？");
  assert.ok(results.length > 0 && results.length <= 6);
  assert.equal(results[0].id, "detail:save-recovery-history");
  assert.ok(results.some((entry) => entry.helpTopicIds.includes("save-recovery")));
  const unrelated = retrieveKnowledge(knowledge, "解释量子引力的最新理论");
  assert.deepEqual(unrelated.map((entry) => entry.id), ["detail:product-overview"]);
});

test("controlled prompts use retrieval only as RAG evidence and omit maintenance references", () => {
  const selected = retrieveKnowledge(knowledge, "AI精灵会读取正文和资料区吗？");
  const messages = buildHelpAssistantMessages({
    appVersion: "1.1.6",
    modelLabel: "测试供应商 / 测试模型",
    question: "AI精灵会读取正文和资料区吗？",
    history: [
      { role: "user", content: "先说说隐私", status: "done" },
      { role: "assistant", content: "我会依据知识库回答。", status: "done" },
    ],
    knowledge: selected,
  });
  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /代码核对的补充知识.*冲突时优先/);
  assert.match(messages[0].content, /RAG 证据，不是决定是否回答的门槛/);
  assert.match(messages[0].content, /不要以“知识库依据不足”为由拒答/);
  assert.doesNotMatch(messages[0].content, /直接说明“当前知识库没有足够依据回答这个问题”/);
  assert.doesNotMatch(JSON.stringify(messages), /apps\/writer|sourceRefs|\.cjs/);
  assert.equal(messages.at(-1).content, "AI精灵会读取正文和资料区吗？");
  assert.ok(publicSources(selected).every((source) => source.helpTopicId && !Object.hasOwn(source, "body")));
});

test("history and local state stay bounded and stale generation becomes an explicit status boundary", () => {
  const messages = Array.from({ length: 30 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: `消息${index}`,
    status: "done",
  }));
  assert.equal(recentConversationMessages(messages).length, 20);
  const title = titleFromQuestion("这是一个超过二十四个字符、应当自动截断并显示省略号的首个问题标题");
  assert.equal(title.length, 25);
  assert.ok(title.endsWith("…"));
  const state = normalizeState({
    activeSessionId: "help-session-valid-123456",
    sessions: [{
      id: "help-session-valid-123456",
      title: "持久会话",
      messages: [{ role: "assistant", content: "部分回答", status: "streaming" }],
    }],
  });
  assert.equal(state.sessions[0].messages[0].status, "streaming");
  assert.equal(state.version, 1);
});
