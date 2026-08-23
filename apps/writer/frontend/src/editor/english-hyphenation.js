import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import englishHyphenation from "hyphen/en-us/index.js";

const { hyphenateSync } = englishHyphenation;
const SOFT_HYPHEN = "\u00ad";
const ENGLISH_WORD_PATTERN = /[A-Za-z\u00ad]{5,}/g;
const HYPHENATION_CACHE_LIMIT = 4096;
const hyphenationCache = new Map();

export const ENGLISH_HYPHENATION_PLUGIN_KEY = new PluginKey("paperEnglishHyphenation");

function cacheHyphenation(word, offsets) {
  if (hyphenationCache.size >= HYPHENATION_CACHE_LIMIT) {
    hyphenationCache.delete(hyphenationCache.keys().next().value);
  }
  hyphenationCache.set(word, offsets);
  return offsets;
}

export function englishHyphenationBreakOffsets(word) {
  const value = String(word || "");
  if (value.length < 5 || value.includes(SOFT_HYPHEN) || !/^[A-Za-z]+$/.test(value)) {
    return [];
  }

  const cacheKey = value.toLowerCase();
  const cached = hyphenationCache.get(cacheKey);
  if (cached) return cached;

  const hyphenated = hyphenateSync(cacheKey, {
    html: false,
    minWordLength: 5,
  });
  const offsets = [];
  let sourceOffset = 0;
  for (const character of hyphenated) {
    if (character === SOFT_HYPHEN) {
      if (sourceOffset > 1 && sourceOffset < value.length - 1) {
        offsets.push(sourceOffset);
      }
    } else {
      sourceOffset += 1;
    }
  }

  return cacheHyphenation(cacheKey, offsets);
}

function textNodeAllowsHyphenation(node, parent) {
  if (!node?.isText || parent?.type?.name !== "paragraph") return false;
  return !node.marks?.some((mark) => mark.type.name === "code" || mark.type.name === "link");
}

export function buildEnglishHyphenationDecorationSet(doc) {
  const decorations = [];
  doc.descendants((node, position, parent) => {
    if (!textNodeAllowsHyphenation(node, parent)) return;

    for (const match of node.text.matchAll(ENGLISH_WORD_PATTERN)) {
      const word = match[0];
      for (const offset of englishHyphenationBreakOffsets(word)) {
        const breakPosition = position + match.index + offset;
        decorations.push(Decoration.inline(
          breakPosition - 1,
          breakPosition,
          { class: "paper-english-hyphenation-point" },
          { inclusiveStart: false, inclusiveEnd: false },
        ));
      }
    }
  });
  return DecorationSet.create(doc, decorations);
}

export const EnglishHyphenationDecorations = Extension.create({
  name: "paperEnglishHyphenationDecorations",

  addProseMirrorPlugins() {
    return [new Plugin({
      key: ENGLISH_HYPHENATION_PLUGIN_KEY,
      state: {
        init: (_, state) => buildEnglishHyphenationDecorationSet(state.doc),
        apply: (transaction, previous) => (
          transaction.docChanged
            ? buildEnglishHyphenationDecorationSet(transaction.doc)
            : previous.map(transaction.mapping, transaction.doc)
        ),
      },
      props: {
        decorations(state) {
          return ENGLISH_HYPHENATION_PLUGIN_KEY.getState(state);
        },
      },
    })];
  },
});
