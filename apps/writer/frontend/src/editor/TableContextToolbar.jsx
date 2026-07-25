import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { getActiveTableElement, runTableCommand } from "./commands.js";

export function TableContextToolbar({ editor, disabled }) {
  const [toolbarPosition, setToolbarPosition] = useState(null);
  const toolbarFrameRef = useRef(0);

  const updateToolbarPosition = useCallback(() => {
    if (!editor || disabled || !editor.isActive("table")) {
      setToolbarPosition(null);
      return;
    }
    const tableElement = getActiveTableElement(editor);
    if (!tableElement) {
      setToolbarPosition(null);
      return;
    }
    const rect = tableElement.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      setToolbarPosition(null);
      return;
    }
    const nextPosition = {
      left: Math.min(window.innerWidth - 16, rect.right - 8),
      top: Math.max(86, rect.top - 8),
    };
    setToolbarPosition((current) => (
      current?.left === nextPosition.left && current?.top === nextPosition.top ? current : nextPosition
    ));
  }, [disabled, editor]);

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
      document.removeEventListener("scroll", scheduleToolbarPosition, true);
      document.removeEventListener("keyup", scheduleToolbarPosition, true);
      editor.view.dom.removeEventListener("mouseup", scheduleToolbarPosition);
      editor.view.dom.removeEventListener("keyup", scheduleToolbarPosition);
      editor.off("selectionUpdate", scheduleToolbarPosition);
      editor.off("transaction", scheduleToolbarPosition);
    };
  }, [disabled, editor, scheduleToolbarPosition]);

  const runCommand = useCallback((command) => {
    if (!editor || disabled) {
      return;
    }
    runTableCommand(editor, command);
    scheduleToolbarPosition();
  }, [disabled, editor, scheduleToolbarPosition]);

  if (!editor || disabled) {
    return null;
  }

  return (
    <div
      className="table-context-toolbar"
      hidden={!toolbarPosition}
      style={toolbarPosition ? { left: `${toolbarPosition.left}px`, top: `${toolbarPosition.top}px` } : undefined}
      onMouseDown={(event) => event.preventDefault()}
    >
      <button type="button" onClick={() => runCommand("addRowBefore")} title="上方插入行" aria-label="上方插入行">
        <Plus size={13} />
        <span>上行</span>
      </button>
      <button type="button" onClick={() => runCommand("addRowAfter")} title="下方插入行" aria-label="下方插入行">
        <Plus size={13} />
        <span>下行</span>
      </button>
      <button type="button" onClick={() => runCommand("deleteRow")} title="删除当前行" aria-label="删除当前行">
        <Trash2 size={13} />
        <span>行</span>
      </button>
      <i aria-hidden="true" />
      <button type="button" onClick={() => runCommand("addColumnBefore")} title="左侧插入列" aria-label="左侧插入列">
        <Plus size={13} />
        <span>左列</span>
      </button>
      <button type="button" onClick={() => runCommand("addColumnAfter")} title="右侧插入列" aria-label="右侧插入列">
        <Plus size={13} />
        <span>右列</span>
      </button>
      <button type="button" onClick={() => runCommand("deleteColumn")} title="删除当前列" aria-label="删除当前列">
        <Trash2 size={13} />
        <span>列</span>
      </button>
      <i aria-hidden="true" />
      <button type="button" className="danger" onClick={() => runCommand("deleteTable")} title="删除表格" aria-label="删除表格">
        <Trash2 size={13} />
      </button>
    </div>
  );
}

