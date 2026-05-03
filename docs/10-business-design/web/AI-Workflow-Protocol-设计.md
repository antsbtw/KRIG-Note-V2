# AI Workflow Protocol 设计

> 状态：设计中
> 创建日期：2026-04-12
> 版本：v0.2
>
> **定位**：连接 WebView:ai、NoteView、ThoughtView、EBookView 的**跨 View AI 工作流协议**。
> 不是新 View，而是在已有模块之间建立数据流通道的胶水层。
>
> **依赖文档**：
> - `WebView-设计.md` — WebView:ai 变体定义、Batch 3/4 规划
> - `WebBridge-设计.md` — L3 SSE 拦截 + L4 管线层
> - `Module5-Agent-设计.md` — Orchestrator 自动化场景
> - `web-translate/slot-communication.md` — Slot 间通信协议参考
> - `thought-design.md` — Thought 模块的 Slot 双工通信 + ThoughtRecord 数据模型
> - `KRIG-Atom体系设计文档.md` — ExtractionSource 和 Atom 结构
>
> **v0.2 变更说明**：
> - 重构为三场景架构：**标注模式** + **对话模式** + **浏览同步模式**
> - 场景 A 标注模式：选中 Note 内容问 AI，回复提取到 ThoughtView
> - 场景 B 对话模式：独立 ChatNote，底部富文本聊天输入框，完整对话记录
> - 场景 C 浏览同步模式：用户直接在 AI Web 聊天，实时同步到配对 Note（保留原有使用习惯）

---

## 一、核心需求

### 1.1 问题：AI 对话记录无法个性化整理

用户在 ChatGPT / Claude / Gemini 上的对话存在以下痛点：

| 痛点 | 说明 |
|------|------|
| 记录分散 | 三个平台各自管理，无法统一检索 |
| 无法编辑 | AI 平台不允许对回复做标注、修改、重组 |
| 无法关联 | 对话内容无法与 Note、eBook、Thought 产生知识图谱关系 |
| 手动复制 | 需要手动复制粘贴，格式丢失，效率极低 |
| 输入贫乏 | AI 平台输入框只支持纯文本 + 贴图，无法结构化表达 |

### 1.2 核心洞察：Note 应该是主交互面

**用户在 Note 中有更丰富的表达方法**——文字、公式、代码、流程图、表格、图片。KRIG 的完整 Block 体系远超 AI 平台的纯文本输入框。

因此：**AI Web 退化为后台执行引擎，用户在 Note 侧提问和整理，AI 回复自动回流到 Note 体系。**

### 1.3 三种使用场景

| | 场景 A：标注模式 | 场景 B：对话模式 | 场景 C：浏览同步模式 |
|---|---|---|---|
| 目的 | 对已有文章的某段内容向 AI 提问 | 独立 AI 对话，用富文本提问 | 直接在 AI Web 上聊天，不改变习惯 |
| 用户意图 | "这段公式什么意思？" | "帮我写一个排序算法" | 像平时一样用 ChatGPT/Claude/Gemini |
| 提问方式 | 选中 Note 内容 → "问 AI" | ChatNote 底部输入框（所有 Block 格式） | **直接在 AI Web 输入框中打字** |
| 回复去向 | **ThoughtView** — 锚定到选中位置 | **ChatNote** — 追加到对话历史 | **配对 Note** — SSE 拦截后实时追加 |
| Note 角色 | 用户的原文（不被打乱） | 对话笔记本 | 同步记录本（边聊边记） |
| Slot 布局 | NoteView + ThoughtView | WebView:ai + ChatNote | **WebView:ai + NoteView** |
| AI Web 角色 | 隐藏后台 | Left Slot（可折叠） | **Left Slot（主交互面）** |

### 1.4 三种场景的适用时机

```
用户想做什么？
  │
  ├─ "我在读一篇文章，想对某段内容问 AI"
  │    → 场景 A：标注模式（原文不动，回复到 Thought）
  │
  ├─ "我想和 AI 深度讨论一个话题，用公式/代码/图表提问"
  │    → 场景 B：对话模式（ChatNote 富文本输入）
  │
  └─ "我就想像平时一样打开 ChatGPT 聊天，但希望记录下来"
       → 场景 C：浏览同步模式（AI Web 直接聊，Note 自动同步）
```

**场景 C 的价值**：不打乱用户使用 AI 的习惯。有些用户习惯了 ChatGPT/Claude 的原生界面，不想学新的交互方式——只要旁边有一个 Note 自动记录就够了。

### 1.5 与 Module 5 自动化的区分

| | 场景 A/B/C（本文档） | Module 5 自动化 |
|---|---|---|
| 驱动者 | 用户手动操作 | Orchestrator 程序驱动 |
| SSE 拦截用途 | 提取到 Thought / ChatNote / SyncNote 供用户整理 | 获取结果供 Agent 判断和处理 |
| 通信通道 | Slot 双工 ViewMessage / IPC | IPC `web:bridge:*` |

四种场景共享 WebBridge L3 的 SSE 拦截能力，但上层消费逻辑完全不同。

---

## 二、架构总览

### 2.1 场景 A 布局：标注模式

用户有一篇文章，选中某段内容向 AI 提问，回复作为 Thought 锚定在原文旁。

```
┌─ NavSide ─┤─ Left Slot (note) ────┤D├── Right Slot (thought) ──────┐
│           │                        │i│                               │
│           │  用户的文章              │v│  ThoughtView                  │
│           │  ...                    │ │                               │
│           │  ██选中一段██            │ │  ┌─ ThoughtCard (AI) ──────┐ │
│           │     ↓ "问 AI"           │ │  │ 💭 来自 Claude:          │ │
│           │     ↓ WebBridge 发送    │ │  │ 这段公式表示的是...      │ │
│           │     ↓ SSE 拦截回复      │ │  │ $$ \nabla \times E ... $$│ │
│           │     ↓ ─────────────────┼─┼──┼→ 锚定到选中位置          │ │
│           │  ...                    │ │  └──────────────────────────┘ │
│           │                        │ │  ┌─ ThoughtCard (手动) ─────┐ │
│           │                        │ │  │ 📝 我的笔记...           │ │
│           │                        │ │  └──────────────────────────┘ │
└───────────┴────────────────────────┴─┴───────────────────────────────┘
                                          ↑
                                    AI Web (隐藏的后台 webview)
                                    执行发送 + SSE 拦截，用户不可见
```

**关键**：这个布局就是 `note-thought` 协议的标准布局。AI 功能通过扩展 Thought 系统实现，不需要新的 Slot 布局。WebView:ai 作为**隐藏的后台 webview** 运行，不占 Slot。

### 2.2 场景 B 布局：对话模式

用户进行独立的 AI 对话，在 Note 中用富文本提问，完整记录对话过程。

```
┌─ NavSide ─┤─ Left Slot (ai) ──────┤D├── Right Slot (chat-note) ───────────┐
│           │                        │i│                                      │
│ [ChatGPT] │  WebView:ai            │v│  ChatNote (NoteView variant)         │
│ [Claude]  │  (后台执行引擎)         │ │  ┌─ 对话历史区域 ─────────────────┐  │
│ [Gemini]  │                        │ │  │                                 │  │
│           │  用户通常不需要          │ │  │ ┌─ You ────────────────────┐   │  │
│           │  看这个面板，            │ │  │ │ 请解释以下公式的物理意义：│   │  │
│           │  但保留可见性            │ │  │ │ $$ E = mc^2 $$          │   │  │
│           │  用于调试和              │ │  │ └────────────────────────-┘   │  │
│           │  特殊操作               │ │  │                                │  │
│           │                        │ │  │ ┌─ Claude ──────────────────┐  │  │
│           │  ← 接收提问自动发送     │ │  │ │ 这是爱因斯坦的质能方程，  │  │  │
│           │  ← SSE 拦截回复 ───────┼─┼──┼─│ 它表明质量和能量...       │  │  │
│           │                        │ │  │ │ $$ E = mc^2 $$           │  │  │
│           │                        │ │  │ └──────────────────────────┘  │  │
│           │                        │ │  │ ──────── hr ─────────         │  │
│           │                        │ │  └──────────────────────────────┘  │
│           │                        │ │  ┌─ ChatInputBar ────────────────┐  │
│           │                        │ │  │ 完整 NoteView 编辑器实例       │  │
│           │                        │ │  │ /code /math /image ...        │  │
│           │                        │ │  │       [Claude ▾]  [发送 ▶]    │  │
│           │                        │ │  └──────────────────────────────┘  │
└───────────┴────────────────────────┴─┴────────────────────────────────────┘
```

### 2.3 场景 C 布局：浏览同步模式

用户直接在 AI Web 上聊天（保持原有习惯），右侧 Note 实时同步记录。

```
┌─ NavSide ─┤─ Left Slot (ai) ──────┤D├── Right Slot (note) ────────┤
│           │                        │i│                              │
│ [ChatGPT] │  WebView:ai            │v│  NoteView (SyncNote)        │
│ [Claude]  │  (AI 对话网页)          │ │  (实时同步的对话 Note)        │
│ [Gemini]  │  ← 用户在这里正常聊天   │ │  (用户可编辑/标注/整理)       │
│           │                        │ │                              │
│           │  ┌── SSE 拦截 ────────┐│ │  ┌── 自动追加 Block ────────┐│
│           │  │ user 消息捕获      ││ │  │ callout: 问题             ││
│           │  │ assistant 回复流   ││ │  │ toggle: 回答 (Claude)     ││
│           │  │ 流结束 → 同步 ─────┼┼─┼──┼─→ 追加到 Note 末尾       ││
│           │  └────────────────────┘│ │  └────────────────────────────┘│
└───────────┴────────────────────────┴─┴──────────────────────────────┘
```

**与场景 B 的区别**：
- 场景 B：用户在 Note 侧（ChatNote）提问，AI Web 是后台引擎
- 场景 C：用户在 AI Web 侧提问，Note 是被动同步的记录本
- 场景 C 的 Note 没有 ChatInputBar，就是普通的 NoteView

### 2.4 与现有 Slot 协议的对比

| | web-translate | note-thought | **A: 标注** | **B: 对话** | **C: 浏览同步** |
|---|---|---|---|---|---|
| 布局 | Web + Web | Note + Thought | Note + Thought | AI + ChatNote | **AI + Note** |
| 协议 ID | `web-translate` | `note-thought` | 复用 `note-thought` | `ai-chat` | **`ai-sync`** |
| AI Web | — | — | 隐藏后台 | Left Slot | **Left Slot（主交互面）** |

### 2.5 模块分工

```
WebView:ai（执行引擎 — 后台或 Left Slot）
  └── attach(webview) → WebBridge

WebBridge（通信层 — SSE 拦截 + 内容注入）
  ├── L3 interceptor.ts      ← SSE 拦截，捕获 AI 回复流
  ├── L3 writer.ts           ← 粘贴文本/图片到 AI 输入框
  ├── L3 ai-interaction.ts   ← send/request 编排
  └── L4 result-parser.ts    ← Markdown → ExtractedBlock[]

AI Workflow Protocol（本文档）
  ├── 场景 A：Note → "问 AI" → Thought（扩展 note-thought 协议）
  ├── 场景 B：ChatNote 输入 → AI → ChatNote 追加（ai-chat 协议）
  └── 共享：AI Service Profile + SSE 拦截消费 + 会话管理

NoteView / ThoughtView（View 层 — 用户的主交互面）
  └── 用户在这里提问、阅读回复、编辑整理
```

---

## 三、AI Service Profile 注册表

### 3.1 设计原则

每个 AI 服务的 URL 结构、DOM 布局、SSE 格式、输入方式各不相同。将这些差异收敛到一个配置表中，上层逻辑不关心具体服务的实现细节。

### 3.2 Profile 结构

```typescript
// src/shared/types/ai-service-types.ts

interface AIServiceProfile {
  id: 'chatgpt' | 'claude' | 'gemini';
  name: string;                              // 显示名："ChatGPT" / "Claude" / "Gemini"
  icon: string;                              // 图标资源 ID

  // ── URL ──
  baseUrl: string;                           // "https://chatgpt.com"
  newChatUrl: string;                        // "https://chatgpt.com/?model=gpt-4o"
  urlPattern: RegExp;                        // /^https:\/\/chatgpt\.com/

  // ── DOM 选择器 ──
  selectors: {
    inputBox: string;                        // 输入框 CSS selector
    sendButton: string;                      // 发送按钮 CSS selector
    messageList: string;                     // 消息列表容器
    userMessage: string;                     // 用户消息元素
    assistantMessage: string;                // AI 回复元素
    conversationTitle?: string;              // 对话标题元素
  };

  // ── SSE 拦截策略 ──
  intercept: {
    strategy: 'fetch-hook' | 'conversation-api' | 'cdp-network';
    endpointPattern: string | RegExp;        // 匹配拦截的请求 URL
    parseToken: (chunk: string) => string;   // 从 SSE chunk 中提取 text delta
    isComplete: (data: any) => boolean;      // 判断流是否结束
  };

  // ── 输入方式 ──
  input: {
    method: 'paste-contenteditable' | 'paste-textarea' | 'set-value';
    supportsImage: boolean;                  // 是否支持粘贴图片
    supportsFile: boolean;                   // 是否支持上传文件
    submitKey: 'Enter' | 'Ctrl+Enter';       // 发送快捷键
  };
}
```

### 3.3 三服务配置概览

| | ChatGPT | Claude | Gemini |
|---|---|---|---|
| baseUrl | `chatgpt.com` | `claude.ai` | `gemini.google.com` |
| SSE 策略 | 检测完成 → conversation API 获取完整 Markdown | hook `window.fetch` → 拦截 `text_delta` SSE | CDP 网络层拦截 `StreamGenerate` |
| 输入方式 | paste-contenteditable | paste-contenteditable | paste-textarea |
| 图片支持 | ✓ | ✓ | ✓ |
| 文件支持 | ✓ | ✓ | ✓ |

> **扩展机制**：未来新增 AI 服务只需向注册表添加一条 Profile，不修改任何上层代码。
> 但当前阶段**只注册三大服务**，不做通用插件机制——三个够用了，过度抽象没有意义。

### 3.4 与 WebBridge 的关系

`AIServiceProfile` 是 **WebBridge `ai-service-detector.ts` 的配置数据源**。当前 WebBridge 设计中的 `detectAIService()` 方法返回 `AIServiceInfo`，这里将其扩展为完整的 Profile 查询：

```typescript
// WebBridge L3 ai-service-detector.ts
detectAIService(): AIServiceProfile | null {
  const url = this.getURL();
  return AI_SERVICE_PROFILES.find(p => p.urlPattern.test(url)) ?? null;
}
```

---

## 四、场景 A：标注模式（Note + AI → Thought）

### 4.1 核心交互

用户正在阅读/编写一篇 Note，选中某段内容后向 AI 提问，回复作为 Thought 锚定到选中位置。

**这是 `note-thought` 协议的 AI 增强**——不是新协议，而是在 Thought 创建流程中增加 "AI 生成内容" 的路径。

### 4.2 交互时序

```
用户选中 Note 中的一段内容
  → 右键菜单 / 快捷键 "问 AI"
  │
  ├─① NoteEditor: 在选中位置添加 thought mark（pending 状态）
  │    mark attrs: { thoughtId, type: 'ai-pending', anchorText }
  │
  ├─② NoteEditor → main 进程:
  │    IPC 'ai-workflow:ask' {
  │      prompt: 选中文本（Markdown 格式）,
  │      serviceId: 当前选择的 AI 服务,
  │      noteId, thoughtId
  │    }
  │
  ├─③ main 进程 → 后台 WebView:ai:
  │    WebBridge.request(prompt)
  │    ├─ writer.pasteText(inputBox, prompt)
  │    ├─ writer.press('Enter')
  │    ├─ interceptor 等待 SSE 流完成
  │    └─ 返回完整 Markdown 回复
  │
  ├─④ main 进程 → L4 ResultParser:
  │    Markdown → ExtractedBlock[]
  │
  ├─⑤ main 进程 → ThoughtStore + GraphStore:
  │    创建 ThoughtRecord {
  │      type: 'ai-response',
  │      doc_content: ExtractedBlock[] → Atom[],
  │      anchor_type, anchor_text, anchor_pos
  │    }
  │    graphStore.relateNoteToThought(noteId, thoughtId, edge)
  │
  ├─⑥ main 进程 → NoteView (ViewMessage):
  │    { protocol: 'note-thought', action: 'create', payload: { thoughtId, ... } }
  │    → NoteEditor: thought mark 状态从 'ai-pending' → 正常
  │
  └─⑦ main 进程 → ThoughtView (ViewMessage):
       { protocol: 'note-thought', action: 'ai-response-ready', payload: { thoughtId, blocks } }
       → ThoughtPanel: 新增 ThoughtCard，显示 AI 回复内容
```

### 4.3 thought mark 的 AI 状态

扩展 thought mark 的 attrs，增加 AI 请求状态：

```typescript
// thought mark attrs 扩展
{
  thoughtId: string;
  thoughtType: ThoughtType | 'ai-pending' | 'ai-error';
  // 'ai-pending'：已发送请求，等待 AI 回复
  // 'ai-error'：AI 回复失败
  // 回复成功后切换为正常的 ThoughtType（默认 'thought'）
}
```

视觉表现：
- `ai-pending`：锚点高亮 + 旋转动画（表示正在等待 AI）
- `ai-error`：红色下划线 + 点击可重试
- 正常状态：与手动创建的 Thought 一致

### 4.4 后台 WebView:ai 管理

标注模式中，WebView:ai **不占 Slot**，以隐藏的后台 webview 运行：

```typescript
// main 进程管理后台 AI webview
class BackgroundAIWebview {
  private webview: WebContents | null = null;
  private bridge: IWebBridge | null = null;
  private currentService: AIServiceProfile;

  // 懒初始化：首次 "问 AI" 时才创建
  async ensureReady(serviceId: string): Promise<IWebBridge> {
    if (!this.webview) {
      this.webview = await this.createHiddenWebview();
      this.bridge = new WebBridge();
      this.bridge.attach(this.webview);
    }
    // 如果服务不同，导航到新服务
    if (this.currentService.id !== serviceId) {
      const profile = getAIServiceProfile(serviceId);
      await this.webview.loadURL(profile.newChatUrl);
      this.currentService = profile;
    }
    return this.bridge;
  }

  // 用户关闭所有 AI 功能时销毁
  destroy(): void { ... }
}
```

**懒初始化**：不打开 AI 功能时不创建 webview，第一次"问 AI"时才启动。遵循 P6 懒触发原则。

### 4.5 "问 AI" 的触发 UI

#### 选中文本后的浮动工具栏

在 NoteView 现有的 FloatingToolbar 中增加 AI 按钮：

```
[B] [I] [U] [S] [Code] [Link] ... [🤖 问 AI ▾]
                                        ↓
                                  ┌────────────────┐
                                  │ ✦ ChatGPT      │
                                  │ ✦ Claude       │
                                  │ ✦ Gemini       │
                                  ├────────────────┤
                                  │ 🔧 自定义 prompt│
                                  └────────────────┘
```

- 直接点击 "问 AI"：使用默认 AI 服务，将选中文本原样发送
- 下拉选择：切换 AI 服务
- "自定义 prompt"：弹出输入框，用户可以在选中文本基础上添加额外指令

#### 右键菜单

```
复制
粘贴
───────
问 AI          → [ChatGPT] [Claude] [Gemini]
创建 Thought   → [💭 思考] [❓ 疑问] [⭐ 重要] ...
───────
```

### 4.6 Thought 中的 AI 回复展示

AI 生成的 ThoughtCard 与手动创建的 ThoughtCard 视觉上有区分：

```
┌─ ThoughtCard ──────────────────────────────┐
│ 🤖 Claude                    2026-04-12 │
│ ─────────────────────────────────────────── │
│ 这段公式是麦克斯韦方程组的法拉第定律，     │
│ 它描述了变化的磁场如何产生电场：             │
│                                             │
│ $$ \nabla \times \mathbf{E} = ...  $$      │
│                                             │
│ 物理含义是...                               │
├─────────────────────────────────────────────┤
│ [追问] [复制] [编辑] [转为手动 Thought]     │
└─────────────────────────────────────────────┘
```

- **追问**：基于当前回复继续向 AI 提问（创建新的 ThoughtCard）
- **编辑**：直接编辑 AI 回复内容（与手动 Thought 完全一样）
- **转为手动 Thought**：移除 AI 标记，变成普通 Thought

### 4.7 扩展 note-thought 协议

在现有 `note-thought` 协议的 action 中增加 AI 相关消息：

| action | 方向 | payload | 说明 |
|--------|------|---------|------|
| `ai-ask` | Note → Thought | `{ thoughtId, prompt, serviceId }` | 通知 Thought 面板显示 pending 卡片 |
| `ai-response-ready` | Main → Thought | `{ thoughtId, blocks: ExtractedBlock[] }` | AI 回复就绪，填充 ThoughtCard 内容 |
| `ai-error` | Main → Note + Thought | `{ thoughtId, error: string }` | AI 回复失败 |
| `ai-followup` | Thought → Main | `{ parentThoughtId, prompt }` | 追问（基于某条 AI 回复继续提问） |

其余 action（`create`、`activate`、`scroll-sync`、`delete` 等）完全复用现有 `note-thought` 协议，不修改。

---

## 五、场景 B：对话模式（ChatNote）

### 5.1 核心交互

用户进行独立的 AI 对话。与场景 A 的根本区别：**Note 本身就是对话记录**，底部有富文本输入框供用户提问。

### 5.2 ChatNote 的本质

ChatNote 不是新的 ViewType，而是 **NoteView 的一个变体**（`variant: 'chat'`）：

- 上下两个区域，都是**完整的 NoteView 编辑器实例**
- 上方：对话历史（You / AI 交替的 Block 序列），可编辑
- 下方：输入区域，一个完整的 NoteView，发送后内容转移到上方

```typescript
// ChatNote 的组件结构
<ChatNoteView>
  <NoteToolbar variant="chat" />
  <ChatHistory>               {/* 对话历史区域 — 完整 NoteView 实例 */}
    <NoteEditor />            {/* 完整的 ProseMirror 编辑器，所有 Block 能力 */}
  </ChatHistory>
  <ChatInputBar>              {/* 输入区域 — 另一个完整 NoteView 实例 */}
    <NoteEditor />            {/* 完整的 ProseMirror 编辑器，所有 Block 能力 */}
    <InputFooter>             {/* 输入区域底部 */}
      [Claude ▾] [发送 ▶]    {/* 仅 AI 服务切换 + 发送按钮 */}
    </InputFooter>
  </ChatInputBar>
</ChatNoteView>
```

**ChatInputBar 就是一个完整的 NoteView**——斜杠命令、Markdown 快捷输入、公式编辑、代码块、图片拖拽、表格、缩进、拖拽排序……所有 Note 的编辑能力一个不少。用户在 NoteView 里能做的，在 ChatInputBar 里都能做。

### 5.3 ChatInputBar：完整的 NoteView 输入区域

ChatInputBar **就是一个完整的 NoteView 实例**，不是简化版，不是 mini 版。所有 Note 的编辑能力一个不少。

#### 5.3.1 编辑器实例

```typescript
interface ChatInputBarProps {
  onSend: (doc: ProseMirrorNode) => void;      // 发送回调（传递完整文档）
  serviceId: string;                            // 当前 AI 服务
  onServiceChange: (id: string) => void;        // 切换 AI 服务
}
```

- **Schema**：完整的 BlockRegistry schema，与 NoteView 100% 一致
- **插件**：完整的 NoteView 插件栈——斜杠命令、Markdown 快捷输入、FloatingToolbar、公式编辑、代码高亮、图片拖拽、表格编辑、缩进系统、Block 拖拽排序……全部复用
- **尺寸**：默认 3 行高，内容超出时自动扩展，最大不超过视口 40%
- **快捷键差异**：`Cmd+Enter` 发送，`Enter` 正常换行（保持编辑器内的换行习惯不变）

#### 5.3.2 与普通 NoteView 的唯一差异

| | NoteView | ChatInputBar |
|---|---|---|
| 编辑能力 | 完整 | **完整（一致）** |
| 发送行为 | 无 | `Cmd+Enter` 将内容转移到对话历史，然后清空输入区 |
| 内容去向 | 自动保存到 SurrealDB | 发送后 → 追加到上方对话历史文档（持久化在那里） |
| 底部 UI | 无 | `[Claude ▾] [发送 ▶]` |
| Toolbar | 完整 NoteToolbar | 隐藏（编辑器内 FloatingToolbar 仍在） |

**发送后的内容流向**：ChatInputBar 中的内容不是"消失"，而是**转移到对话历史文档**。用户的提问（原样保留富文本格式）+ AI 的回复一起追加到上方，形成一个完整的、可编辑的对话文档。这个文档就是一个普通 Note，自动持久化到 SurrealDB。

```
┌─ ChatInputBar ─────────────────────────────────────────────┐
│                                                            │
│  完整的 NoteView 编辑器                                     │
│  所有 Block 能力：/code /math /table /image /todo ...       │
│  FloatingToolbar、Markdown 快捷键、拖拽排序 — 全部可用       │
│                                                            │
├────────────────────────────────────────────────────────────┤
│                             [Claude ▾]  [发送 ▶]           │
│                                  ↑          ↑              │
│                            AI服务切换   发送(Cmd+Enter)     │
└────────────────────────────────────────────────────────────┘
```

#### 5.3.3 发送流程

```
用户在 ChatInputBar 编写提问（可以包含公式、代码、图片等）
  → 点击发送 / Enter
  │
  ├─① 提取输入内容
  │    mini ProseMirror doc → 两份输出:
  │    a) ProseMirror Nodes → 插入对话历史（保留富文本格式）
  │    b) Nodes → Markdown 字符串 → 发给 AI（AI 只理解文本）
  │    c) 图片/文件 → 单独处理（上传或粘贴）
  │
  ├─② 追加 User 消息到对话历史
  │    对话历史编辑器 ProseMirror transaction:
  │    tr.insert(doc.content.size, calloutBlock('问题', nodes))
  │
  ├─③ 清空 ChatInputBar 输入区（内容已转移到上方对话历史）
  │    ChatInputBar editor: setContent(emptyDoc)
  │
  ├─④ 发送到 AI Web
  │    ViewMessage { protocol: 'ai-chat', action: 'ac:send-prompt' }
  │    → Left Slot WebView:ai
  │    → WebBridge.request(markdownText)
  │
  ├─⑤ 显示 "AI 正在回复..." 占位
  │    对话历史追加 loading placeholder block
  │
  ├─⑥ SSE 流结束，收到回复
  │    ViewMessage { protocol: 'ai-chat', action: 'ac:append-response' }
  │    → ResultParser: Markdown → ExtractedBlock[]
  │    → 替换 loading placeholder → 插入 AI 回复 Blocks
  │
  └─⑦ 对话历史追加分隔线
       编辑器滚动到底部
```

### 5.4 对话历史区域的 Block 结构

**不发明新的 Block 类型**，直接复用已有的 callout 和 toggle：

- **问题**：callout block（醒目标识，一眼能看到）
- **回答**：toggle block（可折叠，长回复不淹没文档）

```
文档结构示例：

doc
  ├─ callout { label: '问题' }
  │    ├─ paragraph: "请解释以下公式的物理意义："
  │    └─ math_block: "E = mc^2"
  │
  ├─ toggle { label: '回答 (Claude)' }
  │    ├─ paragraph: "这是爱因斯坦的质能方程..."
  │    ├─ math_block: "E = mc^2"
  │    └─ paragraph: "其中 E 代表能量..."
  │
  ├─ callout { label: '问题' }
  │    └─ paragraph: "那它和动量的关系是？"
  │
  └─ toggle { label: '回答 (ChatGPT)' }
       ├─ paragraph: "完整的质能关系实际上是..."
       └─ math_block: "E^2 = (pc)^2 + (mc^2)^2"
```

#### 为什么不新建 chat_turn Block

| 理由 | 说明 |
|------|------|
| 零开发成本 | callout 和 toggle 都是已有 Block，不需要新增 schema / nodeView / CSS |
| 聚焦 | toggle 折叠后只看到 "回答 (Claude)" 一行，长回复不展开不占空间 |
| 通用 | 不局限于 AI 场景——用户手动整理 Q&A 笔记、eBook 摘录也是同样格式 |
| 一致性 | 用户已经熟悉 callout 和 toggle 的交互方式，无学习成本 |

#### toggle 标题的来源标记

toggle 的标题行自动填充来源信息：

```
▸ 回答 (Claude)           ← AI 回复，标记服务名
▸ 回答 (ChatGPT)          ← AI 回复，标记服务名
▸ 摘录 (《热力学导论》P42) ← eBook 提取，标记书名和页码
```

这个标题由系统自动生成，用户可以随时修改。

### 5.5 ViewMessage 协议定义

协议 ID：`ai-chat`

#### 5.5.1 SEND_PROMPT — 发送提问

**方向：Right Slot (ChatNote) → Left Slot (WebView:ai)**

```typescript
{
  protocol: 'ai-chat',
  action: 'ac:send-prompt',
  payload: {
    markdown: string;                  // 提问内容（Markdown 格式，供 AI 阅读）
    images?: string[];                 // 图片文件路径列表
    files?: string[];                  // 附件文件路径列表
    turnIndex: number;                 // 对话轮次
  }
}
```

#### 5.5.2 APPEND_RESPONSE — AI 回复

**方向：Left Slot (WebView:ai) → Right Slot (ChatNote)**

SSE 流结束后，将完整回复发送到 ChatNote。

```typescript
{
  protocol: 'ai-chat',
  action: 'ac:append-response',
  payload: {
    assistantBlocks: ExtractedBlock[];  // AI 回复解析后的 Block 结构
    rawMarkdown: string;                // 原始 Markdown（备份）
    serviceId: string;                  // 回复的 AI 服务
    turnIndex: number;
    timestamp: number;
  }
}
```

#### 5.5.3 RESPONSE_ERROR — 回复失败

**方向：Left Slot → Right Slot**

```typescript
{
  protocol: 'ai-chat',
  action: 'ac:response-error',
  payload: {
    error: string;
    turnIndex: number;
    retryable: boolean;
  }
}
```

#### 5.5.4 SWITCH_SERVICE — 切换 AI 服务

**方向：Right Slot → Left Slot**

```typescript
{
  protocol: 'ai-chat',
  action: 'ac:switch-service',
  payload: {
    serviceId: 'chatgpt' | 'claude' | 'gemini';
  }
}
```

### 5.6 SSE 拦截与实时同步

对话模式的 SSE 拦截流程与标注模式共享 WebBridge L3 能力，但消费方式不同：

```
WebBridge SSE 拦截器（三服务策略，WebBridge-设计.md §5.3）
  │
  ├─ 场景 A（标注模式）
  │    SSE 完成 → IPC 回调 → main 进程 → ThoughtStore 写入 → ViewMessage 到 ThoughtView
  │
  └─ 场景 B（对话模式）
       SSE 完成 → ViewMessage { ac:append-response } → ChatNote 追加 Block
```

**关键**：拦截器返回完整 Markdown 字符串（不是 DOM），经 ResultParser 解析为 ExtractedBlock[]。

### 5.7 ChatNote 的持久化

ChatNote 就是普通的 Note，存储在 `note` 表中。额外通过 `conversation` 表 + `synced_to` edge 关联到 AI 会话元数据：

```sql
DEFINE TABLE conversation SCHEMAFULL;
DEFINE FIELD service     ON conversation TYPE string;     -- 'chatgpt' | 'claude' | 'gemini'
DEFINE FIELD url         ON conversation TYPE option<string>;
DEFINE FIELD title       ON conversation TYPE option<string>;
DEFINE FIELD startedAt   ON conversation TYPE datetime;
DEFINE FIELD lastSyncAt  ON conversation TYPE datetime;
DEFINE FIELD turnCount   ON conversation TYPE int;

DEFINE TABLE synced_to SCHEMAFULL TYPE RELATION
  FROM conversation TO note;
```

ChatNote 命名规则：`AI Chat — {ServiceName} — {YYYY-MM-DD HH:mm}`

### 5.8 用户可编辑性

**核心原则：ChatNote 中的所有内容都是普通 Block，用户拥有完全编辑权。**

| 操作 | 支持 |
|------|------|
| 修改 AI 回复文本 | ✓ 展开 toggle 直接编辑 |
| 删除整轮对话 | ✓ 删除 callout + toggle |
| 在对话之间插入笔记 | ✓ 在 callout/toggle 之间插入任意 block |
| 修改自己的提问 | ✓ 编辑 callout 内部内容 |
| 拖拽重排 | ✓ |
| 添加 Thought 标注 | ✓ 通过 note-thought 协议 |

---

## 六、场景 C：浏览同步模式（AI Web + SyncNote）

### 6.1 核心交互

用户直接在 AI Web 上聊天（保持原有习惯），右侧 Note 自动实时同步每一轮对话。不改变用户使用 AI 的方式，只在旁边多一个"记录本"。

### 6.2 同步时序

```
用户在 AI Web 输入提问 → 点击发送
  │
  ├─① WebBridge 捕获 user 消息 ──────────────────────────────────→ SyncNote 追加 callout
  │    (DOM 监听 inputBox 清空事件)                                   callout { label: '问题' }
  │
  ├─② AI 开始流式回复
  │    WebBridge SSE 拦截器开始捕获 token 流
  │    （此阶段不同步到 Note——等流结束）
  │
  ├─③ SSE 流结束（isComplete = true）
  │    WebBridge interceptor 获得完整 Markdown 回复
  │    │
  │    ├─ L4 ResultParser: Markdown → ExtractedBlock[]
  │    ├─ 构造 ViewMessage { protocol: 'ai-sync', action: 'as:append-turn' }
  │    └─ 发送到 Right Slot (SyncNote)
  │
  └─④ SyncNote (NoteView) 接收 ViewMessage
       ├─ ExtractedBlock[] → ProseMirror Nodes
       ├─ 追加到编辑器文档末尾（callout + toggle blocks）
       └─ 标记来源 ExtractionSource { type: 'ai-conversation', ... }
```

### 6.3 User 消息捕获

用户在 AI Web 上打字发送，需要从 DOM 侧捕获——监听输入框"清空"事件：

```typescript
// 注入到 AI Web 页面的捕获脚本
// 策略：输入框从有内容变为空 → 用户刚发送消息
// 三个 AI 服务发送后都会清空输入框，这是最可靠的统一信号
// mirro-desktop 已验证此策略在三服务上稳定

let lastInput = '';
const observer = new MutationObserver(() => {
  const inputEl = document.querySelector(profile.selectors.inputBox);
  const currentInput = inputEl?.textContent?.trim() ?? '';

  if (lastInput.length > 0 && currentInput.length === 0) {
    window.__krig_last_user_message = lastInput;
    window.postMessage({ type: 'krig:user-message-sent', text: lastInput }, '*');
  }
  lastInput = currentInput;
});
```

### 6.4 ViewMessage 协议定义

协议 ID：`ai-sync`

#### APPEND_TURN — 追加一轮对话

**方向：Left Slot (WebView:ai) → Right Slot (NoteView)**

```typescript
{
  protocol: 'ai-sync',
  action: 'as:append-turn',
  payload: {
    turn: {
      index: number;                     // 对话轮次
      userMessage: string;               // 用户提问原文
      assistantBlocks: ExtractedBlock[]; // AI 回复解析后的 Block 结构
      rawMarkdown: string;               // AI 回复原始 Markdown（备份）
      timestamp: number;
    };
    source: {
      serviceId: 'chatgpt' | 'claude' | 'gemini';
      conversationUrl: string;
      conversationTitle?: string;
    };
  }
}
```

#### SYNC_STATUS — 同步状态通知

**方向：双向**

```typescript
{
  protocol: 'ai-sync',
  action: 'as:sync-status',
  payload: {
    status: 'connecting' | 'syncing' | 'paused' | 'error';
    message?: string;
  }
}
```

#### SEND_TO_AI — 从 SyncNote 发送内容到 AI

**方向：Right Slot → Left Slot**

用户也可以从 SyncNote 侧选中内容发回 AI 输入框（反向操作）。

```typescript
{
  protocol: 'ai-sync',
  action: 'as:send-to-ai',
  payload: {
    content: {
      type: 'text' | 'image' | 'file';
      text?: string;
      imagePath?: string;
      filePath?: string;
    };
    action: 'paste' | 'paste-and-send';
  }
}
```

### 6.5 SyncNote 的创建与管理

| 事件 | 行为 |
|------|------|
| 打开浏览同步模式 | 自动创建 SyncNote，标题 `AI Sync — Claude — 2026-04-12 14:30` |
| 切换 AI 服务 | 创建新 SyncNote |
| AI Web 中新建对话 | 创建新 SyncNote |
| AI Web 中切换已有对话 | 查找关联 SyncNote，有则恢复，无则新建 |
| 关闭浏览同步模式 | 当前 SyncNote 自动保存 |

### 6.6 同步控制 UI

在 WebView:ai 的 Toolbar 上增加同步状态指示器：

```
[← →] [🔄] [Claude ▾]          [● 同步中] [⏸]
                                     ↑        ↑
                                 状态灯    暂停/恢复
```

| 状态 | 指示 | 说明 |
|------|------|------|
| `connecting` | ○ 灰色 | 正在连接 SSE 拦截器 |
| `syncing` | ● 绿色 | 正常同步中 |
| `paused` | ⏸ 黄色 | 用户手动暂停 |
| `error` | ● 红色 | SSE 拦截失败 |

暂停期间的对话不会同步（不补发——用户选择暂停即表示不需要）。

### 6.7 SyncNote 与 ChatNote 的区别

| | SyncNote（场景 C） | ChatNote（场景 B） |
|---|---|---|
| 提问方式 | 用户在 AI Web 上输入 | 用户在 ChatInputBar 中输入 |
| 有 ChatInputBar | **否** | 是 |
| Note 角色 | 被动记录 | 主动交互 |
| 用户编辑 | 完全支持（同步后可编辑） | 完全支持 |
| 文档结构 | callout（问题）+ toggle（回答） | callout（问题）+ toggle（回答） |
| 视觉样式 | 相同 | 相同 |
| NoteView variant | `'sync'` | `'chat'` |

两者的文档结构（callout + toggle）和视觉样式完全一致，区别仅在于：谁驱动提问、是否有 ChatInputBar。

---

## 七、从 eBook 发送到 AI（跨场景通用）

### 6.1 场景

用户在阅读 eBook 时，选中一段文字或截图，发送到 AI 提问。

### 6.2 Slot 问题

EBookView 不在 AI 的 Slot 布局中。两种消费路径：

**路径 A：eBook → 标注模式（Thought）**

如果 eBook 已经打开了 ThoughtView（右侧 Slot），可以复用场景 A 的逻辑——选中内容问 AI，回复写入 Thought。

```
[eBook + ThoughtView] ← eBook 也支持 Thought 锚定
选中内容 → "问 AI" → 后台 WebView:ai → Thought
```

> 这依赖 thought-design.md §3.3 中预留的 `ebook ──thought_of──→ thought` 扩展路径。

**路径 B：eBook → 对话模式（跨 Tab）**

如果用户想把 eBook 内容发到 AI Chat 对话中：

```
Tab 1: [eBook]            ← 正常阅读
Tab 2: [AI Web] [ChatNote] ← AI Workspace

eBook 选中 → "发送到 AI Chat" → 跨 Tab IPC → ChatNote 输入框填充
```

跨 Tab 通信通过 main 进程路由：

```typescript
// eBook renderer → main → ChatNote renderer
ipcRenderer.send('ai-workflow:send-to-chat', {
  type: 'text',
  text: selectedText,
  action: 'fill'     // 填充到 ChatInputBar，不自动发送
});
```

---

## 八、协议注册

### 8.1 WorkMode 注册

```typescript
// app.ts registerPlugins()

// 场景 A 不需要新的 WorkMode——复用 note + thought

// 场景 B：AI Chat 模式
workModeRegistry.register({
  id: 'ai-chat',
  viewType: 'web',
  variant: 'ai',
  defaultSlotConfig: {
    left: { viewType: 'web', variant: 'ai' },
    right: { viewType: 'note', variant: 'chat' },
  },
});

// 场景 C：AI Sync 模式（浏览同步）
workModeRegistry.register({
  id: 'ai-sync',
  viewType: 'web',
  variant: 'ai',
  defaultSlotConfig: {
    left: { viewType: 'web', variant: 'ai' },
    right: { viewType: 'note', variant: 'sync' },
  },
});
```

### 8.2 Protocol 注册

```typescript
// 场景 A：复用 note-thought 协议（增加 AI 相关 action）
// 不需要额外注册

// 场景 B：AI Chat 协议
protocolRegistry.register({
  id: 'ai-chat',
  match: {
    left: { type: 'web', variant: 'ai' },
    right: { type: 'note', variant: 'chat' },
  },
  messages: [
    'ac:send-prompt',
    'ac:append-response',
    'ac:response-error',
    'ac:switch-service',
  ],
});

// 场景 C：AI Sync 协议
protocolRegistry.register({
  id: 'ai-sync',
  match: {
    left: { type: 'web', variant: 'ai' },
    right: { type: 'note', variant: 'sync' },
  },
  messages: [
    'as:append-turn',
    'as:sync-status',
    'as:send-to-ai',
  ],
});
```

### 8.3 NavSide 注册

```typescript
// 场景 B + C 共用 NavSide（AI 服务切换 + 历史对话列表）
navSideRegistry.register({
  workModeId: 'ai-chat',
  actionBar: { title: 'AI 对话', actions: [
    { id: 'new-chat', label: '+ 新对话' },
  ]},
  contentType: 'ai-chat-history',   // 历史对话列表
});

navSideRegistry.register({
  workModeId: 'ai-sync',
  actionBar: { title: 'AI 同步', actions: [
    { id: 'new-sync', label: '+ 新同步' },
  ]},
  contentType: 'ai-sync-history',   // 历史同步列表
});
```

---

## 九、与 Thought / 知识图谱的集成

### 9.1 场景 A 的图关系

```
note:article_xxx
  ──thought_of──→ thought:ai_xxx { type: 'ai-response', from: { serviceId: 'claude' } }
  ──thought_of──→ thought:manual_xxx { type: 'thought' }
```

AI 生成的 Thought 和手动创建的 Thought 在图结构上完全一致，只是 `type` 不同。

### 9.2 场景 B / C 的图关系

```
conversation:claude_xxx
  ──synced_to──→ note:chat_xxx (ChatNote / SyncNote)
                    ──thought_of──→ thought:xxx（对 AI 回复的标注）
                    ──references──→ note:other_note
                    ──extracted_from──→ ebook:xxx
```

ChatNote 和 SyncNote 都是普通 Note，通过 Note 这个中心节点融入知识图谱。

### 9.3 跨场景关联

```
ebook:thermal_dynamics
  ──thought_of──→ thought:ai_explain_entropy (场景 A：阅读时问 AI)

note:chat_xxx (场景 B 的 ChatNote)
  ──references──→ ebook:thermal_dynamics (用户在对话中引用了这本书)
```

---

## 十、模块结构

```
src/plugins/web/
  components/
    SyncStatusIndicator.tsx         ← AI 请求/同步状态指示器（场景 A/C 共用）
  ai-workflow/
    ai-service-profiles.ts          ← 三服务 Profile 注册表
    ai-workflow-types.ts            ← 共享类型定义（三场景通用）
    background-ai-webview.ts        ← 后台 AI webview 管理（场景 A 用）
    sync-engine.ts                  ← SSE 事件 → ViewMessage 构造（场景 C 用）
    turn-builder.ts                 ← 单轮对话构造（user 捕获 + assistant 解析）
    user-message-capture.js         ← 注入到 AI Web 的 user 消息捕获脚本（场景 C 用）

src/plugins/note/
  ai-workflow/
    ask-ai-action.ts                ← "问 AI" 菜单 action（场景 A，触发后台请求）
    ai-thought-creator.ts           ← AI 回复 → ThoughtRecord 创建（场景 A）
  chat/
    ChatNoteView.tsx                ← ChatNote 顶层组件（场景 B）
    ChatInputBar.tsx                ← 底部输入区域（完整 NoteView 实例 + 发送按钮）
    chat-send-handler.ts            ← 发送逻辑（场景 B: Nodes→Markdown + callout 追加 + ViewMessage）
    chat-receive-handler.ts         ← 接收逻辑（场景 B + C: ExtractedBlock→PM Nodes + 追加）
  sync/
    sync-note-receiver.ts           ← SyncNote 接收端（场景 C: ViewMessage → PM 追加）
    send-to-ai-action.ts            ← "发送到 AI" 右键菜单（场景 C: Note→AI Web）

src/shared/types/
  ai-service-types.ts               ← AIServiceProfile 类型定义
  extraction-types.ts               ← ExtractionSource（已有，增加 ai-conversation 字段）
```

---

## 十一、实施路径

### Phase 1：场景 A — 标注模式（优先级最高）

对已有文章向 AI 提问，回复提取到 Thought。

```
□  ai-service-profiles.ts — 三服务配置表
□  background-ai-webview.ts — 后台 AI webview 懒初始化
□  ask-ai-action.ts — FloatingToolbar "问 AI" 按钮 + 右键菜单
□  ai-thought-creator.ts — AI 回复 → ThoughtRecord + GraphStore
□  扩展 note-thought 协议 — 增加 ai-ask / ai-response-ready / ai-error action
□  扩展 thought mark attrs — 增加 ai-pending / ai-error 状态
□  ThoughtCard AI 变体 — 显示 AI 图标 + 追问/编辑按钮
```

### Phase 2：场景 C — 浏览同步模式

保持用户使用 AI Web 的原有习惯，右侧 Note 自动同步。**与 Phase 1 共享 AI Service Profile 和 SSE 拦截基础设施。**

```
□  user-message-capture.js — 注入到 AI Web 的 user 消息捕获脚本
□  sync-engine.ts — SSE 完成 → 构造 ViewMessage → 发送
□  turn-builder.ts — 单轮对话打包（user + assistant）
□  sync-note-receiver.ts — SyncNote 接收端（callout + toggle 追加到 PM 文档）
□  SyncStatusIndicator.tsx — Toolbar 同步状态灯 + 暂停/恢复
□  ai-sync 协议注册 — WorkMode + Protocol + NavSide
□  conversation 表 + synced_to edge — SurrealDB Schema
```

### Phase 3：场景 B — 对话模式

独立 ChatNote，底部完整 NoteView 输入区。**复用 Phase 2 的 callout/toggle 结构和接收逻辑。**

```
□  ChatNoteView.tsx — 对话历史 + ChatInputBar 布局
□  ChatInputBar.tsx — 完整 NoteView 实例 + Cmd+Enter 发送 + AI 服务切换
□  chat-send-handler.ts — Nodes → Markdown + ViewMessage 发送
□  chat-receive-handler.ts — 复用 sync-note-receiver + 额外的 loading 状态管理
□  ai-chat 协议注册 — WorkMode + Protocol + NavSide
```

### Phase 4：eBook 集成 + 会话管理

```
□  eBook → 标注模式（复用 thought_of 扩展路径）
□  eBook → 对话/同步模式（跨 Tab IPC）
□  NavSide 历史对话/同步列表
□  会话切换时自动创建/恢复 ChatNote / SyncNote
```

---

## 十二、已确认的决策

| # | 问题 | 决策 | 讨论日期 |
|---|------|------|---------|
| 1 | AI 功能的使用场景 | **三种场景**：A 标注模式（Note→AI→Thought）+ B 对话模式（ChatNote 富文本对话）+ C 浏览同步模式（AI Web 直接聊天 + Note 实时同步） | 2026-04-12 |
| 2 | 场景 A/B：用户在哪里提问 | **在 Note 侧提问**。Note 有更丰富的表达能力（公式/代码/图表） | 2026-04-12 |
| 3 | 场景 C：保留原有习惯 | **用户直接在 AI Web 聊天**，旁边 Note 自动同步记录。不改变使用 AI 的习惯 | 2026-04-12 |
| 4 | AI Web 的角色 | 场景 A：隐藏后台。场景 B：Left Slot（可折叠）。**场景 C：Left Slot（主交互面）** | 2026-04-12 |
| 5 | 支持哪些 AI 服务 | **只注册 ChatGPT / Claude / Gemini 三大服务**，未来按需扩展 | 2026-04-12 |
| 6 | ChatNote 的聊天输入框 | **完整的 NoteView 实例**，不是简化版。所有 Note 编辑能力一个不少，仅增加 `Cmd+Enter` 发送和 AI 服务切换 | 2026-04-12 |
| 7 | 场景 A 的协议 | **复用 note-thought 协议**，扩展 AI 相关 action，不新建协议 | 2026-04-12 |
| 8 | 场景 B 的协议 | **新建 ai-chat 协议**，ChatNote 是 NoteView variant:'chat' | 2026-04-12 |
| 9 | 场景 C 的协议 | **新建 ai-sync 协议**，SyncNote 是 NoteView variant:'sync' | 2026-04-12 |
| 10 | 同步粒度 | **流结束后整轮同步**。不做 token 级流式追加（避免 ProseMirror 频繁 transaction） | 2026-04-12 |
| 11 | 已同步内容是否可编辑 | **完全可编辑**。所有内容都是普通 Block，用户拥有完全控制权 | 2026-04-12 |
| 12 | eBook → AI 的方案 | **两条路径**：Thought 标注（复用 thought_of）+ 跨 Tab IPC 到 ChatNote/SyncNote | 2026-04-12 |
| 13 | 暂停期间的对话是否补发（场景 C） | **不补发**。用户选择暂停即表示不需要 | 2026-04-12 |
