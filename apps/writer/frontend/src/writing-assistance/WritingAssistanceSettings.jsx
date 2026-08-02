import {
  ArrowRight,
  BookOpenCheck,
  Check,
  Languages,
  ListChecks,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import { useRef, useState } from "react";
import { useModalFocusTrap } from "../ui-interactions.js";
import {
  BILINGUAL_WRITING_ASSISTANCE_LANGUAGE,
  normalizeWritingAssistanceConfig,
} from "./model.js";
import "./writing-assistance.css";

const LANGUAGE_OPTIONS = Object.freeze([
  Object.freeze({ value: "zh-CN", label: "中", ariaLabel: "仅检查中文" }),
  Object.freeze({ value: "en-US", label: "En", ariaLabel: "仅检查英文" }),
  Object.freeze({
    value: BILINGUAL_WRITING_ASSISTANCE_LANGUAGE,
    label: "中英",
    ariaLabel: "同时检查中文和英文",
  }),
]);

function newRuleId() {
  return globalThis.crypto?.randomUUID?.() || `term-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function ruleDraft(rule = null) {
  return {
    id: String(rule?.id || ""),
    incorrect: String(rule?.incorrect || ""),
    preferred: String(rule?.preferred || ""),
    description: String(rule?.description || ""),
    caseSensitive: rule?.caseSensitive === true,
    wholeWord: rule?.wholeWord === true,
    enabled: rule?.enabled !== false,
  };
}

export default function WritingAssistanceSettings({
  initialFocusRef,
  value,
  onChange,
  disabled = false,
}) {
  const config = normalizeWritingAssistanceConfig(value);
  const [whitelistEditorOpen, setWhitelistEditorOpen] = useState(false);
  const [whitelistWord, setWhitelistWord] = useState("");
  const [ruleEditor, setRuleEditor] = useState(null);
  const whitelistDialogRef = useRef(null);
  const whitelistFirstFieldRef = useRef(null);
  const whitelistReturnFocusRef = useRef(null);
  const ruleDialogRef = useRef(null);
  const ruleFirstFieldRef = useRef(null);
  const ruleReturnFocusRef = useRef(null);
  useModalFocusTrap(
    whitelistEditorOpen,
    whitelistDialogRef,
    whitelistFirstFieldRef,
    whitelistReturnFocusRef,
  );
  useModalFocusTrap(Boolean(ruleEditor), ruleDialogRef, ruleFirstFieldRef, ruleReturnFocusRef);

  const update = (patch) => onChange?.(normalizeWritingAssistanceConfig({ ...config, ...patch }));
  const openWhitelistEditor = (trigger) => {
    whitelistReturnFocusRef.current = trigger || globalThis.document?.activeElement || null;
    setWhitelistWord("");
    setWhitelistEditorOpen(true);
  };
  const closeWhitelistEditor = () => setWhitelistEditorOpen(false);
  const normalizedWhitelistWord = whitelistWord.trim();
  const whitelistWordExists = config.customWords.includes(normalizedWhitelistWord);
  const whitelistEditorValid = Boolean(normalizedWhitelistWord && !whitelistWordExists);
  const saveWhitelistWord = () => {
    if (!whitelistEditorValid) return;
    update({ customWords: [...config.customWords, normalizedWhitelistWord] });
    closeWhitelistEditor();
  };
  const openRuleEditor = (rule, trigger) => {
    ruleReturnFocusRef.current = trigger || globalThis.document?.activeElement || null;
    setRuleEditor(ruleDraft(rule));
  };
  const closeRuleEditor = () => setRuleEditor(null);
  const editorIncorrect = ruleEditor?.incorrect.trim() || "";
  const editorPreferred = ruleEditor?.preferred.trim() || "";
  const ruleEditorValid = Boolean(
    editorIncorrect
    && editorPreferred
    && editorIncorrect !== editorPreferred,
  );
  const saveRuleEditor = () => {
    if (!ruleEditorValid) return;
    const nextRule = {
      ...ruleEditor,
      id: ruleEditor.id || newRuleId(),
      incorrect: editorIncorrect,
      preferred: editorPreferred,
      description: ruleEditor.description.trim(),
    };
    update({
      terminologyRules: ruleEditor.id
        ? config.terminologyRules.map((rule) => (rule.id === ruleEditor.id ? nextRule : rule))
        : [...config.terminologyRules, nextRule],
    });
    closeRuleEditor();
  };

  return (
    <section className="writing-assistance-settings" aria-labelledby="writing-assistance-settings-title">
      <header className="writing-assistance-overview">
        <span className="writing-assistance-overview-icon" aria-hidden="true">
          <ShieldCheck size={19} />
        </span>
        <div className="writing-assistance-overview-copy">
          <h3 id="writing-assistance-settings-title">本地写作检查</h3>
          <p>拼写、白名单和用词规范均在当前设备上运行，正文不会被上传。</p>
        </div>
        <div className="writing-assistance-overview-controls">
          <div className="writing-assistance-inline-language">
            <span><Languages size={14} aria-hidden="true" />拼写语言</span>
            <div className="writing-assistance-language-options" role="radiogroup" aria-label="拼写检查语言">
              {LANGUAGE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={config.language === option.value}
                  aria-label={option.ariaLabel}
                  className={config.language === option.value ? "selected" : ""}
                  disabled={disabled || !config.enabled}
                  onClick={() => update({ language: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <span className="writing-assistance-overview-divider" aria-hidden="true" />
          <div className="writing-assistance-switch-wrap">
            <span>{config.enabled ? "已启用" : "已关闭"}</span>
            <button
              ref={initialFocusRef}
              type="button"
              className={config.enabled ? "writing-assistance-switch checked" : "writing-assistance-switch"}
              role="switch"
              aria-checked={config.enabled}
              aria-label={config.enabled ? "关闭写作检查" : "启用写作检查"}
              disabled={disabled}
              onClick={() => update({ enabled: !config.enabled })}
            >
              <i aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <section className="writing-assistance-section writing-assistance-whitelist-section">
        <header className="writing-assistance-rules-heading">
          <div className="writing-assistance-section-heading">
            <span aria-hidden="true"><BookOpenCheck size={16} /></span>
            <div>
              <strong>白名单</strong>
              <small>加入后不再标记为拼写错误</small>
            </div>
          </div>
          <button
            type="button"
            disabled={disabled || !config.enabled}
            onClick={(event) => openWhitelistEditor(event.currentTarget)}
          >
            <Plus size={14} />添加名单
          </button>
        </header>
        <div className="writing-assistance-whitelist" aria-label="白名单词语">
          {config.customWords.map((word) => (
            <span key={word} className="writing-assistance-whitelist-item">
              <span>{word}</span>
              <button
                type="button"
                aria-label={`从白名单删除 ${word}`}
                title="删除白名单词语"
                disabled={disabled || !config.enabled}
                onClick={() => update({
                  customWords: config.customWords.filter((candidate) => candidate !== word),
                })}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          {!config.customWords.length ? (
            <p className="writing-assistance-whitelist-empty">暂无白名单词语</p>
          ) : null}
        </div>
        <small className="writing-assistance-whitelist-note">在正文右键加入词典的词，也会显示在这里。</small>
      </section>

      <section className="writing-assistance-section writing-assistance-terminology-section">
        <header className="writing-assistance-rules-heading">
          <div className="writing-assistance-section-heading">
            <span aria-hidden="true"><ListChecks size={16} /></span>
            <div>
              <strong>用词规范 <span className="writing-assistance-optional">可选</span></strong>
              <small>发现左侧写法时提示改成右侧写法</small>
            </div>
          </div>
          <button
            type="button"
            disabled={disabled || !config.enabled}
            onClick={(event) => openRuleEditor(null, event.currentTarget)}
          >
            <Plus size={14} />添加规则
          </button>
        </header>

        <div className="writing-assistance-rule-list">
          {config.terminologyRules.map((rule) => (
            <article key={rule.id} className={`writing-assistance-rule${rule.enabled ? "" : " is-disabled"}`}>
              <div className="writing-assistance-rule-map" title={rule.description || undefined}>
                <span>{rule.incorrect}</span>
                <ArrowRight size={15} aria-hidden="true" />
                <span>{rule.preferred}</span>
                {!rule.enabled ? <small>已停用</small> : null}
              </div>
              <div className="writing-assistance-rule-actions">
                <button
                  type="button"
                  aria-label={`编辑用词规范 ${rule.incorrect} 到 ${rule.preferred}`}
                  title="编辑规则"
                  disabled={disabled}
                  onClick={(event) => openRuleEditor(rule, event.currentTarget)}
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  aria-label={`删除用词规范 ${rule.incorrect} 到 ${rule.preferred}`}
                  title="删除规则"
                  disabled={disabled}
                  onClick={() => update({
                    terminologyRules: config.terminologyRules.filter((candidate) => candidate.id !== rule.id),
                  })}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </article>
          ))}
          {!config.terminologyRules.length ? <p className="writing-assistance-no-rules">暂无用词规范；只需要拼写白名单时，可以不添加。</p> : null}
        </div>
      </section>

      {whitelistEditorOpen && globalThis.document ? createPortal(
        <div
          className="writing-assistance-rule-editor-layer"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeWhitelistEditor();
          }}
        >
          <section
            ref={whitelistDialogRef}
            className="writing-assistance-rule-editor-dialog writing-assistance-whitelist-editor-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="writing-assistance-whitelist-editor-title"
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              closeWhitelistEditor();
            }}
          >
            <form onSubmit={(event) => { event.preventDefault(); saveWhitelistWord(); }}>
              <header>
                <div>
                  <h3 id="writing-assistance-whitelist-editor-title">添加白名单</h3>
                  <p>添加后，这个词将不再被标记为拼写错误。</p>
                </div>
                <button type="button" aria-label="关闭白名单编辑" onClick={closeWhitelistEditor}><X size={17} /></button>
              </header>
              <div className="writing-assistance-rule-editor-body">
                <label className="writing-assistance-whitelist-editor-field">
                  <span>词语</span>
                  <input
                    ref={whitelistFirstFieldRef}
                    value={whitelistWord}
                    placeholder="例如：笺间"
                    onChange={(event) => setWhitelistWord(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      saveWhitelistWord();
                    }}
                  />
                </label>
                {whitelistWordExists ? <p className="writing-assistance-rule-editor-error">这个词已在白名单中。</p> : null}
              </div>
              <footer>
                <button type="button" onClick={closeWhitelistEditor}>取消</button>
                <button type="submit" className="primary" disabled={!whitelistEditorValid}><Check size={14} />完成</button>
              </footer>
            </form>
          </section>
        </div>,
        globalThis.document.body,
      ) : null}

      {ruleEditor && globalThis.document ? createPortal(
        <div
          className="writing-assistance-rule-editor-layer"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeRuleEditor();
          }}
        >
          <section
            ref={ruleDialogRef}
            className="writing-assistance-rule-editor-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="writing-assistance-rule-editor-title"
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              closeRuleEditor();
            }}
          >
            <form onSubmit={(event) => { event.preventDefault(); saveRuleEditor(); }}>
              <header>
                <div>
                  <h3 id="writing-assistance-rule-editor-title">{ruleEditor.id ? "编辑用词规范" : "添加用词规范"}</h3>
                  <p>正文出现原写法时，会提示替换为推荐写法。</p>
                </div>
                <button type="button" aria-label="关闭用词规范编辑" onClick={closeRuleEditor}><X size={17} /></button>
              </header>
              <div className="writing-assistance-rule-editor-body">
                <div className="writing-assistance-rule-editor-map">
                  <label>
                    <span>原写法</span>
                    <input
                      ref={ruleFirstFieldRef}
                      value={ruleEditor.incorrect}
                      placeholder="例如：帐号"
                      onChange={(event) => setRuleEditor((current) => ({ ...current, incorrect: event.target.value }))}
                    />
                  </label>
                  <ArrowRight size={17} aria-hidden="true" />
                  <label>
                    <span>推荐写法</span>
                    <input
                      value={ruleEditor.preferred}
                      placeholder="例如：账号"
                      onChange={(event) => setRuleEditor((current) => ({ ...current, preferred: event.target.value }))}
                    />
                  </label>
                </div>
                <label className="writing-assistance-rule-editor-description">
                  <span>补充说明 <small>可选</small></span>
                  <input
                    value={ruleEditor.description}
                    placeholder="说明这条规范的使用场景"
                    onChange={(event) => setRuleEditor((current) => ({ ...current, description: event.target.value }))}
                  />
                </label>
                <fieldset>
                  <legend>匹配方式</legend>
                  <label><input type="checkbox" checked={ruleEditor.enabled} onChange={(event) => setRuleEditor((current) => ({ ...current, enabled: event.target.checked }))} />启用规则</label>
                  <label><input type="checkbox" checked={ruleEditor.caseSensitive} onChange={(event) => setRuleEditor((current) => ({ ...current, caseSensitive: event.target.checked }))} />区分大小写</label>
                  <label><input type="checkbox" checked={ruleEditor.wholeWord} onChange={(event) => setRuleEditor((current) => ({ ...current, wholeWord: event.target.checked }))} />全词匹配</label>
                </fieldset>
                {editorIncorrect && editorIncorrect === editorPreferred ? <p className="writing-assistance-rule-editor-error">原写法和推荐写法不能相同。</p> : null}
              </div>
              <footer>
                <button type="button" onClick={closeRuleEditor}>取消</button>
                <button type="submit" className="primary" disabled={!ruleEditorValid}><Check size={14} />完成</button>
              </footer>
            </form>
          </section>
        </div>,
        globalThis.document.body,
      ) : null}
    </section>
  );
}
