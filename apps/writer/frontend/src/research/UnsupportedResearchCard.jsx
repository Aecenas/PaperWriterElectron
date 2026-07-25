import { FileText, FolderOpen, Image, ShieldAlert } from "lucide-react";
import {
  formatResearchFileSize,
  formatResearchModifiedAt,
  sourceDisplayName,
} from "../research-ui-model.js";

export default function UnsupportedResearchCard({ item, onShowInFolder }) {
  const name = sourceDisplayName(item);
  const extension = name.includes(".") ? name.split(".").pop().toLocaleUpperCase("en-US") : "文件";
  const image = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(name);
  const Icon = image ? Image : FileText;
  const metadata = [extension, formatResearchFileSize(item.size), item.mtimeText || formatResearchModifiedAt(item.modifiedAt || item.mtimeMs)].filter(Boolean);
  return (
    <article className="secondary-research-card secondary-file-card">
      <div className="secondary-file-hero"><Icon size={34} aria-hidden="true" /><span>{extension}</span></div>
      <div className="secondary-research-card-copy">
        <strong>{name}</strong>
        <p className="secondary-file-path">{item.relativePath || item.path || ""}</p>
        {metadata.length ? <p className="secondary-file-meta">{metadata.join(" · ")}</p> : null}
        <p className="secondary-file-warning"><ShieldAlert size={15} />此文件类型不支持在笺间打开。</p>
      </div>
      <div className="secondary-research-card-actions">
        {onShowInFolder ? <button type="button" onClick={() => onShowInFolder(item)}><FolderOpen size={14} />在资源管理器中显示</button> : null}
      </div>
    </article>
  );
}
