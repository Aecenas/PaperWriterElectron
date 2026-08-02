import { useMemo } from "react";
import { bridge } from "../bridge.js";
import { splitQuoteForDisplay } from "../ai/markdown.js";
import {
  parseSelectionAiInlineMarkdown,
  parseSelectionAiMarkdown,
} from "./markdown.js";

function SelectionAiInlineMarkdown({ text, tokens = null }) {
  const parsedTokens = tokens || parseSelectionAiInlineMarkdown(text);
  return parsedTokens.map((token, index) => {
    const key = `${token.type}-${index}`;
    if (token.type === "strong") {
      return (
        <strong key={key}>
          <SelectionAiInlineMarkdown tokens={token.children} />
        </strong>
      );
    }
    if (token.type === "emphasis") {
      return (
        <em key={key}>
          <SelectionAiInlineMarkdown tokens={token.children} />
        </em>
      );
    }
    if (token.type === "delete") {
      return (
        <del key={key}>
          <SelectionAiInlineMarkdown tokens={token.children} />
        </del>
      );
    }
    if (token.type === "code") {
      return <code key={key}>{token.text}</code>;
    }
    if (token.type === "link") {
      return (
        <a
          href={token.href}
          key={key}
          rel="noopener noreferrer"
          target="_blank"
          onClick={(event) => {
            event.preventDefault();
            void bridge.openExternal?.(token.href);
          }}
        >
          <SelectionAiInlineMarkdown tokens={token.children} />
        </a>
      );
    }
    return <span key={key}>{token.text}</span>;
  });
}

function SelectionAiMarkdownBlock({ block, index }) {
  if (block.type === "divider") {
    return <hr className="selection-ai-markdown-divider" />;
  }
  if (block.type === "orderedList" || block.type === "bulletList") {
    const ListTag = block.type === "orderedList" ? "ol" : "ul";
    return (
      <ListTag className="selection-ai-markdown-list">
        {block.items.map((item, itemIndex) => (
          <li
            key={`${index}-item-${itemIndex}`}
            value={block.type === "orderedList"
              ? item.number || itemIndex + 1
              : undefined}
          >
            <SelectionAiInlineMarkdown text={item.text} />
          </li>
        ))}
      </ListTag>
    );
  }
  if (block.type === "table") {
    return (
      <div className="selection-ai-markdown-table-wrap">
        <table>
          <thead>
            <tr>
              {block.headers.map((cell, cellIndex) => (
                <th key={`${index}-head-${cellIndex}`}>
                  <SelectionAiInlineMarkdown text={cell} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`${index}-row-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`${index}-${rowIndex}-${cellIndex}`}>
                    <SelectionAiInlineMarkdown text={cell} />
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
    const HeadingTag = `h${Math.max(1, Math.min(4, block.level || 2))}`;
    return (
      <HeadingTag>
        <SelectionAiInlineMarkdown text={block.text} />
      </HeadingTag>
    );
  }
  if (block.type === "quote") {
    const { bodyParts, source } = splitQuoteForDisplay(block.text);
    return (
      <blockquote>
        {bodyParts.map((part, partIndex) => (
          <p key={`${index}-quote-${partIndex}`}>
            <SelectionAiInlineMarkdown text={part} />
          </p>
        ))}
        {source ? (
          <p>
            —— <SelectionAiInlineMarkdown text={source} />
          </p>
        ) : null}
      </blockquote>
    );
  }
  if (block.type === "code") {
    return (
      <div className="selection-ai-markdown-code-block">
        {block.language ? (
          <span aria-hidden="true">{block.language}</span>
        ) : null}
        <pre>
          <code>{block.text}</code>
        </pre>
      </div>
    );
  }
  if (block.type === "image") {
    return (
      <p>
        图{block.number}. <SelectionAiInlineMarkdown text={block.caption} />
      </p>
    );
  }
  return (
    <p>
      <SelectionAiInlineMarkdown text={block.text} />
    </p>
  );
}

export function SelectionAiMarkdown({ text }) {
  const blocks = useMemo(() => parseSelectionAiMarkdown(text), [text]);
  return (
    <div className="selection-ai-markdown">
      {blocks.map((block, index) => (
        <SelectionAiMarkdownBlock
          block={block}
          index={index}
          key={`${block.type}-${index}`}
        />
      ))}
    </div>
  );
}
