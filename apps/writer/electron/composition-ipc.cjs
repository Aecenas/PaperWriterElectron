const {
  assertBoundedIpcObject,
  assertBoundedIpcPayload,
} = require("./ipc-payload-limits.cjs");

function registerCompositionIpcHandlers({
  ipcMain,
  compositionFacade,
}) {
  const boundedPayload = (payload, label) => assertBoundedIpcObject(payload, {
    label,
    maxBytes: 64 * 1024 * 1024,
    maxNodes: 250_000,
    maxDepth: 32,
    maxArrayLength: 5_000,
    maxObjectKeys: 10_000,
  });
  const boundedJobId = (jobId, label) => {
    assertBoundedIpcPayload(jobId, {
      label,
      maxBytes: 512,
      maxNodes: 2,
      maxDepth: 1,
      maxArrayLength: 1,
      maxObjectKeys: 1,
    });
    if (typeof jobId !== "string") throw new Error(`${label}无效`);
    return jobId;
  };

  ipcMain.handle("composition:list", () => compositionFacade.list());
  ipcMain.handle("composition:get", (_event, jobId) => compositionFacade.get(
    boundedJobId(jobId, "AI 起稿任务 ID"),
  ));
  ipcMain.handle("composition:create", (_event, payload = {}) => compositionFacade.create(
    boundedPayload(payload, "AI 起稿创建参数"),
  ));
  ipcMain.handle("composition:update", (_event, payload = {}) => compositionFacade.update(
    boundedPayload(payload, "AI 起稿更新参数"),
  ));
  ipcMain.handle("composition:delete", (_event, jobId) => compositionFacade.delete(
    boundedJobId(jobId, "AI 起稿任务 ID"),
  ));
  ipcMain.handle("composition:generate-outline", (event, payload = {}) => (
    compositionFacade.generateOutline(event.sender, boundedPayload(payload, "AI 大纲生成参数"))
  ));
  ipcMain.handle("composition:generate-section", (event, payload = {}) => (
    compositionFacade.generateSection(event.sender, boundedPayload(payload, "AI 章节生成参数"))
  ));
  ipcMain.handle("composition:review", (event, payload = {}) => (
    compositionFacade.review(event.sender, boundedPayload(payload, "AI 审阅参数"))
  ));
  ipcMain.handle("composition:pause", (_event, jobId) => compositionFacade.pause(
    boundedJobId(jobId, "AI 起稿任务 ID"),
  ));
  ipcMain.handle("composition:resume", (event, payload = {}) => (
    compositionFacade.resume(event.sender, boundedPayload(payload, "AI 起稿恢复参数"))
  ));
  ipcMain.handle("composition:cancel", (_event, jobId) => compositionFacade.cancel(
    boundedJobId(jobId, "AI 起稿任务 ID"),
  ));
  ipcMain.handle("composition:finalize", (event, payload = {}) => (
    compositionFacade.finalize(event.sender, boundedPayload(payload, "AI 起稿落稿参数"))
  ));
}

module.exports = {
  registerCompositionIpcHandlers,
};
