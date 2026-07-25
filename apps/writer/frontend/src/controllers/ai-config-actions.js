import { useMemo } from "react";
import { bridge } from "../bridge.js";
import { normalizePublicAiConfig } from "../ai-settings/model.js";

export function createAiConfigActions({
  aiBridge = bridge,
  setAiConfig,
  showStatus,
}) {
  const handleSaveAiConfig = async (draft) => {
    const result = await aiBridge.saveAiConfig?.(draft);
    const normalized = normalizePublicAiConfig(result);
    setAiConfig(normalized);
    showStatus("AI 设置已保存", "success");
    return { ...normalized, ok: true, message: "AI 设置已保存" };
  };

  const handleCreateAiProvider = async (draft) => {
    const result = await aiBridge.createAiProvider?.(draft);
    const normalized = normalizePublicAiConfig(result);
    setAiConfig(normalized);
    showStatus("供应商已添加", "success");
    return {
      ...normalized,
      createdProvider: result?.createdProvider,
      ok: true,
      message: "供应商已添加",
    };
  };

  const handleDeleteAiProvider = async (providerId) => {
    const result = await aiBridge.deleteAiProvider?.(providerId);
    const normalized = normalizePublicAiConfig(result);
    setAiConfig(normalized);
    showStatus("供应商已删除", "success");
    return { ...normalized, ok: true, message: "供应商已删除" };
  };

  const handleTestAiConfig = async (draft) => {
    const result = await aiBridge.testAiConfig?.(draft);
    if (!result) {
      showStatus("AI 连接测试失败", "warning");
      return { ok: false, message: "AI 连接测试失败" };
    }
    const normalized = normalizePublicAiConfig(result);
    setAiConfig(normalized);
    const message = result.message || "AI 连接测试完成";
    showStatus(message, result.ok ? "success" : "warning");
    return { ...normalized, ok: Boolean(result.ok), message };
  };

  const handleClearAiConfig = async (draft) => {
    const result = await aiBridge.saveAiConfig?.({ ...draft, clearApiKey: true });
    const normalized = normalizePublicAiConfig(result);
    setAiConfig(normalized);
    showStatus("AI 密钥已清空", "success");
    return { ...normalized, ok: true, message: "AI 密钥已清空" };
  };

  const handleRefreshCodexCli = async () => {
    const result = await aiBridge.refreshCodexCliStatus?.();
    const normalized = normalizePublicAiConfig(result);
    setAiConfig(normalized);
    showStatus(
      result?.message || "Codex CLI 检查完成",
      result?.ok ? "success" : "warning",
    );
    return {
      ...normalized,
      ok: Boolean(result?.ok),
      message: result?.message || "Codex CLI 检查完成",
    };
  };

  const handleLoginCodexCli = async () => {
    const result = await aiBridge.startCodexCliLogin?.();
    if (result) setAiConfig(normalizePublicAiConfig(result));
    showStatus(
      result?.message || "已启动 Codex 登录",
      result?.ok ? "success" : "warning",
    );
    return result;
  };

  return {
    handleClearAiConfig,
    handleCreateAiProvider,
    handleDeleteAiProvider,
    handleLoginCodexCli,
    handleRefreshCodexCli,
    handleSaveAiConfig,
    handleTestAiConfig,
  };
}

export function useAiConfigActions(options) {
  return useMemo(
    () => createAiConfigActions(options),
    [options.setAiConfig, options.showStatus],
  );
}
