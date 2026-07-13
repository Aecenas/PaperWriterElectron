export function createDocumentCommentId() {
  return `comment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeDocumentComments(comments = []) {
  if (!Array.isArray(comments)) return [];
  const seen = new Set();
  return comments
    .slice(0, 5000)
    .map((comment) => {
      const from = Math.max(1, Math.floor(Number(comment?.from) || 0));
      const to = Math.max(1, Math.floor(Number(comment?.to) || 0));
      const text = typeof comment?.text === "string" ? comment.text.trim().slice(0, 2000) : "";
      if (!text || from === to) return null;
      const idSource = typeof comment?.id === "string" && comment.id.trim()
        ? comment.id.trim().slice(0, 128)
        : createDocumentCommentId();
      const id = seen.has(idSource) ? createDocumentCommentId() : idSource;
      seen.add(id);
      const createdAt = typeof comment?.createdAt === "string" && comment.createdAt ? comment.createdAt.slice(0, 64) : new Date().toISOString();
      const updatedAt = typeof comment?.updatedAt === "string" && comment.updatedAt ? comment.updatedAt.slice(0, 64) : createdAt;
      return {
        id,
        from: Math.min(from, to),
        to: Math.max(from, to),
        text,
        quote: typeof comment?.quote === "string" ? comment.quote.trim().slice(0, 280) : "",
        createdAt,
        updatedAt,
      };
    })
    .filter(Boolean);
}

export function mapDocumentCommentsThroughTransaction(comments = [], transaction, maxPosition = 1) {
  if (!Array.isArray(comments)) return [];
  if (!transaction?.docChanged) return comments;
  let mappedComments = null;
  for (let index = 0; index < comments.length; index += 1) {
    const comment = comments[index];
    const fromResult = transaction.mapping.mapResult(comment.from, 1);
    const toResult = transaction.mapping.mapResult(comment.to, -1);
    const from = Math.max(1, Math.min(fromResult.pos, maxPosition));
    const to = Math.max(1, Math.min(toResult.pos, maxPosition));
    const removed = (fromResult.deleted && toResult.deleted) || from >= to;
    const changed = removed || from !== comment.from || to !== comment.to;
    if (changed && !mappedComments) mappedComments = comments.slice(0, index);
    if (!mappedComments) continue;
    if (!removed) mappedComments.push(from === comment.from && to === comment.to ? comment : { ...comment, from, to });
  }
  return mappedComments || comments;
}
