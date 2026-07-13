# 笺间

<p align="center">
  <img src="apps/writer/electron/assets/app-icon.png" width="128" alt="笺间应用图标">
</p>

> 让文字有一处安静落脚的地方。

笺间是一款面向个人长期写作与内容整理的 Windows 桌面应用。它把纸张般的沉浸排版、可靠的本地文件组织和适度的 AI 协作放在同一个工作台里，让长文、日记、复盘与资料整理不必散落在多个工具之间。

笺间并不试图成为一套庞大的办公软件，也不是把对话框包装成编辑器的“AI 写作器”。它首先是一张安静、温暖、可以长期使用的私人写作桌：文字属于使用者，文件可以独立携带，AI 只在需要时参与润色、审阅和讨论。

## 产品定位

### 为谁设计

- 持续写长文、随笔、日记或阶段复盘的个人写作者。
- 需要一边阅读资料、一边整理和改写内容的学习者与研究者。
- 看重本地文件、独立文档和长期可控性的用户。
- 喜欢纸张质感与克制界面，但仍需要现代编辑能力和 AI 辅助的人。

### 核心价值

- **沉浸写作**：以信纸式页面、舒适排版和低干扰界面承载长时间书写。
- **有序沉淀**：通过文件树、大纲、标签页和左右分屏，把写作与资料整理放在同一条工作流中。
- **本地可控**：使用可独立携带的 `.letterpaper` 文档保存正文、素材、排版和相关状态。
- **适度智能**：AI 用于优化表达、审阅文章和围绕当前内容问答，但不替代作者的判断与声音。

### 设计原则

1. 写作优先于功能展示，正文始终是界面的中心。
2. AI 是可选的协作者，不是产品入口和内容主人。
3. 文件和内容应当可保存、可迁移、可恢复。
4. 视觉氛围可以丰富，但操作反馈必须清楚、克制且可靠。

当前版本：`0.9.2`

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

## 日常启动与本地开发

日常写作使用生产构建，避免 Vite/HMR 的开发期开销。双击 `scripts\PaperWriter.cmd`，或运行：

```powershell
.\scripts\Launch-PaperWriter.ps1
```

脚本会验证 npm 依赖与锁文件，并在前端构建缺失、资源不完整或早于源码、Vite 配置及包清单时自动重新构建；其余启动直接加载 `dist`。启动后还会短暂检查 Electron 是否保持运行，以便尽早报告启动失败。

生产入口不会结束正在编辑的 Electron，也不会处理占用开发端口的其他进程。若笺间已经运行，再次启动只会唤起现有窗口；单实例锁负责阻止两个进程同时写同一份文档。

通过启动脚本运行时无需预先手动安装依赖；脚本会根据两个 `package-lock.json` 检查并在需要时执行确定性的 `npm ci`。若选择手动开发，可先分别恢复前端和 Electron 依赖：

```powershell
cd apps\writer\frontend
npm ci

cd ..\electron
npm ci
```

开发时建议打开两个终端：

```powershell
cd apps\writer\frontend
npm run dev
```

```powershell
cd apps\writer\electron
npm run dev:vite
```

需要热更新和开发日志时，使用显式开发入口：

```powershell
.\scripts\Launch-PaperWriter.ps1 -Dev
# 或双击 scripts\PaperWriter-Dev.cmd
```

开发入口会清理上一轮由本项目启动的 Vite/Electron 进程，但只有可执行文件和完整命令行都匹配当前仓库时才会结束进程。如果 `5174` 被其他程序占用，脚本会报出 PID 并停止启动，不会强制结束该程序。生产实例正在运行时，请先在应用内正常退出，再启动开发模式。

不启动或停止任何进程、只检查生产依赖与构建完整性：

```powershell
.\scripts\Launch-PaperWriter.ps1 -CheckOnly
```

启动器静态检查，以及包含依赖/构建检查的 smoke test：

```powershell
.\scripts\Test-Launch-PaperWriter.ps1
.\scripts\Test-Launch-PaperWriter.ps1 -Smoke
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

## 品牌与兼容性

项目现已由“信笺写作”更名为“笺间”。为避免已有用户丢失设置、自动保存记录或更新关联，当前仍保留 `paperwriter.*` 本地存储键、`PaperWriter` 数据目录、应用 ID、GitHub 仓库名以及 `.letterpaper` 文档扩展名；这些属于内部兼容标识，不影响对外产品名称。

## 许可证

当前仓库尚未声明开源许可证。发布公开版本前请根据实际授权策略补充 `LICENSE` 文件。
