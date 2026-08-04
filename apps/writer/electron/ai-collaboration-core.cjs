const COLLABORATION_PROPOSAL_VERSION = 1;
const OPERATION_TYPES = new Set([
  "set_title",
  "replace_blocks",
  "insert_before",
  "insert_after",
  "create_document",
]);
const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "orderedList",
  "bulletList",
  "quote",
  "divider",
  "table",
  "mermaid",
]);
const MAX_PLANNING_BLOCK_TEXT = 600000;

function safeText(value, maximum = 200000) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .slice(0, maximum);
}

function safeId(value, fallback = "") {
  const normalized = safeText(value, 128).trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : fallback;
}

function parseJsonResponse(raw) {
  const source = safeText(raw, 8 * 1024 * 1024).trim();
  const stripped = source.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!stripped) throw new Error("AI 协作返回为空");
  const value = JSON.parse(stripped);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AI 协作必须返回 JSON 对象");
  }
  return value;
}

function normalizeIntentRoute(raw) {
  const value = typeof raw === "string" ? parseJsonResponse(raw) : raw;
  const mode = value?.mode === "collaborate" || value?.mode === "answer"
    ? value.mode
    : "uncertain";
  return {
    mode,
    confidence: Math.max(0, Math.min(1, Number(value?.confidence) || 0)),
    reason: safeText(value?.reason, 500).trim(),
  };
}

function routeMessages(question, repair = null) {
  const messages = [
    {
      role: "system",
      content: [
        "你是笺间 AI 协作的意图路由器。只判断用户这一次输入是普通问答，还是要求实际修改/创建信笺。",
        "只返回 JSON：{\"mode\":\"answer|collaborate\",\"confidence\":0到1,\"reason\":\"简短原因\"}。",
        "要求添加、删除、改写、整理、插入标题/表情/表格/Mermaid、拆分或合并信笺，均为 collaborate。",
        "审阅、解释、评价、询问建议但没有要求落地修改，为 answer。意图不明确时 confidence 应低于 0.6。",
        "不要返回 Markdown，不要执行任务，不要索取或猜测工作区内容。",
      ].join("\n"),
    },
    { role: "user", content: safeText(question, 200000) },
  ];
  if (repair) {
    messages.push(
      { role: "assistant", content: safeText(repair.raw, 16000) || "（上次返回为空）" },
      { role: "user", content: `上次 JSON 无效：${safeText(repair.message, 1000)}。只返回修正后的路由 JSON。` },
    );
  }
  return messages;
}

function normalizeBlock(block = {}, index = 0) {
  const type = BLOCK_TYPES.has(block.type) ? block.type : "paragraph";
  const blockText = block.text ?? (typeof block.content === "string" ? block.content : block.value);
  if (type === "divider") return { type };
  if (type === "heading") {
    return {
      type,
      level: Math.max(1, Math.min(4, Math.floor(Number(block.level) || 2))),
      text: safeText(blockText, 100000).trim(),
    };
  }
  if (type === "orderedList" || type === "bulletList") {
    return {
      type,
      items: (Array.isArray(block.items) ? block.items : []).slice(0, 1000).map((item, itemIndex) => ({
        text: safeText(item?.text ?? item, 20000).trim(),
        number: Math.max(1, Math.floor(Number(item?.number) || itemIndex + 1)),
      })).filter((item) => item.text),
    };
  }
  if (type === "table") {
    const headers = (Array.isArray(block.headers) ? block.headers : []).slice(0, 50).map((cell) => safeText(cell, 20000));
    const rows = (Array.isArray(block.rows) ? block.rows : []).slice(0, 1000).map((row) => (
      Array.isArray(row) ? row.slice(0, 50).map((cell) => safeText(cell, 20000)) : []
    ));
    return { type, headers, rows };
  }
  if (type === "mermaid") {
    return {
      type,
      source: safeText(block.source ?? block.code, 40000).trim(),
      caption: safeText(block.caption || "Mermaid 图", 500).trim() || "Mermaid 图",
      width: ["45%", "62%", "78%", "100%"].includes(block.width) ? block.width : "78%",
      diagramId: safeId(block.diagramId, `mermaid-${index + 1}`),
    };
  }
  return { type, text: safeText(blockText, 200000).trim() };
}

function normalizeBlocks(blocks) {
  return (Array.isArray(blocks) ? blocks : []).slice(0, 2000).map(normalizeBlock).filter((block) => {
    if (block.type === "divider") return true;
    if (block.type === "table") return block.headers.length > 0;
    if (block.type === "mermaid") return Boolean(block.source);
    if (block.type === "orderedList" || block.type === "bulletList") return block.items.length > 0;
    return Boolean(block.text);
  });
}

function normalizeOperationBlocks(operation = {}) {
  if (Array.isArray(operation.blocks)) return normalizeBlocks(operation.blocks);
  if (Array.isArray(operation.content)) return normalizeBlocks(operation.content);
  const inlineText = operation.text ?? (typeof operation.content === "string" ? operation.content : "");
  return inlineText ? normalizeBlocks([{ type: "paragraph", text: inlineText }]) : [];
}

function hasReviewableOperationContent(operation) {
  if (operation.type === "set_title") return true;
  if (operation.type === "create_document") {
    return Boolean(operation.blocks.length || operation.sourceBlockIds.length || operation.sourceDocumentIds.length);
  }
  return operation.blocks.length > 0;
}

function safeFolder(value) {
  return safeText(value, 32768).replace(/\\/g, "/").trim();
}

function invalidFolder(value) {
  const normalized = String(value || "");
  return Boolean(normalized) && (
    normalized.startsWith("/")
    || /^[a-z]:\//i.test(normalized)
    || normalized.endsWith("/")
    || normalized.split("/").some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))
  );
}

function safeFileName(value, fallback = "AI协作信笺") {
  const base = safeText(value, 240)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/[. ]+$/g, "")
    .trim() || fallback;
  return /\.letterpaper$/i.test(base) ? base : `${base}.letterpaper`;
}

function normalizeOperation(operation = {}, index = 0) {
  if (!OPERATION_TYPES.has(operation.type)) return null;
  const common = {
    id: safeId(operation.id, `operation-${index + 1}`),
    type: operation.type,
    label: safeText(operation.label, 240).trim(),
    selected: true,
    edited: false,
  };
  if (operation.type === "set_title") {
    return { ...common, title: safeText(operation.title || "未命名信笺", 200).trim() || "未命名信笺" };
  }
  if (operation.type === "create_document") {
    const title = safeText(operation.title || "未命名信笺", 200).trim() || "未命名信笺";
    return {
      ...common,
      title,
      fileName: safeFileName(operation.fileName, title),
      folderRelativePath: safeFolder(operation.folderRelativePath),
      blocks: normalizeOperationBlocks(operation),
      sourceDocumentIds: (Array.isArray(operation.sourceDocumentIds) ? operation.sourceDocumentIds : [])
        .slice(0, 20).map((id) => safeId(id)).filter(Boolean),
      sourceBlockIds: (Array.isArray(operation.sourceBlockIds) ? operation.sourceBlockIds : [])
        .slice(0, 2000).map((id) => safeId(id)).filter(Boolean),
    };
  }
  const blocks = normalizeOperationBlocks(operation);
  if (operation.type === "replace_blocks") {
    return {
      ...common,
      targetBlockIds: (Array.isArray(operation.targetBlockIds) ? operation.targetBlockIds : [])
        .slice(0, 500).map((id) => safeId(id)).filter(Boolean),
      blocks,
    };
  }
  return { ...common, anchorBlockId: safeId(operation.anchorBlockId), blocks };
}

function normalizeProposal(value = {}, context = {}) {
  const proposal = value.type === "proposal" && value.proposal && typeof value.proposal === "object"
    ? { ...value.proposal, reply: value.reply || value.proposal.reply }
    : value;
  return {
    version: COLLABORATION_PROPOSAL_VERSION,
    id: safeId(proposal.id, `collaboration-${Date.now().toString(36)}`),
    reply: safeText(proposal.reply || proposal.summary, 200000).trim(),
    summary: safeText(proposal.summary || proposal.reply, 2000).trim(),
    createdAt: Date.now(),
    base: {
      documentId: safeId(context.documentId),
      documentFingerprint: safeText(context.documentFingerprint, 128),
      revision: safeText(context.revision, 256),
    },
    sources: (Array.isArray(context.sources) ? context.sources : []).slice(0, 20).map((source, index) => ({
      id: safeId(source.id || source.documentId, `source-${index + 1}`),
      documentId: safeId(source.documentId),
      title: safeText(source.title || "未命名信笺", 200).trim() || "未命名信笺",
      relativePath: safeText(source.relativePath, 32768).replace(/\\/g, "/").replace(/^\/+/, ""),
      fingerprint: safeText(source.fingerprint, 128),
      revision: safeText(source.revision, 256),
    })),
    operations: (Array.isArray(proposal.operations) ? proposal.operations : [])
      .slice(0, 50).map(normalizeOperation).filter(Boolean).filter(hasReviewableOperationContent),
    status: "pending",
  };
}

function validateProposal(proposal, manifest) {
  const errors = [];
  const blockById = new Map((Array.isArray(manifest?.blocks) ? manifest.blocks : []).map((block) => [String(block.id || ""), block]));
  const sourceDocumentIds = new Set([
    proposal.base.documentId,
    ...proposal.sources.map((source) => source.documentId),
  ].filter(Boolean));
  if (!proposal.operations.length) errors.push("AI 没有生成可审阅修改");
  proposal.operations.forEach((operation) => {
    if (operation.type === "set_title") return;
    if (operation.type === "create_document") {
      if (invalidFolder(operation.folderRelativePath)) errors.push(`${operation.label || operation.id} 的目标文件夹无效`);
      if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(operation.fileName)) {
        errors.push(`${operation.label || operation.id} 的文件名是系统保留名称`);
      }
      if (!operation.blocks.length && !operation.sourceBlockIds.length && !operation.sourceDocumentIds.length) {
        errors.push(`${operation.label || operation.id} 没有内容`);
      }
      if (operation.sourceBlockIds.some((id) => !blockById.has(id))) {
        errors.push(`${operation.label || operation.id} 引用的来源块无效`);
      }
      if (operation.sourceDocumentIds.some((id) => !sourceDocumentIds.has(id))) {
        errors.push(`${operation.label || operation.id} 引用的来源信笺无效`);
      }
      return;
    }
    if (!operation.blocks.length) errors.push(`${operation.label || operation.id} 没有内容`);
    if (operation.type === "replace_blocks") {
      const targets = operation.targetBlockIds.map((id) => blockById.get(id)).filter(Boolean);
      if (!targets.length || targets.length !== operation.targetBlockIds.length) {
        errors.push(`${operation.label || operation.id} 的替换目标无效`);
      } else if (targets.some((target) => target.protected)) {
        errors.push(`${operation.label || operation.id} 试图修改受保护块`);
      }
      return;
    }
    const anchor = blockById.get(operation.anchorBlockId);
    if (!anchor || anchor.protected) errors.push(`${operation.label || operation.id} 的插入位置无效`);
  });
  return { ok: !errors.length, errors };
}

function planningMessages({ current, history, question, toolTranscript = [], repair = null }) {
  let remainingBlockText = MAX_PLANNING_BLOCK_TEXT;
  let contentTruncated = false;
  const manifest = {
    documentFingerprint: safeText(current?.manifest?.documentFingerprint, 128),
    blocks: (Array.isArray(current?.manifest?.blocks) ? current.manifest.blocks : []).slice(0, 5000).map((block) => ({
      id: safeId(block.id),
      index: Math.max(0, Math.floor(Number(block.index) || 0)),
      type: safeText(block.type, 64),
      text: (() => {
        const original = safeText(block.text, 100000);
        const bounded = original.slice(0, Math.max(0, remainingBlockText));
        remainingBlockText -= bounded.length;
        if (bounded.length < original.length) contentTruncated = true;
        return bounded;
      })(),
      protected: Boolean(block.protected),
    })),
  };
  const system = [
    "你是笺间的 AI 协作代理。你不能直接修改文件，只能搜索/读取当前工作区信笺，最终提交一份供用户审阅的结构化方案。",
    "每轮只返回一个 JSON 对象，不要使用 Markdown 代码围栏。",
    "需要工作区资料时返回：{\"type\":\"tool_calls\",\"calls\":[{\"tool\":\"search_workspace_letters\",\"query\":\"关键词，可为空\",\"limit\":10},{\"tool\":\"read_workspace_letters\",\"paths\":[\"相对路径\"]}]}。",
    "工具仅支持 search_workspace_letters 和 read_workspace_letters；不要猜测绝对路径。先搜索再读取，最多读取与任务直接相关的信笺。",
    "可以修改当前信笺，或新建派生信笺；严禁修改其他已有信笺，严禁删除、覆盖、移动或重命名任何文件。",
    "最终返回：{\"type\":\"proposal\",\"reply\":\"给用户的说明\",\"summary\":\"方案摘要\",\"operations\":[...]}。",
    "operation.type 只允许 set_title、replace_blocks、insert_before、insert_after、create_document。",
    "set_title 使用 title；replace_blocks 使用连续 targetBlockIds 和 blocks；insert_before/insert_after 使用 anchorBlockId 和 blocks。",
    "create_document 使用 title、fileName、folderRelativePath、sourceDocumentIds、sourceBlockIds、blocks，且必须创建新 .letterpaper 文件。",
    "拆分当前信笺时优先用 sourceBlockIds 引用输入清单中的原始块，本地会原样复制这些富文本块；合并读取到的其他信笺时用 sourceDocumentIds 引用实际来源文档。不要在 blocks 中重写已有图片、表格、公式、脚注或文献。",
    "blocks 只允许 paragraph、heading(level 1-4)、orderedList、bulletList、quote、divider、table(headers/rows)、mermaid(source/caption/width)。Emoji 直接放在文字中。",
    "不得输出 HTML、脚本、data URL、绝对路径或白名单外字段。所有正文落点必须使用输入清单中的块 ID。",
  ].join("\n");
  const messages = [
    { role: "system", content: system },
    ...((Array.isArray(history) ? history : []).slice(-20).map((message) => ({
      role: message?.role === "assistant" ? "assistant" : "user",
      content: safeText(message?.content, 100000),
    })).filter((message) => message.content.trim())),
    {
      role: "user",
      content: JSON.stringify({
        currentLetter: {
          documentId: safeId(current?.documentId),
          title: safeText(current?.title, 200),
          contentCharacters: safeText(current?.content, 2 * 1024 * 1024).length,
          contentTruncated,
          manifest,
        },
        request: safeText(question, 200000),
      }),
    },
  ];
  toolTranscript.forEach((entry) => {
    messages.push(
      { role: "assistant", content: JSON.stringify(entry.call) },
      { role: "user", content: JSON.stringify({ toolResults: entry.results }) },
    );
  });
  if (repair) {
    messages.push(
      { role: "assistant", content: safeText(repair.raw, 100000) || "（上次返回为空）" },
      { role: "user", content: `上次输出未通过本地校验：${safeText(repair.message, 1000)}。只修复 JSON、字段或目标块；不要扩大任务，也不要添加解释。` },
    );
  }
  return messages;
}

function normalizeToolCalls(value = {}) {
  if (value.type !== "tool_calls" || !Array.isArray(value.calls)) return [];
  return value.calls.slice(0, 4).flatMap((call) => {
    if (call?.tool === "search_workspace_letters") {
      return [{
        tool: call.tool,
        query: safeText(call.query, 500).trim(),
        limit: Math.max(1, Math.min(30, Math.floor(Number(call.limit) || 10))),
      }];
    }
    if (call?.tool === "read_workspace_letters") {
      const paths = (Array.isArray(call.paths) ? call.paths : []).slice(0, 20)
        .map((item) => safeText(item, 32768).replace(/\\/g, "/").replace(/^\/+/, ""))
        .filter((item) => item && !item.split("/").some((segment) => segment === ".." || segment === "."));
      return paths.length ? [{ tool: call.tool, paths }] : [];
    }
    return [];
  });
}

module.exports = {
  COLLABORATION_PROPOSAL_VERSION,
  normalizeIntentRoute,
  normalizeProposal,
  normalizeToolCalls,
  parseJsonResponse,
  planningMessages,
  routeMessages,
  validateProposal,
};
