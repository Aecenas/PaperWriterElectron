import { ReactNodeViewRenderer } from "@tiptap/react";
import { withEditorNodeViewConstruction } from "../editor-view-scheduler.js";

export function SafeReactNodeViewRenderer(component, options) {
  const create = ReactNodeViewRenderer(component, options);
  return (props) => withEditorNodeViewConstruction(props.editor, () => create(props));
}
