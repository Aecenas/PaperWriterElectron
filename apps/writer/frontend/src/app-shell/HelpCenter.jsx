import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { HelpCircle, X } from "lucide-react";
import { useModalFocusTrap } from "../ui-interactions.js";
import {
  HELP_CATEGORIES,
  HELP_SCREENSHOTS,
  HELP_TOPICS,
} from "./help-data.js";

export function getTopicsForCategory(categoryId) {
  return HELP_TOPICS.filter((topic) => topic.categoryId === categoryId);
}

export function renderHelpText(text) {
  if (!text) {
    return null;
  }
  const parts = String(text).split(/(`[^`]+`|\*\*[^*]+\*\*|\[\[[^\]]+\]\]|__[^_]+__)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={`${part}-${index}`}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("[[") && part.endsWith("]]")) {
      return <em key={`${part}-${index}`}>{part.slice(2, -2)}</em>;
    }
    if (part.startsWith("__") && part.endsWith("__")) {
      return <u key={`${part}-${index}`}>{part.slice(2, -2)}</u>;
    }
    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

export function HelpCenterDialog({ open, onClose, initialTopicId = "", returnFocusRef }) {
  const [activeTopicId, setActiveTopicId] = useState(HELP_TOPICS[0]?.id || "");
  const [imagePreview, setImagePreview] = useState(null);
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const previewDialogRef = useRef(null);
  const previewCloseButtonRef = useRef(null);
  const activeTopic = HELP_TOPICS.find((topic) => topic.id === activeTopicId) || HELP_TOPICS[0];
  const activeIllustrations = helpIllustrationsFor(activeTopic);
  const activeCategoryId = activeTopic?.categoryId || HELP_CATEGORIES[0]?.id;
  useModalFocusTrap(open, dialogRef, closeButtonRef, returnFocusRef);
  useModalFocusTrap(Boolean(imagePreview), previewDialogRef, previewCloseButtonRef);

  useEffect(() => {
    if (!open) {
      setImagePreview(null);
      return undefined;
    }
    if (!activeTopic) {
      setActiveTopicId(HELP_TOPICS[0]?.id || "");
    }
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (imagePreview) {
          setImagePreview(null);
        } else {
          onClose();
        }
      }
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => window.document.removeEventListener("keydown", handleKeyDown, true);
  }, [activeTopic, imagePreview, onClose, open]);

  useEffect(() => {
    if (open && initialTopicId && HELP_TOPICS.some((topic) => topic.id === initialTopicId)) {
      setActiveTopicId(initialTopicId);
    }
  }, [initialTopicId, open]);

  const handleCategoryClick = useCallback((categoryId) => {
    const firstTopic = getTopicsForCategory(categoryId)[0];
    if (firstTopic) {
      setActiveTopicId(firstTopic.id);
    }
  }, []);

  if (!open || !activeTopic) {
    return null;
  }

  return (
    <>
      <div className="help-center-overlay dialog-scrim dialog-scrim--large" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="help-center-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-center-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <aside className="help-center-sidebar">
          <header>
            <span><HelpCircle size={18} /></span>
            <div>
              <p>使用说明</p>
              <h2 id="help-center-title">帮助中心</h2>
            </div>
          </header>
          <nav className="help-center-nav" aria-label="帮助主题">
            {HELP_CATEGORIES.map((category) => {
              const CategoryIcon = category.icon;
              const topics = getTopicsForCategory(category.id);
              const categoryActive = category.id === activeCategoryId;
              return (
                <section key={category.id} className={categoryActive ? "active" : ""}>
                  <button type="button" className="help-category-button" onClick={() => handleCategoryClick(category.id)}>
                    <CategoryIcon size={15} />
                    <span>{category.label}</span>
                  </button>
                  <div className="help-topic-list">
                    {topics.map((topic) => (
                      <button
                        key={topic.id}
                        type="button"
                        className={topic.id === activeTopic.id ? "active" : ""}
                        aria-current={topic.id === activeTopic.id ? "page" : undefined}
                        onClick={() => setActiveTopicId(topic.id)}
                      >
                        {topic.title}
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </nav>
        </aside>
        <main className="help-center-content">
          <button ref={closeButtonRef} type="button" className="help-center-close" onClick={onClose} aria-label="关闭帮助" title="关闭帮助">
            <X size={17} />
          </button>
          <article className="help-topic-detail">
            <header>
              <p>{HELP_CATEGORIES.find((category) => category.id === activeTopic.categoryId)?.label}</p>
              <h3>{activeTopic.title}</h3>
              <p className="help-summary">{renderHelpText(activeTopic.summary)}</p>
            </header>
            <div className="help-illustration-list">
              {activeIllustrations.map((illustration, index) => (
                <HelpIllustration
                  key={illustration.type}
                  type={illustration.type}
                  alt={illustration.alt}
                  caption={illustration.caption}
                  onPreview={(src) => setImagePreview({
                    src,
                    alt: illustration.alt,
                    caption: illustration.caption,
                    title: activeIllustrations.length > 1
                      ? `${activeTopic.title} · ${index + 1}/${activeIllustrations.length}`
                      : activeTopic.title,
                  })}
                />
              ))}
            </div>
            <section className="help-topic-section">
              <h4>怎么用</h4>
              <ol>
                {activeTopic.steps.map((step) => (
                  <li key={step}>{renderHelpText(step)}</li>
                ))}
              </ol>
            </section>
            <section className="help-topic-section">
              <h4>注意</h4>
              <ul>
                {activeTopic.tips.map((tip) => (
                  <li key={tip}>{renderHelpText(tip)}</li>
                ))}
              </ul>
            </section>
          </article>
        </main>
      </section>
      </div>
      {imagePreview ? createPortal(
        <div className="help-image-preview-overlay dialog-scrim dialog-scrim--large" role="presentation" onMouseDown={() => setImagePreview(null)}>
          <section
            ref={previewDialogRef}
            className="help-image-preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-image-preview-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <p>帮助配图</p>
                <h2 id="help-image-preview-title">{imagePreview.title}</h2>
              </div>
              <button ref={previewCloseButtonRef} type="button" onClick={() => setImagePreview(null)} aria-label="关闭图片预览" title="关闭图片预览">
                <X size={19} />
              </button>
            </header>
            <div className="help-image-preview-stage">
              <img
                src={imagePreview.src}
                alt={imagePreview.alt || "帮助主题界面截图"}
                role="button"
                tabIndex={0}
                aria-label="缩小图片并返回帮助中心"
                title="单击缩小"
                onClick={() => setImagePreview(null)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setImagePreview(null);
                  }
                }}
              />
            </div>
            {imagePreview.caption ? <p className="help-image-preview-caption">{imagePreview.caption}</p> : null}
          </section>
        </div>,
        window.document.body,
      ) : null}
    </>
  );
}


export function helpIllustrationsFor(topic) {
  if (!topic) return [];
  return [
    {
      type: topic.illustration,
      alt: topic.illustrationAlt,
      caption: topic.illustrationCaption,
    },
    ...(Array.isArray(topic.illustrations) ? topic.illustrations : []),
  ];
}

export function HelpIllustration({ type, alt, caption, onPreview }) {
  const src = HELP_SCREENSHOTS[type] || HELP_SCREENSHOTS["files-sidebar"];
  const openPreview = () => onPreview?.(src);
  return (
    <figure className={`help-illustration ${type || "workspace"}`}>
      <img
        src={src}
        alt={alt || "帮助主题界面截图"}
        loading="lazy"
        decoding="async"
        role="button"
        tabIndex={0}
        aria-label={`放大查看：${alt || "帮助主题界面截图"}`}
        title="单击放大"
        onClick={openPreview}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openPreview();
          }
        }}
      />
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}
