export const RELEASE_PHASE_DEFINITIONS = [
  { id: "research-workspace", title: "研究写作与双编辑组" },
  { id: "intelligent-collaboration", title: "智能协作与安全底座" },
  { id: "writing-workbench", title: "写作工作台成型" },
  { id: "writing-foundation", title: "基础写作与导出" },
];

export const RELEASE_NOTES = [
  {
    version: "0.9.9",
    phaseId: "research-workspace",
    scale: "minor",
    date: "2026-07-19",
    title: "剪贴板与分屏交互修复",
    changes: [
      "修复从正文复制普通文字后，粘贴时被误识别为网页链接的问题；自动链接仅在内容具有明确网址前缀时触发。",
      "AI 优化结果改由桌面端原生剪贴板复制，修复点击复制按钮时提示没有写入权限的问题。",
      "图片尺寸菜单的小、中、大、满选项改为居中显示，统一弹出菜单的视觉对齐。",
      "修复分屏模式下导航栏右侧功能下拉框被标签栏遮挡的问题。",
    ],
  },
  {
    version: "0.9.8",
    phaseId: "research-workspace",
    scale: "major",
    date: "2026-07-19",
    title: "研究写作工作台全面升级",
    changes: [
      "新增顶部搜索入口、Ctrl+F 当前信笺搜索和 Ctrl+P 当前文件夹递归全文搜索，支持未保存正文覆盖与结果定位。",
      "F11 进入真正全屏沉浸模式，顶部 6px 热区可唤出导航栏，Esc 按界面层级关闭并恢复原布局。",
      "保存引入 size、mtime 与 SHA-256 revision 校验；恢复缓存与工作区写回分层执行，外部冲突保留磁盘版本并生成本机副本。",
      "新增 Markdown、HTML、TXT、DOCX 导入，以及 PDF、分页图片、DOCX、Markdown、HTML、TXT 导出；相对资源与侧车目录均经过安全检查。",
      "AI 优化新增安全的“直接应用”：独立裁决链路校验块范围、定稿线、保护内容、评注与文档版本，定位失败时可手动点选原文并保持一次撤销。",
      "新增独立资料区，支持链接文件、托管副本和网页来源；资料身份可随目录同步，本机绝对路径不会写入同步数据。",
      "新增自由文本脚注、结构化文献引用、动态编号与自动参考文献，并支持关联笺记的反向链接、失效重联和重复身份检测。",
      "信笺格式升级到 schema v2：旧文档按需迁移并保留备份，未知未来格式以只读方式安全打开。",
      "写作区升级为左右两个独立编辑组，支持标签压缩、横向滚动、组内排序、跨组移动及双组布局与阅读状态恢复。",
      "文档分屏、网页与资料阅读统一进入右侧阅读位；网页使用沙箱视图，PDF 提供紧凑工具栏、搜索、缩放、键盘翻页和阅读位置记忆。",
      "左栏重组为文件、资料、结构三个入口；关联笺记、脚注、引用和参考文献统一从“元素”菜单插入，结构页专注于查看与管理。",
      "研究资料继续与所有 AI 请求严格隔离；同时加固资料库迁移、网页权限、危险文件处理和会话恢复兼容性。",
    ],
  },
  {
    version: "0.9.2",
    phaseId: "intelligent-collaboration",
    scale: "major",
    date: "2026-07-14",
    title: "更快、更稳、更安全的写作底座",
    changes: [
      "修复 5000+ 字、多图文档连续输入卡顿，改由编辑器派生状态增量提供统计、大纲、目录与分页状态。",
      "图片改用无损暂存资源协议，保留 GIF、透明度和原始字节，并增加 SHA-256 完整性校验。",
      "修复自动保存、另存为、多标签关闭、恢复文件清理及文件移动、删除之间的竞态。",
      "加固 Electron IPC、文件系统、CSP、ASAR、AI 密钥存储与 Codex CLI 隔离。",
      "日常启动默认加载生产构建，开发热更新迁移到独立入口。",
    ],
  },
  {
    version: "0.9.1",
    phaseId: "intelligent-collaboration",
    scale: "minor",
    date: "2026-07-12",
    title: "AI 供应商状态修复",
    changes: [
      "修复供应商连接测试成功后，设置页立即重新显示“未连接”的问题。",
      "加固 Codex CLI 状态刷新，避免覆盖同时完成的其他供应商配置。",
      "刷新 Codex 模型目录时保留用户最新保存的推理强度。",
    ],
  },
  {
    version: "0.9.0",
    phaseId: "intelligent-collaboration",
    scale: "major",
    date: "2026-07-12",
    title: "工作区与 AI 能力全面升级",
    changes: [
      "全面重构工作区、文件树、大纲、标签页和阅读位置恢复体验。",
      "完善标题编号、正文目录、链接、文档评注、图片标题、音视频、表格与导出。",
      "开放自定义 AI 供应商，支持多个 OpenAI 兼容或 Anthropic 原生接口。",
      "新增 Codex CLI 内置供应商、模型目录与逐模型推理强度。",
      "Codex 问答新增只读目录范围，以及信笺原图与仅标题模式。",
      "新增用户模板、模板分组、高级排版和新建信笺默认模板。",
      "帮助中心扩展为 17 个主题，并更新品牌资源、信纸素材和界面视觉。",
    ],
  },
  {
    version: "0.8.2",
    phaseId: "writing-workbench",
    scale: "minor",
    date: "2026-07-05",
    title: "光标与阅读位置修复",
    changes: [
      "修复带编号一级标题末尾右侧无法直接点击放置光标的问题。",
      "修复多个信笺标签页切换后不会回到各自上次阅读位置的问题。",
    ],
  },
  {
    version: "0.8.1",
    phaseId: "writing-workbench",
    scale: "minor",
    date: "2026-07-05",
    title: "交互细节与目录体验优化",
    changes: [
      "文件树的新建、重命名和删除改为应用内弹窗。",
      "文件夹双击进入增加识别上限，避免间隔较久的两次单击误触发。",
      "更新检查结果短暂停留后会自动回到可检查状态。",
      "正文目录增加层级化视觉样式，并换用居中的透明签名图。",
    ],
  },
  {
    version: "0.8.0",
    phaseId: "writing-workbench",
    scale: "major",
    date: "2026-07-04",
    title: "写作工作台体验升级",
    changes: [
      "重做帮助中心与项目文档。",
      "完善 AI 优化与 AI 问答的按信笺独立记录。",
      "支持普通模式左右分屏、标签拥挤处理和打开队列。",
      "完善表格编辑、选中文字悬浮条、缓存与更新状态栏。",
      "改进关闭保存确认、恢复打开信笺和多处界面细节。",
    ],
  },
  {
    version: "0.2.0",
    phaseId: "writing-foundation",
    scale: "major",
    date: "2026-07-01",
    title: "帮助、文件树与导出完善",
    changes: [
      "新增沉浸式帮助引导，可按界面区域查看功能说明。",
      "完善左侧文件树、图标、目录与底部状态信息。",
      "优化图片标题、引用来源、分页符与图片导出流程。",
      "修复文件树读取卡住、启动脚本重启不彻底和帮助引导遮挡正文等问题。",
    ],
  },
  {
    version: "0.1.7",
    phaseId: "writing-foundation",
    scale: "minor",
    date: "2026-06-30",
    title: "干净的图片导出",
    changes: [
      "图片导出只截取信纸本体，不再包含应用栏、状态栏和浮动工具条。",
      "导出前自动回到顶部并展开页面，导出后恢复侧栏和滚动位置。",
    ],
  },
  {
    version: "0.1.6",
    phaseId: "writing-foundation",
    scale: "major",
    date: "2026-06-30",
    title: "会话恢复与正文大纲",
    changes: [
      "记住上次打开的文件夹和真实信笺文件，不再默认恢复临时草稿。",
      "已保存的真实文件每分钟自动保存一次。",
      "左侧栏新增文件夹与目录模式，可按 H1、H2、H3 跳转。",
      "导出图片时按右侧栏收起后的信纸宽度计算。",
    ],
  },
  {
    version: "0.1.5",
    phaseId: "writing-foundation",
    scale: "minor",
    date: "2026-06-29",
    title: "图片标题换行优化",
    changes: [
      "放宽图片标题换行阈值；中短标题保持单行居中，长标题自然换行。",
    ],
  },
  {
    version: "0.1.4",
    phaseId: "writing-foundation",
    scale: "minor",
    date: "2026-06-29",
    title: "图片标题与滚动体验优化",
    changes: [
      "图片与标题作为整体居中，标题输入框按内容宽度自适应。",
      "编辑页面恢复细滚动条，长文可拖动滚动条快速定位。",
    ],
  },
  {
    version: "0.1.3",
    phaseId: "writing-foundation",
    scale: "minor",
    date: "2026-06-29",
    title: "更新流程与图片标题优化",
    changes: [
      "图片标题改为无边界自适应多行输入，避免长标题被截断。",
      "更新入口整合为单按钮，自动完成检查、下载与重启安装。",
    ],
  },
  {
    version: "0.1.2",
    phaseId: "writing-foundation",
    scale: "minor",
    date: "2026-06-29",
    title: "图片标题持久化与编号",
    changes: [
      "修复图片标题保存后重新打开丢失的问题。",
      "图片标题增加自动编号，插入或删除图片后会重新排序。",
    ],
  },
  {
    version: "0.1.1",
    phaseId: "writing-foundation",
    scale: "major",
    date: "2026-06-28",
    title: "手动分页与快捷保存",
    changes: [
      "新增连续写作中的手动分页符，图片导出可按分页符切分。",
      "新增 Ctrl+S 保存快捷键，并收紧正文元素间距。",
      "更新透明底羽毛笔图标。",
    ],
  },
  {
    version: "0.1.0",
    phaseId: "writing-foundation",
    scale: "major",
    date: "2026-06-28",
    title: "首个公开版本",
    changes: [
      "提供信纸写作、文件保存、PDF 与图片导出、信件模板、图片插入和 GitHub 更新检查。",
    ],
  },
];

export function buildReleasePhases(releases = RELEASE_NOTES) {
  return RELEASE_PHASE_DEFINITIONS.map((definition) => {
    const phaseReleases = releases.filter((release) => release.phaseId === definition.id);
    const latestRelease = phaseReleases[0];
    const oldestRelease = phaseReleases[phaseReleases.length - 1];
    const majorReleases = phaseReleases.filter((release) => release.scale === "major");
    return {
      ...definition,
      releases: phaseReleases,
      majorReleases,
      latestRelease,
      oldestRelease,
      majorCount: majorReleases.length,
      minorCount: phaseReleases.length - majorReleases.length,
      versionRange: oldestRelease && latestRelease ? `V${oldestRelease.version} — V${latestRelease.version}` : "",
    };
  });
}

export const RELEASE_PHASES = buildReleasePhases();

export const CURRENT_RELEASE_VERSION = RELEASE_NOTES[0].version;
