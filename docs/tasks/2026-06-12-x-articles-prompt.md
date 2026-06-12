# 实施 Prompt：X 集成 阶段 3 — Articles 长文发布（note → X Article 块序列注入）

> 交接日期：2026-06-12
> 交接人：总指挥
> 验收人：总指挥
> 设计依据：**先通读** [设计文档 §5 阶段3](./2026-06-09-x-integration-design.md#L121)（能力边界、映射三分类、块序列注入器，已写得很全 —— 本 prompt 是把它激活成可执行实施单）
> 当前分支 `docs/x-integration-design`（已含逐block成图零件 `2b337d4e`）。

---

## 0. 为什么是这个：回到最初的核心痛点

用户做整个 X 集成的**第一诉求**就是："Articles 长文在 web 上很难编辑，想在 note 里组织好一键发布"。前面阶段（发推/回复/媒体）都是铺垫，**Articles 才是核心目标**。

X Article 编辑器（`x.com/compose/articles/edit/<id>`）本身**吃富文本**（标题/粗斜删/列表/引用/链接/图片）—— 所以 Articles **绕开了"公式/表格渲图发推被裁"那个死结**：正文富文本直接注入，不支持的块走内嵌图。

---

## ★★ 本任务分两阶段（总指挥拍板：调研先行，决策前置）

> **阶段 A（本次先做，纯调研，不写实现代码）**：产出「note 格式 × X Article 格式 对齐矩阵 + 每格处理建议 + 待总指挥实机核对清单」，**停下来交总指挥逐格拍板**。
> **阶段 B（拍板后另起）**：按拍定的矩阵实现块序列注入器。

**本次交付物 = 阶段 A 的调研报告。不要进入 §2 之后的实现。** §1-§8 是阶段 B 的实现说明，阶段 A 调研时作为背景读，但**先别动手实现**。

### 阶段 A 调研要求（产出 `docs/tasks/2026-06-12-x-articles-format-matrix.md`）

**A-1｜note 侧格式全集（查代码，不靠记忆 —— 项目铁律「别猜看真实数据」）**
- 列出 note 所有 block node + mark（已知约 32 node + 9 mark，去 `src/drivers/text-editing-driver/blocks/*/spec.ts` + `marks/` 核准当前真实集合）。
- 每项：是什么、note 里长什么样、典型用途。

**A-2｜X Article 侧支持情况（实机查不到 → 给推测 + 标「待实机核对」）**
- 基于 2026-06-09 截图（设计文档 §5）+ 开源库 + 你的判断，**推测** X Article 对每种格式的支持情况。
- **每一项都标注状态**：`已截图确认` / `推测-待总指挥实机核对`。X 改版频繁，推测有时效性。
- 汇总一份独立的「⚠️ 待总指挥实机核对项」清单（列出哪些格式需要用户对着真实 X Article 编辑器逐项确认）。

**A-3｜对齐矩阵 + 每格处理建议**
一张表，每行一个 note 格式，列出：
| note 格式 | X Article 是否支持（A-2 状态） | 建议处理（原生映射 / 文本降级 / 内嵌图 / 其他） | 理由 / 风险 / 待定 |

处理三分类沿用 §3，但**逐格给建议、标出拿不准的让总指挥定**。尤其这些容易模糊的，重点调研：
- 标题：X Article 支持几级？note 6 级怎么降？
- 列表：X 支持嵌套吗？note 多层列表怎么办？
- 引用：X 支持多层引用吗？
- 链接：X Article 怎么插链接（选中文字点🔗？粘 markdown？）
- 行内 mark 组合（粗+斜+链接叠加）X 怎么处理？

**A-4｜不做实现**：阶段 A 只读代码 + 出报告，**不改任何源码、不写注入器**。报告末尾列「阶段 B 待总指挥拍板后开工」。

---
（以下 §1-§8 为阶段 B 实现说明，阶段 A 时作背景，勿提前实现）

---

## 1. X Article 能力边界（2026-06-09 截图实锤）

**支持**：标题层级（Body▾，可能 H1/H2/H3）、**粗 B / 斜 I / 删除线 S**、引用 ❝、有序/无序列表、链接 🔗、emoji、Insert 插图、cover image（5:2 封面）+ 独立标题字段（"Add a title"）。

**不支持**：表格、代码块/语法高亮、数学公式、Mermaid、callout、toggle、下划线、高亮、字色、多列。

---

## 2. 核心工程：块序列注入器（不是 pasteAndSend）

> AI 的 `pasteAndSend` 是"一坨文本粘进一个框、点发送"——**单次整块**。
> X Article 是**逐块构造富文本**：遍历 note block → 每块按 §3 决策（原生映射 / 文本降级 / 内嵌图）→ 按序操作 X Article 编辑器（聚焦正文 → 粘这段 → 选样式 → 插图 → 下一块）。
> **这是本期核心新工程。** `focusInputBox`/`pasteTextToWebview`（`web-service-base/webview-input.ts`）只能复用其"聚焦 + OS/合成 粘贴"原语。

---

## 3. note → X Article 映射三分类（设计文档已定，照做）

**① 原生映射**（X Article 支持，注入对应富文本）：
paragraph / heading（>3 级降级）/ bold / italic / strike / link / bulletList / orderedList / blockquote / image / 标题 block→标题字段 / 封面图

**② 文本降级**（X 无对应、保文字）：underline/highlight/字色 丢格式留字；callout→引用+emoji；toggle 展开；task→☐☑ 列表；多列拍平；行内 code 去标记

**③ 内嵌图（★ 复用刚做的零件，别重新造）**（"视觉即内容"、X Article 装不下）：
- **codeBlock / mathBlock / mathInline / Mermaid / table** → 渲染成图，**作为 Article 内嵌图片插入**（X Article 支持插图！不像发推会被多图裁）。
- **复用 `render-blocks-to-media`（`src/capabilities/x-extraction/render-blocks-to-media.ts`，`2b337d4e` 已落地）** → 得 media:// → 走 X Article 的插图控件喂进去。
- 注意：发推那条"多图被裁"的死结**在 Article 不存在**（Article 是文档流插图，不是推文多图网格）—— 所以这些零件**在 Article 场景终于能正常用**。
- 渲染失败 → fail loud，退源码文本插入 + 提示。

---

## 4. 实施步骤（设计文档已定：spike 先行 → MVP → 完善）

### 4.1 spike：摸清 X Article 编辑器 DOM（动手前必做）
观察并记录进 `x-service-types.ts` 的 profile（加 Article 专属 selector 段）：
- 标题字段（"Add a title"）selector
- 正文编辑区 selector（contenteditable？）
- 工具栏各按钮：标题样式（Body▾）、B/I/S、引用、有序/无序列表、链接 —— 各自的**触发方式**（快捷键？点按钮？）
- Insert 插图的交互 + fileInput selector（可能复用发推的 fileInput，spike 确认）
- cover image 上传 selector
- 进入 Article 编辑器的入口（如何 new 一篇 Article / 导航到 compose/articles）
- **spike 结论有时效性**（X 改版频繁），失效 fail loud。

### 4.2 MVP：原生映射主链路
先跑通：标题/段落/粗斜删/列表/引用/链接/图片 的块序列注入。代码块/表格/公式先统一走 §3③ 内嵌图。**打通"note 整篇 Article → X Article"主链路**。

### 4.3 完善：②文本降级 + ③内嵌图细化
按三分类补齐。

---

## 5. 红线（贯穿，违反即返工）

> **写方向最高红线**：块序列注入完成后**绝不程序点 Publish**。用户在 X Article 编辑器里检查、自己点发布。注入只到"内容填好"。
> **fail loud**：selector 失效 / 某块注入失败 / 渲图失败 → 明确提示 + 降级（退文本/退源码），不静默假装成功、不崩中断整篇。
> **复用不重复造**：内嵌图复用 `render-blocks-to-media` + `svgToPng`；注入复用 `webview-input` 原语；selector 进 profile。**别新造第二套渲图/注入**。
> **按 ws 定向**：复用 `requireXWebContents`，打到当前 ws 的 X 实例。
> **爆破半径**：只做 Article 注入。不改发推/回复/媒体已跑通的链路。

---

## 6. 需你定的决策点（拿不准列出来问总指挥）

1. **入口**：从哪触发"发到 X Article"？note 工具栏命令？右键？建议加一个 note 级命令"发布为 X 文章"。
2. **内容来源**：整篇 note → 一篇 Article（最自然）。选区也支持吗？建议先整篇。
3. **标题来源**：note 的首个 isTitle block → Article 标题字段？还是让用户在 X 里填？建议自动填 note 标题。
4. **封面图**：note 首图 → Article cover？还是不自动设？建议本期不自动设封面，留 TODO。
5. **块序列注入的健壮性**：X Article 是 contenteditable 富文本编辑器，逐块注入时序/光标位置容易乱 —— spike 时重点验证"注入一段→换行→下一段样式不串"。

---

## 7. 验收清单（自检，总指挥据此审计）

**质量门禁**：
- [ ] `npm run typecheck` 0 错
- [ ] `npm run lint` 无新增（基线 10 pre-existing，本期不得新增）
- [ ] `npx vitest run` **全量、如实报数**。基线 257 passed。已知 `bulk-delete-perf-verify` 8 个 order-dependent flaky（与本期无关，单跑全过），与真实结果分开写，不得笼统"全绿"。补单测（块→Article 映射决策、降级逻辑）。
- [ ] 应用启动无新增控制台报错

**功能自检**（无 GUI 则列出待总指挥实机验）：
- [ ] note 整篇 → X Article：标题/段落/粗斜/列表/引用/链接/图片 正确注入
- [ ] 代码块/公式/表格 → 内嵌图插入（复用 render-blocks-to-media）
- [ ] 文本降级（callout/toggle/task/下划线等）按 §3② 正确
- [ ] 注入失败 / 渲图失败 → fail loud 提示 + 降级
- [ ] **注入完不自动点 Publish**（写方向红线）
- [ ] 发推/回复/媒体（前面阶段）不回归

**架构自检**：
- [ ] 块序列注入器复用 webview-input 原语，没另造注入
- [ ] 内嵌图复用 render-blocks-to-media + svgToPng，没重复造渲图
- [ ] Article selector 进 profile，失效 fail loud
- [ ] 按 ws 定向（requireXWebContents）
- [ ] 没改坏发推/回复/媒体链路

**交回总指挥时请附**：
1. 改动文件清单（+ 一句话职责）
2. **spike 结论**：X Article 全套 selector + 各按钮触发方式 + 注入时序怎么解决的
3. §6 决策点的决定
4. 三分类映射各 block 的处理逐条说明
5. 回归保证 + 必须实机验的点（Article 注入几乎全靠实机验，列详细）
6. 如实测试报数（真实 + 8 flaky 单列）

---

## 8. 红线汇总

- ❌ 注入完程序自动点 Publish（写方向最高红线）
- ❌ 重新造渲图/注入（复用 render-blocks-to-media / webview-input）
- ❌ 某块失败就整篇中断 / 静默丢（fail loud，单块降级不影响其余）
- ❌ 改坏发推/回复/媒体（回归）
- ❌ 凭记忆写 X Article selector —— 先 spike
- ❌ 顺手做 Canvas 长图（那是独立大工程，见 `2026-06-12-x-note-to-longimage-design.md`，本期不碰）

有架构判断拿不准（块序列注入时序、入口、标题/封面来源）——**停下来在交付说明里列问题**让总指挥定，别闷头大改。
