import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle2,
  Download,
  FileImage,
  FileText,
  FolderOpen,
  X,
} from "lucide-react";
import { bridge } from "../bridge.js";
import {
  loadRememberedExportDirectory,
  rememberExportDirectory,
} from "./export-directory-memory.js";
import { useModalFocusTrap } from "../ui-interactions.js";

export default function ExportDialog({
  open,
  documentTitle,
  returnFocusRef,
  onClose,
  onExportPdf,
  onExportImages,
  onExportEditable,
}) {
  const [format, setFormat] = useState("pdf");
  const [targetPath, setTargetPath] = useState("");
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("选择格式与保存位置后开始导出");
  const [error, setError] = useState("");
  const dialogRef = useRef(null);
  const firstFormatRef = useRef(null);
  const busy = status === "choosing" || status === "exporting";
  const completed = status === "success";
  useModalFocusTrap(open, dialogRef, firstFormatRef, returnFocusRef);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    setFormat("pdf");
    setTargetPath("");
    setStatus("idle");
    setProgress(0);
    setProgressMessage("选择格式与保存位置后开始导出");
    setError("");
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && status !== "exporting") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => window.document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose, open, status]);

  useEffect(() => {
    if (!open || typeof bridge.onExportProgress !== "function") {
      return undefined;
    }
    return bridge.onExportProgress((payload) => {
      if (!payload || payload.format !== format) {
        return;
      }
      setProgress(Math.max(0, Math.min(100, Number(payload.percent) || 0)));
      if (payload.message) {
        setProgressMessage(payload.message);
      }
    });
  }, [format, open]);

  if (!open) {
    return null;
  }

  const updateFormat = (nextFormat) => {
    if (busy || nextFormat === format) {
      return;
    }
    setFormat(nextFormat);
    setTargetPath("");
    setStatus("idle");
    setProgress(0);
    setProgressMessage("选择格式与保存位置后开始导出");
    setError("");
  };

  const handleChoosePath = async () => {
    setStatus("choosing");
    setError("");
    try {
      const result = await bridge.pickExportPath?.(format, documentTitle, loadRememberedExportDirectory());
      if (!result?.canceled && result?.path) {
        setTargetPath(result.path);
        rememberExportDirectory(result.directory);
        setProgressMessage(format === "pdf" ? "PDF 将保存到所选位置" : (format === "images" ? "分页图片将保存到所选文件夹" : "可编辑文档将保存到所选位置"));
      }
      setStatus("idle");
    } catch (chooseError) {
      setStatus("error");
      setError(chooseError?.message || "无法选择导出位置，请重试");
    }
  };

  const handleStartExport = async () => {
    if (!targetPath || busy) {
      return;
    }
    setStatus("exporting");
    setProgress(2);
    setProgressMessage("正在准备导出内容…");
    setError("");
    try {
      const result = format === "pdf"
        ? await onExportPdf(targetPath)
        : (format === "images" ? await onExportImages(targetPath) : await onExportEditable(format, targetPath));
      if (result?.canceled) {
        setStatus("idle");
        setProgress(0);
        setProgressMessage("导出已取消");
        return;
      }
      setProgress(100);
      setProgressMessage(format === "pdf" ? "PDF 导出完成" : (format === "images" ? `已导出 ${result?.count || 0} 张分页图片` : `${format.toUpperCase()} 导出完成`));
      setStatus("success");
    } catch (exportError) {
      setStatus("error");
      setError(exportError?.message || "导出失败，请检查保存位置后重试");
      setProgressMessage("导出未完成");
    }
  };

  const content = (
    <div className="export-dialog-overlay dialog-scrim" role="presentation" onMouseDown={() => { if (!busy) onClose(); }}>
      <section
        ref={dialogRef}
        className="export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="export-dialog-header">
          <div className="export-dialog-heading-icon" aria-hidden="true">
            <Download size={21} strokeWidth={1.9} />
          </div>
          <div>
            <p>输出当前信笺</p>
            <h2 id="export-dialog-title">导出</h2>
          </div>
          <button type="button" className="export-dialog-close" onClick={onClose} disabled={busy} aria-label="关闭导出窗口" title="关闭">
            <X size={17} />
          </button>
        </header>

        <div className="export-dialog-body">
          <fieldset className="export-format-fieldset" disabled={busy}>
            <legend>版式输出</legend>
            <div className="export-format-options">
              <label className={format === "pdf" ? "selected" : ""}>
                <input ref={firstFormatRef} type="radio" name="export-format" value="pdf" checked={format === "pdf"} onChange={() => updateFormat("pdf")} />
                <span className="export-format-icon"><FileText size={20} strokeWidth={1.8} /></span>
                <span><strong>PDF 文档</strong><small>适合打印、归档与分享</small></span>
                <i aria-hidden="true" />
              </label>
              <label className={format === "images" ? "selected" : ""}>
                <input type="radio" name="export-format" value="images" checked={format === "images"} onChange={() => updateFormat("images")} />
                <span className="export-format-icon"><FileImage size={20} strokeWidth={1.8} /></span>
                <span><strong>分页图片</strong><small>按分页符输出多张 PNG</small></span>
                <i aria-hidden="true" />
              </label>
            </div>
          </fieldset>
          <fieldset className="export-format-fieldset export-editable-fieldset" disabled={busy}>
            <legend>可编辑交换</legend>
            <div className="export-format-options export-editable-options">
              {[
                { id: "docx", title: "DOCX", detail: "内嵌图片，适合 Word 继续编辑" },
                { id: "markdown", title: "Markdown", detail: "图片写入同名 .assets 目录" },
                { id: "html", title: "HTML", detail: "语义化 UTF-8 文档" },
                { id: "txt", title: "TXT", detail: "仅保留纯文本与脚注引用" },
              ].map((option) => (
                <label key={option.id} className={format === option.id ? "selected" : ""}>
                  <input type="radio" name="export-format" value={option.id} checked={format === option.id} onChange={() => updateFormat(option.id)} />
                  <span className="export-format-icon"><FileText size={20} strokeWidth={1.8} /></span>
                  <span><strong>{option.title}</strong><small>{option.detail}</small></span>
                  <i aria-hidden="true" />
                </label>
              ))}
            </div>
            <small className="export-format-note">通用导出不包含批注和 AI 记录；脚注与引用会正确输出，参考文献由顶部“参考”开关决定。视觉保真请使用 PDF。</small>
          </fieldset>

          <div className="export-path-field">
            <label htmlFor="export-target-path">导出路径</label>
            <div className="export-path-control">
              <input
                id="export-target-path"
                type="text"
                readOnly
                value={targetPath}
                placeholder={format === "pdf" ? "请选择 PDF 文件的保存位置" : (format === "images" ? "请选择分页图片的保存文件夹" : "请选择可编辑文档的保存位置")}
                title={targetPath}
              />
              <button type="button" onClick={handleChoosePath} disabled={busy}>
                <FolderOpen size={16} strokeWidth={1.9} />
                <span>选择位置</span>
              </button>
            </div>
            <small>{format === "pdf" ? "文件扩展名会自动补全为 .pdf" : (format === "images" ? "图片将以“信笺名-01.png”的方式连续命名" : "文件扩展名会按所选格式自动补全")}；选择位置时会打开上次使用的导出目录</small>
          </div>

          <div className={`export-progress ${status}`} aria-live="polite">
            <div className="export-progress-copy">
              <span>{completed ? <CheckCircle2 size={15} /> : <Download size={15} />}{progressMessage}</span>
              <strong>{Math.round(progress)}%</strong>
            </div>
            <div
              className="export-progress-track"
              role="progressbar"
              aria-label="导出进度"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={Math.round(progress)}
            >
              <i style={{ width: `${progress}%` }} />
            </div>
          </div>
          {error ? <p className="export-dialog-error" role="alert">{error}</p> : null}
        </div>

        <footer className="export-dialog-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>{completed ? "关闭" : "取消"}</button>
          {!completed ? (
            <button type="button" className="primary" onClick={handleStartExport} disabled={!targetPath || busy}>
              <Download size={16} strokeWidth={1.9} />
              <span>{status === "exporting" ? "正在导出…" : "开始导出"}</span>
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );

  return createPortal(content, window.document.body);
}
