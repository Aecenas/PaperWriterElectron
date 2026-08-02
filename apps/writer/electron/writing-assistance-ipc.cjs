const {
  assertBoundedIpcObject,
  assertBoundedIpcPayload,
} = require("./ipc-payload-limits.cjs");

const MAX_CUSTOM_WORDS = 5000;
const MAX_TERM_RULES = 2000;

function registerWritingAssistanceIpcHandlers({
  ipcMain,
  writingAssistanceFacade,
}) {
  ipcMain.handle("writing-assistance:get", async () => (
    writingAssistanceFacade.getConfig()
  ));

  function safeText(value, maximum) {
    return typeof value === "string"
      ? value.slice(0, maximum)
      : "";
  }

  function boundedPatch(value) {
    const source = assertBoundedIpcObject(value, {
      label: "写作检查配置",
      maxBytes: 4 * 1024 * 1024,
      maxNodes: 50_000,
      maxDepth: 8,
      maxArrayLength: MAX_CUSTOM_WORDS,
      maxObjectKeys: 5_000,
    });
    const patch = {};
    if (source.enabled !== undefined) {
      patch.enabled = Boolean(source.enabled);
    }
    if (source.languages !== undefined) {
      patch.languages = (Array.isArray(source.languages)
        ? source.languages
        : [])
        .slice(0, 8)
        .map((language) => safeText(language, 32));
    }
    if (source.customWords !== undefined) {
      patch.customWords = (Array.isArray(source.customWords)
        ? source.customWords
        : [])
        .slice(0, MAX_CUSTOM_WORDS)
        .map((word) => safeText(word, 100));
    }
    if (source.termRules !== undefined) {
      patch.termRules = (Array.isArray(source.termRules)
        ? source.termRules
        : [])
        .slice(0, MAX_TERM_RULES)
        .map((rule) => {
          const item = rule
            && typeof rule === "object"
            && !Array.isArray(rule)
            ? rule
            : {};
          return {
            id: safeText(item.id, 128),
            wrong: safeText(item.wrong, 200),
            preferred: safeText(item.preferred, 200),
            description: safeText(item.description, 500),
            caseSensitive: Boolean(item.caseSensitive),
            wholeWord: Boolean(item.wholeWord),
            enabled: item.enabled !== false,
          };
        });
    }
    return patch;
  }

  function boundedWord(value) {
    assertBoundedIpcPayload(value, {
      label: "自定义词",
      maxBytes: 400,
      maxNodes: 2,
      maxDepth: 1,
      maxArrayLength: 1,
      maxObjectKeys: 1,
    });
    if (typeof value !== "string") {
      throw new Error("自定义词无效");
    }
    if (value.length > 100) {
      throw new Error("自定义词过长");
    }
    return value;
  }

  ipcMain.handle("writing-assistance:save", async (_event, patch = {}) => (
    writingAssistanceFacade.saveConfig(boundedPatch(patch))
  ));

  ipcMain.handle("writing-assistance:add-word", async (_event, word) => (
    writingAssistanceFacade.addWord(boundedWord(word))
  ));

  ipcMain.handle("writing-assistance:remove-word", async (_event, word) => (
    writingAssistanceFacade.removeWord(boundedWord(word))
  ));
}

module.exports = {
  registerWritingAssistanceIpcHandlers,
};
