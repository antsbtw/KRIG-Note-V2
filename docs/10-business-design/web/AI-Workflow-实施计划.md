# AI Workflow 实施计划

> 创建日期：2026-04-12
> 设计文档：`AI-Workflow-Protocol-设计.md`
> 代码库状态：已确认 callout / toggle / Thought 协议 / WebView / ViewMessage 等基础设施均已实现
>
> **原则**：每个步骤都是可验收的最小交付单元。每步完成后可运行、可测试、不破坏现有功能。

---

## 代码库现状确认

| 基础设施 | 状态 | 位置 |
|---------|------|------|
| Callout Block | ✅ 已实现 | `src/plugins/note/blocks/callout.ts` — emoji 循环（💡⚠️❌✅...） |
| Toggle List Block | ✅ 已实现 | `src/plugins/note/blocks/toggle-list.ts` — open/close 折叠 |
| Thought 协议 | ✅ 已实现 | `src/plugins/thought/thought-protocol.ts` — 7 个 action |
| ThoughtView + ThoughtCard | ✅ 已实现 | `src/plugins/thought/components/` — 完整 CRUD + 图关系 |
| FloatingToolbar | ✅ 已实现 | `src/plugins/note/components/FloatingToolbar.tsx` — 含 Thought 菜单 |
| thought-plugin.ts | ✅ 已实现 | `src/plugins/note/plugins/thought-plugin.ts` — mark 创建/删除/滚动 |
| WebView + webview 标签 | ✅ 已实现 | `src/plugins/web/components/WebView.tsx` — partition:persist:web |
| CSP bypass preload | ✅ 已实现 | `src/plugins/web/preload/web-content.ts` — MutationObserver |
| ViewMessage 系统 | ✅ 已实现 | `sendToOtherSlot` / `onMessage` — main 进程路由 |
| WorkMode/Protocol 注册 | ✅ 已实现 | `src/main/app.ts` — 6 个 WorkMode + 15 个 Protocol |
| IPC 通道 | ✅ 60+ 已定义 | `src/shared/types.ts` — IPC 常量 |
| BlockRegistry + 斜杠命令 | ✅ 已实现 | `src/plugins/note/registry.ts` + `plugins/slash-command.ts` |
| SurrealDB 存储 | ✅ 已实现 | `src/main/storage/` — note/thought/folder/ebook/web stores |

---

## Phase 1：场景 A — 标注模式

> 用户选中 Note 内容 → "问 AI" → AI 回复写入 Thought，锚定到选中位置。

### Step 1.1：AI Service Profile 配置表

**目标**：定义三大 AI 服务的 URL、DOM 选择器、SSE 拦截策略。纯数据，不涉及 UI。

**交付文件**：
```
新增  src/shared/types/ai-service-types.ts      — AIServiceProfile 接口 + 三服务配置
修改  src/shared/types.ts                        — 导出新增类型（如需要）
```

**具体工作**：
- 定义 `AIServiceProfile` 接口（id, name, baseUrl, newChatUrl, urlPattern, selectors, intercept, input）
- 创建 `AI_SERVICE_PROFILES` 数组，包含 ChatGPT / Claude / Gemini 三条配置
- 每条配置填入实际的 CSS selector（输入框、发送按钮、消息列表等）
- 每条配置填入 SSE 拦截策略（fetch-hook / conversation-api / cdp-network）

**验收标准**：
- [ ] `AIServiceProfile` 类型定义完整，TypeScript 编译无错误
- [ ] 三服务的 `urlPattern` 能正确匹配各自的 URL（编写单元测试验证）
- [ ] 三服务的 `selectors` 字段已填入（可通过手动在浏览器 DevTools 验证）
- [ ] 不引入任何运行时代码，不修改任何现有逻辑

---

### Step 1.2：后台 AI WebView 管理

**目标**：在 main 进程中管理一个隐藏的 webview 实例，用于向 AI 服务发送请求和拦截回复。

**交付文件**：
```
新增  src/main/ai/background-ai-webview.ts       — BackgroundAIWebview 类
修改  src/main/app.ts                             — 注册 AI 相关 IPC handler
修改  src/shared/types.ts                         — 新增 AI 相关 IPC 通道常量
```

**具体工作**：
- 创建 `BackgroundAIWebview` 类：
  - `ensureReady(serviceId)` — 懒创建隐藏 BrowserWindow（或 webview），导航到 AI 服务
  - 共享 `partition: 'persist:web'`（复用用户在 WebView 中的登录状态）
  - `destroy()` — 销毁 webview 释放资源
- 注册 IPC handler：
  - `ai:ask` — 接收提问请求（noteId, thoughtId, prompt, serviceId）
  - `ai:status` — 查询后台 webview 状态
- 懒初始化：第一次 `ai:ask` 调用时才创建 webview

**验收标准**：
- [ ] `BackgroundAIWebview.ensureReady('claude')` 能创建隐藏窗口并导航到 `claude.ai`
- [ ] 后台 webview 与前台 WebView 共享 session（用户在前台登录 Claude 后，后台 webview 也是登录状态）
- [ ] `destroy()` 后 webview 被正确销毁，无内存泄漏
- [ ] 不创建后台 webview 时，对应用性能零影响（懒初始化）
- [ ] 手动测试：通过 IPC `ai:status` 能查询到 webview 的 URL 和就绪状态

---

### Step 1.3：SSE 拦截注入脚本

**目标**：向后台 AI webview 注入脚本，拦截 AI 回复的 SSE 流，获取完整 Markdown 回复。

**交付文件**：
```
新增  src/main/ai/inject-scripts/sse-capture.js       — SSE 拦截脚本（三服务策略）
新增  src/main/ai/inject-scripts/user-message-capture.js  — user 消息捕获脚本
新增  src/main/ai/ai-request-handler.ts                — 编排：粘贴→发送→拦截→返回
```

**具体工作**：
- `sse-capture.js`：
  - Claude 策略：hook `window.fetch`，拦截 `text_delta` SSE 事件，累积到 `window.__krig_sse_response`
  - ChatGPT 策略：检测 DOM 回复完成 → 调 conversation API 获取 Markdown
  - Gemini 策略：CDP 网络层拦截 `StreamGenerate`
  - 统一接口：`window.__krig_sse_status`（'idle' | 'streaming' | 'complete' | 'error'）
  - 统一接口：`window.__krig_sse_response`（完整 Markdown 字符串）
- `user-message-capture.js`：
  - 监听输入框清空事件，记录 `window.__krig_last_user_message`
- `ai-request-handler.ts`：
  - `askAI(serviceId, prompt)` 编排函数
  - 流程：detectService → clearResponse → pasteText → pressSubmit → pollStatus → getResponse
  - 通过 `webContents.executeJavaScript()` 与注入脚本交互

**验收标准**：
- [ ] Claude 策略：发送一条消息后，`window.__krig_sse_response` 包含完整 Markdown 回复
- [ ] ChatGPT 策略：同上
- [ ] Gemini 策略：同上
- [ ] `window.__krig_sse_status` 状态机正确流转：idle → streaming → complete
- [ ] `askAI('claude', '你好')` 端到端返回 AI 回复的 Markdown 字符串
- [ ] 拦截不干扰 AI 服务的正常功能（使用 `response.clone()` 读取）
- [ ] SPA 页面导航后重新注入（`did-navigate-in-page` 事件）
- [ ] 手动测试：在三个 AI 服务上各发送一条消息，确认拦截结果正确

---

### Step 1.4：Markdown → ProseMirror Nodes 转换

**目标**：将 AI 回复的 Markdown 解析为 ProseMirror Node 序列，可以直接插入 NoteView 编辑器。

**交付文件**：
```
新增  src/main/ai/markdown-to-blocks.ts          — Markdown → ExtractedBlock[] 解析
新增  src/plugins/note/ai-workflow/blocks-to-pm-nodes.ts  — ExtractedBlock[] → PM Node[]
```

**具体工作**：
- `markdown-to-blocks.ts`（main 进程）：
  - 输入：Markdown 字符串
  - 输出：`ExtractedBlock[]`（已在 `atom-types.ts` 中有基础类型参考）
  - 处理：段落、标题、代码块（含语言标记）、数学公式（`$$ $$` 和 `$ $`）、列表、表格、blockquote、图片链接
  - 复用已有的 Markdown 解析逻辑（如果有），否则用 `marked` 或手写解析器
- `blocks-to-pm-nodes.ts`（renderer 进程）：
  - 输入：`ExtractedBlock[]`
  - 输出：`ProseMirrorNode[]`（使用 BlockRegistry 的 schema 构造）
  - 每个 ExtractedBlock 映射到对应的 ProseMirror nodeType

**验收标准**：
- [ ] 纯文本段落正确解析为 paragraph node
- [ ] 代码块正确解析为 codeBlock node（含语言属性）
- [ ] 数学公式（`$$ ... $$`）正确解析为 mathBlock node
- [ ] 行内数学（`$ ... $`）正确解析为 mathInline mark
- [ ] 有序/无序列表正确解析为 orderedList / bulletList node
- [ ] 标题（`#` ~ `######`）正确解析为 textBlock node（含 level 属性）
- [ ] 表格正确解析为 table node
- [ ] 编写单元测试覆盖以上所有场景
- [ ] 解析结果可以通过 `tr.insert()` 插入 ProseMirror 文档，编辑器正确渲染

---

### Step 1.5：扩展 Thought 协议 + FloatingToolbar "问 AI" 按钮

**目标**：在 FloatingToolbar 中增加 "问 AI" 按钮，选中文字后可以选择 AI 服务发起提问。

**交付文件**：
```
修改  src/plugins/thought/thought-protocol.ts     — 增加 AI 相关 action 常量
修改  src/shared/types/thought-types.ts           — ThoughtType 增加 'ai-response' 类型
修改  src/plugins/note/components/FloatingToolbar.tsx — 增加 "问 AI" 按钮 + 服务选择菜单
新增  src/plugins/note/commands/ask-ai-command.ts  — "问 AI" 命令实现
修改  src/plugins/note/plugins/thought-plugin.ts  — 处理 AI 相关消息
```

**具体工作**：
- `thought-protocol.ts` 增加 action：
  - `AI_ASK` — Note → main：请求 AI 回答
  - `AI_RESPONSE_READY` — main → ThoughtView：AI 回复就绪
  - `AI_ERROR` — main → Note + ThoughtView：AI 回复失败
  - `AI_FOLLOWUP` — ThoughtView → main：追问
- `thought-types.ts` 增加：
  - `ThoughtType` 新增 `'ai-response'`
  - `THOUGHT_TYPE_META` 新增 `{ icon: '🤖', color: '#6366f1', label: 'AI 回复' }`
- FloatingToolbar 增加 "问 AI" 按钮：
  - 位于 Thought 菜单旁边
  - 点击弹出下拉：ChatGPT / Claude / Gemini
  - 选择后调用 `askAI` 命令
- `ask-ai-command.ts`：
  - 获取选中文本，转为 Markdown
  - 在选中位置添加 thought mark（type: 'ai-pending'）
  - 通过 IPC `ai:ask` 发送到 main 进程
  - main 进程调用 `ai-request-handler.askAI()` 获取回复
  - 回复通过 IPC 返回 → 创建 ThoughtRecord（type: 'ai-response'）→ 通知 ThoughtView

**验收标准**：
- [ ] FloatingToolbar 中选中文字后出现 "🤖" 按钮
- [ ] 点击按钮弹出 AI 服务选择菜单（ChatGPT / Claude / Gemini）
- [ ] 选择服务后，选中位置出现 thought mark（pending 状态，有动画）
- [ ] AI 回复成功后，ThoughtView 中出现新的 ThoughtCard（type: ai-response）
- [ ] ThoughtCard 显示 AI 图标和服务名
- [ ] ThoughtCard 内容为 AI 回复的完整富文本（代码块、公式、列表等正确渲染）
- [ ] AI 回复失败时，thought mark 变为 error 状态（红色），点击可重试
- [ ] 选中位置的 thought mark 可以点击激活对应的 ThoughtCard

---

### Step 1.6：ThoughtCard AI 变体

**目标**：AI 生成的 ThoughtCard 增加追问、复制、编辑功能。

**交付文件**：
```
修改  src/plugins/thought/components/ThoughtCard.tsx  — AI 变体 UI
修改  src/plugins/thought/components/ThoughtView.tsx  — 处理 AI_FOLLOWUP
```

**具体工作**：
- ThoughtCard 检测 `thought.type === 'ai-response'`：
  - 头部显示 AI 图标 + 服务名（而非普通 Thought 类型图标）
  - 底部增加 action 按钮：[追问] [复制 Markdown]
  - "追问"：基于当前回复内容构造追问 prompt → 创建新的 AI Thought
  - "复制 Markdown"：将 Thought 内容转为 Markdown 复制到剪贴板
- ThoughtView 处理 `AI_FOLLOWUP`：
  - 收到追问请求 → IPC `ai:ask` → 新 ThoughtCard

**验收标准**：
- [ ] AI ThoughtCard 头部显示 "🤖 Claude" / "🤖 ChatGPT" / "🤖 Gemini"
- [ ] 底部显示 [追问] [复制] 按钮（普通 Thought 没有这些按钮）
- [ ] 点击 [追问] 弹出输入框，输入后创建新的 AI Thought
- [ ] 点击 [复制] 将回复内容复制为 Markdown
- [ ] AI ThoughtCard 的内容完全可编辑（展开 ThoughtEditor 后与普通 Thought 一致）
- [ ] 可以将 AI ThoughtCard 的类型改为普通 Thought 类型（通过类型切换菜单）

---

### Phase 1 整体验收

完成 Step 1.1 ~ 1.6 后，**端到端验收流程**：

```
1. 用户打开一篇 Note + 右侧 ThoughtView
2. 选中 Note 中的一段文字（例如一个数学公式）
3. 点击 FloatingToolbar 中的 🤖 按钮
4. 选择 "Claude"
5. 选中位置出现 pending 状态的 thought mark（旋转动画）
6. 等待 3~15 秒
7. ThoughtView 中出现新的 ThoughtCard，标题 "🤖 Claude"
8. ThoughtCard 内容为 Claude 的回复，包含正确渲染的代码块、公式、列表等
9. 选中位置的 thought mark 变为正常状态（紫色下划线）
10. 点击 thought mark → ThoughtCard 高亮并滚动到可见区域
11. 点击 [追问] → 输入追问内容 → 新的 AI ThoughtCard 出现
12. 在 ThoughtCard 中编辑 AI 回复内容 → 正常保存
```

---

## Phase 2：场景 C — 浏览同步模式

> 用户直接在 AI Web 聊天，右侧 Note 自动同步记录。

### Step 2.1：注册 ai-sync WorkMode + Protocol

**交付文件**：
```
修改  src/main/app.ts                      — 注册 ai-sync WorkMode + Protocol + NavSide
修改  src/shared/types.ts                   — 新增 IPC 通道常量
```

**具体工作**：
- 注册 WorkMode `'ai-sync'`：viewType: web, variant: ai
- 注册 Protocol `'ai-sync'`：left: web(ai), right: note(sync)
- 注册 NavSide：AI 服务选择面板
- Shell 中支持 ai-sync 布局创建

**验收标准**：
- [ ] 可以通过 WorkMode 切换进入 ai-sync 模式
- [ ] 左侧显示 WebView:ai（加载 AI 服务 URL），右侧显示空的 NoteView
- [ ] NavSide 显示 AI 服务选择面板（ChatGPT / Claude / Gemini）
- [ ] 切换 AI 服务后，左侧 WebView 导航到对应 URL
- [ ] 不影响现有 WorkMode 的功能

---

### Step 2.2：SSE 拦截接入前台 WebView

**目标**：将 Phase 1 开发的 SSE 拦截脚本从后台 webview 扩展到前台 WebView:ai。

**交付文件**：
```
新增  src/plugins/web/ai-workflow/sync-engine.ts      — 同步引擎（SSE 事件 → ViewMessage）
新增  src/plugins/web/ai-workflow/turn-builder.ts      — 单轮对话打包
修改  src/plugins/web/components/WebView.tsx           — ai variant 加载 SSE 拦截脚本
修改  src/plugins/web/preload/web-content.ts           — AI 模式下注入 SSE + user-message 脚本
```

**具体工作**：
- WebView.tsx 检测 variant=ai 时，在 `did-finish-load` 后注入 SSE 拦截 + user 消息捕获脚本
- `sync-engine.ts`：
  - 轮询 `window.__krig_sse_status` 和 `window.__krig_last_user_message`
  - SSE 完成时，调用 `turn-builder` 打包完整轮次
  - 通过 `viewAPI.sendToOtherSlot()` 发送 `as:append-turn`
- `turn-builder.ts`：
  - 组合 user 消息 + assistant Markdown → `{ turn, source }` payload

**验收标准**：
- [ ] 在 ai-sync 模式下，用户在左侧 AI Web 发送消息
- [ ] 左侧 SSE 拦截器正确捕获 AI 回复
- [ ] 通过 ViewMessage 发送 `as:append-turn` 到右侧
- [ ] 手动测试：在 DevTools console 中能看到正确的 ViewMessage payload
- [ ] 拦截不干扰 AI Web 的正常交互（不影响输入、滚动、页面渲染）

---

### Step 2.3：SyncNote 接收端 — callout + toggle 追加

**目标**：右侧 NoteView 接收 `as:append-turn` 消息，将对话轮次以 callout（问题）+ toggle（回答）格式追加到文档末尾。

**交付文件**：
```
新增  src/plugins/note/ai-workflow/sync-note-receiver.ts   — ViewMessage → PM transaction
新增  src/plugins/note/ai-workflow/turn-to-callout-toggle.ts — 构造 callout + toggle nodes
修改  src/plugins/note/components/NoteView.tsx              — ai-sync variant 启用接收逻辑
```

**具体工作**：
- `sync-note-receiver.ts`：
  - 监听 `as:append-turn` ViewMessage
  - 调用 `turn-to-callout-toggle` 构造 PM nodes
  - ProseMirror transaction: `tr.insert(doc.content.size, nodes)`
  - 滚动编辑器到底部
- `turn-to-callout-toggle.ts`：
  - user 消息 → callout node（emoji: '❓'）
  - assistant Markdown → `markdown-to-blocks` → `blocks-to-pm-nodes` → toggle node 内容
  - toggle 标题："回答 ({serviceName})"
  - toggle 默认展开（`open: true`）

**验收标准**：
- [ ] 用户在 AI Web 发送消息后，右侧 Note 自动出现 callout（问题）
- [ ] AI 回复完成后，Note 自动出现 toggle（回答），内容正确渲染
- [ ] toggle 标题显示 "回答 (Claude)" / "回答 (ChatGPT)" / "回答 (Gemini)"
- [ ] 代码块、数学公式、列表等在 toggle 内正确渲染
- [ ] 多轮对话按序追加，callout 和 toggle 交替排列
- [ ] 用户可以编辑 callout 和 toggle 内的内容
- [ ] 用户可以在对话之间插入自己的笔记
- [ ] 用户可以折叠 toggle 隐藏长回复
- [ ] 编辑器自动滚动到最新追加的内容

---

### Step 2.4：同步控制 UI + SyncNote 创建/管理

**交付文件**：
```
新增  src/plugins/web/components/SyncStatusIndicator.tsx  — Toolbar 同步状态灯
修改  src/plugins/web/components/WebToolbar.tsx            — ai variant 显示同步控件
新增  src/main/ai/conversation-store.ts                    — conversation 表 + synced_to edge
修改  src/main/storage/schema.ts                           — SurrealDB schema 更新
```

**具体工作**：
- SyncStatusIndicator：状态灯（绿色同步中/黄色暂停/红色错误）+ 暂停/恢复按钮
- WebToolbar 在 ai variant 下显示同步控件
- conversation-store：
  - `create(serviceId, url?)` — 创建 conversation 记录
  - `linkToNote(conversationId, noteId)` — synced_to edge
  - `findByUrl(url)` — 查找关联 Note
- SyncNote 自动创建：打开 ai-sync 模式时创建，标题 "AI Sync — {Service} — {date}"

**验收标准**：
- [ ] Toolbar 显示同步状态灯（绿色闪烁表示同步中）
- [ ] 点击暂停按钮后状态变黄，对话不再同步
- [ ] 点击恢复后继续同步
- [ ] 打开 ai-sync 模式自动创建 SyncNote
- [ ] 切换 AI 服务后创建新的 SyncNote
- [ ] conversation 记录正确写入 SurrealDB
- [ ] synced_to edge 正确关联 conversation 和 note

---

### Phase 2 整体验收

```
1. 通过 WorkMode 切换进入 ai-sync 模式
2. 左侧加载 Claude（用户已登录），右侧自动创建空 Note
3. Toolbar 显示绿色同步灯
4. 在左侧 Claude 输入 "请解释量子纠缠"，发送
5. 右侧 Note 出现 callout（❓ "请解释量子纠缠"）
6. 等待 Claude 回复完成
7. 右侧 Note 出现 toggle（"回答 (Claude)"），展开查看完整回复
8. 回复中的代码块、公式、列表正确渲染
9. 继续在 Claude 中发送第二个问题
10. 右侧 Note 继续追加新的 callout + toggle
11. 用户可以折叠之前的 toggle，只看最新回复
12. 用户可以在两轮对话之间插入自己的批注
13. 点击暂停 → 发送第三个问题 → 右侧 Note 不追加
14. 点击恢复 → 发送第四个问题 → 恢复同步
15. 关闭 ai-sync 模式，Note 自动保存
16. 重新打开 ai-sync 模式 → 恢复上次的 Note
```

---

## Phase 3：场景 B — 对话模式

> 独立 ChatNote，用户在完整 NoteView 输入区中提问，AI 回复追加到对话历史。

### Step 3.1：注册 ai-chat WorkMode + Protocol

**交付文件**：
```
修改  src/main/app.ts        — 注册 ai-chat WorkMode + Protocol
修改  src/shared/types.ts    — 新增 ai-chat IPC 通道
```

**验收标准**：
- [ ] 可以切换到 ai-chat 模式
- [ ] 左侧显示 WebView:ai，右侧显示 NoteView（chat variant）
- [ ] Protocol 匹配正确，ViewMessage 可以双向路由

---

### Step 3.2：ChatNote 布局 — 对话历史 + ChatInputBar

**交付文件**：
```
新增  src/plugins/note/chat/ChatNoteView.tsx      — ChatNote 顶层组件
新增  src/plugins/note/chat/ChatInputBar.tsx       — 完整 NoteView 输入区
新增  src/plugins/note/chat/chat-note.css          — ChatNote 布局样式
修改  src/plugins/note/renderer.tsx                — chat variant 渲染 ChatNoteView
```

**具体工作**：
- ChatNoteView 上下分区布局：
  - 上方：对话历史（完整 NoteEditor 实例）
  - 下方：ChatInputBar（另一个完整 NoteEditor 实例）+ [Claude ▾] [发送 ▶]
  - 中间：可拖拽分隔线
- ChatInputBar：
  - 完整的 NoteEditor — 复用 BlockRegistry schema、斜杠命令、FloatingToolbar 等全部能力
  - 默认 3 行高，内容超出自动扩展，最大不超过视口 40%
  - `Cmd+Enter` 触发发送
- 发送逻辑：
  - 提取 ChatInputBar 的 PM doc → 包装为 callout → 追加到对话历史
  - 同时将内容转为 Markdown → ViewMessage `ac:send-prompt` → 左侧 WebView:ai
  - 清空 ChatInputBar

**验收标准**：
- [ ] ChatNote 显示上下分区：对话历史 + 输入区
- [ ] 输入区具备 NoteView 的完整编辑能力（斜杠命令、公式、代码块、图片等）
- [ ] `Cmd+Enter` 发送后，输入内容以 callout 形式出现在对话历史中
- [ ] 输入区清空，准备下一轮输入
- [ ] 分隔线可拖拽调整上下区域比例
- [ ] AI 服务切换下拉可用

---

### Step 3.3：ChatNote 接收 AI 回复

**交付文件**：
```
新增  src/plugins/note/chat/chat-receive-handler.ts  — 接收 ac:append-response → toggle 追加
修改  src/plugins/web/components/WebView.tsx          — ai-chat variant 的 SSE 拦截 + ViewMessage
```

**具体工作**：
- WebView:ai 在 ai-chat 模式下：
  - 接收 `ac:send-prompt` → pasteText 到 AI 输入框 → pressSubmit
  - SSE 拦截完成 → 构造 `ac:append-response` → 发送到 ChatNote
- ChatNote 接收 `ac:append-response`：
  - 移除 loading placeholder
  - Markdown → PM Nodes → 包装为 toggle → 追加到对话历史
  - 自动滚动到底部

**验收标准**：
- [ ] 在 ChatInputBar 写入问题 → `Cmd+Enter` → callout 出现在历史区 + "AI 思考中..." 提示
- [ ] AI 回复完成后，toggle（"回答 (Claude)"）出现在 callout 下方
- [ ] toggle 内容正确渲染（代码、公式、列表等）
- [ ] loading 提示消失
- [ ] 多轮对话正确交替排列
- [ ] 用户可以编辑历史中的 callout 和 toggle

---

### Step 3.4：ChatNote 会话管理

**交付文件**：
```
新增  src/plugins/web/navside/AIChatPanel.tsx      — 历史对话列表面板
修改  src/main/ai/conversation-store.ts             — 复用 Phase 2 的存储
```

**验收标准**：
- [ ] NavSide 面板显示历史对话列表
- [ ] 点击历史对话 → 恢复对应的 ChatNote
- [ ] "+ 新对话" 按钮创建新的 ChatNote
- [ ] 切换 AI 服务创建新的 ChatNote

---

### Phase 3 整体验收

```
1. 切换到 ai-chat 模式
2. 左侧加载 Claude，右侧显示 ChatNote（空对话历史 + ChatInputBar）
3. 在 ChatInputBar 中输入：
   "请解释以下公式："
   /math → 输入 E = mc^2
4. Cmd+Enter 发送
5. 对话历史出现 callout（包含文字 + 公式），输入区清空
6. 出现 "AI 思考中..." 提示
7. 回复完成，toggle（"回答 (Claude)"）出现
8. 回复内容正确渲染
9. 在 ChatInputBar 中写下一个问题（用 /code 插入代码块）→ Cmd+Enter
10. 对话继续追加
11. 折叠第一轮的回答 toggle → 只看到标题行
12. 在两轮对话之间插入一段笔记 → 正常编辑
13. NavSide 面板显示这个对话 → 关闭后可以恢复
```

---

## Phase 4：跨场景集成

> eBook 发送到 AI + 场景间切换 + 知识图谱集成

### Step 4.1：eBook → 标注模式（Thought）

**验收标准**：
- [ ] 在 eBook 阅读界面选中文字 → 右键菜单 "问 AI" → AI 回复写入 Thought
- [ ] Thought 锚定到 eBook 的选中位置
- [ ] 复用 Phase 1 的全部 AI 能力

### Step 4.2：eBook → 对话模式（跨 Tab IPC）

**验收标准**：
- [ ] eBook 选中文字 → "发送到 AI Chat" → 内容出现在 ChatNote 的 ChatInputBar 中
- [ ] 跨 Tab 通信正确路由
- [ ] 不影响 eBook 的正常阅读

### Step 4.3：Note "发送到 AI" 反向操作

**验收标准**：
- [ ] 在 SyncNote / ChatNote 中选中内容 → "发送到 AI" → 内容粘贴到左侧 AI 输入框
- [ ] 支持文字和图片

### Step 4.4：知识图谱集成

**验收标准**：
- [ ] conversation → synced_to → note 关系在 SurrealDB 中正确建立
- [ ] note → thought_of → thought (type: ai-response) 关系正确
- [ ] 可以从 Thought 追溯到原始 conversation

---

## 依赖关系总览

```
Step 1.1  AI Service Profile（纯数据）
  ↓
Step 1.2  后台 AI WebView（依赖 1.1 的 URL 配置）
  ↓
Step 1.3  SSE 拦截注入（依赖 1.2 的 webview 实例 + 1.1 的选择器配置）
  ↓
Step 1.4  Markdown → PM Nodes（独立，可与 1.3 并行）
  ↓
Step 1.5  FloatingToolbar + Thought 扩展（依赖 1.3 + 1.4）
  ↓
Step 1.6  ThoughtCard AI 变体（依赖 1.5）
  ‖
  ‖  Phase 1 完成
  ↓
Step 2.1  ai-sync 注册（独立，可与 1.x 并行）
  ↓
Step 2.2  前台 SSE 拦截（复用 1.3 的脚本）
  ↓
Step 2.3  SyncNote 接收端（复用 1.4 的 Markdown 转换）
  ↓
Step 2.4  同步控制 UI + 存储
  ‖
  ‖  Phase 2 完成
  ↓
Step 3.1  ai-chat 注册
  ↓
Step 3.2  ChatNote 布局（核心工作量）
  ↓
Step 3.3  ChatNote 接收（复用 2.3 的接收逻辑）
  ↓
Step 3.4  会话管理
  ‖
  ‖  Phase 3 完成
  ↓
Step 4.1 ~ 4.4  跨场景集成
```

---

## 风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| AI 服务频繁更新 DOM 结构 | SSE 拦截脚本失效 | 选择器配置化（AI Service Profile），更新选择器不需要改代码逻辑 |
| AI 服务更新 CSP 或反自动化策略 | 注入脚本被拦截 | 已有 CSP bypass（web-content.ts）+ fetch hook 策略经 mirro-desktop 长期验证 |
| 后台 webview 内存占用 | 应用变重 | 懒初始化 + 不使用时自动销毁（5 分钟无请求） |
| ProseMirror 双实例（ChatNote）性能 | 编辑器卡顿 | 两个实例共享 schema 和 plugin 定义，只是独立的 state/view，内存开销可控 |
| Markdown 解析遗漏格式 | AI 回复渲染不完整 | 先覆盖高频格式（段落/代码/公式/列表），低频格式逐步补充 |
