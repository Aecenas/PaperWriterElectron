# 笺间内置知识库

这里是随应用版本发布的离线知识源，不从网络下载或热更新。

- `user-help-topics.json`：面向用户的帮助主题，是帮助中心标题、步骤、注意事项和截图映射的唯一来源。
- `ai-assistant-details.md`：依据代码与测试核对的补充知识；产品概览作为每次请求的最小常驻上下文，其余段落按问题检索作为 RAG 证据。
- `runtime-index.generated.json`：供 Electron 主进程检索的生成索引。
- `../frontend/src/app-shell/help-topics.generated.js`：供帮助中心使用的生成数据。

修改任一知识源后，在仓库根目录运行：

```powershell
node apps/writer/knowledge/build-knowledge.cjs
node apps/writer/knowledge/build-knowledge.cjs --check
```

校验会检查知识 ID、帮助主题关联、适用版本、维护引用、敏感信息以及两个生成物是否陈旧。维护用源码引用只参与构建校验，不会进入模型提示。
