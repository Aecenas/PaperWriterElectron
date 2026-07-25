import { normalizeDocumentComments } from "../editor-comments.js";

export const COMMENT_COLOR_PALETTE = [
  { border: "rgba(154, 86, 53, 0.72)", bg: "rgba(246, 226, 169, 0.24)", ink: "#9a5635", anchorBg: "rgba(255, 248, 236, 0.96)" },
  { border: "rgba(80, 126, 116, 0.72)", bg: "rgba(200, 227, 211, 0.24)", ink: "#4e8580", anchorBg: "rgba(239, 250, 245, 0.96)" },
  { border: "rgba(79, 111, 143, 0.72)", bg: "rgba(201, 223, 240, 0.26)", ink: "#4f6f8f", anchorBg: "rgba(239, 248, 255, 0.96)" },
  { border: "rgba(122, 92, 143, 0.72)", bg: "rgba(217, 206, 233, 0.25)", ink: "#7a5c8f", anchorBg: "rgba(249, 244, 255, 0.96)" },
  { border: "rgba(157, 111, 47, 0.72)", bg: "rgba(246, 226, 169, 0.28)", ink: "#9d6f2f", anchorBg: "rgba(255, 249, 235, 0.96)" },
];
export const COMMENT_TRACKS = [
  { side: "right", offset: 0 },
  { side: "right", offset: 34 },
  { side: "right", offset: 68 },
  { side: "left", offset: 0 },
  { side: "left", offset: 34 },
];
export const COMMENT_ANCHOR_COLLISION_DISTANCE = 34;

export function getCommentAnchorTop(editor, from) {
  if (!editor?.view) {
    return null;
  }
  try {
    const maxPosition = editor.state.doc.content.size;
    const resolvedFrom = Math.max(1, Math.min(Number(from) || 1, maxPosition));
    const coords = editor.view.coordsAtPos(resolvedFrom);
    return coords.top + Math.max(0, coords.bottom - coords.top) / 2;
  } catch {
    return null;
  }
}

export function buildCommentAnchorTopMap(editor, comments = []) {
  const topById = new Map();
  normalizeDocumentComments(comments).forEach((comment) => {
    const top = getCommentAnchorTop(editor, comment.from);
    if (Number.isFinite(top)) {
      topById.set(comment.id, top);
    }
  });
  return topById;
}

export function assignDocumentCommentPresentations(comments = [], anchorTopById = new Map()) {
  const sortedComments = normalizeDocumentComments(comments)
    .slice()
    .sort((a, b) => {
      const topA = anchorTopById.get(a.id);
      const topB = anchorTopById.get(b.id);
      const orderA = Number.isFinite(topA) ? topA : Number.POSITIVE_INFINITY;
      const orderB = Number.isFinite(topB) ? topB : Number.POSITIVE_INFINITY;
      if (orderA !== orderB) return orderA - orderB;
      return (a.from - b.from) || (a.to - b.to) || a.createdAt.localeCompare(b.createdAt);
    });
  const presentations = new Map();
  const activeAnchors = [];
  const trackUseCounts = COMMENT_TRACKS.map(() => 0);
  let activeStart = 0;
  sortedComments.forEach((comment) => {
    const top = anchorTopById.get(comment.id);
    if (Number.isFinite(top)) {
      while (
        activeStart < activeAnchors.length
        && top - activeAnchors[activeStart].top >= COMMENT_ANCHOR_COLLISION_DISTANCE
      ) {
        trackUseCounts[activeAnchors[activeStart].trackIndex] -= 1;
        activeStart += 1;
      }
    }
    let trackIndex = COMMENT_TRACKS.findIndex((_, index) => trackUseCounts[index] === 0);
    if (trackIndex < 0) {
      trackIndex = COMMENT_TRACKS.length - 1;
    }
    const color = COMMENT_COLOR_PALETTE[trackIndex % COMMENT_COLOR_PALETTE.length];
    const presentation = {
      color,
      track: COMMENT_TRACKS[trackIndex],
      trackIndex,
    };
    presentations.set(comment.id, presentation);
    if (Number.isFinite(top)) {
      activeAnchors.push({
        id: comment.id,
        top,
        trackIndex,
      });
      trackUseCounts[trackIndex] += 1;
    }
  });
  return presentations;
}

export function commentAnchorTrackAvailable(editor, comments = [], range) {
  const top = getCommentAnchorTop(editor, range?.from);
  if (!Number.isFinite(top)) {
    return true;
  }
  const topById = buildCommentAnchorTopMap(editor, comments);
  const presentations = assignDocumentCommentPresentations(comments, topById);
  const usedTracks = new Set();
  normalizeDocumentComments(comments).forEach((comment) => {
    const commentTop = topById.get(comment.id);
    const presentation = presentations.get(comment.id);
    if (Number.isFinite(commentTop) && presentation && Math.abs(commentTop - top) < COMMENT_ANCHOR_COLLISION_DISTANCE) {
      usedTracks.add(presentation.trackIndex);
    }
  });
  return COMMENT_TRACKS.some((_, index) => !usedTracks.has(index));
}
