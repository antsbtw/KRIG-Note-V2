# AI 对话提取数据流

> v0.1 · 2026-05-19 · 配合 ai-conversation → ai-extraction 改名
>
> 目的：画清"AI 对话提取"四段责任，避免把"抓取"和"存储"职责混在同一处。

## 背景

KRIG-Note 的"AI 对话提取"涉及四个目录里的代码，初读容易困惑：

- 命令在 `src/views/ai/ai-commands.ts`
- 能力在 `src/capabilities/ai-extraction/`
- DOM/SDK 解析在 `src/platform/main/ai/extractors/`
- 数据落库到 `src/capabilities/thought/`

这是**有意的分层**，但需要明示边界才不会迷路。

## 四段责任

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. AI View 命令层  (src/views/ai/ai-commands.ts)                 │
│ ─────────────────────────────────────────────────────────────── │
│ 职责: 编排                                                       │
│   - 何时触发提取(用户点"提取"按钮 / 从 Note Ask AI 路径)         │
│   - 取 pending thoughtId(Note Ask AI 上下文)                    │
│   - 决定 update 已有 thought 还是 create 新 thought             │
│   - 解析 markdown → PM doc → 调 thought.update/create           │
│                                                                  │
│ 命令: 'ai-view.extract-conversation'                            │
│ 入口: ai-commands.ts L70 (registerAICommands)                   │
└──────────────────────────────┬──────────────────────────────────┘
                               │ requireCapabilityApi
                               │   <AIConversationApi>('ai-extraction')
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. ai-extraction capability  (src/capabilities/ai-extraction/)   │
│ ─────────────────────────────────────────────────────────────── │
│ 职责: 能力(纯)                                                   │
│   - 暴露统一 API: askAI / extractFull / Host / pending-thought  │
│   - 跨平台路由(claude/chatgpt/gemini)                            │
│   - 本层 **不写库** — 抓取结果直接返回给调用方                  │
│                                                                  │
│ 文件:                                                            │
│   index.ts        - capabilityRegistry 注册 + electronAPI 包装  │
│   types.ts        - AIConversationApi 接口                       │
│   Host.tsx        - AI 网页 webview 组件                         │
│   pending-thought - thoughtId per-serviceId 路由缓存             │
└──────────────────────────────┬──────────────────────────────────┘
                               │ window.electronAPI.aiAsk / aiExtractFull
                               │   (IPC: 'ai.ask' / 'ai.extract-full')
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Main 侧 extractors  (src/platform/main/ai/)                   │
│ ─────────────────────────────────────────────────────────────── │
│ 职责: 执行(平台差异)                                             │
│   - handlers.ts        IPC 接收 + 路由                          │
│   - ask-orchestrator   按 serviceId 分派                         │
│   - extractors/                                                  │
│       claude-full-extraction.ts  - Claude SDK 真 API + artifact │
│       chatgpt-full-extraction.ts - ChatGPT DOM 爬虫              │
│       gemini-full-extraction.ts  - Gemini DOM 爬虫               │
└──────────────────────────────┬──────────────────────────────────┘
                               │ AIExtractFullResult { markdown, ... }
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. thought capability  (src/capabilities/thought/)               │
│ ─────────────────────────────────────────────────────────────── │
│ 职责: 存储(纯)                                                   │
│   - thought CRUD + anchor + mark                                 │
│   - **不感知数据来源** — AI / 用户笔记 / 摘抄都一样              │
│                                                                  │
│ 由调用方(第 1 段命令层)在拿到 markdown 后调:                     │
│   thoughtCap.updateThought(pendingId, { doc })  // Note Ask AI  │
│ 或                                                               │
│   thoughtCap.createThought({ type: 'ai-response', doc })  // 独立 │
└─────────────────────────────────────────────────────────────────┘
```

## 为什么不把"抓取后自动写入 thought"合并到 capability 里？

ai-extraction 是横切能力，多个 view 都能 install。如果它自己写库：

- 强绑定 thought capability，破坏单一职责
- 不同 view 想要不同写入策略时无法定制（如未来若有 view 想把抓取结果写到别的地方）
- Note Ask AI 流程需要 update 已有 thought 而非 create 新的，这种业务决策不该塞进通用能力

**结论**：能力只管"能不能抓"和"怎么抓"，调用方决定"抓完写到哪"。

## pending-thought 路由（Note Ask AI 场景）

```
1. 用户在 Note 选区 → "🤖 问 AI"
2. thought.createThought({ type: 'ai-response', doc: '' }) → 拿到 thoughtId
3. 弹 AskAIPanel
4. 用户输入 prompt 点发送:
   - panel.handleSend() 调
       ai.setPendingAIThought(serviceId, thoughtId)
   - 然后调 AI Host pasteAndSend(prompt) 发到 AI Web
5. AI Web 上 AI 在回复
6. 用户点 "提取整页对话":
   - ai-commands.ts 命令调
       ai.consumePendingAIThought(serviceId)  → 拿到 thoughtId(非空)
   - extractFull → 拿 markdown
   - thoughtCap.updateThought(thoughtId, { doc })  // 不重复创建
```

独立 AI 聊天场景：consumePendingAIThought 拿 null → thoughtCap.createThought 新建独立 thought（无 anchor）。

## 字面量保留

改名时这两个字面量**保留不动**（零数据迁移）：

| 字面量 | 位置 | 用途 |
|---|---|---|
| `AI_PROTOCOL = 'ai-conversation'` | `src/shared/ipc/ai-types.ts:56` | 跨槽 ViewMessage 协议头 |
| `extractionType: 'ai-conversation'` | SurrealDB atom field | 区分 atom 来源类型 |

注释里有"原 ai-conversation"说明，可读性靠注释而非字面量值传递。

## 相关文档

- [charter.md](./charter.md) - V2 架构总纲
- [src/capabilities/ai-extraction/README.md](../../src/capabilities/ai-extraction/README.md) - capability 内部设计
- [src/capabilities/ai-extraction/DESIGN.md](../../src/capabilities/ai-extraction/DESIGN.md) - V1 → V2 迁移背景
