import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyTemplateToTabTransaction,
  deleteUserTemplateTransaction,
} from "./controllers/templates.js";
import { DEFAULT_LETTER_TEMPLATES } from "./templates/model.js";

const appSource = fs.readFileSync(fileURLToPath(new URL("./App.jsx", import.meta.url)), "utf8");
const controllerSource = fs.readFileSync(fileURLToPath(new URL("./controllers/templates.js", import.meta.url)), "utf8");
const dialogSource = fs.readFileSync(fileURLToPath(new URL("./templates/LetterTemplateDialog.jsx", import.meta.url)), "utf8");
const detailSource = fs.readFileSync(fileURLToPath(new URL("./templates/TemplateDetailView.jsx", import.meta.url)), "utf8");
const groupBrowserSource = fs.readFileSync(fileURLToPath(new URL("./templates/TemplateGroupBrowser.jsx", import.meta.url)), "utf8");

test("template application targets a tab snapshot without changing the active tab", () => {
  const currentTemplate = DEFAULT_LETTER_TEMPLATES[0];
  const nextTemplate = DEFAULT_LETTER_TEMPLATES[1];
  const activeDocument = {
    title: "活动信笺",
    letterTemplateId: currentTemplate.id,
    templateId: currentTemplate.paperId,
  };
  const targetDocument = {
    title: "目标信笺",
    letterTemplateId: currentTemplate.id,
    templateId: currentTemplate.paperId,
  };
  const snapshot = [
    { id: "active", title: "活动信笺", document: activeDocument, dirty: false },
    { id: "target", title: "目标信笺", document: targetDocument, dirty: false },
  ];
  const activeTabIdRef = { current: "active" };
  const documentStateRef = { current: activeDocument };
  const openTabsRef = { current: snapshot };
  const snapshotOptions = [];
  const openTabsCommits = [];
  const documentCommits = [];
  const mutations = [];
  const statuses = [];

  const applied = applyTemplateToTabTransaction({
    activeTabIdRef,
    documentStateRef,
    letterTemplateId: nextTemplate.id,
    letterTemplates: DEFAULT_LETTER_TEMPLATES,
    openTabsRef,
    recordTabMutation: (...args) => mutations.push(args),
    setDocumentState: (document) => documentCommits.push(document),
    setOpenTabs: (tabs) => openTabsCommits.push(tabs),
    showStatus: (...args) => statuses.push(args),
    snapshotLiveTabs: (options) => {
      snapshotOptions.push(options);
      return snapshot;
    },
    tabId: "target",
  });

  assert.equal(applied, true);
  assert.deepEqual(snapshotOptions, [{ includeEditorJson: true }]);
  assert.equal(openTabsCommits.length, 1);
  assert.equal(openTabsRef.current, openTabsCommits[0]);
  assert.equal(openTabsRef.current[0], snapshot[0]);
  assert.equal(openTabsRef.current[1].document.letterTemplateId, nextTemplate.id);
  assert.equal(openTabsRef.current[1].dirty, true);
  assert.equal(documentStateRef.current, activeDocument);
  assert.deepEqual(documentCommits, []);
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0][0], "target");
  assert.match(statuses.at(-1)[0], /已为“目标信笺”使用/);

  const readOnlyResult = applyTemplateToTabTransaction({
    activeTabIdRef,
    documentStateRef,
    letterTemplateId: nextTemplate.id,
    letterTemplates: DEFAULT_LETTER_TEMPLATES,
    openTabsRef,
    recordTabMutation: (...args) => mutations.push(args),
    setDocumentState: (document) => documentCommits.push(document),
    setOpenTabs: (tabs) => openTabsCommits.push(tabs),
    showStatus: (...args) => statuses.push(args),
    snapshotLiveTabs: () => [
      snapshot[0],
      { ...snapshot[1], readOnly: true },
    ],
    tabId: "target",
  });
  assert.equal(readOnlyResult, false);
  assert.equal(openTabsCommits.length, 1);
  assert.match(statuses.at(-1)[0], /只读/);
});

test("group tabs open a dedicated picker that applies to the target tab", () => {
  assert.match(appSource, /useTemplateTabDialogState\(\)/);
  assert.equal((appSource.match(/onOpenTemplatePicker=\{handleOpenGroupTabTemplate\}/g) || []).length, 3);
  assert.match(controllerSource, /setTabTemplateDialog\(\{ open: true, targetTabId: view\.tabId \}\)/);
  assert.match(appSource, /mode="select"/);
  assert.match(appSource, /returnFocusRef=\{tabTemplateReturnFocusRef\}/);
  assert.match(appSource, /document=\{tabTemplateDocument\}/);
  assert.match(controllerSource, /handleApplyTabTemplate\(tabTemplateTargetTabId, letterTemplateId\)/);
  assert.doesNotMatch(appSource, /templateOptions=\{tabTemplateOptions\}/);
  assert.doesNotMatch(appSource, /onApplyTemplate=\{handleApplyGroupTabTemplate\}/);
});

test("template selection and global management modes start in the gallery", () => {
  assert.match(dialogSource, /const manageOnly = mode === "manage"/);
  assert.match(dialogSource, /const selectionOnly = mode === "select"/);
  assert.match(dialogSource, /useState\(\(\) => \(selectionOnly \|\| manageOnly \? "" : selectedLetterTemplate\.id\)\)/);
  assert.match(dialogSource, /manageOnly \? SYSTEM_TEMPLATE_GROUPS\[0\]\.id : getLetterTemplateGroupId\(selectedLetterTemplate\)/);
  assert.match(appSource, /mode="manage"[\s\S]*?document=\{\{ letterTemplateId: newDocumentTemplateId \}\}/);
  assert.match(dialogSource, /aria-label=\{selectionOnly \? "选择模板"/);
  assert.match(detailSource, /\{!selectionOnly \? \(\s*<>\s*<button[\s\S]*?template-create-from-button/s);
  assert.match(groupBrowserSource, /\{!selectionOnly && letterTemplate\.userTemplate \? \(/);
  assert.match(groupBrowserSource, /\{!selectionOnly && selectedUserGroup && selectedGroupTemplates\.length \? \(/);
});

test("deleting a user template repairs every open tab that used it", () => {
  const documentFallback = DEFAULT_LETTER_TEMPLATES[0];
  const historyFallback = DEFAULT_LETTER_TEMPLATES[1];
  const userTemplate = {
    ...documentFallback,
    id: "user-deleted-template",
    label: "待删除模板",
    userTemplate: true,
  };
  const activeDocument = {
    title: "活动信笺",
    letterTemplateId: userTemplate.id,
    templateId: userTemplate.paperId,
  };
  const secondaryDocument = {
    title: "右侧信笺",
    letterTemplateId: userTemplate.id,
    templateId: userTemplate.paperId,
  };
  const snapshot = [
    { id: "active", title: "活动信笺", document: activeDocument, dirty: false },
    { id: "secondary", title: "右侧信笺", document: secondaryDocument, dirty: false },
  ];
  const activeTabIdRef = { current: "active" };
  const documentStateRef = { current: activeDocument };
  const openTabsRef = { current: snapshot };
  const calls = [];
  const committedTabs = [];
  const committedDocuments = [];
  const mutations = [];
  let userTemplates = [userTemplate];
  let history = [historyFallback.id];
  let defaultTemplateId = userTemplate.id;

  deleteUserTemplateTransaction({
    activeTabIdRef,
    documentStateRef,
    letterTemplates: [...DEFAULT_LETTER_TEMPLATES, userTemplate],
    newDocumentTemplateHistory: history,
    newDocumentTemplateId: defaultTemplateId,
    openTabsRef,
    recordTabMutation: (tabId, updatedAt) => {
      calls.push(`mutation:${tabId}`);
      mutations.push([tabId, updatedAt]);
    },
    setDocumentState: (document) => {
      calls.push("active-document");
      committedDocuments.push(document);
    },
    setNewDocumentTemplateHistory: (nextHistory) => {
      calls.push("history");
      history = nextHistory;
    },
    setNewDocumentTemplateId: (templateId) => {
      calls.push("default");
      defaultTemplateId = templateId;
    },
    setOpenTabs: (tabs) => {
      calls.push("open-tabs");
      committedTabs.push(tabs);
    },
    setUserLetterTemplates: (updater) => {
      calls.push("user-templates");
      userTemplates = updater(userTemplates);
    },
    showStatus: () => calls.push("status"),
    snapshotLiveTabs: (options) => {
      calls.push("snapshot");
      assert.deepEqual(options, { includeEditorJson: true });
      return snapshot;
    },
    templateId: userTemplate.id,
    userLetterTemplates: [userTemplate],
  });

  assert.deepEqual(calls, [
    "user-templates",
    "history",
    "default",
    "snapshot",
    "open-tabs",
    "active-document",
    "mutation:active",
    "mutation:secondary",
    "status",
  ]);
  assert.deepEqual(userTemplates, []);
  assert.deepEqual(history, []);
  assert.equal(defaultTemplateId, historyFallback.id);
  assert.equal(committedTabs.length, 1);
  assert.equal(openTabsRef.current, committedTabs[0]);
  assert.ok(committedTabs[0].every((tab) => (
    tab.dirty && tab.document.letterTemplateId === documentFallback.id
  )));
  assert.equal(documentStateRef.current, committedDocuments[0]);
  assert.deepEqual(mutations.map(([tabId]) => tabId), ["active", "secondary"]);
  assert.equal(mutations[0][1], mutations[1][1]);
});
