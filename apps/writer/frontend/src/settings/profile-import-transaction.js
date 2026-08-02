function errorMessage(error) {
  return String(error?.message || error || "未知错误");
}

async function settleRollbackSteps(steps) {
  const failures = [];
  for (const step of steps) {
    if (typeof step.run !== "function") continue;
    try {
      await step.run();
    } catch (error) {
      failures.push(`${step.label}：${errorMessage(error)}`);
    }
  }
  return failures;
}

export async function applyPreparedProfileImport({
  bridge,
  prepared,
  sections = {},
  previousPreferences = {},
  previousTemplates = {},
  onApplyPreferences,
  onApplyTemplates,
}) {
  const transactionToken = String(
    prepared?.transactionToken || "",
  );
  if (!prepared?.ok || !transactionToken) {
    throw new Error("主进程未能准备配置导入事务");
  }
  let preferencesAttempted = false;
  let templatesAttempted = false;
  try {
    if (
      typeof bridge?.commitProfileImport !== "function"
      || typeof bridge?.rollbackProfileImport !== "function"
    ) {
      throw new Error("当前应用版本不支持事务化配置导入");
    }
    if (
      sections.preferences
      && typeof onApplyPreferences === "function"
    ) {
      preferencesAttempted = true;
      await onApplyPreferences(prepared.preferences);
    }
    if (
      sections.templates
      && typeof onApplyTemplates === "function"
    ) {
      templatesAttempted = true;
      await onApplyTemplates(prepared.templates);
    }
    const committed = await bridge.commitProfileImport({
      transactionToken,
    });
    if (!committed?.ok || committed.committed !== true) {
      throw new Error("主进程未确认配置导入事务");
    }
    return {
      ...prepared,
      ...committed,
      transactionToken,
    };
  } catch (error) {
    const rollbackFailures = await settleRollbackSteps([
      {
        label: "主进程配置回滚",
        run: typeof bridge?.rollbackProfileImport === "function"
          ? () => bridge.rollbackProfileImport({
            transactionToken,
          })
          : null,
      },
      {
        label: "模板回滚",
        run: templatesAttempted && typeof onApplyTemplates === "function"
          ? () => onApplyTemplates(previousTemplates)
          : null,
      },
      {
        label: "偏好设置回滚",
        run: preferencesAttempted
          && typeof onApplyPreferences === "function"
          ? () => onApplyPreferences(previousPreferences)
          : null,
      },
    ]);
    if (rollbackFailures.length) {
      const rollbackError = new Error(
        `${errorMessage(error)}；${rollbackFailures.join("；")}`,
      );
      rollbackError.cause = error;
      throw rollbackError;
    }
    throw error;
  }
}

export default applyPreparedProfileImport;
