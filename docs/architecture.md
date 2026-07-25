# 渐进式模块化架构

本文面向维护者，说明当前模块边界和重构时必须保持的契约。此次拆分的目标是降低架构热点的维护成本，不改变产品行为，也不要求为了行数重写职责已经清晰的模块。

## 不变的公共契约

任何模块迁移都必须保持以下外部行为：

- UI、DOM 层级、ARIA 语义、文案、快捷键、焦点和事件时序不变。
- `.letterpaper` 文件格式、document schema、存储键、缓存目录和历史兼容标识不变。
- IPC channel、参数顺序与形状、返回结构和事件名称不变。
- `window.paperWriter` 继续是扁平 API；现有 preload 方法名不能因内部领域拆分而改变。

需要调整这些契约时，应将其作为独立产品或数据迁移处理，不能夹带在模块化重构中。

## 本次拆分结果

以下行数是本次重构完成时的快照，只用于说明热点已经收敛，不是新的硬性门槛：

| 组合根 | 拆分前 | 拆分后 |
| --- | ---: | ---: |
| `frontend/src/App.jsx` | 19,771 行 | 3,845 行 |
| `frontend/src/styles.css` | 13,485 行 | 7 行入口、7 个有序片段 |
| `electron/main.cjs` | 4,425 行 | 961 行 |
| `frontend/src/bridge.js` | 2,036 行 | 15 行 |

文件超过约 1,000 行仍然只是重新审查职责的信号。比如文档持久化控制器集中维护保存、恢复、冲突和关闭的一组高风险不变量，因此不应仅为降低行数再把这组事务拆散。

## 前端边界

`apps/writer/frontend/src/App.jsx` 是顶层组合根。当前可复用领域通过以下公共入口暴露：

- `ai/index.js`：AI 运行态、上下文、结果和工具栏。
- `ai-settings/index.js`：AI 配置界面及其模型。
- `editor/index.js`：TipTap 扩展、编辑命令、画布、工具栏和批注。
- `templates/index.js`：模板模型、存储和模板界面。
- `export/index.js`：导出对话框。

资料阅读器暂由 `SecondaryResearchPane.jsx` 作为外观入口，具体阅读器位于 `research/`。浏览器兼容实现位于 `browser-bridge/`，不依赖 React 组件。

`controllers/index.js` 汇总 AI 配置与请求、模板、导出、资料、知识引用、对话框、状态、更新等应用级 controller/hooks。文件工作区由 `controllers/workspace-file-controller.js` 统一管理文件夹导航、打开/导入、树操作、搜索、watch 和外部版本校验。

文档工作区的高风险状态位于 `document-workspace/`：

- `workspace-state.js`：文档、tab、分组和会话的 React state、同步 ref 与窄写入 port。
- `document-runtime-kernel.js`：每个 tab 的 dirty/revision、恢复 revision、保存队列和运行态释放。
- `editor-runtime.js`：编辑器序列化、工作区快照和右分屏 hydration。
- `workspace-groups-controller.js`：主/次分组、文档与资料视图的选择、移动、关闭和对账。
- `document-session-controller.js`：会话持久化、恢复、恢复缓存与文件夹恢复编排。
- `document-persistence-controller.js`：手动保存、Save As、冲突处理、单 tab/窗口关闭、恢复自动保存、工作区后台落盘和删除屏障。

文档持久化 controller 的运行时门闩由稳定的共享 runtime state 保存，不能因 React 重新组合 controller 而重置。close、恢复自动保存、后台落盘和 blur 订阅只挂载一次，再动态委派给最新 controller；这可避免模式或右分屏变化反复重启 30 秒定时器。

依赖方向应保持为：

```text
App / 顶层页面
  -> 领域 index 或领域外观
    -> 同领域组件与模型
      -> 无 UI 的共享叶子模块
        -> bridge
```

领域内部文件不应反向导入 `App.jsx`，调用方也不应绕过 `index.js` 依赖另一个领域的内部文件。确需跨领域复用的纯函数，应先下沉到职责明确的共享叶子模块，且保持依赖图无循环。

`App.jsx` 现在负责领域组合、编辑器实例、顶层布局、全局弹窗挂载和窄 adapter，不再直接实现文件工作区、会话或持久化事务。后续迁移仍应按完整不变量边界移动状态，而不是只搬 JSX。

## 浏览器桥

`bridge.js` 是 15 行的组合入口，由以下四个领域工厂组装浏览器回退实现：

- `createBrowserWindowApi`
- `createBrowserAiApi`
- `createBrowserDocumentWorkspaceApi`
- `createBrowserResearchApi`

`bridge` 在 Electron 中使用 `window.paperWriter`，在普通浏览器中使用 `browserBridge`。两种运行环境允许能力实现不同，但调用方看到的方法名和调用形状必须稳定。

`bridge-surface-contract.test.js` 固定浏览器桥的精确 120-key 表面；新增、删除或重命名方法时必须同步评估 Electron preload 契约，不能只修改组合入口。

## Electron 与 IPC

`main.cjs` 是 Electron 组合根，负责启动、依赖装配、应用生命周期、窗口和退出清理。IPC 统一通过 `ipc-registrar.cjs` 创建的可信 registrar 注册。该 registrar 会：

- 只接受当前主窗口 `webContents`。
- 拒绝子 frame。
- 校验调用页面 URL 是可信应用页面。
- 拒绝重复 IPC channel。

各领域 handler 由以下 registrar 注册：

- `application-ipc.cjs`
- `diagnostics-ipc.cjs`
- `research-web-view-ipc.cjs`
- `ai-config-ipc.cjs`
- `ai-generation-ipc.cjs`
- `workspace-folder-ipc.cjs`
- `document-open-ipc.cjs`
- `research-library-ipc.cjs`
- `workspace-research-ipc.cjs`
- `document-save-ipc.cjs`
- `document-output-ipc.cjs`
- `resource-ipc.cjs`
- `autosave-ipc.cjs`

领域 registrar 接收显式依赖并注册自己的 channel，不应直接创建窗口级全局状态，也不能绕过可信 registrar 调用原生 `electron.ipcMain.handle`。`main.cjs` 可继续拥有需要跨领域共享的生命周期状态，并通过 getter、setter、队列或服务显式注入。

有状态能力分别由 AI、文档存储与资源、导出、文件系统、资料和工作区 runtime 持有。`main.cjs` 只组合这些 runtime、registrar、窗口生命周期和退出清理；保存队列、watcher generation、AI request registry 等私有状态不能重新搬回组合根。

## Preload 生成流程

可维护源码位于 `apps/writer/electron/preload-src/`：

- `facade.cjs` 组合各领域 API。
- `ai-api.cjs`、`document-api.cjs`、`workspace-api.cjs`、`research-api.cjs`、`window-update-api.cjs` 定义命令方法。
- `subscriptions.cjs` 统一事件订阅与取消订阅。

`preload.cjs` 是由 `build-preload.cjs` 生成的 sandbox-compatible 单文件包，不能手工编辑。修改 `preload-src/` 后，在 Electron 目录运行：

```powershell
npm.cmd run preload:build
```

`preload-contract.test.cjs` 固定 `window.paperWriter` 的精确 117-key 表面，并检查每个 invoke 的 channel/参数、事件载荷/取消订阅以及生成包新鲜度。`npm.cmd run check` 也会拒绝过期的 `preload.cjs`。

## CSS 层叠

`styles.css` 是唯一的应用样式入口，仅按以下严格顺序导入七个片段：

1. `styles-foundation.css`
2. `styles-sidebar-templates.css`
3. `styles-workspace-dialogs.css`
4. `styles-editor-paper.css`
5. `styles-ai.css`
6. `styles-status-export-help.css`
7. `styles-output-responsive.css`

这七个文件的拼接结果必须与拆分前的层叠文本一致。`style-bundle-contract.test.js` 同时固定入口顺序和拼接内容的 SHA-256；移动选择器、改变片段顺序或在 `styles.css` 添加声明都可能改变 UI。合法的视觉变更应单独评审，并明确更新 hash 与截图基线。

## 不可破坏的不变量

高风险逻辑不能在“机械拆分”中被分散或简化：

- 文档 tabs、编辑器同步、dirty/revision、保存队列、自动保存、恢复和外部冲突属于同一文档工作区一致性边界。
- 保存必须保留预期 revision 校验、生成归档后的再次校验、提交前校验、原子替换和提交结果验证；冲突副本不能复用错误的文档身份。
- 工作区及资料写操作必须继续经过既有 mutation queue，避免并发写入覆盖。
- watcher 必须保留 generation/身份隔离，旧 watcher 或旧异步结果不能污染新工作区。
- AI 取消必须保留 request identity 与结算竞态保护；取消后不能继续发送旧 delta，也不能提前删除一个仍在结算的请求。
- 关闭流程必须保留 renderer 确认、`close-ready`/`close-canceled` 和不可用 renderer 的退出兜底。
- 文件访问能力、路径校验、schema 兼容检查、缓存及历史恢复语义不能因文件移动而放宽。

## 验证命令

在仓库根目录使用原生 PowerShell；Windows 下使用 `npm.cmd` 可避免脚本执行策略影响。

前端单元测试、生产构建和 E2E：

```powershell
Set-Location apps/writer/frontend
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```

Electron 语法、preload 新鲜度、契约和单元测试：

```powershell
Set-Location apps/writer/electron
npm.cmd run check
npm.cmd test
```

`check` 会递归检查 Electron 目录下所有 CJS 文件，因此新拆出的 `.cjs` 不需要再手工加入文件清单。

启动器静态检查和 prerequisites smoke：

```powershell
Set-Location <仓库根目录>
.\scripts\Test-Launch-PaperWriter.ps1
.\scripts\Test-Launch-PaperWriter.ps1 -Smoke
```

涉及布局、层叠、焦点或交互的改动，还应在固定窗口尺寸下对照重构前后截图，并覆盖打开/编辑/保存、自动保存恢复、外部冲突、双编辑组、导入导出、资料阅读、AI 启停与应用、关闭更新等关键流程。

本次完成时的验收基线为：

- 前端单元与静态安全测试 460/460。
- Electron 契约与单元测试 402/402，`check` 覆盖 102 个 CJS 文件。
- Playwright 关键流程 9/9。
- 生产构建、启动器静态检查和 production prerequisites smoke 通过。
- 在同一 Playwright/Chromium 环境下，对 `v0.9.11` 基线与当前构建比较默认页 1440×900、默认页 1280×720、AI 设置、导出和模板设置，五个状态均为 0 个变化像素。
- 构建 CSS 仍为 `index-Dwf9Qg8l.css`、308,533 字节，SHA-256 为 `0C12D3B5BEC525BE22ECB2696195106EB5060962AB75A959BF486E7CFB5F7A2E`。

## 新增领域的规则

1. 先定义职责边界和公共入口，再移动代码；不要以“低于某个行数”为拆分目标。
2. 新前端领域优先提供 `index.js`，调用方只依赖其公共导出；领域内部保持单向依赖。
3. 新 IPC 领域提供 `*-ipc.cjs` registrar，通过 `main.cjs` 显式注入依赖，并由可信 registrar 注册。
4. 新 preload 能力先加入对应 `preload-src/*-api.cjs`，再生成 `preload.cjs`，同时维护 117-key/120-key 两侧契约。
5. 新 CSS 仍从唯一入口进入；不得通过组件局部 import 隐式改变全局层叠顺序。
6. 测试优先验证模块行为、IPC/bridge 契约和安全不变量。不要把测试固定在 `App.jsx`、`main.cjs` 或旧 monolith 中的源码位置；只有明确的静态安全规则才应检查源码形态。
7. 每次迁移保持可回滚，并在继续下一个领域前跑完与风险相称的测试、构建和视觉验证。
