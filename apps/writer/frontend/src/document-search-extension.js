import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const documentSearchPluginKey = new PluginKey("paperDocumentSearch");

export const DocumentSearchExtension = Extension.create({
  name: "paperDocumentSearch",
  addProseMirrorPlugins() {
    return [new Plugin({
      key: documentSearchPluginKey,
      state: {
        init: () => DecorationSet.empty,
        apply(transaction, previous) {
          const payload = transaction.getMeta(documentSearchPluginKey);
          if (!payload) return transaction.docChanged ? previous.map(transaction.mapping, transaction.doc) : previous;
          if (!Array.isArray(payload.matches) || !payload.matches.length) return DecorationSet.empty;
          const maximum = transaction.doc.content.size;
          const decorations = payload.matches.flatMap((match, index) => {
            const from = Math.max(0, Math.min(maximum, Number(match?.from) || 0));
            const to = Math.max(from, Math.min(maximum, Number(match?.to) || 0));
            if (to <= from) return [];
            return [Decoration.inline(from, to, {
              class: index === payload.activeIndex ? "paper-search-match paper-search-match-current" : "paper-search-match",
              "data-search-match": String(index),
            })];
          });
          return DecorationSet.create(transaction.doc, decorations);
        },
      },
      props: {
        decorations(state) {
          return documentSearchPluginKey.getState(state);
        },
      },
    })];
  },
});

export function renderDocumentSearchState(editor, searchState) {
  if (!editor || editor.isDestroyed || !editor.view) return;
  editor.view.dispatch(editor.state.tr.setMeta(documentSearchPluginKey, {
    matches: searchState?.matches || [],
    activeIndex: Number(searchState?.activeIndex) || 0,
  }));
  const match = searchState?.activeMatch;
  if (match && Number.isFinite(match.from)) {
    const dom = editor.view.domAtPos(Math.max(0, match.from))?.node;
    const element = dom?.nodeType === 1 ? dom : dom?.parentElement;
    element?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }
}

export function scheduleDocumentSearchState(editor, searchState) {
  let canceled = false;
  // React node views flush effects while ProseMirror is rebuilding its view
  // tree. Dispatch only after that stack unwinds, using a fresh transaction.
  queueMicrotask(() => {
    if (!canceled) renderDocumentSearchState(editor, searchState);
  });
  return () => { canceled = true; };
}
