import { useMemo } from "react";
import { Check } from "lucide-react";
import { bridge } from "../bridge.js";
import {
  buildAiOptimizationContext,
  summarizeAiApplyTarget,
} from "../ai/context.js";
import {
  buildAiApplyBlockManifest,
  createManualAiDirectApplyOperation,
  findCommentsOverlappingAiApplyOperation,
  resolveAiDirectApplyWithRepair,
} from "../ai-direct-apply.js";
import { getDocumentComments } from "../editor/decorations.js";

export function createAiApplyPreviewActions({
  aiApplyPreview,
  buildManifest = buildAiApplyBlockManifest,
  editor,
  findOverlappingComments = findCommentsOverlappingAiApplyOperation,
  getActiveDocumentSnapshot,
  getComments = getDocumentComments,
  now = Date.now,
  setAiApplyPreview,
  setManualAiApply,
  setManualFallbackAiBlockIndexes,
  showStatus,
  summarizeTarget = summarizeAiApplyTarget,
}) {
  const beginManualAiApply = (
    block,
    blockIndex,
    blocks,
    reason = "",
  ) => {
    setManualFallbackAiBlockIndexes((current) => (
      current.includes(blockIndex) ? current : [...current, blockIndex]
    ));
    setManualAiApply({
      block,
      blockIndex,
      blocks: Array.isArray(blocks) ? blocks : [],
    });
    showStatus(
      reason || "未能可靠定位，请在左侧选择原文位置；按 Esc 可取消",
      "warning",
    );
  };

  const commitAiApplyOperation = (resolved) => {
    if (!resolved?.ok || !resolved.operation || !resolved.manifest) {
      return { ok: false, stale: true };
    }
    const currentFingerprint = buildManifest(
      editor.state.doc,
    ).documentFingerprint;
    if (currentFingerprint !== resolved.manifest.documentFingerprint) {
      return { ok: false, stale: true };
    }
    const applied = editor
      .chain()
      .focus()
      .insertContentAt(
        {
          from: resolved.operation.from,
          to: resolved.operation.to,
        },
        resolved.operation.content,
        { updateSelection: true },
      )
      .run();
    return applied ? { ok: true } : { ok: false, rejected: true };
  };

  const stageAiApplyPreview = (resolved, context = {}) => {
    if (!resolved?.ok || !resolved.operation || !resolved.manifest) {
      return { ok: false, stale: true };
    }
    const currentFingerprint = buildManifest(
      editor.state.doc,
    ).documentFingerprint;
    if (currentFingerprint !== resolved.manifest.documentFingerprint) {
      return { ok: false, stale: true };
    }
    const currentDocument = getActiveDocumentSnapshot()?.document;
    const currentComments = getComments(
      editor,
      currentDocument?.comments,
    );
    const overlappingComments = findOverlappingComments(
      resolved.operation,
      currentComments,
    );
    const actionLabel = resolved.operation.action === "replace"
      ? `替换 ${resolved.operation.targetBlockIds?.length || 1} 个连续原文块`
      : (
          resolved.operation.action === "insert_before"
            ? "插入到目标之前"
            : "插入到目标之后"
        );
    setManualAiApply(null);
    setAiApplyPreview({
      id: `${now()}-${context.blockIndex ?? "manual"}`,
      resolved,
      actionLabel,
      targetSummary: summarizeTarget(
        resolved.operation,
        resolved.manifest,
      ),
      commentCount: overlappingComments.length,
      block: context.block || null,
      blockIndex: Number.isInteger(context.blockIndex)
        ? context.blockIndex
        : -1,
      blocks: Array.isArray(context.blocks) ? context.blocks : [],
    });
    return { ok: true };
  };

  const cancelManualAiApply = () => {
    setManualAiApply(null);
  };

  const cancelAiApplyPreview = () => {
    setAiApplyPreview(null);
    showStatus("已取消这次修改，正文保持不变", "success");
  };

  const confirmAiApplyPreview = () => {
    if (!aiApplyPreview) return;
    const committed = commitAiApplyOperation(aiApplyPreview.resolved);
    setAiApplyPreview(null);
    if (committed.ok) {
      showStatus("已应用修改；按 Ctrl+Z 可完整撤销", "success");
      return;
    }
    if (aiApplyPreview.block && aiApplyPreview.blockIndex >= 0) {
      beginManualAiApply(
        aiApplyPreview.block,
        aiApplyPreview.blockIndex,
        aiApplyPreview.blocks,
        "确认前目标位置发生变化，请重新选择原文位置",
      );
      return;
    }
    showStatus("确认前目标位置发生变化，请重新选择", "warning");
  };

  return {
    beginManualAiApply,
    cancelAiApplyPreview,
    cancelManualAiApply,
    commitAiApplyOperation,
    confirmAiApplyPreview,
    stageAiApplyPreview,
  };
}

export function useAiApplyPreviewActions(options) {
  return useMemo(
    () => createAiApplyPreviewActions(options),
    [
      options.aiApplyPreview,
      options.buildManifest,
      options.editor,
      options.findOverlappingComments,
      options.getActiveDocumentSnapshot,
      options.getComments,
      options.now,
      options.setAiApplyPreview,
      options.setManualAiApply,
      options.setManualFallbackAiBlockIndexes,
      options.showStatus,
      options.summarizeTarget,
    ],
  );
}

export function createAiApplyResolutionActions({
  activeTabReadOnly,
  aiApplyInFlightRef,
  aiApplyPreview,
  aiBridge = bridge,
  aiStatus,
  applyingAiBlockIndex,
  beginManualAiApply,
  buildManifest = buildAiApplyBlockManifest,
  buildOptimizationContext = buildAiOptimizationContext,
  createManualOperation = createManualAiDirectApplyOperation,
  editor,
  findOverlappingComments = findCommentsOverlappingAiApplyOperation,
  getActiveDocumentSnapshot,
  getComments = getDocumentComments,
  manualAiApply,
  manualFallbackAiBlockIndexes,
  resolveDirectApply = resolveAiDirectApplyWithRepair,
  setApplyingAiBlockIndex,
  setManualAiApply,
  showConfirmDialog,
  showStatus,
  stageAiApplyPreview,
  summarizeTarget = summarizeAiApplyTarget,
}) {
  const handleApplyAiBlock = async (block, blockIndex, blocks) => {
    if (
      !editor
      || applyingAiBlockIndex >= 0
      || aiApplyInFlightRef.current
      || aiStatus === "streaming"
    ) return;
    if (aiApplyPreview) {
      showStatus(
        "请先在左侧正文中确认或取消当前修改",
        "warning",
      );
      return;
    }
    if (activeTabReadOnly) {
      showStatus("未来格式信笺为只读，不能直接应用", "warning");
      return;
    }
    if (manualFallbackAiBlockIndexes.includes(blockIndex)) {
      beginManualAiApply(block, blockIndex, blocks);
      return;
    }
    aiApplyInFlightRef.current = true;
    setApplyingAiBlockIndex(blockIndex);
    try {
      const manifest = buildManifest(editor.state.doc);
      const optimizationContext = buildOptimizationContext(
        blocks,
        blockIndex,
      );
      const resolved = await resolveDirectApply({
        resolver: aiBridge.resolveAiApply,
        manifest,
        selectedAiBlock: block,
        optimizationContext,
        getCurrentDocument: () => editor.state.doc,
      });
      if (resolved.unresolved) {
        beginManualAiApply(
          block,
          blockIndex,
          blocks,
          "未能可靠定位，请选择原文位置",
        );
        return;
      }
      if (!resolved.ok) {
        beginManualAiApply(
          block,
          blockIndex,
          blocks,
          "未能可靠定位，请选择原文位置",
        );
        return;
      }
      const staged = stageAiApplyPreview(
        resolved,
        { block, blockIndex, blocks },
      );
      if (!staged.ok) {
        beginManualAiApply(
          block,
          blockIndex,
          blocks,
          "目标位置发生变化，请重新选择原文位置",
        );
      } else {
        showStatus(
          "已在正文中显示修改对比，请确认应用或取消",
          "success",
        );
      }
    } catch {
      beginManualAiApply(
        block,
        blockIndex,
        blocks,
        "定位模型暂时不可用，已切换为手动选择位置",
      );
    } finally {
      aiApplyInFlightRef.current = false;
      setApplyingAiBlockIndex(-1);
    }
  };

  const handleManualAiApplyTarget = async (targetBlockId) => {
    if (!editor || !manualAiApply || activeTabReadOnly) return;
    const manifest = buildManifest(editor.state.doc);
    const target = manifest.blocks.find(
      (block) => block.id === targetBlockId,
    );
    if (!target || target.protected) {
      showStatus(
        "定稿区或受保护结构不能作为应用位置",
        "warning",
      );
      return;
    }
    const actions = ["replace", "insert_before", "insert_after"];
    const operations = Object.fromEntries(
      actions.map((action) => [
        action,
        createManualOperation(
          manifest,
          target.id,
          action,
          manualAiApply.block,
        ),
      ]),
    );
    if (
      actions.some(
        (action) => (
          !operations[action]?.ok
          || !operations[action]?.operation
        ),
      )
    ) {
      showStatus(
        "这个优化块暂时不能应用，请复制后手动粘贴",
        "warning",
      );
      setManualAiApply(null);
      return;
    }
    const currentDocument = getActiveDocumentSnapshot()?.document;
    const comments = getComments(editor, currentDocument?.comments);
    const commentCount = (action) => (
      findOverlappingComments(
        operations[action]?.operation,
        comments,
      ).length
    );
    const choice = await showConfirmDialog({
      tone: "default",
      icon: Check,
      eyebrow: "选择应用方式",
      title: "应用到这个原文位置",
      message: `目标：${summarizeTarget(
        operations.replace.operation,
        manifest,
      )}`,
      detail: "选择后会先在正文中显示红蓝对比；括号内会提示可能受影响的评注数量。",
      actions: [
        {
          value: "replace",
          label: `替换此处${commentCount("replace")
            ? `（${commentCount("replace")} 条评注）`
            : ""}`,
          variant: "primary",
          autoFocus: true,
        },
        {
          value: "insert_before",
          label: `插入到前面${commentCount("insert_before")
            ? `（${commentCount("insert_before")} 条评注）`
            : ""}`,
        },
        {
          value: "insert_after",
          label: `插入到后面${commentCount("insert_after")
            ? `（${commentCount("insert_after")} 条评注）`
            : ""}`,
        },
        { value: "cancel", label: "取消" },
      ],
      cancelValue: "cancel",
    });
    setManualAiApply(null);
    if (!actions.includes(choice)) return;
    const staged = stageAiApplyPreview(
      operations[choice],
      manualAiApply,
    );
    if (staged.ok) {
      showStatus(
        "已在正文中显示修改对比，请确认应用或取消",
        "success",
      );
    } else {
      showStatus("所选位置已经变化，请重新选择", "warning");
    }
  };

  return {
    handleApplyAiBlock,
    handleManualAiApplyTarget,
  };
}

export function useAiApplyResolutionActions(options) {
  return useMemo(
    () => createAiApplyResolutionActions(options),
    [
      options.activeTabReadOnly,
      options.aiApplyInFlightRef,
      options.aiApplyPreview,
      options.aiBridge,
      options.aiStatus,
      options.applyingAiBlockIndex,
      options.beginManualAiApply,
      options.buildManifest,
      options.buildOptimizationContext,
      options.createManualOperation,
      options.editor,
      options.findOverlappingComments,
      options.getActiveDocumentSnapshot,
      options.getComments,
      options.manualAiApply,
      options.manualFallbackAiBlockIndexes,
      options.resolveDirectApply,
      options.setApplyingAiBlockIndex,
      options.setManualAiApply,
      options.showConfirmDialog,
      options.showStatus,
      options.stageAiApplyPreview,
      options.summarizeTarget,
    ],
  );
}
