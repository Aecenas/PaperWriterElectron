import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ExternalLink,
  Link2,
  Pencil,
  RefreshCw,
  X,
} from "lucide-react";
import { bridge } from "../bridge.js";
import { sourceDisplayName } from "../research-ui-model.js";

function WebResearchCard({ item, onOpenExternal, onEditSource, onCreateCitation }) {
  return (
    <article className="secondary-research-card secondary-web-card">
      <div className="secondary-research-card-icon"><Link2 size={21} aria-hidden="true" /></div>
      <div className="secondary-research-card-copy">
        <strong>{sourceDisplayName(item)}</strong>
        <button type="button" className="secondary-web-url" onClick={() => onOpenExternal?.(item)}>{item.url}</button>
        {item.notes || item.excerpt ? <blockquote>{item.notes || item.excerpt}</blockquote> : <p>浏览器预览只显示来源卡，不嵌入可能受站点策略限制的远程页面。</p>}
      </div>
      <div className="secondary-research-card-actions">
        {onEditSource ? <button type="button" onClick={() => onEditSource(item)}><Pencil size={14} />编辑</button> : null}
        {onOpenExternal ? <button type="button" onClick={() => onOpenExternal(item)}><ExternalLink size={14} />浏览器打开</button> : null}
        {onCreateCitation ? <button type="button" onClick={() => onCreateCitation(item)}><BookOpen size={14} />添加为参考文献来源</button> : null}
      </div>
    </article>
  );
}

function webViewBounds(element) {
  const rect = element?.getBoundingClientRect?.();
  if (!rect) return null;
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height)),
  };
}

export default function EmbeddedWebResearch({ item, viewId, suspended = false, onActivate, onOpenExternal }) {
  const hostRef = useRef(null);
  const frameRef = useRef(0);
  const supported = Boolean(bridge.isElectron && bridge.showResearchWebView && bridge.updateResearchWebViewBounds);
  const [viewState, setViewState] = useState({
    url: item?.url || "",
    title: sourceDisplayName(item),
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: "",
  });

  useEffect(() => {
    setViewState((current) => ({ ...current, url: item?.url || "", title: sourceDisplayName(item), error: "" }));
  }, [item?.id, item?.title, item?.url]);

  useEffect(() => {
    if (!supported || !viewId || !item?.url) return undefined;
    if (suspended) {
      void bridge.hideResearchWebView?.(viewId);
      return undefined;
    }
    return bridge.onResearchWebViewState?.((payload = {}) => {
      if (payload.viewId !== viewId) return;
      setViewState((current) => ({ ...current, ...payload }));
      if (payload.focused) onActivate?.();
    });
  }, [item?.url, onActivate, supported, viewId]);

  useEffect(() => {
    if (!supported || !viewId || !item?.url) return undefined;
    if (suspended) return undefined;
    let disposed = false;
    const updateBounds = () => {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = window.requestAnimationFrame(() => {
        if (disposed) return;
        const bounds = webViewBounds(hostRef.current);
        if (bounds) void bridge.updateResearchWebViewBounds?.({ viewId, bounds, visible: true });
      });
    };
    const show = async () => {
      const bounds = webViewBounds(hostRef.current);
      if (!bounds) return;
      const result = await bridge.showResearchWebView?.({ viewId, url: item.url, bounds });
      if (!disposed && result?.unsupported) setViewState((current) => ({ ...current, unsupported: true }));
    };
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateBounds) : null;
    if (hostRef.current) observer?.observe(hostRef.current);
    window.addEventListener("resize", updateBounds);
    window.addEventListener("scroll", updateBounds, true);
    void show();
    return () => {
      disposed = true;
      observer?.disconnect();
      window.cancelAnimationFrame(frameRef.current);
      window.removeEventListener("resize", updateBounds);
      window.removeEventListener("scroll", updateBounds, true);
      void bridge.hideResearchWebView?.(viewId);
    };
  }, [item?.url, supported, suspended, viewId]);

  if (!supported || viewState.unsupported) {
    return <WebResearchCard item={item} onOpenExternal={onOpenExternal} />;
  }

  const control = (action) => {
    onActivate?.();
    void bridge.controlResearchWebView?.(viewId, action);
  };
  const currentUrl = viewState.url || item.url;
  return (
    <div className="secondary-web-browser">
      <div className="secondary-web-toolbar" role="toolbar" aria-label="网页浏览控制" onPointerDown={onActivate}>
        <button type="button" disabled={!viewState.canGoBack} onClick={() => control("back")} aria-label="后退" title="后退"><ArrowLeft size={15} /></button>
        <button type="button" disabled={!viewState.canGoForward} onClick={() => control("forward")} aria-label="前进" title="前进"><ArrowRight size={15} /></button>
        <button type="button" onClick={() => control(viewState.loading ? "stop" : "reload")} aria-label={viewState.loading ? "停止加载" : "刷新"} title={viewState.loading ? "停止加载" : "刷新"}>
          {viewState.loading ? <X size={15} /> : <RefreshCw size={15} />}
        </button>
        <input className="secondary-web-current-url" type="text" value={currentUrl} readOnly aria-label="当前网页地址" title={currentUrl} />
        <button type="button" onClick={() => onOpenExternal?.({ ...item, url: currentUrl })} aria-label="在系统浏览器中打开" title="在系统浏览器中打开"><ExternalLink size={15} /></button>
      </div>
      {viewState.error ? <p className="secondary-web-error" role="alert">{viewState.error}</p> : null}
      <div ref={hostRef} className="secondary-web-view-host" aria-label={`${sourceDisplayName(item)} 网页内容`} />
    </div>
  );
}
