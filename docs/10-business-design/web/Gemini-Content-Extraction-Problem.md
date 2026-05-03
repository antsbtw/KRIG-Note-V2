# Gemini 内容提取问题诊断报告

> 创建日期：2026-04-13
> 当前分支：`experiment/web-content-extractor`
> 状态：✅ 已解决（5 种样本端到端验证通过）

---

## 一、目标

在 Electron `<webview>` 嵌入的 Gemini 页面（`gemini.google.com/app/{hash}`）中
对等提取所有 AI 产出：纯文本、LaTeX、代码块、表格、搜索引用 + 网页
grounding、Imagen 图像、思考链（thinking chain），用于 KRIG sync /
module 5。

---

## 二、技术架构

```
Electron BrowserWindow
  └── <webview src="https://gemini.google.com/app/{hash}" partition="persist:web">
        └── Gemini / Bard Chat UI
              └── batchexecute RPC（Google 遗留协议，单端点多 rpcId）
```

已复用基础设施：
- `webContents.debugger` CDP 捕获网络
- `webContents.session` / `net.fetch`（main-process）

---

## 三、踩过的坑

### 坑 1：batchexecute 协议陌生

所有 Gemini API 调用都走同一个端点
`/_/BardChatUi/data/batchexecute?rpcids=<ID>&...`，通过 query 参数区
分用途。请求 body 是 URL-encoded JSON，响应 body 是：

```
)]}'
<frame_len>\n
<json_array_frame>\n
<frame_len>\n
<json_array_frame>\n
```

这是 Google 经典的**多帧流 + 防 JSON-hijack 前缀**格式。

### 坑 2：帧长单位是 UTF-8 字节，不是字符

帧头声明的 `<frame_len>` 是 **UTF-8 字节数**，JS 字符串是 UTF-16，直接按
`body.slice(0, len)` 会错位（中文/emoji 让长度不等）。按字节切又涉及
TextEncoder/Decoder 边界。

**解决**：**忽略帧头声明的长度**，改成 greedy —— 从当前位置吃到下一个
`\n<digits>\n` 边界（或 EOF），整段 `JSON.parse`。长度验证对我们无意义。

### 坑 3：inner payload 是 JSON-in-string

每帧 `[[...]]` 里每行形如：
```
["wrb.fr", "<rpcId>", "<inner_json_string>", ...]
```

`inner_json_string` 本身是一个 `JSON.stringify` 过的字符串 —— 需要对这个
字段再 `JSON.parse` 一次才能拿到真数据结构。

### 坑 4：数据是位置数组，没有字段名

不像 ChatGPT/Claude 的 JSON object 有 `{content_type: "text"}` 这种标签，
Gemini 是**纯嵌套数组**，用位置索引表达语义。例如：

```
inner[0][i][0]       = [conversationId, responseId]
inner[0][i][2][0][0] = 用户消息
inner[0][i][3][0][0][1][0] = assistant markdown
inner[0][i][3][0][0][37][0][0] = thinking chain
```

**解决**：实地侦察 5 种样本对话，扁平化遍历所有 string 叶子，找规律
→ 确定每种内容的 path。

### 坑 5：turns 逆序

`inner[0]` 里的 turn 数组是**最新在前**（array[0] 是最后一轮对话）。
KRIG 下游和其他 extractor 一致都按时间正序处理，所以 `extractContent`
在返回前 `turns.reverse()`。

### 坑 6：Imagen 图像下载 — 渲染进程全军覆没

Gemini 的 Imagen 图像存储在 `lh3.googleusercontent.com/gg/AEir0w...`
这种带签名 token 的 URL。尝试过所有渲染进程方案：

| 方案 | 结果 |
|---|---|
| `fetch(url, {credentials: 'include'})` | HTTP 400 text/html |
| `fetch(url, {credentials: 'omit', mode: 'cors'})` | HTTP 400 |
| `fetch(url, {mode: 'no-cors'})` | opaque response, blob size 0 |
| `new Image({crossOrigin: 'anonymous'})` | img.onerror（CORS 拒绝） |
| `new Image()` + canvas + toDataURL | canvas 被 tainted，toDataURL 抛 SecurityError |

**根因**：Google 对 lh3 URL 有严格的 CORS / Referer 检查，渲染进程发出
的请求会带浏览器标准 header（Origin / Sec-Fetch-\*），CDN 拒绝；同时禁
止 cross-origin canvas 读取。

**解决**：改走 **main-process `net.fetch`**（新增 IPC `WB_FETCH_BINARY`）。
main 进程没有 CORS 层，发送的是 Node 级最小请求，CDN 接受，返回原始字
节。renderer 拿到 base64 字符串拼 data URL 即可。

---

## 四、最终方案：Layer 1 CDP + Layer 2 main-process fetch

### 数据源映射

| 内容 | 来源 |
|---|---|
| 完整 assistant markdown（文本 + LaTeX + 代码 + 表格） | hNvQHb.inner\[0\]\[i\]\[3\]\[0\]\[0\]\[1\]\[0\] |
| 用户消息 | hNvQHb.inner\[0\]\[i\]\[2\]\[0\]\[0\] |
| 思考链 | hNvQHb.inner\[0\]\[i\]\[3\]\[0\]\[0\]\[37\]\[0\]\[0\] |
| Imagen 图像 URL | hNvQHb.inner\[0\]\[i\]\[3\]\[0\]\[0\]\[12\]\[7\]\[0\]\[0\]\[0\]\[N\]\[3\] |
| 搜索引用 | hNvQHb.inner\[0\]\[i\]\[3\]\[12\]\[0\]\[0\]\[14\]\[12\]\[K\]\[0\]\[0\]\[1\] 下的 \[2\] 标题 + \[3\]\[1\]\[2\]\[1\]\[0\] URL |
| 时间戳 | hNvQHb.inner\[0\]\[i\]\[4\]\[0\]（unix 秒） |
| Imagen 图像字节 | `WB_FETCH_BINARY` main-process 拉 lh3 URL → base64 |

### 工作流程

```
1. 用户打开 Gemini 对话
2. KRIG 启动 CDP 抓包（📡 CDP 抓包）
3. 用户刷新页面（Cmd+R）
     → Gemini 发 hNvQHb 请求加载完整对话
     → CDP 捕获响应 body
4. extractContent():
     - 从 CDP 缓存取 hNvQHb 响应（最大那条）
     - batchexecute 多帧 greedy 解析 → inner 数组
     - 按 path 提取每轮的 user / markdown / thinking / imageUrls / groundings
     - 反转 turns（时间正序）
     - 并行调用 wbFetchBinary 把 Imagen URL 转 base64 dataURL
     - 把 groundings 附加到 markdown 末尾（"## 参考来源" 章节）
5. 返回 GeminiContent { conversationId, turns[], warnings[] }
```

### 为什么 Gemini 比 ChatGPT 还简单

- ChatGPT 的对话树要遍历 `mapping` graph 重建顺序
- Gemini 的 turns 是**平铺数组**，直接 `inner[0]` 就是有序的
- ChatGPT 的代码块要自己从 text 里解析
- Gemini 的 markdown **Google 已经 rendered 好**了（含 fenced code blocks、表格、LaTeX 原样），直接一个字段拿完

---

## 五、模块状态

| 能力 | 状态 | 位置 |
|---|---|---|
| `extractContent(webview, view)` | ✅ 5 种样本全验证 | [gemini-content-extractor.ts](../../src/plugins/web-bridge/capabilities/gemini-content-extractor.ts) |
| `debugExtractContent(webview, view)` | ✅ AIWebView 🧪 Gemini 按钮 | 同上 |
| Imagen 图像 base64 内嵌 | ✅ main-process fetch | 同上 |
| 搜索引用自动附加 | ✅ "## 参考来源" | 同上 |
| Sync engine 接入 | ⏸️ 待讨论使用流程 | — |

---

## 六、验证覆盖清单

| # | 样本 | 落点 | 验证 |
|---|---|---|---|
| 1 | LaTeX 欧拉公式 | markdown 字段（`$$...$$` 和 `$...$`） | ✅ |
| 2 | Python 代码块 | markdown 字段（```` ```python ``` ````） | ✅ |
| 3 | 实/复分析对比**表格** | markdown 字段（`\| ... \|`） | ✅ |
| 4 | 柯西定理 + 网页搜索引用 | markdown + 自动附加"## 参考来源" 章节 | ✅ 4 个引用全部提取 |
| 5 | 月球 Imagen 图像 | main-process 拉 lh3 URL → base64 dataURL | ✅ 2 张候选图全部 inline |
| bonus | 思考链 | `thinking` 字段 | ✅ |

---

## 七、与其他 AI 提取模块对比

| 维度 | Claude | ChatGPT | Gemini |
|---|---|---|---|
| 主要提取手段 | CDP 模拟鼠标 + clipboard | CDP 捕获 JSON API | CDP 捕获 batchexecute + main fetch 图 |
| 用户干扰 | 有（scroll + 鼠标） | 无 | 无 |
| API 认证 | cookie | Service Worker 走私 | batchexecute token（CDP 绕开） |
| 源码/markdown 完整性 | ❌ 占位符，只能拿渲染图 | ✅ | ✅ 最完整（Google 给现成 markdown） |
| 图像 | PNG via clipboard | base64 via estuary | base64 via main-process net.fetch |
| 调试按钮 | 🧪 Artifact | 🧪 ChatGPT | 🧪 Gemini |
| 诊断文档 | [Claude-Artifact-Extraction-Problem.md](Claude-Artifact-Extraction-Problem.md) | [ChatGPT-Content-Extraction-Problem.md](ChatGPT-Content-Extraction-Problem.md) | 本文档 |

## 八、已知限制 & 待办

1. **普通账号限制**：Canvas / Deep Research / Code Execution（matplotlib 图表等）未在样本覆盖范围内 —— 这些功能需要 Gemini Pro/Advanced 订阅。字段位置可能与当前 schema 不同，需 Pro 账号补侦察。

2. **Imagen 返回多张候选**：当前如实保留（通常 2 张）。下游 sync 决定是否去重或只取第一张。

3. **CDP 抓取时机**：需要用户主动 `📡 CDP 抓包 + Cmd+R`。未来 module 5 可以在 webview 初始化时自动 attach CDP，用户感知不到。

4. **数组 path 脆弱性**：Google 改前端代码时 inner 数组结构可能变。如果提取开始返回空，用 `docs/web/鼠标方法.md` 笔记里的扁平化侦察脚本重新定位 path 即可（代价小）。

5. **反向通道**（KRIG → Gemini 发消息）：属于 module 5，未在此模块覆盖。
