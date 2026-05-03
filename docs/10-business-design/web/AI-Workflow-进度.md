# AI Workflow 实施进度

> 更新日期：2026-04-13

## 已完成

### Phase 1：场景 A — 标注模式 ✅

用户选中 Note 内容 → 问 AI → 回复写入 Thought。

| 组件 | 状态 | 文件 |
|------|------|------|
| AI Service Profile | ✅ | `src/shared/types/ai-service-types.ts` |
| 后台 AI WebView | ✅ | `src/main/ai/background-ai-webview.ts` |
| SSE 拦截（三服务） | ✅ | `src/shared/ai/sse-capture-script.ts` + `src/main/ai/sse-capture-manager.ts` |
| 内容发送 | ✅ | `src/main/ai/content-sender.ts` |
| Markdown 解析（976 行） | ✅ | `src/main/ai/result-parser.ts` |
| ExtractedBlock → Atom | ✅ | `src/main/ai/content-to-atoms.ts` |
| PM Nodes 构造 | ✅ | `src/plugins/note/ai-workflow/blocks-to-pm-nodes.ts` |
| FloatingToolbar 问 AI | ✅ | `src/plugins/note/components/FloatingToolbar.tsx` (AskAIPanel) |
| HandleMenu Ask AI | ✅ | `src/plugins/note/components/HandleMenu.tsx` |
| Thought 协议扩展 | ✅ | `src/plugins/thought/thought-protocol.ts` (AI_RESPONSE_READY/ERROR) |
| ThoughtCard AI 变体 | ✅ | `src/plugins/thought/components/ThoughtCard.tsx` |
| AI WebView 变体 | ✅ | `src/plugins/web/components/AIWebView.tsx` |
| Right Slot 缓存池 | ✅ | `src/main/window/shell.ts` (切换不销毁) |
| SlotToggle AI/Thought | ✅ | `src/shared/components/SlotToggle.tsx` |

### Phase 2：场景 C — 浏览同步模式 ✅

用户在 AI Web 聊天，右侧 Note 实时同步。

| 组件 | 状态 | 文件 |
|------|------|------|
| ai-sync WorkMode | ✅ | `src/main/app.ts` |
| NavSide AI 面板 | ✅ | `src/plugins/web/navside/AIServicesPanel.tsx` |
| 同步引擎（SSE 轮询） | ✅ | `src/plugins/web/components/AIWebView.tsx` (sync engine) |
| 用户消息捕获 | ✅ | `src/shared/ai/user-message-capture.ts` |
| SyncNote 接收（callout+toggle） | ✅ | `src/plugins/note/ai-workflow/sync-note-receiver.ts` |
| NoteEditor 消息监听 | ✅ | `src/plugins/note/components/NoteEditor.tsx` |
| 同步暂停/恢复 | ✅ | AIWebView toolbar |

### 提取能力 ✅

| 内容类型 | SSE | DOM | Copy | 状态 |
|---------|-----|-----|------|------|
| 文字/段落/标题 | ✅ | ✅ | ✅ | 完成 |
| 数学公式 $$/$$ | ✅ | ✅ | ✅ | 完成 |
| 代码块 | ✅ | ✅ | ✅ | 完成 |
| 表格 | ✅ | ✅ | ✅ | 完成 |
| 列表 | ✅ | ✅ | ✅ | 完成 |
| 分隔线 | ✅ | ✅ | ✅ | 完成 |
| 链接/加粗/斜体 | ✅ | ✅ | ✅ | 完成 |
| 搜索结果图片 | ❌ | ✅ | ❌ | 完成 |
| Artifact SVG/图表 | ❌ | ❌ | ❌ | 已知限制 |
| Artifact 代码附件 | ✅* | ❌ | ✅ | SSE 有代码文本 |

## 下一步

### 优化方向（已讨论确认）

分阶段提取策略：
1. **SSE 实时同步**（阶段 1）：流结束后立即同步到 Note — 已实现
2. **DOM 图片补充**（阶段 2）：同步后延迟提取 DOM 中的图片，补充到 Note 对应位置 — 待实现
3. **Copy 附件/SVG**（阶段 3）：获取 Artifact 代码和 SVG — 待实现（需要 attachment block）

### 待实现功能

- [ ] DOM 图片延迟补充到已同步的 Note 内容中
- [ ] Note attachment block（文件附件能力）
- [ ] SVG 内联渲染 block
- [ ] Claude Artifact iframe 内容提取（独立渲染进程，技术挑战大）
- [ ] Phase 3：场景 B — 对话模式（ChatNote + ChatInputBar）
- [ ] Phase 4：eBook 集成 + 知识图谱
