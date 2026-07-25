import { useEditorState } from "@tiptap/react";
import { Eraser } from "lucide-react";
import { getPaperDerivedState } from "../editor/index.js";
import { EMPTY_PAPER_DERIVED_STATE } from "../editor-derived-state.js";
import { ICON_ASSETS } from "./assets.js";
import {
  formatCacheBytes,
  formatClock,
  getUpdateStatusMeta,
} from "./status-display.js";

export function LiveStatusMetric({ editor, field, label }) {
  const value = useEditorState({
    editor,
    selector: ({ editor: activeEditor }) => getPaperDerivedState(activeEditor).stats[field],
  });
  const fallback = EMPTY_PAPER_DERIVED_STATE.stats[field] || 0;
  return (
    <span className={`status-metric ${field}`}>
      <strong>{(Number.isFinite(value) ? value : fallback).toLocaleString()}</strong>
      <em>{label}</em>
    </span>
  );
}

export function StatusBar({ editor, updatedAt, dirty, version, cacheSummary, updateState, onRunUpdate, onClearCache, onOpenReleaseNotes, persistenceState = "workspace", externalVersion = false, readOnly = false }) {
  const cacheBytes = cacheSummary?.bytes || 0;
  const cacheCount = cacheSummary?.count || 0;
  const updateMeta = getUpdateStatusMeta(updateState);
  const persistenceLabel = readOnly
    ? "未来格式 · 只读"
    : (externalVersion || persistenceState === "external")
      ? "检测到外部版本"
      : persistenceState === "recovery"
        ? "已写入恢复缓存"
        : persistenceState === "workspace"
          ? "已写入工作区"
          : "等待写入恢复缓存";
  return (
    <footer className="statusbar">
      <div className="statusbar-counts">
        <LiveStatusMetric editor={editor} field="words" label="字" />
        <i />
        <LiveStatusMetric editor={editor} field="paragraphs" label="段" />
        <i />
        <LiveStatusMetric editor={editor} field="pages" label="页" />
        <i />
        <LiveStatusMetric editor={editor} field="images" label="图" />
      </div>
      <div className={externalVersion ? "statusbar-save external" : (dirty ? "statusbar-save dirty" : "statusbar-save saved")}>
        <span>{persistenceLabel} · {formatClock(updatedAt)}</span>
        <i />
        <div className="statusbar-cache" title={`已缓存 ${cacheCount} 篇信笺的编辑器结构，用于加速已打开信笺切换`}>
          <span>缓存 {formatCacheBytes(cacheBytes)}</span>
          <button type="button" onClick={onClearCache} disabled={!cacheBytes} aria-label="清理信笺切换缓存" title="清理缓存">
            <Eraser size={17} strokeWidth={1.9} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="statusbar-version">
        <button
          type="button"
          className={`statusbar-update ${updateMeta.className}`}
          onClick={onRunUpdate}
          disabled={updateMeta.busy}
          title={updateState?.message || updateMeta.label}
          aria-label={updateState?.message || updateMeta.label}
        >
          <img src={ICON_ASSETS.updateArrow} alt="" />
          <span>{updateMeta.label}</span>
        </button>
        <i />
        {version ? (
          <button
            type="button"
            className="status-version-button"
            onClick={onOpenReleaseNotes}
            aria-label={'查看版本 ' + version + ' 的更新历史'}
            title="查看更新历史"
          >
            <span className="status-version-v">V</span>
            <span className="status-version-number">{version}</span>
          </button>
        ) : ""}
      </div>
    </footer>
  );
}
