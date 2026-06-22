# 实施指令 — 编辑态↔渲染态视觉一致性专项(一期)

> 发令人:总指挥 · 2026-06-22 · 执行人:新对话实施者 · 验收人:总指挥 + **用户真机截图比对**
> 分支:**新开 `feature/graph-edit-render-consistency`**(从 `feature/graph-shape-library-rebuild` HEAD 切——shape 库重建线已收口;**不合 main**)
> 缘起:[L5G6c-postC-truemachine-fixes.md §3](../RefactorV2/stages/L5G6c-postC-truemachine-fixes.md) 交接 + 用户拍板范围

---

## 0. 立项裁定 + 问题本质

**总指挥已准予立项**(L5G6c postC §6)。本质(已核实):

> 画板节点有**两套独立渲染同一份 doc**:
> - **编辑态** = text-editing PM `NodeView` + `pm-host.css`(真 DOM,4318 行 css)
> - **渲染态** = `atomsToSvg → SVGLoader → THREE mesh`(平时显示,blocks/* 各自硬编码常量)
>
> 两套视觉规格**各定各的、无共享真源 → 处处差**。铁证(已 grep):

| 规格 | 编辑态 pm-host.css | 渲染态 blocks/* |
|---|---|---|
| 正文字号 | **16px** | `FONT_SIZE=13/14` |
| 行高 | **1.7** | `LINE_HEIGHT=18`(≈1.28) |
| H1 字号 | **38px** | level × 默认 14 |
| callout/quote padding | css 各定 | `CALLOUT_PAD_X=12` 等 |

**目标**:抽**共享视觉规格常量**,两套同源消费,从根上消除"各定各的"。**不是逐个 magic number 对调**(那会再漂),是建单一真源。

---

## 1. ⚠️ 范围(用户拍板,本专项的硬边界)

**Graph 节点定位 = 完整富文本(note 全套 block)** —— 长期目标。**分两批:**

| 批次 | 范围 | 本专项 |
|---|---|---|
| **一期(本 prompt)** | ① 已有 8 块(paragraph/heading/list×2/codeBlock/mathBlock/mathInline/blockquote/callout)**视觉一致性对齐**;② 补**轻量块**渲染态:horizontalRule / taskList / toggle(toggleList)/ mermaid 等矢量友好块 | ✅ 做 |
| **二期(后续专项)** | table / image / media(audio/file/video)/ columnList·column —— 矢量 mesh 渲染硬骨头 + 小 shape 内视觉怪 | ❌ 不做,单列 |

### ⚠️ 配套硬约束:slash 菜单与渲染态能力同步(防"功能黑洞")
**现状不对称(已核实):编辑态 `slash:true`+`inputRules:true` 放开 note 全套 turn-into,但渲染态只渲 8 块** → 用户能插渲染态渲不出的块(divider/toggle/table/…)→ Esc 后渲成灰字占位/丢失。
**本专项必须收口此闸**:graph 编辑态 slash/inputRules **只放出渲染态本期支持的块**(8 已有 + 一期新补的轻量块);二期块(table/media/column)**在 graph 编辑态先关**,等二期补渲染再放。**编辑能插的 ⊆ 渲染能渲的**,是不变量。

---

## 2. 起点勘探(总指挥已核实)

1. **渲染态真源散落**:[lib/atom-serializers/svg/blocks/*](../../src/lib/atom-serializers/svg/blocks/)(textBlock/list/codeBlock/mathBlock/quoteCallout 各自 `FONT_SIZE`/`LINE_HEIGHT`/`PADDING`/`BULLET` 常量)+ [icon-raster.ts](../../src/capabilities/canvas-rendering/scene/icon-raster.ts)(图标比例)。dispatch 在 [svg/index.ts](../../src/lib/atom-serializers/svg/index.ts)。
2. **编辑态真源**:[drivers/text-editing-driver/pm-host.css](../../src/drivers/text-editing-driver/pm-host.css)(4318 行,font-size/line-height/padding/radius 散在各 selector)+ 各 block NodeView。
3. **graph 编辑态 plugin preset**:[canvas-text-node/edit-overlay.tsx](../../src/capabilities/canvas-text-node/edit-overlay.tsx) `CANVAS_TEXT_NODE_PLUGIN_PRESET`(`slash:true`/`inputRules:true` 现全放 → §1 闸要收)。
4. **渲染态已渲 8 块** vs **note 全套**(table/image/media/column/horizontalRule/mermaid/taskList/toggle 缺)。

---

## 3. 逐 commit 拆解(建议;实施前出细化拆解 + 决策点,总指挥审过再大改动)

**E1 — slash/inputRules 闸收口(防黑洞,先做)**
- graph 编辑态 preset:slash/turn-into 白名单 = 渲染态本期支持块;二期块关。
- **不变量单测**:graph 可插块集 ⊆ 渲染态可渲块集(列表对照,防回归再漂)。

**E2 — 共享视觉规格真源(架构核心)**
- 抽 `shared-block-visual-spec`(放哪由实施者定:lib 下中性位,两侧都能 import type/值;**别让渲染态反向 import pm-host.css**)。
- 定义:正文字号/行高、heading level 倍率、list bullet/indent、quote/callout padding·radius·bar、code 字号·背景、图标比例…
- **两套同源消费**:渲染态 blocks/* 读它(替换硬编码);编辑态 pm-host.css 尽量用 CSS 变量同源(css 不能 import ts → 可由构建/常量生成 css var,或文档约定单一数值表 + 两边引用。**机制由实施者拍,记决策**)。
- **决策点 EC1**:编辑态 css 怎么同源(CSS var 注入 / 数值表双引 / 生成)?这是专项成败关键,实施者出方案总指挥拍。

**E3 — 逐块对齐(已有 8 块)**
- 逐 block 用共享规格替换渲染态硬编码:字号 14→16、行高、callout/quote padding、list bullet、heading 行高、code 字号…
- 每块**真机截图比对**编辑/渲染(对齐 postC 纪律)。

**E4 — 补轻量块渲染态(一期范围)**
- horizontalRule / taskList / toggle / mermaid 渲染器(矢量友好);接 svg/index dispatch + 共享规格。
- 对应 slash 白名单放开(E1 同步)。

**E5 — 验收 + 真机截图比对**

---

## 4. 红线

1. **W5**:atom-serializers 0 import three(SVG 层);共享规格放中性位,**渲染态不反向 import 编辑态/pm-host.css/drivers 运行时**。
2. **复用 > 重写**:共享规格是抽公共真源,不是重写两套渲染;轻量块复用现有 SVGLoader/纹理 quad 路。
3. **编辑 ⊆ 渲染不变量**:slash 能插的必须渲染态能渲(E1 单测守)。
4. **fail loud**:未支持块在 graph 编辑态就不让插(而非插了渲灰字);渲染态遇未知块仍 warn 占位(兜底,不静默)。
5. **别猜视觉**:逐块真机截图比对,不靠肉眼估常量。
6. 每 commit 自包含绿:tsc 0 / eslint 新增 0 / 屏障 0 / 单测绿。
7. **二期块(table/media/column)不碰**(范围外);不动 note 主编辑器对 note 文档的渲染(只动 graph 节点这条消费链 + 共享规格)。

> ⚠️ **R-shared**:抽共享规格时,note 主编辑器(NoteView)也消费 pm-host.css —— 改 css 变量/数值要**确认不改变 note 主编辑器现有视觉**(grep pm-host.css 消费方;note 正文该是什么样还什么样)。**只让渲染态向编辑态看齐,不反向改编辑态既有观感**,除非总指挥另拍。

---

## 5. 验收(总指挥代码层 + 用户真机截图比对)

**代码层:**
- [ ] 共享视觉规格真源建立,渲染态 blocks/* 硬编码替换为读共享;编辑态同源机制落地(EC1)。
- [ ] slash/inputRules 白名单 = 渲染态支持块;**编辑⊆渲染不变量单测绿**。
- [ ] 轻量块(horizontalRule/taskList/toggle/mermaid)渲染器接好。
- [ ] **R-shared**:note 主编辑器视觉零回归(确认)。
- [ ] tsc 0 / eslint 新增 0 / 屏障 0 / 单测绿;W5 守住。

**用户真机(本专项重头):**
- [ ] 逐块编辑/渲染截图比对:字号/行高/padding/list/heading/callout 一致。
- [ ] graph 节点插轻量块(divider/task/toggle)渲染正确,不再灰字占位。
- [ ] 二期块在 graph slash 里**不出现**(没黑洞)。
- [ ] note 主编辑器观感无变化。

---

## 6. 开工 checklist
- [ ] 从 `feature/graph-shape-library-rebuild` HEAD 切 `feature/graph-edit-render-consistency`。
- [ ] 通读本 prompt + postC §3 交接 + pm-host.css 规格 + blocks/* 常量。
- [ ] 先出**逐 block「编辑 css 规格 vs 渲染常量」对照差异清单**(这是专项的工作底图)+ EC1 同源机制方案,总指挥审过再动 E2。
- [ ] **不合 main**;完成交:专项完成报告 + 真机截图比对结果 + 二期(table/media/column)backlog 清单。

---

## 7. 交付物
- E1~E5 逐 commit 自包含绿
- 完成报告 `docs/RefactorV2/stages/graph-edit-render-consistency-completion.md`(逐块对照 + 共享规格真源 + EC1 决策 + R-shared 确认)
- 二期专项 backlog(table/image/media/column 渲染态 + 对应 slash 放开)
- 偏差走"记录待总指挥确认"
