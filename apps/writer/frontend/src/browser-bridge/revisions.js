import { readJson, writeJson } from "./storage.js";

async function browserDiskRevision(documentValue) {
  const serialized = JSON.stringify(documentValue ?? null);
  const bytes = new TextEncoder().encode(serialized);
  let sha256 = "";
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } else {
    let hash = 0x811c9dc5;
    bytes.forEach((byte) => { hash ^= byte; hash = Math.imul(hash, 0x01000193); });
    sha256 = (hash >>> 0).toString(16).padStart(8, "0").repeat(8);
  }
  return { size: bytes.byteLength, mtimeMs: Date.now(), sha256 };
}

function sameBrowserRevision(left, right) {
  return Boolean(left && right)
    && Number(left.size) === Number(right.size)
    && Number(left.mtimeMs) === Number(right.mtimeMs)
    && String(left.sha256 || "") === String(right.sha256 || "");
}

function browserRevisionMap() {
  const value = readJson("paperwriter.preview.revisions", {});
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function storeBrowserRevision(filePath, revision) {
  const revisions = browserRevisionMap();
  revisions[String(filePath || "browser-preview.letterpaper").slice(0, 2048)] = revision;
  writeJson("paperwriter.preview.revisions", revisions);
}

export {
  browserDiskRevision,
  browserRevisionMap,
  sameBrowserRevision,
  storeBrowserRevision,
};
