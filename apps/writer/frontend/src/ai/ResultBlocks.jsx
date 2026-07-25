import { useMemo } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { normalizeEmbedWidth, normalizeImageSource } from "../resource-safety.js";
import {
  parseAiResponseBlocks,
  splitInlineMarkdown,
  splitQuoteForDisplay,
} from "./markdown.js";

export function InlineAiText({ text }) {
  return splitInlineMarkdown(text).map((part, index) => {
    if (part.strong) {
      return <strong key={`${index}-${part.text}`}>{part.text}</strong>;
    }
    if (part.emphasis) {
      return <em key={`${index}-${part.text}`}>{part.text}</em>;
    }
    return <span key={`${index}-${part.text}`}>{part.text}</span>;
  });
}

export function AiResultBlockActions({ block, onCopy, onApply, applying, previewing = false, manualFallback = false, resolverLabel = "直接应用定位模型" }) {
  const applyLabel = previewing ? "正文中确认" : (manualFallback ? "选择位置应用" : "应用");
  return (
    <span className="ai-block-actions" contentEditable={false}>
      <button type="button" onClick={() => onCopy(block)} title="复制这一块" aria-label="复制这一块"><Copy size={14} /></button>
      <button type="button" className="apply" disabled={applying || previewing} onClick={() => onApply(block)} title={previewing ? "请在左侧正文中确认或取消" : (manualFallback ? "在左侧选择原文位置后应用" : `由${resolverLabel}定位并显示正文对比`)} aria-label={applyLabel}>
        {applying ? <RefreshCw className="spin" size={14} /> : null}
        <span>{applying ? "定位中" : applyLabel}</span>
      </button>
    </span>
  );
}

export function AiResultBlock({ block, onCopy, onApply, applying, previewing, manualFallback, resolverLabel }) {
  if (block.type === "divider") {
    return <div className="ai-result-block ai-result-divider-block"><AiResultBlockActions block={block} onCopy={onCopy} onApply={onApply} applying={applying} previewing={previewing} manualFallback={manualFallback} resolverLabel={resolverLabel} /><hr className="ai-result-divider" /></div>;
  }
  if (block.type === "orderedList" || block.type === "bulletList") {
    const ListTag = block.type === "orderedList" ? "ol" : "ul";
    return (
      <div className="ai-result-block ai-result-list-block">
        <AiResultBlockActions block={block} onCopy={onCopy} onApply={onApply} applying={applying} previewing={previewing} manualFallback={manualFallback} resolverLabel={resolverLabel} />
        <ListTag className="ai-result-list">
          {block.items.map((item, index) => (
            <li key={`${block.type}-${index}-${item.text}`} value={block.type === "orderedList" ? item.number || index + 1 : undefined}>
              <InlineAiText text={item.text} />
            </li>
          ))}
        </ListTag>
      </div>
    );
  }
  if (block.type === "table") {
    return (
      <div className="ai-result-block ai-result-table-wrap">
        <AiResultBlockActions block={block} onCopy={onCopy} onApply={onApply} applying={applying} previewing={previewing} manualFallback={manualFallback} resolverLabel={resolverLabel} />
        <table className="ai-md-table">
          <thead>
            <tr>
              {block.headers.map((cell, cellIndex) => (
                <th key={`table-head-${cellIndex}-${cell}`}>
                  <InlineAiText text={cell} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`table-row-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`table-cell-${rowIndex}-${cellIndex}-${cell}`}>
                    <InlineAiText text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (block.type === "image") {
    const source = normalizeImageSource(block.asset?.src);
    const width = normalizeEmbedWidth(block.asset?.width);
    return (
      <figure className="ai-result-block ai-result-image" style={{ "--image-width": width }}>
        <AiResultBlockActions block={block} onCopy={onCopy} onApply={onApply} applying={applying} previewing={previewing} manualFallback={manualFallback} resolverLabel={resolverLabel} />
        {source ? (
          <img src={source} alt={block.asset?.alt || block.caption} />
        ) : (
          <div className="ai-missing-image">原图不在当前信笺快照中</div>
        )}
        <figcaption>图{block.number}. {block.caption}</figcaption>
      </figure>
    );
  }
  if (block.type === "quote") {
    const { bodyParts, source } = splitQuoteForDisplay(block.text);
    return (
      <blockquote className="ai-result-block">
        <AiResultBlockActions block={block} onCopy={onCopy} onApply={onApply} applying={applying} previewing={previewing} manualFallback={manualFallback} resolverLabel={resolverLabel} />
        {bodyParts.map((part, index) => (
          <p key={`quote-body-${index}-${part}`}>
            <InlineAiText text={part} />
          </p>
        ))}
        {source ? <p>—— <InlineAiText text={source} /></p> : null}
      </blockquote>
    );
  }
  if (block.type === "heading") {
    const HeadingTag = `h${Math.max(1, Math.min(3, block.level || 2))}`;
    return (
      <HeadingTag className="ai-result-block">
        <AiResultBlockActions block={block} onCopy={onCopy} onApply={onApply} applying={applying} previewing={previewing} manualFallback={manualFallback} resolverLabel={resolverLabel} />
        <InlineAiText text={block.text} />
      </HeadingTag>
    );
  }
  return (
    <p className="ai-result-block">
      <AiResultBlockActions block={block} onCopy={onCopy} onApply={onApply} applying={applying} previewing={previewing} manualFallback={manualFallback} resolverLabel={resolverLabel} />
      <InlineAiText text={block.text} />
    </p>
  );
}

export function AiChatAssistantContent({ text }) {
  const blocks = useMemo(() => parseAiResponseBlocks(text), [text]);
  if (!blocks.length) {
    return null;
  }
  return blocks.map((block, index) => {
    if (block.type === "divider") {
      return <hr className="ai-chat-md-divider" key={`divider-${index}`} />;
    }
    if (block.type === "orderedList" || block.type === "bulletList") {
      const ListTag = block.type === "orderedList" ? "ol" : "ul";
      return (
        <ListTag className="ai-chat-md-list" key={`${block.type}-${index}`}>
          {block.items.map((item, itemIndex) => (
            <li key={`${block.type}-${index}-${itemIndex}-${item.text}`} value={block.type === "orderedList" ? item.number || itemIndex + 1 : undefined}>
              <InlineAiText text={item.text} />
            </li>
          ))}
        </ListTag>
      );
    }
    if (block.type === "table") {
      return (
        <div className="ai-chat-md-table-wrap" key={`table-${index}`}>
          <table className="ai-md-table">
            <thead>
              <tr>
                {block.headers.map((cell, cellIndex) => (
                  <th key={`chat-table-head-${index}-${cellIndex}-${cell}`}>
                    <InlineAiText text={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={`chat-table-row-${index}-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`chat-table-cell-${index}-${rowIndex}-${cellIndex}-${cell}`}>
                      <InlineAiText text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    if (block.type === "heading") {
      const HeadingTag = `h${Math.max(1, Math.min(3, block.level || 2))}`;
      return (
        <HeadingTag className="ai-chat-md-heading" data-heading-numbered="false" key={`heading-${index}-${block.text}`}>
          <InlineAiText text={block.text} />
        </HeadingTag>
      );
    }
    if (block.type === "quote") {
      const { bodyParts, source } = splitQuoteForDisplay(block.text);
      return (
        <blockquote className="ai-chat-md-quote" key={`quote-${index}-${block.text}`}>
          {bodyParts.map((part, partIndex) => (
            <p key={`quote-chat-body-${partIndex}-${part}`}>
              <InlineAiText text={part} />
            </p>
          ))}
          {source ? <p>—— <InlineAiText text={source} /></p> : null}
        </blockquote>
      );
    }
    if (block.type === "image") {
      return (
        <p key={`image-${index}-${block.caption}`}>
          图{block.number}. {block.caption}
        </p>
      );
    }
    return (
      <p key={`paragraph-${index}-${block.text}`}>
        <InlineAiText text={block.text} />
      </p>
    );
  });
}
