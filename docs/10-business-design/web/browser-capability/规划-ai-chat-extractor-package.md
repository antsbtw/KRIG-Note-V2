# 规划：@krig/ai-chat-extractor 独立 Package

> 创建日期：2026-04-21
> 状态：规划中
> 前置：三平台提取已验证（Claude ✅ ChatGPT ✅ Gemini ✅）

---

## 一、目标

将三平台 AI 对话提取的**数据解析逻辑**拆分为独立 package，与 Electron 宿主解耦。

**核心价值**：
- 独立测试 — 用保存的 JSON fixture 跑单元测试，不需要启动 Electron
- 独立迭代 — API 变化时只更新 package，不影响主应用
- 可复用 — CLI 工具、浏览器扩展等场景也能使用
- CI 集成 — 每次提交自动验证解析逻辑

---

## 二、架构分层

当前代码已有清晰分层，适合拆分：

```
┌─────────────────────────────────────────────────────────┐
│  UI 层（AIWebView.tsx）                                  │  留在主应用
│  - 右键菜单、toolbar 按钮、Note 导入                       │
├─────────────────────────────────────────────────────────┤
│  IPC 层（ipc-handlers.ts）                               │  留在主应用
│  - extractTurn / extractFull 路由                         │
├─────────────────────────────────────────────────────────┤
│  数据获取层（main-service.ts）                             │  留在主应用
│  - probe 注入 fetch（依赖 webContents.executeJavaScript）  │
│  - 图片下载（依赖 net.fetch / session.fetch）              │
│  - media store 持久化                                     │
├─════════════════════════════════════════════════════════─┤
│  数据解析层 → 拆为独立 package                              │
│  - conversation-query.ts（纯函数，无副作用）                 │
│  - 类型定义                                               │
├─════════════════════════════════════════════════════════─┤
│  数据转换层 → 部分拆出                                      │
│  - turnToMarkdown 的纯逻辑部分（grounding 格式化等）         │
│  - 文件下载部分留在主应用                                    │
└─────────────────────────────────────────────────────────┘
```

---

## 三、Package 结构

```
@krig/ai-chat-extractor/
├── src/
│   ├── claude/
│   │   ├── parse.ts          ← conversation JSON → ConversationMessage[]
│   │   ├── types.ts          ← ContentPart, MessageArtifact, etc.
│   │   └── __tests__/
│   ├── chatgpt/
│   │   ├── parse.ts          ← mapping tree → ChatGPTTurn[] + contentParts
│   │   ├── widgets.ts        ← stripUnicodeWidgets, unwrapWidgets
│   │   ├── types.ts          ← ChatGPTContentPart, ChatGPTCanvasData, etc.
│   │   └── __tests__/
│   ├── gemini/
│   │   ├── parse.ts          ← batchexecute stream → GeminiTurn[]
│   │   ├── batchexecute.ts   ← parseBatchExecute, pickRpcInner
│   │   ├── types.ts          ← GeminiTurn, GeminiGrounding, etc.
│   │   └── __tests__/
│   ├── shared/
│   │   ├── types.ts          ← ExtractedTurn, ExtractedConversation
│   │   └── utils.ts          ← 通用工具函数
│   └── index.ts              ← 统一导出
├── fixtures/                  ← 测试用的真实 API 响应样本（脱敏）
│   ├── claude/
│   ├── chatgpt/
│   └── gemini/
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## 四、可拆出的纯函数清单

### Claude

| 函数 | 文件 | 说明 |
|------|------|------|
| `getConversationData()` | conversation-query.ts | conversation JSON → 结构化消息 |
| `extractArtifactsFromContent()` | conversation-query.ts | content[] → artifact 列表 |

### ChatGPT

| 函数 | 文件 | 说明 |
|------|------|------|
| `getChatGPTConversationData()` | chatgpt-conversation-query.ts | mapping tree → turns + contentParts |
| `stripUnicodeWidgets()` | chatgpt-conversation-query.ts | widget 标记 → LaTeX / 占位符 |
| `unwrapWidgets()` | chatgpt-conversation-query.ts | genu{} → LaTeX |
| `parseCanvasFromMessage()` | chatgpt-conversation-query.ts | canmore JSON → Canvas 数据 |
| `canvasToMarkdown()` | chatgpt-extract-turn.ts | Canvas → fenced code block |

### Gemini

| 函数 | 文件 | 说明 |
|------|------|------|
| `parseBatchExecute()` | gemini-conversation-query.ts | 多帧流 → JSON frames |
| `pickRpcInner()` | gemini-conversation-query.ts | frames → hNvQHb payload |
| `getGeminiConversationData()` | gemini-conversation-query.ts | batchexecute body → turns |
| `collectImageUrls()` | gemini-conversation-query.ts | turn → Imagen URLs |
| `collectGroundings()` | gemini-conversation-query.ts | turn → grounding 列表 |
| `appendGroundings()` | gemini-extract-turn.ts | markdown + groundings → 格式化 |

---

## 五、不可拆出的部分（依赖 Electron）

| 功能 | 依赖 | 说明 |
|------|------|------|
| probe 注入 fetch | `webContents.executeJavaScript` | 在页面上下文中执行 JS |
| ChatGPT Bearer token | `webContents.executeJavaScript` | 利用页面 cookie 获取 token |
| ChatGPT 文件下载 | `webContents.executeJavaScript` | files/download API 需要 token |
| ChatGPT sandbox 文件 | `webContents.executeJavaScript` | interpreter/download API |
| Gemini 图片下载 | `net.fetch`（main 进程） | CORS 绕过 |
| ChatGPT image_group 下载 | `session.fetch` | 公共 URL 下载 |
| media store 持久化 | `mediaSurrealStore` | 本地存储 |
| trace-writer | 文件系统 | 调试数据持久化 |

---

## 六、稳定性风险评估

| 平台 | 数据格式 | 认证方式 | 变化风险 |
|------|---------|---------|---------|
| Claude | 具名字段 JSON | Cookie（自动） | 低 — 官方 REST API |
| ChatGPT | 具名字段 JSON（mapping tree） | Bearer token（注入获取） | 低 — 字段有明确语义 |
| Gemini | **纯位置数组**（无字段名） | HttpOnly cookie（自动） | **高** — 路径可能偏移 |
| Gemini | batchexecute 请求格式 | SNlM0e XSRF token | **中** — 逆向协议 |

### Gemini 的防护措施

- `fixtures/gemini/` 保存真实响应样本
- 单元测试验证所有路径提取
- schema 变化时测试自动失败，快速定位偏移
- `getPath()` 函数在路径断裂时返回 undefined 而非崩溃

---

## 七、工程化能力路线图

> 原则：按优先级逐步推进，不一次性大改。每个阶段可独立交付价值。

### P0：数据契约稳定化（最高优先）

**目标**：上游字段变化不导致整批失败。

| 任务 | 说明 |
|------|------|
| Canonical Schema | 统一三平台输出为 `ExtractedConversation`，带 `schema_version` 字段 |
| 宽松解析 + 严格输出 | 解析层对缺失/新增字段容错（`getPath` 返回 undefined），输出层强制校验必要字段 |
| Gemini schema 监控 | 位置数组路径可能偏移 → fixture 测试 + CI 自动回归 |

### P1：自动化回归测试

**目标**：改 parser 必跑，防止格式回归。

| 任务 | 说明 |
|------|------|
| 录制样本回放 | 固定 conversation JSON + 期望提取结果，每次改动跑对比 |
| Fixture 收集 | 每平台至少 5 种场景（纯文本、图片、Canvas、搜索、长对话），脱敏后存入 `fixtures/` |
| CI 集成 | 每次 PR 自动跑 parse 层单元测试 |

### P2：强重试与幂等

**目标**：网络波动不丢数据，重复执行不产生脏数据。

| 任务 | 说明 |
|------|------|
| 指数退避重试 | 对 429/5xx/超时做 3 次重试，间隔 1s → 3s → 9s |
| 幂等去重 | 写入层按 `platform + conversation_id + message_id` 去重，避免重复插入 |
| Token 失效恢复 | 当前 ChatGPT 已有 401 刷新机制，Claude/Gemini 对齐 |

### P3：提取 Package 拆分

**目标**：纯函数独立为 npm package，可测试、可复用。

```
Phase 3.1: 提取纯函数到 packages/ai-chat-extractor/
  - 移动 parse 函数和类型定义
  - 主应用改为 import from package
  - 不改变任何功能行为

Phase 3.2: 添加测试（复用 P1 的 fixture）
  - vitest 单元测试
  - CI 集成

Phase 3.3: 独立发布
  - npm workspace 或独立 repo
  - 版本管理 + CHANGELOG
```

### P4：批量采集工程化

**目标**：支持全量首跑 + 增量续跑。

| 任务 | 说明 |
|------|------|
| 会话列表拉取 | 分页获取用户所有对话列表（Claude/ChatGPT 有 list API） |
| 游标断点续传 | 记录 `last_seen` 游标，中断后可恢复 |
| 增量同步 | 只拉取 `last_seen` 之后的新对话/新消息 |
| 并发控制 | 限制并发请求数，避免触发平台限流 |

### P5：观测与完整性校验

**目标**：可量化健康指标，不只看是否报错。

| 任务 | 说明 |
|------|------|
| 采集对账 | 每次提取后校验：会话数、消息数、附件数、缺失率 |
| 失败分类 | 按原因分类：认证失败、网络超时、解析错误、schema 偏移 |
| 成功率指标 | 每平台成功率、重试次数、平均耗时 |
| Raw payload 快照 | 保留原始响应（已有 trace-writer 基础），支持单任务重放 |

---

## 八、当前状态（2026-04-21）

```
✅ 已完成：
  - 三平台端到端集成（Claude / ChatGPT / Gemini）
  - 零 DOM/CDP 的纯 API 提取
  - ChatGPT Bearer token 缓存 + 401 自动刷新
  - contentParts 保序架构
  - trace-writer 调试基础设施

⚠️ 已知短板：
  - Gemini schema 脆弱（纯位置数组，无字段名）
  - 无自动化回归测试（手动验证）
  - 无批量采集能力（只支持单对话提取）
  - 无幂等去重（重复提取会重复写入 Note）
  - 无完整性校验指标

🎯 下一步建议：P0 → P1 → P2 逐步推进
```
