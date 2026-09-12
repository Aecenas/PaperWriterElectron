import { Extension } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";

export function inheritPastedTypography(slice) {
  const normalize = (fragment) => {
    const nodes = [];
    fragment.forEach((node) => {
      const marks = node.marks.flatMap((mark) => {
        if (mark.type.name !== "textStyle") return [mark];
        const attrs = { ...mark.attrs };
        for (const key of ["fontFamily", "fontSize"]) {
          if (Object.hasOwn(attrs, key)) attrs[key] = null;
        }
        return Object.values(attrs).some((value) => value != null && value !== "")
          ? [mark.type.create(attrs)]
          : [];
      });
      nodes.push((node.isLeaf ? node : node.copy(normalize(node.content))).mark(marks));
    });
    return Fragment.fromArray(nodes);
  };
  // Inherit template typography instead of baking the current font into the
  // document, so later template changes also apply to pasted content.
  return new Slice(normalize(slice.content), slice.openStart, slice.openEnd);
}

export const PasteTemplateTypography = Extension.create({
  name: "pasteTemplateTypography",
  addProseMirrorPlugins() {
    return [new Plugin({ props: { transformPasted: inheritPastedTypography } })];
  },
});
