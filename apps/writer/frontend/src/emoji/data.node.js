export function importEmojiDatasetsForNode() {
  return Promise.all([
    import("emojibase-data/zh/compact.json", { with: { type: "json" } }),
    import("emojibase-data/en/compact.json", { with: { type: "json" } }),
  ]);
}
