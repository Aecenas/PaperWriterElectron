import { createElement, useEffect, useRef } from "react";

const SHADOW_LAYOUT_CSS = `
  :host { display: block; width: 100%; min-width: 0; }
  svg {
    display: block;
    width: 100%;
    max-width: 100%;
    max-height: var(--mermaid-svg-max-height, none);
    height: auto;
    margin: 0 auto;
  }
`;

export function MermaidSvg({ svg, className = "", style }) {
  const hostRef = useRef(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // PageMap export clones editor ranges before printing/capturing them. A
    // clonable shadow root keeps the already-sanitized SVG in those static
    // clones without moving it back into the light DOM.
    const shadowRoot = host.shadowRoot || host.attachShadow?.({ mode: "open", clonable: true });
    if (!shadowRoot) {
      host.replaceChildren();
      host.textContent = "当前环境无法安全显示 Mermaid 图";
      return;
    }

    const parser = new globalThis.DOMParser();
    const parsed = parser.parseFromString(String(svg || ""), "image/svg+xml");
    const root = parsed.documentElement;
    if (root?.localName !== "svg" || parsed.querySelector("parsererror")) {
      shadowRoot.replaceChildren();
      return;
    }

    const layout = globalThis.document.createElement("style");
    layout.textContent = SHADOW_LAYOUT_CSS;
    shadowRoot.replaceChildren(
      layout,
      globalThis.document.importNode(root, true),
    );
  }, [svg]);

  return createElement("div", { ref: hostRef, className, style });
}
