# WebBridge 设计

> 状态：设计中
> 位置：独立插件模块 `src/plugins/web-bridge/`
> 被调用：WebView Toolbar、Module 5 Orchestrator
>
> **核心定义**：WebBridge 是 KRIG 与 web 内容之间的**双向通信层**。
> 不是"提取器"，而是对 web 页面的完整掌控——读取任何内容、操控任何元素。
>
> **依赖关系**：WebBridge 不依赖 WebView 的实现，但依赖 WebView 提供的 webview 实例（通过 `attach()` 接口注入）。WebBridge 只依赖 Electron 的 `WebContents` 类型，不 import WebView 的任何代码。

---

## 一、为什么是独立模块

### 1.1 不是 WebView 的内部实现

WebView 是 View 层插件（Toolbar + webview 容器），负责**呈现**。
WebBridge 是通信层，负责**交互**。两者职责不同：

```
WebView（View 层）
  "用户看到什么"
  Toolbar + webview 标签 + URL 导航 + 书签

WebBridge（通信层）
  "程序能对 web 做什么"
  读取内容 + 操控元素 + 拦截流量 + 注入脚本
```

### 1.2 多个调用者

WebBridge 的调用者不只是 WebView：

| 调用者 | 场景 | 使用的能力 |
|--------|------|-----------|
| **用户**（WebView Toolbar） | 点击"提取"按钮 | 全页提取、选区提取 |
| **AIBridge** | 与 Web AI 对话 | SSE 拦截、粘贴到输入框、读取回复 |
| **Module 5 Orchestrator** | AI Agent 自动化 | 导航、点击、输入、读取、截图 |
| **翻译协议** | 双屏翻译 | Google Translate 注入 |

### 1.3 与 mirro-desktop 的关系

mirro-desktop 中这些能力分散在多个模块中：

| mirro-desktop 模块 | 能力 | WebBridge 对应层 |
|---|---|---|
| `ai-bridge/content-sender.ts` | 粘贴到 AI 输入框 | 写入层 |
| `ai-bridge/response-parsing/` | 读取 AI 回复 DOM → Markdown | 读取层 |
| `ai-bridge/sse-capture/` | SSE 流拦截 | 拦截层 |
| `web-extraction/fullpage-capture.ts` | Defuddle 全页提取 | 读取层 |
| `ai-bridge/extraction/selection-box.js` | 区域选择提取 | 读取层 |
| `ai-bridge/extraction/content-to-atoms.ts` | ExtractedBlock → Atom 转换 | 管线层 |
| `ai-bridge/response-parsing/result-parser.ts` | Markdown → ExtractedBlock 解析 | 管线层 |
| `browser/core/csp-bypass.ts` | CSP header 剥离 | 基础设施层 |
| `browser/core/ad-blocker.ts` | 广告过滤 | 基础设施层 |
| `browser/core/google-translate-injector.ts` | Google Translate 注入 | 写入层 |

KRIG-Note 将这些收归到一个自包含模块中。

---

## 二、核心架构

### 2.1 四层结构

```
WebBridge
  ├── L1 基础设施层（Infrastructure）
  │     CSP bypass、广告过滤、session 管理
  │     在 webview 加载前就绑定，所有上层依赖此层
  │
  ├── L2 注入层（Injection）
  │     向 webview 页面注入脚本
  │     executeJavaScript() + preload 脚本
  │
  ├── L3 能力层（Capabilities）
  │     读取 + 写入 + 拦截
  │     具体的交互能力，基于 L2 注入实现
  │
  └── L4 管线层（Pipeline）
        ExtractedBlock[] ↔ Atom[] 转换
        Markdown 解析、内容清洗、Note 创建
```

### 2.2 层间依赖

```
L4 管线层     → 调用 L3 的读取能力获取内容，转换后写入 KRIG 存储
L3 能力层     → 通过 L2 注入脚本到页面，执行 DOM 操作
L2 注入层     → 依赖 L1 已清除 CSP，脚本才能正常注入
L1 基础设施层 → 直接操作 webview session/webRequest，无上层依赖
```

严格单向依赖，不跨层调用。

---

## 三、L1 基础设施层

### 3.1 CSP Bypass

两层防线（mirro-desktop 已验证）：

**HTTP header 层**（main 进程）：
```typescript
// 剥离 HTTP 响应中的 CSP header
session.webRequest.onHeadersReceived((details, callback) => {
  const headers = { ...details.responseHeaders };
  delete headers['content-security-policy'];
  delete headers['Content-Security-Policy'];
  delete headers['content-security-policy-report-only'];
  delete headers['Content-Security-Policy-Report-Only'];
  callback({ responseHeaders: headers });
});
```

**DOM meta 层**（preload）：
```typescript
// 已在 web-content.ts 中实现（Batch 1）
// MutationObserver 移除 <meta http-equiv="content-security-policy">
```

### 3.2 广告过滤

```typescript
// webRequest.onBeforeRequest 过滤广告域名
// 使用 Ghostery ElectronBlocker 或精简的域名黑名单
// 白名单：Google Translate、OAuth 相关域名、AI 服务域名
```

### 3.3 Session 管理

WebView 使用 `partition: 'persist:web'` 独立 session。
WebBridge 通过此 session 管理 cookie、缓存、webRequest hooks。

---

## 四、L2 注入层

### 4.1 两种注入方式

| 方式 | 时机 | 适用场景 |
|------|------|---------|
| **preload 脚本** | 页面加载前，isolated world | CSP bypass、基础桥接、消息通道 |
| **executeJavaScript** | 按需，main world | DOM 读取、事件模拟、脚本注入 |

### 4.2 注入安全原则

- 所有注入脚本必须是**幂等的**（`if (window.__krig_xxx) return`）
- 使用 `response.clone()` 读取 fetch 响应，不干扰页面功能
- 注入脚本不修改页面 DOM 结构（只读取或模拟事件）
- SPA 页面导航时自动重新注入（`did-navigate-in-page` 事件）

### 4.3 消息通道

```
webview 页面内 ←→ WebBridge（main 进程 / renderer 进程）

方式 1：executeJavaScript + 返回值（同步请求-响应）
方式 2：window.__krig_xxx 全局变量（缓存 + 轮询）
方式 3：IPC sendToHost / send（双向事件通知）
```

---

## 五、L3 能力层

### 5.1 读取能力（Read）

| 方法 | 说明 | 实现基础 |
|------|------|---------|
| `getTextContent()` | 整页纯文本 | executeJavaScript: `document.body.innerText` |
| `getHTML()` | 整页 HTML | executeJavaScript: `document.documentElement.outerHTML` |
| `getTitle()` | 页面标题 | executeJavaScript: `document.title` |
| `getURL()` | 当前 URL | webview.getURL() |
| `querySelector(selector)` | 查询单个元素 | executeJavaScript: 返回 ElementInfo |
| `querySelectorAll(selector)` | 查询多个元素 | executeJavaScript: 返回 ElementInfo[] |
| `getLinks()` | 所有链接 | executeJavaScript: 遍历 `<a>` 标签 |
| `getFormFields()` | 表单字段 | executeJavaScript: 遍历 `<input>/<select>/<textarea>` |
| `getSelectedText()` | 用户选中的文本 | executeJavaScript: `getSelection().toString()` |
| `screenshot()` | 可见区域截图 | webview.capturePage() |

### 5.2 写入能力（Write）

| 方法 | 说明 | 实现基础 |
|------|------|---------|
| `click(selector)` | 点击元素 | executeJavaScript: `.click()` |
| `type(selector, text)` | 输入文本 | executeJavaScript: focus + value + input event |
| `press(key)` | 按键 | executeJavaScript: KeyboardEvent dispatch |
| `pasteText(selector, text)` | 粘贴到输入框 | ContentSender 模式：ClipboardEvent 模拟 |
| `pasteImage()` | 粘贴剪贴板图片 | webContents.paste() |
| `select(selector, value)` | 下拉选择 | executeJavaScript: `.value` + change event |
| `scrollTo(x, y)` | 滚动到位置 | executeJavaScript: `window.scrollTo()` |
| `scrollBy(dx, dy)` | 相对滚动 | executeJavaScript: `window.scrollBy()` |
| `fillForm(fields)` | 批量填表 | 遍历调用 type/select |
| `submitForm(selector)` | 提交表单 | executeJavaScript: `form.requestSubmit()` |

### 5.3 拦截能力（Intercept）

| 方法 | 说明 | 实现基础 |
|------|------|---------|
| `interceptSSE(config)` | 拦截 SSE 流 | fetch hook 注入（Claude/ChatGPT/Gemini 三套策略） |
| `getLatestResponse()` | 获取最新拦截的回复 | 读取 `window.__krig_sse_responses` |
| `getResponseAtPosition(x, y)` | 获取鼠标位置的回复 | DOM elementFromPoint → 匹配缓存 |
| `onRequestCompleted(pattern, cb)` | 监听网络请求完成 | webRequest.onCompleted |

### 5.4 高级读取（Rich Read）

| 方法 | 说明 | 实现基础 |
|------|------|---------|
| `extractFullPage()` | Readability/Defuddle 全页提取 | 注入 Defuddle UMD bundle |
| `extractSelection()` | 区域选择提取 | 注入选择框 UI + DOM 内容提取 |
| `extractSelectedText()` | 选中文本提取 | getSelection + DOM 上下文 |
| `domToMarkdown(selector?)` | DOM → Markdown 转换 | 注入 domToMarkdown 函数 |
| `detectAIService()` | 检测当前 AI 服务 | URL pattern 匹配 |

### 5.5 AI 交互编排（Orchestration）

`ai-interaction.ts` 不是原子能力，而是 L3 能力的**编排组合**——`request()` 内部包含轮询等待逻辑（clearResponses → pasteText → triggerSend → poll interceptor status）。它处于 L3 和 L4 之间：

- 不是 L3：不直接操作 DOM，而是组合 writer + interceptor
- 不是 L4：不涉及 ExtractedBlock → Atom 转换

在模块结构中仍放在 `capabilities/` 目录，但标注为**编排能力**（区别于 reader/writer/interceptor 等原子能力）：

| 方法 | 说明 | 内部调用链 |
|------|------|-----------|
| `send(text)` | 单向发送 | writer.pasteText → writer.press('Enter') |
| `request(prompt)` | 双向请求 | interceptor.clear → send → poll interceptor.getStatus → interceptor.getLatestResponse |
| `requestWithFile(opts)` | 文件交互 | writer.uploadFile → send → poll |
| `batch(pages[])` | 分页循环 | 逐页 request → 收集结果 |
| `newSession(target)` | 切换 AI 服务 | writer.navigate(service.newChatUrl) |

---

## 六、L4 管线层

### 6.1 数据流

```
Web 页面
  ↓ L3 读取能力
ExtractedBlock[]                    ← 统一的中间格式
  ↓ L4 管线层
Atom[]                              ← KRIG 存储格式
  ↓ Note 创建
NoteFile                            ← 持久化到 SurrealDB
```

### 6.2 ExtractedBlock（统一中间格式）

复用 mirro-desktop 已有类型（不重新定义）：

```typescript
interface ExtractedBlock {
  type: 'paragraph' | 'heading' | 'blockquote' | 'code'
    | 'image' | 'video' | 'audio' | 'bulletList' | 'orderedList'
    | 'table' | 'math' | 'callout';
  tag: string;
  text: string;
  headingLevel: number;
  src?: string;
  alt?: string;
  language?: string;           // code block 语言
  inline?: InlineElement[];    // 行内元素（bold、italic、link、code、math）
  children?: ExtractedBlock[]; // 列表项子元素
  rows?: string[][];           // 表格行
  sourceUrl?: string;          // 原始来源 URL
}

interface InlineElement {
  type: 'text' | 'bold' | 'italic' | 'code' | 'link' | 'math';
  text: string;
  href?: string;
}
```

### 6.3 管线组件

| 组件 | 输入 | 输出 | 说明 |
|------|------|------|------|
| `ResultParser` | Markdown 字符串 | `ExtractedBlock[]` | AI 回复解析（处理 LaTeX 分隔符、代码围栏） |
| `domToMarkdown` | DOM 节点 | Markdown 字符串 | 页面 DOM → Markdown |
| `createAtomsFromExtracted` | `ExtractedBlock[]` | `Atom[]` | 中间格式 → KRIG 存储格式 |
| `noteCreator` | `Atom[]` + 元数据 | `NoteFile` | 创建新 Note + 记录源信息 |

### 6.4 来源记录

每次提取都记录来源，为知识图谱化预留。

`ExtractionSource` 和 `ExtractedBlock` 是跨模块共享的类型（WebBridge、EBookView、未来的 PDF 提取都会用），定义在 `src/shared/types/extraction-types.ts`，不在 WebBridge 内部。WebBridge 的 `types.ts` 只定义模块内部类型（`ElementInfo`、`SSEConfig` 等）。

```typescript
// src/shared/types/extraction-types.ts

interface ExtractionSource {
  type: 'web' | 'ai-conversation' | 'epub-cfi' | 'pdf-spatial' | 'clipboard';
  url?: string;                // 网页 URL
  title?: string;              // 页面标题
  conversationId?: string;     // AI 对话 ID
  messageIndex?: number;       // AI 消息索引
  cfi?: string;                // EPUB CFI
  pageNum?: number;            // PDF 页码
  extractedAt: number;         // 提取时间
}

// ExtractedBlock 也在此文件中定义（见 §6.2）
```

---

## 七、接口设计

### 7.1 IWebBridge（完整接口）

当前阶段不拆分接口（不过度设计），用注释分组标注层级。
未来拆分方向：`IWebBridgeRead`、`IWebBridgeWrite`、`IWebBridgeIntercept`、`IWebBridgePipeline`，调用者按需依赖。Batch 5 时如果 Module 5 只需要 L3 子集再拆。

```typescript
interface IWebBridge {
  // ── 生命周期 ──
  attach(webview: Electron.WebviewTag | Electron.WebContents): void;
  detach(): void;

  // ── L3 读取 ──
  getTextContent(): Promise<string>;
  getHTML(): Promise<string>;
  getTitle(): Promise<string>;
  getURL(): string;
  querySelector(selector: string): Promise<ElementInfo | null>;
  querySelectorAll(selector: string): Promise<ElementInfo[]>;
  getLinks(): Promise<Array<{ text: string; href: string }>>;
  getFormFields(): Promise<Array<{ name: string; type: string; value: string }>>;
  getSelectedText(): Promise<string>;
  screenshot(): Promise<Buffer>;

  // ── L3 写入 ──
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  press(key: string): Promise<void>;
  pasteText(selector: string, text: string): Promise<void>;
  pasteImage(): Promise<void>;
  select(selector: string, value: string): Promise<void>;
  scrollTo(x: number, y: number): Promise<void>;
  scrollBy(dx: number, dy: number): Promise<void>;
  fillForm(fields: Record<string, string>): Promise<void>;

  // ── L3 拦截 ──
  interceptSSE(config: SSEConfig): void;
  getLatestResponse(): Promise<string | null>;
  getResponseAtPosition(x: number, y: number): Promise<string | null>;

  // ── L3 高级读取 ──
  extractFullPage(): Promise<ExtractedBlock[]>;
  extractSelection(): Promise<ExtractedBlock[]>;
  domToMarkdown(selector?: string): Promise<string>;
  detectAIService(): AIServiceInfo | null;

  // ── L4 管线 ──
  extractToNote(source: ExtractionSource): Promise<string>;  // 返回 noteId

  // ── 安全约束（Module 5 调用）──
  setTaskConstraints(constraints: TaskConstraints): void;
  clearTaskConstraints(): void;
}
```

### 7.2 ElementInfo

```typescript
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

---

## 八、模块结构

```
src/plugins/web-bridge/
  index.ts                          ← 模块导出（IWebBridge 接口 + 工厂函数）
  types.ts                          ← ElementInfo、SSEConfig 等 WebBridge 内部类型

  infrastructure/                   ← L1 基础设施
    csp-bypass.ts                   ← HTTP header + DOM meta CSP 剥离
    ad-blocker.ts                   ← 广告域名过滤
    session-manager.ts              ← persist:web session 管理

  injection/                        ← L2 注入
    script-injector.ts              ← executeJavaScript 封装（幂等 + SPA 重注入）
    inject-scripts/
      dom-reader.js                 ← DOM 读取函数（querySelector、getLinks 等）
      dom-writer.js                 ← DOM 写入函数（click、type、paste 事件模拟，含 AI 输入框特化）
      dom-to-markdown.js            ← DOM → Markdown 转换（复用 mirro-desktop）
      sse-capture.js                ← SSE 拦截注入脚本（三服务策略）

  capabilities/                     ← L3 能力
    reader.ts                       ← 读取能力实现
    writer.ts                       ← 写入能力实现（含 AI 输入框粘贴的特化逻辑）
    interceptor.ts                  ← SSE 拦截管理
    rich-reader.ts                  ← Defuddle 全页提取、domToMarkdown
    selection-box.ts                ← 区域选择 UI（KRIG 暗色主题，样式通过 CSS 变量注入）
    ai-service-detector.ts          ← AI 服务检测（URL pattern）
    ai-interaction.ts               ← send/request/batch（调用 writer + interceptor）

  pipeline/                         ← L4 管线
    result-parser.ts                ← Markdown → ExtractedBlock[]
    content-to-atoms.ts             ← ExtractedBlock[] → Atom[]
    note-creator.ts                 ← 创建 Note + 记录来源

  automation/                       ← Automation Layer（Batch 5）
    automation-policy.ts            ← AutomationPolicy 安全策略
    task-constraints.ts             ← TaskConstraints 任务级约束
    browser-automation.ts           ← IBrowserAutomation 实现（组合 L3 能力）
```

**结构说明**：
- **selection-box.ts 在 capabilities/**（不在 inject-scripts/）：它是有 UI 的能力组件，与纯逻辑注入脚本性质不同。样式通过 CSS 变量注入，和 KRIG 暗色主题保持一致（principles.md §八 UI 配置化）
- **没有独立的 content-sender.ts**：AI 输入框粘贴是 writer.ts 的 `pasteText()` 实现细节（处理 contentEditable + ClipboardEvent 模拟）。不同 AI 服务的 DOM 结构差异由 ai-interaction.ts 结合 ai-service-detector.ts 的选择器配置处理
- **extraction-source.ts 不在此模块**：`ExtractionSource` 类型定义在 `src/shared/types/`（见 §6.4 说明）

---

## 九、与其他模块的关系

```
src/plugins/web-bridge/             ← 不依赖 WebView 的实现，只依赖注入的 webview 实例
    ↑ 调用
    ├── WebView（src/plugins/web/）
    │     attach(webviewRef) → 注入 webview 实例
    │     Toolbar "提取" 按钮 → extractToNote()
    │     Toolbar AI 服务切换 → ai-interaction.newSession()
    │
    └── Module 5 Orchestrator（Batch 5）
          setTaskConstraints() → 安全约束
          全部 L3 能力 → IBrowserAutomation
```

WebBridge **不知道谁在调用它**——它只暴露 `IWebBridge` 接口，不区分调用者。
安全约束通过 `TaskConstraints` 传入，由 `AutomationPolicy` 执行。

### 9.1 共享接口类型的位置

跨模块共享的接口定义在 `src/shared/types/`，不在任何具体模块内部：

```
src/shared/types/
  extraction-types.ts         ← ExtractedBlock、ExtractionSource（WebBridge + EBookView + 未来模块共用）
  automation-types.ts         ← IBrowserAutomation、TaskConstraints、AutomationPolicy（WebBridge 实现、Module 5 调用）
```

Module 5 import `IBrowserAutomation` 接口类型时，不需要 import WebBridge 的内部文件。

### 9.2 Module 5 的调用路径（IPC Server 模式）

Module 5 Orchestrator 运行在 Main 进程，没有直接访问 webview 实例的途径。WebBridge 通过 IPC Server 暴露能力：

```
WebBridge 初始化时：
  注册 IPC handlers（web:bridge:* 命名空间）
  每个 IWebBridge 方法映射到一个 IPC channel

Module 5 调用时：
  Orchestrator → ipcMain.invoke('web:bridge:getTextContent') → WebBridge 实例 → 返回结果
```

```typescript
// WebBridge 注册 IPC Server（Batch 5 实现）
function registerWebBridgeIPC(bridge: IWebBridge): void {
  ipcMain.handle('web:bridge:getTextContent', () => bridge.getTextContent());
  ipcMain.handle('web:bridge:click', (_e, selector) => bridge.click(selector));
  ipcMain.handle('web:bridge:type', (_e, selector, text) => bridge.type(selector, text));
  ipcMain.handle('web:bridge:setTaskConstraints', (_e, c) => bridge.setTaskConstraints(c));
  // ... 所有 IWebBridge 方法
}
```

Module 5 文档中的 `krig.browser.*` 和 `krig.ai.*` 是 `IWebBridge` 接口的 **Module 5 视角封装**，底层由 WebBridge 通过 IPC 实现。

---

## 十、开发批次

### Batch 2A：基础读写（WebView 增强）

| 能力 | 优先级 |
|------|--------|
| L1 CSP header bypass（main 进程侧） | P0 |
| L2 script-injector 基础框架 | P0 |
| L3 reader：getTextContent、querySelector、getLinks | P0 |
| L3 rich-reader：extractFullPage（Defuddle） | P0 |
| L4 pipeline：resultParser + contentToAtoms + noteCreator | P0 |
| WebView Toolbar "提取" 按钮集成 | P0 |

### Batch 2B：写入 + 选区提取

| 能力 | 优先级 |
|------|--------|
| L3 writer：click、type、press、pasteText | P1 |
| L3 rich-reader：extractSelection（区域选择） | P1 |
| L3 reader：getSelectedText、getFormFields | P1 |

### Batch 3：SSE 拦截（AI Bridge）

| 能力 | 优先级 |
|------|--------|
| L3 interceptor：三服务 SSE 拦截 | P0 |
| L3 capabilities：detectAIService | P0 |
| L3 writer：pasteText（AI 输入框特化） | P0 |
| AIInteraction：send / request / batch | P0 |

### Batch 5：Automation Layer

| 能力 | 优先级 |
|------|--------|
| automation-policy + task-constraints | P0 |
| browser-automation（组合 L3 能力实现 IBrowserAutomation） | P0 |
| Module 5 IPC 对接 | P0 |

---

## 十一、已确认的设计决策

| # | 决策 | 来源 |
|---|------|------|
| 1 | DOM 优先，截图作为 fallback | WebView 设计讨论 2026-04-08 |
| 2 | 共享 session（persist:web），不做隔离 | WebView 设计讨论 2026-04-08 |
| 3 | SSE 拦截而非 DOM 抓取捕获 AI 回复 | mirro-desktop 验证 |
| 4 | ExtractedBlock 复用 mirro-desktop 类型 | WebView 设计审查 |
| 5 | 提取 = 创建新 Note + 记录源 URL | WebView 设计讨论 2026-04-08 |
| 6 | 注入脚本必须幂等 | mirro-desktop 验证 |
| 7 | Level 0 任务域名白名单 + 操作白名单 | Module 5 设计 §5.2 |

---

## 十二、已确认的追加决策

| # | 问题 | 决策 | 理由 | 日期 |
|---|------|------|------|------|
| 8 | Defuddle 引入方式 | **打包为 UMD bundle**，构建时从 npm 依赖打包，运行时注入。不依赖 node_modules 路径 | 减少用户部署成本，构建产物自包含 | 2026-04-08 |
| 9 | AIBridge 归属 | **收归 WebBridge**，不独立。SSE 拦截、ContentSender、AIInteraction 是 L3 能力的子集 | AIBridge 的所有能力（拦截、粘贴、读取）都是 WebBridge L3 的实例化。独立模块会导致能力重复和接口割裂 | 2026-04-08 |
| 10 | 区域选择 UI | **按 KRIG-Note 设计原则重写**，不复用 mirro-desktop 的 selection-box.js | 原实现 900+ 行，与 KRIG 暗色主题和 UI 配置化原则不兼容。重写可以更简洁 | 2026-04-08 |

### 决策 9 对模块结构的影响

AIBridge 收归后，模块结构调整：

```
src/plugins/web-bridge/
  capabilities/
    reader.ts
    writer.ts                   ← 含 AI 输入框粘贴特化（原 ContentSender 合并入此）
    interceptor.ts              ← SSE 拦截（原 SSECaptureManager）
    rich-reader.ts
    selection-box.ts            ← 区域选择 UI（重写，CSS 变量驱动）
    ai-service-detector.ts      ← AI 服务检测（原 LLMServiceDetector）
    ai-interaction.ts           ← send/request/batch（原 AIInteraction，内部调用 writer + interceptor）
```

不再需要独立的 `src/plugins/ai-bridge/` 目录，也没有独立的 `content-sender.ts`。
WebView 设计文档 §7.3 中引用的"AIBridge"概念在实现中统一为 WebBridge 的 L3 能力。

### 决策 8 的实现方式

```
构建时：
  vite 插件读取 node_modules/defuddle/dist/index.full.js
  → 打包为字符串常量嵌入 rich-reader.ts

运行时：
  rich-reader.ts 通过 executeJavaScript() 将 Defuddle bundle 注入页面
  → 调用 Defuddle API 提取全页内容
```
