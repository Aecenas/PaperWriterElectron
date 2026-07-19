import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const css = fs.readFileSync(
  fileURLToPath(new URL("./workspace-features.css", import.meta.url)),
  "utf8",
);
const appSource = fs.readFileSync(
  fileURLToPath(new URL("./App.jsx", import.meta.url)),
  "utf8",
);

test("immersive mode removes window chrome without removing the writing workspace", () => {
  assert.match(
    css,
    /\.desktop-shell\.immersive-mode\{[^}]*height:100vh[^}]*grid-template-rows:0 auto minmax\(0,1fr\) 0/,
  );
  assert.match(
    css,
    /\.desktop-shell\.immersive-mode \.app-shell\{[^}]*height:100%[^}]*grid-row:3/,
  );
  assert.match(
    css,
    /\.immersive-mode \.desktop-titlebar,\.immersive-mode \.statusbar\{display:none!important\}/,
  );
  assert.match(
    css,
    /\.desktop-shell\.immersive-mode \.top-nav\{grid-row:2\}/,
  );
  assert.match(
    css,
    /\.desktop-shell\.immersive-mode \.app-shell:not\(\.left-collapsed\)\{grid-template-columns:330px minmax\(0,1fr\)\}/,
  );
  assert.match(
    css,
    /\.desktop-shell\.immersive-mode \.left-sidebar\{display:grid\}/,
  );
  for (const selector of ["left-sidebar", "document-tabs", "right-split-pane", "auxiliary-dock"]) {
    assert.doesNotMatch(
      css,
      new RegExp(`\\.immersive-mode [^{]*${selector}[^}]*\\{[^}]*display:none`),
    );
  }
  assert.doesNotMatch(
    appSource,
    /immersiveNavVisible|immersiveNavTimerRef|restoreImmersiveLayout/,
  );
});
