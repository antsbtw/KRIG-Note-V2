# 实施 Prompt：X 发推 — 不支持的格式自动渲染成图片（公式 / 代码块 / Mermaid）

> 交接日期：2026-06-12
> 交接人：总指挥
> 验收人：总指挥
> 起因：实机发现数学公式发到 X 变成 `$$\int_{-\infty}...$$` LaTeX 源码裸奔，读者完全不可读。
> 设计渊源：[设计文档](./2026-06-09-x-integration-design.md) §5「截图兜底」分类（原属阶段3，现普通发推也撞到，提前做）。
> 前置：阶段 2.5-b 图片上传（`791e6ef6`）已完成 —— **"截图 → 当附件喂 X"的管道已通**，本期复用。
> 当前分支 `docs/x-integration-design`。

---

## 0. 目标

发推/回复时，note 里 **X 纯文本装不下的"视觉即内容"block**，自动**渲染成图片**当媒体附件发（复用 2.5-b 图片附件管道），而不是输出裸源码/丢失。

**本期范围（总指挥拍板）**：**数学公式（mathBlock + mathInline）+ 代码块（codeBlock，含 Mermaid）**。
表格本期不做（降级文本至少能读），留 TODO。

---

## 1. ★ 头号约束：复用现成"block→图"能力，绝不重复造（总指挥明确要求）

> **动手前第一件事：盘点全仓所有"block / node / DOM → 图(svg/png/canvas)"的现成能力，能复用就复用，禁止新造功能重复的函数。**
> **已有索引可直接查：[`docs/reference/block-serialization-map.md`](../reference/block-serialization-map.md)**（所有 block→产物 序列化能力的地图，先读它，省得到处找）。

> **★ 附带任务·为将来抽象留素材（总指挥要求）**：本期你是 `atomsToSvg` 在 Graph 画板之外的**第二类真实消费者**。用它的过程中，把**哪里不顺手 / 命名误导 / 接口缺什么 / 该归到哪层**如实记进交付说明。这是将来"block→视觉产物层抽象成 view 无关公共模块"立项的真实素材（先复用后抽象）。**只观察记录，本期不重构。**

### ⭐ 首选复用：`atomsToSvg`（Graph 画板就是用它把 block 渲染成 SVG —— 总指挥指认）
**`src/lib/atom-serializers/svg/index.ts` 的 `atomsToSvg(atoms, options)` / `atomsToSvgWithLinks`** —— 把 note 的 atoms(block) 序列化成**自包含 SVG**（字体转 path、不依赖系统字体，带 LRU 缓存）。Graph 画板的节点渲染（`canvas-rendering/scene/NodeRenderer.ts` → `renderTextInstance`）就走它。
- 支持的 block（`src/lib/atom-serializers/svg/blocks/`）：**textBlock、list、mathBlock、mathInline** —— **数学公式直接覆盖**（`renderMathBlock` / `renderMathInline` / `mathjax-svg.ts:renderTeX`）。
- **公式截图 = 几乎零新代码**：把公式 block 的 atoms 喂 `atomsToSvg` → 得 SVG → svgToPng → 临时文件 → 喂 X。

### 缺口（atomsToSvg 覆盖不到的，另寻复用，仍别新造）
| block | 现成能力 | 位置 |
|---|---|---|
| 代码块 / Mermaid | atomsToSvg 的 `blocks/` **没有 codeBlock** → 改用：Mermaid 已有 **PNG/SVG 导出**（`ExportFormat`）+ `mermaid-renderer`；普通代码块截渲染好的高亮 DOM | `src/drivers/text-editing-driver/blocks/code-block/fullscreen/MermaidPreviewPane.tsx`、同目录 `mermaid-renderer` |
| SVG→PNG | **全仓暂无**（已核）→ 允许**新增一个公共 `svgToPng`**，放公共位置（如 `lib/` 下）供以后复用，**别每 block 写一份** | 新增 |
| 原生截图兜底 | Electron `webContents.capturePage(rect)`；先例 `capturePageRect` | `src/capabilities/pdf-viewer/loader.ts:236` |

- **若现成能力能直接产出图片**（公式 SVG→PNG、Mermaid 已有 PNG 导出）→ 直接调，**只做"接线"**（拿到图 → 转成临时文件 → 走 2.5-b 喂文件管道）。
- **若现成能力只产 SVG**（如公式）→ SVG→PNG 这步若全仓已有就复用；没有才新增**一个**通用 `svgToPng`，放在公共位置供以后复用，别每 block 写一份。
- 交付说明里**列出你盘点到的所有"block→图"能力 + 本期各复用了哪个 + 为什么没有新造重复函数**（总指挥会按这条审）。

---

## 2. 现状（已核实根因）

发推走 `markdownToTweetText`（`src/shared/x/markdown-to-tweet.ts`），公式被序列化成 `$latex$`/`$$latex$$`（序列化器 pm-to-markdown.ts:164/191）→ X 里裸奔。
- 这些 block 在 note 里**已经渲染好**（有 NodeView，公式是 KaTeX DOM、Mermaid 是 SVG）—— 截图源就是它们。
- 图片附件管道已就位：`feedFilesToInput`（`web-service-base/webview-file-input.ts`）+ `collectNoteImages` + 确认弹窗缩略图 + media 解析。**本期产出的图走同一条路。**

---

## 3. 工作分解

### 3.1 盘点 + 选定复用（§1，先做）
盘点全仓 block→图能力，定下公式 / 代码 / Mermaid 各复用哪个，SVG→PNG 用现成还是新增一个公共函数。**先出方案，拿不准列给总指挥。**

### 3.2 收集 note 里的"待截图 block"
- 从选区/整篇的 PM doc（或序列化阶段）识别 mathBlock / mathInline / codeBlock 节点。
- 注意 mathInline 是行内的 —— 行内公式混在段落里，怎么处理？建议：**整段含行内公式的，把该公式渲染成小图插入**，或行内公式较少时降级文本。**§4 决策点，你定**。块级公式/代码块单独成图。

### 3.3 渲染成图（复用 §1 能力）
- **公式 block → `atomsToSvg`（首选，§1）→ SVG→PNG → 临时文件**（零新渲染代码，复用 Graph 画板同款）
- 代码块 → 渲染高亮后的 DOM 截图 / Mermaid 走已有 PNG 导出 → 临时文件
- 图尺寸/清晰度：注意 Retina（2x）、背景（X 深色，截图背景要么透明要么配深色，别白底黑边突兀）

### 3.4 接入发推链路
- 这些图加入 `collectNoteImages` 的媒体清单（和普通图一起，受 X 最多 4 图限制 —— 公式图也算附件数！超限提示）。
- markdownToTweetText 里：被转成图的 block，**正文删掉其源码**（别再裸奔 `$$...$$`）—— 类似 2.5-b 删 media:// 图行的处理。
- 确认弹窗里这些"渲染图"也显示缩略图。

### 3.5 fail loud
- 渲染失败（KaTeX 报错 / Mermaid 语法错 / 截图失败）→ 退回**保留源码文本** + 提示用户"该公式/代码未能渲染成图，以源码发出"，不静默丢、不崩。

---

## 4. 需你定的决策点（拿不准列出来问总指挥）

1. **行内公式 mathInline** 怎么处理：渲染成行内小图？还是只处理块级、行内降级文本？建议先**只做块级 mathBlock + codeBlock，行内公式降级文本**（范围可控），行内留 TODO。
2. **公式图 + 普通图 共占 4 张额度**：note 里 3 张图 + 2 个公式 = 5 张超限。怎么取舍？建议按文档顺序取前 4，超出提示。
3. **代码块**：截"渲染好的高亮 DOM"还是用更简单的纯文本图？Mermaid 必须图，普通代码块截高亮 DOM。

---

## 5. 验收清单（自检，总指挥据此审计）

**质量门禁**：
- [ ] `npm run typecheck` 0 错
- [ ] `npm run lint` 无新增（基线 10 pre-existing，本期不得新增）
- [ ] `npx vitest run` **全量、如实报数**。基线 233 passed。已知 `bulk-delete-perf-verify` 8 个 order-dependent flaky（与本期无关，单跑全过），与真实结果分开写，不得笼统"全绿"。补单测（哪些 block 被选中转图、正文源码删除、fail loud 降级）。
- [ ] 应用启动无新增控制台报错

**功能自检**（无 GUI 则列出待总指挥实机验）：
- [ ] 发带数学公式的推：公式作为图片附件出现，正文不再有 `$$...$$` 源码
- [ ] 代码块 / Mermaid：渲染成图附件
- [ ] 渲染失败 → fail loud 退源码文本 + 提示
- [ ] 公式图 + 普通图 共占额度，超 4 张提示
- [ ] 确认弹窗显示这些渲染图缩略图
- [ ] 纯文字推 / 带普通图推（2.5-b）不回归

**架构自检**：
- [ ] **复用了现成 block→图 能力，没新造功能重复的函数**（§1，列清复用了什么）
- [ ] 渲染图走 2.5-b 现有附件管道，没另起一套
- [ ] 转图的 block 正文源码已删（不裸奔）
- [ ] fail loud 退源码不静默
- [ ] 写方向红线不变（喂完不自动发布）

**交回总指挥时请附**：
1. 改动文件清单（+ 一句话职责）
2. **§1 盘点结果**：全仓有哪些 block→图 能力、各复用了哪个、SVG→PNG 怎么解决的、为何无重复造
3. §4 决策点的决定
4. 回归保证 + 必须实机验的点
5. 如实测试报数（真实 + 8 flaky 单列）

---

## 6. 红线

- ❌ **新造与现成功能重复的"block→图"函数**（总指挥明确反对，先盘点复用）
- ❌ 转图后正文仍裸奔源码
- ❌ 渲染失败静默丢 / 崩溃（要 fail loud 退源码）
- ❌ 渲染图不走 2.5-b 现有附件管道、另起一套
- ❌ 喂完图自动点发布（写方向红线）
- ❌ 改坏纯文字推 / 2.5-b 图片上传 / 2.5-a 弹窗
- ❌ 凭记忆 —— 先盘点全仓 block→图 能力看真实代码

有架构判断拿不准（复用哪个、行内公式做不做、SVG→PNG 落点）——**停下来在交付说明里列问题**让总指挥定。
