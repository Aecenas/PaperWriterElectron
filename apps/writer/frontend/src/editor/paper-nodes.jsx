import { useCallback, useEffect, useRef } from "react";
import { mergeAttributes, Node } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { NodeViewWrapper, ReactNodeViewRenderer, useEditorState } from "@tiptap/react";
import Image from "@tiptap/extension-image";
import { Copy, Music2, Video } from "lucide-react";
import tocTitleSignatureAsset from "../assets/decor/toc-title-signature.png?inline";
import {
  IMAGE_CAPTION_MAX_CHARS,
  normalizeImageCaption,
  normalizeImageText,
  normalizeMediaFileName,
  normalizeMediaMime,
} from "../content-limits.js";
import { normalizeDocumentId } from "../document-schema-v2.js";
import {
  SAFE_EMBED_WIDTHS,
  normalizeEmbedWidth,
  normalizeImageSource,
  normalizeMediaSource,
} from "../resource-safety.js";
import {
  HEADING_NUMBERING_PLUGIN_KEY,
  PAPER_DERIVED_STATE_PLUGIN_KEY,
  getPaperDerivedState,
  numberHeadingItems,
} from "./decorations.js";

export const IMAGE_WIDTH_OPTIONS = [
  { label: "小", value: SAFE_EMBED_WIDTHS[0] },
  { label: "中", value: SAFE_EMBED_WIDTHS[1] },
  { label: "大", value: SAFE_EMBED_WIDTHS[2] },
  { label: "满", value: SAFE_EMBED_WIDTHS[3] },
];

export const DECOR_ASSETS = {
  // Keep document-owned decoration self-contained. The asset packager converts
  // this data URL into an assets/... entry whenever a table of contents is saved.
  tocTitleSignature: tocTitleSignatureAsset,
};

export function resizeCaptionField(field) {
  if (!field) {
    return;
  }
  field.style.height = "0px";
  field.style.height = `${Math.max(24, field.scrollHeight)}px`;
}

export function parsedImageElement(element) {
  if (element?.matches?.("img")) {
    return element;
  }
  return element?.querySelector?.("img") || null;
}

export function PaperImageNodeView({ node, updateAttributes, selected, editor, getPos }) {
  const width = normalizeEmbedWidth(node.attrs.width);
  const source = normalizeImageSource(node.attrs.src);
  const caption = normalizeImageCaption(node.attrs.caption);
  const alt = normalizeImageText(node.attrs.alt);
  const title = normalizeImageText(node.attrs.title);
  const imageId = normalizeDocumentId(node.attrs.imageId);
  const readOnly = !editor?.isEditable;
  const captionRef = useRef(null);

  useEffect(() => {
    resizeCaptionField(captionRef.current);
    const animationFrame = window.requestAnimationFrame(() => resizeCaptionField(captionRef.current));
    const timer = window.setTimeout(() => resizeCaptionField(captionRef.current), 80);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(timer);
    };
  }, [caption]);

  return (
    <NodeViewWrapper
      as="figure"
      className={selected ? "paper-image-figure selected" : "paper-image-figure"}
      data-type="paper-image"
      data-image-id={imageId}
      data-width={width}
      style={{ "--image-width": width }}
    >
      <div className="paper-image-frame" contentEditable={false}>
        <img src={source || undefined} alt={alt} title={title} draggable={false} decoding="async" />
        <div className="image-size-tools" aria-label="调整图片大小">
          {IMAGE_WIDTH_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={width === option.value ? "active" : ""}
              title={`图片宽度 ${option.value}`}
              disabled={readOnly}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => updateAttributes({ width: option.value })}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            className="image-copy-reference"
            title="复制图片引用"
            aria-label="复制图片引用"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              let position = null;
              try { position = typeof getPos === "function" ? getPos() : null; } catch {}
              window.dispatchEvent(new CustomEvent("paper-image-reference-copy", { detail: {
                editorDom: editor?.view?.dom,
                imageId,
                position,
              } }));
            }}
          >
            <Copy size={13} aria-hidden="true" />
            <span>引用</span>
          </button>
        </div>
      </div>
      <label className="paper-image-caption-row" contentEditable={false}>
        <span className="paper-image-caption-prefix" aria-hidden="true" />
        <textarea
          ref={captionRef}
          className="paper-image-caption"
          value={caption}
          readOnly={readOnly}
          maxLength={IMAGE_CAPTION_MAX_CHARS}
          rows={1}
          onChange={(event) => {
            updateAttributes({ caption: normalizeImageCaption(event.target.value) });
            resizeCaptionField(event.currentTarget);
          }}
          aria-label="图片标题"
          placeholder="添加图片标题"
          spellCheck={false}
        />
      </label>
    </NodeViewWrapper>
  );
}

export const PaperImage = Image.extend({
  addAttributes() {
    const parentAttributes = this.parent?.() || {};
    return {
      ...parentAttributes,
      src: {
        ...parentAttributes.src,
        parseHTML: (element) => normalizeImageSource(parsedImageElement(element)?.getAttribute("src")) || null,
      },
      alt: {
        ...parentAttributes.alt,
        parseHTML: (element) => normalizeImageText(parsedImageElement(element)?.getAttribute("alt")),
      },
      title: {
        ...parentAttributes.title,
        parseHTML: (element) => normalizeImageText(parsedImageElement(element)?.getAttribute("title")),
      },
      width: {
        default: "78%",
        parseHTML: (element) => normalizeEmbedWidth(element.getAttribute("data-width") || element.style.width),
      },
      caption: {
        default: "",
        parseHTML: (element) => normalizeImageCaption(element.getAttribute("data-caption") || element.querySelector("figcaption")?.textContent?.trim()),
      },
      imageId: {
        default: "",
        parseHTML: (element) => normalizeDocumentId(element.getAttribute("data-image-id")),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "figure[data-type='paper-image']",
        getAttrs: (element) => {
          const image = element.querySelector("img");
          const source = normalizeImageSource(image?.getAttribute("src"));
          if (!source) {
            return false;
          }
          return {
            src: source,
            alt: normalizeImageText(image.getAttribute("alt")),
            title: normalizeImageText(image.getAttribute("title")),
            width: normalizeEmbedWidth(element.getAttribute("data-width") || element.style.getPropertyValue("--image-width")),
            caption: normalizeImageCaption(element.getAttribute("data-caption") || element.querySelector("figcaption")?.textContent?.trim()),
            imageId: normalizeDocumentId(element.getAttribute("data-image-id")),
          };
        },
      },
      {
        tag: "img[src]",
        getAttrs: (element) => {
          const source = normalizeImageSource(element.getAttribute("src"));
          return source ? {
            src: source,
            alt: normalizeImageText(element.getAttribute("alt")),
            title: normalizeImageText(element.getAttribute("title")),
            width: normalizeEmbedWidth(element.getAttribute("data-width") || element.style.width),
            caption: "",
            imageId: normalizeDocumentId(element.getAttribute("data-image-id")),
          } : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { width = "78%", caption = "", imageId = "", ...imageAttrs } = HTMLAttributes;
    const safeWidth = normalizeEmbedWidth(width);
    const safeCaption = normalizeImageCaption(caption);
    const safeImageId = normalizeDocumentId(imageId);
    const source = normalizeImageSource(imageAttrs.src);
    imageAttrs.alt = normalizeImageText(imageAttrs.alt);
    imageAttrs.title = normalizeImageText(imageAttrs.title);
    delete imageAttrs.style;
    if (source) imageAttrs.src = source;
    else delete imageAttrs.src;
    return [
      "figure",
      {
        "data-type": "paper-image",
        "data-image-id": safeImageId,
        "data-width": safeWidth,
        "data-caption": safeCaption,
        class: "paper-image-figure",
        style: `--image-width: ${safeWidth};`,
      },
      ["img", mergeAttributes({ decoding: "async" }, imageAttrs)],
      ["figcaption", { "data-placeholder": "添加图片标题" }, safeCaption],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PaperImageNodeView);
  },
});

export function PaperMediaNodeView({ node, updateAttributes, selected, editor }) {
  const kind = node.attrs.kind === "video" ? "video" : "audio";
  const width = normalizeEmbedWidth(node.attrs.width);
  const source = normalizeMediaSource(node.attrs.src, kind);
  const fileName = normalizeMediaFileName(node.attrs.fileName, kind === "video" ? "未命名视频" : "未命名音频");
  const MediaIcon = kind === "video" ? Video : Music2;
  const mediaLabel = kind === "video" ? "视频" : "音频";
  const readOnly = !editor?.isEditable;

  return (
    <NodeViewWrapper
      as="figure"
      className={["paper-media-figure", kind, selected ? "selected" : ""].filter(Boolean).join(" ")}
      data-type="paper-media"
      data-kind={kind}
      data-width={width}
      style={{ "--media-width": kind === "video" ? width : "100%" }}
    >
      <div className="paper-media-frame" contentEditable={false}>
        {kind === "video" ? (
          <video className="paper-media-player" src={source || undefined} controls preload="metadata" aria-label={`播放视频：${fileName}`} onMouseDown={(event) => event.stopPropagation()} />
        ) : (
          <audio className="paper-media-player" src={source || undefined} controls preload="metadata" aria-label={`播放音频：${fileName}`} onMouseDown={(event) => event.stopPropagation()} />
        )}
        {kind === "video" ? (
          <div className="media-size-tools" aria-label="调整视频大小">
            {IMAGE_WIDTH_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={width === option.value ? "active" : ""}
                title={`视频宽度 ${option.value}`}
                disabled={readOnly}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => updateAttributes({ width: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <figcaption className="paper-media-caption" contentEditable={false}>
        <MediaIcon size={15} aria-hidden="true" />
        <strong>{fileName}</strong>
        <span>{mediaLabel}</span>
      </figcaption>
      <div className="paper-media-export-card" contentEditable={false}>
        <MediaIcon size={22} aria-hidden="true" />
        <span>
          <strong>{mediaLabel}：{fileName}</strong>
          <em>仅在电子文档中可播放</em>
        </span>
      </div>
    </NodeViewWrapper>
  );
}

export const PaperMedia = Node.create({
  name: "paperMedia",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      kind: { default: "audio" },
      src: { default: "" },
      fileName: { default: "" },
      mime: { default: "" },
      width: { default: "78%" },
    };
  },

  parseHTML() {
    return [{
      tag: "figure[data-type='paper-media']",
      getAttrs: (element) => {
        const player = element.querySelector("audio[src], video[src]");
        if (!player) {
          return false;
        }
        const kind = player.tagName.toLowerCase() === "video" ? "video" : "audio";
        const source = normalizeMediaSource(player.getAttribute("src"), kind);
        if (!source) return false;
        return {
          kind,
          src: source,
          fileName: normalizeMediaFileName(element.getAttribute("data-file-name")),
          mime: normalizeMediaMime(element.getAttribute("data-mime"), kind),
          width: normalizeEmbedWidth(element.getAttribute("data-width")),
        };
      },
    }];
  },

  renderHTML({ HTMLAttributes }) {
    const kind = HTMLAttributes.kind === "video" ? "video" : "audio";
    const fileName = normalizeMediaFileName(HTMLAttributes.fileName, kind === "video" ? "未命名视频" : "未命名音频");
    const mediaLabel = kind === "video" ? "视频" : "音频";
    const width = normalizeEmbedWidth(HTMLAttributes.width);
    const source = normalizeMediaSource(HTMLAttributes.src, kind);
    const mime = normalizeMediaMime(HTMLAttributes.mime, kind);
    return [
      "figure",
      {
        "data-type": "paper-media",
        "data-kind": kind,
        "data-file-name": fileName,
        "data-mime": mime,
        "data-width": width,
        class: `paper-media-figure ${kind}`,
        style: `--media-width: ${kind === "video" ? width : "100%"};`,
      },
      [kind, { ...(source ? { src: source } : {}), controls: "controls", preload: "metadata", class: "paper-media-player", "aria-label": `播放${mediaLabel}：${fileName}` }],
      ["figcaption", { class: "paper-media-caption" }, `${mediaLabel} · ${fileName}`],
      ["div", { class: "paper-media-export-card" }, ["strong", `${mediaLabel}：${fileName}`], ["span", "仅在电子文档中可播放"]],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PaperMediaNodeView);
  },
});

export const PaperPageBreak = Node.create({
  name: "paperPageBreak",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  parseHTML() {
    return [{ tag: "div[data-type='paper-page-break']" }];
  },

  renderHTML() {
    return [
      "div",
      mergeAttributes({
        "data-type": "paper-page-break",
        class: "paper-page-break",
        contenteditable: "false",
      }),
      ["span", {}, "分页符"],
    ];
  },
});

export const PaperHorizontalRule = Node.create({
  name: "paperHorizontalRule",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  parseHTML() {
    return [{ tag: "div[data-type='paper-horizontal-rule']" }];
  },

  renderHTML() {
    return [
      "div",
      mergeAttributes({
        "data-type": "paper-horizontal-rule",
        class: "paper-horizontal-rule",
        contenteditable: "false",
      }),
    ];
  },
});

export const PaperFinalizedBreak = Node.create({
  name: "paperFinalizedBreak",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  parseHTML() {
    return [{ tag: "div[data-type='paper-finalized-break']" }];
  },

  renderHTML() {
    return [
      "div",
      mergeAttributes({
        "data-type": "paper-finalized-break",
        class: "paper-finalized-break",
        contenteditable: "false",
      }),
      ["span", {}, "定稿线"],
    ];
  },
});

export function PaperTocNodeView({ editor, selected, getPos }) {
  const headings = useEditorState({
    editor,
    selector: ({ editor: activeEditor }) => {
      if (!activeEditor) return [];
      const numberingDefaults = HEADING_NUMBERING_PLUGIN_KEY.getState(activeEditor.state)?.defaults;
      return numberHeadingItems(getPaperDerivedState(activeEditor).headingItems, numberingDefaults);
    },
  }) || [];

  const jumpToHeading = useCallback(
    (pos) => {
      if (!editor) {
        return;
      }
      const selectionPos = Math.min(pos + 1, editor.state.doc.content.size);
      editor.chain().focus().setTextSelection(selectionPos).scrollIntoView().run();
    },
    [editor],
  );

  const preventTocSelection = useCallback(
    (event) => {
      if (event.target instanceof Element && event.target.closest("button")) {
        return;
      }
      event.preventDefault();
      const tocPos = typeof getPos === "function" ? getPos() : 0;
      const tocNode = editor?.state.doc.nodeAt(tocPos);
      const selectionPos = Math.min(tocPos + (tocNode?.nodeSize || 1), editor?.state.doc.content.size || 0);
      if (editor && selectionPos >= 0) {
        editor.chain().focus().setTextSelection(selectionPos).run();
      }
    },
    [editor, getPos],
  );

  return (
    <NodeViewWrapper
      as="section"
      className={selected ? "paper-toc selected" : "paper-toc"}
      data-type="paper-toc"
      contentEditable={false}
      onMouseDown={preventTocSelection}
    >
      <h2 className="paper-toc-title" aria-label="目录">
        <img src={DECOR_ASSETS.tocTitleSignature} alt="" aria-hidden="true" />
        <span>目录</span>
      </h2>
      {headings.length ? (
        <ol className="paper-toc-list">
          {headings.map((heading) => (
            <li key={heading.id} className={`level-${heading.level}`}>
              <button type="button" onClick={() => jumpToHeading(heading.pos)}>
                <span className="paper-toc-number">{heading.number}</span>
                <span className="paper-toc-text">{heading.text}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p>还没有可生成目录的标题。</p>
      )}
    </NodeViewWrapper>
  );
}

export const PaperTableOfContents = Node.create({
  name: "paperTableOfContents",
  group: "block",
  atom: true,
  selectable: false,

  parseHTML() {
    return [{ tag: "section[data-type='paper-toc'], div[data-type='paper-toc']" }];
  },

  renderHTML() {
    return [
      "section",
      mergeAttributes({
        "data-type": "paper-toc",
        class: "paper-toc",
        contenteditable: "false",
      }),
      ["h2", { class: "paper-toc-title", "aria-label": "目录" }, [
        "img",
        { src: DECOR_ASSETS.tocTitleSignature, alt: "", "aria-hidden": "true" },
      ], ["span", {}, "目录"]],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PaperTocNodeView);
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (_transactions, _oldState, newState) => {
          const nodeType = newState.schema.nodes.paperTableOfContents;
          if (!nodeType) {
            return null;
          }
          const positions = PAPER_DERIVED_STATE_PLUGIN_KEY.getState(newState)?.tableOfContentsPositions || [];
          if (!positions.length || (positions.length === 1 && positions[0].pos === 0)) {
            return null;
          }
          const tr = newState.tr;
          positions
            .slice()
            .reverse()
            .forEach(({ pos, nodeSize }) => {
              tr.delete(pos, pos + nodeSize);
            });
          tr.insert(0, nodeType.create());
          return tr;
        },
      }),
    ];
  },
});
