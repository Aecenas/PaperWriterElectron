import { Extension, Node, mergeAttributes } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

export const KNOWLEDGE_TAIL_NODE_TYPES = ["paperFootnoteList", "paperBibliography"];

function safeUuid(value) {
  const id = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : "";
}

function safeNumber(value) {
  return Math.max(1, Math.min(5000, Number.parseInt(value, 10) || 1));
}

function safeFootnoteEntries(value) {
  return (Array.isArray(value) ? value : []).slice(0, 5000).flatMap((entry) => {
    const footnoteId = safeUuid(entry?.footnoteId || entry?.id);
    if (!footnoteId) return [];
    return [{
      footnoteId,
      number: safeNumber(entry?.number),
      text: String(entry?.text || "脚注内容缺失").slice(0, 20000),
      missing: Boolean(entry?.missing),
    }];
  });
}

export const PaperFootnoteReference = Node.create({
  name: "paperFootnoteReference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  marks: "",
  addAttributes() {
    return {
      footnoteId: { default: "", parseHTML: (element) => safeUuid(element.getAttribute("data-footnote-id")) },
      number: { default: 1, parseHTML: (element) => safeNumber(element.getAttribute("data-footnote-number") || element.textContent) },
    };
  },
  parseHTML() { return [{ tag: "sup[data-footnote-ref]" }]; },
  renderHTML({ HTMLAttributes }) {
    const number = safeNumber(HTMLAttributes.number);
    return ["sup", mergeAttributes(HTMLAttributes, {
      class: "paper-footnote-reference",
      "data-footnote-ref": "true",
      "data-footnote-id": safeUuid(HTMLAttributes.footnoteId),
      "data-footnote-number": String(number),
      role: "button",
      tabindex: "0",
      title: `查看脚注 ${number}`,
      "aria-label": `查看脚注 ${number}`,
    }), String(number)];
  },
});

export const PaperCitationReference = Node.create({
  name: "paperCitationReference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  marks: "",
  addAttributes() {
    return {
      sourceId: { default: "", parseHTML: (element) => safeUuid(element.getAttribute("data-citation-source-id")) },
      pages: { default: "", parseHTML: (element) => String(element.getAttribute("data-citation-pages") || "").slice(0, 128) },
      number: { default: 1, parseHTML: (element) => safeNumber(element.textContent) },
    };
  },
  parseHTML() { return [{ tag: "span[data-citation-source-id]" }]; },
  renderHTML({ HTMLAttributes }) {
    const number = safeNumber(HTMLAttributes.number);
    const pages = String(HTMLAttributes.pages || "").slice(0, 128);
    return ["span", mergeAttributes(HTMLAttributes, {
      class: "paper-citation-reference",
      "data-citation-source-id": safeUuid(HTMLAttributes.sourceId),
      "data-citation-pages": pages,
      role: "button",
      tabindex: "0",
      title: pages ? `查看引用 ${number}，第 ${pages} 页` : `查看引用 ${number}`,
      "aria-label": pages ? `查看引用 ${number}，第 ${pages} 页` : `查看引用 ${number}`,
    }), String(number)];
  },
});

export const PaperInternalLink = Node.create({
  name: "paperInternalLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  marks: "",
  addAttributes() {
    return {
      documentId: { default: "", parseHTML: (element) => safeUuid(element.getAttribute("data-document-id")) },
      label: { default: "关联信笺", parseHTML: (element) => String(element.textContent || "关联信笺").slice(0, 500) },
      title: { default: "", parseHTML: (element) => String(element.getAttribute("data-document-title") || "").slice(0, 500) },
      pathHint: { default: "", parseHTML: (element) => String(element.getAttribute("data-path-hint") || "").slice(0, 2048) },
      missing: { default: false, parseHTML: (element) => element.getAttribute("data-missing") === "true" },
    };
  },
  parseHTML() { return [{ tag: "span[data-document-id]" }]; },
  renderHTML({ HTMLAttributes }) {
    const label = String(HTMLAttributes.label || HTMLAttributes.title || "关联信笺").slice(0, 500);
    return ["span", mergeAttributes(HTMLAttributes, {
      class: "paper-document-link",
      "data-document-id": safeUuid(HTMLAttributes.documentId),
      "data-document-title": String(HTMLAttributes.title || "").slice(0, 500),
      "data-path-hint": String(HTMLAttributes.pathHint || "").slice(0, 2048),
      "data-missing": HTMLAttributes.missing ? "true" : "false",
      role: "button",
      tabindex: "0",
      title: HTMLAttributes.missing ? "目标信笺已丢失" : `打开：${HTMLAttributes.title || label}`,
      "aria-label": HTMLAttributes.missing ? `关联信笺 ${label} 已丢失` : `打开关联信笺：${HTMLAttributes.title || label}`,
    }), ["span", { class: "paper-document-link-label" }, label]];
  },
});

export const PaperFootnoteList = Node.create({
  name: "paperFootnoteList",
  group: "block",
  atom: true,
  selectable: false,
  addAttributes() {
    return {
      entries: {
        default: [],
        parseHTML: (element) => {
          try { return safeFootnoteEntries(JSON.parse(element.getAttribute("data-footnote-list") || "[]")); } catch { return []; }
        },
      },
    };
  },
  parseHTML() { return [{ tag: "section[data-footnote-list]" }]; },
  renderHTML({ HTMLAttributes }) {
    const entries = safeFootnoteEntries(HTMLAttributes.entries);
    return ["section", {
      class: "paper-footnote-list",
      "data-footnote-list": JSON.stringify(entries),
      contenteditable: "false",
    },
    ["h2", {}, "脚注"],
    ["ol", {}, ...entries.map((entry) => ["li", {
      "data-footnote-id": entry.footnoteId,
      "data-footnote-number": String(entry.number),
    }, entry.text])]];
  },
});

export const PaperBibliography = Node.create({
  name: "paperBibliography",
  group: "block",
  atom: true,
  selectable: false,
  addAttributes() {
    return { entries: { default: [], parseHTML: (element) => {
      try { const value = JSON.parse(element.getAttribute("data-reference-list") || "[]"); return Array.isArray(value) ? value.slice(0, 5000) : []; } catch { return []; }
    } } };
  },
  parseHTML() { return [{ tag: "section[data-reference-list]" }]; },
  renderHTML({ HTMLAttributes }) {
    const entries = Array.isArray(HTMLAttributes.entries) ? HTMLAttributes.entries.slice(0, 5000) : [];
    return ["section", {
      class: "paper-bibliography",
      "data-reference-list": JSON.stringify(entries),
      contenteditable: "false",
    },
    ["h2", {}, "参考文献"],
    ...(entries.length
      ? entries.map((entry, index) => ["p", { "data-citation-source-id": safeUuid(entry?.sourceId) }, `[${index + 1}] ${String(entry?.text || "").slice(0, 5000)}`])
      : [["p", { class: "paper-bibliography-empty" }, "暂无正文引用"]])];
  },
});

function copyRect(element) {
  const rect = element?.getBoundingClientRect?.();
  return rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null;
}

function dispatchKnowledgeReferenceOpen(view, position, event, element) {
  const footnoteElement = element?.closest?.("[data-footnote-ref][data-footnote-id]");
  const candidateCitation = element?.closest?.("[data-citation-source-id]");
  const citationElement = candidateCitation?.closest?.(".paper-bibliography") ? null : candidateCitation;
  const referenceElement = footnoteElement || citationElement;
  if (!referenceElement) return false;
  event.preventDefault();
  window.dispatchEvent(new CustomEvent("paper-knowledge-reference-open", { detail: {
    kind: footnoteElement ? "footnote" : "citation",
    footnoteId: footnoteElement?.getAttribute("data-footnote-id") || "",
    sourceId: citationElement?.getAttribute("data-citation-source-id") || "",
    pages: citationElement?.getAttribute("data-citation-pages") || "",
    number: safeNumber(referenceElement.getAttribute("data-footnote-number") || referenceElement.textContent),
    position: Number(position),
    editorDom: view.dom,
    anchorElement: referenceElement,
    anchorRect: copyRect(referenceElement),
  } }));
  return true;
}

export const KnowledgeReferenceTrigger = Extension.create({
  name: "paperKnowledgeReferenceTrigger",
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        handleClick(view, position, event) {
          const element = event.target?.closest?.("[data-footnote-ref], [data-citation-source-id], [data-document-id]");
          if (!element) return false;
          if (element.closest?.("[data-document-id]")) {
            event.preventDefault();
            window.dispatchEvent(new CustomEvent("paper-internal-link-open", { detail: {
              documentId: element.getAttribute("data-document-id") || "",
              title: element.getAttribute("data-document-title") || element.textContent || "",
              pathHint: element.getAttribute("data-path-hint") || "",
            } }));
            return true;
          }
          return dispatchKnowledgeReferenceOpen(view, position, event, element);
        },
        handleKeyDown(view, event) {
          if (event.key !== "Enter" && event.key !== " ") return false;
          const element = event.target?.closest?.("[data-footnote-ref], [data-citation-source-id]");
          if (!element) return false;
          let position = view.state.selection.from;
          try { position = view.posAtDOM(element, 0); } catch {}
          return dispatchKnowledgeReferenceOpen(view, position, event, element);
        },
      },
    })];
  },
});

function knowledgeTailState(doc) {
  const footnoteReferences = [];
  const footnoteLists = [];
  const bibliographies = [];
  doc?.descendants?.((node, position) => {
    if (node.type.name === "paperFootnoteReference") footnoteReferences.push({ node, position });
    if (node.type.name === "paperFootnoteList") footnoteLists.push({ node, position });
    if (node.type.name === "paperBibliography") bibliographies.push({ node, position });
  });
  return { footnoteReferences, footnoteLists, bibliographies };
}

function createKnowledgeTailTransaction(state) {
  const nodeTypes = state?.schema?.nodes;
  if (!state?.doc || !nodeTypes?.paperFootnoteList || !nodeTypes?.paperBibliography) return null;
  const tail = knowledgeTailState(state.doc);
  const needsFootnoteList = tail.footnoteReferences.some(({ node }) => safeUuid(node.attrs.footnoteId));
  const bibliographyEnabled = tail.bibliographies.length > 0;
  const expectedFootnoteCount = needsFootnoteList ? 1 : 0;
  const expectedBibliographyCount = bibliographyEnabled ? 1 : 0;
  const footnoteList = tail.footnoteLists[0] || null;
  const bibliography = tail.bibliographies[0] || null;
  const bibliographyAtEnd = !bibliographyEnabled || (bibliography.position + bibliography.node.nodeSize === state.doc.content.size);
  const footnoteAtTail = !needsFootnoteList || (footnoteList && footnoteList.position + footnoteList.node.nodeSize === (bibliographyEnabled ? bibliography.position : state.doc.content.size));
  if (tail.footnoteLists.length === expectedFootnoteCount
    && tail.bibliographies.length === expectedBibliographyCount
    && bibliographyAtEnd
    && footnoteAtTail) return null;

  let transaction = state.tr;
  [...tail.footnoteLists, ...tail.bibliographies]
    .sort((left, right) => right.position - left.position)
    .forEach(({ position, node }) => { transaction = transaction.delete(position, position + node.nodeSize); });
  if (needsFootnoteList) {
    transaction = transaction.insert(transaction.doc.content.size, nodeTypes.paperFootnoteList.create({ entries: footnoteList?.node?.attrs?.entries || [] }));
  }
  if (bibliographyEnabled) {
    transaction = transaction.insert(transaction.doc.content.size, nodeTypes.paperBibliography.create({ entries: bibliography?.node?.attrs?.entries || [] }));
  }
  transaction.setMeta("addToHistory", false);
  transaction.setMeta("paperKnowledgeDerived", true);
  return transaction;
}

export function createKnowledgeExtensions() {
  // Tail normalization is intentionally driven only by the guarded editor
  // update listener. Running the same normalization from appendTransaction as
  // well creates two writers for the footnote list and can lock the renderer in
  // an endless transaction cycle after an inline footnote is inserted.
  return [PaperFootnoteReference, PaperCitationReference, PaperInternalLink, PaperFootnoteList, PaperBibliography, KnowledgeReferenceTrigger];
}

/**
 * Wraps the editor update listener so transactions dispatched while rebuilding
 * derived knowledge nodes cannot synchronously invoke the rebuild again.
 */
export function createKnowledgeUpdateGuard(synchronize) {
  let synchronizing = false;
  return ({ transaction } = {}) => {
    if (transaction?.getMeta?.("paperKnowledgeDerived") || transaction?.getMeta?.("paperStructuredDerived") || synchronizing) return false;
    synchronizing = true;
    try {
      synchronize();
      return true;
    } finally {
      synchronizing = false;
    }
  };
}

export function collectKnowledgeReferences(editor) {
  const links = [];
  const citations = [];
  const footnotes = [];
  editor?.state?.doc?.descendants?.((node, position) => {
    if (node.type.name === "paperInternalLink") links.push({ ...node.attrs, position });
    if (node.type.name === "paperCitationReference") citations.push({ ...node.attrs, position });
    if (node.type.name === "paperFootnoteReference") footnotes.push({ ...node.attrs, position });
  });
  return { links, citations, footnotes };
}

export function nextInternalLinkUsage(links, targetDocumentId, currentPosition = -1) {
  const targetId = safeUuid(targetDocumentId);
  if (!targetId) return null;
  const positions = (Array.isArray(links) ? links : [])
    .filter((link) => safeUuid(link?.targetDocumentId || link?.documentId) === targetId)
    .map((link) => Number(link?.position))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!positions.length) return null;
  const nextIndex = positions.findIndex((position) => position > Number(currentPosition));
  const index = nextIndex >= 0 ? nextIndex : 0;
  return { position: positions[index], current: index + 1, total: positions.length };
}

export function nextInternalLinkUsagePosition(links, targetDocumentId, currentPosition = -1) {
  return nextInternalLinkUsage(links, targetDocumentId, currentPosition)?.position ?? null;
}

export function formatCitationSource(source) {
  const authors = Array.isArray(source?.authors) ? source.authors.filter(Boolean).join("，") : "";
  const title = String(source?.title || "未命名来源");
  const publication = [source?.containerTitle, source?.publisher].filter(Boolean).join("，");
  const year = String(source?.year || "");
  const locator = source?.doi ? `DOI:${source.doi}` : source?.url || "";
  return [authors, title, publication, year, locator].filter(Boolean).join(". ");
}

/** Keeps inline numbers and non-editable tail lists derived from document order. */
export function synchronizeKnowledgeReferences(editor, metadata = [], legacyFootnotes = []) {
  if (!editor?.state?.doc) return [];
  const citationSources = Array.isArray(metadata) ? metadata : (metadata?.citationSources || []);
  const footnotes = Array.isArray(metadata) ? legacyFootnotes : (metadata?.footnotes || []);
  const tailTransaction = createKnowledgeTailTransaction(editor.state);
  if (tailTransaction) editor.view.dispatch(tailTransaction);

  const sourceById = new Map((Array.isArray(citationSources) ? citationSources : []).map((source) => [source?.id, source]));
  const footnoteById = new Map((Array.isArray(footnotes) ? footnotes : []).map((footnote) => [footnote?.id, footnote]));
  const citationNumberById = new Map();
  const footnoteNumberById = new Map();
  const citationNodes = [];
  const footnoteNodes = [];
  const bibliographyNodes = [];
  const footnoteListNodes = [];
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === "paperCitationReference") {
      const sourceId = String(node.attrs.sourceId || "");
      if (sourceId && !citationNumberById.has(sourceId)) citationNumberById.set(sourceId, citationNumberById.size + 1);
      citationNodes.push({ node, position, sourceId });
    } else if (node.type.name === "paperFootnoteReference") {
      const footnoteId = String(node.attrs.footnoteId || "");
      if (footnoteId && !footnoteNumberById.has(footnoteId)) footnoteNumberById.set(footnoteId, footnoteNumberById.size + 1);
      footnoteNodes.push({ node, position, footnoteId });
    } else if (node.type.name === "paperBibliography") bibliographyNodes.push({ node, position });
    else if (node.type.name === "paperFootnoteList") footnoteListNodes.push({ node, position });
  });
  const citationOrder = [...citationNumberById.keys()];
  const bibliographyEntries = citationOrder.map((sourceId) => {
    const source = sourceById.get(sourceId);
    return { sourceId, text: source ? formatCitationSource(source) : "来源信息缺失", missing: !source };
  });
  const footnoteEntries = [...footnoteNumberById.entries()].map(([footnoteId, number]) => {
    const footnote = footnoteById.get(footnoteId);
    return { footnoteId, number, text: footnote?.text || "脚注内容缺失", missing: !footnote };
  });

  let transaction = editor.state.tr;
  let changed = false;
  citationNodes.forEach(({ node, position, sourceId }) => {
    const number = citationNumberById.get(sourceId) || 1;
    if (Number(node.attrs.number) !== number) {
      transaction = transaction.setNodeMarkup(position, undefined, { ...node.attrs, number });
      changed = true;
    }
  });
  footnoteNodes.forEach(({ node, position, footnoteId }) => {
    const number = footnoteNumberById.get(footnoteId) || 1;
    if (Number(node.attrs.number) !== number) {
      transaction = transaction.setNodeMarkup(position, undefined, { ...node.attrs, number });
      changed = true;
    }
  });
  bibliographyNodes.forEach(({ node, position }) => {
    if (JSON.stringify(node.attrs.entries || []) !== JSON.stringify(bibliographyEntries)) {
      transaction = transaction.setNodeMarkup(position, undefined, { ...node.attrs, entries: bibliographyEntries });
      changed = true;
    }
  });
  footnoteListNodes.forEach(({ node, position }) => {
    if (JSON.stringify(node.attrs.entries || []) !== JSON.stringify(footnoteEntries)) {
      transaction = transaction.setNodeMarkup(position, undefined, { ...node.attrs, entries: footnoteEntries });
      changed = true;
    }
  });
  if (changed) {
    transaction.setMeta("addToHistory", false);
    transaction.setMeta("paperKnowledgeDerived", true);
    editor.view.dispatch(transaction);
  }
  return citationOrder;
}

export function removeKnowledgeNodesByAttribute(editor, nodeType, attribute, value) {
  if (!editor?.state?.doc || !nodeType || !attribute) return 0;
  const positions = [];
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === nodeType && node.attrs?.[attribute] === value) positions.push({ position, size: node.nodeSize });
  });
  if (!positions.length) return 0;
  let transaction = editor.state.tr;
  positions.sort((left, right) => right.position - left.position).forEach((item) => {
    transaction = transaction.delete(item.position, item.position + item.size);
  });
  editor.view.dispatch(transaction);
  return positions.length;
}

/** Remove derived numbers/lists before native persistence while retaining the bibliography toggle marker. */
export function stripDerivedKnowledgeDataFromHtml(html) {
  return String(html || "")
    .replace(/<section\b[^>]*\bdata-footnote-list\s*=\s*(?:"[^"]*"|'[^']*')[^>]*>[\s\S]*?<\/section\s*>/gi, "")
    .replace(/<sup\b([^>]*\bdata-footnote-(?:id|ref)\s*=\s*(?:"[^"]*"|'[^']*')[^>]*)>[\s\S]*?<\/sup\s*>/gi, "<sup$1></sup>")
    .replace(/<span\b([^>]*\bdata-citation-source-id\s*=\s*(?:"[^"]*"|'[^']*')[^>]*)>[\s\S]*?<\/span\s*>/gi, "<span$1></span>")
    .replace(/<section\b([^>]*\bdata-reference-list\s*=\s*(?:"[^"]*"|'[^']*')[^>]*)>[\s\S]*?<\/section\s*>/gi, (_full, attributes) => {
      const normalizedAttributes = String(attributes).replace(/\bdata-reference-list\s*=\s*(?:"[^"]*"|'[^']*')/i, 'data-reference-list="[]"');
      return `<section${normalizedAttributes}></section>`;
    });
}
