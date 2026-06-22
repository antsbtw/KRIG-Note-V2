# 编辑↔渲染一致性专项 — 工作底图(逐块对照差异清单 + EC1 同源机制方案)

> 执行人:实施对话 · 待 **总指挥审批后再动 E2** · 日期:2026-06-22
> 分支:`feature/graph-edit-render-consistency`(从 `feature/graph-shape-library-rebuild` HEAD 切)
> 对应 prompt:[2026-06-22-graph-edit-render-consistency-prompt.md](../../tasks/2026-06-22-graph-edit-render-consistency-prompt.md) §6 第 3 条「先出对照差异清单 + EC1 方案,总指挥审过再动 E2」

---

## 0. 勘探结论先行(纠正/细化了 prompt 的几条前提)

勘探拿真实代码核实,有 **3 条重要发现**修正了 prompt 的预设,直接影响 E1 工作量:

### 发现 A:graph 编辑态 viewId = `graph-canvas-view`,slash 是**每 view 注册**的,不是全局放开
- canvas 双击编辑走 `GraphCanvasView.tsx:278` `enterEdit({ viewId: 'graph-canvas-view' })`。
- slash 菜单内容在 [graph-canvas-view/index.ts:77-80](../../../src/views/graph-canvas-view/index.ts) 注册:
  ```ts
  slashRegistry.register([
    ...ui.slashMenu.createTurnIntoItems(VIEW),   // 12 项 turn-into
    ui.slashMenu.createMathBlockItem(VIEW),       // math block
  ]);
  ```
- **canvas 根本没注册 NoteView 的 7 业务插入项**(image/table/audio/video/tweet/file/external-ref)。
  → **二期块(table/image/media/column)早就不在 canvas slash 里**。prompt §1「二期块在 graph slash 先关」**这一闸已天然关着**,不用动。

### 发现 B:`createTurnIntoItems` 返回扁平 `SlashItem[]`,可在注册处直接 `.filter()`
- 不需要像「给 driver 加 blockWhitelist toggle」那种重改造(那是初版勘探的过度方案)。
- **E1 的 slash 闸 = 在 [graph-canvas-view/index.ts](../../../src/views/graph-canvas-view/index.ts) 注册处 filter 掉本期渲染态不支持的 item**,零 driver 改动、零跨 capability 影响(只动 graph view 自己的注册)。

### 发现 C:inputRules 是 schema 驱动、全局常开,但它**只产本期范围内的块**
- [build-input-rules.ts](../../../src/drivers/text-editing-driver/plugins/build-input-rules.ts) 产出的块/标记仅:
  heading(`#`~`######`)、bold/italic/code/strike marks、bullet/ordered/task list、blockquote(`>`)、horizontalRule(`---`)、codeBlock(```` ``` ````)。
- **这些全在「8 已有 + 4 轻量(divider/task/toggle 渲染补上后)」范围内**。
  → 一旦 E4 把 horizontalRule/taskList/toggle 渲染补齐,**inputRules 无需任何 per-instance 限制**(它产的块渲染态都能渲)。toggle 没有 inputRule(`>` 给了 blockquote);task 有 `[]`/`[x]`。
- 结论:**E1 不必动 inputRules**(避免改 driver 全局插件,守红线 R-shared)。把功夫花在「slash 白名单 + 补轻量块渲染」即可达成「编辑能插 ⊆ 渲染能渲」。

> ⚠️ 唯一例外:若**不**补某轻量块渲染(如 mermaid,见 §4),则它对应的 slash item 不能放、inputRule 也不能产。mermaid 无 inputRule,只需 slash 不放 = 自动满足。

---

## 1. 渲染态当前覆盖 vs note 全套块(覆盖矩阵)

note 全套 block(schema `ENABLED_BLOCKS`,[enabled-blocks.ts](../../../src/drivers/text-editing-driver/enabled-blocks.ts)):

| block | 渲染态(atomsToSvg dispatch) | canvas slash 现状 | inputRules 现状 | 本期归类 |
|---|---|---|---|---|
| paragraph | ✅ renderTextBlock | ✅ | — | **一期对齐** |
| heading(h1-h6)| ✅ renderTextBlock(level 倍率)| ✅ h1/h2/h3 | ✅ `#`~`######` | **一期对齐** |
| bulletList | ✅ renderList | ✅ | ✅ `-`/`*` | **一期对齐** |
| orderedList | ✅ renderList | ✅ | ✅ `1.` | **一期对齐** |
| blockquote | ✅ renderBlockquote | ✅ Quote | ✅ `>` | **一期对齐** |
| callout | ✅ renderCallout(+图标纹理)| ✅ | — | **一期对齐** |
| codeBlock | ✅ renderCodeBlock | ✅ | ✅ ```` ``` ```` | **一期对齐** |
| mathBlock | ✅ renderMathBlock | ✅ | — | **一期对齐** |
| mathInline | ✅ renderMathInline | (floating toolbar)| — | **一期对齐** |
| **horizontalRule** | ❌ → 占位 `---` | ✅ Divider | ✅ `---` | **一期补渲染(E4)** |
| **taskList / taskItem** | ❌ → 占位 `[Tasks]` | ✅ Task | ✅ `[]`/`[x]` | **一期补渲染(E4)** |
| **toggleList** | ❌ → 占位 `[Toggle]` | ✅ Toggle | — | **一期补渲染(E4)** |
| mermaid(codeBlock+lang)| ❌(renderMermaidDiagram 在 driver 层)| ❌ 未注册 | — | **见 §4:本期暂不补 / 待决** |
| table / row / cell | ❌ → 占位 `[Table]` | ❌ 未注册 | — | **二期** |
| image | ❌ → 占位 `[Image]` | ❌ 未注册 | — | **二期** |
| audio/video/file | ❌ → 占位 | ❌ 未注册 | — | **二期** |
| columnList / column | ❌ → 占位 `[Columns]` | ❌ 未注册 | — | **二期** |
| tweet/htmlBlock/mathVisual/externalRef/noteLink| ❌ → 占位 | ❌ 未注册 | — | **二期/范围外** |

**「编辑能插 ⊆ 渲染能渲」不变量当前破口**(canvas 能插但渲不出):
`horizontalRule` / `taskList` / `toggle`(slash + inputRules 都能产,渲染态降级占位)。
→ E4 补这 3 个渲染器后破口消除;E1 单测守住对照集。

---

## 2. ⭐ 逐块「编辑态 css 规格 vs 渲染态常量」对照差异清单(专项核心底图)

> 编辑态来源 = [pm-host.css](../../../src/drivers/text-editing-driver/pm-host.css)(实测行号);
> 渲染态来源 = [svg/blocks/*](../../../src/lib/atom-serializers/svg/blocks/) + [svg/index.ts](../../../src/lib/atom-serializers/svg/index.ts)。
> 渲染态默认 `baseFontSize=14`(可被 `instance.text_size` 覆盖)。下表「渲染态」列按默认 14 算。

### 2.1 正文 / 根容器(影响最广)
| 规格 | 编辑态 pm-host.css | 渲染态 | 差异 |
|---|---|---|---|
| 正文字号 | **16px**(`.krig-pm-host` L10)| **14**(`textBlock.BASE_FONT_SIZE` / `index.FONT_SIZE`)| ⚠️ 偏小 |
| 行高 | **1.7**(L11)→ 16×1.7=**27.2px** | `BASE_LINE_HEIGHT=20`@14 ≈ **1.43** | ⚠️ 渲染行距更挤 |
| 正文色 | **#e8eaed**(L8)| **#dddddd**(`TEXT_FILL_DEFAULT`)| 轻微(都浅灰,可对齐 e8eaed)|
| 段落 margin | `1px 0` + padding `3px 2px`(L45-48)| 无段间距(逐块紧贴)| 渲染段间距偏紧 |

### 2.2 Heading(差异最大)
| level | 编辑态(绝对 px)| 渲染态(base×倍率)@base16 | 渲染态@base14 | 差异 |
|---|---|---|---|---|
| h1 | **38px** / 700 | 16×1.6=25.6 | 14×1.6=22.4 | ⚠️ **严重偏小** |
| h2 | **28px** / 600 | 16×1.35=21.6 | 14×1.35=18.9 | ⚠️ 偏小 |
| h3 | **22px** / 600 | 16×1.15=18.4 | 14×1.15=16.1 | ⚠️ 偏小 |
| h4-h6 | (未定义,继承正文)| ×1 | ×1 | 一致(都退正文)|

> heading 是**绝对 px vs 相对倍率**两种模型。决策点(见 §3 EC1 衍生):是否把渲染态 heading 也改成「绝对 px 表」对齐编辑态?还是把编辑态也改成「正文×倍率」?**默认方向:渲染态向编辑态看齐**(R-shared:不动编辑态既有观感)→ 渲染态 heading 改读「绝对 px / 或 base16 下等效倍率 38/16=2.375 等」。需总指挥拍倍率 vs 绝对。

### 2.3 List
| 规格 | 编辑态 | 渲染态 | 差异 |
|---|---|---|---|
| 缩进 | li `padding-left:24px`;嵌套 `ul ul padding-left:24px` | `INDENT_PER_LEVEL=16` | ⚠️ 渲染缩进窄 |
| bullet L1 | 实心圆 **6px** `currentColor` | `BULLET_DIAMETER=4` `#cccccc` | ⚠️ 渲染 bullet 小 |
| bullet L2 | 空心圆 5px(1.5px 描边)| (渲染态不分层,恒实心)| ⚠️ 分层缺失 |
| bullet L3 | 实心方 5px 圆角 1px | (恒实心圆)| ⚠️ 分层缺失 |
| 序号字号 | 继承正文 16,tabular-nums | `NUMBER_FONT_SIZE=14`(硬编码)| ⚠️ 偏小、不随 base 缩放 |
| 序号分层 | L1 `1.` / L2 `a.` / L3 `i.` | (恒阿拉伯数字)| ⚠️ 分层缺失 |
| bullet baselineY | (css 居中 `1.7em/2`)| 硬编码 `childYStart + 14 + 2`(14 不随 base)| ⚠️ bug:大字号 bullet 错位 |

### 2.4 Blockquote
| 规格 | 编辑态 | 渲染态 | 差异 |
|---|---|---|---|
| 左竖条 | `3px solid #555` | `QUOTE_BAR_WIDTH=3` `#7aa2f7` | ⚠️ 颜色不同(编辑灰 / 渲染蓝)|
| padding-left | **16px** | `QUOTE_INDENT=12` | ⚠️ 渲染缩进窄 |
| 上下间距 | margin `0.3em` | `QUOTE_PAD_Y=2` | 近似 |
| 文字色 | **#aaa** + **italic** | 继承正文(非斜体)| ⚠️ 渲染未斜体/未变灰 |

### 2.5 Callout
| 规格 | 编辑态 | 渲染态 | 差异 |
|---|---|---|---|
| 底框背景 | `rgba(255,255,255,0.04)` | `#2a2f3a` | ⚠️ 不同(半透明白 vs 实色蓝灰)|
| 圆角 | **4px** | `CALLOUT_BG_RADIUS=6` | ⚠️ 渲染更圆 |
| padding | **16px**(四向)| `PAD_X=12` / `PAD_Y=10` | ⚠️ 渲染偏小 |
| 图标框 | **24px** | `baseFs×1.5`@14=21(@16=24)| 近似(base16 时正好对齐)|
| 图标-文字间距 | flex `gap:8px` | `CALLOUT_ICON_GAP=6` | ⚠️ 渲染偏小 |
| emoji 字号 | 18px(框 24)= 0.75× | icon-raster `0.75×` | ✅ 已对齐(postC)|
| 上传图圆角 | **22.37% squircle** | (icon-raster 未做 squircle)| ⚠️ 遗留(postC §4)|

### 2.6 CodeBlock
| 规格 | 编辑态 | 渲染态 | 差异 |
|---|---|---|---|
| 字号 | **14px** | `FONT_SIZE=13` | ⚠️ 偏小 |
| 行高 | **1.5**(=21px@14)| `LINE_HEIGHT=18`(≈1.38)| ⚠️ 渲染挤 |
| 背景 | **#2a2a2a** + 边框 `1px #3a3a3a` | `#1e1e1e`(无边框)| ⚠️ 渲染更暗、缺边框 |
| 圆角 | **4px** | `BG_RADIUS=6` | ⚠️ 渲染更圆 |
| padding | `12px 16px`(y x)| `PAD_X=10` / `PAD_Y=10` | ⚠️ 渲染偏小 |
| 文字色 | **#e8eaed** | `#d4d4d4` | 轻微 |
| 字体 | `'SF Mono','Fira Code',monospace` | JetBrains Mono(打包)| 等宽族,可接受 |

### 2.7 inline marks
| mark | 编辑态 | 渲染态 | 差异 |
|---|---|---|---|
| inline code | bg `#2a2a2a` / 字 `#f78c6c` 橙 / 0.9em / 圆角 3px / padding `2px 6px` | bg `CODE_BG_FILL=#333333` / 字色继承(非橙)/ padX 2 | ⚠️ 背景略浅、缺橙字、缺圆角 |
| link | `#8ab4f8` + underline | `#7aa2f7` + underline | ⚠️ 链接蓝色号不同 |
| highlight | (vocab `rgba(255,200,100,.18)`;普通 highlight mark 待确认默认色)| `bgColor ?? 'yellow'` | ⚠️ 默认黄 vs 半透明橙,需对齐普通 highlight 默认 |

### 2.8 Math block
| 规格 | 编辑态 | 渲染态 | 差异 |
|---|---|---|---|
| 尺寸 | MathJax/KaTeX × 容器字号 | MathJax × baseFontSize | 模型一致 |
| 色 | currentColor(继承 #e8eaed)| `#dddddd`(硬编码 2 处)| 轻微 |
| padding | (css)| `PAD_X/Y=4` | 待真机比 |

### 2.9 一期新补块(E4,目标对齐值)
| block | 编辑态规格(目标)|
|---|---|
| horizontalRule | `border-top:1px solid #444`,margin `1.5em 0`,高 1px |
| taskList | checkbox **16px**(`accent #8ab4f8`),gap 8px,item margin `2px 0`,checked 文字 `#9aa0a6` + 删除线 |
| toggleList | arrow 框 **20×27.2**(font16×lh1.7),箭头字号 16,色 #e8eaed,gap 4px,折叠态只显首子 |

---

## 3. EC1 决策点:编辑态 css 怎么与渲染态同源?(专项成败关键,**请总指挥拍**)

**约束(prompt 红线)**:
- css 不能 import ts;渲染态(atom-serializers)**不能反向 import pm-host.css/drivers 运行时**(W5)。
- R-shared:pm-host.css 同时被 **note 主编辑器(NoteView)** 消费 → **改它必须保证 note 主编辑器视觉零回归**。

### 当前事实
- pm-host.css **几乎全是硬编码字面量**(`16px`/`1.7`/`#e8eaed`/`38px`…),**没有现成 CSS 变量体系**。
- 两套真源物理隔离:渲染态在 `src/lib/atom-serializers`(纯 ts,可 import 值);编辑态在 `pm-host.css`(纯 css)。

### 三个候选机制

**方案 EC1-甲(推荐):单一数值表 ts(中性位)为唯一真源 → 渲染态直接 import;编辑态用「构建期生成 CSS 变量」桥接**
- 新建 `src/lib/visual-spec/block-visual-spec.ts`(W5 中性位,纯数据无 three/无 dom):导出 `BLOCK_VISUAL_SPEC = { body:{fontSize:16,lineHeight:1.7,color:'#e8eaed'}, headings:{h1:38,...}, list:{...}, quote:{...}, callout:{...}, code:{...}, marks:{...} }`。
- 渲染态 blocks/*:`import { BLOCK_VISUAL_SPEC }` 替换所有硬编码常量。
- 编辑态:由 spec 生成一份 `:root{ --krig-body-font-size:16px; ... }` CSS(构建期脚本 or 一个小 ts→`<style>` 注入),pm-host.css 把对应硬编码改成 `var(--krig-body-font-size)`。
- **优点**:真正单一真源,改一处两边同步;符合「渲染态向编辑态看齐」(spec 初值 = 编辑态现值 → note 主编辑器视觉零回归)。
- **缺点**:要动 pm-host.css(R-shared 风险面);要建 css var 注入/生成机制(EC1 的实现成本主要在此)。
- **R-shared 守法**:spec 初值**逐条 = pm-host.css 当前值**(16/1.7/#e8eaed/38/28/22…),pm-host.css 改 `var()` 后计算值不变 → note 主编辑器像素级不变(可 grep 消费方 + 真机比对确认)。

**方案 EC1-乙(轻量,低风险):渲染态读 spec(替硬编码);编辑态 css 暂不动,但建「单一数值表」作文档约定 + 单测守一致**
- spec ts 同上,但**只让渲染态消费**;pm-host.css 保持现状(不引 css var),靠**单测断言** spec 各值 = pm-host.css 注释里登记的「权威值」防漂。
- **优点**:完全不碰 pm-host.css → note 主编辑器零风险;改动面最小;先把「渲染态向编辑态看齐」这条主诉求(prompt 重头)落地。
- **缺点**:不是物理单一真源(编辑态改 css 时要手动同步 spec + 改单测);但有单测兜底防漂。
- **适配 prompt**:prompt 主诉求是「渲染态向编辑态看齐、消除处处差」,**乙已达成**;甲的「编辑态也 css var 化」是更彻底但风险更高的加分项。

**方案 EC1-丙(不推荐):构建期从 pm-host.css 抽值生成 ts**
- 反方向(css 为真源,生成 ts 给渲染态)。css 难解析(选择器嵌套、计算值)、脆。否决。

### 实施者建议
**分两步走,先乙后(可选)甲:**
1. **E2 先按 EC1-乙落地**(渲染态读 spec + 单测守值),**零碰 pm-host.css** → 立刻消除「渲染态 vs 编辑态」主差异、零 R-shared 风险、最快见真机效果。
2. **甲作为后续加分项**(若总指挥要「物理单一真源、编辑态也 css var」)再单提一个 commit 动 pm-host.css(独立可回滚,真机比对 note 主编辑器零回归后再合)。

> **请总指挥拍 EC1**:① 直接上甲(物理单一真源,接受动 pm-host.css 风险)? ② 还是先乙(渲染态看齐为主,pm-host.css 不动,单测防漂)、甲列加分项? 实施者倾向 **②先乙**。
> 另需拍 **heading 模型**(§2.2):渲染态 heading 改「绝对 px 表」对齐编辑态 38/28/22(推荐),还是保留倍率仅调系数?

---

## 4. mermaid 取舍(请总指挥裁)
- mermaid 渲染器 `renderMermaidDiagram` 现在 **driver 层**([code-block/mermaid-renderer.ts](../../../src/drivers/text-editing-driver/blocks/code-block/mermaid-renderer.ts)),依赖 mermaid 库(DOM 渲染)。
- 放进 atom-serializers SVG 层会触碰 W5(SVG 层应纯净、可 node 跑)+ 引重依赖。
- canvas slash **现在就没注册 mermaid**(只 turn-into + math)→ 当前无「mermaid 黑洞」。
- **建议**:本期 **mermaid 不补渲染、slash 不放**(维持现状即满足不变量);列入二期/单独评估。prompt 把 mermaid 列 E4「矢量友好」但实际它在 driver 层、非纯矢量,**实施者建议剔出一期 E4**,E4 只做 horizontalRule/taskList/toggle 三个真·矢量友好块。**请总指挥确认剔除 mermaid。**

---

## 5. 据此细化的 E1~E5 执行拆解(待审)

- **E1(slash 闸 + 不变量单测)**:
  - 在 [graph-canvas-view/index.ts](../../../src/views/graph-canvas-view/index.ts) 注册处 `.filter()` turn-into,**白名单 = 渲染态本期支持块集**(8 已有 + E4 三轻量)。当前唯一要点:E4 落地前 divider/task/toggle 暂不放;E4 落地同 commit 或后续放开(顺序见下)。
  - 新增不变量单测 `tests/.../graph-canvas-slash-render-coverage.test.ts`:断言 canvas slash 注册的 turn-into item 集合 ⊆ atomsToSvg dispatch 支持块集合。防回归再漂。
  - **不动 inputRules**(发现 C:它只产范围内块)。
- **E2(共享 spec 真源,按 EC1-乙)**:建 `block-visual-spec.ts`;渲染态 blocks/* 替硬编码;单测守 spec 值 = 编辑态权威值。
- **E3(逐块对齐已有 8 块)**:按 §2 差异逐条把渲染态对齐编辑态(字号 14→16、行高、heading px、list bullet/缩进/序号、quote 色+斜体+缩进、callout 背景+padding+gap、code 字号+背景+边框+圆角、marks link 色/inline code 橙字)。每块真机截图比对。
- **E4(补三轻量块渲染)**:horizontalRule / taskList / toggle 渲染器接 svg/index dispatch + 读 spec;slash 白名单同步放开(与 E1 配套)。
- **E5(验收 + 真机截图比对 + 完成报告 + 二期 backlog)**。

每 commit 自包含绿:tsc 0 / eslint 新增 0 / 屏障 0 / 单测绿;W5 守住。

---

## 6. 总指挥拍板(2026-06-22,动 E2 前已定)

| 决策 | 拍板 |
|---|---|
| **EC1 机制** | **方案乙**。`spec.ts` 唯一真源(初值照抄 note/pm-host.css 现值),**只让 graph 渲染态读它看齐 note**;**pm-host.css(note 消费)一个字不改**;单测守 spec 值==pm-host.css 权威值防漂。明确否决甲(甲要动 pm-host.css,违反「不改 note」)。 |
| **heading 模型** | **绝对 px**:h1=38/h2=28/h3=22 入 spec,渲染态 heading 字号 = px × (baseFontSize/16) 保留画板 text_size 缩放语义。 |
| **mermaid** | **本期 E4 剔除**。E4 只做真·矢量友好三块:horizontalRule / taskList / toggleList。mermaid 维持现状(slash 不放/渲染不补)→ 不变量天然满足;列二期 backlog。 |
| **对齐方向** | **单向**:只让 graph **渲染态**向 note 看齐。graph **编辑态**本就用 note 同源 PM+pm-host.css,无需改;note 主编辑器零碰。 |

> 总指挥关键澄清:note 是成熟权威方,**只能让 graph 适应 note,不能反向改 note**。注意「graph 编辑态」(双击浮层=已与 note 同源)≠「graph 渲染态」(独立 atomsToSvg=差异源头);专项真正动的是后者。
