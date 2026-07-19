const RESEARCH_WEB_PARTITION = "paperwriter-research-web";
const MAX_VIEW_ID_LENGTH = 1024;
const MAX_URL_LENGTH = 8192;

function normalizeResearchWebViewId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id || id.length > MAX_VIEW_ID_LENGTH || /[\u0000-\u001f\u007f]/.test(id)) {
    throw new Error("网页标签标识无效");
  }
  return id;
}

function normalizeResearchWebUrl(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || raw.length > MAX_URL_LENGTH) throw new Error("网页地址无效或过长");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("网页地址格式不正确");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("网页仅支持不含账号信息的 HTTP 或 HTTPS 地址");
  }
  return parsed.toString();
}

function finiteInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function sanitizeResearchWebBounds(bounds = {}, contentSize = []) {
  const maximumWidth = Math.max(0, finiteInteger(contentSize?.[0]));
  const maximumHeight = Math.max(0, finiteInteger(contentSize?.[1]));
  const x = Math.max(0, Math.min(maximumWidth, finiteInteger(bounds.x)));
  const y = Math.max(0, Math.min(maximumHeight, finiteInteger(bounds.y)));
  const width = Math.max(0, Math.min(maximumWidth - x, finiteInteger(bounds.width)));
  const height = Math.max(0, Math.min(maximumHeight - y, finiteInteger(bounds.height)));
  return { x, y, width, height };
}

function navigationHistoryFor(contents) {
  return contents?.navigationHistory || contents;
}

function createResearchWebViewManager({
  WebContentsView,
  session,
  shell,
  getWindow,
  sendState,
  partition = RESEARCH_WEB_PARTITION,
} = {}) {
  if (typeof WebContentsView !== "function") throw new Error("当前 Electron 不支持内嵌网页视图");
  if (!session?.fromPartition) throw new Error("缺少网页会话支持");
  const researchSession = session.fromPartition(partition);
  const records = new Map();
  let activeViewId = "";

  researchSession.setPermissionRequestHandler?.((_webContents, _permission, callback) => callback(false));
  researchSession.setPermissionCheckHandler?.(() => false);
  researchSession.on?.("will-download", (event) => event.preventDefault());

  const windowForView = () => {
    const window = getWindow?.();
    return window && !window.isDestroyed?.() ? window : null;
  };

  const stateFor = (record) => {
    const contents = record.view.webContents;
    const history = navigationHistoryFor(contents);
    return {
      viewId: record.viewId,
      url: contents.getURL?.() || record.sourceUrl,
      title: contents.getTitle?.() || "",
      loading: Boolean(contents.isLoading?.()),
      canGoBack: Boolean(history?.canGoBack?.()),
      canGoForward: Boolean(history?.canGoForward?.()),
      error: String(record.error || ""),
    };
  };

  const emitState = (record, error, patch = {}) => {
    if (!record || record.closed) return;
    if (typeof error === "string") record.error = error;
    sendState?.({ ...stateFor(record), ...patch });
  };

  const detach = (record) => {
    if (!record?.attached) return;
    const window = windowForView();
    try {
      window?.contentView?.removeChildView?.(record.view);
    } catch {
      // The owning window may already be closing.
    }
    record.attached = false;
  };

  const attach = (record, bounds) => {
    const window = windowForView();
    if (!window?.contentView) throw new Error("应用窗口当前不可用");
    const resolvedBounds = sanitizeResearchWebBounds(bounds, window.getContentSize?.() || []);
    if (resolvedBounds.width < 1 || resolvedBounds.height < 1) {
      detach(record);
      return resolvedBounds;
    }
    if (!record.attached) {
      window.contentView.addChildView(record.view);
      record.attached = true;
    }
    record.view.setBounds(resolvedBounds);
    return resolvedBounds;
  };

  const installViewGuards = (record) => {
    const contents = record.view.webContents;
    contents.setWindowOpenHandler?.(({ url }) => {
      try {
        const safeUrl = normalizeResearchWebUrl(url);
        Promise.resolve(shell?.openExternal?.(safeUrl)).catch(() => {});
      } catch {
        // Invalid or privileged targets remain blocked.
      }
      return { action: "deny" };
    });
    const guardNavigation = (event, url) => {
      try {
        normalizeResearchWebUrl(url);
      } catch {
        event.preventDefault();
      }
    };
    contents.on?.("will-navigate", guardNavigation);
    contents.on?.("will-redirect", guardNavigation);
    contents.on?.("did-start-loading", () => emitState(record, ""));
    contents.on?.("did-stop-loading", () => emitState(record));
    contents.on?.("did-navigate", () => emitState(record, ""));
    contents.on?.("did-navigate-in-page", () => emitState(record, ""));
    contents.on?.("page-title-updated", () => emitState(record));
    contents.on?.("focus", () => emitState(record, undefined, { focused: true }));
    contents.on?.("did-fail-load", (_event, code, description, validatedUrl, isMainFrame) => {
      if (isMainFrame === false || Number(code) === -3) return;
      emitState(record, description || `网页加载失败（${code}）`);
    });
    contents.on?.("destroyed", () => {
      detach(record);
      record.closed = true;
      records.delete(record.viewId);
      if (activeViewId === record.viewId) activeViewId = "";
    });
  };

  const createRecord = (viewId, sourceUrl) => {
    const view = new WebContentsView({
      webPreferences: {
        partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        devTools: false,
        webviewTag: false,
      },
    });
    const record = { viewId, sourceUrl, view, attached: false, closed: false, error: "" };
    records.set(viewId, record);
    installViewGuards(record);
    return record;
  };

  const loadSource = async (record, sourceUrl) => {
    if (record.sourceUrl === sourceUrl && record.view.webContents.getURL?.()) return;
    record.sourceUrl = sourceUrl;
    try {
      await record.view.webContents.loadURL(sourceUrl);
    } catch (error) {
      emitState(record, error?.message || "网页加载失败");
    }
  };

  const show = async (payload = {}) => {
    const viewId = normalizeResearchWebViewId(payload.viewId);
    const sourceUrl = normalizeResearchWebUrl(payload.url);
    let record = records.get(viewId);
    if (!record || record.closed) record = createRecord(viewId, sourceUrl);
    for (const other of records.values()) if (other !== record) detach(other);
    activeViewId = viewId;
    attach(record, payload.bounds);
    void loadSource(record, sourceUrl);
    emitState(record);
    return stateFor(record);
  };

  const updateBounds = (payload = {}) => {
    const viewId = normalizeResearchWebViewId(payload.viewId);
    const record = records.get(viewId);
    if (!record || record.closed) return { ok: false, missing: true };
    if (payload.visible === false || activeViewId !== viewId) {
      detach(record);
      return { ok: true, visible: false };
    }
    const bounds = attach(record, payload.bounds);
    return { ok: true, visible: record.attached, bounds };
  };

  const hide = (viewId = "") => {
    if (viewId) {
      const normalized = normalizeResearchWebViewId(viewId);
      detach(records.get(normalized));
      if (activeViewId === normalized) activeViewId = "";
    } else {
      for (const record of records.values()) detach(record);
      activeViewId = "";
    }
    return { ok: true };
  };

  const control = (payload = {}) => {
    const viewId = normalizeResearchWebViewId(payload.viewId);
    const record = records.get(viewId);
    if (!record || record.closed) return { ok: false, missing: true };
    const contents = record.view.webContents;
    const history = navigationHistoryFor(contents);
    if (payload.action === "back" && history?.canGoBack?.()) history.goBack();
    else if (payload.action === "forward" && history?.canGoForward?.()) history.goForward();
    else if (payload.action === "reload") contents.reload?.();
    else if (payload.action === "stop") contents.stop?.();
    else return { ok: false, unsupported: true };
    emitState(record);
    return { ok: true };
  };

  const destroy = (viewId) => {
    const normalized = normalizeResearchWebViewId(viewId);
    const record = records.get(normalized);
    if (!record) return { ok: true, missing: true };
    detach(record);
    records.delete(normalized);
    if (activeViewId === normalized) activeViewId = "";
    record.closed = true;
    record.view.webContents.close?.();
    return { ok: true };
  };

  const destroyAll = () => {
    for (const viewId of [...records.keys()]) destroy(viewId);
    activeViewId = "";
  };

  return { control, destroy, destroyAll, hide, show, updateBounds };
}

module.exports = {
  RESEARCH_WEB_PARTITION,
  createResearchWebViewManager,
  normalizeResearchWebUrl,
  normalizeResearchWebViewId,
  sanitizeResearchWebBounds,
};
