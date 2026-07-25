import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import FontFamily from "@tiptap/extension-font-family";
import Color from "@tiptap/extension-color";
import UnderlineExtension from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { DocumentSearchExtension } from "../document-search-extension.js";
import { createKnowledgeExtensions, KNOWLEDGE_TAIL_NODE_TYPES } from "../knowledge-extensions.js";
import { createStructuredInlineExtensions } from "../structured-inline-extensions.js";
import { DEFAULT_UNDERLINE_STYLE, normalizeUnderlineStyle } from "./formatting.js";
import {
  PaperFinalizedBreak,
  PaperHorizontalRule,
  PaperImage,
  PaperMedia,
  PaperPageBreak,
  PaperTableOfContents,
} from "./paper-nodes.jsx";
import {
  AiApplyPreviewDecorations,
  AiChatSelectionDecorations,
  DocumentCommentDecorations,
  HeadingMetadata,
  PaperDerivedState,
} from "./decorations.js";

export const StyledUnderlineExtension = UnderlineExtension.extend({
  addAttributes() {
    const parentAttributes = this.parent?.() || {};
    return {
      ...parentAttributes,
      style: {
        default: DEFAULT_UNDERLINE_STYLE,
        parseHTML: (element) => {
          const style = element?.dataset?.underlineStyle || element?.style?.textDecorationStyle;
          return normalizeUnderlineStyle(style);
        },
        renderHTML: (attributes) => {
          const style = normalizeUnderlineStyle(attributes.style);
          return {
            "data-underline-style": style,
            style: [
              "text-decoration-line: underline",
              `text-decoration-style: ${style}`,
              "text-decoration-thickness: 0.08em",
              "text-underline-offset: 0.16em",
            ].join("; "),
          };
        },
      },
    };
  },
});

export function createPaperEditorExtensions() {
  return [
    StarterKit.configure({
      underline: false,
      trailingNode: { notAfter: ["paragraph", ...KNOWLEDGE_TAIL_NODE_TYPES] },
      link: false,
    }),
    TextStyle,
    Color.configure({ types: ["textStyle"] }),
    StyledUnderlineExtension,
    Highlight.configure({ multicolor: true }),
    FontFamily,
    PaperDerivedState,
    HeadingMetadata,
    Table.configure({
      resizable: true,
      HTMLAttributes: { class: "paper-table" },
    }),
    TableRow,
    TableHeader,
    TableCell,
    PaperImage.configure({ allowBase64: true, inline: false }),
    PaperMedia,
    PaperPageBreak,
    PaperHorizontalRule,
    PaperFinalizedBreak,
    PaperTableOfContents,
    ...createStructuredInlineExtensions(),
    ...createKnowledgeExtensions(),
    DocumentSearchExtension,
    AiChatSelectionDecorations,
    AiApplyPreviewDecorations,
    DocumentCommentDecorations,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Placeholder.configure({ placeholder: "在这里开始写。" }),
  ];
}

