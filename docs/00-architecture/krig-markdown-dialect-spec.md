# KRIG Markdown 方言规范 v0.1（草案）

> **状态**：设计草案，待总指挥审阅拍板，未实现。
> **定位**：KRIG Markdown 是 CommonMark + GFM 的**超集**，扩展以承载 note 全部 block 类型。作为「所有来源 → note」的**统一中间语言**（见 [[import-to-note-convergence]]），并作为对接外部系统（PDF OCR 引擎、AI、其它 markdown 工具）的**通用交换格式**。
> **生态对齐**：**block 语义/命名向 Notion API 看齐**（最大结构化文档生态，未来 KRIG↔Notion 互转是字段直译），**语法保持 KRIG 自己的**（可降级、更强，不受 Notion 有损导出拖累）。详见第二·补节。
> **立项动机**：调研证实 PDF OCR 引擎原生就出 markdown、AI 出 markdown、文件本就是 markdown —— 唯一缺的是「非标准 block 怎么用 markdown 表达」。定一份带兼容性的方言，即可让所有入口只负责「产出标准 markdown」，下游统一 `markdown → PM`。
>
> **第一铁律 · 优雅降级**：任何 KRIG 扩展语法，在**不认识它的 markdown 系统**里，都必须降级为「**可见的纯文本 / 失效但可读的链接**」，**绝不吞内容**。这是「与传统 markdown 兼容」的硬指标，每个扩展 block 都必须定义降级形态。

---

## 一、总原则

1. **能复用就复用**：CommonMark 原生 / GFM / 事实标准（`$$`、Obsidian `[[]]`）能表达的，**一律直接用，不发明新语法**。
2. **只为真正缺失的 block 设计扩展**（档 3，约 9 类富 block）。
3. **两种扩展形态**（风格已拍板）：
   - **容器型 block**（可含子 block）→ Pandoc/Docusaurus **fenced div** `:::name{attrs} ... :::`
   - **叶子型富媒体**（单个 src + 属性）→ Obsidian 风 `![type](src){attrs}`
   - **属性注入**（宽高/对齐/colspan）→ Pandoc **attribute** `{key=val}` 附在标准语法后
4. **降级可读、可逆无损**：`markdown → PM → markdown` 往返不失真（交换格式双向可用）。
5. **版本化**：本方言有版本号，note 导出的 markdown 顶部可选 frontmatter 标注 `krig-md: 0.1`。

---

## 二、Block 全集三档分类（32 类 PM 节点）

> 来源：PM schema（`src/drivers/text-editing-driver/blocks/*/spec.ts`）+ AI ExtractedBlock + PDF 契约 v2.1 的并集。

### 档 1 — 原生 CommonMark 直接表达（零扩展，7 类）
`paragraph` / `heading`(1-6) / `blockquote` / `bulletList` / `orderedList` / `horizontalRule` / `hardBreak`

### 档 2 — GFM / 事实标准现成语法（直接复用，8 类）
| Block | 语法 | 出处 |
|---|---|---|
| `codeBlock` | ` ```lang ` | CommonMark（fence 按长度配对，见 [[import-to-note-convergence]] A 阶段） |
| `image`（基础） | `![alt](src)` | CommonMark |
| `table` | `\| a \| b \|` | GFM |
| `taskList`/`taskItem` | `- [x]` / `- [ ]` | GFM |
| `callout`（基础类型） | `> [!NOTE]` / `> [!WARNING]` / `> [!TIP]` | GFM alerts + Obsidian |
| 删除线 mark | `~~text~~` | GFM |
| `mathBlock` / `mathInline` | `$$...$$` / `$...$` | KaTeX/Pandoc/Obsidian 事实标准 |
| `noteLink` | `[[noteId\|label]]` | Obsidian wikilink |

### 档 3 — 需 KRIG 自定义扩展（本规范的核心，见第三节）
| Block | 类别 | 语法形态 |
|---|---|---|
| `columnList`/`column` | 容器 | `:::columns` / `:::column` |
| `toggleList` | 容器 | `:::toggle{title=...}` |
| `callout`（带 emoji/自定义图标） | 容器 | `:::callout{emoji=💡}`（基础类型仍用 `> [!X]`） |
| `videoBlock` | 叶子 | `![video](src){...}` |
| `audioBlock` | 叶子 | `![audio](src){...}` |
| `htmlBlock` | 叶子 | `![embed](url){...}` |
| `tweetBlock` | 叶子 | `![tweet](url)` |
| `fileBlock` | 叶子 | `![file](media://...){filename=...}` |
| `externalRef` | 叶子 | `![ref](url){title=...}` |
| `mathVisual` | 叶子 | `![mathvisual](){fn=... domain=...}` |
| `fileLink`（inline） | 行内 | `[[file:media://...\|名]]`（复用 wikilink 变体） |
| image 富 attrs | 属性 | `![alt](src){width=200 align=center}` |
| table colspan/rowspan/对齐 | 属性 | GFM 表 + 单元格 `{colspan=2}`（详 3.4） |

---

## 二·补 — Notion block 模型对齐（生态互通地基）

> **决策（2026-07-26 拍板）**：**block 语义/命名向 Notion API 看齐，语法保持 KRIG 自己的**（可降级、更强，不受 Notion 有损导出拖累）。
>
> **为什么对齐 Notion**：Notion 是最大的结构化文档生态，其 block 类型体系最成熟、与 KRIG 高度重合。命名/属性对齐后，未来做「KRIG ↔ Notion 双向适配器」是**字段直译**而非逐字段猜。
>
> **为什么只对齐 block 模型、不对齐 Notion 导出 md**：Notion 内部是 **block-based JSON API**（`{type, <type>:{...}, children}`），**不以 markdown 为数据模型**；它导出的 markdown 是**有损、单向**的（callout/column/toggle/equation 导出后丢富属性）。抄它的导出 md 等于把它的损带进来。→ 语法用 KRIG 的（`:::` + `![type]()` + `$$`，可无损可降级），语义对齐 Notion block。

### KRIG block ↔ Notion API block.type 映射

| KRIG block | Notion `block.type` | 对齐度 | 备注 |
|---|---|---|---|
| paragraph | `paragraph` | ✅ 一致 | |
| heading(1-3) | `heading_1/2/3` | ✅ 一致 | Notion 只到 h3；KRIG heading 1-3 恰好对齐（PDF 契约也限 1-3） |
| blockquote | `quote` | ✅ 一致 | Notion 名 `quote` |
| codeBlock | `code` | ✅ | Notion code 有 `language` + `caption`（KRIG 用 `{title=}` 属性对齐 caption） |
| bulletList → item | `bulleted_list_item` | ⚠️ 模型差异 | **Notion 无 list 容器**，每项一个 block，靠 children 表嵌套（见下「差异 1」） |
| orderedList → item | `numbered_list_item` | ⚠️ 同上 | |
| taskItem | `to_do` | ✅ | Notion `to_do` 有 `checked`（对齐 KRIG `checked`） |
| toggleList | `toggle` | ✅ | Notion `toggle` 可含 children（对齐 KRIG toggle body） |
| callout | `callout` | ✅ **高度一致** | Notion callout 有 `icon`(emoji/external) + `color`！KRIG `{emoji=}` 直接对齐，建议**补 `color`** 属性对齐 Notion |
| columnList/column | `column_list`/`column` | ✅ 一致 | Notion 命名完全相同 |
| mathBlock | `equation` | ✅ | Notion `equation.expression` = LaTeX（对齐 KRIG latex） |
| image | `image` | ✅ | Notion image 有 `caption`（对齐）；`file`(上传)/`external`(url) 两态 |
| table/tableRow | `table`/`table_row` | ⚠️ | Notion table 有 `table_width`/`has_column_header`/`has_row_header`（比 GFM 强，KRIG 可补属性对齐） |
| videoBlock | `video` | ✅ | Notion video: file/external |
| audioBlock | `audio` | ✅ | |
| fileBlock | `file` | ✅ | Notion file: caption + name |
| tweetBlock | `embed` | ⚠️ 归一 | Notion 无独立 tweet，X/推特走 `embed`（`embed.url`）。KRIG 可保留 tweetBlock 语义，转 Notion 时降为 embed |
| htmlBlock | `embed` | ⚠️ 归一 | 同上 |
| externalRef | `bookmark` | ✅ | Notion `bookmark`（url + caption）= 链接卡片，正好对齐 KRIG externalRef |
| horizontalRule | `divider` | ✅ | Notion 名 `divider` |
| noteLink(inline) | `mention`(page) | ⚠️ | Notion 页面内链是 rich_text 里的 `mention.page`；KRIG noteLink ≈ 之 |
| mathVisual | （无对应） | ❌ KRIG 独有 | Notion 无交互函数图；转 Notion 时降为 image 或 equation |
| mathInline | rich_text `equation` | ✅ | Notion 行内公式是 rich_text 元素 `equation` |

### 三个必须处理的模型差异（不能硬对齐）

**差异 1 — Notion 无「list 容器」**：KRIG 有 `bulletList{children:[item...]}` 容器；Notion 是扁平的 `bulleted_list_item` block 序列，嵌套靠每个 item 的 `children`。
→ **适配策略**：KRIG→Notion 时把 `bulletList` 拆成连续 `bulleted_list_item`；Notion→KRIG 时把连续同类 item 合并进一个容器。这是纯结构变换，无损。

**差异 2 — Notion 富文本是 `rich_text[]` + `annotations`**：Notion 的行内格式不是 markdown mark，而是 `rich_text` 元素带 `annotations:{bold,italic,strikethrough,underline,code,color}` + `href`。
→ **对齐**：KRIG marks（bold/italic/code/strike/link）逐一对齐 Notion annotations。**Notion 额外有 `underline` 和 `color`（文字色/背景色）** —— KRIG 目前无，是否补进方言见开放问题。

**差异 3 — Notion database / synced block / mention-user / breadcrumb 等是 Notion 独有**：这些是 Notion 特色（数据库视图、同步块、@人、面包屑），**KRIG 不需要、不进方言**。转换时：Notion→KRIG 遇到 database 降级为普通 table 或链接；synced block 展开为普通 block。

### 由对齐 Notion 反推的方言微调建议（可选，待拍板）

1. **callout 补 `color` 属性**：`:::callout{emoji=💡 color=blue}` —— 对齐 Notion callout.color，未来互转无损。
2. **codeBlock 的 `{title=}` 对齐 Notion code.caption**（语义统一为 caption）。
3. **table 补 `{header-row=true header-col=false}` 属性** 对齐 Notion 的 has_column_header/has_row_header。
4. **image/file/video 的 caption** 统一走属性或紧邻文本，对齐 Notion 的 caption 字段。
5. heading 天然只到 3 级，与 Notion 一致——**保持，不扩到 h4-6**。

> 这些微调**不改已定的语法风格**（仍是 `:::` + `![type]()` + `{attrs}`），只是让属性名/层级向 Notion 语义收敛。是否全采纳见开放问题。

---

## 三、档 3 扩展语法规范（逐 block）

> 每条给：**语法 · PM 映射 · 降级形态 · 可逆性**。

### 3.1 容器型（fenced div `:::`）

**通用规则**：`:::name{attrs}` 开，`:::` 闭；按**冒号数量**配对嵌套（外层用 `::::`，同 fence 长度配对思路）；`{attrs}` 为可选 `key=val` 空格分隔。

#### columnList / column
```
::::columns
:::column
左栏内容（可含任意 block）
:::
:::column
右栏内容
:::
::::
```
- **PM 映射**：`columnList{content:[column, column]}`，column 内递归解析。
- **降级**：不认识 `:::` 的系统显示 `:::columns` 等字面行 + 两栏内容顺序平铺（内容全在，只是不分栏）。✅
- **可逆**：PM→md 时按 column 数生成对应 `:::column` 块。

#### toggleList
```
:::toggle{title="回答 (ChatGPT)" open=false}
折叠内容...
:::
```
- **PM 映射**：`toggleList{attrs:{open}, content:[label, ...body]}`，title→label paragraph。
- **降级**：显示 `:::toggle` 字面 + 内容展开（内容全在）。✅

#### callout（带 emoji / 自定义图标）
```
:::callout{emoji=💡}
自定义提示内容
:::
```
- **基础类型**（note/warning/tip）**仍用档 2 的 `> [!NOTE]`**（GFM 原生兼容更好）；**仅当需要自定义 emoji/图标**时用 `:::callout{emoji=}`。
- **降级**：`> [!NOTE]` 天然降级为 blockquote；`:::callout` 降级为字面行 + 内容。✅

### 3.2 叶子型富媒体（`![type](src){attrs}`）

**通用规则**：复用 `![...](...)` 视觉；`type` 是保留字（video/audio/embed/tweet/file/ref/mathvisual）；`{attrs}` 承载类型专属参数。**降级共性**：不认识的系统当作一张 alt=type、src 可点的图片链接——**图裂但 src/信息可见**。✅

| Block | 语法 | PM attrs | 降级 |
|---|---|---|---|
| videoBlock | `![video](https://youtube.com/xxx){transcript="..." poster="..."}` | src/transcript/poster/多语言字幕 | 失效图链，url 可见 |
| audioBlock | `![audio](media://xxx){title="..."}` | src/title | 同上 |
| htmlBlock | `![embed](https://xxx){sandbox=true}` | src iframe | 同上 |
| tweetBlock | `![tweet](https://x.com/u/status/123)` | tweet url | 链接可点 ✅ |
| fileBlock | `![file](media://xxx){filename="a.pdf" mime="application/pdf"}` | mediaId/filename/mime | filename 可见 |
| externalRef | `![ref](https://xxx){title="卡片标题"}` | url/title | 链接可点 |
| mathVisual | `![mathvisual](){fn="x^2" domain="-5,5"}` | 交互函数图参数 | 显示 alt+参数（无 src） |

> **注**：`media://` 是本机媒体协议（base64/文件上传后的引用）。导出为**可移植 markdown**时，需把 `media://` 解析回真实文件/base64（可移植性策略见第五节）。

### 3.3 行内扩展

| 元素 | 语法 | 降级 |
|---|---|---|
| noteLink | `[[noteId\|label]]` | 显示 `[[label]]` 字面（Obsidian 兼容）✅ |
| fileLink | `[[file:media://xxx\|文件名]]` | 显示 `[[文件名]]` 字面 ✅ |
| mathInline | `$x^2$` | 显示 `$x^2$` 源码 ✅ |

### 3.4 属性注入（Pandoc attribute `{}`）

标准语法后附 `{key=val}`，**不认识的系统忽略属性、内容不变**：
- 图片尺寸对齐：`![alt](src){width=200 height=100 align=center}`
- 代码块标题：` ```python {title="main.py"} `
- 表格单元格合并：GFM 表基础上，单元格文本后接 `{colspan=2 rowspan=1}`（非标准，降级为普通单元格 + 可见 `{...}` 文本）

> **表格增强的兼容性权衡**：colspan/rowspan 是 GFM 表达不了的。方案：基础表走纯 GFM（大多数表够用），**仅合并单元格时**加 `{colspan}`。降级后合并失效但数据全在。

---

## 四、解析器要实现的扩展（对接 [[import-to-note-convergence]] 的 markdownCore）

统一解析核 `markdownCore(md): PMNode[]` 需在 CommonMark+GFM 基础上加：
1. **fenced div `:::name{attrs}`** 解析（容器，按冒号数配对嵌套）→ columnList/toggleList/callout。
2. **`![type](src){attrs}`** 的 type 分派 → 6 类叶子富媒体（video/audio/embed/tweet/file/ref/mathvisual）。
3. **`{key=val}` attribute** 后缀解析 → 注入对应节点 attrs（image/codeBlock/table cell）。
4. **`[[...]]` wikilink**（含 `file:` 变体）→ noteLink/fileLink。
5. GFM alert `> [!X]` → callout（基础类型）。

> 媒体本地化（base64/media://）**不在解析核内**，留导入外壳异步后处理（见 [[import-to-note-convergence]] 6.0 铁律：核 sync 无 I/O）。

---

## 五、可移植性与交换格式策略（未来对接外部系统）

- **内部流转**：`media://` 引用即可（本机）。
- **导出为可移植 md**（发给外部/备份/其它工具）：需把 `media://` 解析成 base64 内联或相对路径文件（策略待定，可选 frontmatter 声明资源根）。
- **导入外部 md**：不含 KRIG 扩展的标准 md 直接吃（档1/2 全覆盖）；含 GFM 的正常解析。**KRIG 是超集，能读任何标准 md。**
- **frontmatter**（可选）：`--- krig-md: 0.1 ---` 声明方言版本，供解析器选择兼容模式。

---

## 六、契约测试（唯一真源的回归网）

方言规范 = markdownCore 的行为契约。每类 block 一组测试，覆盖：
1. **解析**：扩展语法 → 正确 PM 节点（含 attrs）。
2. **降级**：扩展语法喂给「纯 CommonMark 解析器」时不吞内容（可用第三方 CommonMark 库断言）。
3. **往返**：`md → PM → md` 幂等（交换格式可逆）。
承接现有 `tests/ai-markdown-fenced-code.test.ts` / `md-to-pm-fenced-code.test.ts`，扩展为全 block 契约集。

---

## 七、分阶段（与导入收敛 B 阶段绑定）

本方言是 [[import-to-note-convergence]] 阶段 B（抽 markdownCore）的**语法契约输入**。建议：
- **v0.1**：先定档 1/2（复用，零新语法）+ 档 3 容器（`:::columns`/`:::toggle`）。覆盖 AI/文件/剪藏/PDF 实际高频 block（真实 PDF 样本只有 para/code/heading/image/table，全在档1/2）。
- **v0.2**：档 3 叶子富媒体（video/audio/tweet…）+ 属性注入。
- **v0.3**：可移植性导出（media:// 解析）+ 表格合并单元格。
- **PDF 引擎解耦**（战略红利）：契约从「私有 Atom JSON」改为「KRIG Markdown」后，OCR 引擎变可插拔（Marker/MinerU/视觉大模型皆原生出 md）。需推动后端改契约（跨项目、破坏性变更）——**独立决策，见开放问题**。

---

## 待拍板的开放问题

1. **PDF 引擎契约是否改为 KRIG Markdown？** 收益=引擎可插拔+砍 atoms-to-pm(542行)+砍 AtomJSON 层；代价=推动后端改契约、老 Atom 备份失效、放弃 bbox 承载的未来空间视图。（当前 bbox 已是死数据，见 [[import-to-note-convergence]] 调研。）
2. **media:// 可移植性**：内部够用，导出可移植 md 的资源打包策略何时做？
3. **表格 colspan/rowspan**：现在就进 v0.1，还是等真有需求？（真实 PDF 样本的表都是规则表。）
4. **方言版本 frontmatter** 是否强制？
5. **Notion 对齐微调是否全采纳？**（见「二·补」末尾）—— callout 补 `color`、code caption 语义统一、table header 属性、heading 保持 3 级。这些让未来 Notion 互转无损，但给方言加了几个属性。
6. **是否补 underline mark + 文字/背景色**？Notion annotations 有 `underline` 和 `color`，KRIG 目前无。补了对齐更全，但增加 mark 复杂度。（可先不补，用降级：Notion→KRIG 时 underline/color 丢失或转 mark 注释。）

---

## 附：相关文档 / 记忆
- [[import-to-note-convergence]] — 导入路径收敛（本方言是其 B 阶段的语法契约）
- [[note-export-design]] — Note 导出（本方言的**可逆性/降级形态**是导出的核心；导出=导入的镜像）
- `docs/10-business-design/ebook/PDF-Note-Atom数据契约-v2.1.md` — 现行 PDF 私有契约（本方言的替代目标）
- `[[project-markdown-import-unify]]` — 记忆索引
- `[[project-block-serialization-layering]]` — block 序列化分层
