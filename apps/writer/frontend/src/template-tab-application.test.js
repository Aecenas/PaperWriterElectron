import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appSource = fs.readFileSync(fileURLToPath(new URL("./App.jsx", import.meta.url)), "utf8");

test("template application targets a tab snapshot without changing the active tab", () => {
  const handler = appSource.match(/const handleApplyTabTemplate = useCallback\([\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || "";
  assert.match(handler, /snapshotLiveTabs\(\{ includeEditorJson: true \}\)/);
  assert.match(handler, /targetTab\.readOnly \|\| sourceDocument\._readOnlyFutureSchema/);
  assert.match(handler, /openTabsRef\.current = nextTabs/);
  assert.match(handler, /documentStateRef\.current = nextDocument/);
  assert.match(handler, /recordTabMutation\(tabId, updatedAt\)/);
  assert.doesNotMatch(handler, /handleSelectTab/);
});

test("group tabs open a dedicated picker that applies to the target tab", () => {
  assert.match(appSource, /const \[tabTemplateDialog, setTabTemplateDialog\] = useState/);
  assert.equal((appSource.match(/onOpenTemplatePicker=\{handleOpenGroupTabTemplate\}/g) || []).length, 3);
  assert.match(appSource, /setTabTemplateDialog\(\{ open: true, targetTabId: view\.tabId \}\)/);
  assert.match(appSource, /mode="select"/);
  assert.match(appSource, /returnFocusRef=\{tabTemplateReturnFocusRef\}/);
  assert.match(appSource, /document=\{tabTemplateDocument\}/);
  assert.match(appSource, /handleApplyTabTemplate\(tabTemplateDialog\.targetTabId, letterTemplateId\)/);
  assert.doesNotMatch(appSource, /templateOptions=\{tabTemplateOptions\}/);
  assert.doesNotMatch(appSource, /onApplyTemplate=\{handleApplyGroupTabTemplate\}/);
});

test("template selection and global management modes start in the gallery", () => {
  assert.match(appSource, /const manageOnly = mode === "manage"/);
  assert.match(appSource, /const selectionOnly = mode === "select"/);
  assert.match(appSource, /useState\(\(\) => \(selectionOnly \|\| manageOnly \? "" : selectedLetterTemplate\.id\)\)/);
  assert.match(appSource, /manageOnly \? SYSTEM_TEMPLATE_GROUPS\[0\]\.id : getLetterTemplateGroupId\(selectedLetterTemplate\)/);
  assert.match(appSource, /mode="manage"[\s\S]*?document=\{\{ letterTemplateId: newDocumentTemplateId \}\}/);
  assert.match(appSource, /aria-label=\{selectionOnly \? "选择模板"/);
  assert.match(appSource, /\{!selectionOnly \? \(\s*<>\s*<button[\s\S]*?template-create-from-button/s);
  assert.match(appSource, /\{!selectionOnly && letterTemplate\.userTemplate \? \(/);
  assert.match(appSource, /\{!selectionOnly && selectedUserGroup && selectedGroupTemplates\.length \? \(/);
});

test("deleting a user template repairs every open tab that used it", () => {
  const handler = appSource.match(/const handleDeleteUserTemplate = useCallback\([\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || "";
  assert.match(handler, /snapshotLiveTabs\(\{ includeEditorJson: true \}\)/);
  assert.match(handler, /affectedTabIds/);
  assert.match(handler, /applyLetterTemplateToDocument\(sourceDocument, documentFallback, updatedAt\)/);
  assert.match(handler, /affectedTabIds\.forEach\(\(tabId\) => recordTabMutation/);
});
