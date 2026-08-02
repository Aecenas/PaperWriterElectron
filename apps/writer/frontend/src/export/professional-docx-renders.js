const PROFESSIONAL_SELECTOR = [
  "[data-type='paper-code']",
  "[data-type='inline-math']",
  "[data-type='block-math']",
  "[data-type='paper-equation-reference']",
  "[data-type='paper-mermaid']",
].join(",");

const RENDERABLE_SELECTOR = [
  "[data-type='inline-math']",
  "[data-type='block-math']",
  "[data-type='paper-mermaid']",
].join(",");

export const DOCX_PROFESSIONAL_RENDER_LIMITS = Object.freeze({
  maxNodes: 256,
  maxPngBytes: 2 * 1024 * 1024,
  maxTotalPngBytes: 16 * 1024 * 1024,
  maxRenderedHtmlBytes: 48 * 1024 * 1024,
  maxSvgBytes: 2 * 1024 * 1024,
  maxCssWidth: 1200,
  maxCssHeight: 900,
  maxCanvasPixels: 4_000_000,
  waitMilliseconds: 8_000,
  imageLoadMilliseconds: 5_000,
});

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const FORBIDDEN_CLONE_TAGS = new Set([
  "button", "embed", "iframe", "input", "object", "script", "select", "style",
  "textarea", "video",
]);
const INLINE_STYLE_PROPERTIES = Object.freeze([
  "align-items", "background-color", "border-bottom-color", "border-bottom-style",
  "border-bottom-width", "border-left-color", "border-left-style", "border-left-width",
  "border-radius", "border-right-color", "border-right-style", "border-right-width",
  "border-top-color", "border-top-style", "border-top-width", "bottom", "box-sizing",
  "clip-path", "color", "display", "dominant-baseline", "fill", "fill-opacity",
  "flex-direction", "float", "font-family", "font-size", "font-stretch", "font-style",
  "font-variant", "font-weight", "gap", "height", "justify-content", "left",
  "letter-spacing", "line-height", "margin-bottom", "margin-left", "margin-right",
  "margin-top", "marker-end", "marker-mid", "marker-start", "max-height", "max-width",
  "min-height", "min-width", "opacity", "overflow", "overflow-x", "overflow-y",
  "padding-bottom", "padding-left", "padding-right", "padding-top", "paint-order",
  "position", "right", "shape-rendering", "stroke", "stroke-dasharray",
  "stroke-dashoffset", "stroke-linecap", "stroke-linejoin", "stroke-opacity",
  "stroke-width", "text-align", "text-anchor", "text-decoration", "text-rendering",
  "text-transform", "top", "transform", "transform-origin", "vertical-align",
  "visibility", "white-space", "width", "word-break", "z-index",
]);

function utf8Bytes(value, windowObject = globalThis) {
  if (typeof windowObject.TextEncoder === "function") {
    return new windowObject.TextEncoder().encode(String(value || "")).byteLength;
  }
  return unescape(encodeURIComponent(String(value || ""))).length;
}

function normalizedKind(element) {
  const value = element?.getAttribute?.("data-type") || "";
  if (value === "inline-math") return "inlineMath";
  if (value === "block-math") return "blockMath";
  if (value === "paper-mermaid") return "mermaid";
  if (value === "paper-code") return "code";
  if (value === "paper-equation-reference") return "equationReference";
  return "";
}

function descriptorIdentity(element, kind) {
  if (kind === "mermaid") return element.getAttribute("data-diagram-id") || "";
  // The Mathematics NodeView exposes TeX on the live render root but does not
  // propagate our extended equationId attribute. Exact TeX plus document order
  // remains fail-closed while still distinguishing changed previews.
  if (kind === "blockMath") return element.getAttribute("data-latex") || "";
  if (kind === "inlineMath") return element.getAttribute("data-latex") || "";
  return "";
}

function boundedAlt(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 920);
}

function altForDescriptor(element, kind) {
  if (kind === "inlineMath" || kind === "blockMath") {
    return boundedAlt(`TeX：${element.getAttribute("data-latex") || ""}`) || "TeX 公式";
  }
  const caption = element.getAttribute("data-caption")
    || element.querySelector?.("figcaption")?.textContent
    || "";
  const source = element.getAttribute("data-mermaid-source") || "";
  return boundedAlt(`Mermaid：${caption || source.split(/\r?\n/, 1)[0] || "流程图"}`);
}

function waitForMermaidNodes(canvas, windowObject, maximumMilliseconds) {
  const pendingSelector = "[data-type='paper-mermaid'][data-mermaid-render-state='loading']";
  if (!canvas?.querySelector?.(pendingSelector)) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      windowObject.clearTimeout(timeoutId);
      resolve();
    };
    const observer = typeof windowObject.MutationObserver === "function"
      ? new windowObject.MutationObserver(() => {
        if (!canvas.querySelector(pendingSelector)) finish();
      })
      : null;
    observer?.observe(canvas, {
      attributes: true,
      subtree: true,
      attributeFilter: ["data-mermaid-render-state"],
    });
    const timeoutId = windowObject.setTimeout(finish, maximumMilliseconds);
  });
}

function isSafeCssValue(value) {
  const source = String(value || "");
  if (!/url\s*\(/i.test(source)) return true;
  const urls = [...source.matchAll(/url\s*\(\s*(['"]?)([^'")]+)\1\s*\)/gi)];
  return urls.length > 0 && urls.every((match) => /^#[a-z0-9_.:-]{1,256}$/i.test(match[2]));
}

function isSafeClonedAttribute(name, value) {
  const normalized = String(name || "").toLowerCase();
  if (
    normalized === "style"
    || normalized === "contenteditable"
    || normalized === "draggable"
    || normalized === "spellcheck"
    || normalized === "src"
    || normalized.startsWith("on")
  ) return false;
  if (normalized === "id") return /^[a-z][a-z0-9_.:-]{0,255}$/i.test(String(value || ""));
  if (normalized === "href" || normalized === "xlink:href") {
    return /^#[a-z0-9_.:-]{1,256}$/i.test(String(value || ""));
  }
  return isSafeCssValue(value);
}

function safeComputedStyle(element, windowObject) {
  let computed;
  try {
    computed = windowObject.getComputedStyle(element);
  } catch {
    return "";
  }
  const declarations = [];
  for (const property of INLINE_STYLE_PROPERTIES) {
    const value = computed.getPropertyValue(property);
    if (!value || !isSafeCssValue(value)) continue;
    declarations.push(`${property}:${value}`);
  }
  return declarations.join(";");
}

function cloneWithInlineStyles(node, documentObject, windowObject) {
  if (node.nodeType === 3) return documentObject.createTextNode(node.nodeValue || "");
  if (node.nodeType !== 1) return null;
  const sourceTag = String(node.localName || node.tagName || "");
  const tag = sourceTag.toLowerCase();
  if (!tag || FORBIDDEN_CLONE_TAGS.has(tag)) return null;
  const namespace = node.namespaceURI || XHTML_NAMESPACE;
  const clone = documentObject.createElementNS(
    namespace,
    namespace === XHTML_NAMESPACE ? tag : sourceTag,
  );
  for (const attribute of [...(node.attributes || [])]) {
    if (!isSafeClonedAttribute(attribute.name, attribute.value)) continue;
    try {
      clone.setAttribute(attribute.name, attribute.value);
    } catch {
      // Ignore namespace-specific attributes that cannot be recreated safely.
    }
  }
  const style = safeComputedStyle(node, windowObject);
  if (style) clone.setAttribute("style", style);
  for (const child of [...node.childNodes]) {
    const next = cloneWithInlineStyles(child, documentObject, windowObject);
    if (next) clone.appendChild(next);
  }
  return clone;
}

function boundedGeometry(element, limits) {
  const rect = element.getBoundingClientRect?.() || {};
  const naturalWidth = Math.max(
    1,
    Number(rect.width) || 0,
    Number(element.scrollWidth) || 0,
  );
  const naturalHeight = Math.max(
    1,
    Number(rect.height) || 0,
    Number(element.scrollHeight) || 0,
  );
  const fit = Math.min(
    1,
    limits.maxCssWidth / naturalWidth,
    limits.maxCssHeight / naturalHeight,
  );
  return {
    naturalWidth: Math.ceil(naturalWidth),
    naturalHeight: Math.ceil(naturalHeight),
    width: Math.max(1, Math.ceil(naturalWidth * fit)),
    height: Math.max(1, Math.ceil(naturalHeight * fit)),
  };
}

function pngBlobFromCanvas(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob || blob.type !== "image/png") {
        reject(new Error("浏览器未生成有效 PNG"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

async function blobToDataUrl(blob, windowObject) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:image/png;base64,${windowObject.btoa(binary)}`;
}

async function rasterizeSvg(svg, geometry, {
  documentObject,
  limits,
  windowObject,
}) {
  if (utf8Bytes(svg, windowObject) > limits.maxSvgBytes) {
    throw new Error("待栅格化 SVG 超过安全上限");
  }
  const blob = new windowObject.Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = windowObject.URL.createObjectURL(blob);
  let timeoutId;
  try {
    const image = await new Promise((resolve, reject) => {
      const candidate = new windowObject.Image();
      const finish = (callback, value) => {
        windowObject.clearTimeout(timeoutId);
        candidate.onload = null;
        candidate.onerror = null;
        callback(value);
      };
      candidate.onload = () => finish(resolve, candidate);
      candidate.onerror = () => finish(reject, new Error("Chromium 拒绝载入临时 SVG"));
      timeoutId = windowObject.setTimeout(
        () => finish(reject, new Error("临时 SVG 栅格化超时")),
        limits.imageLoadMilliseconds,
      );
      candidate.src = url;
    });
    const scale = Math.max(
      1,
      Math.min(2, Math.sqrt(limits.maxCanvasPixels / (geometry.width * geometry.height))),
    );
    const canvas = documentObject.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(geometry.width * scale));
    canvas.height = Math.max(1, Math.ceil(geometry.height * scale));
    if (canvas.width * canvas.height > limits.maxCanvasPixels + 1) {
      throw new Error("专业内容图片像素超过安全上限");
    }
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("浏览器无法创建图片画布");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    assertCanvasHasVisiblePixels(canvas);
    const png = await pngBlobFromCanvas(canvas);
    if (png.size > limits.maxPngBytes) throw new Error("专业内容 PNG 超过安全上限");
    return {
      dataUrl: await blobToDataUrl(png, windowObject),
      bytes: png.size,
      width: geometry.width,
      height: geometry.height,
    };
  } finally {
    windowObject.clearTimeout(timeoutId);
    windowObject.URL.revokeObjectURL(url);
  }
}

function assertCanvasHasVisiblePixels(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("浏览器无法读取公式图片画布");
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] > 0) return;
  }
  throw new Error("公式栅格化结果为空或完全透明");
}

async function rasterizeFormulaElement(element, {
  documentObject,
  limits,
  windowObject,
}) {
  const geometry = boundedGeometry(element, limits);
  const density = Math.max(
    1,
    Math.min(2, Math.sqrt(limits.maxCanvasPixels / (geometry.width * geometry.height))),
  );
  const fit = geometry.width / geometry.naturalWidth;
  const renderScale = fit * density;
  let timeoutId;
  const renderTask = (async () => {
    await documentObject.fonts?.ready;
    const module = await import("html2canvas");
    const html2canvas = module.default || module;
    return html2canvas(element, {
      allowTaint: false,
      backgroundColor: null,
      foreignObjectRendering: false,
      height: geometry.naturalHeight,
      logging: false,
      removeContainer: true,
      scale: renderScale,
      useCORS: false,
      width: geometry.naturalWidth,
    });
  })();
  const timeout = new Promise((_, reject) => {
    timeoutId = windowObject.setTimeout(
      () => reject(new Error("公式栅格化超时")),
      limits.imageLoadMilliseconds,
    );
  });
  try {
    const canvas = await Promise.race([renderTask, timeout]);
    if (
      !(canvas?.width > 0 && canvas?.height > 0)
      || canvas.width * canvas.height > limits.maxCanvasPixels
    ) throw new Error("公式图片尺寸超过安全上限");
    assertCanvasHasVisiblePixels(canvas);
    const png = await pngBlobFromCanvas(canvas);
    if (png.size > limits.maxPngBytes) throw new Error("公式 PNG 超过安全上限");
    return {
      dataUrl: await blobToDataUrl(png, windowObject),
      bytes: png.size,
      width: geometry.width,
      height: geometry.height,
    };
  } finally {
    windowObject.clearTimeout(timeoutId);
  }
}

function sanitizeMermaidSvg(svgElement, documentObject, windowObject) {
  const clone = cloneWithInlineStyles(svgElement, documentObject, windowObject);
  if (!clone) throw new Error("Mermaid SVG 无法安全克隆");
  clone.querySelectorAll("a,foreignObject,iframe,object,script,style").forEach((node) => node.remove());
  for (const element of [clone, ...clone.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.toLowerCase() === "style" && isSafeCssValue(attribute.value)) {
        continue;
      }
      if (!isSafeClonedAttribute(attribute.name, attribute.value)) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (!clone.getAttribute("viewBox")) {
    const rect = svgElement.getBoundingClientRect?.() || {};
    clone.setAttribute("viewBox", `0 0 ${Math.max(1, Number(rect.width) || 1)} ${Math.max(1, Number(rect.height) || 1)}`);
  }
  return clone;
}

export async function renderProfessionalElementToPng(element, {
  documentObject = element?.ownerDocument || globalThis.document,
  limits = DOCX_PROFESSIONAL_RENDER_LIMITS,
  windowObject = documentObject?.defaultView || globalThis,
} = {}) {
  if (!element || !documentObject || !windowObject) throw new Error("缺少专业内容渲染环境");
  const resolvedLimits = { ...DOCX_PROFESSIONAL_RENDER_LIMITS, ...(limits || {}) };
  const kind = normalizedKind(element);
  if (kind === "mermaid") {
    if (element.getAttribute("data-mermaid-render-state") !== "ready") {
      throw new Error("Mermaid 预览尚未就绪");
    }
    const svgElement = element.querySelector(".paper-mermaid-svg svg");
    if (!svgElement) throw new Error("Mermaid 安全 SVG 不存在");
    const geometry = boundedGeometry(svgElement, resolvedLimits);
    const clone = sanitizeMermaidSvg(svgElement, documentObject, windowObject);
    clone.setAttribute("width", String(geometry.width));
    clone.setAttribute("height", String(geometry.height));
    const svg = new windowObject.XMLSerializer().serializeToString(clone);
    return rasterizeSvg(svg, geometry, {
      documentObject,
      limits: resolvedLimits,
      windowObject,
    });
  }
  if (kind !== "inlineMath" && kind !== "blockMath") throw new Error("节点不支持 DOCX 图片渲染");
  return rasterizeFormulaElement(element, {
    documentObject,
    limits: resolvedLimits,
    windowObject,
  });
}

function findLiveElement(descriptor, candidates, used) {
  const expectedIdentity = descriptorIdentity(descriptor.element, descriptor.kind);
  let fallback = null;
  for (const candidate of candidates) {
    if (used.has(candidate) || normalizedKind(candidate) !== descriptor.kind) continue;
    fallback ||= candidate;
    if (descriptorIdentity(candidate, descriptor.kind) === expectedIdentity) return candidate;
  }
  return expectedIdentity ? null : fallback;
}

export async function createProfessionalDocxRenderedHtml({
  canvas,
  html,
  documentObject = canvas?.ownerDocument || globalThis.document,
  limits = DOCX_PROFESSIONAL_RENDER_LIMITS,
  windowObject = documentObject?.defaultView || globalThis,
} = {}) {
  const sourceHtml = String(html || "");
  const resolvedLimits = { ...DOCX_PROFESSIONAL_RENDER_LIMITS, ...(limits || {}) };
  if (!sourceHtml || !canvas || !documentObject || typeof windowObject.DOMParser !== "function") {
    return { renderedHtml: "", renderedCount: 0, failedCount: 0, errors: [] };
  }
  if (utf8Bytes(sourceHtml, windowObject) > resolvedLimits.maxRenderedHtmlBytes) {
    throw new Error("正文超过 DOCX 临时渲染上限");
  }
  await waitForMermaidNodes(canvas, windowObject, resolvedLimits.waitMilliseconds);
  const parsed = new windowObject.DOMParser().parseFromString(`<body>${sourceHtml}</body>`, "text/html");
  const allProfessional = [...parsed.body.querySelectorAll(PROFESSIONAL_SELECTOR)];
  const renderableDescriptors = allProfessional
    .map((element, professionalIndex) => ({
      element,
      professionalIndex,
      kind: normalizedKind(element),
    }))
    .filter(({ kind }) => kind === "inlineMath" || kind === "blockMath" || kind === "mermaid");
  if (renderableDescriptors.length > resolvedLimits.maxNodes) {
    throw new Error("DOCX 专业内容节点数量超过安全上限");
  }
  const descriptors = renderableDescriptors;
  const liveCandidates = [...canvas.querySelectorAll(RENDERABLE_SELECTOR)];
  const used = new Set();
  const errors = [];
  let renderedCount = 0;
  let failedCount = 0;
  let totalPngBytes = 0;

  for (const descriptor of descriptors) {
    const liveElement = findLiveElement(descriptor, liveCandidates, used);
    if (!liveElement) {
      throw new Error(`DOCX 导出未找到 ${descriptor.kind} 的实时预览`);
    }
    used.add(liveElement);
    try {
      const image = await renderProfessionalElementToPng(liveElement, {
        documentObject,
        limits: resolvedLimits,
        windowObject,
      });
      if (totalPngBytes + image.bytes > resolvedLimits.maxTotalPngBytes) {
        throw new Error("专业内容 PNG 总量超过安全上限");
      }
      totalPngBytes += image.bytes;
      const replacement = parsed.createElement("img");
      replacement.setAttribute("src", image.dataUrl);
      replacement.setAttribute("alt", altForDescriptor(descriptor.element, descriptor.kind));
      replacement.setAttribute(
        "title",
        `JianjianProfessionalRender:${descriptor.professionalIndex}:${descriptor.kind}`,
      );
      replacement.setAttribute("width", String(image.width));
      replacement.setAttribute("height", String(image.height));
      descriptor.element.replaceWith(replacement);
      renderedCount += 1;
    } catch (error) {
      const detail = String(error?.message || error || "专业内容渲染失败").slice(0, 300);
      throw new Error(`DOCX ${descriptor.kind} 栅格化失败：${detail}`, { cause: error });
    }
  }

  const renderedHtml = parsed.body.innerHTML;
  if (utf8Bytes(renderedHtml, windowObject) > resolvedLimits.maxRenderedHtmlBytes) {
    throw new Error("DOCX 临时渲染结果超过安全上限");
  }
  return { renderedHtml, renderedCount, failedCount, errors };
}
