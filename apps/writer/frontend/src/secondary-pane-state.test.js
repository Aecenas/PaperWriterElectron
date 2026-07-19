import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVE_PANE,
  EMPTY_SECONDARY_PANE,
  MAX_DOCUMENT_PANE_RATIO,
  MAX_RESEARCH_PANE_RATIO,
  MIN_DOCUMENT_PANE_RATIO,
  MIN_RESEARCH_PANE_RATIO,
  MIN_RESEARCH_PANE_WIDTH,
  SECONDARY_PANE_KIND,
  closeSecondaryPane,
  createSecondaryPaneLayoutSnapshot,
  deriveActiveDocumentTabId,
  deriveActivePane,
  getResearchPaneWidthBounds,
  handoffSecondaryPaneLayoutSnapshot,
  isSecondaryPaneLayoutSnapshot,
  keepSecondaryPaneForSidebarChange,
  normalizeDocumentPaneRatio,
  normalizeResearchPaneRatio,
  normalizeResearchPaneWidth,
  normalizeSecondaryPane,
  normalizeSecondaryPaneLayout,
  openDocumentSecondaryPane,
  openResearchSecondaryPane,
  replaceSecondaryPane,
  resolveResearchPaneGeometry,
  restoreSecondaryPaneLayout,
  stashSecondaryPaneLayout,
} from "./secondary-pane-state.js";

test("normalizes the none, document and research pane union", () => {
  assert.deepEqual(normalizeSecondaryPane(null), EMPTY_SECONDARY_PANE);
  assert.deepEqual(normalizeSecondaryPane({ kind: "unknown" }), EMPTY_SECONDARY_PANE);
  assert.deepEqual(
    normalizeSecondaryPane({ kind: SECONDARY_PANE_KIND.DOCUMENT, tabId: "  tab-2  " }),
    { kind: SECONDARY_PANE_KIND.DOCUMENT, tabId: "tab-2" },
  );
  assert.deepEqual(
    normalizeSecondaryPane({
      kind: SECONDARY_PANE_KIND.RESEARCH,
      libraryId: " library-a ",
      fileRelativePath: ".\\论文\\材料.pdf",
    }),
    { kind: SECONDARY_PANE_KIND.RESEARCH, libraryId: "library-a", fileRelativePath: "论文/材料.pdf" },
  );
  assert.deepEqual(
    normalizeSecondaryPane({
      kind: SECONDARY_PANE_KIND.RESEARCH,
      libraryId: "library-a",
      sourceId: "web-1",
    }),
    { kind: SECONDARY_PANE_KIND.RESEARCH, libraryId: "library-a", sourceId: "web-1" },
  );
});

test("rejects ambiguous and unsafe research targets", () => {
  for (const pane of [
    { kind: "research", libraryId: "library-a" },
    { kind: "research", libraryId: "library-a", fileRelativePath: "a.pdf", sourceId: "source-a" },
    { kind: "research", libraryId: "library-a", fileRelativePath: "../outside.pdf" },
    { kind: "research", libraryId: "library-a", fileRelativePath: "C:\\outside.pdf" },
    { kind: "research", libraryId: "library-a", fileRelativePath: "../outside.pdf", sourceId: "source-a" },
    { kind: "research", libraryId: "", sourceId: "source-a" },
  ]) {
    assert.deepEqual(normalizeSecondaryPane(pane), EMPTY_SECONDARY_PANE);
  }
});

test("opens and explicitly replaces document and research panes without a hidden back stack", () => {
  const documentPane = openDocumentSecondaryPane(EMPTY_SECONDARY_PANE, "tab-a");
  assert.deepEqual(documentPane, { kind: "document", tabId: "tab-a" });

  const researchPane = openResearchSecondaryPane(documentPane, {
    libraryId: "library-a",
    fileRelativePath: "books/one.pdf",
  });
  assert.deepEqual(researchPane, {
    kind: "research",
    libraryId: "library-a",
    fileRelativePath: "books/one.pdf",
  });

  const replacementDocument = openDocumentSecondaryPane(researchPane, "tab-b");
  assert.deepEqual(replacementDocument, { kind: "document", tabId: "tab-b" });
  assert.deepEqual(closeSecondaryPane(replacementDocument), EMPTY_SECONDARY_PANE);
});

test("invalid opens and replacements preserve the currently visible pane", () => {
  const current = { kind: "document", tabId: "tab-a" };
  assert.deepEqual(openDocumentSecondaryPane(current, ""), current);
  assert.deepEqual(
    openResearchSecondaryPane(current, { libraryId: "library-a", fileRelativePath: "../escape.pdf" }),
    current,
  );
  assert.deepEqual(replaceSecondaryPane(current, { kind: "future-pane" }), current);
  assert.deepEqual(replaceSecondaryPane(current, { kind: "none" }), EMPTY_SECONDARY_PANE);
});

test("sidebar mode changes do not alter the right-side pane", () => {
  const research = {
    kind: "research",
    libraryId: "library-a",
    sourceId: "url-a",
  };
  assert.deepEqual(keepSecondaryPaneForSidebarChange(research, "structure"), research);
  assert.deepEqual(keepSecondaryPaneForSidebarChange(research, "files"), research);
});

test("derives active pane and active document without treating research as an editor", () => {
  const document = { kind: "document", tabId: "split-tab" };
  const research = { kind: "research", libraryId: "library-a", sourceId: "source-a" };
  assert.equal(deriveActivePane("secondary", document), ACTIVE_PANE.SECONDARY);
  assert.equal(deriveActivePane("right", research), ACTIVE_PANE.SECONDARY);
  assert.equal(deriveActivePane("secondary", EMPTY_SECONDARY_PANE), ACTIVE_PANE.PRIMARY);
  assert.equal(deriveActivePane("main", document), ACTIVE_PANE.PRIMARY);
  assert.equal(deriveActiveDocumentTabId({
    primaryTabId: "main-tab",
    secondaryPane: document,
    activePane: "secondary",
  }), "split-tab");
  assert.equal(deriveActiveDocumentTabId({
    primaryTabId: "main-tab",
    secondaryPane: research,
    activePane: "secondary",
  }), "main-tab");
});

test("normalizes document and research ratios while retaining the legacy pixel helper", () => {
  assert.equal(normalizeDocumentPaneRatio(undefined), 0.5);
  assert.equal(normalizeDocumentPaneRatio(0.1), MIN_DOCUMENT_PANE_RATIO);
  assert.equal(normalizeDocumentPaneRatio(0.9), MAX_DOCUMENT_PANE_RATIO);
  assert.equal(normalizeDocumentPaneRatio("0.4"), 0.4);

  assert.equal(normalizeResearchPaneRatio(undefined), 0.5);
  assert.equal(normalizeResearchPaneRatio(0.1), MIN_RESEARCH_PANE_RATIO);
  assert.equal(normalizeResearchPaneRatio(0.9), MAX_RESEARCH_PANE_RATIO);
  assert.equal(normalizeResearchPaneRatio("0.4"), 0.4);

  assert.deepEqual(getResearchPaneWidthBounds(1000), { minimum: 360, maximum: 600 });
  assert.equal(normalizeResearchPaneWidth(undefined, 1000), 480);
  assert.equal(normalizeResearchPaneWidth(200, 1000), 360);
  assert.equal(normalizeResearchPaneWidth(900, 1000), 600);
  assert.equal(normalizeResearchPaneWidth("511.6", 1200), 512);
  assert.deepEqual(
    getResearchPaneWidthBounds(500),
    { minimum: MIN_RESEARCH_PANE_WIDTH, maximum: MIN_RESEARCH_PANE_WIDTH },
  );
});

test("research geometry keeps its ratio while the available workspace changes", () => {
  const withSidebar = resolveResearchPaneGeometry(0.5, 1000, 1600);
  const withoutSidebar = resolveResearchPaneGeometry(0.5, 1400, 1600);
  assert.equal(withSidebar.ratio, 0.5);
  assert.equal(withSidebar.paneWidth, 500);
  assert.equal(withSidebar.effectiveRatio, 0.5);
  assert.equal(withoutSidebar.ratio, 0.5);
  assert.equal(withoutSidebar.paneWidth, 700);
  assert.equal(withoutSidebar.effectiveRatio, 0.5);

  const narrow = resolveResearchPaneGeometry(0.25, 600, 600);
  assert.equal(narrow.ratio, 0.25);
  assert.equal(narrow.paneWidth, 360);
  assert.equal(narrow.effectiveRatio, 0.6);
});

test("creates a JSON-serializable canonical layout snapshot", () => {
  const snapshot = createSecondaryPaneLayoutSnapshot({
    secondaryPane: { kind: "document", tabId: " split-a " },
    activePane: "right",
    widths: { documentRatio: 0.42, researchRatio: 0.7 },
  }, { viewportWidth: 1000 });
  assert.deepEqual(snapshot, {
    version: 2,
    secondaryPane: { kind: "document", tabId: "split-a" },
    activePane: "secondary",
    widths: { documentRatio: 0.42, researchRatio: 0.7 },
  });
  assert.equal(isSecondaryPaneLayoutSnapshot(snapshot), true);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
});

test("stashes and restores a secondary pane for AI or immersive surfaces", () => {
  const original = {
    secondaryPane: {
      kind: "research",
      libraryId: "library-a",
      fileRelativePath: "papers/source.pdf",
    },
    activePane: "secondary",
    widths: { documentRatio: 0.45, researchRatio: 0.54 },
  };
  const stashed = stashSecondaryPaneLayout(original, { viewportWidth: 1200 });
  assert.deepEqual(stashed.layout, {
    secondaryPane: EMPTY_SECONDARY_PANE,
    activePane: "primary",
    widths: { documentRatio: 0.45, researchRatio: 0.54 },
  });
  assert.deepEqual(
    restoreSecondaryPaneLayout(JSON.parse(JSON.stringify(stashed.snapshot)), { viewportWidth: 1200 }),
    normalizeSecondaryPaneLayout(original, { viewportWidth: 1200 }),
  );
});

test("hands the oldest pane snapshot across overlapping AI and immersive surfaces", () => {
  const original = createSecondaryPaneLayoutSnapshot({
    secondaryPane: { kind: "document", tabId: "right-tab" },
    activePane: "secondary",
    widths: { documentRatio: 0.44, researchRatio: 0.52 },
  }, { viewportWidth: 1200 });
  const newer = createSecondaryPaneLayoutSnapshot({
    secondaryPane: { kind: "research", libraryId: "library-a", sourceId: "source-a" },
    activePane: "primary",
    widths: { documentRatio: 0.5, researchRatio: 0.48 },
  }, { viewportWidth: 1200 });

  assert.equal(handoffSecondaryPaneLayoutSnapshot(null, original), original);
  assert.equal(handoffSecondaryPaneLayoutSnapshot(original, newer), original);
  assert.equal(handoffSecondaryPaneLayoutSnapshot({ version: 99 }, original), original);
  assert.equal(handoffSecondaryPaneLayoutSnapshot(null, { version: 99 }), null);
});

test("falls back safely instead of restoring invalid or future snapshots", () => {
  const fallbackLayout = {
    secondaryPane: { kind: "document", tabId: "still-open" },
    activePane: "secondary",
    widths: { documentRatio: 0.4, researchRatio: 0.5 },
  };
  assert.equal(isSecondaryPaneLayoutSnapshot({ version: 99 }), false);
  assert.deepEqual(
    restoreSecondaryPaneLayout({ version: 99 }, { viewportWidth: 1000, fallbackLayout }),
    normalizeSecondaryPaneLayout(fallbackLayout, { viewportWidth: 1000 }),
  );
});
