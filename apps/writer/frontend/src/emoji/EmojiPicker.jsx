import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Smile, X } from "lucide-react";
import {
  EMOJI_CATEGORIES,
  emojiUnicodeForDisplay,
  filterEmojiCatalog,
} from "./catalog.js";
import { loadEmojiCatalog } from "./data.js";
import { restoreEmojiPickerFocus } from "./focus-restoration.js";
import { loadEmojiRecents, saveEmojiRecent } from "./recent-storage.js";
import "./emoji-picker.css";

const GRID_COLUMNS = 8;

function focusableElements(container) {
  return [...(container?.querySelectorAll?.(
    'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
  ) || [])].filter((element) => !element.hidden);
}

export default function EmojiPicker({
  open = false,
  onSelect,
  onRequestClose,
  returnFocusRef,
  editorFocusRef,
  title = "插入表情",
}) {
  const dialogRef = useRef(null);
  const searchRef = useRef(null);
  const emojiButtonsRef = useRef([]);
  const focusBeforeOpenRef = useRef(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(EMOJI_CATEGORIES[1].key);
  const [recents, setRecents] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState("");
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(false);

  const emojis = useMemo(() => filterEmojiCatalog({
    catalog,
    category,
    query,
    recents,
  }), [catalog, category, query, recents]);

  useEffect(() => {
    if (!open) return undefined;
    focusBeforeOpenRef.current = document.activeElement;
    setQuery("");
    setError("");
    setActiveIndex(0);
    setLoading(true);
    const recentItems = loadEmojiRecents();
    setRecents(recentItems);
    if (category === "recent" && !recentItems.length) setCategory(EMOJI_CATEGORIES[1].key);
    let active = true;
    loadEmojiCatalog()
      .then((loadedCatalog) => {
        if (active) setCatalog(loadedCatalog);
      })
      .catch(() => {
        if (active) setError("无法读取本地表情数据，请重新打开选择器。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
    emojiButtonsRef.current = [];
  }, [category, query]);

  const restoreFocus = () => {
    restoreEmojiPickerFocus({
      returnFocus: returnFocusRef?.current,
      previousFocus: focusBeforeOpenRef.current,
      editorFocus: editorFocusRef?.current,
      body: window.document.body,
      requestFrame: window.requestAnimationFrame.bind(window),
    });
  };

  const close = () => {
    onRequestClose?.();
    restoreFocus();
  };

  const chooseEmoji = async (emoji) => {
    const variant = emoji.recentVariant || {
      unicode: emoji.unicode,
      label: emoji.label,
      tone: 0,
    };
    if (!variant?.unicode) return;
    setError("");
    try {
      const result = await onSelect?.(variant.unicode, { emoji, variant, skinTone: 0 });
      if (result === false || result?.valid === false || result?.ok === false) {
        setError(result?.message || "文档或选区已经变化，请关闭后重新打开表情选择器。");
        return;
      }
      setRecents((current) => saveEmojiRecent(variant.unicode, current));
      close();
    } catch (selectionError) {
      setError(selectionError?.message || "暂时无法插入这个表情。");
    }
  };

  const moveGridFocus = (event, nextIndex) => {
    if (!emojis.length) return;
    event.preventDefault();
    const normalized = Math.min(emojis.length - 1, Math.max(0, nextIndex));
    setActiveIndex(normalized);
    emojiButtonsRef.current[normalized]?.focus();
  };

  if (!open) return null;

  return (
    <div className="professional-dialog-layer emoji-picker-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) close();
    }}>
      <section
        ref={dialogRef}
        className="professional-dialog emoji-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="emoji-picker-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
          if (event.key === "Tab") {
            const elements = focusableElements(dialogRef.current);
            if (!elements.length) return;
            const first = elements[0];
            const last = elements[elements.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <header className="professional-dialog-header emoji-picker-header">
          <span className="professional-dialog-mark emoji-picker-mark" aria-hidden="true">
            <Smile size={20} />
          </span>
          <div>
            <h2 id="emoji-picker-title">{title}</h2>
            <small>插入标准 Unicode，不上传任何内容</small>
          </div>
          <button type="button" className="professional-icon-button emoji-picker-close" onClick={close} aria-label="关闭表情选择器">
            <X size={17} />
          </button>
        </header>

        <label className="emoji-picker-search">
          <Search size={15} aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索表情（中英文）"
            aria-label="搜索表情"
          />
        </label>

        <nav className="emoji-picker-categories" aria-label="表情分类">
          {EMOJI_CATEGORIES.map((item) => (
            <button
              key={item.key}
              type="button"
              className={category === item.key ? "is-active" : ""}
              aria-label={item.label}
              aria-pressed={category === item.key}
              title={item.label}
              onClick={() => setCategory(item.key)}
            >
              <span aria-hidden="true">{item.icon}</span>
            </button>
          ))}
        </nav>

        <div className="emoji-picker-options" aria-live="polite">
          <strong>{EMOJI_CATEGORIES.find((item) => item.key === category)?.label || "表情"}</strong>
          <span>{loading ? "正在读取…" : `${emojis.length.toLocaleString("zh-CN")} 个`}</span>
        </div>

        <div
          className="emoji-picker-grid"
          role="grid"
          aria-label="可插入的表情"
          aria-rowcount={Math.ceil(emojis.length / GRID_COLUMNS)}
          aria-colcount={GRID_COLUMNS}
        >
          {emojis.map((emoji, index) => {
            const unicode = emojiUnicodeForDisplay(emoji, 0);
            const variantLabel = emoji.recentVariant?.label || emoji.label;
            return (
              <button
                key={`${emoji.hexcode}-${emoji.recentVariant?.unicode || "default"}`}
                ref={(element) => { emojiButtonsRef.current[index] = element; }}
                type="button"
                role="gridcell"
                tabIndex={activeIndex === index ? 0 : -1}
                title={variantLabel}
                aria-label={variantLabel}
                onFocus={() => setActiveIndex(index)}
                onClick={() => chooseEmoji(emoji)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight") moveGridFocus(event, index + 1);
                  if (event.key === "ArrowLeft") moveGridFocus(event, index - 1);
                  if (event.key === "ArrowDown") moveGridFocus(event, index + GRID_COLUMNS);
                  if (event.key === "ArrowUp") moveGridFocus(event, index - GRID_COLUMNS);
                  if (event.key === "Home") moveGridFocus(event, 0);
                  if (event.key === "End") moveGridFocus(event, emojis.length - 1);
                }}
              >
                <span aria-hidden="true">{unicode}</span>
              </button>
            );
          })}
          {loading ? <p className="emoji-picker-empty" role="status">正在读取本地表情…</p> : null}
          {!loading && !emojis.length ? (
            <p className="emoji-picker-empty" role="status">
              {category === "recent" ? "还没有最近使用的表情。" : "没有找到匹配的表情。"}
            </p>
          ) : null}
        </div>

        {error ? <p className="emoji-picker-error" role="alert">{error}</p> : null}
      </section>
    </div>
  );
}
