import {
  Bot,
  CheckCircle2,
  Globe2,
  Hash,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  SquareTerminal,
  Trash2,
  UserRound,
  Wifi,
} from "lucide-react";
import { TemplateSelect } from "../templates/index.js";
import { aiRequestParamsWithProviderDefaults } from "../ai-request-params.js";
import {
  AI_PROTOCOL_OPTIONS,
  AI_TASK_MODEL_DEFINITIONS,
  getAiReasoningEffortOptions,
} from "./model.js";

export function AiProviderPanel({
  busy,
  loginCodex,
  normalizedConfig,
  onSave,
  openAddModelEditor,
  openEditModelEditor,
  openProviderEditor,
  refreshCodex,
  removeModelDraft,
  runAction,
  saveModelReasoningEffort,
  selectedConnection,
  selectedDraft,
  selectedIsCodex,
  selectedIsDefault,
  selectedLastUpdated,
  selectedModel,
  selectedProvider,
  selectedProviderIcon,
  status,
  setDefaultModel,
  setDeleteConfirm,
  setSelectedModelId,
  testModel,
}) {
  return (
    <main className="ai-settings-main">
      <header className="ai-settings-main-head">
        <div className="ai-provider-hero">
          <span className="ai-provider-hero-icon">
            {selectedProviderIcon ? <img src={selectedProviderIcon} alt="" aria-hidden="true" /> : (selectedIsCodex ? <SquareTerminal size={30} aria-hidden="true" /> : <Sparkles size={30} aria-hidden="true" />)}
          </span>
          <div>
            <h2 id="ai-settings-title">{selectedDraft.providerLabel}</h2>
            <p>{selectedIsCodex ? "通过本地已登录的 Codex CLI 调用" : selectedDraft.baseUrl}</p>
          </div>
          <span className={`ai-status-pill ${selectedConnection.tone} large`}>
            <CheckCircle2 size={13} />
            {selectedConnection.label}
          </span>
        </div>
        <div className="ai-default-provider-control">
          <span>设为默认供应商</span>
          <button
            type="button"
            className={selectedIsDefault ? "ai-provider-switch-toggle checked" : "ai-provider-switch-toggle"}
            role="switch"
            aria-checked={selectedIsDefault}
            disabled={busy || selectedIsDefault || !selectedModel?.testedOk}
            title={!selectedModel?.testedOk ? (selectedIsCodex ? "请先检查 Codex CLI 并选择可用模型" : "请先测试当前模型") : (selectedIsDefault ? "已是默认供应商" : "设为默认供应商")}
            onClick={() => runAction(onSave, { resetTest: false, activate: true })}
          >
            <span />
          </button>
        </div>
      </header>
      {status ? <p className={`ai-provider-feedback ${status.tone}`} aria-live="polite">{status.message}</p> : null}
      {selectedIsCodex ? (
        <>
          <section className="ai-settings-section ai-codex-status-section">
            <div className="ai-settings-section-head">
              <h3>本地 Codex CLI</h3>
              <div className="ai-settings-section-actions">
                {selectedDraft.runtime?.installed && !selectedDraft.runtime?.authenticated ? (
                  <button type="button" className="primary" disabled={busy} onClick={loginCodex}>
                    <SquareTerminal size={15} /><span>登录 Codex</span>
                  </button>
                ) : null}
                <button type="button" disabled={busy} onClick={refreshCodex}>
                  <RefreshCw size={15} className={busy ? "spinning" : ""} /><span>{busy ? "检查中…" : "重新检查"}</span>
                </button>
              </div>
            </div>
            <div className="ai-provider-info-grid">
              <article><SquareTerminal size={17} /><span>安装状态</span><strong>{selectedDraft.runtime?.installed ? "已安装" : "未检测到"}</strong></article>
              <article><CheckCircle2 size={17} /><span>登录状态</span><strong>{selectedDraft.runtime?.authenticated ? "已登录" : "未登录"}</strong></article>
              <article><Hash size={17} /><span>CLI 版本</span><strong>{selectedDraft.runtime?.version || "—"}</strong></article>
              <article><UserRound size={17} /><span>账号</span><strong>{selectedDraft.runtime?.accountLabel || selectedDraft.runtime?.accountType || "—"}{selectedDraft.runtime?.planType ? ` · ${selectedDraft.runtime.planType}` : ""}</strong></article>
              <article className="ai-provider-info-wide"><Globe2 size={17} /><span>检测路径</span><strong title={selectedDraft.runtime?.executablePath || "自动扫描 PATH 与标准 npm 目录"}>{selectedDraft.runtime?.executablePath || "自动扫描 PATH 与标准 npm 目录"}</strong></article>
            </div>
            {!selectedDraft.runtime?.ready || selectedDraft.runtime?.stale ? (
              <p className="ai-codex-runtime-note">
                {selectedDraft.runtime?.message || "点击“重新检查”检测本地 Codex CLI。"}
              </p>
            ) : null}
            {!selectedDraft.runtime?.installed && selectedDraft.runtime?.checkedAt ? (
              <p className="ai-codex-install-help">请先安装 Codex CLI：<code>npm install -g @openai/codex</code>，安装完成后重新检查。</p>
            ) : null}
          </section>
          <section className="ai-settings-section">
            <div className="ai-settings-section-head"><h3>Codex 可用模型</h3><span className="ai-settings-muted">推理强度按模型保存</span></div>
            <div className="ai-model-table ai-codex-model-table" aria-label="Codex CLI 模型">
              <div className="ai-model-table-head"><span>模型名称</span><span>推理强度</span><span>是否默认</span><span>状态</span></div>
              {selectedDraft.models.length === 0 ? (
                <div className="ai-model-empty">
                  <SquareTerminal size={24} aria-hidden="true" />
                  <strong>尚未同步模型目录</strong>
                  <span>{selectedDraft.runtime?.authenticated ? "重新检查 Codex CLI 以同步当前账号可用模型。" : "安装并登录 Codex CLI 后即可同步模型。"}</span>
                  <button type="button" disabled={busy} onClick={refreshCodex}><RefreshCw size={15} />重新检查</button>
                </div>
              ) : selectedDraft.models.map((model) => {
                const isModelDefault = normalizedConfig.activeProvider === selectedProvider && selectedDraft.activeModelId === model.id;
                return (
                  <div key={model.id} className={["ai-model-table-row", model.id === selectedModel?.id ? "selected" : "", model.testedOk ? "available" : ""].filter(Boolean).join(" ")} onClick={() => setSelectedModelId(model.id)}>
                    <div className="ai-model-name-cell"><span className="ai-model-icon"><Bot size={16} /></span><div><strong>{model.name}</strong><em>{model.description || model.model}</em></div></div>
                    <div className="ai-codex-effort-select" onClick={(event) => event.stopPropagation()}>
                      <TemplateSelect
                        ariaLabel={`${model.name} 推理强度`}
                        value={model.reasoningEffort || model.defaultReasoningEffort || ""}
                        options={getAiReasoningEffortOptions(model).filter((option) => option.value)}
                        disabled={busy || !model.supportedReasoningEfforts?.length}
                        onChange={(value) => saveModelReasoningEffort(model, value)}
                      />
                    </div>
                    <button type="button" className={isModelDefault ? "ai-model-default-control selected" : "ai-model-default-control"} disabled={busy || isModelDefault || !model.testedOk} onClick={(event) => { event.stopPropagation(); setDefaultModel(model); }}><span className="ai-model-default-indicator" aria-hidden="true" /><span>{isModelDefault ? "默认" : "设为默认"}</span></button>
                    <span className={`ai-status-pill ${model.testedOk ? "connected" : "idle"}`}>{model.testedOk ? "可用" : "不可用"}</span>
                  </div>
                );
              })}
            </div>
            <div className="ai-model-table-foot"><RefreshCw size={14} /><span>上次检查：{selectedLastUpdated}</span></div>
          </section>
        </>
      ) : (
        <>
          <section className="ai-settings-section">
            <div className="ai-settings-section-head">
              <h3>供应商信息</h3>
              <div className="ai-settings-section-actions">
                {!selectedDraft.builtin ? (
                  <button
                    type="button"
                    className="danger"
                    disabled={normalizedConfig.activeProvider === selectedProvider}
                    title={normalizedConfig.activeProvider === selectedProvider ? "请先切换默认供应商" : "删除供应商"}
                    onClick={() => setDeleteConfirm(true)}
                  >
                    <Trash2 size={15} />
                    <span>删除</span>
                  </button>
                ) : null}
                <button type="button" onClick={openProviderEditor}>
                  <Pencil size={15} />
                  <span>编辑</span>
                </button>
              </div>
            </div>
            <div className="ai-provider-info-grid">
              <article>
                <Globe2 size={17} />
                <span>Base URL</span>
                <strong>{selectedDraft.baseUrl}</strong>
              </article>
              <article>
                <KeyRound size={17} />
                <span>API Key</span>
                <strong>{selectedDraft.hasApiKey ? `••••••••••••${selectedDraft.apiKeyLast4 || "****"}` : "未填写"}</strong>
              </article>
              <article>
                <Hash size={17} />
                <span>供应商名称</span>
                <strong>{selectedDraft.providerLabel}</strong>
              </article>
              <article>
                <CheckCircle2 size={17} />
                <span>连接状态</span>
                <strong><i className={`ai-status-pill ${selectedConnection.tone}`}>{selectedConnection.statusLabel}</i></strong>
              </article>
              <article>
                <Sparkles size={17} />
                <span>接口协议</span>
                <strong>{AI_PROTOCOL_OPTIONS.find((option) => option.id === selectedDraft.protocol)?.label || "OpenAI 兼容"}</strong>
              </article>
            </div>
          </section>
          <section className="ai-settings-section">
            <div className="ai-settings-section-head">
              <h3>可用模型</h3>
              <button type="button" onClick={openAddModelEditor}>
                <Plus size={15} />
                <span>添加模型</span>
              </button>
            </div>
            <div className="ai-model-table ai-http-model-table" aria-label={`${selectedDraft.providerLabel} 模型`}>
              <div className="ai-model-table-head">
                <span>模型名称</span>
                <span>请求参数</span>
                <span>状态</span>
                <span>是否默认</span>
                <span>操作</span>
              </div>
              {selectedDraft.models.length === 0 ? (
                <div className="ai-model-empty">
                  <Bot size={24} aria-hidden="true" />
                  <strong>还没有可用模型</strong>
                  <span>添加模型后，可填写密钥并测试连接。</span>
                  <button type="button" onClick={openAddModelEditor}><Plus size={15} />添加模型</button>
                </div>
              ) : selectedDraft.models.map((model) => {
                const isModelDefault = normalizedConfig.activeProvider === selectedProvider && selectedDraft.activeModelId === model.id;
                const modelTone = model.testedOk ? "connected" : (model.testedAt ? "failed" : "idle");
                const visibleRequestParams = aiRequestParamsWithProviderDefaults(selectedProvider, model.requestParams || {}, model.model);
                return (
                  <div
                    key={model.id}
                    className={[
                      "ai-model-table-row",
                      model.id === selectedModel?.id ? "selected" : "",
                      model.testedOk ? "available" : "",
                    ].filter(Boolean).join(" ")}
                    onClick={() => setSelectedModelId(model.id)}
                  >
                    <div className="ai-model-name-cell">
                      <span className="ai-model-icon"><Bot size={16} /></span>
                      <div>
                        <strong>{model.name}</strong>
                        <em>{model.model}</em>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="ai-model-params-control"
                      disabled={busy}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedModelId(model.id);
                        openEditModelEditor(model);
                      }}
                    >
                      {Object.keys(visibleRequestParams).length ? `${Object.keys(visibleRequestParams).length} 项` : "未设置"}
                    </button>
                    <span className={`ai-status-pill ${modelTone}`}>{model.testedOk ? "可用" : (model.testedAt ? "不可用" : "未测试")}</span>
                    <button
                      type="button"
                      className={isModelDefault ? "ai-model-default-control selected" : "ai-model-default-control"}
                      disabled={busy || isModelDefault || !model.testedOk}
                      title={!model.testedOk ? "请先测试模型" : (isModelDefault ? "默认模型" : "设为默认")}
                      onClick={(event) => {
                        event.stopPropagation();
                        setDefaultModel(model);
                      }}
                    >
                      <span className="ai-model-default-indicator" aria-hidden="true" />
                      <span>{isModelDefault ? "默认" : "设为默认"}</span>
                    </button>
                    <div className="ai-model-actions" aria-label={`${model.name} 操作`}>
                      <button
                        type="button"
                        aria-label={`编辑模型：${model.name}`}
                        title="编辑模型"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedModelId(model.id);
                          openEditModelEditor(model);
                        }}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        aria-label={`测试连接：${model.name}`}
                        title="测试连接"
                        onClick={(event) => {
                          event.stopPropagation();
                          testModel(model);
                        }}
                      >
                        <Wifi size={15} />
                      </button>
                      <button
                        type="button"
                        className="danger"
                        aria-label={`删除模型：${model.name}`}
                        disabled={selectedDraft.models.length <= 1 && (selectedDraft.builtin || normalizedConfig.activeProvider === selectedProvider)}
                        title={selectedDraft.models.length <= 1 && (selectedDraft.builtin || normalizedConfig.activeProvider === selectedProvider)
                          ? "至少保留一个模型"
                          : (AI_TASK_MODEL_DEFINITIONS.some((task) => normalizedConfig.taskModels?.[task.id]?.providerId === selectedProvider && normalizedConfig.taskModels?.[task.id]?.modelId === model.id)
                            ? "删除模型；关联任务将需要重新选择"
                            : "删除模型")}
                        onClick={(event) => {
                          event.stopPropagation();
                          removeModelDraft(model.id);
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="ai-model-table-foot">
              <RefreshCw size={14} />
              <span>上次更新：{selectedLastUpdated}</span>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
