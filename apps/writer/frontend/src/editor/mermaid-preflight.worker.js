import DOMPurify from "dompurify";
import { assertMermaidSourceWithinLimits } from "./mermaid-safety.js";

// Mermaid's parser calls its sanitizer even when no SVG is rendered. In a
// native Worker DOMPurify exposes only its factory, so provide the minimum
// parse-only surface inside this isolated realm. No sanitized text, AST, HTML,
// configuration or SVG is ever returned to the renderer.
if (
  typeof DOMPurify === "function"
  && typeof DOMPurify.addHook !== "function"
  && typeof DOMPurify.sanitize !== "function"
) {
  Object.defineProperties(DOMPurify, {
    addHook: { value() {} },
    removeAllHooks: { value() {} },
    sanitize: {
      value(value) {
        return String(value ?? "")
          .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
          .replace(/<[^>]*>/g, "");
      },
    },
  });
}

let mermaidPromise;

async function loadMermaidParser() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((module) => {
      const mermaid = module.default || module;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        htmlLabels: false,
        maxTextSize: 20_000,
        suppressErrorRendering: true,
        flowchart: { htmlLabels: false, useMaxWidth: true },
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

function parseErrorMessage(error) {
  const line = String(error?.message || "").match(/\bline\s+(\d+)\b/i)?.[1];
  return line
    ? `Mermaid 语法有误（第 ${line} 行附近）`
    : "Mermaid 语法有误";
}

self.addEventListener("message", async (event) => {
  const { type, requestId, generation, source } = event.data || {};
  if (type !== "parse" || typeof requestId !== "string") return;
  try {
    const safeSource = assertMermaidSourceWithinLimits(source);
    const mermaid = await loadMermaidParser();
    const result = await mermaid.parse(safeSource);
    self.postMessage({
      type: "result",
      requestId,
      generation,
      ok: true,
      diagramType: String(result?.diagramType || ""),
    });
  } catch (error) {
    self.postMessage({
      type: "result",
      requestId,
      generation,
      ok: false,
      code: String(error?.code || "MERMAID_PARSE_ERROR"),
      message: error?.code ? String(error.message) : parseErrorMessage(error),
    });
  }
});
