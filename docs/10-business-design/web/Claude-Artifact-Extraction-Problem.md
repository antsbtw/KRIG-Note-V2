# Claude Artifact 内容提取问题诊断报告

> 创建日期：2026-04-13
> 当前分支：`experiment/web-content-extractor`
> 状态：调试陷入死胡同，需要换思路

---

## 一、问题背景

我们在 Electron 应用（基于 `<webview>` 标签嵌入 Claude.ai）中实现"AI 对话同步到 Note"功能：
- 用户在 Claude 上聊天 → 程序自动提取每轮对话 → 写入用户的 Note 编辑器

**纯文本内容已完美工作**：通过调用 Claude 内部 API `/api/organizations/{org}/chat_conversations/{id}` 获取对话，文字、公式、代码、列表、表格全部正确提取。

**Artifact 内容无法提取**：
- Claude 的 Artifact（交互式 HTML/React 组件，比如可拖动的图表、滑块控件等）
- 在 conversation API 中，Artifact 部分被替换为占位符字符串：
  ```
  ```
  This block is not supported on your current device yet.
  ```
  ```

---

## 二、技术架构

```
Electron BrowserWindow (host renderer, localhost:5178/web.html)
  └── <webview src="https://claude.ai/..." partition="persist:web">
        └── Claude.ai SPA (guest webContents)
              └── Artifact iframe (cross-origin: claudemcpcontent.com)
                    └── Artifact HTML (用户能看到，但 JS 跨域无法访问)
```

**已实现的能力**：
- 通过 `webview.executeJavaScript()` 在 guest 页面注入 JS
- 通过 main 进程 IPC 读写系统剪贴板（`electron.clipboard.readText()`）
- CDP 拦截器（`webContents.debugger`），但只能附着到 Claude 主页面，无法捕获 cross-origin iframe 的网络请求
- Claude conversation API 调用（带 cookie 凭证）

---

## 三、已尝试的所有方法（全部失败）

### 方法 1：Claude artifacts API 端点
```
GET /api/organizations/{org_id}/artifacts/{conversation_id}/
```
**结果**：404 Not Found（多种 URL 变体都试过）。
也试过 `/conversations/`、`/chat_conversations/`、`?conversation=` 等 query 形式，全部 404。

### 方法 2：CDP 拦截 iframe 请求
- 用 `webContents.debugger.attach()` 附着到 Claude 主 webContents
- 启用 Network domain，监听 `Network.requestWillBeSent` / `Network.loadingFinished`
- **结果**：捕获了 30+ 主页面请求，但**完全没有** `claudemcpcontent.com`（iframe 来源）的请求
- 原因：Cross-origin iframe 在独立的渲染进程中，主 webContents 的 CDP 看不到

### 方法 3：iframe contentDocument 直接访问
- 找到 iframe 元素后尝试 `iframe.contentDocument.body.innerHTML`
- **结果**：`contentDocument: null`（同源策略阻止）

### 方法 4：guest 页面 fetch iframe URL
- 在 guest 页面执行 `fetch(iframeSrc, { credentials: 'include' })`
- iframe URL 形如 `https://e931aa62...claudemcpcontent.com/mcp_apps?connect-src=...`
- **结果**：CORS 阻止（CSP/CORS headers 严格）

### 方法 5：Artifact "..." 菜单点击
用户截图显示 Artifact 右上角有"..."按钮，hover 时弹出菜单：
- Copy to clipboard
- Download file  
- Save as artifact

尝试程序点击：
- **失败 1**：找按钮特征（top-right + 无 aria-label + 无 svg）误中 Share 按钮
- **失败 2**：尝试找 `aria-label="Copy to clipboard"` 的按钮，**找不到**——因为这个按钮**只在鼠标真实 hover 时才渲染到 DOM**
- **失败 3**：用 `dispatchEvent(new MouseEvent('mouseenter'))` 模拟 hover —— Claude 不响应，菜单不出现
- 真实鼠标移到 Artifact 上能看到菜单；移开就消失。DevTools 获焦时鼠标自然离开了 Artifact。

### 方法 6：Artifact toolbar 直接的 Copy 按钮
Artifact 全屏视图的 toolbar 显示：`Retry / Edit / Copy / Close fullscreen`，看起来 `Copy` 按钮可以直接触发复制。

DOM 探测发现：
- `aria-label="Copy"` 的按钮共有 4 个
- **全部都是 message 级别的复制**（`data-testid="action-bar-copy"`，父容器 `w-fit`）
- Artifact toolbar 显示的 `Copy` 文字在 DOM 中**不是独立 button**，可能只是装饰文本，真正的复制还是要走 hover 菜单

### 方法 7：DOM-to-Markdown 整页提取
通过我们自己的 818 行 `domToMarkdown` 函数提取 assistant message 容器内容：
- 文字、公式、代码块都能提取
- **图片提取也能成功**（之前修了 `<button>` 包裹的 img 问题）
- 但 **Artifact 区域在 DOM 中只是个占位卡片**，里面没有真实内容（真实内容在 cross-origin iframe 里）

---

## 四、关键发现汇总

1. **Claude conversation API 返回的 message text 字段**就包含 placeholder 字符串
   - 这意味着 placeholder 是**服务器返回的内容**，不是客户端渲染时替换的
   - 服务器知道当前请求**不是官方 Web 客户端**（可能通过某些 header / token / 浏览器指纹），主动把 Artifact 内容剥离了

2. **真正的 Artifact 内容**只在浏览器渲染时才注入，通过：
   - 独立的 iframe（跨域 sandboxed）
   - JavaScript 在客户端动态构造
   - 不通过任何标准 HTTP API 暴露

3. **iframe 域名 `claudemcpcontent.com`** 是 Anthropic 专门的 MCP（Model Context Protocol）应用容器
   - 表明这不是普通 HTML，是 MCP App 沙箱
   - Anthropic 显然有意做这种隔离

4. **Claude 的 hover 菜单**用了某种我们无法触发的事件机制
   - 可能是 React + Radix UI + 真实指针追踪
   - 不响应 dispatchEvent

---

## 五、问题陈述（给其他 AI 诊断用）

**核心问题**：

> 在 Electron 应用中嵌入 `<webview>` 加载 claude.ai，已知 Claude 的 Artifact（交互式 HTML/React 组件）渲染在 cross-origin iframe（`claudemcpcontent.com`）中，且服务器 API 不返回 Artifact 原始内容。如何在不需要用户手动操作的前提下，**自动获取当前对话页面正在显示的 Artifact 的源码**？

**约束条件**：

1. 必须运行在 Electron（可使用 main process / CDP / webContents API 等高权限能力）
2. 用户已正常登录 Claude（cookie 有效）
3. 不修改 Claude 服务器或网络请求（不是 MITM）
4. 不依赖用户做特定鼠标操作（hover、点击 Artifact 等）
5. 接受"用户必须在 Claude 页面打开了 Artifact 才能提取"作为最低要求

**我们已确认不通的路径**：
- ❌ Claude artifacts API endpoint
- ❌ CDP 主 webContents 拦截 iframe 网络
- ❌ iframe contentDocument
- ❌ guest 页面 fetch iframe URL（CORS）
- ❌ 模拟 hover/click 触发菜单（事件不响应）
- ❌ DOM-to-Markdown（Artifact 不在主 DOM 里）

**潜在但未验证的路径**：
- ⚠️ CDP `Target.setAutoAttach` + `Target.attachedToTarget` 让 CDP 递归附着到 iframe 子 target
- ⚠️ `webview.capturePage()` 截图（会得到图片，不是源码）
- ⚠️ `session.webRequest.onResponseStarted` 监听整个 session 的所有请求（包括 cross-origin iframe）
- ⚠️ 使用 Electron 主进程 `net.fetch` 直接请求 iframe URL（可能能绕过浏览器同源策略，但 token 可能有时效）
- ⚠️ 通过 `webview.openDevTools()` 控制 guest 的 DevTools，再通过 DevTools 协议访问 iframe 内部
- ⚠️ 注入一个 Service Worker 或 preload 脚本，在 iframe 自己的上下文中拦截

---

## 六、相关代码位置

```
src/plugins/web-bridge/
  capabilities/
    claude-api-extractor.ts    ← 当前实现，尝试了多种方法
    cdp-interceptor.ts         ← CDP 网络拦截
    interceptor.ts             ← SSE 拦截（页面 fetch hook）
  injection/inject-scripts/
    dom-to-markdown.ts         ← DOM 转 Markdown（818 行）
```

```
src/plugins/web/components/
  AIWebView.tsx                ← Artifact webview 组件 + sync engine + 提取按钮
```

---

## 七、解决方案（2026-04-13 更新）

### 最终确定的三层架构

```
Layer 1: API（零干扰，被动）
  ├─ chat_conversations/{conv}  → 文本 + Artifact 占位符 + 位置
  └─ artifacts/{conv}/versions  → 当前恒空 []（接口保留）

Layer 2: postMessage Hook（零干扰，被动）
  └─ Hook window.postMessage + fetch
     用于诊断和 MCP 协议观察；确认 artifact 源码不走 parent→iframe 的 postMessage

Layer 3: CDP 模拟鼠标（有干扰，主动）
  ├─ Copy to clipboard → PNG 渲染图像（clipboard.readImage） ✅ 生产可用
  ├─ Download file     → 完整 HTML 源码（will-download hook）✅ 接口就绪
  └─ Save as artifact  → Claude 云端保存（KRIG 不落地）      ✅ 接口就绪
```

### 关键逆向工程发现

1. **Artifact UI 完全在 cross-origin iframe 内**：菜单 DOM 从 claude.ai 主
   document 的 querySelectorAll 看不到。因此无法用 DOM 定位菜单项坐标 —
   必须用像素估算 + CDP click（CDP 对跨域透明）。

2. **Radix UI 不响应 JS 层 `dispatchEvent`**：即使派发完整的
   `pointerover` + `pointerenter` + `pointermove` 序列也不触发 hover state。
   只有 CDP `Input.dispatchMouseEvent` 合成的原生指针事件有效。

3. **Artifact 卡片必须在 viewport 内**：off-screen iframe 不响应 hover（Claude
   的性能优化）。提取前必须 `scrollIntoView({ block: 'center' })`。

4. **Hover 需要多点轨迹**：单次 `mouseMoved` 到 "..." 热区不触发菜单。
   验证过的成功轨迹是 **卡片外左侧 → 卡片中心 → 右上角**。

5. **Copy to clipboard 写入的是 PNG 图像，不是源码**：必须用
   `clipboard.readImage()`，`readText()` 返回空字符串。

6. **Download file 的 `.html` 是完整自包含文件**：纯原生 JS + Canvas，
   无外部依赖，可直接嵌入 KRIG Note（未来 module 5 方案）。使用了
   Claude 主题 CSS 变量（`var(--color-text-primary)` 等），嵌入时需补
   fallback。

### 菜单项坐标（相对 "..." 按钮热区）

```
"..."按钮热区: (cardRect.right - 30, cardRect.top + 30)

菜单向下向左展开：
  Copy to clipboard:  dx=-80, dy=+45
  Download file:      dx=-80, dy=+81   (+36 项高)
  Save as artifact:   dx=-80, dy=+117  (+72)
```

### 时序参数（都经过验证，缩短任一会导致不可靠）

```
scrollIntoView 稳定:      400ms
hover 轨迹后菜单弹出:     250ms
mouseMoved 到菜单项后:    100ms (再 mousePressed)
点击后等待剪贴板/下载:    700ms
```

### 代码位置

- 核心模块：[src/plugins/web-bridge/capabilities/artifact-extractor.ts](../../src/plugins/web-bridge/capabilities/artifact-extractor.ts)
- CDP 鼠标合成 IPC：`WB_SEND_MOUSE`
- 剪贴板图片 IPC：`WB_READ_CLIPBOARD_IMAGE`
- 一次性下载捕获 IPC：`WB_CAPTURE_DOWNLOAD_ONCE`
- postMessage Hook：[src/plugins/web-bridge/injection/inject-scripts/artifact-postmessage-hook.ts](../../src/plugins/web-bridge/injection/inject-scripts/artifact-postmessage-hook.ts)

### 模块状态与后续

| 能力 | 状态 | 下一步 |
|---|---|---|
| `extractArtifactImage` | ✅ 验证过，生产可用 | 接 sync engine（流程待讨论） |
| `extractArtifactSource` | 🟡 代码就绪，main 侧下载 hook 已实现，renderer 未调 | module 5 时启用 |
| `triggerArtifactSave` | 🟡 接口就绪 | 未来"一键云备份"功能 |
| UI 开关 | ⏸️ 暂不做 | 待讨论使用流程后再加 |

## 八、需要其他 AI 回答的问题（历史存档）

请基于上述事实，给出**至少一种可行方案**或**确认所有方案都不可行**（如果是后者，请说明根本原因，而不是逐个否决方案）。

特别关注：
1. 是否有 Electron 特有的 API 能突破 cross-origin iframe 的隔离？
2. CDP 的 `Target.setAutoAttach` 在 Electron `webContents.debugger` 中能否使用？是否能附着到 cross-origin iframe 子 target？
3. 是否有方法让 main process 直接 fetch `claudemcpcontent.com/mcp_apps?...` URL 并附带正确的认证（包括可能的 referer、CSP 头处理）？
4. `webview.capturePage()` 截图 + OCR 是否实际可行（性能、准确度）？
5. 有没有完全不同的思路（比如让 Claude 自己导出 artifact，监听文件下载）？
