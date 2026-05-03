# 「保存到 Note」需求文档

> 创建日期：2026-04-15
> 范围：从 Claude 网页一次性把整段对话（含 Artifact 图表）完整保存到 KRIG Note
> 基准 commit：`5ef5a34`（含实时同步 + 右键提取，不含此功能）

---

## 1. 背景

KRIG 的 AI 工作模式里，用户在左侧 AIWebView 和 Claude 对话，右侧 NoteView 编辑笔记。已有两种内容同步机制：

- **实时聊天同步**（自动）：Claude 每完成一轮回复，文字立刻插入到当前 Note。Artifact 图表位置保留占位 callout，提示用户"请手动拷贝"。
- **右键单条提取**（手动）：右键任意 assistant message → "📥 提取到笔记" → 该条文字 + artifact PNG 一起插入。

剩余缺口是**一次性完整保存整段对话**——包括所有 Artifact 的真实图像。本文档描述这个功能的需求。

---

## 2. 用户故事

1. 我和 Claude 聊完一段话题，里面有 N 个互动图表（第一性原理、热传导、流程图等 Artifact）
2. 我点 AI 工具栏上的「📥 保存到 Note」按钮
3. AI 页面进入冻结状态（不能继续聊天、不能被我误操作）
4. 系统串行处理整段对话：文字按顺序进 Note，每个 Artifact 的 PNG 也按顺序落在正确位置
5. 完成后解冻。如果哪张图片抓失败了，按钮变红显示失败，我能点击重试
6. 整个过程我可以随时点"取消"中止

---

## 3. 功能清单

### 3.1 触发与前置条件

- **入口**：AIWebView 工具栏新增按钮 `📥 保存到 Note`
- **前置**：右侧 NoteView 必须打开（通过 `as:note-status` 广播检测）。未打开时按钮灰显，tooltip 提示"请先在右侧打开 Note view"
- **单向性**：保存过程只追加到当前 Note 末尾，不去重、不修改已有内容

### 3.2 冻结 UI

- 保存期间在 AIWebView 上盖一层半透明蒙层（`position: absolute; inset: 0; pointer-events: auto`）
- 蒙层中央显示进度卡片：
  - 标题「保存到 Note」
  - 当前状态文本（如"处理附件 (3/8)..."）
  - 进度条 + `current/total` 数字
  - **取消** 按钮
- 点取消 → 在下个安全点中止，已保存的内容保留在 Note 里，按钮恢复空闲态

### 3.3 保存流程（两阶段设计）

用户需求的核心："**按顺序，从上至下滚动浏览器获取 artifacts，按照位置逐一粘贴**。至少没有这么乱。"

#### Phase 1：全量文字 + 占位符
1. 调 Claude conversation API（`extractClaudeConversation`）一次性拿全部消息
2. 遍历每个 (human, assistant) pair，对 assistant 文字调用 `replaceArtifactPlaceholders`：
   - 原文的 `` ``` This block is not supported... ``` `` 占位被替换为一个带固定标记字符串的 callout
   - 标记文本固定为：`📥 此处 artifact 待下载`
   - **关键：callout 的 markdown 必须让 ResultParser 认得**（`> [!note]` 要独占一行，内容换行起）
3. 每条 turn 通过 `sendToOtherSlot('as:append-turn', ...)` 送到 NoteView
4. NoteView 走现成的 `insertTurnIntoNote`，不需要改

#### Phase 2：滚页面，逐个下载 .html → 按顺序替换为 html-embed block
1. 等 Phase 1 全部 emit 完（至少 800ms）
2. **Sweep 预滚**：一次性从页面顶部滚到底部，多段 dwell ~1.2s/步，让 Claude 的 `IntersectionObserver` 把所有 artifact iframe 都 lazy-mount（src 分配 + 高度撑开）
3. 完成后滚回顶部，读取"去重后的 unique-src iframe 数量"，应等于 Phase 1 的 placeholder 总数
4. 循环 N 次，每次处理第 `ordinal` 个 artifact：
   1. 定位该 iframe（按 unique-src 在 DOM 中的顺序）
   2. `scrollIntoView({ block: 'center' })` 滚到视口中心
   3. 等 iframe 高度稳定（> 100 且连续 400ms 不变）
   4. 调 `extractArtifactSource(webview, view, ordinal)` 走 CDP "..." 菜单 → **Download file** → main 端 `WB_CAPTURE_DOWNLOAD_ONCE` 拦截下载，拿到 `.html` 文本
   5. 把 HTML 文本（可能几十 KB ~ 数 MB）经 `mediaPutBase64` 或新增的 `mediaPutText` 存进 media 表 → 得到 `media://files/{id}`
   6. 发 `sendToOtherSlot('as:replace-nth-placeholder', { ordinal, mediaRef, kind: 'html-embed', filename })`
5. NoteEditor 收到替换消息 → 串行 queue → `replaceNthPlaceholderWithHtmlEmbed(view, payload)`：在 doc 里按文档顺序找到**第 ordinal 个** callout（内容含标记字符串）→ 用 `html-embed` block 替换

### 3.4 顺序保证（核心约束）

- Phase 1 的 callout 顺序 = conv API 消息顺序 = DOM iframe 顺序
- Phase 2 的抓取顺序 = DOM unique-src iframe 顺序
- 两边都是从上至下 → ordinal 简单匹配即可，**不需要**"哪个 iframe 属于哪条 message"的映射

### 3.5 核验与失败处理

- **PLAN**：保存开始时在 console 打印计划：turn 列表 + 每 turn 期望 artifact 数 + 总期望数
- **EXECUTE**：每个 artifact 下载完记 `actualArtifacts` 对比 `expectedArtifacts`
- **VERIFY**：全部完成后打对照表，任一 turn 不达标 → 抛 `SaveVerifyError`
- **失败不能静默降级为 callout**——必须让用户看到红色"保存失败"状态，tooltip 列出哪几个 turn 缺 artifact
- 下载失败的 placeholder **保留原 callout**，用户可手动点右键重新抓该条 turn

---

## 4. 技术约束与已知陷阱

### 4.1 Claude 懒加载（最大技术难点）

**现象**：Claude 用 `IntersectionObserver` 控制 artifact iframe 的 `src` 分配。iframe 不在视口内 → `src` 为空、高度为 0 → 我们的 selector `iframe[src*="claudemcpcontent"]` 查不到。

**尝试过但失败的方案**：
- 一次 `scrollIntoView` → 第二张图还在视口外，没触发
- 多段 sweep 但每段 dwell 太短 → observer 没时间认定"稳定可见"
- 按"该 message 的 N 个 iframe"定位 → Claude 的 message DOM 容器不稳定（`.font-claude-response` 有时只有 1 个、有时有 7 个）
- 按"页面末尾 N 个 iframe"（tail）→ 历史消息 iframe 累积，新 turn 拿到旧 iframe

**经验教训**：
- sweep 每步必须 dwell 至少 1.2s
- sweep 要分多轮直到 unique-src iframe 数稳定
- 不要尝试"turn → iframe"的 DOM 映射，用全局顺序 ordinal

### 4.2 同一 artifact 的多份 iframe

Claude 如果开了"artifact 侧边面板"或"fullscreen 预览"，**同一个 artifact 可能在 DOM 里有 2~3 个 iframe**（内联 + 侧边 + 全屏），它们的 `src` 相同。

→ **按 iframe.src 去重**是必须的

### 4.3 CDP 鼠标 + Menu geometry

Artifact 的 `...` 菜单：
- 菜单由 Claude 自己的 Radix UI 渲染，**不能**用 JS `element.click()` 触发
- 必须用 CDP `Input.dispatchMouseEvent` 合成原生鼠标事件（已封装在 `wbSendMouse`）
- **hover 轨迹要三段**：屏幕外 → iframe 中心 → 右上角触发点。单点移动不行，Radix 不响应
- 菜单弹出后，菜单项位置是相对 iframe 右上角的固定偏移（`MENU_OFFSETS`）
- 整个流程见 `claude-artifact-extractor.ts` 的 `clickArtifactMenuItem` + `scrollAndReadRect`

### 4.4 Media store

Artifact `.html` 文件几十 KB ~ 数 MB（含内联 JS/CSS）。直接塞进 note.doc_content 会让 DB 记录膨胀。

- 用 `viewAPI.mediaPutBase64(dataUrl, mime='text/html', filename)` 写入 media 表（若无 text 直存接口，先按 base64 包装）
- 拿到 `mediaId` 后 `html-embed` block 的 `src` 用 `media://files/{mediaId}`
- KRIG 已有 custom protocol handler 能服务 `media://` 协议
- **CSS 变量 fallback**：Claude 下载的 `.html` 用了 `var(--color-text-primary)` 等主题变量，嵌入到 KRIG 时上游没有这些变量值。需要在 html-embed block 的 iframe 注入 fallback CSS（详见 §4.6）

### 4.5 html-embed block（新增）

新增 leaf block `html-embed`，属性 `{ mediaRef, filename, height? }`：

- **渲染层**：用 `<iframe sandbox="allow-scripts" src="media://files/{id}">` 加载（**不允许** `allow-same-origin` + `allow-scripts` 同时存在，避免任意 HTML 突破沙箱）
- **高度**：初始用保存时记录的 height，或固定默认 480px。提供"展开/收起"按钮
- **编辑态**：block 显示带边框容器 + 文件名 chip + "在新窗口打开" / "查看源码" 操作
- **CSS 变量 fallback**：iframe 加载完成后，向其 contentDocument 注入一段 fallback `:root { --color-text-primary: #1a1a1a; ... }`（白底主题）。或者在 main 端拦截下载时就改写 HTML，注入 fallback。倾向后者，更稳定。
- **安全**：sandbox 必须严格；不允许 `allow-same-origin`、不允许 `allow-top-navigation`；不允许通过 postMessage 与父窗口通信（除非未来明确需要）

### 4.7 Callout 解析

ResultParser 把 `> [!note]` 识别成 callout 的条件：`[!note]` 必须**独占一行**，内容从第二行起。如果写成 `> [!note] inline content` 会被当普通 blockquote，后续 replace 阶段按"callout block 含标记文本"查找就找不到。

---

## 5. 外部依赖与可用 API

项目里已有的可直接复用的能力：

| 能力 | 函数/模块 | 位置 |
|---|---|---|
| 拉 Claude 对话 | `extractClaudeConversation(webview)` | `plugins/web-bridge/capabilities/claude-api-extractor.ts` |
| 判断 Claude 对话页 | `isClaudeConversationPage(url)` | 同上 |
| 数占位符 | `countArtifactPlaceholders(text)` | 同上 |
| 替换占位符为 callout | `replaceArtifactPlaceholders(text, url)` | 同上（文案已按本需求调好）|
| 抓单张 artifact 源码 (.html) | `extractArtifactSource(webview, view, index)` | `plugins/web-bridge/capabilities/claude-artifact-extractor.ts`（代码就绪，renderer 未调）|
| 列全部 artifact | `listArtifacts(webview)` | 同上 |
| 合成鼠标事件 | `viewAPI.wbSendMouse([...])` | preload |
| 一次性捕获下载 | `WB_CAPTURE_DOWNLOAD_ONCE` IPC + main `will-download` hook | main |
| Media 存储 | `viewAPI.mediaPutBase64(dataUrl, mime, filename)` | preload |
| 跨 slot 发消息 | `viewAPI.sendToOtherSlot({ protocol, action, payload })` | preload |
| NoteView open 状态 | `as:note-status` 广播 | `NoteEditor.tsx` 会自动发 |
| 插入 turn | `insertTurnIntoNote(view, payload)` | `plugins/note/ai-workflow/sync-note-receiver.ts`，已支持 `as:append-turn` |

需要**新增**的 NoteView 端协议：
- `as:replace-nth-placeholder` IPC action（payload 含 `kind: 'html-embed'`、`mediaRef`、`filename`）
- `replaceNthPlaceholderWithHtmlEmbed(view, { ordinal, mediaRef, filename })` 函数在 `sync-note-receiver.ts`
- NoteEditor 的 message 路由里加这一条，走串行 queue 防竞态

需要**新增**的 block：
- `html-embed` leaf block（ProseMirror node type + schema + NodeView 渲染）

**copy-as-image 路径保留为 fallback**：`extractArtifactImage` 仍可用于右键单条提取场景、或 download 失败时的退路（但 v1 不做自动 fallback，失败就让 placeholder 留着）。

---

## 6. 交付清单

### 新建文件
- `src/plugins/ai-note-bridge/ui/SaveToNoteButton.tsx` — 按钮组件 + 冻结蒙层 + 进度
- `src/plugins/ai-note-bridge/pipeline/save-pipeline.ts` — PLAN / Phase1 / Phase2 / VERIFY 主流程
- `src/plugins/ai-note-bridge/pipeline/iframe-sweep.ts` — 一次性 sweep 预滚 + unique-src 计数
- `src/plugins/ai-note-bridge/pipeline/iframe-capture.ts` — 单张定位 + 滚 + 等稳定 + CDP 触发下载 + emit replace
- `src/plugins/note/blocks/html-embed/` — 新增 leaf block：schema、NodeView、CSS fallback 注入

### 修改文件
- `src/plugins/web/components/AIWebView.tsx` — 工具栏挂 SaveToNoteButton，加 `webviewHostRef`
- `src/plugins/web-bridge/capabilities/claude-artifact-extractor.ts` — `extractArtifactSource` 接通 renderer 调用路径，确认 `WB_CAPTURE_DOWNLOAD_ONCE` 端到端可用；HTML 内容里注入 CSS 变量 fallback
- `src/plugins/note/ai-workflow/sync-note-receiver.ts` — 新增 `replaceNthPlaceholderWithHtmlEmbed` + 标记常量
- `src/plugins/note/components/NoteEditor.tsx` — message 路由加 `as:replace-nth-placeholder` 分支（kind=html-embed），走现有 queue
- `src/plugins/note/schema.ts`（或对应位置）— 注册 `html-embed` node type
- `src/plugins/ai-note-bridge/index.ts` — 导出新模块
- `src/plugins/ai-note-bridge/README.md` — 补充 save 流程说明

### 不需要改的（确认无副作用）
- `replaceArtifactPlaceholders` 仍按原格式输出 callout（`[!note]` 独占一行），仅替换标记文案
- `clickArtifactMenuItem` + `scrollAndReadRect` + `MENU_OFFSETS` 用原实现（download 项坐标已在文档记录）
- live chat sync（`startSseTrigger`）不受影响
- `extractArtifactImage`（PNG 路径）保留，仅作为右键单条提取的备选

---

## 7. 验收标准

**测试对话**（建议基线）：
- 7 轮 Claude 对话
- 其中 2 轮各带 2 个 artifact，3 轮各带 1 个，2 轮无 artifact
- 共 7 个 artifact

**验收用例**：

1. **全成功**：7 个 artifact 全下载到 → Note 里 7 个 callout 全被 `html-embed` block 替换 → 每个 block 在 NoteView 里能正常渲染（交互保留）→ 按钮显示绿色"完成" → console 打印 `=== RESULT === 7/7 artifacts saved`
2. **部分失败**：模拟某个 artifact 下载超时（will-download 未触发）→ 该 callout 保留 → 按钮变红 → tooltip 显示"保存失败：X 个 artifact 未能下载" → console VERIFY 表里对应 turn 有 ✗
3. **用户取消**：Phase 2 进行到一半点取消 → 蒙层立即消失 → 已成功的 turn 保留在 Note → console 打印 `[AI/Bridge/Save] cancelled`
4. **NoteView 未开**：按钮灰显，tooltip 提示 → 点击无效
5. **保存后继续聊天**：实时同步正常工作，新 turn 继续追加到 Note（验证两个机制不冲突）
6. **html-embed 渲染**：保存后的 artifact block 在 NoteView 里：(a) 文字颜色等用了 fallback CSS，可读；(b) 交互（按钮点击、动画）能用；(c) 不能突破 sandbox 访问父窗口

---

## 8. 超出范围（v1 不做）

- ChatGPT / Gemini 的保存（先做 Claude，架构上留扩展点）
- 已保存内容的去重 / 合并 / 更新（每次保存就是 append；若 Note 已有相同内容，用户自担重复）
- 下载失败自动 fallback 到 copy-as-image（v1 让 placeholder 保留，不做降级）
- Artifact 互动状态保存（下载的是当次渲染的自包含 HTML；重载后是初始态，不保留用户在 Claude 页面上操作过的瞬时状态）
- 跨会话记忆"上次保存到哪里"

---

## 9. 设计笔记（给实施者的建议）

1. **不要再试"每 message 独立 scroll + resolve iframes"的映射思路**——试过 3 轮都失败，Claude DOM 不稳定。坚持"全局 ordinal 对 ordinal"
2. **先让 Phase 1 单独跑通**（不做 Phase 2），确认文字和 callout 都对齐了，再做 Phase 2
3. **Phase 2 先单独跑通 `extractArtifactSource` end-to-end**：在 renderer 调一次、确认 `WB_CAPTURE_DOWNLOAD_ONCE` 能拿到 `.html` 文本、能写进 media——这是新接通的链路，先证明跑得通再接 pipeline
4. **html-embed block 单独建分支开发**：schema、NodeView、sandbox 策略、CSS fallback 都要单独验证；不要和 save pipeline 混在一起
5. **把 PLAN / VERIFY 的 console 输出做详细**——失败时能直接看出是 sweep 数不够、CDP 菜单点击失败、还是 download 超时、还是 NoteView 找不到 placeholder
6. **冻结蒙层不要"可透视交互"**——必须完全拦截鼠标，否则用户手滑在 AI 页面里滚动会破坏 Phase 2 的 iframe 状态
7. **sweep 预滚的 dwell 时间需要调参**（建议 1200ms 起步，观察 log），因为 Claude 懒加载的时机没有固定信号
8. **html-embed 的 src 用 `media://files/{id}`**——不要把几 MB 的 HTML 直接塞 doc_content
9. **下载文件名冲突**：同一 conversation 多个 artifact 的 `.html` 可能同名（Claude 默认按 artifact title 命名）。`WB_CAPTURE_DOWNLOAD_ONCE` 不要落到磁盘文件系统，直接拿 buffer 走 media store
10. **CSS 变量 fallback 在 main 端注入更稳**：拦下 download buffer 后用字符串替换在 `<head>` 末尾插一段 fallback `:root {...}`，比 NodeView 加载完再注入避免闪烁
