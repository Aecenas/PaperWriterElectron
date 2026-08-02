import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("profile migration UI keeps secrets opt-in with two password fields and section preview", async () => {
  const source = await readFile(new URL("./ProfileMigrationPanel.jsx", import.meta.url), "utf8");
  assert.match(source, /includeSecrets/);
  assert.match(source, /passphrase\.length >= 12/);
  assert.match(source, /passphrase === confirmation/);
  assert.match(source, /preview\?\.includesSecrets/);
  assert.match(source, /currentPreferences: preferences/);
  assert.match(source, /currentTemplates: templates/);
  assert.match(source, /applyPreparedProfileImport/);
});
