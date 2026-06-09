# X（推特）双向集成设计 — note ⇆ X

> 日期：2026-06-09
> 状态：设计 / 待立项实施
> 模式：复用 AI view（X 当作一个"服务"），左 note / 右 slot

## 0. 目标（用户原话）

把 note 的内容和推特协作互动起来。两件事：

1. **读方向**：把自己喜欢的推特一键提取到 note（已有 tweet block）。
2. **写方向**：在 note 中组织自己的推文，一键发布或回复；尤其 **Articles 长文**（用户在 web 上很不好编辑），构建类似"问 AI"一样的功能。

## 1. 核心洞察：X view = 第二个 AI view

用户拍板的方案：**把 X 当成 AI view 里的又一个"服务"**，复用左 note / 右 slot 的整套机制。

- 发推 = 现有 AI view 的 `pasteAndSend`（把 note 内容注入右边 webview 的输入框，用户点发布）的镜像。
- 提取推文 = 现有 AI view 的"提取此对话到笔记"（右键 → `elementFromPoint` 定位 → 抓 → `append-pm-nodes` 写回左 note）的镜像。

读/写两个方向，和 AI view 的"提取/问"完全对称。**任务1 和任务2 不是一易一难两件事，而是同一套 X 能力的读/写两面。**

## 2. ⚠️ 头号架构注意事项：X 与 AI 服务的语义不对称

复用 AI view 改动最小，但 **X 和 AI 服务有语义差异，必须分层处理，否则 extract/paste 逻辑会越分叉越乱**：

| 层面 | AI 服务模型 | X 模型 | 复用策略 |
|---|---|---|---|
| webview 加载/URL 识别/partition/代理 | 通用 | 通用 | **完全复用** |
| `pasteAndSend`（focus 输入框→OS 级 Cmd+V→点发送） | 注入提问 | 注入推文/Article | **复用底座**，selector 走 X 自己的 |
| extract 产物 | 包成 toggleList（"问—答"） | 构造 **tweet block**（"读—写"） | **X 走专属代码路径** |
| toolbar / 右键菜单文案 | "提取对话"/"问 AI" | "提取推文"/"发到 X"/"回复" | **X 走专属分支** |

**落地原则**：`AI_SERVICE_PROFILES` 加 X 条目，复用 webview 生命周期、注册、`pasteAndSend`、selector 配置机制；但 **extract 产物构造和发布逻辑按 `serviceId === 'x'` 分派到 X 专属代码路径**——正如现有 Claude/ChatGPT/Gemini 各有自己的 extractor 文件（`src/platform/main/ai/extractors/*`）。这样既满足"复用一套 view"，又不让 tweet 读写逻辑污染 AI 问答逻辑。

> 关联记忆：[[feedback-fail-loud-no-fallback]] —— 注入失败要明确 toast 告知降级，不静默假装成功。

## 3. 现状盘点（已有的牌，全部可复用）

### 3.1 tweet block（读方向地基，八成现成）
- schema 完整：不只 URL，还存 `authorName/authorHandle/authorAvatar/text/createdAt/lang/media/metrics/quotedTweet/inReplyTo`，双 Tab（Browse iframe + Data 离线卡片）。
  - `src/drivers/text-editing-driver/blocks/tweet-block/spec.ts:25-55`（schema）
  - `src/drivers/text-editing-driver/blocks/tweet-block/node-view.ts`（渲染）
- 已有 DOM scraping 抓取：`fetchTweetData` + `EXTRACT_TWEET_JS` 选择器（作者/正文/媒体/metrics/引用/回复全覆盖）。
  - `src/platform/main/tweet-fetcher/fetcher.ts:57-99`
  - `src/platform/main/tweet-fetcher/extract-script.ts:16-137` ← **提取选择器可直接复用**
- 插入方式：slash `/X Post`、placeholder 输入 URL。**缺**：粘贴 X URL 自动转 block 的 paste handler。
- 注：tweet-fetcher 现标记"⚠️ 临时能力"，本次正好把它收编进 X view 的 extract 路径。

### 3.2 AI view（X view 的脚手架，1:1 平移）
- 主组件：`src/views/ai/AIView.tsx:35-187`；webview 容器：`src/capabilities/ai-extraction/Host.tsx:36-198`
- URL 自动识别注册：`src/platform/main/ai/webview-registry.ts:87-100`（`did-attach-webview` → `did-navigate` → `detectAIServiceByUrl`）
- **发布核心** `pasteAndSend`：`src/platform/main/ai/writer.ts:84-205`
  - focusInput（querySelector + focus + 光标移末尾）
  - pasteTextToAI（clipboard 备份 → writeText → `sendInputEvent` **OS 级 Cmd+V** → 验证落地 → clipboard 还原）
  - clickSendButton（Return / querySelector click / dispatch Enter 三重 fallback）
  - **关键**：这是 OS 级真实粘贴 + 真实点击，从浏览器视角与人手动操作无异，是绕过反自动化最稳的方式。
- **提取核心** 右键"提取此对话"：`elementFromPoint(x,y)` 定位 → 抓 markdown → `note-view.append-pm-nodes`。
  - 命令：`src/views/ai/ai-commands.ts:70-181`
  - 右键菜单 hook：`src/platform/main/ai/webview-hook.ts`
- selector 配置：`AI_SERVICE_PROFILES`（`src/shared/types/ai-service-types.ts`），每服务 `{inputBox, sendButton}`。
- 脚本注入：`dom-ready` + `did-navigate-in-page` 重注，idempotent guard（`src/platform/main/ai/interceptor.ts:47-62`）。
- pending 缓存模式：`set/consume/peek/clearPendingAIThought`，发后等用户操作。

### 3.3 slot 布局（完全通用）
- `src/slot/workspace-bus/slot-control.ts:26-94`：`openRight(viewId, payload)` / `closeRight` / `closeLeft`（右→左升级，最后一个 view 不可关）。
- `note-view.set-active-in-right`：`src/views/note/note-commands.ts:149-161`（只改右槽）。
- `note-view.append-pm-nodes`（mode: 'cursor-or-end'）：写回左 note。

### 3.4 webview 底座
- Electron `<webview>` tag（`webviewTag: true`，`src/platform/main/window/main-window.ts:39`）。
- per-ws 代理：`session.fromPartition('persist:webview-${wsId}').setProxy(...)`（`src/platform/main/web-proxy/handler.ts:32-34`）。关联 [[per-ws-proxy]]、[[代理节点加了≠选了]]。
- 技术栈：React 19 + ProseMirror + SurrealDB + Electron Forge/Vite。
- 多 ws 广播守卫教训见 [[宿主广播×多ws扇出]]，X webview 注册/监听同样要加 getActiveId 守卫。

## 4. 已定决策

| 决策点 | 用户选择 |
|---|---|
| 发推技术路线 | **webview 注入为主**（复用 pasteAndSend），半自动复制作 fallback |
| 实施顺序 | 先任务1（读）再任务2（写），风险递增 |
| 发推范围 | **全都要**（普通推文 + 回复 + Article），Article 单独 spike |
| 代码组织 | **复用 AI view，X 当一个服务**（见 §2 分层原则） |
| 提取抓取源 | **直接抓右边 webview**（elementFromPoint，所见即所得 + 带登录态），废弃隐藏窗口 fetch 作主路径 |
| 命名 | **先不改名，维持 "AI view"**，X 当一个服务塞进去（"借 AI 的东风"） |

#### 命名决策说明（勿当设计失误重构）
曾考虑把容器改名为"协作 / Cooperation"以容纳 AI + X 多服务。**用户拍板：先不改名，维持 AI view。** 理由：改名是纯成本零功能收益的过早优化；且**语义混淆不影响正确性**——§2 分层原则保证 X 走 `serviceId === 'x'` 专属路径产 tweet block，与顶层叫什么名字完全正交。后续若 X 等非 AI 服务变多、"AI view" 名实不符明显，再统一 rename（注意 command id / slot viewId / partition 有持久化语义，需迁移处理）。**看到"AI view 里有 X"是有意为之，不是设计失误。**

### webview 注入 vs 半自动复制 — 结论依据
- **Article 痛点**：复制纯文本进 X Article 编辑器格式全丢，等于没解决；注入可逐块保留结构，是唯一真正解决"web 上难编辑 Article"的路径。
- **风险**：两者接近，因为都"用户在场、用户点发布"，不碰后台批量自动发推。
- **维护成本**：注入依赖 X selector，X 改版要跟修——但这与 AI view 维护 Claude/ChatGPT/Gemini selector 是同类工作，非新增架构负担。
- **fallback**：selector 失效或注入不可靠时，降级"已复制到剪贴板，请手动粘贴" + toast 明示降级（fail loud）。

## 5. 分阶段实施

### 阶段 0：X 服务接入骨架
- `AI_SERVICE_PROFILES` 加 X 条目（id: 'x'，newChat/compose URL，inputBox/sendButton selector 占位）。
- x.com / twitter.com URL 识别注册（仿 webview-registry）。
- 独立 partition（带 per-ws 代理），登录态持久化。
- right slot 能开出 X webview。
- **验证**：右边能刷推、保持登录、走对代理出口。

### 阶段 1：提取推文 →（任务1，读方向）
- 右键 X webview 某条推 → `elementFromPoint(x,y)` 定位推文元素（仿 ai extract-turn）。
- 复用 `extract-script.ts` 的选择器抓数据（直接抓当前 webview DOM，带登录态、所见即所得）。
- 构造 **tweet block** 的 PmAtomDraft（按 §2，走 `serviceId==='x'` 专属产物路径，**产物是 tweet block 不是 toggle**）。
- `note-view.append-pm-nodes` 写回左 note。
- 可选：补一个 paste handler，note 里直接粘 X URL 自动转 tweet block。
- **验证**：右键任意推文，左 note 出现完整 tweet block。

### 阶段 2：发普通推 / 回复（任务2 第一档，写方向）
- note 选区/整篇 → 转纯文本/分段（注意 X 字数限制、thread 拆分策略）。
- 复用 `pasteAndSend`：focus X compose 框 → 粘贴 → 用户点发布。
- 回复：某条推下右键"在 note 里写回复" → 写完注入到该推的 reply 框（pending 缓存关联推文 id）。
- X selector：compose 框、reply 框、发布按钮（仿 AI_SERVICE_PROFILES）。
- 注入失败 → fallback 复制到剪贴板 + toast（fail loud）。
- **验证**：note 写好 → 一键填进 X 发推/回复框 → 手动发出。

### 阶段 3：Article 长文（任务2 最难档）

#### X Article 编辑器能力边界（2026-06-09 截图实锤，见 §7 截图）
URL 形如 `x.com/compose/articles/edit/<id>`。工具栏可见控件 = X Article **全部**富文本能力：
- **B / I / S**（加粗 / 斜体 / 删除线）
- **Body ▾**（段落样式下拉，含标题层级，可能只到 H1/H2/H3）
- **❝** 引用块
- **有序 / 无序列表**
- **🔗** 链接
- **😊** emoji
- **Insert ▾** 插入媒体（图片/视频等）
- 顶部 **cover image**（5:2 封面）+ 独立 **标题字段**（"Add a title"）

**X Article 没有**：表格、代码块/语法高亮、数学公式、Mermaid、callout、toggle、下划线、高亮、字色、多列。

#### note(32 node + 9 mark) → X Article 映射三分类
**优先级：原生映射 > 文本降级 > 截图兜底**（截图是最后手段——图不可搜索/不可复制/主题可能不匹配）

**① 原生映射**（X 支持，直接注入）：paragraph / heading(>3 级降级) / bold / italic / strike / link / bulletList / orderedList / blockquote / image / hardBreak / horizontalRule

**② 文本降级**（X 无对应但内容是文字，保住可搜索可复制）：
- underline / highlight / textStyle(颜色) → 丢格式留文字（highlight 可降级粗体或 emoji 标记）
- code(行内) → 纯文本或反引号包裹
- callout → blockquote + emoji 前缀（callout 自带 emoji 字段）
- toggleList → 展开为标题+正文
- taskList → `☐/☑ 文字` 列表
- noteLink / fileLink → 纯文本 label 或外部 URL
- columnList → 拍平为顺序段落

**③ 截图兜底**（用户拍板）—— 仅"视觉本身就是内容"的：
- codeBlock（含语法高亮 / Mermaid）、mathBlock / mathInline / mathVisual、**table（X 无表格，重灾区）**、htmlBlock、audioBlock（截封面+附链接）、videoBlock(待 spike X 是否支持视频)
- **截图实现**：截 **note 这边已渲染好的 block DOM**（这些 block 都有 NodeView），用 `webContents.capturePage(rect)` 或 DOM→canvas → 生成图片 → **复用普通 image 的 Insert 上传管线**（不新造轮子）。
- 注意 Retina 清晰度、深/浅主题（截图主题应跟随 X Article 背景，X 是深色）。

#### ⚠️ 阶段 3 真正的工程量：块序列注入器（不能复用 pasteAndSend）
AI 的 `pasteAndSend` 是"一坨文本粘进一个框、点发送"——**单次整块**。X Article 是**逐块构造富文本**：遍历 note block → 每块决策(映射/降级/截图) → 按序操作 X 编辑器(粘文字 → 选样式 → 插列表 → 插图 → 下一块)。这是个**块序列注入器**，是阶段 3 的核心新工程，pasteAndSend 只能复用其"焦点+OS级粘贴"原语。

#### 实施步骤（用户拍板：先 spike）
1. **先 spike 摸清 X Article 编辑器 DOM**（动手写注入前必做）：手动观察编辑器 DOM 结构、每个工具栏按钮的快捷键/selector、标题字段 selector、列表/引用如何触发、Insert 插图的交互与 selector，产出一份 **X Article selector + 交互清单**。spike 结论有时效性（X 改版频繁）。
2. **MVP**：先跑通原生映射（标题/段落/粗斜/列表/引用/链接/图片）的块序列注入，代码块/表格/公式先统一截图兜底。打通"note Article → X Article"主链路。
3. **逐块完善**：再按 ②③ 分类细化降级与截图。
- **风险最高**，建议做完阶段 0-2 拿到手感后单独立项。
- **验证**：note 里编辑好的 Article（含标题/格式/图片/代码截图）→ 块序列注入 X Article 编辑器，结构基本保留。

## 6. 关键风险与注意

1. **§2 语义不对称**：extract 产物必须走 X 专属路径产 tweet block，勿复用 toggle 包装。
2. **X 反自动化**：坚持 OS 级 sendInputEvent + 用户点发布，不做后台批量。selector 失效要 fail loud 降级。
3. **多 ws 扇出**：X webview 注册/监听加 getActiveId 守卫（教训见 [[宿主广播×多ws扇出]]）。
4. **登录态 / partition**：X 与 AI 共用 `persist:webview` 还是独立 partition 需定（建议独立，避免 cookie 污染 + 接入 per-ws 代理）。
5. **Article DOM 易变**：X Article 编辑器改版频繁，spike 结论有时效性，注入策略要容错。
6. **字数 / thread**：普通推 280 字限制、长内容是否自动拆 thread，阶段 2 需定策略。

## 7. 关键文件索引（实施起点）

| 用途 | 文件 |
|---|---|
| tweet block schema/渲染 | `src/drivers/text-editing-driver/blocks/tweet-block/{spec,node-view}.ts` |
| 推文 DOM 抓取选择器（复用） | `src/platform/main/tweet-fetcher/extract-script.ts:16-137` |
| AI view 主组件（平移模板） | `src/views/ai/AIView.tsx` `src/capabilities/ai-extraction/Host.tsx` |
| 发布核心 pasteAndSend（复用） | `src/platform/main/ai/writer.ts:84-205` |
| 提取/命令（平移模板） | `src/views/ai/ai-commands.ts:70-181` |
| webview 注册识别（平移模板） | `src/platform/main/ai/webview-registry.ts` `webview-hook.ts` |
| 脚本注入（平移模板） | `src/platform/main/ai/interceptor.ts:47-62` |
| 服务 profile/selector 配置 | `src/shared/types/ai-service-types.ts`（加 X 条目） |
| slot 布局 | `src/slot/workspace-bus/slot-control.ts` |
| 写回 note | `note-view.append-pm-nodes` `set-active-in-right`（note-commands.ts） |
| per-ws 代理 | `src/platform/main/web-proxy/handler.ts:32-34` |
| 截图兜底（复用 image 上传） | note block NodeView 渲染 + `webContents.capturePage` / image Insert 管线 |
| note block/mark 全集（映射依据） | `src/drivers/text-editing-driver/blocks/*/spec.ts`、`marks/index.ts:21-44` |

### X Article 编辑器观察（2026-06-09 截图）
- URL：`x.com/compose/articles/edit/<id>`
- 工具栏：B / I / S、Body▾(段落样式)、❝引用、有序/无序列表、🔗、😊、Insert▾(媒体)、Preview、Publish
- 布局：左 X 导航 | 中 Drafts/Published 草稿列表 | 右 编辑区(cover image 5:2 + "Add a title" 标题字段 + 作者 + 正文 "Start writing")
- 字数统计在工具栏右侧（"0 words"）→ 可能可用于校验注入完整性
