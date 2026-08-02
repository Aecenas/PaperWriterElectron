import assert from "node:assert/strict";
import test from "node:test";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  citationFormattingRequestForEditor,
  createKnowledgeCitationSynchronizer,
} from "./controllers/knowledge-lifecycle.js";
import {
  createKnowledgeExtensions,
  KNOWLEDGE_TAIL_NODE_TYPES,
} from "./knowledge-extensions.js";

const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";

function createCitationEditor(order = [SECOND_ID, FIRST_ID]) {
  return new Editor({
    extensions: [StarterKit.configure({
      trailingNode: { notAfter: ["paragraph", ...KNOWLEDGE_TAIL_NODE_TYPES] },
    }), ...createKnowledgeExtensions()],
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: order.map((sourceId) => ({
            type: "paperCitationReference",
            attrs: { sourceId },
          })),
        },
        { type: "paperBibliography", attrs: { entries: [] } },
      ],
    },
  });
}

function documentFixture() {
  return {
    documentId: "33333333-3333-4333-8333-333333333333",
    citationSources: [
      { id: FIRST_ID, title: "第一篇" },
      { id: SECOND_ID, title: "第二篇" },
    ],
    citationStyle: { styleId: "apa-7", locale: "en-US" },
    footnotes: [],
  };
}

test("citeproc request orders sources by first inline citation rather than library order", () => {
  const editor = createCitationEditor();
  const request = citationFormattingRequestForEditor(editor, documentFixture());
  assert.deepEqual(request.citationOrder, [SECOND_ID, FIRST_ID]);
  assert.deepEqual(request.payload.sources.map((source) => source.id), [SECOND_ID, FIRST_ID]);
  assert.equal(request.payload.styleId, "apa-7");
  editor.destroy();
});

test("citation synchronizer drops an older response after a newer generation applies", async () => {
  const editor = createCitationEditor();
  const document = documentFixture();
  let resolveFirst;
  let calls = 0;
  const citationApi = {
    formatCitations() {
      calls += 1;
      if (calls === 1) return new Promise((resolve) => { resolveFirst = resolve; });
      return Promise.resolve({
        citationKind: "author-date",
        citationsById: {
          [SECOND_ID]: "(Second, 2026)",
          [FIRST_ID]: "(First, 2025)",
        },
        entriesById: {
          [SECOND_ID]: "Second. 2026.",
          [FIRST_ID]: "First. 2025.",
        },
      });
    },
  };
  const synchronizer = createKnowledgeCitationSynchronizer({
    citationApi,
    editor,
    getDocument: () => document,
  });

  const stale = synchronizer.schedule({ immediate: true });
  assert.equal(await synchronizer.schedule({ immediate: true }), true);
  resolveFirst({
    citationKind: "numeric",
    citationsById: { [SECOND_ID]: "99", [FIRST_ID]: "100" },
    entriesById: { [SECOND_ID]: "[99] stale", [FIRST_ID]: "[100] stale" },
  });
  assert.equal(await stale, false);

  const references = editor.getJSON().content[0].content;
  assert.equal(references[0].attrs.displayText, "(Second, 2026)");
  assert.equal(references[1].attrs.displayText, "(First, 2025)");
  assert.equal(references[0].attrs.citationKind, "author-date");
  synchronizer.dispose();
  editor.destroy();
});

test("separate editor synchronizers never share formatting state", async () => {
  const left = createCitationEditor([FIRST_ID]);
  const right = createCitationEditor([SECOND_ID]);
  const leftSynchronizer = createKnowledgeCitationSynchronizer({
    citationApi: {
      async formatCitations() {
        return {
          citationKind: "author-date",
          citationsById: { [FIRST_ID]: "(Left, 2025)" },
          entriesById: { [FIRST_ID]: "Left bibliography" },
        };
      },
    },
    editor: left,
    getDocument: documentFixture,
  });
  const rightSynchronizer = createKnowledgeCitationSynchronizer({
    citationApi: {
      async formatCitations() {
        return {
          citationKind: "author-date",
          citationsById: { [SECOND_ID]: "(Right, 2026)" },
          entriesById: { [SECOND_ID]: "Right bibliography" },
        };
      },
    },
    editor: right,
    getDocument: documentFixture,
  });
  await Promise.all([
    leftSynchronizer.schedule({ immediate: true }),
    rightSynchronizer.schedule({ immediate: true }),
  ]);
  assert.equal(left.getJSON().content[0].content[0].attrs.displayText, "(Left, 2025)");
  assert.equal(right.getJSON().content[0].content[0].attrs.displayText, "(Right, 2026)");
  leftSynchronizer.dispose();
  rightSynchronizer.dispose();
  left.destroy();
  right.destroy();
});

test("citation synchronizer debounces editor updates into one formatting request", async () => {
  const editor = createCitationEditor([FIRST_ID]);
  const timers = new Map();
  let timerId = 0;
  let formatCalls = 0;
  const synchronizer = createKnowledgeCitationSynchronizer({
    citationApi: {
      async formatCitations() {
        formatCalls += 1;
        return {
          citationKind: "numeric",
          citationsById: { [FIRST_ID]: "1" },
          entriesById: { [FIRST_ID]: "[1] First." },
        };
      },
    },
    clearTimeoutImpl(id) {
      timers.delete(id);
    },
    editor,
    getDocument: documentFixture,
    setTimeoutImpl(callback) {
      timerId += 1;
      timers.set(timerId, callback);
      return timerId;
    },
  });

  const first = synchronizer.schedule();
  const second = synchronizer.schedule();
  const third = synchronizer.schedule();
  assert.equal(await first, false);
  assert.equal(await second, false);
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  assert.equal(await third, true);
  assert.equal(formatCalls, 1);
  synchronizer.dispose();
  editor.destroy();
});
