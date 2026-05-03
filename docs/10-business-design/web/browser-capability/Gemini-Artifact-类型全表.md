# Gemini Artifact 类型全表

> 文档类型：参考文档  
> 创建日期：2026-04-20 | 版本：v1.0  
> 数据来源：Gemini batchexecute API + 现有 gemini-content-extractor.ts 分析  
> 目的：全面梳理 Gemini 页面中所有内容类型，为 Browser Capability 提取做准备

---

## 一、Gemini 与 Claude / ChatGPT 的架构差异

| 维度 | Gemini | Claude | ChatGPT |
|------|--------|--------|---------|
| 对话模型 | 线性数组（newest first） | 线性消息数组 | 树形图（mapping） |
| API 协议 | Google batchexecute（多帧流） | REST JSON | REST JSON |
| API 端点 | `/_/BardChatUi/data/batchexecute?rpcids=hNvQHb` | `/api/organizations/{orgId}/chat_conversations/{convId}` | `/backend-api/conversation/{uuid}` |
| 响应格式 | 纯位置数组（无字段名） | 具名字段 JSON | 具名字段 JSON |
| 认证方式 | HTTP-only cookies（`__Secure-*`，JS 不可读但 fetch 自动携带） | Cookie 认证 | Bearer token（需先获取 accessToken） |
| 提取方式 | **注入脚本 fetch**（同源请求自动携带 HttpOnly cookie，零 DOM/CDP） | **注入脚本 fetch**（零 DOM/CDP） | **注入脚本 fetch**（Bearer token，零 DOM/CDP） |
| Markdown 完整性 | ✅ API 直接返回完整渲染后 Markdown | 需要从 tool_use 重组 | 需要从 parts 解析 |
| 图片获取 | main 进程 `net.fetch`（CORS 阻止 renderer 访问） | media store 本地文件 | estuary API（Bearer token） |

**Gemini 的独特优势**：API 直接返回完整的 Markdown（含 LaTeX、代码块、表格），不需要像 Claude 那样从 `widget_code` 重组，也不需要像 ChatGPT 那样从 `parts[]` 解析。

**Gemini 的独特挑战**：
1. 响应格式是纯位置数组（`[i][3][0][0][1][0]`），没有字段名，schema 非常脆弱
2. batchexecute 请求格式复杂（需要正确构造 POST body + 请求头）
3. Imagen 图片 URL 有 CORS 限制，只能在 main 进程中 `net.fetch`

> **认证澄清**：虽然 `__Secure-*` cookie 是 `HttpOnly`（JS 不可读取值），但同源 `fetch` 请求会**自动携带**这些 cookie。因此可以通过注入脚本 fetch，不需要 CDP。参考：[dsdanielpark/Gemini-API](https://github.com/dsdanielpark/Gemini-API) 项目验证了 cookie 认证的可行性。

---

## 二、batchexecute API 结构

### 2.1 请求格式

```
POST /_/BardChatUi/data/batchexecute?rpcids=hNvQHb,<other_rpc_ids>
Content-Type: application/x-www-form-urlencoded

<URL-encoded JSON request body>
```

### 2.2 响应格式（多帧流）

```
)]}'                    ← XSRF 防护前缀（需要剥离）
<frame_byte_length>\n  ← UTF-8 字节数（不是字符数！）
<json_frame>\n
<frame_byte_length>\n
<json_frame>\n
...
```

**⚠️ 关键解析问题**：`frame_byte_length` 是 UTF-8 字节数，但 JavaScript 字符串是 UTF-16。中文/emoji 等多字节字符会导致直接 slice 错位。

**解决方案**：贪心解析 — 从当前位置消费字符，直到遇到 `\n<digits>\n` 边界，然后 JSON.parse。

### 2.3 帧内结构

每帧是嵌套 JSON 数组：

```json
[
  [
    ["wrb.fr", "<rpcId>", "<inner_json_string>", ...],
    ...
  ]
]
```

`inner_json_string` 是**再次 JSON 序列化的字符串** — 需要双重解析：
1. 解析外层帧 → 提取 `inner_json_string`
2. JSON.parse(inner_json_string) → 实际数据

### 2.4 hNvQHb 数据 schema（经验验证，2026-04-13）

对话数据是纯位置数组树（**无字段名**）：

```typescript
inner[0]                                = turns 数组（最新的在前，需要反转）
  [i][0]                                = [conversationId, responseId]
  [i][1]                                = [conversationId, prevResponseId, rcId] | null
  [i][2][0][0]                          = 用户消息文本
  [i][3]                                = assistant 响应载荷（25+ 元素）
    [0][0][1][0]                        = assistant markdown（完整，可直接渲染）
    [0][0][37][0][0]                    = thinking chain 文本
    [0][0][12][7][0][0][0][N][3]        = Imagen 图片 URL 数组
    [12][0][0][14][12][K]               = 搜索 grounding 条目
      [0][0][1][2]                      = 标题
      [0][0][1][3][1][2][1][0]          = URL
  [i][4]                                = [unix_sec, nanos] 时间戳
```

**⚠️ schema 脆弱性**：这些路径是通过经验探测得到的，Gemini 前端更新可能导致路径偏移。现有提取器包含调试工具用于重新定位路径。

---

## 三、内容类型全表

### 3.1 文本内容

| # | 类型 | 位置 | 格式 | 说明 |
|---|------|------|------|------|
| 1 | 纯文本回复 | `[i][3][0][0][1][0]` | 完整 Markdown | 直接可渲染，无需重组 |
| 2 | LaTeX 公式 | 同上（内嵌在 Markdown 中） | `$...$` / `$$...$$` | Google 已经渲染为标准格式 |
| 3 | 代码块 | 同上（内嵌在 Markdown 中） | `` ```lang ... ``` `` | 带语言标记 |
| 4 | 表格 | 同上（内嵌在 Markdown 中） | 管道分隔格式 | 标准 Markdown 表格 |
| 5 | Thinking chain | `[i][3][0][0][37][0][0]` | 纯文本 | 内部推理过程，通常冗长 |

**优势**：所有文本内容在一个字段中，已经是完整 Markdown，不需要像 Claude（从 tool_use 重组）或 ChatGPT（从 parts 解析）那样处理。

### 3.2 图片

| # | 类型 | 位置 | URL 格式 | 获取方式 |
|---|------|------|---------|---------|
| 6 | Imagen 生成图片 | `[i][3][0][0][12][7][0][0][0][N][3]` | `https://lh3.googleusercontent.com/gg/...` | main 进程 `net.fetch`（CORS 限制） |
| 7 | 用户上传图片 | 用户消息中 | 预处理为 multipart | 不在提取范围内 |

**⚠️ Imagen 图片获取限制**：

```
renderer 进程：
  fetch(url, {credentials: 'include'}) → HTTP 400
  fetch(url, {mode: 'no-cors'})        → opaque response, 0 bytes
  new Image() + canvas.toDataURL()     → SecurityError（canvas tainted）

main 进程：
  net.fetch(url)                        → ✅ 正常返回图片数据
```

**解决方案**：通过 IPC 调用 main 进程的 `wbFetchBinary` → base64 → data URL。

**⚠️ 图片 URL 时效性**：lh3.googleusercontent.com 的 URL 会过期，必须在提取时立即转为 base64 内联。

### 3.3 搜索引用（Groundings）

| # | 类型 | 位置 | 格式 | 说明 |
|---|------|------|------|------|
| 8 | 网页搜索结果 | `[i][3][12][0][0][14][12][K]` | 标题 + URL 结构 | 自动附加到回复末尾 |

提取器将 grounding 格式化为 Markdown 引用列表，附加在回复内容后面：

```markdown
## 参考来源
- [标题1](url1)
- [标题2](url2)
```

### 3.4 Pro-Only 功能（未验证）

| # | 类型 | 状态 | 说明 |
|---|------|------|------|
| 9 | Canvas 文档 | ❌ 未验证 | Pro 专属，schema 路径可能不同 |
| 10 | Deep Research | ❌ 未验证 | 扩展分析功能 |
| 11 | Code Execution | ❌ 未验证 | matplotlib 图表等代码执行输出 |
| 12 | Gems（自定义角色） | ❌ 未验证 | 可能影响对话结构 |

---

## 四、与 Claude / ChatGPT Artifact 的对应关系

| Gemini 类型 | Claude 对应 | ChatGPT 对应 |
|------------|------------|-------------|
| 完整 Markdown | `content[].text` + `tool_use[].widget_code` | `content.parts[]` 组装 |
| Imagen 图片 | AI 生成图片 (`content.image`) | DALL·E 图片 (`asset_pointer`) |
| Thinking chain | 无（Claude 不暴露） | 无（ChatGPT 不暴露） |
| 搜索 grounding | 无 | 网页浏览 (`tether_browsing_display`) |
| Canvas | `create_file` / `show_widget` | Canvas (`/textdocs`) |
| Code Execution | `bash_tool` | Code Interpreter |

---

## 五、提取策略

### 唯一策略：注入脚本主动 fetch（和 Claude/ChatGPT 统一，禁止 DOM/CDP）

**原则**：与 Claude/ChatGPT 对齐，所有数据通过 API 获取，零 DOM 操作，不使用 CDP。

```
1. 检测到 Gemini 对话页面（gemini.google.com/app/*）
2. 注入脚本 fetch batchexecute API（同源请求，HttpOnly cookie 自动携带）
3. 解析多帧流响应 → 提取 hNvQHb 数据
4. 转换为 GeminiTurn[] + contentParts（对齐 ChatGPT 的 contentParts 架构）
5. Imagen 图片：通过 IPC 调用 main 进程 net.fetch（绕过 CORS，非 DOM 操作）
6. 所有数据持久化到 media store
```

```javascript
// 在 gemini.google.com 页面中注入
const response = await fetch('/_/BardChatUi/data/batchexecute?rpcids=hNvQHb', {
  method: 'POST',
  credentials: 'include',  // 自动携带 __Secure-* HttpOnly cookie
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    'X-Same-Domain': '1',
  },
  body: constructBatchExecuteBody(conversationId),
});
```

> **⛔ 禁止使用 DOM/CDP 的原因**：
> - CDP 需要刷新页面 → 用户体验差、速度慢
> - DOM 选择器依赖前端 HTML 结构 → 脆弱、频繁失效
> - Claude/ChatGPT 已验证纯 API 路径更快更稳定
> - 三平台统一架构，降低维护成本

### Browser Capability 集成方案

| 阶段 | 方案 | 说明 |
|------|------|------|
| Phase 1 | 注入脚本 fetch + 数据解析 | `probeGeminiConversation` + `gemini-conversation-query.ts` |
| Phase 2 | 完整提取集成 | `gemini-extract-turn.ts` + IPC 路由 + toolbar 按钮 |
| Phase 3 | Pro 功能支持 | Canvas / Deep Research / Code Execution schema 探测 |

### 关键适配点

| 适配项 | 说明 |
|--------|------|
| 顺序反转 | hNvQHb 返回 newest-first，需要反转为 oldest-first |
| Markdown 直用 | API 直接返回完整 Markdown，不需要 contentParts 交错重组 |
| 图片下载 | Imagen URL → main 进程 `net.fetch`（CORS 限制） → base64 → media store |
| Grounding 附加 | 搜索引用格式化后附加到对应 turn 的 Markdown 末尾 |
| Thinking 分离 | thinking chain 单独存储，不混入主 Markdown |
| schema 监控 | 位置数组路径可能变化，需要定期验证 |
| 不使用 DOM/CDP | 所有数据从 batchexecute API 获取，图片通过 main 进程 IPC 下载 |

---

## 六、处理状态

| # | 类型 | 内容可获取 | 现有提取器 | Browser Capability 集成 | Note 中的呈现 |
|---|------|-----------|-----------|----------------------|-------------|
| 1 | 纯文本回复 | ✅ API 直接 | ✅ 已验证 | ❌ 未集成 | 文本段落 |
| 2 | LaTeX 公式 | ✅ 内嵌 Markdown | ✅ 已验证 | ❌ 未集成 | math-inline / math-block |
| 3 | 代码块 | ✅ 内嵌 Markdown | ✅ 已验证 | ❌ 未集成 | code-block |
| 4 | 表格 | ✅ 内嵌 Markdown | ✅ 已验证 | ❌ 未集成 | table |
| 5 | Thinking chain | ✅ 独立路径 | ✅ 已验证 | ❌ 未集成 | 折叠区域 / callout |
| 6 | Imagen 图片 | ✅ main 进程 fetch | ✅ 已验证（base64） | ❌ 未集成 | image block |
| 7 | 搜索 grounding | ✅ 结构化数据 | ✅ 已验证 | ❌ 未集成 | 引用列表 |
| 8 | Canvas 文档 | ❓ Pro-only | ❌ 未验证 | ❌ | 待确认 |
| 9 | Deep Research | ❓ Pro-only | ❌ 未验证 | ❌ | 待确认 |
| 10 | Code Execution | ❓ Pro-only | ❌ 未验证 | ❌ | 待确认 |
| 11 | Gems 角色 | ❓ 可能影响结构 | ❌ 未验证 | ❌ | 待确认 |

---

## 七、测试矩阵

| # | 测试场景 | 包含的内容类型 | 验证点 |
|---|---------|--------------|--------|
| 1 | 纯文本对话 | 文本 + Markdown | 基础提取 + 顺序反转 |
| 2 | 数学对话 | LaTeX 行内 + 块级 | 公式保留 + 渲染 |
| 3 | 代码对话 | 代码块 + 多语言 | 语言标注 + 格式保留 |
| 4 | 图片生成 | Imagen 图片 | main 进程 fetch + base64 内联 |
| 5 | 搜索增强对话 | grounding 引用 | 引用列表格式化 |
| 6 | Thinking 对话 | 推理链 + 最终回复 | thinking 分离 + 折叠呈现 |
| 7 | 混合对话 | 上述所有类型 | 顺序保持 + 多类型共存 |
| 8 | 长对话（20+ turns） | 多轮 | hNvQHb 完整性 |

---

## 八、与三平台提取架构的统一视角

```
Claude:    probeConversation() → 注入 fetch(cookie)       → conversation JSON   → contentParts → markdown → Note
ChatGPT:   probeConversation() → 注入 fetch(Bearer token) → mapping tree        → contentParts → markdown → Note
Gemini:    probeConversation() → 注入 fetch(HttpOnly auto) → batchexecute stream → markdown 直用 → Note
                                                                                         ↑
                                                                                  Imagen 图片：main 进程 net.fetch（CORS）
```

**三平台统一原则**：
- 全部使用注入脚本 `fetch` 获取对话数据
- **禁止 DOM 操作**（不扫描 HTML 元素、不点击 UI 控件）
- **禁止 CDP**（不启动调试协议、不刷新页面、不拦截网络请求）
- 差异仅在认证方式和响应解析，不在数据获取路径
- 图片下载通过 API 或 main 进程 IPC（绕过 CORS），不通过 DOM `<img>` 元素
