# 信笺写作

信笺写作是一款面向个人长文、日记、复盘和资料整理的 Windows 桌面写作软件。它以信纸式排版为核心，结合文件树、标签页、左右分屏、富文本编辑、AI 优化与 AI 问答，让写作、整理和复盘保持在同一个工作台内完成。

当前版本：`0.8.2`

## 主要特性

- **信笺文件格式**：使用 `.letterpaper` 保存正文、素材、排版、AI 记录和文档状态，文件可独立携带。
- **文件与组织**：支持文件树、右键新建/重命名/删除、正文大纲、多标签页、打开队列和未保存恢复。
- **写作编辑**：支持标题、目录、列表、引用、分页符、图片、表格、对齐、加粗、下划线与多种下划线样式。
- **AI 功能**：支持 AI 设置、AI 优化和 AI 问答；AI 记录按信笺独立保存，重新打开文件后可继续查看。
- **左右分屏**：普通写作模式下可将一个信笺向右分屏，便于对照阅读和改写。
- **状态与维护**：提供自动保存、缓存状态、缓存清理、更新检查和帮助中心。
- **导出能力**：支持将信笺导出为常用分享格式，便于归档或发布。

## 项目结构

```text
apps/
  writer/
    frontend/   React + Vite + TipTap 写作界面
    electron/   Electron 桌面壳、文件系统、导出、更新与发布配置
    release/    安装包输出目录
docs/           功能说明与发布维护文档
scripts/        Windows 启动脚本
```

## 本地开发

首次运行前分别安装前端和 Electron 依赖：

```powershell
cd apps\writer\frontend
npm install

cd ..\electron
npm install
```

开发时建议打开两个终端：

```powershell
cd apps\writer\frontend
npm run dev
```

```powershell
cd apps\writer\electron
npm run dev
```

也可以使用项目脚本启动：

```powershell
.\scripts\Launch-PaperWriter.ps1
```

## 构建与发布

发布前先构建前端，再打包 Electron：

```powershell
cd apps\writer\frontend
npm run build

cd ..\electron
npm run dist
```

安装包会输出到 `apps\release`。如需发布到 GitHub Release，配置好 GitHub 发布权限后执行：

```powershell
cd apps\writer\electron
npm run publish
```

更多发布步骤见 [docs/release.md](docs/release.md)。

## 文档

- [功能总览](docs/features.md)
- [AI 功能说明](docs/ai.md)
- [发布与维护](docs/release.md)

## 技术栈

- Electron
- React
- Vite
- TipTap
- lucide-react
- electron-builder
- electron-updater

## 许可证

当前仓库尚未声明开源许可证。发布公开版本前请根据实际授权策略补充 `LICENSE` 文件。
