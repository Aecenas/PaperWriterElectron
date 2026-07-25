import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bold,
  Highlighter,
  Italic,
  ListOrdered,
  MessageSquare,
  Palette,
  Sparkles,
} from "lucide-react";
import { COLOR_OPTIONS, normalizeColorValue } from "../templates/index.js";
import {
  getSelectedHeadingNode,
  getSelectedPlainText,
  runEditorCommand,
  toggleSelectedHeadingNumbering,
} from "./commands.js";
import { ColorMenu, IconButton, UnderlineStyleMenu } from "./controls.jsx";
import { HEADING_NUMBERING_PLUGIN_KEY, selectionTouchesNodeType } from "./decorations.js";
import {
  BACKGROUND_COLOR_OPTIONS,
  normalizeBackgroundColorValue,
  normalizeUnderlineStyle,
} from "./formatting.js";

export function SelectionBubbleToolbar({ editor, disabled, savedSelectionRef, aiCaptureEnabled = false, onCaptureAiSelection, onCreateComment }) {
  const [toolbarPosition, setToolbarPosition] = useState(null);
  const toolbarFrameRef = useRef(0);
  const activeColor = editor?.getAttributes("textStyle")?.color || "";
  const activePaletteColor = normalizeColorValue(activeColor);
  const activeBackgroundColor = editor?.getAttributes("highlight")?.color || "";
  const activePaletteBackgroundColor = normalizeBackgroundColorValue(activeBackgroundColor);
  const activeUnderlineStyle = normalizeUnderlineStyle(editor?.getAttributes("underline")?.style);
  const selectedHeading = editor ? getSelectedHeadingNode(editor, savedSelectionRef) : null;
  const selectedHeadingNumberingMode = selectedHeading?.node?.attrs?.numberingMode || "inherit";
  const selectedHeadingLevel = Math.max(1, Math.min(3, Number(selectedHeading?.node?.attrs?.level) || 1));
  const selectedHeadingInheritedNumbering = editor
    ? HEADING_NUMBERING_PLUGIN_KEY.getState(editor.state)?.defaults?.[selectedHeadingLevel] !== false
    : true;
  const selectedHeadingEffectiveNumbering = selectedHeadingNumberingMode === "on"
    || (selectedHeadingNumberingMode === "inherit" && selectedHeadingInheritedNumbering);

  const updateToolbarPosition = useCallback(() => {
    if (!editor || disabled) {
      setToolbarPosition(null);
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setToolbarPosition(null);
      return;
    }
    if (selectionTouchesNodeType(editor, "paperTableOfContents")) {
      setToolbarPosition(null);
      return;
    }
    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    if (!anchorNode || !focusNode || !editor.view.dom.contains(anchorNode) || !editor.view.dom.contains(focusNode)) {
      setToolbarPosition(null);
      return;
    }
    const anchorElement = anchorNode.nodeType === window.Node.ELEMENT_NODE ? anchorNode : anchorNode.parentElement;
    const focusElement = focusNode.nodeType === window.Node.ELEMENT_NODE ? focusNode : focusNode.parentElement;
    if (anchorElement?.closest("[data-type='paper-toc'], .node-paperTableOfContents") || focusElement?.closest("[data-type='paper-toc'], .node-paperTableOfContents")) {
      setToolbarPosition(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const fallbackRect = Array.from(range.getClientRects()).find((clientRect) => clientRect.width || clientRect.height);
    const targetRect = rect.width || rect.height ? rect : fallbackRect;
    if (!targetRect) {
      setToolbarPosition(null);
      return;
    }
    const editorSelection = editor.state.selection;
    if (!editorSelection.empty) {
      savedSelectionRef.current = { from: editorSelection.from, to: editorSelection.to };
    }
    setToolbarPosition({
      left: targetRect.left + targetRect.width / 2,
      top: Math.max(72, targetRect.top - 12),
    });
  }, [disabled, editor, savedSelectionRef]);

  const scheduleToolbarPosition = useCallback(() => {
    if (toolbarFrameRef.current) return;
    toolbarFrameRef.current = window.requestAnimationFrame(() => {
      toolbarFrameRef.current = 0;
      updateToolbarPosition();
    });
  }, [updateToolbarPosition]);

  useEffect(() => {
    if (!editor || disabled) {
      setToolbarPosition(null);
      return undefined;
    }
    const hideWhenPointingAtToc = (event) => {
      if (event.target instanceof Element && event.target.closest("[data-type='paper-toc'], .node-paperTableOfContents")) {
        savedSelectionRef.current = null;
        setToolbarPosition(null);
      }
    };
    document.addEventListener("pointerdown", hideWhenPointingAtToc, true);
    document.addEventListener("selectionchange", scheduleToolbarPosition);
    document.addEventListener("scroll", scheduleToolbarPosition, true);
    document.addEventListener("keyup", scheduleToolbarPosition, true);
    editor.view.dom.addEventListener("mouseup", scheduleToolbarPosition);
    editor.view.dom.addEventListener("keyup", scheduleToolbarPosition);
    editor.on("selectionUpdate", scheduleToolbarPosition);
    editor.on("transaction", scheduleToolbarPosition);
    scheduleToolbarPosition();
    return () => {
      if (toolbarFrameRef.current) {
        window.cancelAnimationFrame(toolbarFrameRef.current);
        toolbarFrameRef.current = 0;
      }
      document.removeEventListener("selectionchange", scheduleToolbarPosition);
      document.removeEventListener("pointerdown", hideWhenPointingAtToc, true);
      document.removeEventListener("scroll", scheduleToolbarPosition, true);
      document.removeEventListener("keyup", scheduleToolbarPosition, true);
      editor.view.dom.removeEventListener("mouseup", scheduleToolbarPosition);
      editor.view.dom.removeEventListener("keyup", scheduleToolbarPosition);
      editor.off("selectionUpdate", scheduleToolbarPosition);
      editor.off("transaction", scheduleToolbarPosition);
    };
  }, [disabled, editor, savedSelectionRef, scheduleToolbarPosition]);

  const runSelectionCommand = useCallback(
    (command) => {
      if (!editor || disabled) {
        return;
      }
      runEditorCommand(editor, savedSelectionRef, command);
      scheduleToolbarPosition();
    },
    [disabled, editor, savedSelectionRef, scheduleToolbarPosition],
  );

  const handleTextColorChange = useCallback(
    (color) => {
      runSelectionCommand((chain) => {
      if (color) {
          return chain.setColor(color);
        }
        return chain.unsetColor();
      });
    },
    [runSelectionCommand],
  );

  const handleBackgroundColorChange = useCallback(
    (color) => {
      runSelectionCommand((chain) => {
        if (color) {
          return chain.setHighlight({ color });
      } else {
          return chain.unsetHighlight();
      }
      });
    },
    [runSelectionCommand],
  );

  const handleUnderlineStyleChange = useCallback(
    (style) => {
      runSelectionCommand((chain) => chain.setMark("underline", { style: normalizeUnderlineStyle(style) }));
    },
    [runSelectionCommand],
  );

  const handleCaptureAiSelection = useCallback(() => {
    if (!editor || disabled || !aiCaptureEnabled) {
      return;
    }
    onCaptureAiSelection?.(getSelectedPlainText(editor, savedSelectionRef));
    scheduleToolbarPosition();
  }, [aiCaptureEnabled, disabled, editor, onCaptureAiSelection, savedSelectionRef, scheduleToolbarPosition]);

  const handleCreateComment = useCallback(() => {
    if (!editor || disabled || !onCreateComment) {
      return;
    }
    onCreateComment?.(getSelectedPlainText(editor, savedSelectionRef), toolbarPosition);
    scheduleToolbarPosition();
  }, [disabled, editor, onCreateComment, savedSelectionRef, scheduleToolbarPosition, toolbarPosition]);

  if (!editor || disabled) {
    return null;
  }

  return (
    <div
      className="selection-bubble-menu"
      hidden={!toolbarPosition}
      style={toolbarPosition ? { left: `${toolbarPosition.left}px`, top: `${toolbarPosition.top}px` } : undefined}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
    >
      <IconButton
        icon={Bold}
        label="加粗"
        active={editor.isActive("bold")}
        onClick={() => runSelectionCommand((chain) => chain.toggleBold())}
      />
      <IconButton
        icon={Italic}
        label="斜体"
        active={editor.isActive("italic")}
        onClick={() => runSelectionCommand((chain) => chain.toggleItalic())}
      />
      <UnderlineStyleMenu
        active={editor.isActive("underline")}
        value={activeUnderlineStyle}
        onToggle={() => runSelectionCommand((chain) => chain.toggleUnderline())}
        onSelect={handleUnderlineStyleChange}
      />
      <span className="bubble-divider" />
      <ColorMenu icon={Palette} label="字体颜色" options={COLOR_OPTIONS} value={activePaletteColor} onSelect={handleTextColorChange} />
      <ColorMenu
        icon={Highlighter}
        label="背景颜色"
        options={BACKGROUND_COLOR_OPTIONS}
        value={activePaletteBackgroundColor}
        onSelect={handleBackgroundColorChange}
      />
      {onCreateComment ? (
        <>
          <span className="bubble-divider" />
          <IconButton
            icon={MessageSquare}
            label="评注"
            onClick={handleCreateComment}
          />
        </>
      ) : null}
      {selectedHeading ? (
        <>
          <span className="bubble-divider" />
          <IconButton
            icon={ListOrdered}
            label={selectedHeadingNumberingMode === "inherit"
              ? (selectedHeadingEffectiveNumbering ? "取消标题计数" : "恢复标题计数")
              : "恢复跟随模板"}
            active={selectedHeadingNumberingMode !== "inherit"}
            onClick={() => {
              toggleSelectedHeadingNumbering(editor, savedSelectionRef);
              window.requestAnimationFrame(updateToolbarPosition);
            }}
          />
        </>
      ) : null}
      {aiCaptureEnabled ? (
        <>
          <span className="bubble-divider" />
          <button type="button" className="selection-ai-capture" onClick={handleCaptureAiSelection} title="标记文字" aria-label="标记文字">
            <Sparkles size={14} />
            <span>标记文字</span>
          </button>
        </>
      ) : null}
    </div>
  );
}

