import { createEmojiCatalog } from "./catalog.js";

let catalogPromise = null;

function importEmojiDatasets() {
  if (typeof window === "undefined") {
    const nodeLoaderPath = ["./data", "node.js"].join(".");
    return import(/* @vite-ignore */ nodeLoaderPath)
      .then(({ importEmojiDatasetsForNode }) => importEmojiDatasetsForNode());
  }
  return Promise.all([
    import("emojibase-data/zh/compact.json"),
    import("emojibase-data/en/compact.json"),
  ]);
}

export function loadEmojiCatalog() {
  if (!catalogPromise) {
    catalogPromise = importEmojiDatasets().then(([chinese, english]) => createEmojiCatalog(
      chinese.default || chinese,
      english.default || english,
    )).catch((error) => {
      catalogPromise = null;
      throw error;
    });
  }
  return catalogPromise;
}

export function resetEmojiCatalogForTests() {
  catalogPromise = null;
}
