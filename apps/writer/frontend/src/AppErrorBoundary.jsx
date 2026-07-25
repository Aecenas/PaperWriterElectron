import React from "react";
import { resetUiPreferences } from "./safe-storage.js";
import "./app-error-boundary.css";

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    globalThis.console?.error?.("PaperWriter renderer crashed", error, errorInfo);
  }

  reload = () => {
    globalThis.window?.location?.reload?.();
  };

  resetPreferences = () => {
    resetUiPreferences();
    this.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const message = String(error?.message || "界面遇到未知错误").slice(0, 2000);
    return (
      <main className="app-error-boundary" role="alert">
        <section className="app-error-card" aria-labelledby="app-error-title">
          <span className="app-error-eyebrow">安全恢复</span>
          <h1 id="app-error-title">界面暂时无法继续显示</h1>
          <p>信笺文件没有因此被删除。可以先重新载入；若问题来自损坏的界面偏好，再重置界面设置。</p>
          <details>
            <summary>查看错误信息</summary>
            <pre>{message}</pre>
          </details>
          <div className="app-error-actions">
            <button type="button" className="primary" onClick={this.reload}>重新载入</button>
            <button type="button" onClick={this.resetPreferences}>重置界面设置并载入</button>
          </div>
          <small>重置不会删除信笺文件、恢复缓存、会话标签或用户模板。</small>
        </section>
      </main>
    );
  }
}
