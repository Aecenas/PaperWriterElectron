# 发布与维护

本文档记录 `0.8.1` 版本的发布准备流程。

## 版本号位置

发布前需要保持以下文件版本一致：

- `apps/writer/frontend/package.json`
- `apps/writer/frontend/package-lock.json`
- `apps/writer/electron/package.json`
- `apps/writer/electron/package-lock.json`
- `README.md`

当前目标版本：`0.8.1`

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
4. 创建版本标签，例如 `v0.8.1`。
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
