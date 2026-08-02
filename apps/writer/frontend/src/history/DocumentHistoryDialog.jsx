import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  History,
  Pencil,
  RotateCcw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { bridge as defaultBridge } from "../bridge.js";
import {
  createHistoryDiff,
  filterCurrentAutomaticHistoryEntries,
  formatHistoryTime,
  historyEntryLabel,
} from "./model.js";
import { useModalFocusTrap } from "../ui-interactions.js";

function InlineDiff({ parts, emptyLabel }) {
  if (!parts.length) return <span className="history-diff-empty-cell">{emptyLabel}</span>;
  return parts.map((part) => (
    <span key={part.id} className={`diff-${part.kind}`}>{part.value}</span>
  ));
}

function SplitMetadataDiff({ field }) {
  return (
    <section className="history-split-diff history-field-diff" aria-label={`${field.label}差异`}>
      <header><span>{field.label}</span></header>
      <div className="history-diff-column-headings" aria-hidden="true">
        <span />
        <strong>历史版本</strong>
        <span />
        <strong>当前版本</strong>
      </div>
      <div className="history-split-row history-metadata-row">
        <span className="history-line-number">−</span>
        <div className="history-split-cell is-removed">{field.before || "（空）"}</div>
        <span className="history-line-number">+</span>
        <div className="history-split-cell is-added">{field.after || "（空）"}</div>
      </div>
    </section>
  );
}

export function DocumentHistoryDialog({
  open,
  bridge = defaultBridge,
  document,
  filePath,
  diskRevision,
  returnFocusRef,
  onClose,
  onPrepareOperation,
  onRestored,
  onError,
  showConfirmDialog,
}) {
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const [entries, setEntries] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const documentId = document?.documentId || "";
  const currentSha256 = diskRevision?.sha256 || "";
  useModalFocusTrap(open, dialogRef, closeButtonRef, returnFocusRef);

  const refresh = useCallback(async () => {
    if (!documentId) return;
    setLoading(true);
    try {
      const result = await bridge.listDocumentHistory?.(documentId, currentSha256);
      const next = await filterCurrentAutomaticHistoryEntries(result?.entries, {
        currentDocument: document,
        readSnapshot: async (entry) => (
          await bridge.readDocumentHistory?.({ documentId, entryId: entry.id })
        )?.document,
      });
      setEntries(next);
      setSelectedId((current) => (
        next.some((entry) => entry.id === current) ? current : (next[0]?.id || "")
      ));
    } catch (error) {
      onError?.(error);
    } finally {
      setLoading(false);
    }
  }, [bridge, currentSha256, document, documentId, onError]);

  useEffect(() => {
    if (!open) return undefined;
    void refresh();
    return undefined;
  }, [open, refresh]);

  useEffect(() => {
    if (!open || !selectedId) {
      setSnapshot(null);
      return undefined;
    }
    let active = true;
    setLoading(true);
    bridge.readDocumentHistory?.({ documentId, entryId: selectedId })
      .then((result) => {
        if (active) setSnapshot(result?.document || null);
      })
      .catch((error) => onError?.(error))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [bridge, documentId, onError, open, selectedId]);

  const selected = entries.find((entry) => entry.id === selectedId);
  const diff = useMemo(() => createHistoryDiff(document, snapshot), [document, snapshot]);
  const changeCount = diff.fields.length + diff.contentRows.length;

  if (!open) return null;
  const run = async (task) => {
    setBusy(true);
    try {
      await task();
      await refresh();
    } catch (error) {
      onError?.(error);
    } finally {
      setBusy(false);
    }
  };
  return createPortal(
    <div
      className="dialog-scrim history-dialog-layer"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose?.();
      }}
    >
      <section ref={dialogRef} className="history-dialog" role="dialog" aria-modal="true" aria-labelledby="history-dialog-title" aria-describedby="history-dialog-description" onKeyDown={(event) => {
        if (event.key !== "Escape" || busy) return;
        if (renaming) {
          setRenaming(false);
          return;
        }
        onClose?.();
        }}>
        <header className="history-dialog-titlebar">
          <div className="history-dialog-titlecopy">
            <span className="history-dialog-title-icon" aria-hidden="true"><History size={19} /></span>
            <div>
              <h2 id="history-dialog-title">版本历史</h2>
              <p id="history-dialog-description">查看更改、重命名版本，或恢复到先前内容</p>
            </div>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} disabled={busy} aria-label="关闭版本历史"><X size={18} /></button>
        </header>
        <div className="history-dialog-body">
          <aside className="history-timeline">
            <div className="history-timeline-heading">
              <span>版本</span>
            </div>
            <div className="history-entry-list">
              {loading && !entries.length ? <p>正在读取历史…</p> : null}
              {!loading && !entries.length ? <p>保存文档后会在这里出现自动版本。</p> : null}
              {entries.map((entry) => (
                  <div key={entry.id} className={selectedId === entry.id ? "history-entry-row active" : "history-entry-row"}>
                    <button
                      type="button"
                      className="history-entry"
                      aria-current={selectedId === entry.id ? "true" : undefined}
                      onClick={() => {
                        setSelectedId(entry.id);
                        setRenaming(false);
                      }}
                    >
                      <span>
                        <strong>{historyEntryLabel(entry)}</strong>
                        <small>{formatHistoryTime(entry.savedAt ?? entry.createdAt)}</small>
                      </span>
                    </button>
                  </div>
              ))}
            </div>
            <button type="button" className="history-clear-all" disabled={busy || !entries.length} onClick={async () => {
              const decision = await showConfirmDialog?.({
                tone: "warning",
                icon: Trash2,
                eyebrow: "版本历史",
                title: "清除全部历史版本？",
                message: `将永久删除这封信笺的 ${entries.length} 个历史版本。`,
                detail: "当前文档不会改变，但删除后的历史版本无法恢复。",
                cancelValue: "cancel",
                actions: [
                  { value: "clear", label: "全部清除", variant: "danger", icon: Trash2 },
                  { value: "cancel", label: "取消", variant: "secondary", autoFocus: true },
                ],
              });
              if (decision !== "clear") return;
              void run(async () => {
                await bridge.clearDocumentHistory?.(documentId);
                setSnapshot(null);
              });
            }}>
              <Trash2 size={14} />全部清除
            </button>
          </aside>
          <main className="history-preview">
            {!selected || !snapshot ? (
              <div className="history-empty"><History size={24} /><p>选择一个版本查看差异。</p></div>
            ) : (
              <>
                <header className="history-diff-heading">
                  <div>
                    <h2>{historyEntryLabel(selected)}</h2>
                    <small>{formatHistoryTime(selected.savedAt ?? selected.createdAt)} · {changeCount ? `${changeCount} 处更改` : "没有更改"}</small>
                  </div>
                </header>
                <div className="history-diff-scroll">
                  {diff.fields.map((field) => <SplitMetadataDiff key={field.label} field={field} />)}
                  {diff.contentRows.length ? (
                    <section className="history-split-diff history-content-diff" aria-label="正文差异">
                      <header>
                        <span>正文</span>
                        <small>{diff.contentRows.length} 行更改</small>
                      </header>
                      <div className="history-diff-column-headings" aria-hidden="true">
                        <span />
                        <strong>历史版本</strong>
                        <span />
                        <strong>当前版本</strong>
                      </div>
                      <div className="history-content-diff-rows">
                        {diff.contentRows.map((row) => (
                          <div key={row.id} className={`history-split-row is-${row.kind}`}>
                            <span className="history-line-number">{row.beforeLine || ""}</span>
                            <div className={`history-split-cell${row.before ? " is-removed" : " is-empty"}`}>
                              <InlineDiff parts={row.beforeParts} emptyLabel="此处无内容" />
                            </div>
                            <span className="history-line-number">{row.afterLine || ""}</span>
                            <div className={`history-split-cell${row.after ? " is-added" : " is-empty"}`}>
                              <InlineDiff parts={row.afterParts} emptyLabel="此处无内容" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : null}
                  {!diff.changed ? (
                    <div className="history-no-diff" role="status">
                      <span aria-hidden="true"><Check size={18} /></span>
                      <strong>没有可见变化</strong>
                      <small>正文、排版与媒体呈现均和当前版本一致</small>
                    </div>
                  ) : null}
                </div>
                <footer>
                  {renaming ? (
                    <form className="history-footer-rename" onSubmit={(event) => {
                      event.preventDefault();
                      const name = renameValue.trim();
                      if (name === (selected.name || "")) return;
                      void run(async () => {
                        await bridge.updateDocumentHistory?.({
                          documentId,
                          entryId: selected.id,
                          name,
                          pinned: selected.pinned,
                        });
                        setRenaming(false);
                      });
                    }}>
                      <input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} placeholder="输入版本名称" aria-label="版本名称" maxLength={200} />
                      <button type="submit" disabled={busy || renameValue.trim() === (selected.name || "")}><Save size={14} />保存</button>
                      <button type="button" disabled={busy} onClick={() => setRenaming(false)}>取消</button>
                    </form>
                  ) : null}
                  <div className="history-footer-actions">
                    <button type="button" className="history-rename-action" disabled={busy} onClick={() => {
                      setRenameValue(selected.name || "");
                      setRenaming(true);
                    }}><Pencil size={14} />修改名称</button>
                    <button type="button" className="history-delete-action" disabled={busy} onClick={async () => {
                      const decision = await showConfirmDialog?.({
                        tone: "warning",
                        icon: Trash2,
                        eyebrow: "版本历史",
                        title: "删除这个历史版本？",
                        message: `“${historyEntryLabel(selected)}”将从版本历史中永久移除。`,
                        detail: "当前文档不会改变，但删除后的历史版本无法恢复。",
                        cancelValue: "cancel",
                        actions: [
                          { value: "delete", label: "删除版本", variant: "danger", icon: Trash2 },
                          { value: "cancel", label: "取消", variant: "secondary", autoFocus: true },
                        ],
                      });
                      if (decision !== "delete") return;
                      void run(async () => {
                        await bridge.deleteDocumentHistory?.({ documentId, entryId: selected.id });
                        setSnapshot(null);
                      });
                    }}><Trash2 size={14} />删除版本</button>
                    <button type="button" className="history-restore" disabled={busy || !filePath} onClick={async () => {
                      const decision = await showConfirmDialog?.({
                        tone: "warning",
                        icon: RotateCcw,
                        eyebrow: "版本历史",
                        title: "恢复到这个历史版本？",
                        message: `当前文档将恢复为“${historyEntryLabel(selected)}”保存时的内容。`,
                        detail: "恢复前会自动保留一份安全版本，之后仍可回到当前内容。",
                        cancelValue: "cancel",
                        actions: [
                          { value: "restore", label: "恢复此版本", variant: "primary", icon: RotateCcw },
                          { value: "cancel", label: "取消", variant: "secondary", autoFocus: true },
                        ],
                      });
                      if (decision !== "restore") return;
                      void run(async () => {
                        const prepared = await onPrepareOperation?.({
                          action: "restore",
                          documentId,
                          entryId: selected.id,
                        });
                        const targetPath = prepared?.filePath || filePath;
                        const expectedRevision = prepared?.diskRevision
                          || diskRevision
                          || null;
                        if (!targetPath || !expectedRevision) {
                          throw new Error("无法确认当前文件版本，恢复操作已取消");
                        }
                        const result = await bridge.restoreDocumentHistory?.({
                          documentId,
                          entryId: selected.id,
                          targetPath,
                          expectedRevision,
                        });
                        await onRestored?.(result);
                      });
                    }}><RotateCcw size={15} />恢复此版本</button>
                  </div>
                </footer>
              </>
            )}
          </main>
        </div>
      </section>
    </div>,
    window.document.body,
  );
}
