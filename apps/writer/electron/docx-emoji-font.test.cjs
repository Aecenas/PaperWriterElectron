const assert = require("node:assert/strict");
const test = require("node:test");
const {
  EMOJI_FONT,
  segmentDocxTextByEmojiFont,
} = require("./docx-emoji-font.cjs");

test("keeps complete Unicode emoji graphemes in Segoe UI Emoji runs", () => {
  const family = "👨‍👩‍👧‍👦";
  const skinTone = "👍🏽";
  const flag = "🇨🇳";
  const keycap = "1️⃣";
  const chunks = segmentDocxTextByEmojiFont(
    `正文 ${family}${skinTone}${flag}${keycap} 结尾`,
  );
  assert.deepEqual(chunks, [
    { text: "正文 ", font: "" },
    {
      text: `${family}${skinTone}${flag}${keycap}`,
      font: EMOJI_FONT,
    },
    { text: " 结尾", font: "" },
  ]);
});

test("does not fragment ordinary surrogate-pair text into emoji runs", () => {
  assert.deepEqual(segmentDocxTextByEmojiFont("A𝑥B"), [
    { text: "A𝑥B", font: "" },
  ]);
});

test("allows the DOCX layer to provide a different emoji font", () => {
  assert.deepEqual(segmentDocxTextByEmojiFont("a😀b", {
    emojiFont: "Emoji Test",
  }), [
    { text: "a", font: "" },
    { text: "😀", font: "Emoji Test" },
    { text: "b", font: "" },
  ]);
});
