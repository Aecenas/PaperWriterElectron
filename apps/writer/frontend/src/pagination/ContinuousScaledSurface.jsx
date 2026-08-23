import { useLayoutEffect, useRef, useState } from "react";

const MAX_CONTINUOUS_PAPER_WIDTH = 1010;

function availableContentWidth(element) {
  const container = element?.parentElement;
  if (!container) return MAX_CONTINUOUS_PAPER_WIDTH;
  const styles = globalThis.getComputedStyle?.(container);
  const horizontalPadding = (Number.parseFloat(styles?.paddingLeft) || 0)
    + (Number.parseFloat(styles?.paddingRight) || 0);
  return Math.max(1, (container.clientWidth || MAX_CONTINUOUS_PAPER_WIDTH) - horizontalPadding);
}

export function ContinuousScaledSurface({ children, scale = 1 }) {
  const frameRef = useRef(null);
  const [geometry, setGeometry] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const sheet = frame?.querySelector?.(":scope .paper-sheet");
    const container = frame?.parentElement;
    if (!frame || !sheet || !container) return undefined;
    const measure = () => {
      const width = Math.min(MAX_CONTINUOUS_PAPER_WIDTH, availableContentWidth(frame));
      const height = Math.max(1, sheet.offsetHeight || sheet.scrollHeight || 1);
      setGeometry((current) => (
        Math.abs(current.width - width) < 0.5 && Math.abs(current.height - height) < 0.5
          ? current
          : { width, height }
      ));
    };
    measure();
    const frameId = globalThis.requestAnimationFrame?.(measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(container);
    observer?.observe(sheet);
    globalThis.addEventListener?.("resize", measure);
    return () => {
      if (frameId) globalThis.cancelAnimationFrame?.(frameId);
      observer?.disconnect();
      globalThis.removeEventListener?.("resize", measure);
    };
  }, []);

  const resolvedScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const baseWidth = geometry.width || MAX_CONTINUOUS_PAPER_WIDTH;
  const frameStyle = geometry.width ? {
    width: `${baseWidth * resolvedScale}px`,
    height: geometry.height ? `${geometry.height * resolvedScale}px` : undefined,
  } : undefined;

  return (
    <div
      ref={frameRef}
      className="continuous-page-scale-frame"
      data-continuous-page-scale={resolvedScale}
      style={frameStyle}
    >
      <div
        className="continuous-page-scale-window"
        style={{
          width: geometry.width ? `${baseWidth}px` : "100%",
          transform: `scale(${resolvedScale})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
