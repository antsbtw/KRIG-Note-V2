# 阶段 A 调研报告：note 格式 × X Article 格式 对齐矩阵

> 任务：[2026-06-12-x-articles-prompt.md](./2026-06-12-x-articles-prompt.md) 阶段 A（纯调研，不写实现）
> 日期：2026-06-12 ｜ 分支 `docs/x-integration-design`
> 数据来源：`src/drivers/text-editing-driver/blocks/*/spec.ts` + `marks/*.ts`（**逐文件查代码核实，未靠记忆**）；X 侧据 2026-06-09 截图（设计文档 §5）+ 推测
> 交付物定位：**停下来交总指挥逐格拍板**。报告末尾列「阶段 B 待拍板开工」。

---

## A-1｜note 侧格式全集（查代码核实）

### 实测结果 vs 设计文档「32 node + 9 mark」口径

- **Mark：9 个**（与口径一致）。`marks/index.ts` 注册顺序：`bold, italic, underline, strike, code, textStyle, highlight, link, thought`。
- **Node：实测顶层 block spec 目录 27 个**，但其中 `table` / `column-list` / `task-list` / `bullet-list` / `ordered-list` 这些容器各自内部还有子节点（tableRow/tableCell/tableHeader、column、taskItem、listItem），把子节点算进去节点总数 ≈ 32+，与设计文档「32 node」口径吻合。本矩阵**按用户可感知的「格式」粒度逐行列**，容器与其子项合并成一行说明。

### Block 全集（27 个 spec.ts，按内容形态分组）

#### 纯文本块（inline* 内容，承载 mark）
| node id | content | 关键 attrs | note 里长什么样 / 用途 |
|---|---|---|---|
| `paragraph` | `inline*` | `isTitle`(默认 false)、`align`、`textIndent`、`bookAnchor` | 普通段落；**`isTitle=true` 是文档标题**（不是 heading，是「加大字号的段落」，doc 首块，title-guard 维护，不允许换行） |
| `heading` | `inline*` | `level`(默认 1，范围 **1–6** CommonMark，UI 可能只样式化 1–3)、`align`、`textIndent` | 章节标题，6 级 |

#### 列表家族（容器 + 子项）
| node id | content | 关键 attrs | 说明 |
|---|---|---|---|
| `bulletList` | `listItem+` | — | 无序列表 `<ul>` |
| `orderedList` | `listItem+` | `start`(默认 1) | 有序列表 `<ol>`，支持自定义起始编号 |
| `listItem` | `block+` | `indent`(默认 0，**范围 0–8**，Tab 缩进整项，渲染 `margin-left: indent×24px`) | 列表项；**注意：嵌套靠 `indent` attr（视觉缩进）实现，不是真正的 DOM 嵌套 `<ul><ul>`**（见项目记忆「列表/块缩进走 indent attr」）；listItem content=`block+` 可装任意块 |
| `taskList` | `taskItem+` | — | 任务列表容器 `<ul data-type="task-list">` |
| `taskItem` | `block+` | `checked`(默认 false)、`createdAt`/`completedAt`/`deadline`(ISO 或 null)、`indent`(0–8) | 复选框任务项；含截止/完成时间元数据；overdue 高亮 |

#### 容器/结构块
| node id | content | 关键 attrs | 说明 |
|---|---|---|---|
| `blockquote` | `block+` | — | 引用块 `<blockquote>`，**可装任意块 → 可多层嵌套**（blockquote 里再放 blockquote） |
| `callout` | `block+` | `emoji`(默认 💡)、`iconName`(Lucide)、`imageSrc`(media://，三者优先级 imageSrc>iconName>emoji) | 高亮提示框，带装饰图标；可装任意块 |
| `toggleList` | `block+` | `open`(默认 true) | 可折叠容器，首行=折叠标题；可装任意块 |
| `columnList` | `column{2,3}` | — | 多列布局（Notion 风），**强制 2 或 3 列** |
| `column` | `block+` | `verticalAlign`、`width`(null=等宽 flex) | 单列容器 |

#### 代码/公式/图表（「视觉即内容」候选）
| node id | content | 关键 attrs | atom/leaf | 说明 |
|---|---|---|---|---|
| `codeBlock` | `text*` | `language`(默认 '')、`color`/`bgColor` | leaf(`code:true`) | 代码块 `<pre><code>`；**`language: 'mermaid'` 走 NodeView 渲图表** |
| `mathBlock` | `text*` | `color`、`bgColor` | leaf(`code:true`) | LaTeX 块公式，KaTeX displayMode 渲染 |
| `mathInline` | — | `latex`(默认 '') | **inline atom** | 行内公式，光标不进，copy 还原 `$latex$` |
| `mathVisual` | `block`(caption) | `functions`/`domain`/`range`/`thumbnail`(SVG 缩略图)/… | **atom** | 交互函数图像（Canvas 画板 + caption） |

#### 媒体/嵌入块
| node id | content | 关键 attrs | atom/leaf | 说明 |
|---|---|---|---|---|
| `image` | `block?`(caption) | `src`、`alt`、`title`、`width`/`height`、`alignment`(默认 center) | NodeView | 静态图片，支持 http/data/media://、SVG inline；可带 caption |
| `audioBlock` | `block`(caption) | `src`、`title`(默认 'Audio')、`mimeType`、`duration` | NodeView | HTML5 音频播放器 |
| `videoBlock` | `block`(caption) | `src`、`embedType`(youtube/direct/vimeo/generic)、`transcriptText`/`translationTexts`、`title` | NodeView | 多平台视频嵌入（YouTube iframe / `<video>`）+ 字幕/记忆播放 |
| `htmlBlock` | `block`(caption) | `src`(media://)、`title`、`height` | NodeView | HTML 预览块（iframe），caption 在下 |
| `tweetBlock` | `block`(caption) | `tweetUrl`/`tweetId`、`authorName`/`text`/`metrics`/… | NodeView | X 推文嵌入（iframe + 离线结构化卡片） |

#### 引用/链接/文件块
| node id | content | 关键 attrs | atom/leaf | 说明 |
|---|---|---|---|---|
| `fileBlock` | — | `src`(media://)、`filename`、`mimeType`、`size` | **atom** | 附件卡片（块级），字节存 mediaStore |
| `fileLink` | — | `src`、`filename` | **inline atom** | 行内文件引用 chip（📎filename），copy 还原 `📎filename` |
| `noteLink` | — | `noteId`、`label` | **inline atom** | 行内跨 note 引用（📄label），copy 还原 `[[label]]`，`[[` 触发 |
| `externalRef` | — | `kind`(file/url)、`href`、`title`、`mimeType`/`size` | **atom** | 外部引用卡片（URL 或 file://），只存链接不拷字节 |

#### 分隔/换行/兜底
| node id | content | 关键 attrs | atom/leaf | 说明 |
|---|---|---|---|---|
| `horizontalRule` | — | — | **atom** | 水平分割线 `<hr>` |
| `hardBreak` | — | — | inline leaf | 软换行（Shift-Enter）`<br>` |
| `unknown` | — | `originalType`、`missing`、`raw`、`error` | **atom** | schema 缺失占位卡（外部输入含不支持块时不丢内容） |

### Mark 全集（9 个）
| mark | attrs | 渲染 | 备注 |
|---|---|---|---|
| `bold` | — | `<strong>` | |
| `italic` | — | `<em>` | |
| `underline` | — | `<u>` | |
| `strike` | — | `<s>` | |
| `code` | — | `<code>` | **`excludes: '_'`**（行内 code 与所有其他 mark 互斥） |
| `textStyle` | `color`(默认 null) | `<span style="color:…">` | 字色；可与其他 mark 组合 |
| `highlight` | `color`(默认 yellow) | `<mark style="background:…; color:#000">` | 高亮，文字色硬编码 #000 |
| `link` | `href`(必填)、`title` | `<a>` | **`inclusive: false`**；支持 krig://note、krig://block、https/http/file/media 6 协议 |
| `thought` | `thoughtId`(必填)、`thoughtType`(9 类) | `<span class="krig-thought-mark…">` | KRIG 思维标注，下划线；`excludes:''` 可与任意 mark 叠加 |

---

## A-2｜X Article 侧支持情况（截图确认 / 推测-待实机核对）

### 已截图确认（2026-06-09，设计文档 §5）
X Article 编辑器 `x.com/compose/articles/edit/<id>` 工具栏可见控件 = X Article **全部**富文本能力：

| 能力 | 状态 | 截图证据 |
|---|---|---|
| 加粗 B / 斜体 I / 删除线 S | ✅ 已截图确认 | 工具栏 B/I/S 三按钮 |
| 段落样式下拉 `Body ▾`（含标题层级） | ✅ 已截图确认（**层级数待核**） | 工具栏 Body▾ |
| 引用块 `❝` | ✅ 已截图确认 | 工具栏 ❝ |
| 有序 / 无序列表 | ✅ 已截图确认 | 工具栏两个列表按钮 |
| 链接 `🔗` | ✅ 已截图确认 | 工具栏 🔗 |
| emoji 😊 | ✅ 已截图确认 | 工具栏 😊 |
| Insert ▾ 插媒体（图片等） | ✅ 已截图确认（**视频/类型待核**） | 工具栏 Insert▾ |
| cover image（5:2 封面） | ✅ 已截图确认 | 右侧编辑区顶部 |
| 独立标题字段（"Add a title"） | ✅ 已截图确认 | cover 下方 |
| 字数统计（"0 words"） | ✅ 已截图确认 | 工具栏右侧 |

### 推测「不支持」（截图工具栏无对应控件，**待实机核对**）
表格、代码块/语法高亮、数学公式、Mermaid、callout、toggle、下划线、高亮、字色、多列。
→ 状态：**推测-待实机核对**（依据是工具栏没有对应按钮；但富文本编辑器有时支持「粘贴富文本时保留部分格式」，需实机粘一段带下划线/字色的文本看是否被吞）。

### ⚠️ 待总指挥实机核对项清单（对着真实 X Article 编辑器逐项确认）

> X 改版频繁，以下推测有时效性。请用户在真实 `x.com/compose/articles/edit/<id>` 里逐项验证。

1. **标题层级数**：`Body ▾` 下拉到底有几级？（H1/H2/H3？还是 H1/H2？还是只有一个 "Heading"？）→ 决定 note heading 6 级怎么降。
2. **列表是否支持嵌套**：在 X Article 列表里按 Tab，能否产生缩进子列表？支持几层？→ 决定 note listItem `indent` 0–8 怎么映射。
3. **引用是否支持多层嵌套**：能否引用块里再套引用？→ 决定 note 多层 blockquote 怎么处理。
4. **链接插入交互**：选中文字点 🔗 弹输入框？还是粘 markdown `[text](url)` 自动识别？还是粘纯 URL 自动成链？→ 决定注入器怎么写链接。
5. **行内 mark 组合**：选一段同时点 B+I，再选中加 🔗，三者能否叠加（粗+斜+链接）？有无互斥？→ 验证 note mark 组合能否原样注入。
6. **Insert 能插什么**：只图片？还是图片+视频+GIF+embed？fileInput 的 accept 是什么？→ 决定内嵌图/视频策略，也复用发推 fileInput 还是另有控件。
7. **粘贴富文本是否保留格式**：从外部粘一段带 `<u>`/`<mark>`/字色/`<code>`/表格 的 HTML，X 保留还是吞？→ 若部分保留，可省去手动逐块操作。
8. **粘贴 markdown 是否自动解析**：粘 `# 标题`、`- 列表`、`**粗**`、`> 引用` 是否被识别成对应格式？→ 若是，注入可极大简化（粘 markdown 字符串而非逐块点按钮）。
9. **cover image 与正文图区别**：cover 是否独立上传控件？正文 Insert 图与 cover 是否同一 fileInput？
10. **空 Article 如何创建/导航**：从哪进 `compose/articles/edit`？是否需要先点某入口 new 一篇？（影响 spike 入口）。
11. **是否支持视频/嵌入**：videoBlock 能否走 Insert 嵌进 Article 正文？还是只图片？

---

## A-3｜对齐矩阵 + 每格处理建议

> 处理三分类（沿用设计文档 §3）：**① 原生映射** / **② 文本降级** / **③ 内嵌图**（复用 `render-blocks-to-media`）。
> 「建议」列是调研推荐；**标 ⚠️ 的格子拿不准，请总指挥拍板**。

### 表 1：纯文本块 + 列表

| note 格式 | X 是否支持（A-2 状态） | 建议处理 | 理由 / 风险 / 待定 |
|---|---|---|---|
| `paragraph`（普通） | ✅ 支持 | ① 原生映射 | 直接注入正文 |
| `paragraph isTitle=true`（文档标题） | ✅ 有独立标题字段 | ① 映射到 **Article 标题字段**（非正文） | 对齐 §6 决策 3「自动填 note 标题」。⚠️ note 只有 1 个 isTitle 首块（项目不变量），天然对应 1 个标题字段 |
| `heading` level 1–6 | ✅ Body▾ 支持（**几级待核 #1**） | ① 原生映射，**超出 X 层级的降到最低级**（如 X 只到 H3，则 note H4–H6 → H3 或加粗段落） | ⚠️ **待核 #1**：X 到底几级。降级规则请总指挥定：H4–H6 是降到 H3、还是降成「加粗段落」？ |
| `bulletList` / `orderedList`（单层） | ✅ 支持 | ① 原生映射 | orderedList `start≠1` 时 X 能否自定义起始编号？⚠️ 次要，建议先不管 start |
| **多层嵌套列表**（listItem `indent` 0–8） | ⚠️ 待核 #2 | ⚠️ **待总指挥定** | 若 X 支持 Tab 嵌套 → 注入时按 indent 补 Tab；若不支持 → 拍平为单层 + 用缩进空格/破折号模拟。**注意 note 嵌套是 `indent` attr 不是 DOM 嵌套**，注入器要读 attr 而非找 `<ul><ul>` |
| `taskList` / `taskItem`（checked） | ❌ 推测不支持（无控件） | ② 文本降级 → `☐/☑ 文字` 用无序列表承载 | checked→☑、未勾→☐ 前缀。元数据（deadline 等）丢弃或括号附文字？⚠️ 建议先只保 ☐/☑+文字 |

### 表 2：容器/结构块

| note 格式 | X 是否支持 | 建议处理 | 理由 / 风险 / 待定 |
|---|---|---|---|
| `blockquote`（单层） | ✅ ❝ 支持 | ① 原生映射 | |
| `blockquote`（多层嵌套） | ⚠️ 待核 #3 | ⚠️ **待总指挥定** | 若 X 不支持多层 → 拍平为单层引用，或内层降级为普通段落 |
| `callout` | ❌ 推测不支持 | ② 文本降级 → **引用块 + emoji 前缀** | callout 自带 `emoji` 字段（默认 💡），降级为 `❝ 💡 正文`。⚠️ `imageSrc`/`iconName`（非 emoji 图标）怎么办？建议忽略图标只留正文，或图标 emoji 缺失时省略 |
| `toggleList` | ❌ 推测不支持 | ② 文本降级 → **展开**：首行作小标题/加粗段，其余正文顺序铺开 | 折叠语义在静态 Article 无意义，展开最自然 |
| `columnList` / `column` | ❌ 推测不支持（无多列） | ② 文本降级 → **拍平**为顺序段落（列 1 全部 → 列 2 全部） | 多列在单流 Article 无对应 |

### 表 3：代码 / 公式 / 图表 — 「视觉即内容」

| note 格式 | X 是否支持 | 建议处理 | 理由 / 风险 / 待定 |
|---|---|---|---|
| `codeBlock`（普通语言） | ❌ 不支持代码块 | ③ **内嵌图**（`render-blocks-to-media` kind=code/else） | 已有零件 `renderCodeToSvg`。⚠️ 备选：纯文本降级（保可搜索可复制但丢高亮/等宽）。**请总指挥定：代码块是内嵌图（好看不可复制）还是纯文本（可复制不好看）？** |
| `codeBlock language=mermaid` | ❌ | ③ **内嵌图**（kind=mermaid，已有 `renderMermaidToSvgString`） | 图表必须成图 |
| `mathBlock`（块公式） | ❌ | ③ **内嵌图**（kind=math，已有 `renderMathToSvg`，MathJax 紧贴 SVG） | 公式必须成图 |
| `mathInline`（行内公式） | ❌ | ⚠️ **待总指挥定** | 行内成图会打断文字流（图片在富文本里多是块级）。设计文档 §「X 不支持格式转图」记忆里**行内公式降级文本留了 TODO**。建议：降级为 `$latex$` 纯文本，或单独成行内嵌小图。**`render-blocks-to-media` 当前不收 mathInline，stage B 需扩展或走文本降级** |
| `mathVisual`（函数图像） | ❌ | ③ **内嵌图** | 有 `thumbnail`(SVG) attr 可直接用，无需重渲。⚠️ `render-blocks-to-media` 当前**不收 mathVisual**，stage B 需新增 kind 或直接拿 thumbnail 走 svgToPng |

### 表 4：媒体 / 嵌入块

| note 格式 | X 是否支持 | 建议处理 | 理由 / 风险 / 待定 |
|---|---|---|---|
| `image` | ✅ Insert 支持图片 | ① 原生映射 → **走 Insert 插图管线**（media:// 喂 fileInput） | caption 怎么办？X 图片是否有 caption 字段？⚠️ 待核 #6/#9。建议 caption 降级为图下一段文字 |
| `videoBlock` | ⚠️ 待核 #11 | ⚠️ **待总指挥定** | X Article 是否支持正文嵌视频未知。备选：① Insert 视频（若支持）/ ② 降级为「标题 + 链接」文字 / ③ 截封面图。设计文档原也留「videoBlock 待 spike」 |
| `audioBlock` | ❌ 推测不支持 | ② 文本降级 → 「🔊 标题 + 链接」文字 | 音频无对应，保链接 |
| `htmlBlock` | ❌ | ③ 内嵌图 或 ② 链接降级 | ⚠️ HTML 块视觉即内容 → 截图最忠实；但 `render-blocks-to-media` 当前**不收 htmlBlock**。建议本期降级为标题+提示文字，截图留 TODO |
| `tweetBlock` | ⚠️ 待核（X 自家可能支持嵌推） | ⚠️ **待总指挥定** | X Article 大概率能嵌自家推文（粘 X URL）。建议：注入 `tweetUrl` 让 X 自动嵌；不行则降级为「作者 + text + 链接」文字 |

### 表 5：引用 / 链接 / 文件 / 分隔

| note 格式 | X 是否支持 | 建议处理 | 理由 / 风险 / 待定 |
|---|---|---|---|
| `fileBlock`（附件卡） | ❌ | ② 文本降级 → 「📎 filename」文字（无公开 URL 则只留文件名） | media:// 字节无法变成 X 可访问链接 |
| `fileLink`（行内文件） | ❌ | ② 文本降级 → 行内 `📎filename` 纯文本 | 同上 |
| `noteLink`（行内跨 note） | ❌ | ② 文本降级 → 纯文本 label | 内部链接外部无意义，只留 label 文字 |
| `externalRef`（外部引用卡） | ✅（href 可成链接） | ① 映射 → `title` 文字 + `href` 链接（kind=url 时）；kind=file 时降级纯文本 | URL 类天然能做成 link mark |
| `horizontalRule` | ⚠️ 待核 | ② 降级 → 空行 或一行 `———` 文字 | X Article 多半无 `<hr>` 控件；建议降级，影响小 |
| `hardBreak`（软换行） | ✅ 应支持 Shift-Enter | ① 原生映射 → 软换行 | 注入时在该位置发 Shift-Enter |
| `unknown`（兜底占位） | — | ② 文本降级 → `raw` 文字 + 「暂不支持: originalType」提示 | 本就是兜底，注入器遇到 fail loud 提示 |

### 表 6：行内 Mark（9 个）

| note mark | X 是否支持 | 建议处理 | 理由 / 风险 / 待定 |
|---|---|---|---|
| `bold` | ✅ B | ① 原生映射 | 选中范围点 B（或快捷键） |
| `italic` | ✅ I | ① 原生映射 | |
| `strike` | ✅ S | ① 原生映射 | |
| `link` | ✅ 🔗 | ① 原生映射 | ⚠️ 待核 #4 插入交互。注意 `inclusive:false` 边界 |
| `underline` | ❌ 推测不支持 | ② 文本降级 → 丢格式留字 | 设计文档已定 |
| `highlight` | ❌ | ② 文本降级 → 丢格式留字（或降为粗体/emoji 标记？） | ⚠️ 请总指挥定降级风格：纯丢 / 降粗体 / 加 emoji |
| `textStyle`（字色） | ❌ | ② 文本降级 → 丢色留字 | |
| `code`（行内） | ❌ | ② 文本降级 → 反引号包裹 `` `code` `` 或纯文本 | ⚠️ 反引号 vs 纯文本，请总指挥定。注意 code `excludes:'_'` 互斥其他 mark，降级时它本就不会叠加 |
| `thought`（思维标注） | ❌ | ② 文本降级 → 丢格式留字 | KRIG 内部标注，外部无意义 |

### ⚠️ 行内 mark 组合（待核 #5）
- note 支持 **粗+斜+链接** 等叠加（除 `code` `excludes:'_'` 互斥外，多数 mark 可共存；`thought` `excludes:''` 明确可叠加任意）。
- X Article 能否同一段文字叠多个样式（粗+斜+链接）→ **待实机核对 #5**。
- 注入器策略：逐字符 run 切分（同一组 mark 的连续文字为一个 run），先粘文字，再对该 run 选区逐个点样式。**这是块序列注入器最易出 bug 处**（光标/选区错位），spike 重点验。

---

## A-4｜阶段 B 待总指挥拍板后开工

**本报告只读代码 + 推测，未改任何源码、未写注入器。** 以下是阶段 B 开工前需总指挥拍板的事项汇总：

### 一、逐格拍板（A-3 里标 ⚠️ 的）
1. **heading 降级规则**：X 只到 H3（待核）时，note H4–H6 降到 H3 还是降成加粗段落？
2. **多层列表**（待核 X 是否支持嵌套后定）：嵌套注入 vs 拍平。
3. **多层引用**（同上）。
4. **codeBlock**：内嵌图（好看不可复制）vs 纯文本（可复制不好看）？
5. **mathInline**：降级 `$latex$` 文本 vs 行内小图？
6. **highlight 降级**：纯丢 / 降粗体 / 加 emoji？
7. **行内 code 降级**：反引号 vs 纯文本？
8. **videoBlock / tweetBlock / htmlBlock**：嵌入 vs 文本降级 vs 截图（逐个定）。
9. **callout 非 emoji 图标**（iconName/imageSrc）降级时如何处理（建议忽略只留正文）。

### 二、§6 入口/来源类决策（设计文档已列，请确认）
- 入口：建议加 note 级命令「发布为 X 文章」（右键 or 工具栏）。
- 内容来源：建议整篇 note → 一篇 Article（选区暂不做）。
- 标题来源：建议 note isTitle 首块 → Article 标题字段（自动填）。
- 封面图：建议本期**不**自动设封面，留 TODO。

### 三、实机核对清单（A-2 的 11 项 ⚠️，spike 阶段对真实编辑器逐项验）
尤其 #1 标题层级数、#2 列表嵌套、#4 链接交互、#7 粘贴富文本是否保留格式、#8 粘 markdown 是否自动解析 —— **#7/#8 若为真，注入器可极大简化**（粘 markdown 字符串 > 逐块点按钮），值得 spike 优先验。

### 四、阶段 B 需注意的代码现状（调研中发现，供实施参考）
- **`render-blocks-to-media`（`src/capabilities/x-extraction/render-blocks-to-media.ts`）当前只收 3 类 kind：`mermaid` / `math`（块公式）/ else=code**。要把 `mathInline` / `mathVisual` / `table` / `htmlBlock` 也走内嵌图，**stage B 需扩展该文件的 kind 分支**（mathVisual 可直接拿 `thumbnail` SVG attr，省一次重渲）。设计文档 §3③ 把 table 列进「内嵌图」但代码尚未支持 table 渲图 —— **table → 图这条路 stage B 要新增**，请总指挥知悉（table 可能是最大新工作量）。
- 列表嵌套读 `listItem.attrs.indent`（0–8），**不是** DOM `<ul><ul>`（项目记忆「列表/块缩进走 indent attr」）。
- 文档标题是 `paragraph isTitle=true`，**不是** heading（项目记忆「note 单标题不变量」），映射标题字段时认准这个。

---

> **阶段 A 完毕，停。等总指挥逐格拍板后另起阶段 B 实现块序列注入器。**
