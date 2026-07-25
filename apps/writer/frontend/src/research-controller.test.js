import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createLatestRequestController } from "./latest-request-controller.js";
import {
  applyResearchRootCore,
  refreshIndependentResearchFolderCore,
  refreshResearchLibrarySourcesCore,
  refreshResearchWebTreeCore,
} from "./controllers/research-refresh.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createResearchHarness(researchBridge = {}) {
  const values = {
    activeLibraryItem: null,
    activeResearchError: "",
    librarySources: [],
    librarySourcesReady: false,
    researchBusyKeys: [],
    researchCurrentRelativePath: "",
    researchEntries: [],
    researchExpandedFolders: {},
    researchRoot: { available: true, libraryId: "library-a" },
    researchTreeError: "",
    researchTreeLoading: false,
    webTreeReady: false,
    webTreeState: { folders: [], placements: {}, diskRevision: null, warnings: [], readOnly: false },
  };
  const writes = [];
  const setter = (key) => (nextValue) => {
    const previous = values[key];
    values[key] = typeof nextValue === "function" ? nextValue(previous) : nextValue;
    writes.push([key, values[key]]);
  };
  const researchRootRef = { current: values.researchRoot };
  const researchCurrentRelativePathRef = { current: "" };
  const researchExpandedFoldersRef = { current: {} };
  const context = {
    hasOpenResearchViewsForLibrary: () => false,
    refreshIndependentResearchFolder: () => Promise.resolve([]),
    refreshResearchLibrarySources: () => Promise.resolve([]),
    refreshResearchWebTree: () => Promise.resolve(null),
    removeOpenResearchViews: () => {},
    researchBranchRequestControllerRef: { current: createLatestRequestController() },
    researchBridge,
    researchCurrentRelativePathRef,
    researchCurrentRequestControllerRef: { current: createLatestRequestController() },
    researchExpandedFoldersRef,
    researchRootRef,
    researchSourcesRequestControllerRef: { current: createLatestRequestController() },
    researchWebRequestControllerRef: { current: createLatestRequestController() },
    setActiveLibraryItem: setter("activeLibraryItem"),
    setActiveResearchError: setter("activeResearchError"),
    setLibrarySources: setter("librarySources"),
    setLibrarySourcesReady: setter("librarySourcesReady"),
    setResearchBusyKeys: setter("researchBusyKeys"),
    setResearchCurrentRelativePath: setter("researchCurrentRelativePath"),
    setResearchEntries: setter("researchEntries"),
    setResearchExpandedFolders: setter("researchExpandedFolders"),
    setResearchRoot: setter("researchRoot"),
    setResearchTreeError: setter("researchTreeError"),
    setResearchTreeLoading: setter("researchTreeLoading"),
    setWebTreeReady: setter("webTreeReady"),
    setWebTreeState: setter("webTreeState"),
    showStatus: () => {},
  };
  return { context, values, writes };
}

test("research current-folder refresh is latest-wins and stale finally cannot clear newer loading", async () => {
  const first = deferred();
  const second = deferred();
  let call = 0;
  const { context, values } = createResearchHarness({
    listResearchFolder: () => (++call === 1 ? first.promise : second.promise),
  });

  const oldRequest = refreshIndependentResearchFolderCore(context, "", "library-a", { current: true });
  const newRequest = refreshIndependentResearchFolderCore(context, "", "library-a", { current: true });
  assert.equal(values.researchTreeLoading, true);

  first.resolve({ entries: [{ type: "file", relativePath: "old.txt" }] });
  await oldRequest;
  assert.equal(values.researchTreeLoading, true);
  assert.deepEqual(values.researchEntries, []);

  second.resolve({ entries: [{ type: "file", relativePath: "new.txt" }] });
  await newRequest;
  assert.equal(values.researchTreeLoading, false);
  assert.deepEqual(values.researchEntries.map((entry) => entry.relativePath), ["new.txt"]);
});

test("research branch refreshes remain independent across expanded folder scopes", async () => {
  const branchA = deferred();
  const branchB = deferred();
  const { context, values } = createResearchHarness({
    listResearchFolder: (_libraryId, relativePath) => (
      relativePath === "branch-a" ? branchA.promise : branchB.promise
    ),
  });
  values.researchEntries = [
    { type: "folder", relativePath: "branch-a" },
    { type: "folder", relativePath: "branch-b" },
  ];
  values.researchExpandedFolders = {
    "branch-a": { expanded: true },
    "branch-b": { expanded: true },
  };
  context.researchExpandedFoldersRef.current = values.researchExpandedFolders;

  const requestA = refreshIndependentResearchFolderCore(context, "branch-a", "library-a", { current: false });
  const requestB = refreshIndependentResearchFolderCore(context, "branch-b", "library-a", { current: false });
  branchB.resolve({ entries: [{ type: "file", relativePath: "branch-b/b.txt" }] });
  await requestB;
  branchA.resolve({ entries: [{ type: "file", relativePath: "branch-a/a.txt" }] });
  await requestA;

  assert.deepEqual(
    values.researchExpandedFolders["branch-a"].entries.map((entry) => entry.relativePath),
    ["branch-a/a.txt"],
  );
  assert.deepEqual(
    values.researchExpandedFolders["branch-b"].entries.map((entry) => entry.relativePath),
    ["branch-b/b.txt"],
  );
});

test("switching research roots invalidates current, branch, source, and web requests", async () => {
  const current = deferred();
  const branch = deferred();
  const sources = deferred();
  const web = deferred();
  const { context, values } = createResearchHarness({
    listResearchFolder: (_libraryId, relativePath) => relativePath ? branch.promise : current.promise,
    listResearchLibrarySources: () => sources.promise,
    listResearchWebTree: () => web.promise,
  });
  values.researchExpandedFolders = { branch: { expanded: true } };
  context.researchExpandedFoldersRef.current = values.researchExpandedFolders;

  const pending = [
    refreshIndependentResearchFolderCore(context, "", "library-a", { current: true }),
    refreshIndependentResearchFolderCore(context, "branch", "library-a", { current: false }),
    refreshResearchLibrarySourcesCore(context, "library-a"),
    refreshResearchWebTreeCore(context, "library-a"),
  ];
  await applyResearchRootCore(context, { configured: true, available: false });
  current.resolve({ entries: [{ type: "file", relativePath: "stale-current.txt" }] });
  branch.resolve({ entries: [{ type: "file", relativePath: "branch/stale.txt" }] });
  sources.resolve({ sources: [{ id: "stale-source", type: "web" }] });
  web.resolve({ folders: [{ id: "stale-folder" }], placements: {} });
  await Promise.all(pending);

  assert.equal(context.researchRootRef.current.available, false);
  assert.deepEqual(values.researchEntries, []);
  assert.deepEqual(values.researchExpandedFolders, {});
  assert.deepEqual(values.librarySources, []);
  assert.equal(values.librarySourcesReady, false);
  assert.deepEqual(values.webTreeState.folders, []);
  assert.equal(values.webTreeReady, false);
});

test("research source and web refreshes reject stale same-scope results", async () => {
  const sourceOld = deferred();
  const sourceNew = deferred();
  const webOld = deferred();
  const webNew = deferred();
  let sourceCalls = 0;
  let webCalls = 0;
  const { context, values } = createResearchHarness({
    listResearchLibrarySources: () => (++sourceCalls === 1 ? sourceOld.promise : sourceNew.promise),
    listResearchWebTree: () => (++webCalls === 1 ? webOld.promise : webNew.promise),
  });

  const oldSourcesRequest = refreshResearchLibrarySourcesCore(context, "library-a");
  const newSourcesRequest = refreshResearchLibrarySourcesCore(context, "library-a");
  const oldWebRequest = refreshResearchWebTreeCore(context, "library-a");
  const newWebRequest = refreshResearchWebTreeCore(context, "library-a");

  sourceOld.resolve({ sources: [{ id: "old-source", type: "web" }] });
  webOld.resolve({ folders: [{ id: "old-folder" }], placements: {} });
  await Promise.all([oldSourcesRequest, oldWebRequest]);
  assert.deepEqual(values.librarySources, []);
  assert.equal(values.librarySourcesReady, false);
  assert.deepEqual(values.webTreeState.folders, []);
  assert.equal(values.webTreeReady, false);

  sourceNew.resolve({ sources: [{ id: "new-source", type: "web" }] });
  webNew.resolve({ folders: [{ id: "new-folder" }], placements: {}, diskRevision: "web-r2" });
  await Promise.all([newSourcesRequest, newWebRequest]);
  assert.deepEqual(values.librarySources.map((source) => source.id), ["new-source"]);
  assert.equal(values.librarySourcesReady, true);
  assert.deepEqual(values.webTreeState.folders.map((folder) => folder.id), ["new-folder"]);
  assert.equal(values.webTreeReady, true);
});

test("research wiring preserves hook order and exposes only a narrow workspace-view port", async () => {
  const [app, groupsController, refresh, state] = await Promise.all([
    readFile(new URL("./App.jsx", import.meta.url), "utf8"),
    readFile(new URL("./document-workspace/workspace-groups-controller.js", import.meta.url), "utf8"),
    readFile(new URL("./controllers/research-refresh.js", import.meta.url), "utf8"),
    readFile(new URL("./controllers/research-state.js", import.meta.url), "utf8"),
  ]);
  const orderedStateHooks = [
    "const [researchRoot, setResearchRoot] = useState(null)",
    "const [researchCurrentRelativePath, setResearchCurrentRelativePath] = useState(\"\")",
    "const [researchEntries, setResearchEntries] = useState([])",
    "const [researchExpandedFolders, setResearchExpandedFolders] = useState({})",
    "const [researchTreeLoading, setResearchTreeLoading] = useState(false)",
    "const [researchTreeError, setResearchTreeError] = useState(\"\")",
    "const [researchBusyKeys, setResearchBusyKeys] = useState([])",
    "const researchRootRef = useRef(null)",
    "const researchCurrentRelativePathRef = useRef(\"\")",
    "const researchExpandedFoldersRef = useRef(researchExpandedFolders)",
    "const [librarySources, setLibrarySources] = useState([])",
    "const [librarySourcesReady, setLibrarySourcesReady] = useState(false)",
    "const [webTreeState, setWebTreeState] = useState(createEmptyResearchWebTree)",
    "const [webTreeReady, setWebTreeReady] = useState(false)",
    "const [webWorkspaceMode, setWebWorkspaceMode] = useState",
    "const [writingWorkspaceIdentity, setWritingWorkspaceIdentity] = useState(null)",
    "const [activeLibraryItem, setActiveLibraryItem] = useState(null)",
    "const [researchItemsByViewId, setResearchItemsByViewId] = useState({})",
    "const librarySourcesRef = useRef(librarySources)",
    "const researchItemsByViewIdRef = useRef(researchItemsByViewId)",
    "const [activeResearchLoading, setActiveResearchLoading] = useState(false)",
    "const [activeResearchError, setActiveResearchError] = useState(\"\")",
  ];
  let previousIndex = -1;
  for (const hook of orderedStateHooks) {
    const index = state.indexOf(hook);
    assert.ok(index > previousIndex, `${hook} must retain its relative hook order`);
    previousIndex = index;
  }

  const requestHook = state.slice(state.indexOf("export function useResearchRequestControllerRefs"));
  const requestRefs = [
    "researchCurrentRequestControllerRef",
    "researchBranchRequestControllerRef",
    "researchSourcesRequestControllerRef",
    "researchWebRequestControllerRef",
  ];
  previousIndex = -1;
  for (const requestRef of requestRefs) {
    const index = requestHook.indexOf(`const ${requestRef} = useRef(createLatestRequestController())`);
    assert.ok(index > previousIndex, `${requestRef} must retain its independent request-controller slot`);
    previousIndex = index;
  }

  assert.match(app, /researchViewsPort: workspaceResearchViewsPort/);
  assert.match(app, /const researchViewsPort = \{[\s\S]*workspaceResearchViewsPort/);
  for (const method of [
    "closeActiveResearchView",
    "getOpenResearchViews",
    "hasOpenResearchViewsForLibrary",
    "openResearchPreviewView",
    "removeOpenResearchViews",
    "updateOpenResearchTargets",
  ]) {
    assert.match(groupsController, new RegExp(`${method}[,:]`));
  }
  assert.match(app, /useResearchState\(writingWorkspaceRoot\)/);
  assert.match(app, /useResearchRefreshActions\(\{/);
  assert.match(app, /useResearchMountLifecycle\(refreshResearchRoot\)/);
  assert.doesNotMatch(refresh, /setOpenTabs|setWorkspaceGroups|workspaceGroupsRef|openTabsRef/);

  const invalidateOrder = [
    "researchCurrentRequestControllerRef.current.invalidateAll()",
    "researchBranchRequestControllerRef.current.invalidateAll()",
    "researchSourcesRequestControllerRef.current.invalidateAll()",
    "researchWebRequestControllerRef.current.invalidateAll()",
  ];
  const applyRoot = refresh.slice(refresh.indexOf("export async function applyResearchRootCore"));
  previousIndex = -1;
  for (const invalidation of invalidateOrder) {
    const index = applyRoot.indexOf(invalidation);
    assert.ok(index > previousIndex, `${invalidation} must run before root state replacement`);
    previousIndex = index;
  }
  assert.ok(previousIndex < applyRoot.indexOf("const normalized ="));
});
