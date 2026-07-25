import { getResearchEntryKey } from "../research-ui-model.js";

export function itemIdentity(item) {
  return String(item?.id || item?.sourceId || getResearchEntryKey(item) || item?.url || "");
}

export function normalizePdfBytes(payload) {
  const bytes = payload?.bytes ?? payload;
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (Array.isArray(bytes)) return new Uint8Array(bytes);
  return null;
}
