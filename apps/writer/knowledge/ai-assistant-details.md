# 笺间 AI精灵详尽知识

本文件面向 AI精灵，记录从当前代码与行为测试中核对出的用户可见规则。帮助中心负责简明步骤；这里补足限制、状态条件、故障恢复和数据边界。维护者修改对应功能时，应同步复核相关段落。

<!-- KNOWLEDGE
{"id":"product-overview","sinceVersion":"1.1.1","alwaysInclude":true,"keywords":["笺间","软件介绍","产品介绍","是什么","做什么","干嘛的","用途","写作软件","功能概览"],"helpTopicIds":["files-sidebar","editor-outline","research-library","ai-modes"],"sourceRefs":["apps/writer/electron/package.json","apps/writer/frontend/src/App.jsx","docs/features.md"]}
-->
## 笺间是什么与主要用途

笺间是一款面向 Windows 的本地优先写作软件，用于长文、日记、复盘、论文和资料整理。它以 `.letterpaper` 信笺文件和用户选择的本地工作区为核心，提供多标签与双编辑组、模板信纸、标题大纲、搜索、版本历史、恢复缓存、导入导出、脚注与文献、评注、表格、图片和公式等写作能力。独立资料区可阅读和检索 PDF、文档及网页来源，但不会自动把资料发送给 AI。软件还提供 AI 优化、完整信笺 AI 协作、AI 起稿、选区问答、资料翻译和“帮助 → AI精灵”等不同 AI 入口；每个入口只提交完成该任务所需的明确上下文。笺间不是在线云文档服务，核心信笺、配置和 AI精灵历史默认保存在本机，是否把任务上下文发送给模型取决于用户配置并主动使用的 AI 功能。

<!-- KNOWLEDGE
{"id":"workspace-files","sinceVersion":"1.1.1","keywords":["工作区","文件树","新建文件夹","重命名","移动","删除","打不开文件夹"],"helpTopicIds":["files-sidebar","tabs-groups"],"sourceRefs":["apps/writer/frontend/src/controllers/workspace-file-controller.js","apps/writer/electron/workspace-folder-ipc.cjs"]}
-->
## 工作区、文件树与文件操作

写作工作区是用户明确选择的本地文件夹，文件树只展示该目录及子目录中的受支持内容。新建、重命名、移动和删除都经过应用内校验与串行写入；目标失效、越出已授权目录、名称冲突或文件正在被其他操作占用时会停止并给出提示，不会把内容写到猜测的路径。关闭标签只关闭当前视图，不会删除磁盘文件；真正删除必须从文件树操作并确认。资料目录与写作工作区彼此独立，选择资料目录不会改变写作文件夹。

<!-- KNOWLEDGE
{"id":"tabs-layout","sinceVersion":"1.1.1","keywords":["标签页","右侧","分屏","双页","阅读位置","打开队列","标签上限"],"helpTopicIds":["tabs-groups","focus-mode"],"sourceRefs":["apps/writer/frontend/src/document-workspace/workspace-groups-controller.js","apps/writer/frontend/src/tab-persistence-state.js"]}
-->
## 标签页、双编辑组与视图状态

左右编辑组各自保存当前视图和标签顺序，信笺移动到另一组不会改变其文档身份。每个标签记录阅读位置，切换后恢复；资料标签也可以出现在右组，但不会因此进入信笺或 AI 上下文。右侧编辑组在专注模式等布局中可能暂时收起，恢复布局后仍按原状态显示。标签容量达到上限时，应用按打开队列选择可安全释放的标签；包含未保存修改的标签不会被无提示丢弃。

<!-- KNOWLEDGE
{"id":"save-recovery-history","sinceVersion":"1.1.1","keywords":["保存","自动保存","恢复缓存","未命名","历史版本","冲突","只读","未来格式"],"helpTopicIds":["save-recovery","document-history","status-cache-update"],"sourceRefs":["apps/writer/frontend/src/document-workspace/document-persistence-controller.js","apps/writer/frontend/src/document-workspace/document-session-controller.js","apps/writer/electron/document-storage-runtime.cjs"]}
-->
## 保存、恢复缓存、历史版本与冲突

手动保存会校验磁盘 revision，并通过临时文件和原子替换提交；保存期间若磁盘内容被外部修改，应用不会直接覆盖，而是要求用户处理冲突或保存副本。已保存信笺的恢复缓存用于意外退出恢复，不等同于正式文件；未命名但已有内容的信笺会保存为临时会话并在下次启动恢复。历史版本独立于撤销栈，恢复历史前会固定保留当前安全版本。格式版本高于当前应用支持范围的信笺只能只读打开，另存或编辑不会绕过该保护。

<!-- KNOWLEDGE
{"id":"import-export","sinceVersion":"1.1.1","keywords":["导入","导出","DOCX","Markdown","HTML","TXT","PDF","分页图片","媒体丢失","公式"],"helpTopicIds":["interchange","media-pagination","professional-content"],"sourceRefs":["apps/writer/electron/document-interchange.cjs","apps/writer/electron/export-runtime.cjs"]}
-->
## 导入、导出与格式降级

导入支持的文本或文档格式会转换为笺间结构，远程图片、越界路径、超大资源和无法安全解析的内容会被拒绝或以警告方式降级，不会在导入时自动下载互联网资源。导出 PDF 与分页图片按当前页面和分页符渲染，延续全文图片与 Mermaid 图编号；段落从上一页中部继续时不会在续页重复首行缩进。DOCX、Markdown、HTML 等能力较弱的格式会尽量保留可读内容，但代码、公式、Mermaid、评注或文献元数据可能采用静态图片、源码或普通文本降级。导出不会改变原信笺，失败时应检查目标目录权限、内容大小和专业内容渲染错误后重试。

<!-- KNOWLEDGE
{"id":"editor-content","sinceVersion":"1.1.1","keywords":["标题","大纲","目录","表格","图片","音频","视频","评注","书签","公式","Mermaid","撤销"],"helpTopicIds":["editor-outline","comments","media-pagination","table-edit","professional-content"],"sourceRefs":["apps/writer/frontend/src/editor/paper-nodes.jsx","apps/writer/frontend/src/professional-content"]}
-->
## 编辑器、评注与专业内容

标题层级同时影响大纲、目录和模板编号；切换模板只改变呈现，不改写正文节点。评注绑定具体文字范围并随编辑映射，范围失效或同一位置过密时会拒绝继续添加。图片、音频和视频作为信笺资源保存，图片标题与同文档图号引用会随增删更新；选中图片后可从悬浮工具调整宽度、复制图号引用或直接删除，引用不能跨信笺解析。表格操作要求光标位于表格中。代码、公式和 Mermaid 保存可编辑源码，预览失败不会清空源码；确认应用或普通编辑事务可通过撤销恢复，但关闭后不能依赖撤销栈代替历史版本。

<!-- KNOWLEDGE
{"id":"search-research","sinceVersion":"1.1.1","keywords":["搜索","文档搜索","文件夹搜索","资料搜索","PDF","网页","OCR","扫描版"],"helpTopicIds":["search","research-library","research-readers"],"sourceRefs":["apps/writer/electron/workspace-search.cjs","apps/writer/electron/research-library.cjs","apps/writer/frontend/src/research"]}
-->
## 搜索、资料库与阅读器

文档搜索只查当前信笺，文件夹搜索查当前写作工作区，资料搜索查已选择资料目录中可解析的本地文件及登记的网页来源。图片及不支持格式通常只能按名称或路径命中；扫描 PDF 没有文本层时需要用户先做 OCR。资料目录、网页索引和写作工作区分别管理，打开资料阅读不会自动复制、修改或发送资料内容。PDF 阅读器支持页码、搜索与缩放；网页来源使用隔离阅读视图，外部打开会交给系统浏览器。

<!-- KNOWLEDGE
{"id":"research-translation","sinceVersion":"1.1.5","keywords":["资料翻译","翻译当页","翻译当前内容","PDF翻译","文档翻译","取消翻译","扫描件","OCR","翻译缓存"],"helpTopicIds":["research-readers","ai-providers","ai-isolation"],"sourceRefs":["apps/writer/electron/research-translation-runtime.cjs","apps/writer/frontend/src/research/useResearchTranslation.js","apps/writer/frontend/src/research/PdfReader.jsx"]}
-->
## 资料翻译的范围、缓存与失败边界

资料阅读器可把 PDF 当前页或 DOCX、Markdown、TXT、LOG、CSV、TSV 当前预览中的可读文字临时翻译为简体中文。PDF 译文定位覆盖文本层，连续文档只替换可翻译文字节点；标题、列表、表格、图片、链接、公式、代码、页面尺寸和源文件保持不变。请求不发送路径、文件名、原始 HTML 或文件二进制；200,000 字符以内按最多 12,000 字符或 100 个块分批，任一批最终失败都不会应用部分译文。扫描版 PDF、图片、网页、未知格式和资料区信笺不支持，也不执行 OCR。完整成功结果只进入本次运行的内存 LRU 缓存；文字块、类型、页码或目标语言变化即形成新缓存项，退出应用后缓存清空。翻页、搜索跳页、切换或关闭资料会取消请求并隐藏译文；“取消翻译”立即恢复原预览。

<!-- KNOWLEDGE
{"id":"citations-writing-check","sinceVersion":"1.1.1","keywords":["脚注","文献","引用","参考文献","DOI","ISBN","拼写","白名单","用词规范"],"helpTopicIds":["footnotes-citations","writing-assistance"],"sourceRefs":["apps/writer/electron/citation-runtime.cjs","apps/writer/electron/writing-assistance-runtime.cjs"]}
-->
## 脚注、文献与本地写作检查

脚注、正文引用和自动参考文献按正文结构动态编号；文献条目分为当前信笺私域和所有信笺共享公域。DOI 或 ISBN 补全只发送用户填写的标识符，不发送正文或文献库。引用样式和语言按信笺保存。拼写、白名单和“原写法到推荐写法”规则在本机运行，关闭检查不会改动正文；替换操作由用户明确触发。白名单和用词规则存在数量及配置大小上限，达到上限时需要删除旧规则。

<!-- KNOWLEDGE
{"id":"templates-settings-update","sinceVersion":"1.1.1","keywords":["模板","信纸","字体","默认模板","设置","备份迁移","更新","版本号","缓存"],"helpTopicIds":["templates-gallery","template-editor","profile-migration","status-cache-update"],"sourceRefs":["apps/writer/frontend/src/templates/model.js","apps/writer/electron/profile-runtime.cjs","apps/writer/electron/update-runtime.cjs"]}
-->
## 模板、配置迁移与应用更新

系统模板只读，用户模板可编辑并分组；“我的模板”始终保留完整列表，删除其他分组只移除归类。新建默认模板失效时会回退到有效项。配置迁移包可以包含界面偏好、模板、AI 供应商配置和写作检查配置，但敏感密钥按既有安全规则处理；AI精灵问答历史不进入迁移包。更新由桌面端检查和下载，浏览器预览不能执行真实更新。清理编辑器缓存不会删除信笺文件、恢复缓存、模板或 AI精灵历史。

<!-- KNOWLEDGE
{"id":"ai-providers","sinceVersion":"1.1.5","keywords":["AI配置","Gemini","DeepSeek","Codex CLI","OpenAI兼容","Anthropic","API Key","测试模型","任务模型","AI精灵模型","资料翻译模型"],"helpTopicIds":["ai-providers","codex-cli"],"sourceRefs":["apps/writer/electron/ai-provider-core.cjs","apps/writer/electron/ai-config-runtime.cjs","apps/writer/electron/codex-cli-provider.cjs"]}
-->
## AI 供应商、模型测试与任务模型

Gemini、DeepSeek 和 Codex CLI 是内置供应商，自定义供应商可使用 OpenAI 兼容或 Anthropic 原生协议。HTTP 模型必须保存 API Key 并测试成功后才能使用；公开配置只返回遮罩信息。Codex CLI 复用本机安装与登录态，笺间不保存 Codex 登录凭据。选区问答、直接应用定位、资料翻译、AI 起稿和 AI精灵可各自指定任务模型，未指定时跟随默认模型；一旦显式指定，所选模型删除、测试失效或 Codex 不可用时会提示重新选择，不会静默换用其他模型。不同任务可保存独立请求参数，Codex CLI 不接受 HTTP 请求参数。

<!-- KNOWLEDGE
{"id":"ai-writing-modes","sinceVersion":"1.1.5","keywords":["AI优化","AI协作","AI问答","AI起稿","直接应用","待审阅修改","红蓝对比","定稿线","标记文字","停止生成","拆分信笺","合并信笺"],"helpTopicIds":["ai-modes","ai-compose","ai-optimize","ai-chat"],"sourceRefs":["apps/writer/frontend/src/controllers/ai-request-actions.js","apps/writer/frontend/src/controllers/ai-collaboration-actions.js","apps/writer/frontend/src/controllers/ai-apply-actions.js","apps/writer/frontend/src/ai-composition"]}
-->
## AI 优化、协作、起稿与直接应用

AI 优化以定稿线以上为背景、线以下为重点，结果与当前信笺绑定。直接应用先由定位任务判断替换或插入位置，再在正文显示红蓝对比；只有用户确认才会产生一次可撤销事务，定位不可靠时转为手动选择。完整 AI 协作保存当前信笺自己的消息、草稿、标记文字和待审阅方案：普通问题仍流式回答，明确的操作请求会直接进入方案生成；每项修改在正文蓝色卡片内接受、拒绝或编辑，右侧只汇总审阅进度，全部处理后才能提交。AI 起稿从简报和用户明确勾选的参考资料生成新的派生信笺，不覆盖来源信笺。停止生成会保留已经收到的可见内容，并防止已取消请求继续写入旧状态。

<!-- KNOWLEDGE
{"id":"help-assistant","sinceVersion":"1.1.5","keywords":["AI精灵","帮助精灵","帮助文档","软件怎么用","新建会话","来源跳转","知识库","RAG","历史上限"],"helpTopicIds":["ai-isolation","ai-providers","status-cache-update"],"sourceRefs":["apps/writer/electron/help-assistant-runtime.cjs","apps/writer/frontend/src/help-assistant/HelpAssistantDialog.jsx","apps/writer/knowledge/build-knowledge.cjs"]}
-->
## AI精灵的软件知识、会话与隐私

“帮助 → AI精灵”只回答笺间功能、操作、限制、故障恢复和隐私问题。每个问题都会交给当前可用的默认模型或显式 AI精灵任务模型；主进程附带产品概览，并从随版本发布的帮助主题和代码核对知识中检索最多 6 个相关知识块作为 RAG 证据。回答来源可跳转对应帮助主题。历史独立保存在用户数据目录，最多 50 个会话、每会话 200 条消息；单问题最多 8,000 字符，单回答最多 128,000 字符，总文件最多 32 MB，达到上限时明确要求用户处理而不静默删除。每次请求只包含当前问题、当前会话最近 20 条消息、检索知识、应用版本和模型状态，不包含信笺正文、路径、工作区、资料区、其他 AI 记录或其他 AI精灵会话。关闭或切换会话不会取消后台生成，停止后保留已收到部分；历史不进入 `.letterpaper`、恢复缓存或 `.jianprofile`。

<!-- KNOWLEDGE
{"id":"selection-ai","sinceVersion":"1.1.1","keywords":["问AI","选区问答","AI小精灵","冻结选区","多个会话","最小化","只读信笺"],"helpTopicIds":["selection-links","ai-isolation"],"sourceRefs":["apps/writer/frontend/src/controllers/selection-ai-controller.js","apps/writer/electron/ai-selection-generation-runtime.cjs"]}
-->
## 选区问答与选区 AI 小精灵

普通写作模式或只读信笺中选择文字后可以创建选区问答。请求只包含冻结选区、当前问题和该临时会话历史，不读取标题、其他正文、路径或资料。会话按信笺归属但只存在于本次运行，不写入信笺或恢复缓存；明确关闭会话、关闭所属信笺或退出应用会清理。最小化或按 Escape 会收起为信笺右下角的“选区 AI 小精灵”，后台生成继续。这个功能与“帮助 → AI精灵”的软件知识问答相互独立。

<!-- KNOWLEDGE
{"id":"ai-privacy","sinceVersion":"1.1.5","keywords":["隐私","读取范围","工作区","资料区","实际来源","只读工具","图片","发送什么","本地","AI精灵"],"helpTopicIds":["ai-isolation","ai-chat","ai-compose"],"sourceRefs":["apps/writer/electron/ai-generation-runtime.cjs","apps/writer/electron/ai-collaboration-runtime.cjs","apps/writer/electron/ai-selection-generation-runtime.cjs","apps/writer/frontend/src/controllers/ai-request-actions.js"]}
-->
## AI 数据范围与隐私边界

不同 AI 功能各自构造最小必要上下文。资料区不会因为打开在右侧就自动进入任何 AI 请求；AI 起稿只使用用户明确勾选的参考资料。AI 协作中的普通问答围绕当前信笺及其标记文字；操作代理只有工作区信笺搜索和读取两个只读工具，最多 4 轮、20 封，并在协作回复中列出实际来源。它只接收规范化相对路径，不能修改其他已有信笺，也不能删除、覆盖、移动或重命名文件。选区问答只使用冻结选区。AI精灵只使用当前软件版本、其任务模型状态、当前 AI精灵会话的近期消息和本地检索到的软件知识块；它不能读取正文、文件路径、资料、工作区、其他 AI 记录或其他 AI精灵会话。HTTP 供应商会接收上述最小上下文；Codex AI精灵在空临时目录、只读沙箱中运行。
