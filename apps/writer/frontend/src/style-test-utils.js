import { readFile, readFileSync } from "node:fs";

export const APP_STYLE_FRAGMENT_NAMES = Object.freeze([
  "styles-foundation.css",
  "styles-sidebar-templates.css",
  "styles-workspace-dialogs.css",
  "styles-data-safety.css",
  "styles-editor-paper.css",
  "styles-pagination.css",
  "styles-professional-content.css",
  "styles-ai.css",
  "styles-ai-composition.css",
  "styles-status-export-help.css",
  "styles-output-responsive.css",
]);

const STYLE_IMPORT_PATTERN = /^\s*@import\s+["']\.\/([^"']+)["'];\s*$/gm;

function fragmentNamesFromEntry(entrySource) {
  return [...entrySource.matchAll(STYLE_IMPORT_PATTERN)].map((match) => match[1]);
}

function assertStyleEntry(entrySource) {
  const fragmentNames = fragmentNamesFromEntry(entrySource);
  if (JSON.stringify(fragmentNames) !== JSON.stringify(APP_STYLE_FRAGMENT_NAMES)) {
    throw new Error(`Unexpected application style order: ${fragmentNames.join(", ")}`);
  }
  const declarationsOutsideImports = entrySource.replace(STYLE_IMPORT_PATTERN, "").trim();
  if (declarationsOutsideImports) {
    throw new Error("styles.css must remain an import-only cascade entry");
  }
  return fragmentNames;
}

export function readAppStylesSync() {
  const entrySource = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  return assertStyleEntry(entrySource)
    .map((fragmentName) => readFileSync(new URL(`./${fragmentName}`, import.meta.url), "utf8"))
    .join("");
}

export async function readAppStyles() {
  const entrySource = await new Promise((resolve, reject) => {
    readFile(new URL("./styles.css", import.meta.url), "utf8", (error, source) => {
      if (error) reject(error);
      else resolve(source);
    });
  });
  const fragments = await Promise.all(assertStyleEntry(entrySource).map((fragmentName) => (
    new Promise((resolve, reject) => {
      readFile(new URL(`./${fragmentName}`, import.meta.url), "utf8", (error, source) => {
        if (error) reject(error);
        else resolve(source);
      });
    })
  )));
  return fragments.join("");
}
