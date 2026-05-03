# ChatGPT Artifact 类型全表

> 文档类型：参考文档  
> 创建日期：2026-04-20 | 版本：v1.0  
> 数据来源：ChatGPT conversation API + 现有 chatgpt-content-extractor.ts 分析  
> 目的：全面梳理 ChatGPT 页面中所有内容类型，为 Browser Capability 提取做准备

---

## 一、ChatGPT 与 Claude 的架构差异

| 维度 | ChatGPT | Claude |
|------|---------|--------|
| 对话模型 | 树形图（parent→children mapping） | 线性消息数组 |
| API 端点 | `/backend-api/conversation/{uuid}` | `/api/organizations/{orgId}/chat_conversations/{convId}` |
| 消息格式 | `mapping[nodeId].message` 树结构 | `chat_messages[]` 平铺数组 |
| 认证方式 | Service Worker 注入 Bearer token（页面 fetch 返回 401） | Cookie 认证（页面可直接 fetch） |
| 提取方式 | **CDP 被动捕获**（必须先启动 CDP 再刷新页面） | **直接 fetch**（注入脚本即可） |
| Artifact 概念 | Canvas（`/textdocs` 端点）+ 工具输出 | `tool_use[].widget_code` / `file_text` |
| 流式响应 | SSE，但最终用 conversation API 获取权威数据 | SSE + conversation API |

**认证方式**：ChatGPT 的 `/backend-api/` 使用 Bearer token 认证。token 可通过页面级 `fetch('/api/auth/session')` 获取 `accessToken`，然后带 `Authorization: Bearer <token>` 请求 `/backend-api/`。这意味着和 Claude 一样，可以通过注入脚本主动 fetch，**不一定需要 CDP**。

> 注：之前认为"Service Worker 拦截导致 401"是因为未带 Authorization header。`/api/auth/session` 依赖 cookie 认证（页面上下文天然具备），返回的 `accessToken` 用于后续 `/backend-api/` 请求。

---

## 二、Conversation API 结构

### 2.1 对话树（`/backend-api/conversation/{uuid}`）

```typescript
{
  title: string;
  mapping: {
    [nodeId: string]: {
      id: string;
      parent: string | null;
      children: string[];
      message: {
        id: string;
        author: { role: 'user' | 'assistant' | 'tool' | 'system'; name?: string };
        create_time: number;
        content: {
          content_type: string;        // 'text' | 'code' | 'execution_output' | 'tether_browsing_display' | 'multimodal_text' | ...
          parts: Array<                // ⚠️ 类型复杂，不能简化为 string | object
            | string                   // 纯文本 / Markdown（含 $...$, \(...\) 等 LaTeX）
            | {                        // 图片 asset 引用
                asset_pointer: string; // "sediment://file_xxx" (DALL·E) 或 "file-service://file_xxx"
                content_type?: string;
                metadata?: Record<string, unknown>;
              }
            | {                        // widget 指令（块级 LaTeX 等）
                // Private Unicode marker 包裹的 JSON，如：
                // genu{"math_block_widget_always_prefetch_v2":{"content":"e^{ix}=..."}}
                // 需要解包后转为 $$...$$ 格式
              }
            | object                   // citation / 其他结构化对象
          >;
        };
        metadata: {
          attachments?: Array<{        // 用户上传的文件
            id: string;
            name: string;
            mime_type?: string;
            size?: number;
          }>;
          aggregate_result?: {         // Code Interpreter 执行结果
            messages: Array<{
              message_type: string;
              image_url: string;       // "file-service://file_xxx"
            }>;
          };
          is_visually_hidden_from_conversation?: boolean;
        };
        recipient?: string;            // 'python' | 'dalle.text2im' | 'bio' | 'canmore.create_textdoc' | ...
      };
    };
  };
}
```

### 2.2 Canvas 文档（`/backend-api/conversation/{uuid}/textdocs`）

```typescript
[
  {
    id: string;
    version: number;
    title: string;
    textdoc_type: string;   // 'document' | 'code' | ...
    content: string;         // 完整 Markdown（含代码块）
  }
]
```

### 2.3 文件内容（`/backend-api/estuary/content?id=file_xxx`）

- 返回原始文件字节（base64 编码）
- Content-Type 为 `application/octet-stream`（需要从 magic bytes 推断真实 MIME）

### 2.4 重要注意事项

#### ⚠️ 分支对话处理

ChatGPT 的 `mapping` 是**多分支树**——用户编辑消息会产生新分支。每个节点可能有多个 `children`。

**策略**：只提取当前显示路径（从 `current_node` 沿 `parent` 回溯到 root），不提取历史分支。

```
实现方式：
  1. 找到 current_node（mapping 中没有被任何其他节点作为 child 引用的叶子节点）
  2. 从 current_node 沿 parent 链回溯到 root
  3. 反转得到从 root 到 leaf 的线性路径
  4. 该路径就是用户当前看到的对话
```

现有 `chatgpt-content-extractor.ts` 使用"沿最后一个 child 遍历"策略（近似等价）。

#### ⚠️ LaTeX 多种形式

ChatGPT 的 LaTeX 不只一种格式：

| 形式 | 示例 | 说明 |
|------|------|------|
| 标准 inline | `\(e^{ix}\)` | 行内公式 |
| 标准 block | `\[E=mc^2\]` | 块级公式 |
| Markdown inline | `$e^{ix}$` | 部分对话使用 |
| Markdown block | `$$E=mc^2$$` | 部分对话使用 |
| Widget 指令 | Private Unicode + `genu{math_block_widget...}` | 块级公式的另一种形式 |

解析器必须处理所有变体，不能只处理 widget 形式。

#### ⚠️ Turn 合并复杂性

实际的 turn 结构比 `user + tool + assistant = 1 turn` 复杂：

```typescript
// 实际 turn 模型
type ChatGPTTurn = {
  user: Message;                    // 用户消息
  toolCalls: Array<{               // 可能多次 tool 调用
    call: Message;                  // recipient='python'/'dalle' 等
    result: Message;               // author.role='tool' 的结果
  }>;
  assistant: Message;              // 最终 assistant 回复
  hidden: Message[];               // 被标记为 hidden 的中间节点
};
```

注意：
- 一个 assistant 回复可能触发多次 tool 调用（先搜索再执行代码）
- tool_result 可能包含嵌套输出（Code Interpreter 产出的图片）
- `is_visually_hidden_from_conversation === true` 的节点要跳过
- streaming 分段的消息需要合并

---

## 三、内容类型全表

### 3.1 文本内容

| # | 类型 | 位置 | 格式 | 说明 |
|---|------|------|------|------|
| 1 | 纯文本回复 | `content.parts[]` (string) | Markdown | 最常见的内容类型 |
| 2 | LaTeX 公式（行内） | `content.parts[]` | `\(...\)` 包裹 | 标准 LaTeX 行内公式 |
| 3 | LaTeX 公式（块级） | `content.parts[]` | Private Unicode marker + JSON `genu{...}` | 包含 `math_block_widget_always_prefetch_v2.content` |
| 4 | 代码块 | `content.parts[]` | Markdown `` ```lang ... ``` `` | 标准 fenced code block |

### 3.2 图片

| # | 类型 | 位置 | 引用格式 | 获取方式 |
|---|------|------|---------|---------|
| 5 | DALL·E 生成图片 | `content.parts[].asset_pointer` | `sediment://file_xxx` | `/backend-api/estuary/content?id=file_xxx` |
| 6 | Code Interpreter 图片（matplotlib 等） | `metadata.aggregate_result.messages[].image_url` | `file-service://file_xxx` | `/backend-api/estuary/content?id=file_xxx` |
| 7 | 用户上传图片 | `metadata.attachments[]` | `{ id: "file_xxx", mime_type: "image/png" }` | `/backend-api/estuary/content?id=file_xxx` |

**MIME 类型推断**：estuary 接口返回 `application/octet-stream`，需要从 base64 前几个字符推断：

| base64 前缀 | MIME |
|-------------|------|
| `iVBORw` | image/png |
| `/9j/` | image/jpeg |
| `R0lGODl` | image/gif |
| `UklGR` | image/webp |
| `PHN2Zy` / `PD94bWw` | image/svg+xml |
| `JVBER` | application/pdf |

### 3.3 文件

| # | 类型 | 位置 | 格式 | 说明 |
|---|------|------|------|------|
| 8 | 用户上传文件 | `metadata.attachments[]` | `{ id, name, mime_type, size }` | PDF/CSV/XLSX/代码文件等 |
| 9 | Code Interpreter 生成文件 | `metadata.aggregate_result.messages[]` 或 `content.parts[]` | `file-service://file_xxx` | 生成的 CSV/图表/数据文件 |

### 3.4 Canvas（画布）

| # | 类型 | 位置 | 格式 | 说明 |
|---|------|------|------|------|
| 10 | Canvas 文档 | `/textdocs` 端点 | Markdown | 文章、报告等文档型内容 |
| 11 | Canvas 代码 | `/textdocs[].content` 内 | `` ```jsx/python/... `` `` 代码块 | React 组件、Python 脚本等 |

**触发 Canvas 的 recipient**：
- `canmore.create_textdoc` — 创建新文档
- `canmore.update_textdoc` — 更新现有文档
- `canmore.comment_textdoc` — 添加评论

### 3.5 工具调用

| # | 类型 | 识别方式 | 说明 |
|---|------|---------|------|
| 12 | Code Interpreter | `recipient === 'python'` | Python 代码执行 |
| 13 | DALL·E | `recipient === 'dalle.text2im'` | 图片生成 |
| 14 | 网页浏览 | `content_type === 'tether_browsing_display'` | 搜索结果展示 |
| 15 | Plugin 调用 | `recipient === '<plugin_name>'` | 第三方插件 |

### 3.6 系统/隐藏消息

| # | 类型 | 识别方式 | 说明 |
|---|------|---------|------|
| 16 | 系统提示 | `author.role === 'system'` | 通常隐藏 |
| 17 | 工具结果 | `author.role === 'tool'` | Code Interpreter 输出等 |
| 18 | 隐藏消息 | `metadata.is_visually_hidden_from_conversation === true` | 不在 UI 中显示 |

---

## 四、与 Claude Artifact 的对应关系

| ChatGPT 类型 | Claude 对应 | 差异 |
|-------------|------------|------|
| Canvas 文档 | `create_file` (.md) | ChatGPT 有独立 API 端点；Claude 内嵌在 tool_use |
| Canvas 代码 | `create_file` (.js/.py) | 同上 |
| DALL·E 图片 | AI 生成图片 (`content.image`) | 引用格式不同（sediment:// vs URL） |
| Code Interpreter 图片 | 无直接对应 | Claude 没有代码执行环境 |
| Code Interpreter 文件 | `bash_tool` + `present_files` | 类似但 API 结构不同 |
| 用户上传文件 | `message.files[]` | 结构类似 |
| Markdown 文本 | `content[].text` | 格式一致 |
| LaTeX 公式 | `content[].text` 中内嵌 | ChatGPT 用 Private Unicode marker |

---

## 五、提取策略对比

### Claude 提取策略（已实现）

```
conversation API → 直接 fetch（cookie 认证）
  → widget_code / file_text 内容自包含
  → local_resource → wiggle API 主动下载
```

### ChatGPT 提取策略（已实现）

**纯数据驱动：注入脚本 fetch API，零 DOM 操作**

```
1. 注入脚本 fetch('/api/auth/session') → 获取 accessToken（4 分钟缓存 + 401 自动刷新）
2. Bearer token fetch('/backend-api/conversation/{uuid}') → 对话树 mapping
3. 解析 mapping 树 → 按 user 消息分组为 turn → 构建 contentParts[]
4. contentParts 保持原始交错顺序（text / canvas / file / image_group）
5. Canvas → 从 canmore.create_textdoc 消息的 content.text JSON 直接解析
6. image_group → 从 metadata.content_references[type=image_group].images[].content_url 获取
7. DALL·E / Code Interpreter 文件 → /backend-api/files/download/{id}?conversation_id={cid}
8. Sandbox 文件 → /backend-api/conversation/{id}/interpreter/download（精确 messageId）
```

**与 Claude 的对齐**：两者共享 `contentParts` 架构——text 和 artifact 交错排列，渲染时按序处理。ChatGPT 用 Bearer token 认证（注入 fetch 获取），Claude 用 cookie 认证（直接 fetch）。

> **⛔ 禁止使用 DOM/CDP**：所有数据通过 API 获取，不扫描 HTML 元素，不使用 CDP 调试协议。已验证纯 API 路径更快更稳定。

---

## 六、处理状态

| # | 类型 | 内容可获取 | 提取方式 | 集成状态 | Note 中的呈现 |
|---|------|-----------|---------|---------|-------------|
| 1 | 纯文本回复 | ✅ API 自包含 | contentParts text | ✅ 已完成 | 文本段落 |
| 2 | LaTeX 行内 | ✅ API 自包含 | `\(...\)` 保留 | ✅ 已完成 | math-inline |
| 3 | LaTeX 块级 | ✅ widget 解包 | stripUnicodeWidgets → `$$...$$` | ✅ 已完成 | math-block |
| 4 | 代码块 | ✅ API 自包含 | markdown fenced code block | ✅ 已完成 | code-block |
| 5 | DALL·E 图片 | ✅ files/download API | `/backend-api/files/download/{id}?conversation_id={cid}` | ✅ 已完成 | image block |
| 6 | Code Interpreter 图片 | ✅ sandbox API | `/backend-api/conversation/{id}/interpreter/download` | ✅ 已完成 | image block |
| 7 | 用户上传图片 | ✅ estuary API | 用户端内容，不提取 | ⏭ 跳过 | — |
| 8 | 用户上传文件 | ✅ estuary API | 用户端内容，不提取 | ⏭ 跳过 | — |
| 9 | Code Interpreter 文件 | ✅ sandbox API | sandbox 链接 → 精确 messageId 下载 | ✅ 已完成 | 附件/图片 |
| 10 | Canvas 文档 | ✅ canmore 消息 | `canmore.create_textdoc` content.text JSON | ✅ 已完成 | markdown Canvas Block |
| 11 | Canvas 代码 | ✅ canmore 消息 | 同上，生成 `\`\`\`lang title="..."` | ✅ 已完成 | code Canvas Block |
| 12 | Code Interpreter 调用 | ✅ 代码在 parts 中 | text 中保留代码块 | ✅ 已完成 | code-block |
| 13 | DALL·E 调用 | ⏭ prompt 在 parts 中 | 内部工具调用，不提取 | ⏭ 跳过 | — |
| 14 | 网页浏览结果 | ✅ 搜索摘要在 text 中 | 文字 + image_group 图片均提取 | ✅ 已完成 | 文本 + 图片 |
| 15 | Plugin 调用 | ⚠️ 取决于 plugin | 暂不处理 | ⏭ 跳过 | — |
| 16 | 系统提示 | ⏭ 隐藏 | hidden 消息跳过 | ⏭ 跳过 | — |
| 17 | 工具结果 | ✅ 在 tool 消息中 | contentParts 保序合入 turn | ✅ 已完成 | 合入对应 turn |
| 18 | 隐藏消息 | ⏭ 跳过 | hidden 消息跳过 | ⏭ 跳过 | — |

---

## 七、Browser Capability 集成方案

### Phase 1：主动 fetch 提取（推荐）

和 Claude 使用相同的 `probeConversation` 模式：

1. 检测到 ChatGPT 对话页面（`chatgpt.com/c/{uuid}`）
2. 注入脚本：`fetch('/api/auth/session')` → 获取 `accessToken`
3. 用 Bearer token `fetch('/backend-api/conversation/{uuid}')` → 对话树
4. 遍历 mapping 树（沿当前路径），转换为 `ConversationData` 格式
5. 图片/文件：用 Bearer token `fetch estuary API` 获取二进制
6. Canvas：`fetch('/backend-api/conversation/{uuid}/textdocs')`
7. 复用 `extractTurn` / `extractFullConversation` 流程

### Phase 2：CDP fallback

当注入 fetch 失败时（如 CSP 限制），退回 CDP 被动捕获模式。

### 关键适配点

| 适配项 | 说明 |
|--------|------|
| 树形→线性转换 | mapping 树沿当前路径遍历 → 线性消息数组（跳过分支和隐藏节点） |
| parts 解析 | 处理多种 part 类型：string / asset_pointer / widget / citation |
| LaTeX 多形式 | `\(...\)` + `$...$` + widget 指令，全部处理 |
| Turn 合并 | user → toolCalls[] → assistant 结构，一个 turn 可能包含多次 tool 调用 |
| 文件获取 | sediment:// / file-service:// → estuary API（Bearer token） |
| Canvas 整合 | textdocs API → 独立 artifact 类型 |
| MIME 推断 | estuary 返回 octet-stream → base64 magic bytes 推断真实类型 |

---

## 八、测试矩阵

完整测试需要覆盖以下场景：

| # | 测试场景 | 包含的内容类型 | 验证点 |
|---|---------|--------------|--------|
| 1 | 纯文本对话 | 文本 + Markdown | 基础提取 + 格式保留 |
| 2 | 数学对话 | LaTeX 行内 + 块级 | widget 解包 + 公式渲染 |
| 3 | 代码对话 | 代码块 + Code Interpreter 输出 | 语言标注 + 图片提取 |
| 4 | 图片对话 | DALL·E + 用户上传图片 | estuary 文件获取 + MIME 推断 |
| 5 | Canvas 文档 | 文档 + 代码 Canvas | textdocs API + 内容提取 |
| 6 | 文件上传对话 | PDF/CSV 分析 | 附件引用 + 分析结果 |
| 7 | 混合对话 | 上述所有类型 | 顺序保持 + 多类型共存 |
| 8 | 长对话（20+ turns） | 多轮 + 分支 | 树形遍历正确性 |
| 9 | 搜索对话 | 网页浏览 + 引用 | 搜索结果格式化 |
