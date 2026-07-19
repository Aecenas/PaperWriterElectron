import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const preload = fs.readFileSync(new URL("../../electron/preload.cjs", import.meta.url), "utf8");
const main = fs.readFileSync(new URL("../../electron/main.cjs", import.meta.url), "utf8");

test("export selection remembers only the last directory and forwards it to the native picker", () => {
  assert.match(app, /EXPORT_LAST_DIRECTORY_STORAGE_KEY = "paperwriter\.exportLastDirectory"/);
  assert.match(app, /pickExportPath\?\.\(format, documentTitle, loadRememberedExportDirectory\(\)\)/);
  assert.match(app, /rememberExportDirectory\(result\.directory\)/);
  assert.match(preload, /pickExportPath: \(format, suggestedName, initialDirectory\)/);
  assert.match(preload, /initialDirectory\.slice\(0, 32768\)/);
});

test("native export pickers reuse an existing directory but generate the current letter filename", () => {
  assert.match(main, /async function existingExportPickerDirectory/);
  assert.match(main, /stats\.isDirectory\(\) \? candidate : ""/);
  assert.match(main, /path\.join\(baseDirectory, `\$\{exportSafeName\(suggestedName\)\}\$\{extension\}`\)/);
  assert.match(main, /path\.join\(rememberedDirectory \|\| defaultDocumentsDir\(\), `\$\{safeName\}\.pdf`\)/);
  assert.match(main, /directory: path\.dirname\(targetPath\)/);
  assert.match(main, /directory: targetPath, format: "images"/);
});
