# WebView 开发计划

> 基于：`WebView-设计.md`（已审查通过，5 条决策已确认）
> 前置依赖：Framework Milestone 1-4（骨架、双 Slot、协议+菜单、持久化）
> 创建日期：2026-04-08

---

## 前置条件

WebView 是 View 层插件，依赖框架层就绪：

| 前置项 | 来源 | 状态 |
|--------|------|------|
| Shell + Slot 布局系统 | Milestone 1 | ✅ 已实现 |
| View Registry + 生命周期 | Milestone 1 | ✅ 已实现 |
| WorkMode 注册 | Milestone 1 | ✅ 已实现 |
| NavSide Registry | Milestone 1 | ✅ 已实现 |
| Divider 双 Slot | Milestone 2 | ✅ 已实现 |
| Protocol Registry | Milestone 3 | ✅ 已实现 |
| Application Menu 注册 | Milestone 3 | ✅ 已实现 |
| Session Persistence | Milestone 4 | ✅ 已实现 |

> 如果 Milestone 1-4 尚未全部完成，Batch 1 可以先行开发（只依赖 Milestone 1-2），Batch 3+ 等待 Milestone 3-4。

---

## Batch 1：基础浏览（预计 3-5 天）

### 目标
最小可用 WebView：能打开网页、导航、加书签。

### 产出文件

```
web.html                                    ← 入口 HTML
vite.web.config.mts                         ← Vite 配置
forge.config.ts                             ← 新增 web_view renderer entry

src/plugins/web/
  renderer.tsx                              ← 渲染入口（挂载 WebView 组件）
  web.css                                   ← 样式（暗色主题）
  components/
    WebView.tsx                             ← 顶层组件（Toolbar + webview 容器）
    WebToolbar.tsx                          ← Toolbar（导航 + 地址栏 + 书签）
  main/
    bookmark-store.ts                       ← 书签 JSON 存储（复用 eBook 文件夹模式）
    history-store.ts                        ← 浏览历史 JSON 存储
  navside/
    WebPanel.tsx                            ← 书签树 + 最近访问
  preload/
    web-content.ts                          ← CSP bypass（模块化结构，为 Batch 5 预留）

src/main/preload/view.ts                    ← 补充 web 相关 IPC 方法
src/main/ipc/handlers.ts                    ← 补充 web 书签/历史 handler
```

### 任务清单

**1.1 构建入口（0.5 天）**
- [ ] 创建 `web.html`、`vite.web.config.mts`
- [ ] `forge.config.ts` 新增 `web_view` renderer entry + preload
- [ ] 创建 `src/plugins/web/renderer.tsx` 骨架

**1.2 WebView 核心组件（1-1.5 天）**
- [ ] `WebView.tsx` — webview 标签 + 状态管理（URL、loading、canGoBack/Forward）
- [ ] webview 事件监听：`did-navigate`、`did-start-loading`、`did-stop-loading`、`page-title-updated`
- [ ] `PersistedViewState` 实现：`getState()` / `restoreState()` 保存/恢复 URL + zoom
- [ ] webview `partition="persist:web"` 独立 session

**1.3 WebToolbar（1 天）**
- [ ] Left 区域：后退 / 前进 / 刷新按钮
- [ ] Center 区域：地址栏（URL 显示 + 编辑模式 + 搜索引擎转换 + HTTPS 自动补全）
- [ ] Right 区域：书签切换按钮 ★/☆
- [ ] Toolbar ↔ webview 状态同步（URL、loading indicator）

**1.4 数据存储（0.5 天）**
- [ ] `bookmark-store.ts` — WebBookmark + WebBookmarkFolder CRUD（复用 eBook 的 BookshelfStore 模式）
- [ ] `history-store.ts` — WebHistoryEntry 自动记录（webview `did-navigate` 时写入）
- [ ] IPC handler 注册（书签增删改查、历史列表）

**1.5 NavSide 面板（0.5 天）**
- [ ] `WebPanel.tsx` — 书签树（文件夹 + 拖拽排序）+ 最近访问折叠区域
- [ ] `navSideRegistry.register({ workModeId: 'web', ... })`
- [ ] 点击书签 → webview 导航

**1.6 注册 + 集成（0.5 天）**
- [ ] `app.ts` 注册 WebView plugin：WorkMode、NavSide、View factory
- [ ] `web-content.ts` preload：CSP bypass（MutationObserver 移除 CSP meta）
- [ ] `web.css` 暗色主题样式
- [ ] 验证：启动 → 切换到 Web WorkMode → 输入 URL → 导航 → 加书签 → 重启恢复

### 验收标准
- 能输入 URL 浏览网页，后退/前进/刷新正常
- 书签增删，NavSide 书签树正确显示
- 浏览历史自动记录
- 关闭/重启后恢复上次 URL
- 暗色主题视觉一致

---

## Batch 2：增强功能（预计 2-3 天）

### 产出文件
```
src/plugins/web/
  components/
    FindBar.tsx                             ← 页内查找 UI
  main/
    content-extractor.ts                    ← Readability 提取逻辑
```

### 任务清单

**2.1 内容提取（1 天）**
- [ ] `content-extractor.ts` — Readability 算法清理网页 → Markdown → `ExtractedBlock[]`（复用 mirro-desktop 类型）
- [ ] Toolbar 提取按钮 📋 → 创建新 Note + 记录源 URL
- [ ] 选中文本提取（webview `context-menu` 事件 → 右键菜单 "提取到 Note"）

**2.2 页内查找（0.5 天）**
- [ ] `FindBar.tsx` — Cmd+F 触发，webview `findInPage()` API
- [ ] 匹配数量显示、上/下导航、Esc 关闭

**2.3 缩放（0.5 天）**
- [ ] Cmd+/- 缩放，Cmd+0 重置
- [ ] zoom level 持久化到 `PersistedViewState`

**2.4 广告屏蔽（0.5 天）**
- [ ] `webContents.session.webRequest.onBeforeRequest` 过滤广告域名
- [ ] 基础广告域名列表（EasyList 子集）

### 验收标准
- 提取网页内容到新 Note，Note 中包含源 URL
- Cmd+F 查找正常，高亮匹配
- 缩放级别持久化

---

## Batch 3：AI 对话 + SSE 拦截（预计 4-5 天）

> 核心 Batch——从 mirro-desktop `ai-bridge` 模块迁移 SSE 拦截架构。

### 产出文件
```
src/plugins/web/
  ai-bridge/
    service-detector.ts                     ← LLMServiceDetector（URL 匹配）
    sse-capture-manager.ts                  ← SSECaptureManager（三服务拦截）
    inject-scripts.ts                       ← 注入脚本（Claude fetch hook / ChatGPT conv API）
    content-sender.ts                       ← ContentSender（粘贴到 AI 输入框）
    types.ts                                ← LLMServiceConfig 等类型
  components/
    WebToolbar.tsx                          ← 扩展：AI 服务名显示、服务切换下拉
  navside/
    AIPanel.tsx                             ← AI 服务选择面板
```

### 任务清单

**3.1 AI 服务检测（0.5 天）**
- [ ] `service-detector.ts` — URL pattern 匹配（ChatGPT、Claude、Gemini）
- [ ] `types.ts` — `LLMServiceConfig`（urlPatterns、inputSelector、sseEndpointPattern、sseFormat）

**3.2 SSE 拦截迁移（2 天）**
- [ ] `inject-scripts.ts` — 从 mirro-desktop 迁移三套注入脚本
  - Claude：fetch hook → `text_delta` SSE 拦截
  - ChatGPT：`/textdocs` 检测 → conversation API 获取完整 Markdown
  - Gemini：预留 CDP 接口（由 sse-capture-manager 在 main 进程侧处理）
- [ ] `sse-capture-manager.ts` — 注入管理 + Gemini CDP 拦截 + 响应缓存（`window.__krig_sse_responses`）
- [ ] 验证：分别在 Claude/ChatGPT/Gemini 中对话，确认 `getLatestResponse()` 能拿到完整 Markdown

**3.3 ContentSender（0.5 天）**
- [ ] `content-sender.ts` — `pasteToAI()`（支持 textarea + contenteditable）
- [ ] `pasteImageToAI()`（webContents.paste）

**3.4 WebView:ai 变体（1 天）**
- [ ] WebToolbar 扩展：AI 模式下隐藏地址栏编辑、书签、提取，显示 AI 服务名 + 切换下拉
- [ ] `AIPanel.tsx` — NavSide 快捷切换按钮（ChatGPT / Claude / Gemini）
- [ ] `navSideRegistry.register({ workModeId: 'ai', ... })`
- [ ] WorkMode `ai` 注册（ViewType: web, variant: ai）

**3.5 集成验证（0.5 天）**
- [ ] 切换到 AI WorkMode → 加载 Claude → 发送消息 → SSE 拦截拿到回复
- [ ] 切换 AI 服务 → URL 导航 → 服务检测正确
- [ ] AI 模式 Toolbar 显示正确

### 验收标准
- 三个 AI 服务的 SSE 响应都能被正确拦截为 Markdown
- AI 模式 Toolbar 变体正确（服务名 + 切换）
- NavSide AI 面板正常

---

## Batch 4：AI 双向交互 + 协同 + 持久化（预计 4-5 天）

### 产出文件
```
src/plugins/web/
  ai-bridge/
    ai-interaction.ts                       ← AIInteraction（send/request/batch）
  main/
    conversation-store.ts                   ← AI 对话持久化 JSON 存储
  components/
    WebView.tsx                             ← 扩展：发送选区到 AI
```

### 任务清单

**4.1 AIInteraction 统一交互（1.5 天）**
- [ ] `ai-interaction.ts` — 从 mirro-desktop 迁移
  - `send(text)` — 粘贴到 AI 输入框
  - `request(prompt)` — send + 自动 Enter + 轮询 SSE 缓存等待回复
  - `requestWithFile(opts)` — 上传文件 + prompt + 等待回复
  - `batch(pages[])` — 分页循环请求
- [ ] `waitForAIReady()` — 等待 AI 服务 DOM 就绪
- [ ] `triggerSend()` — 模拟 Enter 键

**4.2 AI 对话持久化（1 天）**
- [ ] `conversation-store.ts` — `{userData}/krig-note/web/conversations/{id}.json`
- [ ] SSECaptureManager 回调 → 自动存储 `AIConversation { service, messages[], capturedAt }`
- [ ] IPC handler：列表、读取、删除对话

**4.3 translate 协同协议（1 天）**
- [ ] `protocolRegistry.register({ id: 'web-translate', match: { left: 'web', right: 'web' } })`
- [ ] 协议实现：左侧导航 → 右侧同步 URL + Google Translate 注入
- [ ] 滚动同步（双向，鼠标所在侧驱动）

**4.4 发送选区到 AI（0.5 天）**
- [ ] 从 NoteView / EBookView 选中文本 → 跨 View 通信 → 粘贴到 AI 输入框
- [ ] IPC 路由：`view:send-to-ai` → ContentSender

**4.5 提取 → Thought 关联（0.5 天）**
- [ ] 内容提取时记录 `anchor: { type: 'web', url, selector }`
- [ ] AI 对话提取时记录 `anchor: { type: 'ai-conversation', conversationId, messageIndex }`

### 验收标准
- `request()` 能发送 prompt 并等到回复 Markdown
- AI 对话自动存储，重启后可回溯
- 翻译协议：双屏 WebView 同步导航 + 翻译注入
- 从 Note 选区发送到 AI 正常工作

---

## Batch 5：Automation Layer（预计 5-7 天）

> 为 Module 5 Agent（Gemma 4）提供浏览器操控能力。

### 产出文件
```
src/plugins/web/
  automation/
    browser-automation.ts                   ← IBrowserAutomation 实现
    automation-policy.ts                    ← AutomationPolicy 安全策略
    task-constraints.ts                     ← TaskConstraints 任务级约束
  preload/
    web-content.ts                          ← 扩展：automation bridge 注入
```

### 任务清单

**5.1 IBrowserAutomation 实现（2 天）**
- [ ] `browser-automation.ts` — 基于 `webview.executeJavaScript()` + `webview.capturePage()` 实现
  - 导航：`navigate()`、`waitForLoad()`、`waitForSelector()`、`goBack()`、`goForward()`
  - 读取：`getURL()`、`getTitle()`、`getTextContent()`、`querySelector()`、`querySelectorAll()`、`getLinks()`、`getFormFields()`
  - 交互：`click()`、`type()`、`press()`、`select()`、`scrollTo()`、`scrollBy()`
  - 截图：`screenshot()`（可见区域）、`screenshotElement()`
  - 复合：`searchGoogle()`、`fillForm()`
  - JS 执行：`evaluate()`

**5.2 Automation Bridge Preload（1 天）**
- [ ] `web-content.ts` 扩展：注入 DOM 操控函数
  - `automation:click`、`automation:type`、`automation:get-text` 等 IPC 消息处理
  - `automation:query-selector`、`automation:get-links`、`automation:get-form-fields`
- [ ] `ipcRenderer.sendToHost()` 返回结果

**5.3 安全策略（1.5 天）**
- [ ] `automation-policy.ts` — `AutomationPolicy`（全局白名单、路径黑名单、字段黑名单）
- [ ] `task-constraints.ts` — `TaskConstraints`（任务级约束）+ `setTaskConstraints()` / `clearTaskConstraints()`
- [ ] 交集计算：`模板约束 ∩ 全局约束 = 实际允许范围`
- [ ] `navigate()` 调用时域名检查 + 日志记录（含被拒绝的请求）
- [ ] Level 0 操作矩阵实现

**5.4 IPC 暴露 + 集成（1 天）**
- [ ] Main 进程 IPC handler：`web:automation:*` 命名空间
- [ ] Module 5 Agent 调用入口：`krig.browser.*` 接口映射
- [ ] Toolbar 状态同步：Agent 操控时 URL 实时更新
- [ ] "停止"按钮：中断 Agent 操作

**5.5 验证（0.5 天）**
- [ ] 程序化导航到 Google → 搜索 → 读取结果
- [ ] Level 0 域名白名单拦截验证
- [ ] 被拒绝操作的日志记录验证

### 验收标准
- `IBrowserAutomation` 全部方法可用
- Level 0 任务只能访问白名单域名
- Agent 操控时 Toolbar URL 实时同步
- 用户可中断 Agent 操作

---

## 时间线总览

```
前置：Framework Milestone 1-4 完成
  │
  ├── Batch 1（3-5 天）基础浏览
  │     webview + Toolbar + 书签 + 历史 + NavSide + 持久化
  │
  ├── Batch 2（2-3 天）增强功能
  │     内容提取 + 页内查找 + 缩放 + 广告屏蔽
  │
  ├── Batch 3（4-5 天）AI 对话 + SSE 拦截
  │     三服务 SSE 拦截 + ContentSender + WebView:ai 变体
  │
  ├── Batch 4（4-5 天）双向交互 + 协同 + 持久化
  │     AIInteraction + 对话存储 + translate 协议 + Thought 关联
  │
  └── Batch 5（5-7 天）Automation Layer
        IBrowserAutomation + 安全策略 + Module 5 对接

总计：约 18-25 天
```

---

## 风险与依赖

| 风险 | 影响 | 缓解 |
|------|------|------|
| webview 标签在新版 Electron 中行为变化 | Batch 1 无法启动 | 启动时先做 webview 可行性验证（POC） |
| mirro-desktop SSE 拦截代码迁移困难 | Batch 3 延期 | 优先迁移 Claude（最简单），ChatGPT/Gemini 逐步跟进 |
| AI 服务 API 格式变化 | Batch 3 拦截失败 | 三套策略互相独立，单个服务失败不影响其他 |
| Module 5 设计未最终确定 | Batch 5 范围不确定 | Batch 5 只做 WebView 侧接口，Module 5 侧由 Agent 模块自行实现 |
| NoteView / EBookView 未就绪 | Batch 4 跨 View 通信无法测试 | 用 mock View 先行开发，后续联调 |
