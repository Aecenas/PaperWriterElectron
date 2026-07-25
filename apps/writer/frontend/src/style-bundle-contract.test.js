import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  APP_STYLE_FRAGMENT_NAMES,
  readAppStyles,
} from "./style-test-utils.js";

const PRE_MODULARIZATION_CASCADE_SHA256 = "13886e06bcf6194f385039374ec9e8c2e63bc5c466528b79fdd7297ae1eeaa76";

test("the single application style entry preserves the explicit cascade order", async () => {
  const entrySource = await readFile(new URL("./styles.css", import.meta.url), "utf8");
  assert.equal(
    entrySource,
    `${APP_STYLE_FRAGMENT_NAMES.map((name) => `@import "./${name}";`).join("\n")}\n`,
  );
});

test("the modular style fragments preserve the pre-refactor cascade text and order", async () => {
  const cascade = (await readAppStyles()).replace(/\r\n?/g, "\n");
  assert.equal(
    createHash("sha256").update(cascade).digest("hex"),
    PRE_MODULARIZATION_CASCADE_SHA256,
  );
});
