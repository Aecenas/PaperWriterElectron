# 发布与维护

本文档记录 `0.9.0` 版本的发布准备流程。

## 版本号位置

发布前需要保持以下文件版本一致：

- `apps/writer/frontend/package.json`
- `apps/writer/frontend/package-lock.json`
- `apps/writer/electron/package.json`
- `apps/writer/electron/package-lock.json`
- `README.md`

当前目标版本：`0.9.0`

## 0.9.0 发布摘要

- 全面重构左侧工作区、文件树与大纲，补充文件拖动、应用内输入确认、标签阅读位置恢复和打开队列。
- 完善标题编号、正文目录、链接、文档评注、图片标题、音视频、表格、分页图片和 PDF 导出。
- 开放动态 AI 供应商，可添加多个 OpenAI 兼容或 Anthropic 原生接口，并完善模型测试、默认项保护与安全密钥展示。
- 新增 Codex CLI 内置供应商，复用本机登录态，支持模型目录、逐模型推理强度、AI 优化和 AI 问答。
- Codex 问答新增只读目录范围，以及信笺原图/仅标题模式；范围、图片模式和问答记录均按信笺保存。
- 新增用户模板、模板分组、字体排版、高级选项和新建信笺默认模板。
- 全面更新应用内帮助中心至 17 个主题和当前界面配图，并支持单击放大、再次单击缩回。
- 更新应用品牌资源、信纸素材、状态栏、缓存和版本更新反馈。

## 0.8.2 发布摘要

- 修复带编号一级标题末尾右侧无法直接点击放置光标的问题。
- 修复多个信笺标签页切换后不会回到各自上次阅读位置的问题。

## 0.8.1 发布摘要

- 左侧文件树的新建、重命名和删除流程改为应用内弹窗，删除确认不再使用系统原生确认框。
- 文件夹双击进入增加 300ms 识别上限，避免两次间隔较久的单击触发进入。
- 底部“检查更新”在已是最新、错误、开发版或浏览器预览状态后会自动回到可检查状态。
- 正文目录增加层级化视觉样式，并将“目录”标题替换为居中的透明签名图。

## 发布前检查

建议按以下顺序执行：

```powershell
cd apps\writer\frontend
npm run build
```

```powershell
cd apps\writer\electron
npm run check
```

如果需要本地生成安装包：

```powershell
cd apps\writer\electron
npm run dist
```

安装包输出到：

```text
apps\release
```

## GitHub Release 准备

1. 确认工作区只包含本次发布需要的改动。
2. 确认前端构建和 Electron 检查通过。
3. 提交代码。
4. 创建版本标签，例如 `v0.9.0`。
5. 使用 GitHub Release 发布安装包。

如使用 electron-builder 自动发布，需要配置 GitHub 发布权限，然后执行：

```powershell
cd apps\writer\electron
npm run publish
```

## 更新检查

应用内更新依赖 GitHub Release。发布新版本后，客户端会通过配置的 GitHub 仓库检查更新：

```json
{
  "provider": "github",
  "owner": "Aecenas",
  "repo": "PaperWriterElectron"
}
```

发布后建议安装旧版本并执行一次“检查更新”，确认更新状态和安装包下载链路正常。
