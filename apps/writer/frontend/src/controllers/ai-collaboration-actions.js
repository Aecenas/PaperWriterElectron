import { useCallback, useEffect, useRef, useState } from "react";
import { DOMSerializer, Fragment } from "@tiptap/pm/model";
import { bridge } from "../bridge.js";
import { buildAiApplyBlockManifest } from "../ai-direct-apply.js";
import {
  applyCollaborationEditorOperations,
  collaborationBlocksToSafeHtml,
  normalizeCollaborationProposal,
  validateCollaborationProposal,
} from "../ai-collaboration/protocol.js";
import { preflightMermaidSource } from "../editor/mermaid-preflight-client.js";

const BODY_OPERATION_TYPES = new Set(["replace_blocks", "insert_before", "insert_after"]);
const LOCAL_OPERATION_INTENT = /(?:添加|加入|加上|加个|加一个|插入|补上|设置|修改|改成|改为|替换|删除|移除|调整|改写|润色|扩写|缩写|整理成|转换成|生成(?:标题|表格|图)|绘制|画(?:一个|一张|成)?|拆分|分割|合并)/i;
const LOCAL_ANSWER_INTENT = /^(?:请)?(?:解释|说明|回答|分析|总结|概括|评价|检查|告诉我|为什么|什么是|如何理解|有哪些|是否|能否|这(?:段|篇|封).*(?:讲|表达|意思))/i;

export function classifyCollaborationIntentLocally(question) {
  const value = String(question || "").trim();
  if (!value) return null;
  if (LOCAL_OPERATION_INTENT.test(value)) return { mode: "collaborate", confidence: 0.99, local: true };
  if (LOCAL_ANSWER_INTENT.test(value) || /[?？]$/.test(value)) return { mode: "answer", confidence: 0.92, local: true };
  return null;
}

export function presentCollaborationError(error) {
  const raw = String(error?.message || error || "AI 协作启动失败")
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .replace(/\boperation-(\d+)\b/gi, "第 $1 项修改")
    .trim();
  const cause = raw.replace(/[。；;\s]+$/g, "") || "AI 协作启动失败";
  if (/没有内容|没有生成可审阅修改|没有可审阅修改/.test(cause)) {
    return `AI 返回的修改方案不完整（${cause}）。请求内容已放回输入框，可直接重试或写得更具体一些。`;
  }
  return `${cause}。请求内容已放回输入框，可直接重试。`;
}

function collaborationRequestId() {
  return `ai-collaboration-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function messageId(role, createdAt = Date.now()) {
  return `${role}-${createdAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function workspaceRelativePath(root, filePath) {
  const normalizedRoot = String(root || "").replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedPath = String(filePath || "").replace(/\\/g, "/");
  if (!normalizedRoot || !normalizedPath) return "";
  const rootKey = normalizedRoot.toLocaleLowerCase("en-US");
  const pathKey = normalizedPath.toLocaleLowerCase("en-US");
  return pathKey.startsWith(`${rootKey}/`) ? normalizedPath.slice(normalizedRoot.length + 1) : "";
}

function appendResolvedSummary(chat, proposal, status, selectedOperations) {
  const selectedIds = new Set(selectedOperations.map((operation) => operation.id));
  return {
    ...chat,
    pendingReview: null,
    proposalSummaries: [
      ...(chat.proposalSummaries || []),
      {
        id: proposal.id,
        status,
        summary: proposal.summary || proposal.reply,
        acceptedCount: selectedIds.size,
        rejectedCount: Math.max(0, proposal.operations.length - selectedIds.size),
        decisions: proposal.operations.map((operation) => ({
          id: operation.id,
          label: operation.label || operation.title || operation.type,
          type: operation.type,
          status: selectedIds.has(operation.id) ? "accepted" : "rejected",
          edited: selectedIds.has(operation.id) && Boolean(operation.edited),
        })),
        resolvedAt: Date.now(),
      },
    ].slice(-20),
    status: "idle",
    error: "",
  };
}

async function preflightCollaborationMermaid(operations) {
  for (const operation of operations) {
    for (const block of operation.blocks || []) {
      if (block.type === "mermaid") await preflightMermaidSource(block.source);
    }
  }
}

function copyCurrentSourceBlocksHtml(editor, manifest, blockIds) {
  if (!blockIds?.length) return "";
  const blockById = new Map((manifest.blocks || []).map((block) => [block.id, block]));
  const nodes = blockIds.map((id) => {
    const canonical = blockById.get(id)?.canonical;
    if (!canonical) throw new Error("派生信笺引用的原始块已经失效");
    return editor.schema.nodeFromJSON(JSON.parse(canonical));
  });
  const serializer = DOMSerializer.fromSchema(editor.schema);
  const container = window.document.createElement("div");
  container.append(serializer.serializeFragment(Fragment.fromArray(nodes), { document: window.document }));
  return container.innerHTML;
}

export function useAiCollaborationActions({
  activeTabId,
  activeTabReadOnly,
  aiBridge = bridge,
  aiChatInput,
  aiChatMessages,
  aiStatus,
  applyTitle,
  createSafetySnapshot,
  currentPath,
  editor,
  effectiveAiConfig,
  getActiveDocumentKey,
  getActiveDocumentSnapshot,
  getSaveDocument,
  getWorkspaceOverlays,
  handleSendAiChat,
  openDocumentPath,
  showConfirmDialog,
  showStatus,
  updateChatState,
  updateChatStateForKey,
  writingWorkspaceRoot,
}) {
  const activeRequestRef = useRef("");
  const committingRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState("");

  useEffect(() => aiBridge.onAiCollaborationEvent?.((event) => {
    if (!event?.requestId || event.requestId !== activeRequestRef.current) return;
    setStatusText(String(event.message || "正在准备协作方案"));
  }), [aiBridge]);

  const stop = useCallback(async () => {
    const requestId = activeRequestRef.current;
    if (!requestId) return false;
    await aiBridge.cancelAiCollaboration?.(requestId);
    activeRequestRef.current = "";
    setBusy(false);
    setStartedAt(0);
    setPendingQuestion("");
    setStatusText("");
    updateChatState({ status: "idle", error: "" });
    showStatus("已停止 AI 协作", "warning");
    return true;
  }, [aiBridge, showStatus, updateChatState]);

  const runPlan = useCallback(async ({ documentKey, question, snapshot }) => {
    const planRequestId = collaborationRequestId();
    activeRequestRef.current = planRequestId;
    setStatusText("正在规划可审阅修改");
    const createdAt = Date.now();
    const userMessage = {
      id: messageId("user", createdAt),
      role: "user",
      content: question,
      status: "done",
      createdAt,
    };
    updateChatStateForKey(documentKey, (chat) => ({
      ...chat,
      input: "",
      messages: [...chat.messages, userMessage],
      status: "streaming",
      error: "",
    }));
    const result = await aiBridge.planAiCollaboration?.({
      requestId: planRequestId,
      provider: effectiveAiConfig.provider,
      modelId: effectiveAiConfig.modelId,
      question,
      history: aiChatMessages
        .filter((message) => ["user", "assistant"].includes(message.role) && message.content?.trim())
        .slice(-20)
        .map((message) => ({ role: message.role, content: message.content })),
      workspaceRoot: writingWorkspaceRoot,
      current: snapshot,
      overlays: getWorkspaceOverlays?.() || [],
    });
    if (!result?.ok) throw new Error(result?.message || "AI 协作方案生成失败");
    const validation = validateCollaborationProposal(
      normalizeCollaborationProposal(result.proposal),
      snapshot.manifest,
      { documentId: snapshot.documentId },
    );
    if (!validation.ok) throw new Error(validation.errors.join("；"));
    const defaultFolder = snapshot.relativePath.split("/").slice(0, -1).join("/");
    const proposal = {
      ...validation.proposal,
      operations: validation.proposal.operations.map((operation) => (
        operation.type === "create_document" && !operation.folderRelativePath
          ? { ...operation, folderRelativePath: defaultFolder }
          : operation
      )),
    };
    await preflightCollaborationMermaid(proposal.operations);
    const sourceSummary = proposal.sources.length
      ? `\n\nAI 实际读取：${proposal.sources.map((source) => source.title).join("、")}`
      : "";
    const assistantMessage = {
      id: messageId("assistant"),
      role: "assistant",
      content: `${proposal.reply || "已生成待审阅修改。"}${sourceSummary}`,
      status: "done",
      elapsedSeconds: Math.max(0, (Date.now() - createdAt) / 1000),
      createdAt: Date.now(),
      collaborationProposalId: proposal.id,
    };
    updateChatStateForKey(documentKey, (chat) => ({
      ...chat,
      messages: [...chat.messages, assistantMessage],
      pendingReview: {
        proposal,
        originDocumentKey: documentKey,
        originTabId: activeTabId,
        workspaceRoot: writingWorkspaceRoot,
        createdAt: Date.now(),
      },
      status: "idle",
      error: "",
    }));
    showStatus("AI 协作方案已生成，请逐项审阅", "success");
    return proposal;
  }, [
    activeTabId,
    aiBridge,
    aiChatMessages,
    effectiveAiConfig.modelId,
    effectiveAiConfig.provider,
    getWorkspaceOverlays,
    showStatus,
    updateChatStateForKey,
    writingWorkspaceRoot,
  ]);

  const send = useCallback(async () => {
    const question = aiChatInput.trim();
    if (!question || busy || aiStatus === "streaming") return;
    if (activeTabReadOnly) {
      showStatus("当前信笺为只读，不能启动 AI 协作", "warning");
      return;
    }
    const activeSnapshot = getActiveDocumentSnapshot?.();
    const document = activeSnapshot?.document;
    if (!document || !editor?.state?.doc) return;
    const manifest = buildAiApplyBlockManifest(editor.state.doc);
    const snapshot = {
      documentId: String(document.documentId || ""),
      title: String(document.title || "未命名信笺"),
      content: editor.getText({ blockSeparator: "\n\n" }).slice(0, 2 * 1024 * 1024),
      relativePath: workspaceRelativePath(writingWorkspaceRoot, currentPath),
      revision: String(document.updatedAt || ""),
      manifest,
    };
    if (!snapshot.documentId || !manifest.documentFingerprint) {
      showStatus("当前信笺快照无效，无法启动 AI 协作", "warning");
      return;
    }
    const documentKey = getActiveDocumentKey();
    const routeRequestId = collaborationRequestId();
    activeRequestRef.current = routeRequestId;
    setBusy(true);
    setStartedAt(Date.now());
    setPendingQuestion(question);
    const localRoute = classifyCollaborationIntentLocally(question);
    setStatusText(localRoute?.mode === "collaborate" ? "正在准备可审阅修改" : "正在判断回答方式");
    updateChatState({ status: "streaming", error: "" });
    try {
      let route = localRoute;
      if (!route) {
        try {
          route = await aiBridge.routeAiCollaboration?.({
            requestId: routeRequestId,
            provider: effectiveAiConfig.provider,
            modelId: effectiveAiConfig.modelId,
            question,
          });
          if (!route?.ok) throw new Error(route?.message || "AI 协作意图判断失败");
        } catch (routeError) {
          route = {
            mode: "uncertain",
            reason: `自动判断暂时失败：${routeError?.message || "未知错误"}`,
          };
        }
      }
      if (activeRequestRef.current !== routeRequestId) return;
      let mode = route.mode;
      if (mode === "uncertain") {
        mode = await showConfirmDialog({
          tone: "info",
          eyebrow: "AI 协作",
          title: "你希望我只回答，还是生成修改？",
          message: route.reason || "这条请求既可以作为问题回答，也可能是在要求修改信笺。",
          detail: "选择“生成修改”后仍只会产生待审阅方案，不会直接改动正文。",
          cancelValue: "answer",
          actions: [
            { value: "collaborate", label: "生成修改", variant: "primary" },
            { value: "answer", label: "仅回答", variant: "secondary", autoFocus: true },
          ],
        });
      }
      if (mode === "answer") {
        activeRequestRef.current = "";
        setStatusText("");
        setBusy(false);
        setStartedAt(0);
        await handleSendAiChat();
        return;
      }
      await runPlan({ documentKey, question, snapshot });
    } catch (error) {
      if (!activeRequestRef.current) return;
      const message = presentCollaborationError(error);
      updateChatStateForKey(documentKey, (chat) => ({
        ...chat,
        input: chat.input?.trim() ? chat.input : question,
        status: "error",
        error: message,
      }));
      showStatus(message, "warning");
    } finally {
      activeRequestRef.current = "";
      setBusy(false);
      setStartedAt(0);
      setPendingQuestion("");
      setStatusText("");
    }
  }, [
    activeTabReadOnly,
    aiBridge,
    aiChatInput,
    aiStatus,
    busy,
    currentPath,
    editor,
    effectiveAiConfig.modelId,
    effectiveAiConfig.provider,
    getActiveDocumentKey,
    getActiveDocumentSnapshot,
    handleSendAiChat,
    runPlan,
    showConfirmDialog,
    showStatus,
    updateChatStateForKey,
    updateChatState,
    writingWorkspaceRoot,
  ]);

  const updateOperation = useCallback((operationId, patch) => {
    updateChatState((chat) => {
      const pending = chat.pendingReview;
      if (!pending) return chat;
      return {
        ...chat,
        pendingReview: {
          ...pending,
          proposal: {
            ...pending.proposal,
            operations: pending.proposal.operations.map((operation) => (
              operation.id === operationId
                ? (() => {
                    const nextPatch = typeof patch === "function" ? patch(operation) : patch;
                    return {
                      ...operation,
                      ...nextPatch,
                      edited: nextPatch?.edited === true || operation.edited === true,
                      reviewRevision: Date.now(),
                    };
                  })()
                : operation
            )),
          },
        },
      };
    });
  }, [updateChatState]);

  const acceptAllPending = useCallback(() => {
    updateChatState((chat) => {
      const pending = chat.pendingReview;
      if (!pending) return chat;
      return {
        ...chat,
        pendingReview: {
          ...pending,
          proposal: {
            ...pending.proposal,
            operations: pending.proposal.operations.map((operation) => (
              operation.decision === "pending"
                ? { ...operation, decision: "accepted", selected: true, reviewRevision: Date.now() }
                : operation
            )),
          },
        },
      };
    });
  }, [updateChatState]);

  const discard = useCallback(() => {
    updateChatState((chat) => {
      if (!chat.pendingReview) return chat;
      const proposal = chat.pendingReview.proposal;
      return {
        ...appendResolvedSummary(chat, proposal, "discarded", []),
        messages: [...chat.messages, {
          id: messageId("assistant"),
          role: "assistant",
          content: "已取消这份协作方案；正文和工作区文件均未修改。",
          status: "done",
          createdAt: Date.now(),
        }],
      };
    });
    showStatus("已取消 AI 协作，未产生任何修改", "success");
  }, [showStatus, updateChatState]);

  const commit = useCallback(async (pendingReview) => {
    if (!pendingReview?.proposal || committingRef.current) return false;
    const activeSnapshot = getActiveDocumentSnapshot?.();
    if (!activeSnapshot || activeSnapshot.tabId !== pendingReview.originTabId) {
      showStatus("请先返回发起协作的信笺", "warning");
      return false;
    }
    const proposal = normalizeCollaborationProposal(pendingReview.proposal);
    const unreviewedOperations = proposal.operations.filter((operation) => operation.decision === "pending");
    if (unreviewedOperations.length) {
      showStatus(`还有 ${unreviewedOperations.length} 项修改尚未审阅`, "warning");
      return false;
    }
    const selectedOperations = proposal.operations.filter((operation) => operation.decision === "accepted");
    if (!selectedOperations.length) {
      updateChatState((chat) => ({
        ...appendResolvedSummary(chat, proposal, "applied", []),
        messages: [...chat.messages, {
          id: messageId("assistant"),
          role: "assistant",
          content: `协作审阅完成：${proposal.operations.length} 项修改均已拒绝，正文和工作区文件未发生变化。`,
          status: "done",
          createdAt: Date.now(),
        }],
      }));
      showStatus("审阅完成，所有修改均已拒绝", "success");
      return true;
    }
    const manifest = buildAiApplyBlockManifest(editor.state.doc);
    const validation = validateCollaborationProposal(
      { ...proposal, operations: selectedOperations },
      manifest,
      { documentId: activeSnapshot.document.documentId },
    );
    if (!validation.ok) {
      updateChatState((chat) => chat.pendingReview ? {
        ...chat,
        pendingReview: { ...chat.pendingReview, proposal: { ...chat.pendingReview.proposal, status: "stale" } },
        error: validation.errors.join("；"),
      } : chat);
      showStatus("协作方案已过期，只能取消或重新生成", "warning");
      return false;
    }
    const bodyOperations = selectedOperations.filter((operation) => BODY_OPERATION_TYPES.has(operation.type));
    const titleOperation = selectedOperations.find((operation) => operation.type === "set_title");
    const derivedOperations = selectedOperations.filter((operation) => operation.type === "create_document");
    if (derivedOperations.length && !pendingReview.workspaceRoot) {
      showStatus("创建派生信笺前，请先打开一个工作区文件夹", "warning");
      return false;
    }
    committingRef.current = true;
    let preparedCommitId = "";
    let bodyApplied = false;
    let titleApplied = false;
    const oldTitle = activeSnapshot.document.title;
    try {
      await preflightCollaborationMermaid(selectedOperations);
      if (bodyOperations.length || titleOperation) await createSafetySnapshot?.("AI 协作前");
      const prepared = await aiBridge.prepareAiCollaborationCommit?.({
        workspaceRoot: pendingReview.workspaceRoot,
        proposalId: proposal.id,
        currentDocumentId: activeSnapshot.document.documentId,
        sources: proposal.sources,
        overlays: getWorkspaceOverlays?.() || [],
        sourceDocument: getSaveDocument(),
        outputs: derivedOperations.map((operation) => ({
          operationId: operation.id,
          title: operation.title,
          fileName: operation.fileName,
          folderRelativePath: operation.folderRelativePath,
          html: collaborationBlocksToSafeHtml(operation.blocks),
          copiedHtml: copyCurrentSourceBlocksHtml(editor, manifest, operation.sourceBlockIds),
          sourceDocumentIds: operation.sourceDocumentIds,
          sourceBlockIds: operation.sourceBlockIds,
        })),
      });
      if (!prepared?.ok) throw new Error(prepared?.message || "派生信笺预提交失败");
      preparedCommitId = prepared.commitId;
      if (titleOperation) {
        applyTitle(titleOperation.title);
        titleApplied = true;
      }
      if (bodyOperations.length) {
        if (!applyCollaborationEditorOperations(editor, bodyOperations, manifest)) {
          throw new Error("正文修改无法应用到当前版本");
        }
        bodyApplied = true;
      }
      const committed = await aiBridge.commitAiCollaboration?.(preparedCommitId);
      preparedCommitId = "";
      if (!committed?.ok) throw new Error(committed?.message || "协作提交失败");
      const editedCount = selectedOperations.filter((operation) => operation.edited).length;
      const acceptedLabels = selectedOperations.map((operation) => operation.label || operation.title || operation.type).join("、");
      const rejectedLabels = proposal.operations
        .filter((operation) => !selectedOperations.some((selected) => selected.id === operation.id))
        .map((operation) => operation.label || operation.title || operation.type)
        .join("、");
      updateChatState((chat) => ({
        ...appendResolvedSummary(chat, proposal, "applied", selectedOperations),
        messages: [...chat.messages, {
          id: messageId("assistant"),
          role: "assistant",
          content: `协作提交完成：已接受 ${acceptedLabels || "无"}；已拒绝 ${rejectedLabels || "无"}${editedCount ? `；其中 ${editedCount} 项经你编辑` : ""}。`,
          status: "done",
          createdAt: Date.now(),
        }],
      }));
      for (const output of committed.outputs || committed.files || []) {
        if (!output?.path) continue;
        try {
          await openDocumentPath?.(output.path);
        } catch {
          showStatus("派生信笺已创建，但未能自动打开", "warning");
        }
      }
      showStatus("AI 协作修改已提交", "success");
      return true;
    } catch (error) {
      if (bodyApplied) editor.commands.undo();
      if (titleApplied) applyTitle(oldTitle);
      if (preparedCommitId) await aiBridge.abortAiCollaborationCommit?.(preparedCommitId).catch?.(() => {});
      if (/来源信笺已被外部修改|来源信笺版本已变化|方案已过期|正文版本已经变化/.test(String(error?.message || ""))) {
        updateChatState((chat) => chat.pendingReview ? {
          ...chat,
          pendingReview: {
            ...chat.pendingReview,
            proposal: { ...chat.pendingReview.proposal, status: "stale" },
          },
          error: error.message,
        } : chat);
      }
      showStatus(error?.message || "AI 协作提交失败，已撤销本次修改", "warning");
      return false;
    } finally {
      committingRef.current = false;
    }
  }, [
    aiBridge,
    applyTitle,
    createSafetySnapshot,
    editor,
    getActiveDocumentSnapshot,
    getSaveDocument,
    getWorkspaceOverlays,
    openDocumentPath,
    showStatus,
    updateChatState,
  ]);

  return {
    collaborationBusy: busy,
    collaborationPendingQuestion: pendingQuestion,
    collaborationStartedAt: startedAt,
    collaborationStatusText: statusText,
    acceptAllPendingCollaboration: acceptAllPending,
    commitCollaborationReview: commit,
    discardCollaborationReview: discard,
    sendAiCollaboration: send,
    stopAiCollaboration: stop,
    updateCollaborationOperation: updateOperation,
  };
}
