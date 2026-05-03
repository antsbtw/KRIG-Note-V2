# ChatGPT 内容提取问题诊断报告

> 创建日期：2026-04-13
> 当前分支：`experiment/web-content-extractor`
> 状态：✅ 已解决（端到端验证通过）

---

## 一、目标

在 Electron `<webview>` 嵌入的 ChatGPT 页面中，对等提取所有 AI 产出内容：
纯文本、LaTeX、代码块、matplotlib 图表、DALL·E 图像、Canvas 文档、
Mermaid 图（以 fenced code block 形式），用于 KRIG 的 sync / module 5。

---

## 二、技术约束

```
Electron BrowserWindow
  └── <webview src="https://chatgpt.com/c/{uuid}" partition="persist:web">
        └── ChatGPT SPA
              └── Service Worker（代理 /backend-api 请求，注入认证）
```

已有能力：
- `webview.executeJavaScript(...)` 在 guest 页面注入脚本
- `webContents.debugger`（CDP）附着到 guest 主进程，可见 Service Worker
  代理的网络
- main 进程 `clipboard.readText/readImage`、`session.on('will-download')`

---

## 三、踩过的坑

### 坑 1：guest fetch 返回 401

最初直觉方案：在 guest 页面 `fetch('/backend-api/conversation/{uuid}',
{ credentials: 'include' })`。测试结果 **401 Unauthorized**。

原因：ChatGPT 所有 `/backend-api` 请求都经过 Service Worker。Service
Worker 在拦截请求时向其中**注入** `Authorization: Bearer <token>` /
其他防护 header。页面层的 fetch 不走 worker（因为 fetch 来自页面
script，不是 worker-controlled 资源），所以没有这些 header，服务端
拒绝。

### 坑 2：Sniffer hook 不到请求

装了 `window.fetch` 和 `XMLHttpRequest` 双 hook 想抓请求头。结果
`captured 0 requests`。确认 hook 还在（`window.__chatgpt_sniff_v2 ===
true`），但没记到任何 `/backend-api` 调用。

原因：同上 —— 请求由 Service Worker 发出，不走页面 `window.fetch` /
`XMLHttpRequest`。

### 坑 3：URL prefix 歧义

`/backend-api/conversation/{uuid}` 是以下路径的前缀：
- `/backend-api/conversation/{uuid}`（对话树）← 我们要的
- `/backend-api/conversation/{uuid}/textdocs`（Canvas）
- `/backend-api/conversation/{uuid}/stream_status`

CDP 按 URL substring 匹配时三条都命中。`mode: 'latest'` 取最新那条
结果是 textdocs（时间戳最晚），conversation 直接漏掉。

修复：按 URL **tail**（截掉 uuid 之后的部分）严格匹配：只要 tail 是空
字符串或以 `?` 开头就是 bare conversation。

### 坑 4：file id 正则太宽

`file[-_][A-Za-z0-9]+` 在 `file-service://file_XXX` 字符串上会先匹配到
`file-service`（因为 `file-s` 满足 `file-` + 字母），而不是真正的
`file_XXX`。

修复：收紧为 `file_[A-Za-z0-9]+`（只接受下划线开头），因为实际 file id
都是 `file_<hex>` 格式。

### 坑 5：Code Interpreter 图的存放位置

matplotlib 图不在 `content.parts` 里，而是在
`metadata.aggregate_result.messages[].image_url`，形如
`file-service://file_XXX`。如果 normalizeMessage 只扫 parts 和
metadata.attachments 就会漏掉 Code Interpreter 的输出。

修复：额外扫描 `metadata.aggregate_result.messages[].image_url`。

### 坑 6：estuary 返回 octet-stream

`/backend-api/estuary/content?id=file_XXX` 返回图像字节的响应
`Content-Type: application/octet-stream`，而不是 `image/png`。
composé `data:application/octet-stream;base64,...` 在 `<img src>` 里
不渲染。

修复：**按 base64 magic bytes sniff 真实 MIME**（`iVBORw` → PNG、
`/9j/` → JPEG、`R0lGODl` → GIF、`UklGR` → WebP、`PHN2Zy`/`PD94bWw` →
SVG、`JVBER` → PDF），覆盖服务端的 octet-stream。

---

## 四、最终方案：Layer 1 CDP 被动捕获

### 数据源映射

| 功能 | URL pattern | body 格式 | 取用方式 |
|---|---|---|---|
| 对话树（文本/LaTeX/代码） | `/backend-api/conversation/{uuid}` | JSON | 解析 mapping tree |
| Canvas 文档 | `/backend-api/conversation/{uuid}/textdocs` | JSON 数组 | `[{id, version, title, content}]` |
| 文件字节（图/CSV等） | `/backend-api/estuary/content?id=file_XXX&...` | base64 | 拼 `data:<sniffed mime>;base64,...` |

### 工作流程

```
1. 用户打开 ChatGPT 对话页
2. KRIG 启动 CDP 抓包（📡 CDP 抓包 按钮）
3. 用户刷新页面（Cmd+R）
     Service Worker 重发所有 /backend-api 请求
     CDP 捕获所有响应 body（JSON 原文 + 二进制自动 base64）
4. extractContent() 查 CDP 缓存：
     - 找 bare conversation response → 解析 mapping tree
     - 找 textdocs response → 解析 Canvas 数组
     - 收集 messages 里所有 file id → 查 estuary 响应 → 拼 data URL
5. 返回结构化 ChatGPTContent
```

### 关键时序约束

- CDP **必须先于** 页面加载启动，否则响应已经发完抓不到
- 页面刷新后需要等几秒（DALL·E 4.9 MB 等大文件需要时间完全传完）
- CDP 默认 `maxCacheSize: 200`：ChatGPT 页面加载约 195 个请求，刚好装
  得下；但多操作几次可能挤掉老响应，建议用时再次刷新

---

## 五、模块状态

| 能力 | 状态 | 位置 |
|---|---|---|
| `extractContent(webview, view)` | ✅ 6 种样本全验证通过 | [chatgpt-content-extractor.ts](../../src/plugins/web-bridge/capabilities/chatgpt-content-extractor.ts) |
| `debugExtractContent(webview, view)` | ✅ AIWebView 🧪 ChatGPT 按钮 | 同上 |
| DOM fallback（CDP 缓存空时） | ⏸️ 未实现 | — |
| Sync engine 接入 | ⏸️ 待讨论使用流程 | — |
| 主动触发刷新 | ⏸️ 未实现（可能打扰用户） | — |

---

## 六、验证覆盖清单

单次对话包含以下 6 种内容，全部通过 `extractContent` 正确提取：

| # | 样本 | 落点 | 验证 |
|---|---|---|---|
| 1 | LaTeX 公式 | conversation API `parts[0]` 里的 `\[...\]` | ✅ |
| 2 | Python 代码块 | conversation API `parts[0]` 里的 ``` ```python ``` ``` | ✅ |
| 3 | matplotlib 热力图 | metadata.aggregate_result image_url + estuary | ✅ 图像 PNG 渲染正常 |
| 4 | DALL·E 月球图 | content.parts asset_pointer + estuary | ✅ 图像 PNG 渲染正常 |
| 5 | Canvas 文档（复分析） | textdocs API `content` 字段 | ✅ Markdown + LaTeX 完整 |
| 6 | Canvas React 代码 | 同 5（作为 fenced jsx block 嵌入） | ✅ |

---

## 七、与 Claude Artifact 提取的对比

| 维度 | Claude | ChatGPT |
|---|---|---|
| 主要提取手段 | CDP 模拟鼠标（点"..."菜单） | CDP 被动捕获 API 响应 |
| 用户干扰 | 有（scroll + 鼠标活动） | 无 |
| API 认证 | cookie 直接可用 | Service Worker 走私（需 CDP） |
| 源码可得性 | 只能拿渲染图像（Download file 可选，未上线） | 可拿完整 Markdown 源码 |
| Canvas 概念 | Artifact 在 iframe 内 | textdoc 在独立 API |
| 模块入口 | [claude-artifact-extractor.ts](../../src/plugins/web-bridge/capabilities/claude-artifact-extractor.ts) | [chatgpt-content-extractor.ts](../../src/plugins/web-bridge/capabilities/chatgpt-content-extractor.ts) |
| 调试按钮 | 🧪 Artifact | 🧪 ChatGPT |

ChatGPT 的提取比 Claude **简单得多且数据更完整**（源码 + 图全有），
原因是 ChatGPT 对自己的 API 没做防爬措施 —— 所有 Canvas 源码、对话
原文都明文返回。

---

## 八、已知待办 / 未来增强

1. **CDP 自动启动**：目前要求用户手动点 `📡 CDP 抓包` 再刷页面。可
   以在进入 ChatGPT URL 时自动 attach，但 attach 要等用户授权，UX
   需要设计。
2. **缓存策略**：`maxCacheSize: 200` 在极端情况下（连续切多个对话）
   可能挤掉老响应。可以改为按 URL pattern 永久保留关键响应。
3. **DOM fallback**：如果用户没开 CDP 就点提取，可以退而求其次扫
   DOM（`<pre>` / `<img>`），拿到的会是渲染后的 HTML 而非原文。
4. **Gemini 覆盖**：同样套路，新建 `gemini-content-extractor.ts`。
5. **反向通道**（KRIG → ChatGPT 发消息 / 附件）：module 5 的范畴，
   当前模块不覆盖。
