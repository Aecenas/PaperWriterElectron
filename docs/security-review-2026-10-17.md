# 安全与稳定性排查（2026-10-17）

本轮基于当前工作区源码、实际安装依赖和隔离测试数据检查文件打开、IPC 与文件授权、文档保存/恢复/关闭、配置导入、外部网页和依赖安全。本次修复纳入 1.2.2。下面的结论是本轮检查结果，不代表完整渗透测试或不存在其他缺陷。

## 已确认并修复

| 优先级 | 问题 | 触发条件与影响 | 修复 |
| --- | --- | --- | --- |
| P1 | 配置导入跨来源沿用本机 API Key | 导入不带密钥的配置包，内置服务商的 API 地址发生改变，合并逻辑仍保留本机原有密钥。后续测试或使用服务时可能把旧密钥发送至新地址。导入预览没有明确告知这种凭证转移。 | 导入复用现有的来源校验逻辑；只有协议、主机和端口保持同源时才保留本机密钥。跨域、HTTPS 降为 HTTP、无效或空地址均清空本机密钥。用户通过加密配置包明确导入的密钥仍可使用。 |
| P1 | 冲突重载覆盖读盘期间的新编辑 | 保存产生冲突后选择重新载入；异步读取磁盘期间文档再次变化。原逻辑直接替换内存稿，而冲突副本只包含最初保存时的内容，后续修改可能丢失。 | 读盘前后校验捕获的编辑版本；发生新编辑时停止重载，保留当前稿和恢复缓存。读盘失败也会明确报告失败，不再显示已成功重载。 |
| P2 | “不保存”退出后恢复已放弃的草稿 | 已有磁盘路径的文档生成恢复缓存，再选择“不保存”退出。旧逻辑仅清理未命名文档，已有文档的恢复引用仍写入会话，导致下次启动重新恢复被放弃的修改。 | 清理所有被放弃文档的恢复缓存，并从保留的已保存文档会话中移除恢复引用。缓存删除失败也不会继续引用该缓存；原始磁盘文档保留。 |

实现位置：

- `apps/writer/electron/profile-runtime.cjs`：配置合并时的凭证来源检查。
- `apps/writer/frontend/src/document-workspace/document-persistence-controller.js`：冲突重载版本检查与放弃恢复缓存。
- `apps/writer/electron/profile-runtime.test.cjs`、`apps/writer/frontend/src/document-persistence-controller.test.js`：先复现原缺陷，再验证修复与原有正常行为。
- `apps/writer/frontend/tests/e2e/p1-interactions.spec.js`：通过实际界面选择“不保存”，检查下一次会话不再引用草稿。

上一次已修复的“跨文件夹双击无法打开”仍包含在工作区中，并通过桌面回归验证。

## 依赖处理

| 项目 | 原始扫描 | 修复后扫描 |
| --- | --- | --- |
| Electron 项目 | 4 high、11 moderate、0 critical | 0 high、8 moderate、0 critical；生产依赖无告警 |
| 前端项目 | 1 high、3 low、0 critical | 0 high、2 low、0 critical |

这些数量是 `npm audit` 标记的受影响包数量，包含间接依赖和开发依赖，并非独立且可利用的漏洞数量。

更新内容：Electron 41.10.4 → 41.10.7，DOMPurify 3.4.13 → 3.4.17，source-map-js 1.2.1 → 1.2.2；同时更新允许版本范围内的 brace-expansion、undici、fast-uri、http-cache-semantics，并提交对应锁文件变更。发布准备进一步将 Mammoth 的 argparse 依赖覆盖为兼容的 2.0.1，移除生产依赖中的 sprintf-js；重新生成锁文件并用干净安装验证，保留 DOCX 库接口与命令行兼容性。

Electron 的相关上游公告要求特定功能和配置才能触发。当前应用已经拒绝不可信弹窗、禁止 webview，并把外部网页放入独立 session，因此没有把版本告警直接认定为本应用可复现的任意代码执行漏洞。升级仍可消除旧运行时的已知风险。参见 [Electron 弹窗沙箱公告](https://github.com/electron/electron/security/advisories/GHSA-gr2m-v5gq-v685)、[协议处理器跨来源读取公告](https://github.com/electron/electron/security/advisories/GHSA-j84w-jfhq-vhvj)、[webview Worker 公告](https://github.com/electron/electron/security/advisories/GHSA-9qh4-3jw8-366w)。

本地验证使用官方 GitHub Release 的 Electron 41.10.7 二进制，安装前核对 npm 包附带的 SHA-256。

## 仍需跟踪的告警

- Electron 项目剩余 8 个 moderate 包告警均来自打包工具开发依赖中的同一个 sprintf-js 格式化精度导致拒绝服务的公告，不进入生产依赖。上游当前最新 1.1.3 仍在受影响范围内，需跟踪上游修复；未采用扫描器建议的破坏性降级。参见 [sprintf-js 公告](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)。
- 前端剩余 2 个 low 包告警来自 KaTeX 及其 Mermaid 依赖传播，属于同一个问题。上游说明需要另一个漏洞预先污染对象原型或控制渲染选项原型；本轮未找到这样的输入路径。应用也明确设置 `trust: false`。修复版本涉及当前 KaTeX/Mermaid 版本系列之外的升级，留待单独兼容验证，不能将这两项描述为已经修复。参见 [KaTeX 官方公告](https://github.com/KaTeX/KaTeX/security/advisories/GHSA-238p-pmpm-9mq7)。

## 验证结果

- Electron 全部单元测试：597 项通过（主批次 591 项，隔离 Worker 批次 6 项）。
- 前端全部单元测试：684 项通过。
- 完整界面回归：36 项通过，包含新增“不保存”退出用例。
- 生产前端构建、资源包体积检查、CommonJS 检查与 preload 一致性检查通过。
- 在 Electron 41.10.7 上通过真实单实例桌面验证：冷启动打开、跨文件夹双击、重复激活、未保存编辑保留、仅授权目标文件、旧版文档、会话恢复与关闭握手。

上述为源码排查阶段的验证记录。1.2.2 发版还需执行统一发布门禁、安装包验证、SBOM 与构建来源验证；公开发行状态以 GitHub Release 为准。
