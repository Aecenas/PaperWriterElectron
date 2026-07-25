import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  EXPORT_LAST_DIRECTORY_STORAGE_KEY,
  loadRememberedExportDirectory,
  normalizeRememberedExportDirectory,
  rememberExportDirectory,
} from "./export/export-directory-memory.js";
import { clearSafeStorageMemoryForTests } from "./safe-storage.js";

const exportDialog = fs.readFileSync(new URL("./export/ExportDialog.jsx", import.meta.url), "utf8");
const preload = fs.readFileSync(new URL("../../electron/preload.cjs", import.meta.url), "utf8");
const exportRuntime = fs.readFileSync(new URL("../../electron/export-runtime.cjs", import.meta.url), "utf8");

test("export directory preference normalizes and persists only safe directory values", () => {
  const originalWindow = globalThis.window;
  const values = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    },
  };
  clearSafeStorageMemoryForTests();

  try {
    assert.equal(normalizeRememberedExportDirectory("  C:\\Letters\\2026  "), "C:\\Letters\\2026");
    assert.equal(normalizeRememberedExportDirectory("C:\\bad\u0000path"), "");
    assert.equal(normalizeRememberedExportDirectory("x".repeat(32769)), "");

    rememberExportDirectory("  C:\\Letters\\2026  ");
    assert.equal(loadRememberedExportDirectory(), "C:\\Letters\\2026");
    assert.equal(values.get(EXPORT_LAST_DIRECTORY_STORAGE_KEY), "C:\\Letters\\2026");

    rememberExportDirectory("");
    assert.equal(loadRememberedExportDirectory(), "C:\\Letters\\2026");
  } finally {
    clearSafeStorageMemoryForTests();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("export dialog forwards the remembered directory and stores the native picker result", () => {
  assert.match(exportDialog, /pickExportPath\?\.\(format, documentTitle, loadRememberedExportDirectory\(\)\)/);
  assert.match(exportDialog, /rememberExportDirectory\(result\.directory\)/);
  assert.match(preload, /pickExportPath: \(format, suggestedName, initialDirectory\)/);
  assert.match(preload, /initialDirectory\.slice\(0, 32768\)/);
});

test("native export pickers reuse an existing directory but generate the current letter filename", () => {
  assert.match(exportRuntime, /async function existingExportPickerDirectory/);
  assert.match(exportRuntime, /stats\.isDirectory\(\) \? candidate : ""/);
  assert.match(
    exportRuntime,
    /path\.join\(\s*baseDirectory,\s*`\$\{exportSafeName\(suggestedName\)\}\$\{extension\}`/,
  );
  assert.match(
    exportRuntime,
    /path\.join\(\s*rememberedDirectory \|\| defaultDocumentsDir\(\),\s*`\$\{safeName\}\.pdf`/,
  );
  assert.match(exportRuntime, /directory: path\.dirname\(targetPath\)/);
  assert.match(
    exportRuntime,
    /directory: targetPath,[\s\S]*format: "images"/,
  );
});
