# 汇报总指挥：X 发推「公式/不支持格式」从「逐 block 成图」转向「整篇渲成一张长图」

> 日期：2026-06-12
> 状态：**待总指挥拍板路线**（实机验证逐 block 成图死路，已停手编码，先汇报）
> 报告人：实施方
> 验收人：总指挥

---

## 一、一句话

「公式/代码/Mermaid 各自渲一张图当附件发」**实机走不通**（X 多图网格 cover 裁切，公式两端被裁）。
用户拍板改方向：**整篇/选区渲成一张长图、单图发**（躲开网格裁切）+ 手机阅读布局 + 字号保持。
但盘点发现：**整篇含各类 block 渲成美观长图 = 要把 atomsToSvg 扩成一个完整 note 渲染器**，远超原任务工作量 → **请总指挥定路线**。

---

## 二、为什么「逐 block 成图」死了（实机三轮，已验证）

| 轮 | 做法 | 实机结果 | 根因 |
|---|---|---|---|
| 1 | 公式 atomsToSvg(width=680)→PNG | 公式糊成窄带 | atomsToSvg viewBox 宽=画板节点宽，公式占左侧一小块、大留白 |
| 2 | svgToPng getBBox tightCrop 裁白边 | 公式错切/拼接 | getBBox 对带 `<g transform>` 的 MathJax SVG 量不准 |
| 3 | 公式 renderTeX 直出 + 16:9 卡片居中 | 卡片被 X 网格 cover 裁掉两端 | **多图 → X 并排网格 + cover 裁切** |

**死穴：只要发"多张图"，X 就走网格 + cover 裁切，横向内容必被裁。→ 唯一解法是只发一张图。**
（功能管道全部打通：渲染→media://→2.5-b 附件→确认弹窗缩略图都正常，纯粹是"多图被 X 裁"这一个产品层问题。）

---

## 三、用户拍板的新方向（整篇 → 一张长图）

1. **整篇/选区所有 block 渲成一张竖向长图**，单图发 → 无网格裁切。
2. **布局以手机阅读为目标**（竖屏、舒适宽、行距/留白美观），否则推不好看。
3. **字号保持**（用 note 同款字号，不为 X 缩放；靠高倍率光栅保清晰）。
4. **确认弹窗加开关**：「文字推 / 长图推」二选一，并**提醒用户"推文已转图片"**。
5. 正文默认取「标题 + 首段」引导，用户可在弹窗改。
6. **含图片**：note 里原有图片（如表格截图）也要画进长图（用户明确要 B）。

---

## 四、★ 盘点发现的关键现实（决定工作量，请总指挥重点看）

**`atomsToSvg` 目前只渲 5 类 block**：paragraph / heading / list / mathBlock / codeBlock。
note 里其余 block **全是占位文字**：

| 用户 note 实际含 | atomsToSvg 现状 |
|---|---|
| **表格**（节点测试表、拓扑分析表，好几张) | `[Table]` 占位 ❌ |
| **图片**（media:// 截图) | `[Image]` 占位 ❌ |
| callout / 引用 / 任务列 / 折叠 / 分栏 / 横线 / tweetBlock | 各种 `[..]` 占位 ❌ |

→ **「整篇含各类 block 渲成美观长图」= 要把 atomsToSvg 从「画板短文本渲染器」扩成「完整 note 页面渲染器」**（补 image 异步加载嵌入、table 网格布局、callout/quote 容器、task/toggle/column…），并自己实现**手机阅读版式**。这是一个**独立的较大功能**，不是收尾。

**用户初选**：扩 atomsToSvg 渲所有 block 类型（B）。
**实施方建议（供总指挥参考）**：见下「五」——我更倾向「真实 NoteView 离屏渲染 + 截图」，比手搓第二套渲染器**省得多、保真、所见即所得**。

---

## 五、两条实现路线对比（请总指挥拍板）

### 路线 A：扩 atomsToSvg 渲所有 block（用户初选）
- 做法：给 atomsToSvg 逐个补 image/table/callout/quote/task/toggle/column… 渲染 + 手机版式。
- 代价：**大**。等于手搓第二套 note 渲染器；表格/嵌套容器很难还原；**与真实 NoteView 样式必然不一致**（两套渲染各自演化）；长期维护负担（note 加新 block 要两处都改）。
- 好处：纯 SVG、不依赖 webview 截图时序。

### 路线 B（实施方推荐）：真实 NoteView 离屏渲染 + capturePage 截长图
- 做法：开一个**离屏窗口/容器**，用 **note 真实的 NoteView** 按**手机宽度**渲染整篇 → Electron `webContents.capturePage` 截成长图。
- 代价：**中**。无需重写任何 block 渲染（所有类型、样式、版式**现成**）；要处理离屏渲染时序、字体/图片加载完成再截、长图分段拼接（超高时）。
- 好处：**所有 block 类型免费**、**所见即所得**（跟用户在 note 里看到的一模一样）、手机版式只是设个宽度、note 演化零额外成本。先例：仓里已有 `capturePageRect`（pdf-viewer）。
- 风险：离屏渲染需要一个能跑 NoteView 的最小宿主；截图时序（等渲染稳定）。

> 实施方判断：**路线 B 更省更保真**。路线 A 的「手搓表格/图片/容器渲染 + 自定义手机版式」工作量和走偏风险都明显更高。但 B 依赖离屏 NoteView 宿主，需总指挥认可这条技术路径。

---

## 六、无论哪条路，共用的接入改动（已想清，工作量小）
- 取整篇/选区内容（A 取 atoms[]；B 取 PM doc 喂离屏 NoteView）。
- 长图 → svgToPng/capturePage → PNG → mediaPutBase64 → media:// → **2.5-b 单图附件管道**（现成）。
- send-to-x：单图替换现「逐公式多图」逻辑；确认弹窗加「文字/长图」开关 + 「已转图片」提醒。
- 废弃 collect-renderable-blocks / renderBlocksToMedia / markdown 删 $$ 那套（逐公式专用，长图模式不需要）。
- 正文取标题+首段引导。

---

## 七、请总指挥拍板
1. **路线 A（扩 atomsToSvg）还是 B（真实 NoteView 离屏截图）？** ← 最关键，决定工作量与保真度。实施方推荐 B。
2. 确认这是**独立较大功能**、可立项分阶段（spike 验证 → 实现 → 接入）？
3. 当前已落地的「逐 block 成图」代码(svg-to-png/codeBlock 渲染/collect-renderable-blocks/render-blocks-to-media/markdown 删源码/x-write 空文放开)——**保留待复用还是回滚**？（其中 svgToPng、codeBlock 渲染对路线 A 仍有用；对 B 基本作废。）

---

## 附：当前分支状态
- 分支 `docs/x-integration-design`，逐 block 成图全套已实现 + 257 测试通过，但**实机效果不达标**(本报告 §二)，未合 main。
- 等总指挥定路线后再动。
