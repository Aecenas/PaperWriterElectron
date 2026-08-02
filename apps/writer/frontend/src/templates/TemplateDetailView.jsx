import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronRight,
  Copy,
  Plus,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import {
  BASE_USER_TEMPLATE_GROUP_ID,
  TEMPLATE_DESCRIPTION_MAX_LENGTH,
  TEMPLATE_FONT_SELECT_OPTIONS,
  TYPOGRAPHY_FIELDS,
  fontStack,
  normalizeTemplateDescription,
} from "./model.js";
import {
  TemplateHeadingColorPicker,
  TemplateNameInput,
  TemplatePaperPicker,
  TemplateSettingSwitch,
  TemplateSizeInput,
} from "./TemplateControls.jsx";
import { TemplateSelect } from "./TemplateSelect.jsx";

export function TemplateDetailView({
  detailTemplate,
  detailPaper,
  detailEditable,
  detailIsActive,
  detailIsDraft,
  detailIsNewDocumentDefault,
  detailTemplateGroupIds,
  detailPresentation,
  selectionOnly,
  manageOnly,
  newDocumentTemplate,
  userTemplateGroups,
  paperPickerGroups,
  templateNameError,
  groupPickerRef,
  groupPickerOpen,
  advancedOpen,
  onSetGroupPickerOpen,
  onSetAdvancedOpen,
  onUpdateDetailTemplate,
  onUpdateTypography,
  onUpdatePresentation,
  onChangeDetailTemplateGroup,
  onNewDocumentTemplateChange,
  onConfirmTemplateCreation,
  onCancelTemplateCreation,
  onLetterTemplateChange,
  onClose,
  onCreateTemplate,
  onDeleteTemplate,
}) {
  return (
    <div className="template-detail">
      <div className="template-detail-layout">
        <div className="template-detail-preview-column">
          <div
            className="template-detail-preview"
            role="img"
            aria-label={`${detailTemplate.label}信纸预览`}
            style={{ "--template-bg": `url("${detailPaper.background}")`, "--swatch": detailPaper.swatch }}
          />
          {!selectionOnly && !detailIsDraft ? (
            <>
              <div className="template-default-setting">
                <span>设为新建默认模板</span>
                <button
                  type="button"
                  className={detailIsNewDocumentDefault ? "template-default-switch checked" : "template-default-switch"}
                  role="switch"
                  aria-checked={detailIsNewDocumentDefault}
                  aria-label={detailIsNewDocumentDefault
                    ? `取消将“${detailTemplate.label}”作为新建信笺的默认模板`
                    : `将“${detailTemplate.label}”设为新建信笺的默认模板`}
                  title={detailIsNewDocumentDefault ? "取消并恢复上一个默认模板" : "设为新建默认模板"}
                  onClick={() => onNewDocumentTemplateChange(detailTemplate.id)}
                >
                  <i aria-hidden="true" />
                </button>
              </div>
              <small className="template-default-current" aria-live="polite">
                当前新建默认：<strong>{newDocumentTemplate.label}</strong>
              </small>
            </>
          ) : null}
        </div>

        <div className="template-detail-settings">
          <div className="template-detail-header">
            {detailEditable ? (
              <TemplateNameInput
                value={detailTemplate.label}
                onChange={(label) => onUpdateDetailTemplate({ label })}
                error={templateNameError}
              />
            ) : (
              <strong>{detailTemplate.label}</strong>
            )}
            <div
              className="template-detail-badges"
              aria-label={`${detailTemplate.userTemplate ? "用户模板" : "系统模板"}，${detailEditable ? "可编辑" : "不可修改"}`}
            >
              <span className={detailTemplate.userTemplate ? "user" : "system"}>
                {detailTemplate.userTemplate ? "用户模板" : "系统模板"}
              </span>
              <span className={detailEditable ? "editable" : "readonly"}>
                {detailEditable ? "可编辑" : "不可修改"}
              </span>
              {detailIsActive ? <span className="current">当前使用</span> : null}
            </div>
          </div>

          <div className="template-edit-row template-paper-row">
            <span>信纸背景</span>
            {detailEditable ? (
              <TemplatePaperPicker
                value={detailTemplate.paperId}
                groups={paperPickerGroups}
                onChange={(paperId) => onUpdateDetailTemplate({ paperId })}
              />
            ) : (
              <em>{detailPaper.label}</em>
            )}
          </div>

          {detailEditable ? (
            <div className="template-edit-row template-group-select-row">
              <span>所属分组</span>
              <div ref={groupPickerRef} className={`template-group-chip-editor${groupPickerOpen ? " open" : ""}`}>
                <div className="template-group-chips">
                  {userTemplateGroups
                    .filter((group) => detailTemplateGroupIds.includes(group.id))
                    .map((group) => {
                      const isBaseGroup = group.id === BASE_USER_TEMPLATE_GROUP_ID;
                      return (
                        <span key={group.id} className={`template-group-chip${isBaseGroup ? " required" : ""}`}>
                          <span>{group.label}</span>
                          {isBaseGroup ? <small>固定</small> : (
                            <button
                              type="button"
                              aria-label={`移除分组 ${group.label}`}
                              title={`移除“${group.label}”`}
                              onClick={() => onChangeDetailTemplateGroup(group.id, false)}
                            >
                              <X size={12} aria-hidden="true" />
                            </button>
                          )}
                        </span>
                      );
                    })}
                  <button
                    type="button"
                    className="template-group-add"
                    onClick={() => onSetGroupPickerOpen((open) => !open)}
                    aria-expanded={groupPickerOpen}
                    aria-controls="template-group-chip-options"
                    aria-label="添加所属分组"
                    disabled={userTemplateGroups.every((group) => detailTemplateGroupIds.includes(group.id))}
                  >
                    <Plus size={13} aria-hidden="true" />
                    <span>添加</span>
                  </button>
                </div>
                {groupPickerOpen ? (
                  <div id="template-group-chip-options" className="template-group-chip-options" role="listbox" aria-label="可添加分组">
                    {userTemplateGroups
                      .filter((group) => !detailTemplateGroupIds.includes(group.id))
                      .map((group) => (
                        <button
                          key={group.id}
                          type="button"
                          role="option"
                          aria-selected="false"
                          onClick={() => {
                            onChangeDetailTemplateGroup(group.id, true);
                            onSetGroupPickerOpen(false);
                          }}
                        >
                          <Plus size={13} aria-hidden="true" />
                          <span>{group.label}</span>
                        </button>
                      ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {detailEditable ? (
            <div className="template-edit-row template-description-row">
              <span>封面简介</span>
              <label className="template-description-control">
                <input
                  value={detailTemplate.description}
                  maxLength={TEMPLATE_DESCRIPTION_MAX_LENGTH}
                  onChange={(event) => onUpdateDetailTemplate({
                    description: Array.from(event.target.value).slice(0, TEMPLATE_DESCRIPTION_MAX_LENGTH).join(""),
                  })}
                  onBlur={(event) => onUpdateDetailTemplate({ description: normalizeTemplateDescription(event.target.value) })}
                  aria-label="封面简介"
                />
                <small aria-hidden="true">
                  {Array.from(detailTemplate.description).length}/{TEMPLATE_DESCRIPTION_MAX_LENGTH}
                </small>
              </label>
            </div>
          ) : null}

          <div className="template-typography-head" aria-hidden="true">
            <span>排版项目</span>
            <span>字体</span>
            <span className="template-size-heading">字号<small>（10–48）</small></span>
            <span>预览</span>
          </div>
          <div className="template-typography-list">
            {TYPOGRAPHY_FIELDS.map((field) => (
              <div key={field.key} className="template-typography-row">
                <span>{field.label}</span>
                {detailEditable ? (
                  <>
                    <TemplateSelect
                      ariaLabel={`${field.label}字体`}
                      value={detailTemplate.typography[field.fontKey]}
                      options={TEMPLATE_FONT_SELECT_OPTIONS}
                      onChange={(font) => onUpdateTypography({ [field.fontKey]: font })}
                    />
                    <TemplateSizeInput
                      ariaLabel={field.label}
                      value={detailTemplate.typography[field.sizeKey]}
                      onChange={(size) => onUpdateTypography({ [field.sizeKey]: size })}
                    />
                  </>
                ) : (
                  <>
                    <em>{detailTemplate.typography[field.fontKey]}</em>
                    <b>{detailTemplate.typography[field.sizeKey]}</b>
                  </>
                )}
                <span
                  className="template-font-preview"
                  title={`${detailTemplate.typography[field.fontKey]} · ${detailTemplate.typography[field.sizeKey]}px`}
                  style={{
                    fontFamily: fontStack(detailTemplate.typography[field.fontKey]),
                    fontSize: `${detailTemplate.typography[field.sizeKey]}px`,
                  }}
                >
                  春风入信
                </span>
              </div>
            ))}
          </div>

          <section className={`template-advanced-settings${advancedOpen ? " open" : ""}`}>
            <button
              type="button"
              className="template-advanced-trigger"
              aria-expanded={advancedOpen}
              aria-controls="template-advanced-options"
              onClick={() => onSetAdvancedOpen((current) => !current)}
            >
              <span>
                <Settings size={14} aria-hidden="true" />
                <strong>高级选项</strong>
                <small>页面结构、段落与编号</small>
              </span>
              <ChevronRight size={15} aria-hidden="true" />
            </button>
            {advancedOpen ? (
              <div id="template-advanced-options" className="template-advanced-content">
                <fieldset>
                  <legend>页面结构</legend>
                  <div className="template-advanced-control-row">
                    <span><strong>文章标题</strong><small>显示信笺顶部标题</small></span>
                    <TemplateSettingSwitch
                      checked={detailPresentation.showDocumentTitle}
                      label="显示文章标题"
                      disabled={!detailEditable}
                      onChange={(showDocumentTitle) => onUpdatePresentation({ showDocumentTitle })}
                    />
                  </div>
                  <div className="template-advanced-control-row">
                    <span><strong>署名与日期</strong><small>显示作者署名和写作日期</small></span>
                    <TemplateSettingSwitch
                      checked={detailPresentation.showSignatureDate}
                      label="显示署名与日期"
                      disabled={!detailEditable}
                      onChange={(showSignatureDate) => onUpdatePresentation({ showSignatureDate })}
                    />
                  </div>
                </fieldset>

                <fieldset>
                  <legend>正文段落</legend>
                  <div className="template-advanced-control-row">
                    <span><strong>首行缩进</strong><small>普通段落缩进两个汉字</small></span>
                    <TemplateSettingSwitch
                      checked={detailPresentation.indentParagraphs}
                      label="正文段落首行缩进两个字"
                      disabled={!detailEditable}
                      onChange={(indentParagraphs) => onUpdatePresentation({ indentParagraphs })}
                    />
                  </div>
                  <div className="template-advanced-control-row">
                    <span><strong>默认对齐</strong><small>手动对齐仍可单独覆盖</small></span>
                    <div className="template-paragraph-align" aria-label="正文段落默认对齐">
                      {[
                        { value: "left", label: "偏左", icon: AlignLeft },
                        { value: "center", label: "居中", icon: AlignCenter },
                        { value: "right", label: "偏右", icon: AlignRight },
                      ].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={detailPresentation.paragraphAlign === option.value ? "active" : ""}
                          aria-pressed={detailPresentation.paragraphAlign === option.value}
                          disabled={!detailEditable}
                          onClick={() => onUpdatePresentation({ paragraphAlign: option.value })}
                        >
                          <option.icon size={13} aria-hidden="true" />
                          <span>{option.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </fieldset>

                <fieldset className="template-heading-advanced-group">
                  <legend>章节标题</legend>
                  {[1, 2, 3, 4].map((level) => (
                    <div key={level} className="template-heading-advanced-row">
                      <span><strong>{["一", "二", "三", "四"][level - 1]}级标题</strong></span>
                      <TemplateHeadingColorPicker
                        value={detailPresentation.headingColors[level]}
                        label={`${level}级标题颜色`}
                        disabled={!detailEditable}
                        onChange={(color) => onUpdatePresentation({
                          headingColors: { ...detailPresentation.headingColors, [level]: color },
                        })}
                      />
                      <span className="template-heading-numbering-label">默认编号</span>
                      <TemplateSettingSwitch
                        checked={detailPresentation.headingNumbering[level]}
                        label={`${level}级标题默认编号`}
                        disabled={!detailEditable}
                        onChange={(checked) => onUpdatePresentation({
                          headingNumbering: { ...detailPresentation.headingNumbering, [level]: checked },
                        })}
                      />
                    </div>
                  ))}
                </fieldset>

                <fieldset>
                  <legend>图标题</legend>
                  <div className="template-advanced-control-row">
                    <span><strong>显示图标题</strong><small>统一控制图片与 Mermaid 图；关闭后页面、导出与 AI 均忽略</small></span>
                    <TemplateSettingSwitch
                      checked={detailPresentation.showImageCaptions}
                      label="显示图片与 Mermaid 图标题"
                      disabled={!detailEditable}
                      onChange={(showImageCaptions) => onUpdatePresentation({ showImageCaptions })}
                    />
                  </div>
                  <div className={`template-advanced-control-row${!detailPresentation.showImageCaptions ? " disabled" : ""}`}>
                    <span><strong>显示图编号</strong><small>图片与 Mermaid 图按正文顺序统一编号</small></span>
                    <TemplateSettingSwitch
                      checked={detailPresentation.numberImageCaptions}
                      label="显示图片标题编号"
                      disabled={!detailEditable || !detailPresentation.showImageCaptions}
                      onChange={(numberImageCaptions) => onUpdatePresentation({ numberImageCaptions })}
                    />
                  </div>
                </fieldset>
              </div>
            ) : null}
          </section>

          <div className="template-detail-actions">
            {detailIsDraft ? (
              <>
                <button type="button" className="template-create-confirm-button" onClick={onConfirmTemplateCreation}>
                  新建模板
                </button>
                <button type="button" onClick={onCancelTemplateCreation}>取消</button>
              </>
            ) : (
              <>
                {!manageOnly ? (
                  <button
                    type="button"
                    className="template-use-button"
                    onClick={() => {
                      onLetterTemplateChange(detailTemplate.id);
                      onClose?.();
                    }}
                  >
                    使用模板
                  </button>
                ) : null}
                {!selectionOnly ? (
                  <>
                    <button
                      type="button"
                      className="template-create-from-button"
                      onClick={() => onCreateTemplate(detailTemplate)}
                    >
                      <Copy size={15} />
                      <span>基于此新建</span>
                    </button>
                    {detailTemplate.userTemplate ? (
                      <button
                        type="button"
                        className="template-delete-button"
                        onClick={() => onDeleteTemplate(detailTemplate.id)}
                      >
                        <Trash2 size={14} />
                        <span>删除模板</span>
                      </button>
                    ) : null}
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
