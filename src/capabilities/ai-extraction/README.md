# ai-extraction capability

> v0.2 · 改名自 ai-conversation (2026-05-19) · AI 网页对话抓取统一能力

## 职责

封装"从 Claude / ChatGPT / Gemini 三大 AI 网页**抓取整页对话**"的能力：

1. **askAI** — 发 prompt + 等完整 Markdown 回复（端到端单轮抓取）
2. **extractFull** — 多 turn + artifact + 图片整页提取（按钮主路径）
3. **Host 组件** — 嵌入 AI 网页 webview 的载体（AI View Host 使用）
4. **pending-thought 路由** — 跨 Note Ask AI ↔ 提取按钮 update 的 thoughtId 路由

## 写入决策权 — **本 capability 不写库**

**重要边界**：ai-extraction 只负责"抓取"，**不决定结果写入哪个 thought**。

- ✅ ai-extraction：抓取数据 + 返回 AIExtractFullResult / AIAskResult
- ✅ 调用方（如 ai-commands.ts:70 的 `ai-view.extract-conversation`）：决定调 thoughtUpdate 还是 thoughtCreate、anchor 怎么设
- ❌ ai-extraction 内部**不直接** import thought capability 写库

这条边界让 ai-extraction 保持"纯能力"性质，可被任意 view（note / ai-view / thought / 未来）复用，写入策略完全由消费方按业务决定。

## 横切定位

任何 view（note / ai-view / thought / future）都能 `install: ['ai-extraction']` 获得相同能力。与 thought capability 同性质（charter §1.4）。

## 业务方接入示例

```tsx
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { AIConversationApi, AIHostHandle } from '@capabilities/ai-extraction/types';

// 1. 抓取整页对话
const ai = requireCapabilityApi<AIConversationApi>('ai-extraction');
const result = await ai.extractFull('claude');
if (result.success) {
  // 调用方决定如何落库（这里调 thought capability）
  await thoughtCap.updateThought(thoughtId, { doc: aiMarkdownToNoteDoc(result.markdown) });
}

// 2. 嵌入 webview Host
const { Host } = ai;
<Host workspaceId={ws} serviceId="claude" ref={hostRef} />;
```

## 三段责任边界（系统级数据流）

```
┌──────────────────────────────────────────────────────────┐
│ AI View 命令层 (src/views/ai/ai-commands.ts)              │ 编排
│   commandRegistry.register('ai-view.extract-conversation') │ 决定 → 写哪个 thought
│   → ai.extractFull(serviceId)                             │
│   → thought.updateThought(pendingId, ...)                 │
└────────────────────┬─────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────┐
│ ai-extraction capability (本目录)                          │ 能力
│   index.ts: registerCapability                            │ 跨平台调度
│   types.ts: AIConversationApi 接口                        │
│   Host.tsx: AI 网页 webview                               │
│   pending-thought.ts: thoughtId 路由                      │
└────────────────────┬─────────────────────────────────────┘
                     │ IPC (electronAPI.aiAsk / aiExtractFull)
                     ▼
┌──────────────────────────────────────────────────────────┐
│ Main 侧 (src/platform/main/ai/)                           │ 执行
│   ask-orchestrator.ts → 按 serviceId 分派                 │ DOM/SDK 解析
│   extractors/                                             │
│     ├── claude-full-extraction.ts (SDK 真 API)            │
│     ├── chatgpt-full-extraction.ts (DOM 爬虫)             │
│     └── gemini-full-extraction.ts (DOM 爬虫)              │
└──────────────────────────────────────────────────────────┘

返回 markdown → 由命令层落库 →

┌──────────────────────────────────────────────────────────┐
│ thought capability                                        │ 存储
│   只管 thought CRUD，不感知来源                            │
└──────────────────────────────────────────────────────────┘
```

详细数据流见 [docs/00-architecture/ai-extraction-flow.md](../../../docs/00-architecture/ai-extraction-flow.md)。

## 历史

- 原名 `ai-conversation`（feature/ai-view，2026-05-18 首次落地）
- 2026-05-19 改为 `ai-extraction`，对齐 [目录命名"装的什么"原则](../../../docs/00-architecture/charter.md)（容器名说"装的什么"，不说"做什么动作"）
- **字面量保留**：`AI_PROTOCOL='ai-conversation'`（IPC 协议头）+ SurrealDB atom 的 `extractionType:'ai-conversation'` 字面量**保留不动**，零数据迁移。
