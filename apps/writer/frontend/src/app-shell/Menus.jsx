import { useEffect } from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  FilePlus,
  FolderPlus,
  Info,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { ICON_ASSETS } from "./assets.js";

export function StatusToast({ status, onClose }) {
  if (!status) {
    return null;
  }
  return (
    <div
      className={`status-toast ${status.tone}`}
      role={status.tone === "warning" ? "alert" : "status"}
      aria-live={status.tone === "warning" ? "assertive" : "polite"}
    >
      {status.tone === "warning" ? <Info size={16} /> : <CheckCircle2 size={16} />}
      <span>{status.message}</span>
      {status.dismissible ? (
        <button type="button" className="status-toast-dismiss" aria-label="关闭提示" onClick={onClose}>
          <X size={14} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export function TitleBar() {
  return (
    <header className="desktop-titlebar">
      <strong>
        <img src={ICON_ASSETS.brandMark} alt="" aria-hidden="true" />
        <span>笺间</span>
      </strong>
    </header>
  );
}








export function MenuButton({ icon: Icon, label, menuId, openMenu, onOpenMenu, children, disabled = false, triggerClassName = "", showDisclosure = true, triggerRef }) {
  const isOpen = openMenu === menuId;
  const popoverId = `nav-menu-${menuId}`;

  return (
    <div className={isOpen ? "nav-menu open" : "nav-menu"}>
      <button
        ref={triggerRef}
        type="button"
        className={["nav-menu-trigger", triggerClassName].filter(Boolean).join(" ")}
        disabled={disabled}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-controls={popoverId}
        aria-expanded={isOpen}
        onClick={() => {
          if (!disabled) {
            onOpenMenu(isOpen ? "" : menuId);
          }
        }}
      >
        <Icon size={19} strokeWidth={1.9} />
        <span>{label}</span>
        {showDisclosure ? <ChevronDown size={14} /> : null}
      </button>
      {isOpen ? (
        <div className="nav-menu-popover" id={popoverId} role="menu">{children}</div>
      ) : null}
    </div>
  );
}

export function MenuItem({ icon: Icon, label, description = "", shortcut = "", disabled = false, active = false, selection = false, checked, onClick }) {
  const isCheckbox = typeof checked === "boolean";
  const isActive = active || checked === true;
  return (
    <button
      type="button"
      className={["nav-menu-item", isActive ? "active" : "", description ? "with-description" : ""].filter(Boolean).join(" ")}
      role={selection ? "menuitemradio" : isCheckbox ? "menuitemcheckbox" : "menuitem"}
      aria-checked={selection ? active : isCheckbox ? checked : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={16} strokeWidth={1.9} />
      {description ? (
        <span className="nav-menu-item-copy">
          <strong>{label}</strong>
          <small>{description}</small>
        </span>
      ) : <span>{label}</span>}
      {shortcut ? <kbd className="nav-menu-item-shortcut">{shortcut}</kbd> : null}
      {(selection && active) || checked === true ? <Check size={14} className="nav-menu-item-check" aria-hidden="true" /> : null}
    </button>
  );
}

export function MenuDivider() {
  return <i className="nav-menu-divider" aria-hidden="true" />;
}

export function TreeContextMenu({ menu, onClose, onCreateFolder, onCreateDocument, onRename, onBackup, onDelete }) {
  useEffect(() => {
    if (!menu) {
      return undefined;
    }
    const close = () => onClose();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.document.addEventListener("pointerdown", close);
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.document.removeEventListener("pointerdown", close);
      window.document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [menu, onClose]);

  if (!menu) {
    return null;
  }

  const run = (action) => {
    onClose();
    action?.(menu.entry, { returnFocusElement: menu.returnFocusElement });
  };

  return (
    <div
      className="tree-context-menu"
      style={{ left: menu.x, top: menu.y }}
      onPointerDown={(event) => event.stopPropagation()}
      role="menu"
    >
      {menu.entry.type === "folder" ? (
        <>
          <button type="button" onClick={() => run(onCreateFolder)} role="menuitem">
            <FolderPlus size={15} />
            <span>新建子文件夹</span>
          </button>
          <button type="button" onClick={() => run(onCreateDocument)} role="menuitem">
            <FilePlus size={15} />
            <span>新建信笺</span>
          </button>
          {!menu.entry.protected ? (
            <>
              <i />
              <button type="button" onClick={() => run(onRename)} role="menuitem">
                <Pencil size={15} />
                <span>重命名</span>
              </button>
              <button type="button" className="danger" onClick={() => run(onDelete)} role="menuitem">
                <Trash2 size={15} />
                <span>删除</span>
              </button>
            </>
          ) : null}
        </>
      ) : (
        <>
          <button type="button" onClick={() => run(onRename)} role="menuitem">
            <Pencil size={15} />
            <span>重命名</span>
          </button>
          <button type="button" onClick={() => run(onBackup)} role="menuitem">
            <Copy size={15} />
            <span>复制备份</span>
          </button>
          <i />
          <button type="button" className="danger" onClick={() => run(onDelete)} role="menuitem">
            <Trash2 size={15} />
            <span>删除</span>
          </button>
        </>
      )}
    </div>
  );
}
