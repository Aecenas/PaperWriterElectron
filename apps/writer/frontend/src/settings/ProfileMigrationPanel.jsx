import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Download,
  KeyRound,
  PackageOpen,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { bridge as defaultBridge } from "../bridge.js";
import { applyPreparedProfileImport } from "./profile-import-transaction.js";
import { normalizeProfileDiff } from "./profile-migration-model.js";
import "./profile-migration.css";

const PROFILE_SECTIONS = [
  { id: "preferences", label: "界面与编辑偏好" },
  { id: "templates", label: "信笺模板" },
  { id: "ai", label: "AI 服务商、模型与任务分配" },
  { id: "writingAssistance", label: "写作检查与自定义词典" },
];

const PROFILE_DIFF_ACTIONS = Object.freeze({
  add: "新增",
  overwrite: "覆盖本机",
  remap: "冲突，导入为新 ID",
  unchanged: "无变化",
  "keep-local": "冲突，保留本机",
});

function profileDiffItemLabel(item) {
  if (item.key) return item.key;
  if (item.wrong) {
    return item.preferred
      ? `${item.wrong} → ${item.preferred}`
      : item.wrong;
  }
  return item.title || item.id || "未命名项目";
}

function ProfileMigrationStepHeader({
  eyebrow,
  title,
  description,
  onBack,
  backLabel = "返回",
}) {
  return (
    <div className="profile-migration-step-header">
      {onBack ? (
        <button type="button" className="profile-migration-back" onClick={onBack}>
          <ArrowLeft size={15} />{backLabel}
        </button>
      ) : null}
      <div>
        <small>{eyebrow}</small>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </div>
  );
}

export function ProfileMigrationPanel({
  bridge = defaultBridge,
  preferences = {},
  templates = {},
  onApplyPreferences,
  onApplyTemplates,
  onClose,
  onReload = () => window.location.reload(),
  onError,
}) {
  const [mode, setMode] = useState("home");
  const [busy, setBusy] = useState(false);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [inspection, setInspection] = useState(null);
  const [importPassphrase, setImportPassphrase] = useState("");
  const [sections, setSections] = useState(Object.fromEntries(PROFILE_SECTIONS.map((item) => [item.id, true])));
  const [completed, setCompleted] = useState("");
  const preferenceKeys = useMemo(() => Object.keys(preferences || {}).sort(), [preferences]);
  const sectionDiff = useMemo(
    () => normalizeProfileDiff(inspection?.preview),
    [inspection?.preview],
  );

  const run = async (operation) => {
    setBusy(true);
    try {
      return await operation();
    } catch (error) {
      onError?.(error);
      return null;
    } finally {
      setBusy(false);
    }
  };

  if (completed) {
    return (
      <section className="profile-migration-panel profile-migration-complete">
        <ShieldCheck size={42} />
        <h2>{completed}</h2>
        <p>配置已通过完整性校验。导入不会包含最近文件、标签页、机器路径、历史、日志、缓存、OAuth 或 Codex 登录状态。</p>
        <button type="button" className="settings-primary" onClick={completed.includes("导入") ? onReload : onClose}>
          {completed.includes("导入") ? "安全重载应用" : "完成"}
        </button>
      </section>
    );
  }

  if (mode === "home") {
    return (
      <section className="profile-migration-panel">
        <ProfileMigrationStepHeader
          title="选择迁移方式"
          description="导出一份可移植配置，或从另一台设备安全合并。"
        />
        <div className="profile-migration-options">
          <button type="button" onClick={() => setMode("export")}>
            <span className="profile-migration-option-icon"><Download size={23} strokeWidth={2.25} /></span>
            <span className="profile-migration-option-copy">
              <strong>导出配置包</strong>
              <small>生成版本化 .jianprofile，可选择用口令携带 API Key。</small>
            </span>
            <ChevronRight className="profile-migration-option-chevron" size={17} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setMode("import")}>
            <span className="profile-migration-option-icon"><Upload size={23} strokeWidth={2.25} /></span>
            <span className="profile-migration-option-copy">
              <strong>导入配置包</strong>
              <small>先校验清单和校验和，再预览分项变化。</small>
            </span>
            <ChevronRight className="profile-migration-option-chevron" size={17} aria-hidden="true" />
          </button>
        </div>
        <div className="profile-exclusions">
          <ShieldCheck size={18} />
          <p><strong>默认隐私边界</strong>：不导出绝对路径、最近文件、恢复文件、历史版本、日志、缓存、表情最近记录、OAuth/Codex 登录状态；API Key 默认也不导出。</p>
        </div>
      </section>
    );
  }

  if (mode === "export") {
    const passwordValid = !includeSecrets
      || (passphrase.length >= 12 && passphrase === confirmation);
    return (
      <section className="profile-migration-panel profile-migration-export-step">
        <ProfileMigrationStepHeader
          eyebrow="导出配置"
          title="创建配置备份"
          description="普通设置、模板、模型配置和写作词典会写入校验完整的 ZIP 容器。"
          onBack={() => setMode("home")}
        />
        <ul className="profile-section-summary">
          {PROFILE_SECTIONS.map((item) => <li key={item.id}><Check size={14} />{item.label}</li>)}
        </ul>
        <div className="profile-secret-toggle">
          <span className="profile-secret-toggle-icon" aria-hidden="true"><KeyRound size={17} /></span>
          <span className="profile-secret-toggle-copy">
            <strong>包含 API Key</strong>
            <small>启用后使用 scrypt 与 AES-256-GCM 加密，口令不会保存。</small>
          </span>
          <span className="profile-secret-toggle-control">
            <span>{includeSecrets ? "已包含" : "不包含"}</span>
            <button
              type="button"
              role="switch"
              aria-checked={includeSecrets}
              aria-label="导出时包含 API Key"
              className={includeSecrets ? "profile-migration-switch checked" : "profile-migration-switch"}
              onClick={() => {
                const nextValue = !includeSecrets;
                setIncludeSecrets(nextValue);
                if (!nextValue) {
                  setPassphrase("");
                  setConfirmation("");
                }
              }}
            >
              <i aria-hidden="true" />
            </button>
          </span>
        </div>
        {includeSecrets ? (
          <div className="profile-passphrase-grid">
            <label><span>配置包口令（至少 12 位）</span><input type="password" autoComplete="new-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /></label>
            <label><span>再次输入口令</span><input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
            {confirmation && passphrase !== confirmation ? <p role="alert">两次口令不一致。</p> : null}
          </div>
        ) : null}
        <footer>
          <span>{preferenceKeys.length} 个偏好键将经过敏感字段过滤。</span>
          <button type="button" className="settings-primary" disabled={busy || !passwordValid} onClick={() => void run(async () => {
            const result = await bridge.exportProfile?.({
              preferences,
              templates,
              includeSecrets,
              passphrase: includeSecrets ? passphrase : "",
            });
            if (result && !result.canceled) {
              setPassphrase("");
              setConfirmation("");
              setCompleted("配置已导出");
            }
          })}><Download size={16} />{busy ? "正在创建…" : "选择位置并导出"}</button>
        </footer>
      </section>
    );
  }

  if (!inspection) {
    return (
      <section className="profile-migration-panel profile-migration-import-step">
        <ProfileMigrationStepHeader
          eyebrow="导入配置"
          title="选择并检查配置包"
          description="选择文件后会先检查包大小、清单、结构版本和内容完整性。"
          onBack={() => setMode("home")}
        />
        <div className="profile-import-drop">
          <span className="profile-import-drop-icon" aria-hidden="true"><PackageOpen size={24} /></span>
          <div className="profile-import-drop-copy">
            <h4>选择配置包</h4>
            <p>文件会先完成清单、版本与完整性校验，不会直接写入当前设备。</p>
          </div>
          <button type="button" className="settings-primary" disabled={busy} onClick={() => void run(async () => {
            const result = await bridge.inspectProfile?.({
              currentPreferences: preferences,
              currentTemplates: templates,
            });
            if (result && !result.canceled) setInspection(result);
          })}><Upload size={15} />{busy ? "正在校验…" : "选择 .jianprofile"}</button>
          <small>仅支持由笺间导出的 .jianprofile 配置包</small>
        </div>
      </section>
    );
  }

  const requiresPassphrase = Boolean(
    inspection.requiresPassphrase
    || inspection.manifest?.sections?.secrets
    || inspection.preview?.includesSecrets,
  );
  if (requiresPassphrase && inspection.verified !== true) {
    return (
      <section className="profile-migration-panel profile-migration-import-step profile-migration-unlock-step">
        <ProfileMigrationStepHeader
          eyebrow="口令验证"
          title="先解锁加密配置"
          description="验证成功后才会展示导入差异，口令不会保存。"
          backLabel="重新选择"
          onBack={() => {
            setInspection(null);
            setImportPassphrase("");
          }}
        />
        <div className="profile-import-drop">
          <span className="profile-import-drop-icon" aria-hidden="true"><KeyRound size={23} /></span>
          <div className="profile-import-drop-copy">
            <h4>输入配置包口令</h4>
            <p>验证成功后才会展示差异；口令只在内存中用于本次验证，不会保存或写入日志。</p>
          </div>
          <label className="profile-import-password">
            <span>配置包口令</span>
            <input
              type="password"
              autoComplete="current-password"
              autoFocus
              value={importPassphrase}
              onChange={(event) => setImportPassphrase(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || busy || importPassphrase.length < 12) return;
                event.preventDefault();
                void run(async () => {
                  if (typeof bridge.verifyProfile !== "function") {
                    throw new Error("当前应用版本不支持加密配置包预检");
                  }
                  const result = await bridge.verifyProfile({
                    importToken: inspection.importToken,
                    passphrase: importPassphrase,
                  });
                  if (result?.verified) {
                    setInspection((current) => ({
                      ...current,
                      ...result,
                      importToken: current.importToken,
                      requiresPassphrase: true,
                    }));
                  }
                });
              }}
            />
          </label>
          <button
            type="button"
            className="settings-primary"
            disabled={busy || importPassphrase.length < 12}
            onClick={() => void run(async () => {
              if (typeof bridge.verifyProfile !== "function") {
                throw new Error("当前应用版本不支持加密配置包预检");
              }
              const result = await bridge.verifyProfile({
                importToken: inspection.importToken,
                passphrase: importPassphrase,
              });
              if (result?.verified) {
                setInspection((current) => ({
                  ...current,
                  ...result,
                  importToken: current.importToken,
                  requiresPassphrase: true,
                }));
              }
            })}
          >{busy ? "正在验证…" : "验证口令并查看差异"}</button>
        </div>
      </section>
    );
  }

  const preview = inspection.preview || {};
  const needsPassphrase = requiresPassphrase;
  return (
      <section className="profile-migration-panel profile-migration-preview-step">
      <ProfileMigrationStepHeader
        eyebrow="导入预览"
        title="选择要合并的配置"
        description="先核对每一类变化，再决定是否导入当前设备。"
        backLabel="重新选择"
        onBack={() => {
          setInspection(null);
          setImportPassphrase("");
        }}
      />
      <dl className="profile-preview-metrics">
        <div><dt>偏好键</dt><dd>{preview.preferenceKeys?.length || 0}</dd></div>
        <div><dt>模板</dt><dd>{preview.templateCount || 0}</dd></div>
        <div><dt>AI 服务商</dt><dd>{preview.providerCount || 0}</dd></div>
        <div><dt>术语规则</dt><dd>{preview.termRuleCount || 0}</dd></div>
      </dl>
      <fieldset className="profile-import-sections">
        <legend>导入分项</legend>
        {PROFILE_SECTIONS.map((item) => (
          <label key={item.id}>
            <input type="checkbox" checked={sections[item.id]} onChange={(event) => setSections((current) => ({ ...current, [item.id]: event.target.checked }))} />
            <span>{item.label}</span>
          </label>
        ))}
      </fieldset>
      {preview.preferenceKeys?.length ? (
        <details className="profile-key-diff">
          <summary>将覆盖或新增的偏好键</summary>
          <ul>{preview.preferenceKeys.map((key) => <li key={key}>{key}{Object.hasOwn(preferences, key) ? <em>覆盖本地</em> : <em>新增</em>}</li>)}</ul>
        </details>
      ) : null}
      <div className="profile-migration-diff-list" aria-label="配置导入分项差异">
        {sectionDiff.map((section) => (
          <article key={section.id}>
            <div>
              <strong>{section.label}</strong>
              <small>
                {section.added ? `新增 ${section.added}` : ""}
                {section.changed ? `${section.added ? " · " : ""}变化 ${section.changed}` : ""}
                {section.conflicts ? ` · 冲突 ${section.conflicts}` : ""}
                {!section.added && !section.changed && !section.conflicts ? "无变化" : ""}
              </small>
            </div>
            {section.summary ? <p>{section.summary}</p> : null}
            {section.items.length ? (
              <ul>
                {section.items.slice(0, 20).map((item, index) => (
                  <li key={`${item.key || item.id || item.wrong || index}-${index}`}>
                    <span>{profileDiffItemLabel(item)}</span>
                    <em className={item.action === "keep-local" || item.action === "remap" ? "is-warning" : ""}>
                      {PROFILE_DIFF_ACTIONS[item.action] || "变化"}
                    </em>
                  </li>
                ))}
                {section.items.length > 20 ? <li>另有 {section.items.length - 20} 项…</li> : null}
              </ul>
            ) : null}
            {section.warnings.map((warning) => (
              <small key={warning} className="is-warning">{warning}</small>
            ))}
          </article>
        ))}
      </div>
      {sectionDiff.some((section) => section.id === "writingAssistance" && section.conflicts > 0) ? (
        <div className="profile-exclusions" role="status">
          <ShieldCheck size={18} />
          <p><strong>术语冲突不会覆盖本机规则</strong>：上方已列出冲突项；继续导入将保留本机写法，并导入其余规则。</p>
        </div>
      ) : null}
      {needsPassphrase ? (
        <div className="profile-exclusions">
          <ShieldCheck size={18} />
          <p><strong>加密口令已验证</strong>：差异预览来自已通过 GCM 认证的配置包；口令仍只保留在本页内存中，导入后立即清除。</p>
        </div>
      ) : null}
      <footer>
        <span>HTTP 模型导入后会重置为“未测试”。</span>
        <button type="button" className="settings-primary" disabled={busy || !Object.values(sections).some(Boolean) || (needsPassphrase && importPassphrase.length < 12)} onClick={() => void run(async () => {
          try {
            const prepared = await bridge.importProfile?.({
              importToken: inspection.importToken,
              passphrase: importPassphrase,
              sections,
              currentPreferences: preferences,
              currentTemplates: templates,
            });
            if (!prepared?.ok) return;
            const applied = await applyPreparedProfileImport({
              bridge,
              prepared,
              sections,
              previousPreferences: preferences,
              previousTemplates: templates,
              onApplyPreferences,
              onApplyTemplates,
            });
            setImportPassphrase("");
            const conflicts = Math.max(0, Number(applied?.termConflicts) || 0);
            setCompleted(
              conflicts
                ? `配置已导入（${conflicts} 条术语冲突已保留本机规则）`
                : "配置已导入",
            );
          } catch (error) {
            setImportPassphrase("");
            setInspection(null);
            throw error;
          }
        })}><Upload size={16} />{busy ? "正在导入…" : "确认导入"}</button>
      </footer>
    </section>
  );
}

export default ProfileMigrationPanel;
