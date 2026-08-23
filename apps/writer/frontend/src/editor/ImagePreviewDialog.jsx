import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ClipboardCopy,
  LoaderCircle,
  Minus,
  Plus,
  Scan,
  X,
} from "lucide-react";
import { bridge } from "../bridge.js";
import { isTopModalDialog, useModalFocusTrap } from "../ui-interactions.js";
import {
  IMAGE_PREVIEW_ZOOM_LEVELS,
  imagePreviewFitZoom,
  nextImagePreviewZoom,
  visibleImagePoint,
} from "./image-preview-model.js";

function copyButtonPresentation(state) {
  if (state === "copying") return { Icon: LoaderCircle, label: "复制中…" };
  if (state === "copied") return { Icon: Check, label: "已复制" };
  return { Icon: ClipboardCopy, label: state === "failed" ? "重试复制" : "复制图片" };
}

export function ImagePreviewDialog({
  alt = "",
  caption = "",
  number = 1,
  onClose,
  returnFocusRef,
  src = "",
}) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const stageRef = useRef(null);
  const imageRef = useRef(null);
  const copyResetTimerRef = useRef(null);
  const wheelTimestampRef = useRef(0);
  const [naturalSize, setNaturalSize] = useState({ width: 1, height: 1 });
  const [stageSize, setStageSize] = useState({ width: 1, height: 1 });
  const [fitMode, setFitMode] = useState(true);
  const [manualZoom, setManualZoom] = useState(1);
  const [copyState, setCopyState] = useState("idle");
  const [copyMessage, setCopyMessage] = useState("");
  useModalFocusTrap(true, dialogRef, closeButtonRef, returnFocusRef);

  const fitZoom = useMemo(() => imagePreviewFitZoom({
    naturalWidth: naturalSize.width,
    naturalHeight: naturalSize.height,
    stageWidth: stageSize.width,
    stageHeight: stageSize.height,
  }), [naturalSize.height, naturalSize.width, stageSize.height, stageSize.width]);
  const zoom = fitMode ? fitZoom : manualZoom;
  const zoomPercent = Math.max(1, Math.round(zoom * 100));
  const previewTitle = caption ? `图${number}. ${caption}` : `图${number}`;
  const copyPresentation = copyButtonPresentation(copyState);
  const CopyStateIcon = copyPresentation.Icon;

  const centerStage = useCallback(() => {
    globalThis.requestAnimationFrame?.(() => {
      const stage = stageRef.current;
      if (!stage) return;
      stage.scrollLeft = Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2);
      stage.scrollTop = Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2);
    });
  }, []);

  const adjustZoom = useCallback((direction) => {
    const nextZoom = nextImagePreviewZoom(zoom, direction);
    if (Math.abs(nextZoom - zoom) < 0.001) return;
    setFitMode(false);
    setManualZoom(nextZoom);
    centerStage();
  }, [centerStage, zoom]);

  const restoreFit = useCallback(() => {
    setFitMode(true);
    centerStage();
  }, [centerStage]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const measure = () => setStageSize({
      width: Math.max(1, stage.clientWidth),
      height: Math.max(1, stage.clientHeight),
    });
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(stage);
    globalThis.addEventListener?.("resize", measure);
    return () => {
      observer?.disconnect();
      globalThis.removeEventListener?.("resize", measure);
    };
  }, []);

  useEffect(() => {
    setFitMode(true);
    setManualZoom(1);
    setCopyState("idle");
    setCopyMessage("");
  }, [src]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const handleWheel = (event) => {
      if (!event.ctrlKey || !event.deltaY) return;
      event.preventDefault();
      const now = Date.now();
      if (now - wheelTimestampRef.current < 80) return;
      wheelTimestampRef.current = now;
      adjustZoom(event.deltaY < 0 ? 1 : -1);
    };
    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheel);
  }, [adjustZoom]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== "Escape" || !isTopModalDialog(dialogRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
      onClose?.();
    };
    globalThis.document?.addEventListener?.("keydown", handleKeyDown, true);
    return () => globalThis.document?.removeEventListener?.("keydown", handleKeyDown, true);
  }, [onClose]);

  useEffect(() => () => {
    if (copyResetTimerRef.current) globalThis.clearTimeout?.(copyResetTimerRef.current);
  }, []);

  const copyImage = useCallback(async () => {
    if (copyState === "copying") return;
    const image = imageRef.current;
    const stage = stageRef.current;
    const point = visibleImagePoint(
      image?.getBoundingClientRect?.(),
      stage?.getBoundingClientRect?.(),
    );
    if (!point || typeof bridge.copyImageToClipboard !== "function") {
      setCopyState("failed");
      setCopyMessage("当前环境无法复制这张图片");
      return;
    }
    setCopyState("copying");
    setCopyMessage("");
    try {
      const result = await bridge.copyImageToClipboard({ ...point, src });
      if (result?.ok === false) throw new Error(result.message || "图片复制失败");
      setCopyState("copied");
      setCopyMessage("图片已复制到系统剪贴板");
      if (copyResetTimerRef.current) globalThis.clearTimeout?.(copyResetTimerRef.current);
      copyResetTimerRef.current = globalThis.setTimeout?.(() => {
        setCopyState("idle");
        setCopyMessage("");
      }, 1_600);
    } catch (error) {
      setCopyState("failed");
      setCopyMessage(error?.message || "图片复制失败，请重试");
    }
  }, [copyState, src]);

  if (!globalThis.document?.body) return null;

  return createPortal(
    <div
      className="paper-image-preview-overlay dialog-scrim dialog-scrim--large"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <section
        ref={dialogRef}
        className="paper-image-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="paper-image-preview-header">
          <div className="paper-image-preview-heading">
            <p>图片预览</p>
            <h2 id={titleId}>{previewTitle}</h2>
          </div>
          <div className="paper-image-preview-actions" aria-label="图片预览工具">
            <div className="paper-image-preview-zoom-controls" role="group" aria-label="缩放图片">
              <button
                type="button"
                onClick={() => adjustZoom(-1)}
                disabled={zoom <= IMAGE_PREVIEW_ZOOM_LEVELS[0] + 0.001}
                aria-label="缩小图片"
                title="缩小"
              >
                <Minus size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={fitMode ? "is-fit" : ""}
                onClick={restoreFit}
                aria-label={`当前缩放 ${zoomPercent}%，点击适应窗口`}
                title="适应窗口"
              >
                <Scan size={14} aria-hidden="true" />
                <span>{zoomPercent}%</span>
              </button>
              <button
                type="button"
                onClick={() => adjustZoom(1)}
                disabled={zoom >= IMAGE_PREVIEW_ZOOM_LEVELS.at(-1) - 0.001}
                aria-label="放大图片"
                title="放大"
              >
                <Plus size={16} aria-hidden="true" />
              </button>
            </div>
            <button
              type="button"
              className={`paper-image-preview-copy is-${copyState}`}
              onClick={() => void copyImage()}
              disabled={copyState === "copying"}
              aria-label={copyPresentation.label}
              title="复制原图到系统剪贴板"
            >
              <CopyStateIcon
                size={15}
                aria-hidden="true"
                className={copyState === "copying" ? "is-spinning" : undefined}
              />
              <span>{copyPresentation.label}</span>
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              className="paper-image-preview-close"
              onClick={onClose}
              aria-label="关闭图片预览"
              title="关闭图片预览"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>
        <div ref={stageRef} className="paper-image-preview-stage">
          <div className="paper-image-preview-canvas">
            <img
              ref={imageRef}
              src={src || undefined}
              alt={alt || caption || previewTitle}
              decoding="async"
              draggable={false}
              style={{
                width: `${Math.max(1, naturalSize.width * zoom)}px`,
                height: `${Math.max(1, naturalSize.height * zoom)}px`,
              }}
              onLoad={(event) => {
                const nextSize = {
                  width: Math.max(1, event.currentTarget.naturalWidth || 1),
                  height: Math.max(1, event.currentTarget.naturalHeight || 1),
                };
                setNaturalSize(nextSize);
                centerStage();
              }}
            />
          </div>
        </div>
        <footer className="paper-image-preview-footer">
          <span>{naturalSize.width} × {naturalSize.height} px</span>
          <span className={copyState === "failed" ? "is-error" : ""} role="status" aria-live="polite">
            {copyMessage || "Ctrl + 滚轮可缩放，普通滚轮可浏览放大后的图片"}
          </span>
        </footer>
      </section>
    </div>,
    globalThis.document.body,
  );
}
