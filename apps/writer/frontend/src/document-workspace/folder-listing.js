import { bridge } from "../bridge.js";

export const FOLDER_LIST_TIMEOUT_MS = 8000;

export function listFolderWithTimeout(folderPath) {
  let timer = 0;
  const startedAt = Date.now();
  bridge.debugLog?.("renderer:list-folder:start", { folderPath });
  const timeout = new Promise((resolve) => {
    timer = window.setTimeout(() => {
      bridge.debugLog?.("renderer:list-folder:timeout", {
        folderPath,
        ms: Date.now() - startedAt,
      });
      resolve({
        canceled: true,
        timedOut: true,
        folderPath,
        files: [],
        folders: [],
        entries: [],
      });
    }, FOLDER_LIST_TIMEOUT_MS);
  });
  return Promise.race([bridge.listFolder(folderPath), timeout])
    .then((result) => {
      bridge.debugLog?.("renderer:list-folder:done", {
        folderPath,
        ms: Date.now() - startedAt,
        canceled: Boolean(result?.canceled),
        timedOut: Boolean(result?.timedOut),
        folders: result?.folders?.length || 0,
        files: result?.files?.length || 0,
      });
      return result;
    })
    .finally(() => {
      window.clearTimeout(timer);
    });
}
