# WebView 设计

> 状态：设计中
> 参考：mirro-desktop 的 browser 模块（验证原型）
> ViewType: `'web'`，变体: `'ai'`
>
> **设计约束**：遵循 `principles.md`（框架与插件分离、模块自包含、注册制）和 `design-philosophy.md`（P1 组织思考、P5 Tab 即思考容器）

---

## 一、定位与职责

### 1.1 在 KRIG 思考系统中的角色

WebView 不是通用浏览器，而是 KRIG 思考系统的**知识入口**：

```
浏览网页 → 发现有价值内容 → 提取到 Note → 标注 → 创建 Thought → 知识图谱
```

遵循 P1 原则（组织思考）：WebView 帮助用户从互联网获取思考材料，但不替代用户的判断——提取什么、如何组织、如何关联，由用户决定。

### 1.2 两种模式

| WorkMode | ViewType | variant | 说明 | NavSide 内容 |
|----------|----------|---------|------|-------------|
| `web` | `web` | — | 网页浏览 + 内容提取 | 书签 + 历史 |
| `ai` | `web` | `ai` | AI 对话（ChatGPT / Claude / Gemini） | AI 服务选择 |

### 1.3 不做的功能

| 不做 | 原因 |
|------|------|
| 多标签浏览 | Workspace Tab 系统已有此能力 |
| 下载管理 | 操作系统的职责 |
| 扩展插件 | 不是浏览器 |
| 密码管理 | 安全工具的职责 |

---

## 二、核心架构

### 2.1 遵循 View 接口契约

WebView 和 NoteView、EBookView 一样，遵循 `view.md` 的统一结构：

```
┌─ WebView ──────────────────────────────┐
│ [Toolbar]                              │  ← View 内部的 React 组件（不是独立 View）
│   [← →] [🔄] [URL bar] [★] [📋]      │
│ ─────────────────────────────────────── │
│                                        │
│      <webview> 标签                     │  ← 嵌入外部网页
│      (外部网页内容)                      │
│                                        │
└────────────────────────────────────────┘
```

**关键设计决策**：

- **Toolbar 是 View 内部的 React 组件**，不是独立的 WebContentsView
  - 遵循 `principles.md` §五："每个 View 拥有自己的 Toolbar"
  - 遵循 `principles.md` §五-7："Overlay 属于子视图"
- **WebView 有自己的 `web.html` + React 组件**，和 NoteView / EBookView 结构一致
  - 内部用 Electron `<webview>` 标签嵌入外部网页
  - React 组件管理 Toolbar + webview 状态 + Overlays
- **webview 标签**而非独立 WebContentsView 加载网页
  - webview 标签在 View 的 React 组件内部，受 View 生命周期管理
  - 支持 preload 注入、CSP bypass、webRequest 拦截

### 2.2 与其他 View 的统一性

| | NoteView | EBookView | WebView |
|---|---|---|---|
| HTML 入口 | `note.html` | `ebook.html` | `web.html` |
| Vite 配置 | `vite.note.config.mts` | `vite.ebook.config.mts` | `vite.web.config.mts` |
| Toolbar | React 组件 | React 组件 | React 组件 |
| Content | ProseMirror 编辑器 | Canvas/foliate-js | `<webview>` 标签 |
| forge renderer | `note_view` | `ebook_view` | `web_view` |

### 2.3 View 生命周期

```
WebView 创建（WorkMode 切换到 Web）
  │
  ├── 渲染 Toolbar + webview 容器
  │
  ├── 恢复上次 URL（从 WorkspaceState）
  │     └── webview.loadURL(savedUrl)
  │
  ├── 用户导航（输入 URL / 点击链接）
  │     └── webview 内部导航，Toolbar 同步 URL 显示
  │
  ├── WorkMode 切走 → WebView hide()（webview 状态保留）
  │
  └── Workspace 关闭 → WebView destroy()（保存 URL 到 WorkspaceState）
```

---

## 三、WebToolbar 设计

### 3.1 布局

```
┌─────────────────────────────────────────────────────────────────┐
│ [←] [→] [🔄] │ https://example.com          │ [★] [📋 Extract] │
│  导航按钮      │      地址栏                   │  操作按钮        │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 功能清单

#### Left 区域（导航）

| 功能 | 说明 | 快捷键 |
|------|------|--------|
| 后退 | 浏览历史后退 | Cmd+[ |
| 前进 | 浏览历史前进 | Cmd+] |
| 刷新 | 重新加载页面 | Cmd+R |

#### Center 区域（地址栏）

| 功能 | 说明 |
|------|------|
| URL 显示 | 显示当前页面 URL |
| URL 输入 | 点击进入编辑模式，输入 URL 或搜索关键词 |
| 搜索引擎 | 非 URL 输入自动转为 Google 搜索 |
| HTTPS 自动补全 | 输入 `example.com` → `https://example.com` |

#### Right 区域（操作）

| 功能 | 说明 | Batch |
|------|------|-------|
| 书签 ★/☆ | 切换当前页书签 | 1 |
| 提取 📋 | 提取网页内容到 Note | 2 |
| 查找 🔍 | 页面内查找（Cmd+F） | 2 |

### 3.3 WebView:ai 变体的 Toolbar 差异

| | WebView | WebView:ai |
|---|---|---|
| 地址栏 | 完整 URL 编辑 | 只显示 AI 服务名 |
| 书签 | ★ | 隐藏 |
| 提取 | 📋 | 隐藏 |
| AI 服务切换 | 隐藏 | [ChatGPT ▾] 下拉 |

---

## 四、NavSide 面板（注册制）

遵循 `workmode.md` §四 和已实现的 `NavSideRegistry` 注册制。

### 4.1 注册数据

```typescript
// app.ts registerPlugins()
navSideRegistry.register({
  workModeId: 'web',        // 或当前的 'demo-c'
  actionBar: { title: '网页', actions: [
    { id: 'add-bookmark', label: '+ 书签' },
  ]},
  contentType: 'web-bookmarks',
});

navSideRegistry.register({
  workModeId: 'ai',
  actionBar: { title: 'AI 对话', actions: [] },
  contentType: 'ai-services',
});
```

### 4.2 Web 书签面板（web-bookmarks）

复用 EBookPanel 的文件夹交互模式（创建、嵌套、拖拽、重命名、删除）。

```
┌─────────────────────────┐
│ 网页              + 书签 │  ← ActionBar（注册制）
├─────────────────────────┤
│ 🔗 输入网址或搜索...     │  ← URL 输入栏
├─────────────────────────┤
│ 📁 学习资源              │  ← 书签文件夹
│   🌐 MDN Web Docs       │
│   🌐 Rust Book          │
│ 📁 论文                  │
│ 🌐 GitHub               │  ← 根目录书签
├─────────────────────────┤
│ ▾ 最近访问              │  ← 折叠区域
│   🌐 Stack Overflow     │
│   🌐 arXiv.org          │
└─────────────────────────┘
```

### 4.3 AI 服务面板（ai-services）

```
┌─────────────────────────┐
│ AI 对话                  │  ← ActionBar
├─────────────────────────┤
│ [ChatGPT] [Claude] [Gemini] │  ← 快捷切换按钮
└─────────────────────────┘
```

---

## 五、数据存储

### 5.1 书签（复用 eBook 文件夹模式）

```typescript
interface WebBookmark {
  id: string;
  title: string;
  url: string;
  favicon?: string;
  folderId: string | null;    // 复用文件夹组织模式
  createdAt: number;
}

interface WebBookmarkFolder {
  id: string;
  title: string;
  parent_id: string | null;   // 与 eBook 文件夹结构一致
  sort_order: number;
  created_at: number;
}
```

存储：`{userData}/krig-note/web/bookmarks.json`

### 5.2 浏览历史

```typescript
interface WebHistoryEntry {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  visitedAt: number;
}
```

存储：`{userData}/krig-note/web/history.json`

### 5.3 View 持久化状态

遵循 `view.md` §七 的 `PersistedViewState` 接口，WebView 通过 `getState()` / `restoreState()` 自行管理状态，不侵入 Workspace 的状态接口。

```typescript
// WebView 实现 PersistedViewState
interface WebViewPersistedState {
  url: string;               // 当前 URL
  zoom: number;              // 缩放级别
}

// 通过 View 接口保存/恢复
class WebView implements IView {
  getState(): WebViewPersistedState {
    return { url: this.webview.getURL(), zoom: this.zoom };
  }
  restoreState(state: WebViewPersistedState): void {
    this.webview.loadURL(state.url);
    this.zoom = state.zoom;
  }
}
```

---

## 六、内容提取（Web → Note → Thought）

### 6.1 在 KRIG 思考链路中的位置

```
WebView 浏览网页
  → 提取到 Note（ExtractedBlock[] → Atom[]）
    → 在 Note 中标注 / 创建 Thought
      → Thought 关联回源 URL（anchor: { type: 'web', url, selector }）
        → 知识图谱节点
```

遵循 P1（组织思考）：提取是用户主动操作，系统不自动提取。

### 6.2 提取方式

| 方式 | 说明 | Batch |
|------|------|-------|
| 全页提取 | Readability 算法清理网页噪音 → Markdown → Atom[] | 2 |
| 区域选择 | 用户框选页面区域 → 提取选区内容 | 3 |
| 选中文本 | 选中文本直接提取 | 2 |

### 6.3 提取数据模型

复用 mirro-desktop 已有的 `ExtractedBlock` 类型（`ResultParser → createAtomsFromExtracted` 管线）。
不重新定义，保持类型唯一源。

```typescript
// 复用 mirro-desktop 的 ExtractedBlock（src/modules/note/converters/）
interface ExtractedBlock {
  type: 'paragraph' | 'heading' | 'blockquote' | 'code' | 'image' | 'video';
  tag: string;
  text: string;
  headingLevel: number;
  src?: string;
  sourceUrl?: string;     // 原始网页 URL
}
```

---

## 七、AI 对话模式（WebView:ai）

### 7.1 支持的 AI 服务

| 服务 | URL | 检测方式 |
|------|-----|---------|
| ChatGPT | `chatgpt.com` | URL 匹配 |
| Claude | `claude.ai` | URL 匹配 |
| Gemini | `gemini.google.com` | URL 匹配 |

### 7.2 功能

| 功能 | 说明 | Batch |
|------|------|-------|
| 服务切换 | Toolbar 下拉选择 AI 服务 | 3 |
| 发送选区 | 从 Note/eBook 选中文本 → 发送到 AI | 4 |
| SSE 捕获 | 拦截 AI 响应流（核心能力，见 §7.3） | 3 |
| 双向交互 | send + wait + capture 闭环 | 4 |

### 7.3 AI Bridge：SSE 拦截架构

> **已在 mirro-desktop 验证**：`src/modules/ai-bridge/` 完整实现了三服务 SSE 拦截 + 双向交互。
> KRIG-Note 中这些能力**收归 WebBridge 模块**（`src/plugins/web-bridge/capabilities/`），
> 不再作为独立的 AIBridge 模块。详见 `WebBridge-设计.md` §十二 决策 9。

#### 核心组件（WebBridge L3 能力层）

```
WebBridge.capabilities/
  ├── ai-service-detector.ts   ← URL 匹配 → 识别当前 AI 服务
  ├── interceptor.ts           ← 拦截 AI 响应流 → 缓存 Markdown
  ├── content-sender.ts        ← 粘贴文本/图片到 AI 输入框
  └── ai-interaction.ts        ← 统一交互：send / request / batch
```

#### 每个服务的拦截策略（mirro-desktop 已验证）

| 服务 | 策略 | 原因 |
|------|------|------|
| **Claude** | hook `window.fetch` → 拦截 `text_delta` SSE | fetch 在页面级可拦截 |
| **ChatGPT** | 检测 `/textdocs` 完成 → 调 conversation API 获取完整 Markdown | Service Worker 绕过 fetch hook |
| **Gemini** | CDP (Chrome DevTools Protocol) 网络层拦截 `StreamGenerate` | Zone.js 阻止页面级 XHR hook |

三种策略都在**API/网络层**工作（不是 DOM 层），格式稳定，维护成本低。

#### 双向交互能力（AIInteraction）

```typescript
// 单向发送
send(text)                    → 粘贴到 AI 输入框

// 双向请求（send + 自动 Enter + 轮询 SSE 缓存等待回复）
request(prompt)               → send + wait → 返回 Markdown

// 文件交互（上传文件 + prompt + 等待回复）
requestWithFile(opts)         → 上传 .md 文件 + prompt → 返回 Markdown

// 批量（分页循环请求）
batch(pages[])                → 逐页 request → 返回所有回复
```

这套能力是 §十三 Automation Layer 中 AI Agent 操控的基础——Agent 不仅能操控浏览器，还能**程序化地和 AI Web 服务对话**。

#### AI 对话持久化 + 知识图谱化

SSE 拦截的 Markdown 输出同时进入两条路径：

```
SSECaptureManager 拦截 AI 响应
  ├── 路径 A：即时使用（request() 返回给调用者）
  └── 路径 B：持久化存储 → 知识图谱化
        AIConversation { service, messages[], capturedAt }
          → 用户选中片段 → 提取到 Note / 创建 Thought
            → Thought anchor: { type: 'ai-conversation', conversationId, messageIndex }
              → 知识图谱节点
```

与 WebView 网页提取（§六）、EBookView 标注→Thought 是**同一个模式**：
源材料 → 持久化 → 用户选择性提取 → Thought → 知识图谱。

#### 存储方案

```
Phase 1（JSON，Batch 4）：
  {userData}/krig-note/web/conversations/
    {conversationId}.json              ← 每个对话一个文件

Phase 2（SurrealDB，功能稳定后）：
  ai_conversation 表                   ← 见 SurrealDB Schema §2.7
```

与书签（§5.1 `bookmarks.json`）、历史（§5.2 `history.json`）的存储策略一致：Phase 1 用 JSON，Phase 2 迁移到 SurrealDB。

---

## 八、安全设计

### 8.1 webview 标签安全

```html
<webview
  src="https://example.com"
  preload="web-content-preload.js"
  partition="persist:web"
  allowpopups
/>
```

- `preload`: 注入 CSP bypass + 选择增强脚本
- `partition`: 独立的 session 隔离
- `contextIsolation`: 默认启用

### 8.2 CSP Bypass（通过 preload）

```javascript
// web-content preload
new MutationObserver((mutations) => {
  for (const { addedNodes } of mutations) {
    for (const node of addedNodes) {
      if (node.nodeName === 'META' &&
          node.httpEquiv?.toLowerCase() === 'content-security-policy') {
        node.remove();
      }
    }
  }
}).observe(document.head, { childList: true });
```

### 8.3 广告屏蔽

通过 `webContents.session.webRequest.onBeforeRequest` 过滤广告请求（Batch 2）。

---

## 九、协同协议

遵循 `view-protocol.md` 的注册制。

### 9.1 translate 协议（WebView + WebView）

| 行为 | 方向 | 说明 |
|------|------|------|
| 导航同步 | Left → Right | 左侧加载新 URL 后，右侧加载同一 URL |
| 滚动同步 | 双向 | 鼠标所在侧驱动另一侧 |
| 翻译注入 | 仅右侧 | 右侧加载后注入 Google Translate |

### 9.2 协议注册

```typescript
protocolRegistry.register({
  id: 'web-translate',
  match: { left: { type: 'web' }, right: { type: 'web' } },
});
```

---

## 十、Batch 规划

### Batch 1：基础浏览

| 功能 | 说明 |
|------|------|
| `web.html` + React 组件 | View 骨架（Toolbar + webview） |
| WebToolbar | 后退/前进/刷新 + 地址栏 |
| URL 导航 | 输入 URL / 搜索关键词 / 链接点击 |
| 书签 | ★/☆ + NavSide 书签树 |
| 浏览历史 | 自动记录 + NavSide 列表 |
| 启动恢复 | 恢复上次 URL |
| NavSide 注册 | `navSideRegistry.register()` |

### Batch 2：增强功能

| 功能 | 说明 |
|------|------|
| 内容提取 | 全页/选中文本 → Note |
| 页内查找 | Cmd+F |
| 缩放 | Cmd+/- |
| 广告屏蔽 | webRequest 过滤 |

### Batch 3：AI 对话 + SSE 拦截

| 功能 | 说明 |
|------|------|
| WebView:ai 变体 | 固定 AI 服务 URL |
| AI 服务切换 | ChatGPT / Claude / Gemini |
| AI NavSide 面板 | 服务选择按钮 |
| LLMServiceDetector | URL 匹配检测当前 AI 服务 |
| SSECaptureManager | 三服务 SSE 拦截（Claude fetch hook / ChatGPT conversation API / Gemini CDP） |
| ContentSender | 粘贴文本/图片到 AI 输入框 |

### Batch 4：AI 双向交互 + 协同 + Thought

| 功能 | 说明 |
|------|------|
| AIInteraction | send / request / requestWithFile / batch 统一交互 |
| translate 协议 | 双屏翻译 |
| 发送选区到 AI | 跨 View 通信 |
| 提取 → Thought | 提取内容关联源 URL |
| AI 对话持久化 | 存储对话历史，支持回溯和知识图谱化 |

### Batch 5：Automation Layer（AI Agent 操控）

| 功能 | 说明 |
|------|------|
| IBrowserAutomation 接口 | 程序化导航、点击、输入、读取页面 |
| automation bridge preload | webview 内注入 DOM 操控桥 |
| 截图 API | 全页/元素截图，供多模态模型使用 |
| 安全授权 | 用户确认 + 操作可见 + 可中断 |
| 操作日志 | 审计 AI Agent 的所有浏览器操作 |

---

## 十一、代码结构（预期）

遵循 principles.md §四 模块自包含原则：一个 View = 一个自包含模块。
所有相关代码（渲染、main 进程、NavSide 面板、preload）收归同一目录。

```
web.html                             ← 入口 HTML
vite.web.config.mts                  ← Vite 配置

src/plugins/web/                     ← Web 插件（自包含模块）
  renderer.tsx                       ← 渲染入口
  components/
    WebView.tsx                      ← 顶层 View（Toolbar + webview）
    WebToolbar.tsx                   ← Toolbar React 组件
  navside/
    WebPanel.tsx                     ← 书签 + 历史面板
    AIPanel.tsx                      ← AI 服务选择面板
  main/
    bookmark-store.ts                ← 书签存储（JSON）
    history-store.ts                 ← 历史存储（JSON）
    conversation-store.ts            ← AI 对话持久化存储（JSON → SurrealDB）
  preload/
    web-content.ts                   ← 网页内容 preload（CSP bypass + 未来 automation bridge）
  web.css                            ← 样式
```

与 EBookView 的模块结构对比：

| | EBookView | WebView |
|---|---|---|
| 渲染入口 | `plugins/ebook/renderer.tsx` | `plugins/web/renderer.tsx` |
| 组件 | `plugins/ebook/components/` | `plugins/web/components/` |
| Main 逻辑 | `main/ebook/` | `plugins/web/main/` |
| NavSide | 由 NavSideRegistry 渲染 | `plugins/web/navside/` |
| 渲染引擎 | `plugins/ebook/renderers/` | webview 标签（无需独立渲染器） |

> **注**：EBookView 当前的 main 逻辑在 `src/main/ebook/`，未来也应迁入 `src/plugins/ebook/main/` 保持一致。

---

## 十二、与 mirro-desktop 的差异

| mirro-desktop | KRIG-Note | 遵循的原则 |
|--------------|-----------|-----------|
| 14 个 WebContentsView | 1 个 View（内嵌 webview 标签） | §五 View 是插件的载体 |
| 独立 Toolbar WebContentsView | Toolbar 是 View 内部 React 组件 | §五 每个 View 拥有自己的 Toolbar |
| 18+ 布局模式 | Workspace Slot 系统处理 | §五 框架提供骨架 |
| 独立翻译桥 | translate 协议 | view-protocol.md 注册制 |
| 独立 AI 控制器 | WebView:ai 变体 | 统一 ViewType + variant |
| NavSide 硬编码 | NavSideRegistry 注册 | workmode.md §四 注册制 |
| JSON 书签存储 | 复用文件夹模式 | §二 相似即可抽象 |

---

## 十三、Automation Layer（AI Agent 操控层）

> **实现归属**：Automation 能力由 **WebBridge** 模块实现（`src/plugins/web-bridge/automation/`）。
> WebView 通过 WebBridge 暴露 AI Agent 通道，自身不实现 Automation 逻辑。
> 详见 `WebBridge-设计.md` §八 模块结构。
>
> 本节记录架构设计和安全策略。Batch 5 实现时代码写入 WebBridge 模块。

### 13.1 问题：当前设计只有"人操控"通道

Batch 1-4 的所有交互链路都是 **人 → UI → webview**：

```
用户 → Toolbar 输入 URL → webview.loadURL()
用户 → 点击提取按钮 → WebBridge.extractFullPage() → Note
```

AI Agent 需要的是 **程序 → API → webview** 通道。

### 13.2 双通道架构

WebView 提供 webview 实例，WebBridge 提供操控能力：

```
WebView（View 层 — 呈现）
  ├── UI Layer（人操作，Batch 1-4）
  │     Toolbar 按钮 / 键盘快捷键 → webview
  │
  └── attach(webview) → WebBridge（通信层 — 操控）
        ├── L3 能力层（读取 + 写入 + 拦截）← Batch 2-4
        └── automation/（IBrowserAutomation 封装）← Batch 5
              ↑ Module 5 Orchestrator 调用

WebView
  ├── UI Layer（人操作，Batch 1-4）
  │     Toolbar 按钮 / 键盘快捷键 → webview
  │
  └── Automation Layer（AI Agent 操控，Batch 5+）
        IBrowserAutomation API → webview
```

两层不冲突：
- UI Layer 仍然是用户的主要操作方式
- Automation Layer 是 AI Agent 的编程接口
- 同一个 webview 实例，共享 session、cookie、状态
- AI Agent 操控时，Toolbar 的 URL 显示同步更新（人始终能看到 AI 在做什么）

### 13.3 IBrowserAutomation 接口

```typescript
/**
 * IBrowserAutomation — AI Agent 操控浏览器的编程接口
 *
 * 所有方法都是 Promise 化的，支持 Agent 编排多步操作。
 * 实现基于 webview.executeJavaScript() + webview.capturePage()。
 */
interface IBrowserAutomation {
  // ── 导航 ──
  navigate(url: string): Promise<void>;
  waitForLoad(): Promise<void>;
  waitForSelector(selector: string, timeout?: number): Promise<boolean>;
  goBack(): Promise<void>;
  goForward(): Promise<void>;

  // ── 页面信息（读取） ──
  getURL(): string;
  getTitle(): Promise<string>;
  getTextContent(): Promise<string>;
  getHTML(): Promise<string>;
  querySelector(selector: string): Promise<ElementInfo | null>;
  querySelectorAll(selector: string): Promise<ElementInfo[]>;
  getLinks(): Promise<Array<{ text: string; href: string }>>;
  getFormFields(): Promise<Array<{ name: string; type: string; value: string }>>;

  // ── 交互（写入） ──
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  press(key: string): Promise<void>;           // Enter, Tab, Escape...
  select(selector: string, value: string): Promise<void>;
  scrollTo(x: number, y: number): Promise<void>;
  scrollBy(deltaX: number, deltaY: number): Promise<void>;

  // ── 截图（多模态模型输入） ──
  screenshot(): Promise<Buffer>;
  screenshotElement(selector: string): Promise<Buffer>;

  // ── 复合操作（常用编排的快捷方式） ──
  searchGoogle(query: string): Promise<void>;
  fillForm(fields: Record<string, string>): Promise<void>;

  // ── 受控 JS 执行 ──
  evaluate<T>(script: string): Promise<T>;

  // ── 任务级安全约束（Module 5 调用）──
  setTaskConstraints(constraints: TaskConstraints): void;
  clearTaskConstraints(): void;
}

interface ElementInfo {
  tag: string;
  text: string;
  href?: string;
  src?: string;
  value?: string;
  placeholder?: string;
  rect: { x: number; y: number; w: number; h: number };
  attributes: Record<string, string>;
  visible: boolean;
}
```

### 13.4 实现路径

#### 层 1：webview preload 注入操控桥

在 `web-content-preload.js` 中注入 DOM 操控函数，通过 `ipcRenderer` 暴露给 Main 进程：

```typescript
// web-content-preload.ts（Batch 1 就注入，Batch 5 激活）

// Batch 1: CSP bypass（已有）
// Batch 5: Automation bridge
ipcRenderer.on('automation:click', (_e, selector: string) => {
  const el = document.querySelector(selector);
  if (el instanceof HTMLElement) el.click();
});

ipcRenderer.on('automation:type', (_e, selector: string, text: string) => {
  const el = document.querySelector(selector) as HTMLInputElement;
  if (el) { el.focus(); el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); }
});

ipcRenderer.on('automation:get-text', (_e) => {
  ipcRenderer.sendToHost('automation:result', document.body.innerText);
});

// ... 其他操控命令
```

#### 层 2：WebView 组件暴露 webview ref

```typescript
// WebView.tsx
// Batch 1 预留：webviewRef 对外可访问
const webviewRef = useRef<Electron.WebviewTag>(null);

// Automation Layer 通过 webviewRef 调用：
// webviewRef.current.executeJavaScript(...)
// webviewRef.current.capturePage(...)
// webviewRef.current.send('automation:click', selector)
```

#### 层 3：Main 进程暴露 Automation IPC

```typescript
// src/main/web/automation.ts
// AI Agent（运行在 Main 进程或独立 Worker）通过 IPC 调用

ipcMain.handle('web:automation:navigate', async (_e, url: string) => {
  webview.loadURL(url);
  await waitForEvent(webview, 'did-finish-load');
});

ipcMain.handle('web:automation:click', async (_e, selector: string) => {
  webview.send('automation:click', selector);
});

ipcMain.handle('web:automation:screenshot', async () => {
  return await webview.capturePage();
});
```

### 13.5 安全边界

> **已确认决策**：共享 session（不做隔离），安全靠操作审批。
> Agent 操控浏览器的最大价值是能利用用户已登录的状态。

#### 基础安全规则

| 规则 | 说明 |
|------|------|
| **用户授权** | AI Agent 首次请求操控浏览器时，弹出确认对话框 |
| **操作可见** | AI 操控时 Toolbar URL 实时更新，用户始终知道 AI 在访问什么 |
| **操作可中断** | 用户随时可以点击 Toolbar 的"停止"按钮终止 Agent 操作 |
| **不自动登录** | Agent 不得操控登录表单填写密码，除非用户明确指示 |
| **共享 session** | Agent 和用户共用同一个 webview session（cookie、登录态），不做隔离 |
| **日志审计** | 所有 Automation 操作记录到日志，用户可回溯 AI 做了什么 |

#### Level 0 任务的域名白名单机制

普通浏览和 Agent 自动执行的安全要求不同：

| | 普通浏览 / 有监督 Agent | Level 0 全自动（用户不介入） |
|---|---|---|
| 人在看着？ | 是 | 否 |
| 共享 session 风险 | 低（随时可停） | 高（Agent 可能误操作敏感页面） |
| 安全策略 | 操作可见 + 可中断 | **域名白名单 + 操作可见 + 日志** |

Level 0 任务（Orchestrator 全自动编排，用户不介入）在共享 session 下需要额外约束：

```typescript
interface AutomationPolicy {
  /**
   * 可信域名白名单 — Level 0 Agent 只能操作这些域名。
   * 导航到白名单外的域名时自动拒绝并记录日志。
   *
   * 默认白名单：AI 服务域名（Orchestrator 指挥 Web AI 的核心场景）。
   * 用户可在设置中扩展白名单。
   */
  trustedDomains: string[];

  /** 敏感 URL 黑名单 — 即使在白名单域名内，这些路径也禁止操控 */
  blockedPatterns: string[];

  /** 敏感表单字段 — Agent 不得自动填写这些字段 */
  blockedFields: string[];
}

// 默认配置
const DEFAULT_POLICY: AutomationPolicy = {
  trustedDomains: [
    'claude.ai',
    'chatgpt.com',
    'chat.openai.com',
    'gemini.google.com',
    'scholar.google.com',
    'google.com',
  ],
  blockedPatterns: [
    '**/account/**',        // 账户设置页
    '**/billing/**',        // 支付页
    '**/settings/security', // 安全设置
    '**/delete**',          // 删除操作
  ],
  blockedFields: [
    'password',
    'credit-card',
    'card-number',
    'cvv',
    'ssn',
  ],
};
```

**执行逻辑**：

```
Agent 请求 navigate(url)
  → 解析域名
  → Level 0 任务？
    → YES → 域名在 trustedDomains 中？
      → YES → 路径匹配 blockedPatterns？
        → YES → 拒绝 + 日志记录
        → NO  → 允许
      → NO  → 拒绝 + 日志记录 + 通知用户
    → NO（有监督任务）→ 允许（人在看着）
```

**为什么不用隔离 session**：Orchestrator 指挥 Web AI 完成任务，前提是用户已经登录了 claude.ai、gemini.google.com 等。隔离 session 会使这个核心场景完全不可用。域名白名单是更精确的安全边界——**限制 Agent 能去哪里，而不是限制 Agent 能看到什么**。

#### 与 Module 5 的对接：任务级约束

WebView 的 `AutomationPolicy` 是**全局**安全策略。Module 5 Agent 在此基础上提供**任务级**约束：

```typescript
// Module 5 Orchestrator 启动 Level 0 任务时，传入任务级约束
interface TaskConstraints {
  taskId: string;
  level: 0 | 1 | 2 | 3;
  allowedDomains: string[];       // 模板声明的域名范围（⊂ trustedDomains）
  allowedOperations: string[];    // 模板声明的操作类型
}

// WebView Automation Layer 接收后：
// 实际允许范围 = TaskConstraints ∩ AutomationPolicy
// 模板约束不能突破全局白名单，只能进一步收窄
```

详见 Module 5 设计文档 `docs/agent/Module5-Agent-设计.md` §5.2。

### 13.6 AI Agent 使用示例

```typescript
// AI Agent 编排：搜索论文 → 读取摘要 → 返回结果
async function searchPaper(agent: IBrowserAutomation, query: string): Promise<string> {
  await agent.navigate('https://scholar.google.com');
  await agent.waitForSelector('input[name="q"]');
  await agent.type('input[name="q"]', query);
  await agent.press('Enter');
  await agent.waitForLoad();

  // 获取搜索结果
  const results = await agent.querySelectorAll('.gs_ri');
  const summaries = results.slice(0, 3).map(r => ({
    title: r.text.split('\n')[0],
    href: r.href,
  }));

  // 点击第一个结果
  if (summaries[0]?.href) {
    await agent.navigate(summaries[0].href);
    await agent.waitForLoad();
    return await agent.getTextContent();
  }

  return '';
}
```

### 13.7 Batch 1 预留清单

虽然 Automation Layer 在 Batch 5 实现，但 Batch 1 需要预留以下扩展点。

> **重要**：预留 ≠ 实现。Batch 1 只做命名约定和结构预留，**不引入任何 Automation 代码**。
> 遵循 principles.md §二-3（先具体后抽象）和 CLAUDE.md §七-1（只实现当前需要的功能）。

| 预留项 | Batch 1 做什么 | Batch 1 不做什么 |
|--------|---------------|-----------------|
| webviewRef | `useRef<WebviewTag>` 正常声明即可 | 不需要 `useImperativeHandle`，不暴露给外部 |
| preload 脚本 | 模块化文件结构（CSP bypass 独立函数） | 不写 automation bridge 代码 |
| IPC 命名空间 | channels 文件中留注释标记 `// web:automation:* — Batch 5` | 不注册任何 automation handler |

---

## 十四、已确认的决策

| # | 问题 | 决策 | 讨论日期 |
|---|------|------|---------|
| 1 | webview 标签 vs WebContentsView | **用 webview 标签**。符合 View 自管理原则，避免 mirro-desktop 的 14 个 WebContentsView 老路。Electron 28+ 稳定性已大幅改善 | 2026-04-08 |
| 2 | 内容提取的目标 | **创建新 Note** + 自动记录源 URL，不覆盖当前 Note | 2026-04-08 |
| 3 | AI 对话历史 | **持久化 + 知识图谱化**。SSE 拦截捕获对话（Batch 3），通过 Thought 系统进入知识图谱（与 Web/eBook 提取同一模式） | 2026-04-08 |
| 4 | Automation 隔离策略 | **共享 session + 操作审批**。不做隔离。Level 0 全自动任务通过域名白名单 + 操作白名单双重约束（详见 §13.5 + Module 5 §5.2） | 2026-04-08 |
| 5 | 多模态截图 | **DOM 优先，截图作为 fallback**。95% 场景不需要截图，DOM 信息密度更高。截图返回可见区域，不做标注截图 | 2026-04-08 |
