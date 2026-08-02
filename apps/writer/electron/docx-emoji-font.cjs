const EMOJI_FONT = "Segoe UI Emoji";
const EMOJI_GRAPHEME_PATTERN =
  /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3\ufe0f]/u;

function segmentDocxTextByEmojiFont(value, {
  emojiFont = EMOJI_FONT,
  segmenter = typeof Intl?.Segmenter === "function"
    ? new Intl.Segmenter("und", { granularity: "grapheme" })
    : null,
} = {}) {
  const text = String(value || "");
  if (!text) return [];
  const graphemes = segmenter
    ? [...segmenter.segment(text)].map((entry) => entry.segment)
    : Array.from(text);
  const chunks = [];
  for (const grapheme of graphemes) {
    const font = EMOJI_GRAPHEME_PATTERN.test(grapheme)
      ? emojiFont
      : "";
    const previous = chunks.at(-1);
    if (previous?.font === font) {
      previous.text += grapheme;
    } else {
      chunks.push({ text: grapheme, font });
    }
  }
  return chunks;
}

module.exports = {
  EMOJI_FONT,
  segmentDocxTextByEmojiFont,
};
