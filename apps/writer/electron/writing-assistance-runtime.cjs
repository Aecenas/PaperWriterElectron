const WRITING_ASSISTANCE_FILE = "writing-assistance.json";
const WRITING_ASSISTANCE_SCHEMA_VERSION = 1;
const MAX_CUSTOM_WORDS = 5000;
const MAX_TERM_RULES = 2000;
const MAX_CONFIG_BYTES = 8 * 1024 * 1024;
const BUNDLED_SPELL_CHECKER_LANGUAGES = new Set(["en-us"]);
const DOCUMENT_CONTEXT_MENU_CHANNEL = "writing-assistance:document-context-menu";

function createWritingAssistanceRuntime({
  fs,
  path,
  atomicWriteFile,
  getUserDataPath,
  randomUUID,
}) {
  let mutationTail = Promise.resolve();
  let activeSession = null;
  let appliedCustomWords = new Set();
  let appliedSession = null;

  function configPath() {
    return path.join(getUserDataPath(), WRITING_ASSISTANCE_FILE);
  }

  function normalizeLanguage(value) {
    const language = String(value || "").slice(0, 32).trim();
    return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language)
      ? language
      : "";
  }

  function normalizeWord(value) {
    const word = String(value || "")
      .normalize("NFC")
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
      .trim();
    return word.length > 0 && word.length <= 100 ? word : "";
  }

  function normalizeTermRule(value, index) {
    const source = value && typeof value === "object" ? value : {};
    const wrong = String(source.wrong || "")
      .normalize("NFC")
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
      .trim()
      .slice(0, 200);
    const preferred = String(source.preferred || "")
      .normalize("NFC")
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
      .trim()
      .slice(0, 200);
    if (!wrong || !preferred || wrong === preferred) return null;
    return {
      id: (() => {
        const requested = String(source.id || "");
        if (/^[A-Za-z0-9_-]{1,128}$/.test(requested)) {
          return requested;
        }
        const generated = String(randomUUID?.() || "");
        return /^[A-Za-z0-9_-]{1,128}$/.test(generated)
          ? generated
          : `term-${index + 1}`;
      })(),
      wrong,
      preferred,
      description: String(source.description || "")
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
        .trim()
        .slice(0, 500),
      caseSensitive: Boolean(source.caseSensitive),
      wholeWord: Boolean(source.wholeWord),
      enabled: source.enabled !== false,
    };
  }

  function normalizeConfig(value = {}) {
    const source = value && typeof value === "object" ? value : {};
    const languages = [...new Set(
      (Array.isArray(source.languages) ? source.languages : ["zh-CN", "en-US"])
        .map(normalizeLanguage)
        .filter(Boolean),
    )].slice(0, 8);
    const customWords = [...new Set(
      (Array.isArray(source.customWords) ? source.customWords : [])
        .map(normalizeWord)
        .filter(Boolean),
    )].slice(0, MAX_CUSTOM_WORDS);
    const ruleIds = new Set();
    const termRules = (Array.isArray(source.termRules) ? source.termRules : [])
      .slice(0, MAX_TERM_RULES)
      .map(normalizeTermRule)
      .filter((rule) => {
        if (!rule || ruleIds.has(rule.id)) return false;
        ruleIds.add(rule.id);
        return true;
      });
    return {
      version: WRITING_ASSISTANCE_SCHEMA_VERSION,
      enabled: source.enabled !== false,
      languages: languages.length ? languages : ["en-US"],
      customWords,
      termRules,
    };
  }

  async function readConfig() {
    let handle;
    try {
      handle = await fs.open(configPath(), "r");
      const before = await handle.stat();
      if (
        !before.isFile()
        || before.size <= 0
        || before.size > MAX_CONFIG_BYTES
      ) {
        throw new Error("写作检查配置大小无效");
      }
      const buffer = await handle.readFile();
      const after = await handle.stat();
      if (
        buffer.length !== after.size
        || before.size !== after.size
        || before.mtimeMs !== after.mtimeMs
      ) {
        throw new Error("写作检查配置在读取期间发生变化");
      }
      return normalizeConfig(JSON.parse(buffer.toString("utf8")));
    } catch (error) {
      if (error?.code === "ENOENT" || error instanceof SyntaxError) {
        return normalizeConfig();
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async function persistConfig(value) {
    const config = normalizeConfig(value);
    await atomicWriteFile(
      configPath(),
      `${JSON.stringify(config, null, 2)}\n`,
    );
    return config;
  }

  function queueMutation(task) {
    const pending = mutationTail.catch(() => {}).then(task);
    mutationTail = pending;
    return pending;
  }

  function supportedSpellCheckerLanguages(sessionValue, requested) {
    const bundled = requested.filter((language) => (
      BUNDLED_SPELL_CHECKER_LANGUAGES.has(
        language.toLocaleLowerCase("en-US"),
      )
    ));
    const available = Array.isArray(
      sessionValue?.availableSpellCheckerLanguages,
    )
      ? sessionValue.availableSpellCheckerLanguages
      : [];
    if (!available.length) return bundled;
    const availableMap = new Map(
      available.map((language) => [language.toLocaleLowerCase("en-US"), language]),
    );
    return bundled
      .map((language) => availableMap.get(
        language.toLocaleLowerCase("en-US"),
      ))
      .filter(Boolean);
  }

  async function applyToSession(configInput, sessionValue = activeSession) {
    if (!sessionValue) return;
    if (appliedSession !== sessionValue) {
      appliedSession = sessionValue;
      appliedCustomWords = new Set();
    }
    const config = normalizeConfig(configInput);
    const languages = config.enabled
      ? supportedSpellCheckerLanguages(sessionValue, config.languages)
      : [];
    sessionValue.setSpellCheckerLanguages?.(languages);
    const nextWords = new Set(config.enabled ? config.customWords : []);
    for (const word of appliedCustomWords) {
      if (!nextWords.has(word)) {
        sessionValue.removeWordFromSpellCheckerDictionary?.(word);
      }
    }
    for (const word of nextWords) {
      if (!appliedCustomWords.has(word)) {
        sessionValue.addWordToSpellCheckerDictionary?.(word);
      }
    }
    appliedCustomWords = nextWords;
  }

  async function initialize(sessionValue) {
    activeSession = sessionValue || null;
    const config = await readConfig();
    await applyToSession(config, activeSession);
    return config;
  }

  function replaceConfig(value) {
    return queueMutation(async () => {
      const config = await persistConfig(value);
      await applyToSession(config);
      return config;
    });
  }

  function saveConfig(patch = {}) {
    return queueMutation(async () => {
      const current = await readConfig();
      const source = patch && typeof patch === "object" ? patch : {};
      const next = normalizeConfig({
        ...current,
        ...source,
        customWords: source.customWords === undefined
          ? current.customWords
          : source.customWords,
        termRules: source.termRules === undefined
          ? current.termRules
          : source.termRules,
      });
      await persistConfig(next);
      await applyToSession(next);
      return next;
    });
  }

  function addWord(value) {
    return queueMutation(async () => {
      const word = normalizeWord(value);
      if (!word) throw new Error("自定义词无效");
      const current = await readConfig();
      if (
        !current.customWords.includes(word)
        && current.customWords.length >= MAX_CUSTOM_WORDS
      ) {
        throw new Error("自定义词数量已达上限");
      }
      const next = await persistConfig({
        ...current,
        customWords: [...current.customWords, word],
      });
      await applyToSession(next);
      return next;
    });
  }

  function removeWord(value) {
    return queueMutation(async () => {
      const word = normalizeWord(value);
      const current = await readConfig();
      const next = await persistConfig({
        ...current,
        customWords: current.customWords.filter((item) => item !== word),
      });
      await applyToSession(next);
      return next;
    });
  }

  return {
    facade: Object.freeze({
      addWord,
      getConfig: readConfig,
      removeWord,
      replaceConfig,
      saveConfig,
    }),
    initialize,
    normalizeConfig,
    readConfig,
  };
}

function installSpellingContextMenu({
  webContents,
  Menu,
  getConfig,
  addWord,
}) {
  if (!webContents || typeof webContents.on !== "function") {
    throw new TypeError("缺少网页内容对象");
  }
  const requestDocumentContextMenu = (event, params = {}) => {
    if (
      typeof webContents.send !== "function"
      || webContents.isDestroyed?.()
    ) {
      return false;
    }
    const coordinate = (value) => {
      const number = Number(value);
      return Number.isFinite(number)
        ? Math.max(0, Math.min(100_000, Math.round(number)))
        : 0;
    };
    webContents.send(DOCUMENT_CONTEXT_MENU_CHANNEL, {
      x: coordinate(params.x),
      y: coordinate(params.y),
    });
    event?.preventDefault?.();
    return true;
  };
  const listener = async (event, params = {}) => {
    let nativeMenuOpened = false;
    try {
      const misspelledWord = String(params.misspelledWord || "")
        .normalize("NFC")
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
        .slice(0, 100)
        .trim();
      if (!misspelledWord) {
        requestDocumentContextMenu(event, params);
        return;
      }
      const config = await getConfig();
      if (!config?.enabled) {
        requestDocumentContextMenu(event, params);
        return;
      }
      const suggestions = Array.isArray(params.dictionarySuggestions)
        ? params.dictionarySuggestions
          .map((value) => String(value || "")
            .normalize("NFC")
            .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
            .trim()
            .slice(0, 100))
          .filter(Boolean)
          .slice(0, 5)
        : [];
      const template = suggestions.length
        ? suggestions.map((suggestion) => ({
          label: suggestion,
          click: () => webContents.replaceMisspelling(suggestion),
        }))
        : [{ label: "没有拼写建议", enabled: false }];
      template.push(
        { type: "separator" },
        {
          label: `将“${misspelledWord}”加入词典`,
          click: () => {
            void Promise.resolve(addWord(misspelledWord)).catch(() => {});
          },
        },
      );
      event?.preventDefault?.();
      Menu.buildFromTemplate(template).popup({
        window: webContents.getOwnerBrowserWindow?.(),
      });
      nativeMenuOpened = true;
    } catch {
      // Native context menus must never interrupt editing.
      if (!nativeMenuOpened) requestDocumentContextMenu(event, params);
    }
  };
  webContents.on("context-menu", listener);
  return () => webContents.removeListener?.("context-menu", listener);
}

module.exports = {
  BUNDLED_SPELL_CHECKER_LANGUAGES,
  DOCUMENT_CONTEXT_MENU_CHANNEL,
  MAX_CONFIG_BYTES,
  MAX_CUSTOM_WORDS,
  MAX_TERM_RULES,
  WRITING_ASSISTANCE_SCHEMA_VERSION,
  createWritingAssistanceRuntime,
  installSpellingContextMenu,
};
