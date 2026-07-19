import assert from "node:assert/strict";
import test from "node:test";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  createKnowledgeExtensions,
  createKnowledgeUpdateGuard,
  KNOWLEDGE_TAIL_NODE_TYPES,
  nextInternalLinkUsage,
  nextInternalLinkUsagePosition,
  stripDerivedKnowledgeDataFromHtml,
  synchronizeKnowledgeReferences,
} from "./knowledge-extensions.js";

test("knowledge update guard blocks derived and synchronous re-entrant updates", () => {
  let calls = 0;
  let guardedSynchronize;
  guardedSynchronize = createKnowledgeUpdateGuard(() => {
    calls += 1;
    guardedSynchronize();
    guardedSynchronize({ transaction: { getMeta: (key) => key === "paperKnowledgeDerived" } });
  });

  assert.equal(guardedSynchronize(), true);
  assert.equal(calls, 1);
  assert.equal(guardedSynchronize({ transaction: { getMeta: (key) => key === "paperKnowledgeDerived" } }), false);
  assert.equal(calls, 1);
  assert.equal(guardedSynchronize(), true);
  assert.equal(calls, 2);
});

test("inserting a footnote performs a bounded synchronization and builds one tail list", () => {
  const footnoteId = "11111111-1111-4111-8111-111111111111";
  const editor = new Editor({
    extensions: [StarterKit.configure({
      trailingNode: { notAfter: ["paragraph", ...KNOWLEDGE_TAIL_NODE_TYPES] },
    }), ...createKnowledgeExtensions()],
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }] },
  });
  let updateCount = 0;
  const synchronize = createKnowledgeUpdateGuard(() => synchronizeKnowledgeReferences(editor, {
    citationSources: [],
    footnotes: [{ id: footnoteId, text: "脚注回归测试" }],
  }));
  editor.on("update", (payload) => {
    updateCount += 1;
    assert.ok(updateCount <= 3, "footnote insertion must not enter an unbounded update cycle");
    synchronize(payload);
  });

  const inserted = editor.chain().insertContentAt(1, {
    type: "paperFootnoteReference",
    attrs: { footnoteId, number: 1 },
  }).run();
  const json = editor.getJSON();
  const footnoteLists = json.content.filter((node) => node.type === "paperFootnoteList");

  assert.equal(inserted, true);
  assert.equal(updateCount, 3);
  assert.equal(footnoteLists.length, 1);
  assert.equal(json.content.at(-1).type, "paperFootnoteList");
  assert.deepEqual(footnoteLists[0].attrs.entries, [{
    footnoteId,
    number: 1,
    text: "脚注回归测试",
    missing: false,
  }]);
  editor.destroy();
});

test("strips derived citation numbers and bibliography snapshots before persistence", () => {
  const html = '<p>正文<span class="paper-citation-reference" data-citation-source-id="11111111-1111-4111-8111-111111111111" data-citation-pages="12">3</span></p>'
    + '<section class="paper-bibliography" data-reference-list="[{&quot;sourceId&quot;:&quot;x&quot;}]"><p>[1] 来源</p></section>';
  const stripped = stripDerivedKnowledgeDataFromHtml(html);
  assert.match(stripped, /data-citation-pages="12"><\/span>/);
  assert.doesNotMatch(stripped, />3<\/span>/);
  assert.match(stripped, /data-reference-list="\[\]"><\/section>/);
  assert.doesNotMatch(stripped, /\[1\] 来源/);
});

test("strips derived footnote numbers and the generated footnote list", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const html = `<p>正文<sup class="paper-footnote-reference" data-footnote-ref="true" data-footnote-id="${id}" data-footnote-number="2">2</sup></p>`
    + `<section class="paper-footnote-list" data-footnote-list="[]"><h2>脚注</h2><ol><li>内容</li></ol></section>`;
  const stripped = stripDerivedKnowledgeDataFromHtml(html);
  assert.match(stripped, /data-footnote-number="2"><\/sup>/);
  assert.doesNotMatch(stripped, />2<\/sup>|paper-footnote-list|<h2>脚注<\/h2>/);
});

test("internal links render an accessible letter label for the editor icon treatment", () => {
  const documentId = "22222222-2222-4222-8222-222222222222";
  const editor = new Editor({
    extensions: [StarterKit, ...createKnowledgeExtensions()],
    content: {
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{ type: "paperInternalLink", attrs: { documentId, title: "目标信笺", label: "目标信笺" } }],
      }],
    },
  });
  const linkNode = editor.state.doc.firstChild.firstChild;
  const output = linkNode.type.spec.toDOM(linkNode);

  assert.equal(output[1].class, "paper-document-link");
  assert.equal(output[1].role, "button");
  assert.equal(output[2][1].class, "paper-document-link-label");
  assert.equal(output[2][2], "目标信笺");
  editor.destroy();
});

test("internal-link usage navigation advances through matching nodes and wraps", () => {
  const target = "22222222-2222-4222-8222-222222222222";
  const other = "33333333-3333-4333-8333-333333333333";
  const links = [
    { documentId: target, position: 27 },
    { documentId: other, position: 18 },
    { targetDocumentId: target, position: 8 },
  ];

  assert.equal(nextInternalLinkUsagePosition(links, target, 0), 8);
  assert.equal(nextInternalLinkUsagePosition(links, target, 8), 27);
  assert.equal(nextInternalLinkUsagePosition(links, target, 27), 8);
  assert.equal(nextInternalLinkUsagePosition(links, other, 0), 18);
  assert.equal(nextInternalLinkUsagePosition(links, "invalid", 0), null);
  assert.deepEqual(nextInternalLinkUsage(links, target, 8), { position: 27, current: 2, total: 2 });
  assert.deepEqual(nextInternalLinkUsage(links, target, 27), { position: 8, current: 1, total: 2 });
});
