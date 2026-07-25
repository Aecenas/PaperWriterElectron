import { ExternalLink, FolderOpen } from "lucide-react";
import { sourceDisplayName } from "../research-ui-model.js";

export default function PreviewToolbar({
  item,
  onOpenExternal,
  onShowInFolder,
  children,
  className = "",
  ariaLabel = "资料预览控制",
}) {
  return (
    <div className={["secondary-static-toolbar", className].filter(Boolean).join(" ")} role="toolbar" aria-label={ariaLabel}>
      <strong title={sourceDisplayName(item)}>{sourceDisplayName(item)}</strong>
      <span className="secondary-static-toolbar-spacer" />
      {children}
      {onOpenExternal ? <button type="button" onClick={() => onOpenExternal(item)} aria-label="使用系统应用打开" title="使用系统应用打开"><ExternalLink size={14} /></button> : null}
      {onShowInFolder ? <button type="button" onClick={() => onShowInFolder(item)} aria-label="在资源管理器中显示" title="在资源管理器中显示"><FolderOpen size={14} /></button> : null}
    </div>
  );
}
