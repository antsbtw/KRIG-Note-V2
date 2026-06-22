# 调研报告：X Article Insert 菜单整套能否程序驱动（Code/LaTeX/Table/Media/Posts/Divider）

> 调研日期：2026-06-12
> 调研人：Claude｜验收人：总指挥
> 分支：`docs/x-integration-design`（含 Articles 纯逻辑层 `9a16fa20`）
> 任务来源：`docs/tasks/2026-06-12-x-articles-image-insert-spike-prompt.md`（含 2026-06-12「★★ 重大方向更新」）
> **性质：纯调研，零实现代码改动。** 代码侧能否驱动可断言；X 每个 Insert 项点开后的真实交互全部标「待总指挥实机」。

---

## ★★ 重大方向更新（必读，决定整份报告的框架）

总指挥实机点开 X Article 的 **Insert ▾** 菜单，发现它**原生支持**：
**Media（图）、GIF、Posts（嵌推）、Divider、Code、LaTeX、Table**。

这**颠覆了「渲成图」的前提**。之前以为 X Article 不支持代码/公式/表格 → 渲成图（图不可搜索/不可复制/损质量）。但 X **原生有 Code / LaTeX / Table**，总指挥拍板：

> **优先用 X 原生 Insert（代码→Code、公式→LaTeX、表格→Table、图→Media），渲图只做实在驱动不了的兜底。** 质量最高、保真、可搜索可复制。

**本报告的核心问题因此变成**：Insert 菜单 7 项，**每项点开是什么交互、代码侧能不能程序驱动**。下面逐项给「代码侧能否驱动 + 怎么驱动」的判断，并把每项「点开后真实 DOM 长什么样」列进 §3 实机清单。

---

## TL;DR

- **技术底座齐全，「点 Insert→选某项→填内容」整套多步驱动代码侧 100% 可行。** 证据：`btn.click()` 驱动 X DOM 有先例（[x-drag-drop.ts:184-201](../../src/platform/main/x/x-drag-drop.ts#L184-L201) 点 reply 按钮）、`executeJavaScript` 查/填/点元素是成熟范式（AI extractors 全靠它做深度多步 DOM 操作）、合成 paste 填富文本已验证（[webview-input.ts:90](../../src/platform/main/web-service-base/webview-input.ts#L90)）、CDP 喂文件已验证（[webview-file-input.ts:80](../../src/platform/main/web-service-base/webview-file-input.ts#L80)）。
- **note 侧的源数据全都在**：codeBlock 带 `language`+源码、mathBlock/mathInline 带 latex 源、table 带结构化 row/cell（colspan/rowspan/colwidth）、tweetBlock 带 `tweetUrl`。所以「拿源数据喂进 X 原生 widget」note 这边零阻碍——卡点全在 X 那一侧的真实 DOM 交互（待实机）。
- **唯一代码侧无法断言、必须实机的共性卡点**：每个 Insert 项**点开后弹的到底是什么**（页面内输入框？contenteditable？`<input type=file>`？OS 原生文件框？富文本子编辑器？），以及**填进去的值用什么事件触发 X 才认**。这些是 X 私有富文本引擎（DraftJS 系）的黑盒，**禁止凭记忆断言**。
- **逐项裁决倾向（待实机确认）**：Code / LaTeX / Divider 代码侧**最看好走原生**（输入纯文本/无输入，驱动模式与现有原语同构）；Table 看好但要验填格机制；Posts 看好（填 URL 即嵌）；Media 仍是老问题（页面内 input vs OS 原生框，B1 单点决定）。**渲图兜底全面退居二线**，只在某项实机证明驱动不了时才用。

---

## 1. 代码侧能力盘点（可断言）—— 为什么「驱动 Insert」技术上成立

> 这一节确立「我们有没有手段驱动 X DOM」。结论：手段齐全且都有生产先例。具体每个 Insert 项能不能驱动见 §2。

### 1.1 点按钮 / 点菜单项 —— `btn.click()` via executeJavaScript，有生产先例

[x-drag-drop.ts:184-201](../../src/platform/main/x/x-drag-drop.ts#L184-L201) 已在生产里这样点 X 的 reply 按钮：

```js
var btn = tweet.querySelector('[data-testid="reply"]');
if (!btn) return { ok: false, reason: 'no-reply-btn' };
btn.click();
```

→ 点 Insert 触发钮、点菜单里的 Code/LaTeX/Table 项，**完全同构**：`querySelector` 命中 + `.click()` + 结构化返回判成败。**零新技术**。

⚠️ 注意该处红线注释（[L180-183](../../src/platform/main/x/x-drag-drop.ts#L180-L183)）：点的是「开框」按钮不是「发送」按钮。**驱动 Insert 同理——只点「插入控件」，绝不点「Publish」**，发布永远留用户手动（沿用写方向最高红线）。

### 1.2 查 DOM / 等 UI 出现 —— AI extractors 是「深度多步 X DOM 操作」的成熟范式

`src/platform/main/ai/extractors/`（chatgpt-extract-turn.ts / claude-extract-turn.ts 等）整套就是「在 webview 里跑多步 JS：多候选 selector 查询 → 去重 → 按文档序排 → elementFromPoint 命中 → 容差兜底 → 抽数据」，**全在单次 `executeJavaScript()` 里编排，结构化返回值给 TS 强类型接住**。

→ 「点 Insert→等弹层出现→定位弹层里的输入框/确认按钮→填值→等落地校验」这种多步编排，**直接照抄这个范式**。poll 等 UI 出现也有先例（[x-drag-drop.ts:212-218](../../src/platform/main/x/x-drag-drop.ts#L212-L218)，`while + querySelector + 200ms 轮询 + 6s 超时`）。

### 1.3 填文本到富文本/输入框 —— 合成 paste（已验证认 DraftJS）+ 原生 setter 三层兜底

[webview-input.ts:90 `pasteTextToWebview`](../../src/platform/main/web-service-base/webview-input.ts#L90) 三层策略：
1. **首选合成 `ClipboardEvent('paste')`**（注入 DataTransfer，触发 X DraftJS 原生 paste handler）—— 这正是发推文字能进去的原因，execCommand 会丢行/重复链接；
2. 兜底 OS 级 Cmd+V（`sendInputEvent`）；
3. 兜底 JS 直写（textarea/input 用 native value setter + `input` 事件；contenteditable 用 `execCommand('insertText')`）。

→ 凡是「Insert 项点开后弹的是页面内输入框/contenteditable」，填值就用这套。**关键不确定**：X 各 Insert 子控件认哪一层（合成 paste？还是 input setter？），**待实机**。但「有手段填」是确定的。

### 1.4 喂文件 —— CDP `DOM.setFileInputFiles`，编辑器无关

[webview-file-input.ts:80 `feedFilesToInput(wc, fileInputSelector, filePaths, uploadedThumbSelector?)`](../../src/platform/main/web-service-base/webview-file-input.ts#L80)：CDP 拿 selector 命中的 `<input type=file>` 的 nodeId，`DOM.setFileInputFiles` 灌磁盘绝对路径，poll 等缩略图校验。**只认 `(wc, selector, paths, thumbSel)`，无任何「compose 框」假设**。

→ Media 项**若**走「页面内隐藏 `<input type=file>`」模式，这个原语 100% 复用零改。**若**走 OS 原生文件框则此路不通（B1 单点决定，见 §2.4 / §3）。

### 1.5 media:// → 磁盘路径 —— resolveMediaPath 完全复用

[media-store-impl.ts `resolveMediaPath`](../../src/platform/main/media/media-store-impl.ts)（~L567，含越界白名单 + 存在性检查）：`media://` → `{userData}/krig-data/media/...` 绝对路径。Article 图也是 media://，解析逻辑一致，**100% 复用**。

### 1.6 note 侧源数据全在 —— 喂什么都拿得出

| Insert 项 | 对应 note block | 源数据（spec.ts 已确认带） |
|---|---|---|
| Code | codeBlock | `language`(string) + 源码（text content） |
| LaTeX | mathBlock / mathInline | mathBlock: latex 在 content 文本节点或 `attrs.latex`；mathInline: `attrs.latex`（裸 latex 无 `$`） |
| Table | table | 结构化树：tableRow → tableCell/tableHeader，带 `colspan`/`rowspan`/`colwidth`/`align`/`rowIndex`/`colIndex` |
| Media | image | `src`(media://) + `alt`/`width`/`height`/`alignment` |
| Posts | tweetBlock | `tweetUrl` + `tweetId` + 作者/正文/媒体全套元数据 |
| Divider | horizontalRule | 无数据（atom） |

→ **「拿源数据填 X 原生控件」note 这侧零阻碍。** 卡点全在 X 侧真实交互。

---

## 2. Insert 菜单逐项调研（代码侧驱动判断 + 待实机点）

> 每项：①点开是什么（代码侧推测，标推测）②能否程序驱动 + 怎么驱动（代码侧判断）③裁决倾向 ④待实机验什么。
> **红线：X 每项点开后的真实 DOM 一律「待实机」，下面的「点开是什么」全是推测，不是事实。**

### 2.1 Code（codeBlock → 走原生不渲图）

- **点开是什么（推测）**：大概率在正文流插入一个 code 块（contenteditable 代码区，可能带语言选择器下拉）。X Article 的 Code 通常是「插入空 code 块 → 光标进去 → 敲/粘代码」，**多半没有「弹独立输入框填代码+选语言」的模态**。
- **能否驱动 + 怎么驱动（代码侧判断：看好）**：
  - 点菜单 Code 项 → `.click()`（§1.1）；
  - 等 code 块出现并聚焦 → poll（§1.2）；
  - 把源码合成 paste 进去（§1.3）。源码是纯文本，**不含富格式，DraftJS paste 丢行/重复链接的老问题对纯代码影响小**（无链接、换行 X code 块应原样保留——待验）。
  - **语言选择**：若有语言下拉，需额外「点下拉→选 note 的 `language`」一步（多一步 click，技术上可行；X 支持的语言集与 note 的映射要建表，未匹配则降级无高亮——非阻塞）。
- **裁决倾向**：**强看好走原生**。驱动模式 = 现有 click + paste 同构，纯文本最稳。
- **待实机**：C1 点 Code 后是「正文内空块」还是「弹模态」？C2 代码换行/缩进合成 paste 后是否原样保留？C3 有没有语言选择？是下拉还是输入？X 支持哪些语言名？

### 2.2 LaTeX（mathBlock / mathInline → 走原生，公式裸奔 bug 的最优解）

- **点开是什么（推测）**：大概率弹一个**小输入框/inline 编辑区填 latex 源码**，X 用自带 KaTeX/MathJax 即时渲染。也可能是「插入空公式块→进编辑态→敲 latex」。
- **能否驱动 + 怎么驱动（代码侧判断：看好）**：
  - 点 LaTeX 项 → `.click()`；
  - 定位 latex 输入区 → poll；
  - 把 note 的 latex 源（mathBlock 的 content 文本 / mathInline 的 `attrs.latex`，**裸 latex 无 `$` 包裹**）填进去（§1.3，latex 是纯文本，最稳那类）；
  - 可能需要一步「确认/失焦」让 X 触发渲染（点确认按钮或 blur）。
- **裁决倾向**：**强看好走原生**。这直接解掉之前「行内公式降级文本/裸奔」的痛点——若 X LaTeX 项可程序填，行内公式也能走原生而非降级文本。
- **待实机**：L1 点 LaTeX 弹的是模态输入框还是 inline 编辑？L2 填 latex 后需不需要手动点「确认/渲染」？L3 是否区分块级/行内（X Article 可能只有块级 LaTeX，那 mathInline 要么并块要么仍降级——待定）？L4 X 用哪个引擎、支持的 latex 子集（复杂宏会不会渲染失败）？

### 2.3 Table（table → 走原生，且天然可调，**capturePage 截图那套可能整个不用做**）

- **点开是什么（推测）**：大概率弹一个「选行列」的网格选择器（hover 选 N×M）或「插入默认 2×2 表 → 在正文里编辑单元格」。
- **能否驱动 + 怎么驱动（代码侧判断：看好但最需验填格机制）**：
  - 点 Table 项 → `.click()`；
  - **定行列**：若是网格 hover 选择器，需模拟 hover/click 到目标格（`elementFromPoint`+合成事件，AI extractors 范式能做，但比纯 click 复杂）；若是「先插默认表再增删行列」，则要驱动 X 的「加行/加列」按钮到目标 N×M（多步 click 循环）。
  - **填单元格**：定位每个 cell（contenteditable）→ 逐格聚焦 + 合成 paste 填内容（§1.3）。note 的 `rowIndex`/`colIndex` 正好给定位用。
  - **colspan/rowspan**：X Article 表格**大概率不支持合并单元格**（待验）；若不支持，note 里的合并表要降级为规则网格（拆开或留空），需 log 不静默。
- **裁决倾向**：**看好走原生**。一旦成立，则**之前「table 保持可调真表格 + 发布时 `capturePage` 截图」（§2.3 旧方案）整套不用做了**——X 原生表格本就可调、可搜索、可复制，远胜截图。**这是又一次大简化，重点验。**
- **待实机**：T1 点 Table 是「网格选行列」还是「插默认表」？怎么定到 N×M？T2 单元格是 contenteditable 吗？逐格填值用合成 paste 认不认？T3 支不支持 colspan/rowspan 合并格？T4 表格有无行列上限？T5 填格顺序/时序（X 会不会在填某格时重排）？

### 2.4 Media（image → 老「图落位」问题，B1 单点决定）

> 这是原「图落位」调研，整体并入 Media 项，结论从旧报告沿用并收敛。

- **点开是什么（推测，最大不确定）**：两种可能，**直接决定整条路**：
  - **(页面内 input)**：点 Media → 页面里出现/激活一个隐藏 `<input type=file>`。→ `feedFilesToInput` 100% 复用零改（§1.4）。
  - **(OS 原生框)**：点 Media → 弹操作系统文件选择对话框，`<input>` 仅点击瞬间临时挂载。→ CDP `setFileInputFiles` 在「未点击时」扫不到 input，`feedFilesToInput` 第一步 fail loud 退出，**此路不通**，得另想非 CDP 路径或走渲图/降级。
- **selector 不能假设 == 发推**：现 profile `fileInput: 'input[data-testid="fileInput"], input[type="file"][accept*="image"]'`（[x-service-types.ts:128](../../src/shared/types/x-service-types.ts#L128)）第一候选是**发推 compose 框**的 testid（注释 [L117-122](../../src/shared/types/x-service-types.ts#L117-L122) 明确）。Article 插图 input 极可能是**另一个 testid**。第二候选 `input[type=file][accept*=image]` 是泛化兜底，**若** Article 也是页面内隐藏 input 模式**有可能**命中——但**禁止断言**。建议 profile 给 Article 单独一组 selector（`articleFileInput`/`articleMediaThumb`），别污染发推那对。
- **校验信号要换**：现 `uploadedMediaThumb`（[L129](../../src/shared/types/x-service-types.ts#L129)）是发推缩略图条 testid（`attachments`/`removeMedia`/`media`）。Article 图进**正文流**（变 `<figure>`/`<img>` 块），渲染形态根本不同，**几乎肯定要另配** Article 版 thumb selector（实机抓喂图成功后的 DOM 配）。
- **落位**：见 §4 落位策略（甲/乙/丙）。
- **裁决倾向**：**B1 单独决定**——页面内 input → 走原生（路线甲，图统一文末）；OS 原生框 → 本期纯文字（路线丙），图另立项。
- **待实机（沿用旧 B 清单）**：见 §3 的 M1-M5。

### 2.5 Posts（tweetBlock → 走原生，填 URL 即嵌）

- **点开是什么（推测）**：大概率弹一个「粘 X 推文链接」的输入框，填 tweetUrl → X 拉取并渲染嵌入卡片。
- **能否驱动 + 怎么驱动（代码侧判断：看好）**：点 Posts 项 → `.click()` → 定位 URL 输入框 → 填 note tweetBlock 的 `attrs.tweetUrl`（§1.3，纯文本 URL 最稳）→ 可能需确认/回车 → poll 等嵌入卡片出现。
- **裁决倾向**：**看好走原生**。note 的 tweetBlock 带完整 `tweetUrl`，喂进去最直接。比现状「降级成 `author: text url` 文本」好得多。
- **待实机**：P1 点 Posts 弹的是「填 URL 输入框」还是「搜索推文 UI」？P2 填 URL 后是自动嵌还是要点确认/回车？P3 X 要求 URL 是特定格式（status 链接 vs 短链）吗？note 存的 `tweetUrl` 格式是否被 X 接受？

### 2.6 Divider（horizontalRule → 走原生，最简）

- **点开是什么（推测）**：点 Divider 直接在光标处插一条分割线，**无任何输入**。
- **能否驱动（代码侧判断：最看好）**：点 Divider 项 → `.click()`，完事。无填值、无确认。**最简单的一项**。
- **裁决倾向**：**走原生，无悬念**（前提：能定位到 Divider 菜单项并 click——与其他项共享同一个 Insert 菜单定位逻辑）。
- **待实机**：D1 点 Divider 插在光标处还是固定位置？（影响落位，但分割线落位容错高，非阻塞。）

### 2.7 GIF（note 无对应 → 本期忽略）

- note 没有直接对应 block，**本期不调研、不实现**。记一笔：将来若有「note 引用 GIF」需求再立项。

---

## 3. 「待总指挥实机」清单（对真实 X Article 逐项验）

> 红线：以下全部**不可凭记忆断言**。每项给「怎么验 / 看什么 DOM」。建议 X Article 编辑页开 devtools 逐项点 Insert 抓。
> **建议优先级**：先验 **§3.0 共性「Insert 菜单怎么定位」** → 再按 **Media(M1) → LaTeX → Code → Table → Posts → Divider** 顺序，因为 Media 的 B1 单点决定大方向。

### 3.0 共性（所有 Insert 项的前置）

| # | 待验 | 怎么验 |
|---|------|--------|
| **G1** | **Insert ▾ 触发钮的 selector** | devtools 选中那个 Insert/＋ 按钮，看它的 `data-testid`/`aria-label`/role。这是所有项驱动的入口。 |
| **G2** | **菜单弹出后每个项（Code/LaTeX/Table/Media/Posts/Divider）的 selector** | 点开菜单，逐项选中看 testid/aria-label/文本。建议记一张 selector 对照表。 |
| **G3** | **菜单是即时 DOM 还是异步渲染** | 点 Insert 后菜单项是否立刻在 DOM？需不需要 poll 等出现（决定要不要套 §1.2 轮询）。 |

### 3.1 Media（原图落位，最高优先——B1 决定大方向）

| # | 待验 | 怎么验 / 看什么 | 影响 |
|---|------|----------------|------|
| **M1**（旧B1）| **插图是「页面常驻隐藏 `<input type=file>`」还是「点 Media 弹 OS 原生框」？** | 编辑页**不点任何按钮**先 `document.querySelectorAll('input[type=file]')` 看有没有；再点 Insert→Media，观察弹网页内文件区还是系统对话框，点击瞬间看 DOM 有无临时挂 input。 | **决定整条 feedFilesToInput 路是否走得通**（最大不确定点）。OS 原生框 → 此路废。 |
| **M2**（旧B2）| **插图 input 的 testid/selector？是不是 `fileInput`（与发推同）？** | M1 确认页面内 input 后，devtools 选中看 `data-testid`/`accept`/父容器。**禁止假设 == 发推。** | profile 要不要给 Article 单独 selector。 |
| **M3**（旧B3）| **图能插段落中间吗？光标定位有效吗？** | 光标放两段间 → 插图 → 看图嵌光标处还是被挪末尾/固定处。 | 决定路线乙（逐图原位）可行性。X 不认光标 → 乙死。 |
| **M4**（旧B4）| **图数量上限？** | 连插 5+ 张，看 X 是否拦在某数（发推是 4）。 | 多图要不要分批/截断 + **log 丢弃（不静默截断，铁律）**。 |
| **M5**（旧B5）| **粘贴留的 📷 占位符喂图后能否「补上」？死占位还是活槽位？** | 先粘含 `<img src=media://>` 的 HTML 变 📷；选中占位看 DOM（破 img？media slot？）；再 Insert 喂同图，看 📷 被替换还是新增（旧📷残留）。 | 喂图前要不要先把 HTML 里 `<img>` 摘掉（避残留破图标）。 |
| **M-extra1** | 喂图成功后正文里图的 DOM 形态（`<figure>`?`<img>`?testid?） | devtools 看喂成功后的图节点。 | 配 Article 版 `uploadedMediaThumb` 校验 selector。 |

### 3.2 LaTeX（公式裸奔 bug 最优解，建议第二验）

| # | 待验 | 怎么验 |
|---|------|--------|
| **L1** | 点 LaTeX 弹模态输入框还是 inline 编辑？输入区是 input/textarea 还是 contenteditable？ | 点 LaTeX，devtools 看弹出元素类型 + selector。 |
| **L2** | 填 latex 后需不需要手动点「确认/渲染」按钮，还是即时渲染？ | 手填一段 latex 观察，看有无确认钮、blur 是否触发渲染。 |
| **L3** | X Article 有无「行内公式」？还是只有块级 LaTeX？ | 试在一行文字中间插 LaTeX 看是块级断行还是行内。决定 mathInline 怎么处理。 |
| **L4** | X 用哪个公式引擎、支持的 latex 子集？复杂宏会失败吗？ | 填几个复杂公式（矩阵、对齐环境、自定义宏）看渲染。决定哪些公式仍需渲图兜底。 |

### 3.3 Code（建议第三验）

| # | 待验 | 怎么验 |
|---|------|--------|
| **C1** | 点 Code 是「正文内空 code 块」还是「弹模态填代码」？ | 点 Code，看插入物形态 + selector。 |
| **C2** | 代码换行/缩进合成 paste 后是否原样保留？（DraftJS 丢行风险） | 粘一段多行带缩进的代码，看是否走样/丢行。若丢行需换填值策略或逐行注入。 |
| **C3** | 有无语言选择？下拉还是输入？X 支持哪些语言名？ | 看 code 块有无语言选择器，列出可选语言。建 note `language` → X 语言名映射表。 |

### 3.4 Table（大简化重点，建议第四验）

| # | 待验 | 怎么验 |
|---|------|--------|
| **T1** | 点 Table 是「网格选行列」还是「插默认表后增删」？怎么定到 N×M？ | 点 Table 看交互；若网格 hover，看选择器 DOM；若默认表，找加行/加列按钮 selector。 |
| **T2** | 单元格是 contenteditable 吗？逐格填值合成 paste 认不认？ | devtools 看 cell 类型；试填一格看进不进。 |
| **T3** | 支不支持 colspan/rowspan 合并格？ | 试合并单元格。X 不支持 → note 合并表要降级规则网格（log 不静默）。 |
| **T4** | 行列上限？ | 试插超大表（如 20×20）看有无拦截。 |
| **T5** | 填格时 X 会不会重排/移动光标？时序如何？ | 逐格填观察有无竞态。 |

### 3.5 Posts（建议第五验）

| # | 待验 | 怎么验 |
|---|------|--------|
| **P1** | 点 Posts 弹「填 URL 输入框」还是「搜索推文 UI」？ | 点 Posts 看弹出物 + 输入区 selector。 |
| **P2** | 填 URL 后自动嵌还是要确认/回车？ | 填一个 tweetUrl 观察。 |
| **P3** | X 要求 URL 特定格式？note 存的 `tweetUrl` 格式被接受吗？ | 用 note tweetBlock 里真实 `tweetUrl` 试填，看嵌入成功否。 |

### 3.6 Divider（最简，顺手验）

| # | 待验 | 怎么验 |
|---|------|--------|
| **D1** | 点 Divider 插光标处还是固定位置？ | 光标置中间点 Divider 看落点。容错高，非阻塞。 |

### 3.7 补充实机点

- **X-extra1**：X Article 有无「自动保存草稿」？喂内容是否需在同一会话连续完成（影响多步编排时序）。
- **X-extra2**：Insert 各项操作之间 X 有无 debounce/动画延迟，决定 poll 超时阈值（现有先例用 6s / 200ms 步进）。

---

## 4. Media 落位策略候选 + 推荐 + 权衡

> 仅 Media（图）涉及「落位」问题（Code/LaTeX/Table/Posts/Divider 插在光标处即可，落位容错高）。沿用旧报告，结论待 §3.1 实机收敛。

### 路线甲：图统一放文末
- **做法**：文字富格式 HTML 先粘进正文 → 所有图当一批喂进 Article file input（M1/M2 通过前提下），落正文末尾/X 默认落点。
- **优点**：不依赖光标/段落定位（绕开 M3 最不可控项）；与 2.5-b 发推喂图编排几乎同构，复用面最大。
- **缺点**：图与原文位置脱钩，图文混排的 note 发出来「文字一坨 + 图全堆文末」。
- **依赖**：M1（有可选中 input）、M2（selector）、M-extra1（thumb 校验）。**不依赖 M3**。

### 路线乙：逐图定位到原文位置插入
- **做法**：按 note 图位置，逐图把 X 光标移到对应段落间 → 触发插图 → 喂文件。
- **优点**：保真，图文同位。
- **缺点（代码侧判定重且高风险）**：要程序控 X 富文本光标/选区（X 自有引擎无公开光标 API，靠合成事件/DOM Selection 硬怼，极脆、改版即碎）；每图一轮喂+等落地，时序复杂；**强依赖 M3**（X 不认光标直接死）。与既有「一次喂一批文件」原语不匹配，要新写编排。
- **代码侧结论**：**不推荐作为本期范围**，留远期「保真模式」选项。

### 路线丙：本期不嵌图，纯文字 + 格式先发
- **做法**：Article 本期只发文字富格式（已验证 ✅），图全跳过；UI 明示「Article 暂不带图，请手动插图」（fail-loud 降级提示，复用 `mediaWarning` 同类机制）。
- **优点**：最小范围、零新风险、立即可交付；把图落位高不确定项推迟到实机结论齐了再立项。
- **缺点**：功能不完整，用户手动补图。

### 代码侧推荐（待实机确认前的倾向）
1. **若 M1 证明「OS 原生文件框、无页面常驻 input」** → feedFilesToInput 路在 Article 不通 → **本期走路线丙**（纯文字先发 + 明示降级），图落位另立项研究非 CDP 路径。
2. **若 M1/M2 证明「页面有可选中的隐藏 input」** → **走路线甲（图统一文末）**：复用 feedFilesToInput 近零成本，绕开 M3 最不可控项，先把「能带图」跑通；图文同位（乙）作后续保真增强，不进本期。

**路线乙任何情况都不建议进本期**（重 + 脆 + 强依赖 X 光标行为）。**关键前置裁决点 = M1。**

---

## 5. 复用面（现有原语在「驱动 Insert」能复用多少）

| 组件 | 文件 | 复用度 | 说明 |
|------|------|--------|------|
| `btn.click()` 驱动 X DOM | [x-drag-drop.ts:184-201](../../src/platform/main/x/x-drag-drop.ts#L184-L201) | **范式 100%** | 点 Insert/菜单项照抄；注意只点「插入」不点「Publish」。 |
| `executeJavaScript` 多步 DOM 编排范式 | `ai/extractors/*`（chatgpt/claude-extract-turn） | **范式 100%** | 「点→等弹层→定位输入框→填→校验」直接套。 |
| poll 等 UI 出现 | [x-drag-drop.ts:212-218](../../src/platform/main/x/x-drag-drop.ts#L212-L218) | **100%** | while+querySelector+200ms+6s 超时。 |
| `pasteTextToWebview` 合成 paste | [webview-input.ts:90](../../src/platform/main/web-service-base/webview-input.ts#L90) | **100%（文本类填值）** | Code/LaTeX/Posts/Table 单元格填文本全用它；认哪层兜底待实机。 |
| `feedFilesToInput` CDP 喂文件 | [webview-file-input.ts:80](../../src/platform/main/web-service-base/webview-file-input.ts#L80) | **100%（零改）** —— 前提 M1/M2 通过 | 仅 Media 项用；编辑器无关，只认 (wc, selector, paths, thumbSel)。 |
| `resolveMediaPath` media://→磁盘 | media-store-impl.ts:~567 | **100%** | Media 项用，解析逻辑一致。 |
| note 各 block 源数据（spec.ts） | `blocks/*/spec.ts` | **100% 可取** | latex/code+language/table 结构/tweetUrl 全在 attrs/content，喂什么拿得出（§1.6）。 |
| Articles 纯逻辑层（doc→article-doc→HTML） | [article-doc-to-html.ts](../../src/drivers/text-editing-driver/serializers/article-doc-to-html.ts) | **文字 100%；非文字大改** | **方向变更**：原 code/math 走「渲图→`<img src=media://>`」(`doc-to-article-doc` 的 mediaMap 分支)，**新方向改走 X 原生 Insert**，HTML 不再带这些图，而是发布编排里逐块驱动 Insert。table 的「保留真表 + capturePage 截图」(§2.3 旧)若 T1-T5 通过则**整个废弃**，改原生插表。 |
| 渲图兜底 `atomsToSvg`/`svgToPngDataUrl`/`render-blocks-to-media` | `lib/atom-serializers/svg/`、`lib/svg-to-png.ts`、`capabilities/x-extraction/render-blocks-to-media.ts` | **退居兜底** | **不再是主路**。仅当某 Insert 项实机证明驱动不了（如复杂 latex X 渲不出、mermaid 无原生项）时才用。代码已在，留着。 |
| profile selectors | [x-service-types.ts:128-129](../../src/shared/types/x-service-types.ts#L128-L129) | **需大幅扩充** | 现只有发推 fileInput/thumb。需新增：Insert 触发钮、各菜单项、各子控件输入框/确认钮、Article 版 fileInput/thumb 一整套（待 §3 实机配齐）。建议 Article 专属命名空间，别污染发推。 |

**复用面小结**：**底层驱动原语（click/查DOM/合成paste/喂文件/media解析）+ note 源数据全可复用，「驱动 Insert」零核心重写**。需要新增的是：①一整套 Article Insert selector（待实机配）②每个 Insert 项的薄编排层（点→填→校验的具体步骤）③发布编排把「逐块按类型选 Insert 项」串起来。**工作量集中在 selector 配置 + 编排，不在原语。** 同时**砍掉**原计划的「code/math 渲图主路」和「table capturePage 截图」（降级为兜底/废弃），是净简化。

---

## 6. 结论

- **方向确认**：X Article 原生支持 Code/LaTeX/Table/Media/Posts/Divider → 优先走原生（高质量、可搜索、可复制），渲图退居兜底。
- **代码侧能断言**：驱动 X DOM 的全套原语齐备且有生产先例（click/查DOM/合成paste/CDP喂文件/media解析），note 侧源数据全在 → **「点 Insert→选项→填内容」整套多步驱动技术上 100% 可行**。
- **代码侧无法断言、必须实机**：每个 Insert 项点开后的**真实 DOM 交互**（弹什么、填值认哪种事件、有无确认步），以及 selector。**全列进 §3 清单，禁止凭记忆断言。**
- **逐项驱动倾向（待实机）**：Divider/LaTeX/Code/Posts **强看好走原生**；Table **看好且可能大简化**（capturePage 那套或可废）；Media **B1/M1 单点决定**走原生（路线甲）还是本期纯文字（路线丙）。
- **建议总指挥实机顺序**：先 §3.0 共性（Insert 菜单定位）→ M1（Media 大方向）→ LaTeX → Code → Table → Posts → Divider。

**待总指挥实机 §3 清单结果后，再定每项走原生还是兜底、确定 selector、开工编排。本期纯调研，不写实现。**
