export const WRITING_ASSISTANCE_SCHEMA_VERSION = 1;
export const BILINGUAL_WRITING_ASSISTANCE_LANGUAGE = "zh-CN+en-US";

export const DEFAULT_WRITING_ASSISTANCE_CONFIG = Object.freeze({
  version: WRITING_ASSISTANCE_SCHEMA_VERSION,
  enabled: true,
  language: "zh-CN",
  customWords: Object.freeze([]),
  terminologyRules: Object.freeze([]),
});

const EXCLUDED_BLOCK_TYPES = new Set([
  "codeBlock",
  "paperCode",
  "paperMermaid",
  "paperBibliography",
  "paperFootnoteList",
]);

const EXCLUDED_INLINE_TYPES = new Set([
  "image",
  "paperMedia",
  "paperImageReference",
  "paperCitationReference",
  "paperEquationReference",
  "inlineMath",
  "blockMath",
]);

const JSON_TEXT_BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "textBlock",
]);

const URL_PATTERN = /(?:https?:\/\/|mailto:|www\.)[^\s<>{}\[\]"']+/giu;

const ZH_CN_COMMON_TYPO_PAIRS = Object.freeze([
  ["什莫", "什么"],
  ["因该", "应该"],
  ["以经", "已经"],
  ["即然", "既然"],
  ["在次", "再次"],
  ["按装", "安装"],
  ["既使", "即使"],
  ["必须品", "必需品"],
  ["再接再励", "再接再厉"],
  ["迫不急待", "迫不及待"],
  ["一愁莫展", "一筹莫展"],
  ["甘败下风", "甘拜下风"],
  ["穿流不息", "川流不息"],
  ["不径而走", "不胫而走"],
  ["默守成规", "墨守成规"],
  ["走头无路", "走投无路"],
  ["名符其实", "名副其实"],
  ["按步就班", "按部就班"],
  ["变本加利", "变本加厉"],
  ["一如继往", "一如既往"],
  ["出奇不意", "出其不意"],
  ["世外桃园", "世外桃源"],
  ["竭泽而鱼", "竭泽而渔"],
  ["相形见拙", "相形见绌"],
  ["流言非语", "流言蜚语"],
  ["不落巢臼", "不落窠臼"],
  ["趋之若骛", "趋之若鹜"],
  ["不可思义", "不可思议"],
  ["鬼鬼崇崇", "鬼鬼祟祟"],
  ["挺而走险", "铤而走险"],
  ["声名雀起", "声名鹊起"],
  ["震憾", "震撼"],
  ["松驰", "松弛"],
  ["精萃", "精粹"],
  ["脉博", "脉搏"],
  ["凑和", "凑合"],
  ["冒然", "贸然"],
  ["渡假", "度假"],
  ["九宵", "九霄"],
]);

const ZH_CN_COMMON_TYPO_RULES = Object.freeze(
  ZH_CN_COMMON_TYPO_PAIRS.map(([incorrect, preferred], index) => Object.freeze({
    id: `spell-zh-cn-${index + 1}`,
    kind: "spelling",
    incorrect,
    preferred,
    description: `常见错词，建议改为“${preferred}”。`,
    caseSensitive: true,
    wholeWord: false,
    enabled: true,
  })),
);

function nodeTypeName(node) {
  return String(node?.type?.name || node?.type || "");
}

function markTypeName(mark) {
  return String(mark?.type?.name || mark?.type || "");
}

function compactText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function createRuleId(rule, index) {
  const supplied = compactText(rule?.id, 128);
  if (supplied) return supplied;
  const source = `${compactText(rule?.incorrect, 128)}\0${compactText(rule?.preferred, 256)}\0${index}`;
  let hash = 2166136261;
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    hash ^= source.charCodeAt(cursor);
    hash = Math.imul(hash, 16777619);
  }
  return `term-${(hash >>> 0).toString(36)}`;
}

export function normalizeTerminologyRule(rule, index = 0) {
  const incorrect = compactText(rule?.incorrect ?? rule?.wrong, 128);
  const preferred = compactText(rule?.preferred ?? rule?.replacement, 256);
  if (!incorrect || !preferred || incorrect === preferred) return null;
  return Object.freeze({
    id: createRuleId(rule, index),
    incorrect,
    preferred,
    description: compactText(rule?.description, 500),
    caseSensitive: rule?.caseSensitive === true || rule?.matchCase === true,
    wholeWord: rule?.wholeWord === true,
    enabled: rule?.enabled !== false,
  });
}

export function normalizeWritingAssistanceConfig(config) {
  const source = config && typeof config === "object" ? config : {};
  const words = [];
  const seenWords = new Set();
  for (const entry of Array.isArray(source.customWords) ? source.customWords : []) {
    const word = compactText(entry, 128);
    const key = word.toLocaleLowerCase();
    if (!word || seenWords.has(key)) continue;
    seenWords.add(key);
    words.push(word);
    if (words.length >= 5000) break;
  }

  const rules = [];
  const seenRuleIds = new Set();
  const sourceRules = Array.isArray(source.terminologyRules)
    ? source.terminologyRules
    : (Array.isArray(source.termRules) ? source.termRules : []);
  for (const [index, rule] of sourceRules.entries()) {
    const normalized = normalizeTerminologyRule(rule, index);
    if (!normalized || seenRuleIds.has(normalized.id)) continue;
    seenRuleIds.add(normalized.id);
    rules.push(normalized);
    if (rules.length >= 1000) break;
  }

  const persistedLanguages = [...new Set(
    (Array.isArray(source.languages) ? source.languages : [])
      .filter((candidate) => ["zh-CN", "en-US"].includes(candidate)),
  )];
  const bilingual = source.language === BILINGUAL_WRITING_ASSISTANCE_LANGUAGE
    || (persistedLanguages.includes("zh-CN") && persistedLanguages.includes("en-US"));
  const language = bilingual
    ? BILINGUAL_WRITING_ASSISTANCE_LANGUAGE
    : (["zh-CN", "en-US"].includes(source.language)
      ? source.language
      : persistedLanguages[0] || "zh-CN");
  const languages = language === BILINGUAL_WRITING_ASSISTANCE_LANGUAGE
    ? ["zh-CN", "en-US"]
    : [language];
  const frozenWords = Object.freeze(words);
  const frozenRules = Object.freeze(rules);
  const storageRules = Object.freeze(rules.map((rule) => Object.freeze({
    id: rule.id,
    wrong: rule.incorrect,
    preferred: rule.preferred,
    description: rule.description,
    caseSensitive: rule.caseSensitive,
    wholeWord: rule.wholeWord,
    enabled: rule.enabled,
  })));
  return Object.freeze({
    version: WRITING_ASSISTANCE_SCHEMA_VERSION,
    enabled: source.enabled !== false,
    language,
    languages: Object.freeze(languages),
    customWords: frozenWords,
    terminologyRules: frozenRules,
    termRules: storageRules,
  });
}

export function serializeWritingAssistanceConfig(config) {
  const normalized = normalizeWritingAssistanceConfig(config);
  return Object.freeze({
    version: WRITING_ASSISTANCE_SCHEMA_VERSION,
    enabled: normalized.enabled,
    languages: normalized.languages,
    customWords: normalized.customWords,
    termRules: normalized.termRules,
  });
}

function maskRawUrls(text) {
  const masked = String(text || "").split("");
  URL_PATTERN.lastIndex = 0;
  for (const match of String(text || "").matchAll(URL_PATTERN)) {
    const from = match.index || 0;
    const to = from + match[0].length;
    for (let index = from; index < to; index += 1) masked[index] = "\ufffc";
  }
  return masked.join("");
}

function createBlockBuilder({ key, type, from, to }) {
  const plainParts = [];
  const searchParts = [];
  const positions = [];

  return {
    appendText(text, start, excluded = false) {
      const value = String(text || "");
      if (!value) return;
      plainParts.push(value);
      searchParts.push(excluded ? "\ufffc".repeat(value.length) : maskRawUrls(value));
      for (let index = 0; index < value.length; index += 1) positions.push(start + index);
    },
    appendBoundary(position) {
      plainParts.push("\ufffc");
      searchParts.push("\ufffc");
      positions.push(position);
    },
    finish() {
      return Object.freeze({
        key,
        type,
        from,
        to,
        plainText: plainParts.join(""),
        searchText: searchParts.join(""),
        positions: Object.freeze(positions),
      });
    },
  };
}

function isLinkedText(node) {
  const marks = Array.isArray(node?.marks) ? node.marks : [];
  return marks.some((mark) => markTypeName(mark) === "link");
}

function pmTextBlock(node, position, path) {
  const builder = createBlockBuilder({
    key: `pm:${position}:${path}`,
    type: nodeTypeName(node),
    from: position + 1,
    to: position + 1 + Number(node.content?.size || 0),
  });
  node.descendants((child, childPosition) => {
    const type = nodeTypeName(child);
    if (child.isText) {
      builder.appendText(child.text, position + 1 + childPosition, isLinkedText(child));
      return false;
    }
    if (EXCLUDED_INLINE_TYPES.has(type) || child.isAtom || child.isLeaf) {
      builder.appendBoundary(position + 1 + childPosition);
      return false;
    }
    return true;
  });
  return builder.finish();
}

function jsonNodeSize(node) {
  if (!node || typeof node !== "object") return 0;
  if (node.type === "text") return String(node.text || "").length;
  if (!Array.isArray(node.content) || !node.content.length) return 1;
  return 2 + node.content.reduce((total, child) => total + jsonNodeSize(child), 0);
}

function isJsonTextBlock(node) {
  if (JSON_TEXT_BLOCK_TYPES.has(nodeTypeName(node))) return true;
  const content = Array.isArray(node?.content) ? node.content : [];
  return content.length > 0 && content.every((child) => (
    child?.type === "text" || EXCLUDED_INLINE_TYPES.has(nodeTypeName(child))
  ));
}

function appendJsonInline(builder, node, position) {
  const type = nodeTypeName(node);
  if (type === "text") {
    builder.appendText(node.text, position, isLinkedText(node));
    return;
  }
  if (EXCLUDED_INLINE_TYPES.has(type)) {
    builder.appendBoundary(position);
    return;
  }
  let childPosition = position + 1;
  for (const child of Array.isArray(node?.content) ? node.content : []) {
    appendJsonInline(builder, child, childPosition);
    childPosition += jsonNodeSize(child);
  }
}

function collectJsonBlocks(node, position, path, blocks, isRoot = false) {
  const type = nodeTypeName(node);
  if (EXCLUDED_BLOCK_TYPES.has(type)) return;
  if (!isRoot && isJsonTextBlock(node)) {
    const size = jsonNodeSize(node);
    const builder = createBlockBuilder({
      key: `json:${path.join(".")}:${position}`,
      type,
      from: position + 1,
      to: Math.max(position + 1, position + size - 1),
    });
    let childPosition = position + 1;
    for (const child of Array.isArray(node?.content) ? node.content : []) {
      appendJsonInline(builder, child, childPosition);
      childPosition += jsonNodeSize(child);
    }
    blocks.push(builder.finish());
    return;
  }
  let childPosition = isRoot ? 0 : position + 1;
  (Array.isArray(node?.content) ? node.content : []).forEach((child, index) => {
    collectJsonBlocks(child, childPosition, [...path, index], blocks, false);
    childPosition += jsonNodeSize(child);
  });
}

export function collectCheckableTextBlocks(doc) {
  if (!doc) return [];
  const blocks = [];
  if (typeof doc.descendants === "function") {
    doc.descendants((node, position, _parent, index) => {
      const type = nodeTypeName(node);
      if (EXCLUDED_BLOCK_TYPES.has(type)) return false;
      if (node.isTextblock) {
        blocks.push(pmTextBlock(node, position, index));
        return false;
      }
      return true;
    });
    return blocks;
  }
  collectJsonBlocks(doc, 0, [], blocks, true);
  return blocks;
}

function isWordCharacter(value) {
  return Boolean(value) && /[\p{L}\p{N}_]/u.test(value);
}

function wholeWordMatch(text, from, length) {
  const before = from > 0 ? text[from - 1] : "";
  const after = from + length < text.length ? text[from + length] : "";
  return !isWordCharacter(before) && !isWordCharacter(after);
}

function issueId(ruleId, from, to, actual) {
  return `${ruleId}:${from}:${to}:${encodeURIComponent(actual)}`;
}

function blockIntersectsRanges(block, ranges) {
  if (!Array.isArray(ranges) || !ranges.length) return true;
  return ranges.some((range) => {
    const from = Math.max(0, Number(range?.from) || 0);
    const to = Math.max(from, Number(range?.to) || from);
    return from <= block.to && to >= block.from;
  });
}

function matchRuleInBlock(block, rule) {
  const issues = [];
  const needle = rule.caseSensitive ? rule.incorrect : rule.incorrect.toLocaleLowerCase();
  const haystack = rule.caseSensitive ? block.searchText : block.searchText.toLocaleLowerCase();
  let cursor = 0;
  while (cursor <= haystack.length - needle.length) {
    const offset = haystack.indexOf(needle, cursor);
    if (offset < 0) break;
    cursor = offset + Math.max(1, needle.length);
    if (rule.wholeWord && !wholeWordMatch(block.searchText, offset, needle.length)) continue;
    const start = block.positions[offset];
    const last = block.positions[offset + needle.length - 1];
    if (!Number.isInteger(start) || !Number.isInteger(last)) continue;
    const actual = block.plainText.slice(offset, offset + needle.length);
    const from = start;
    const to = last + 1;
    const contextStart = Math.max(0, offset - 24);
    const contextEnd = Math.min(block.plainText.length, offset + needle.length + 24);
    issues.push(Object.freeze({
      id: issueId(rule.id, from, to, actual),
      kind: rule.kind === "spelling" ? "spelling" : "terminology",
      ruleId: rule.id,
      from,
      to,
      actual,
      preferred: rule.preferred,
      description: rule.description,
      blockKey: block.key,
      blockFrom: block.from,
      blockTo: block.to,
      context: block.plainText.slice(contextStart, contextEnd).replace(/\ufffc/g, ""),
      contextOffset: offset - contextStart,
    }));
  }
  return issues;
}

export function scanWritingIssues({
  doc,
  config = DEFAULT_WRITING_ASSISTANCE_CONFIG,
  ranges = null,
} = {}) {
  const normalizedConfig = normalizeWritingAssistanceConfig(config);
  if (!normalizedConfig.enabled) return [];
  const spellingRules = normalizedConfig.languages.includes("zh-CN")
    ? ZH_CN_COMMON_TYPO_RULES
    : [];
  const terminologyRules = normalizedConfig.terminologyRules.filter((rule) => rule.enabled);
  const rules = [...spellingRules, ...terminologyRules];
  if (!rules.length) return [];
  const whitelist = new Set(normalizedConfig.customWords.map((word) => word.toLocaleLowerCase()));
  const issues = [];
  for (const block of collectCheckableTextBlocks(doc)) {
    if (!blockIntersectsRanges(block, ranges)) continue;
    for (const rule of rules) {
      const matches = matchRuleInBlock(block, rule);
      if (rule.kind === "spelling") {
        issues.push(...matches.filter((issue) => !whitelist.has(issue.actual.toLocaleLowerCase())));
      } else {
        issues.push(...matches);
      }
    }
  }
  const uniqueIssues = issues.filter((issue, index, values) => values.findIndex((candidate) => (
    candidate.from === issue.from
    && candidate.to === issue.to
    && candidate.actual === issue.actual
    && candidate.preferred === issue.preferred
  )) === index);
  return uniqueIssues.sort((left, right) => (
    left.from - right.from
    || left.to - right.to
    || left.ruleId.localeCompare(right.ruleId)
  ));
}

export function mergeChangedRanges(ranges) {
  const sorted = (Array.isArray(ranges) ? ranges : [])
    .map((range) => {
      const from = Math.max(0, Number(range?.from) || 0);
      const to = Math.max(from, Number(range?.to) || from);
      return { from, to };
    })
    .sort((left, right) => left.from - right.from || left.to - right.to);
  const merged = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.from <= previous.to + 1) previous.to = Math.max(previous.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

export function changedRangesFromTransaction(transaction) {
  if (!transaction?.docChanged) return [];
  const ranges = [];
  const maps = transaction.mapping?.maps || [];
  for (const stepMap of maps) {
    if (typeof stepMap?.forEach !== "function") continue;
    stepMap.forEach((_oldFrom, _oldTo, newFrom, newTo) => {
      ranges.push({ from: Math.max(0, newFrom - 1), to: newTo + 1 });
    });
  }
  if (!ranges.length) {
    const size = Number(transaction.doc?.content?.size || 0);
    return [{ from: 0, to: size + 2 }];
  }
  return mergeChangedRanges(ranges);
}

export function rangesForAffectedBlocks(doc, ranges) {
  const affected = collectCheckableTextBlocks(doc)
    .filter((block) => blockIntersectsRanges(block, ranges))
    .map((block) => ({ from: block.from, to: block.to }));
  return mergeChangedRanges(affected.length ? affected : ranges);
}

export function issueIntersectsRanges(issue, ranges) {
  return blockIntersectsRanges({
    from: Number(issue?.from) || 0,
    to: Number(issue?.to) || Number(issue?.from) || 0,
  }, ranges);
}

export function mapWritingIssue(issue, mapping) {
  if (!issue || typeof mapping?.mapResult !== "function") return issue || null;
  const mappedFrom = mapping.mapResult(issue.from, 1);
  const mappedTo = mapping.mapResult(issue.to, -1);
  if (mappedFrom.deletedAcross || mappedTo.deletedAcross || mappedTo.pos <= mappedFrom.pos) return null;
  const from = mappedFrom.pos;
  const to = mappedTo.pos;
  return Object.freeze({
    ...issue,
    id: issueId(issue.ruleId, from, to, issue.actual),
    from,
    to,
    blockFrom: mapping.map(issue.blockFrom, 1),
    blockTo: mapping.map(issue.blockTo, -1),
  });
}

export function dedupeReplacementIssues(issues) {
  const sorted = (Array.isArray(issues) ? issues : [])
    .filter((issue) => (
      Number.isInteger(issue?.from)
      && Number.isInteger(issue?.to)
      && issue.to > issue.from
      && typeof issue.preferred === "string"
    ))
    .sort((left, right) => right.from - left.from || right.to - left.to);
  const accepted = [];
  for (const issue of sorted) {
    if (accepted.some((other) => issue.to > other.from && issue.from < other.to)) continue;
    accepted.push(issue);
  }
  return accepted;
}

export function applyReplacementTransaction(editor, issues) {
  const replacements = dedupeReplacementIssues(issues);
  if (!editor?.state?.tr || !editor?.view?.dispatch || !replacements.length) return false;
  let transaction = editor.state.tr;
  for (const issue of replacements) {
    const currentText = editor.state.doc?.textBetween?.(issue.from, issue.to, "\0", "\0");
    if (typeof currentText === "string" && currentText !== issue.actual) continue;
    transaction = transaction.insertText(issue.preferred, issue.from, issue.to);
  }
  if (!transaction.docChanged) return false;
  transaction.setMeta?.("writingAssistance", {
    action: replacements.length > 1 ? "replace-all" : "replace-once",
    addToHistory: true,
  });
  editor.view.dispatch(transaction.scrollIntoView?.() || transaction);
  return true;
}
