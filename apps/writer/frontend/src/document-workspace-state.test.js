import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createDocumentStorePort,
  createDocumentWorkspaceInitialState,
  createGroupStorePort,
  createSessionStatePort,
  useDocumentWorkspaceState,
} from "./document-workspace/workspace-state.js";
import {
  WORKSPACE_GROUP_ID,
  createWorkspaceGroupsState,
} from "./workspace-groups.js";

function ref(current) {
  return { current };
}

test("document workspace initial state preserves the current App defaults", () => {
  const initialSession = {
    activePath: "C:\\letters\\active.letterpaper",
    folderPath: "C:\\letters",
    tabs: [],
  };
  let loadCount = 0;
  const state = createDocumentWorkspaceInitialState({
    loadSession: () => {
      loadCount += 1;
      return initialSession;
    },
    readWorkspaceSplitRatio: () => "0.62",
  });

  assert.equal(loadCount, 1);
  assert.equal(state.initialSession, initialSession);
  assert.equal(state.documentState.title, "未命名信笺");
  assert.equal(state.currentPath, "");
  assert.equal(state.dirty, false);
  assert.equal(state.openTabs.length, 1);
  assert.equal(state.activeTabId, state.openTabs[0].id);
  assert.equal(state.openTabs[0].dirty, false);
  assert.notEqual(state.documentState, state.openTabs[0].document);
  assert.equal(state.workspaceGroups.primary.views[0].tabId, state.activeTabId);
  assert.equal(state.workspaceGroups.primary.activeViewId, `document:${state.activeTabId}`);
  assert.equal(state.workspaceGroups.secondary.views.length, 0);
  assert.equal(state.workspaceGroups.splitRatio, 0.62);
  assert.equal(state.rightSplitTabId, "");
  assert.equal(state.activePane, "main");
});

test("useDocumentWorkspaceState exposes gradual identifiers, mirrors, view, and ports", () => {
  const initialSession = {
    activePath: "",
    folderPath: "D:\\writing",
    tabs: [],
  };
  let workspace;

  function Probe() {
    workspace = useDocumentWorkspaceState({
      loadSession: () => initialSession,
      readWorkspaceSplitRatio: () => 0.58,
      saveSession: () => {},
    });
    return createElement("span", null, workspace.documentState.title);
  }

  assert.equal(renderToStaticMarkup(createElement(Probe)), "<span>未命名信笺</span>");
  assert.equal(workspace.initialSession, initialSession);
  assert.equal(workspace.sessionRef.current, initialSession);
  assert.equal(workspace.sessionRestoredRef.current, false);
  assert.equal(workspace.sessionClosePendingRef.current, false);
  assert.equal(workspace.documentStateRef.current, workspace.documentState);
  assert.equal(workspace.currentPathRef.current, workspace.currentPath);
  assert.equal(workspace.dirtyRef.current, workspace.dirty);
  assert.equal(workspace.openTabsRef.current, workspace.openTabs);
  assert.equal(workspace.activeTabIdRef.current, workspace.activeTabId);
  assert.equal(workspace.workspaceGroupsRef.current, workspace.workspaceGroups);
  assert.equal(workspace.rightSplitTabIdRef.current, workspace.rightSplitTabId);
  assert.equal(workspace.activePaneRef.current, workspace.activePane);
  assert.deepEqual(workspace.view, {
    activePane: "main",
    activeTabId: workspace.activeTabId,
    dirty: false,
    document: workspace.documentState,
    groups: workspace.workspaceGroups,
    path: "",
    rightSplitTabId: "",
    tabs: workspace.openTabs,
  });
  assert.equal(typeof workspace.documentStorePort.commitDocumentState, "function");
  assert.equal(typeof workspace.groupStorePort.commitWorkspaceGroups, "function");
  assert.equal(typeof workspace.sessionStatePort.commitSessionPatch, "function");
  assert.equal(typeof workspace.sessionStatePort.beginClose, "function");
  assert.equal(typeof workspace.setDocumentState, "function");
  assert.equal(typeof workspace.setOpenTabs, "function");
  assert.equal(typeof workspace.setWorkspaceGroups, "function");
  assert.notEqual(workspace.setDocumentState, workspace.documentStorePort.commitDocumentState);
  assert.notEqual(workspace.setOpenTabs, workspace.documentStorePort.commitOpenTabs);
  assert.notEqual(workspace.setWorkspaceGroups, workspace.groupStorePort.commitWorkspaceGroups);
  assert.equal(workspace.persistSession, workspace.sessionStatePort.commitSessionPatch);
});

test("document store commits every mirror before invoking its React setter", () => {
  const documentStateRef = ref({ title: "before" });
  const currentPathRef = ref("before.letterpaper");
  const dirtyRef = ref(false);
  const openTabsRef = ref([{ id: "before" }]);
  const activeTabIdRef = ref("before");
  const setterEvents = [];

  const port = createDocumentStorePort({
    activeTabIdRef,
    currentPathRef,
    dirtyRef,
    documentStateRef,
    openTabsRef,
    setActiveTabId: (next) => setterEvents.push(["active", activeTabIdRef.current === next]),
    setCurrentPath: (next) => setterEvents.push(["path", currentPathRef.current === next]),
    setDirty: (next) => setterEvents.push(["dirty", dirtyRef.current === next]),
    setDocumentState: (next) => setterEvents.push(["document", documentStateRef.current === next]),
    setOpenTabs: (next) => setterEvents.push(["tabs", openTabsRef.current === next]),
  });

  const document = port.commitDocumentState((previous) => ({
    ...previous,
    title: "after",
  }));
  const path = port.commitCurrentPath(() => "after.letterpaper");
  const dirty = port.commitDirty((previous) => !previous);
  const tabs = port.commitOpenTabs((previous) => [...previous, { id: "after" }]);
  const activeTabId = port.commitActiveTabId(() => "after");

  assert.deepEqual(setterEvents, [
    ["document", true],
    ["path", true],
    ["dirty", true],
    ["tabs", true],
    ["active", true],
  ]);
  assert.deepEqual(port.read(), {
    activeTabId,
    currentPath: path,
    dirty,
    document,
    tabs,
  });
});

test("group store preserves right split and ratio setter behavior with ref-first commits", () => {
  const initialGroups = createWorkspaceGroupsState(
    { tabId: "primary-tab", resourceKey: "temporary:primary-tab" },
    { splitRatio: 0.5 },
  );
  const workspaceGroupsRef = ref(initialGroups);
  const rightSplitTabIdRef = ref("");
  const activePaneRef = ref("main");
  const setterEvents = [];
  const port = createGroupStorePort({
    activePaneRef,
    rightSplitTabIdRef,
    setActivePane: (next) => setterEvents.push([
      "pane",
      activePaneRef.current === next,
    ]),
    setWorkspaceGroups: (next) => setterEvents.push([
      "groups",
      workspaceGroupsRef.current === next,
      rightSplitTabIdRef.current,
    ]),
    workspaceGroupsRef,
  });

  const withSecondary = port.commitRightSplitTabId((current) => {
    assert.equal(current, "");
    return "secondary-tab";
  });
  assert.equal(withSecondary.focusedGroup, WORKSPACE_GROUP_ID.SECONDARY);
  assert.equal(rightSplitTabIdRef.current, "secondary-tab");
  assert.equal(port.read().rightSplitTabId, "secondary-tab");

  const resized = port.commitDocumentPaneRatio(() => 4);
  assert.equal(resized.splitRatio, 0.75);
  assert.equal(rightSplitTabIdRef.current, "secondary-tab");

  assert.equal(port.commitActivePane(() => "right"), "right");
  assert.equal(activePaneRef.current, "right");

  const cleared = port.commitRightSplitTabId((current) => {
    assert.equal(current, "secondary-tab");
    return "";
  });
  assert.equal(cleared.secondary.views.length, 0);
  assert.equal(
    cleared.primary.views.some((view) => view.tabId === "secondary-tab"),
    true,
  );
  assert.equal(rightSplitTabIdRef.current, "");
  assert.equal(port.commitWorkspaceGroups(), cleared);

  assert.deepEqual(setterEvents, [
    ["groups", true, "secondary-tab"],
    ["groups", true, "secondary-tab"],
    ["pane", true],
    ["groups", true, ""],
    ["groups", true, ""],
  ]);
});

test("session state port gates restored-only commits and updates the ref before persistence", () => {
  const initialSession = { activePath: "", folderPath: "", tabs: [] };
  const sessionRef = ref(initialSession);
  const sessionRestoredRef = ref(false);
  const sessionClosePendingRef = ref(false);
  const saved = [];
  const port = createSessionStatePort({
    saveSession: (next) => {
      assert.equal(sessionRef.current, next);
      saved.push(next);
    },
    sessionClosePendingRef,
    sessionRef,
    sessionRestoredRef,
  });

  assert.equal(port.isRestored(), false);
  assert.equal(
    port.commitSessionPatchWhenRestored({ activePath: "blocked.letterpaper" }),
    null,
  );
  assert.equal(sessionRef.current, initialSession);
  assert.equal(saved.length, 0);

  assert.equal(port.markRestored(), true);
  const committed = port.commitSessionPatchWhenRestored((current) => ({
    activePath: current.activePath || "restored.letterpaper",
  }));
  assert.equal(committed.activePath, "restored.letterpaper");
  assert.equal(port.read(), committed);
  assert.deepEqual(saved, [committed]);

  assert.equal(port.markRestored(false), false);
  assert.equal(port.isRestored(), false);

  assert.equal(port.isClosePending(), false);
  assert.equal(port.beginClose(), true);
  assert.equal(port.isClosePending(), true);
  assert.equal(port.beginClose(), false);
  assert.equal(port.endClose(), false);
  assert.equal(port.isClosePending(), false);
});

test("workspace state leaf stays free of editor, hydration, snapshot, and document save responsibilities", async () => {
  const source = await readFile(
    new URL("./document-workspace/workspace-state.js", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(
    source,
    /useEffect|useEditor|hydrate|snapshotLiveTabs|restoreWorkspaceGroupsSnapshot|bridge\.|handleSave|queueTabSave|documentSaveQueue/i,
  );
  assert.match(source, /export function useDocumentWorkspaceState/);
  assert.match(source, /documentStateRef\.current = next;\s+setDocumentState\(next\)/);
  assert.match(source, /workspaceGroupsRef\.current = next;\s+rightSplitTabIdRef\.current = activeSecondaryDocumentTabId\(next\);\s+setWorkspaceGroups\(next\)/);
  assert.match(source, /sessionRef\.current = next;\s+saveSession\(next\)/);
});

test("App composes workspace state without recreating its state or mirror refs", async () => {
  const source = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  const appBody = source.slice(source.indexOf("export default function App()"));

  assert.match(appBody, /useDocumentWorkspaceState\(\{\s*letterTemplates,\s*newDocumentTemplateId,/);
  assert.doesNotMatch(
    appBody,
    /const \[(?:initialSession|documentState|currentPath|dirty|openTabs|activeTabId|workspaceGroups|activePane)[^\]]*\] = useState/,
  );
  assert.doesNotMatch(
    appBody,
    /const (?:sessionRef|sessionRestoredRef|sessionClosePendingRef|documentStateRef|currentPathRef|dirtyRef|openTabsRef|activeTabIdRef|workspaceGroupsRef|rightSplitTabIdRef|activePaneRef) = useRef/,
  );
});
