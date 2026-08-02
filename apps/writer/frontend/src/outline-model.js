function outlineLevel(item) {
  return Math.max(1, Number(item?.level) || 1);
}

export function buildVisibleOutlineRows(items = [], collapsedIds = new Set()) {
  const collapsed = collapsedIds instanceof Set ? collapsedIds : new Set(collapsedIds || []);
  const rows = [];
  let hiddenBelowLevel = null;

  items.forEach((item, index) => {
    const level = outlineLevel(item);
    if (item?.type !== "heading") {
      hiddenBelowLevel = null;
    } else if (hiddenBelowLevel !== null) {
      if (level > hiddenBelowLevel) return;
      hiddenBelowLevel = null;
    }

    const next = items[index + 1];
    const hasChildren = item?.type === "heading"
      && next?.type === "heading"
      && outlineLevel(next) > level;
    const isCollapsed = hasChildren && collapsed.has(item.id);
    rows.push({ ...item, level, hasChildren, isCollapsed });
    if (isCollapsed) hiddenBelowLevel = level;
  });

  return rows;
}
