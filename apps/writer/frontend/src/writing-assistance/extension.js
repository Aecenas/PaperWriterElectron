import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const writingAssistancePluginKey = new PluginKey("paperWritingAssistance");

function decorationsFromIssues(doc, issues) {
  const decorations = [];
  const size = Number(doc?.content?.size || 0);
  for (const issue of Array.isArray(issues) ? issues : []) {
    const from = Number(issue?.from);
    const to = Number(issue?.to);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > size + 1) continue;
    decorations.push(Decoration.inline(from, to, {
      class: "writing-assistance-issue",
      "data-writing-issue-id": String(issue.id || ""),
      "data-writing-issue-kind": String(issue.kind || "terminology"),
      title: issue.preferred ? `建议改为：${issue.preferred}` : "写作检查建议",
    }));
  }
  return DecorationSet.create(doc, decorations);
}

export const WritingAssistanceDecorations = Extension.create({
  name: "paperWritingAssistanceDecorations",

  addCommands() {
    return {
      setWritingAssistanceIssues: (issues) => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(writingAssistancePluginKey, { issues }));
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: writingAssistancePluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(transaction, decorations) {
            const payload = transaction.getMeta(writingAssistancePluginKey);
            if (payload && Array.isArray(payload.issues)) {
              return decorationsFromIssues(transaction.doc, payload.issues);
            }
            return decorations.map(transaction.mapping, transaction.doc);
          },
        },
        props: {
          decorations(state) {
            return writingAssistancePluginKey.getState(state);
          },
        },
      }),
    ];
  },
});

export function publishWritingIssues(editor, issues) {
  if (!editor || editor.isDestroyed) return false;
  if (typeof editor.commands?.setWritingAssistanceIssues === "function") {
    return editor.commands.setWritingAssistanceIssues(issues) !== false;
  }
  const transaction = editor.state?.tr?.setMeta?.(writingAssistancePluginKey, { issues });
  if (!transaction || !editor.view?.dispatch) return false;
  editor.view.dispatch(transaction);
  return true;
}

