# 编辑态↔渲染态视觉一致性专项(一期)— 完成报告

> 执行人:实施对话 · 验收人:**总指挥代码层 + 用户真机截图比对** · 日期:2026-06-22
> 分支:`feature/graph-edit-render-consistency`(从 `feature/graph-shape-library-rebuild` HEAD 切;**不合 main**)
> 对应 prompt:[2026-06-22-graph-edit-render-consistency-prompt.md](../../tasks/2026-06-22-graph-edit-render-consistency-prompt.md)
> 工作底图:[graph-edit-render-consistency-basemap.md](graph-edit-render-consistency-basemap.md)(逐块差异 + EC1 决策)

---

## 0. 一句话总结

graph 画板节点**渲染态**(atomsToSvg→mesh)各 block 视觉常量曾各自硬编码、与 note 编辑态处处差。
本专项抽**共享视觉规格单一真源** `block-visual-spec.ts`(初值 = note/pm-host.css 现值),
让**渲染态读它向 note 看齐**;**note 主编辑器一字未动**(R-shared);并补三轻量块渲染器
+ 收 slash 闸守「编辑能插 ⊆ 渲染能渲」不变量。**代码层全绿,真机截图比对待用户。**

---

## 1. 总指挥拍板的 4 决策(动手前已定,见 basemap §6)

| 决策 | 拍板 | 落地 |
|---|---|---|
| EC1 同源机制 | **方案乙**:spec.ts 唯一真源,渲染态读它看齐 note;**pm-host.css 不动**;单测守值防漂 | ✅ E2 |
| heading 模型 | **绝对 px**(h1=38/h2=28/h3=22 × base/16) | ✅ E3a |
| mermaid | **本期剔除**(只做 hr/task/toggle) | ✅ E4(mermaid 列二期) |
| 对齐方向 | **单向**:只让 graph 渲染态向 note 看齐,不碰 note | ✅ R-shared 确认零碰 |

---

## 2. 逐 commit(6 个,各自包含绿)

| commit | 阶段 | 内容 |
|---|---|---|
| `0e56f3cf` | **E1** | slash/turn-into 渲染态闸 + 编辑⊆渲染不变量单测。RENDERABLE_ATOM_TYPES 单一真源(svg/index.ts)+ slash-render-gate filter(graph view 注册处)。**不动 inputRules / driver**。 |
| `2db5ec64` | **E2** | 建 `block-visual-spec.ts` 共享真源(中性位纯数据,W5 安全)+ 防漂单测(spec 值==pm-host.css 权威值)。 |
| `83f0bf08` | **E3a** | textBlock 接入:正文 14→16、行高→×1.7、heading 绝对 px、色 #e8eaed、link #8ab4f8、inline code 橙+圆角。 |
| `fc475a52` | **E3b** | list 接入:缩进 24、bullet 6、序号 16、色 #e8eaed、修 baselineY 硬编码 14(随 base 缩放)。 |
| `4cf91a66` | **E3c** | quote/callout 接入:quote 竖条 #555/缩进 16/引用灰文字;callout rgba 背景/圆角 4/pad 16/gap 8。 |
| `23d6aa82` | **E3d** | codeBlock 接入:14/1.5/#2a2a2a/+1px 边框/圆角 4/pad 12·16/#e8eaed。 |
| `58a6058c` | **E3e** | 默认基准字号 14→16(atomsToSvg + NodeRenderer 两处统一从 spec 取)+ math 默认色 #e8eaed。 |
| `405b212f` | **E4** | 补 horizontalRule/taskList/toggleList 渲染器 + dispatch + RENDERABLE 追加(slash 闸自动放开)+ spec 补轻量块规格 + 单测。 |
| `2e7590ff` | **真机修** | highlight 高亮文字色对齐 note(黄/浅底强制黑字 #000)。真机黄方块溯源副产物。 |
| `ba77534d` | **真机修** | **list 渲染态丢整列表 bug**:note schema 是 bulletList>listItem>paragraph(content='listItem+'),renderList 原只认直接 paragraph 子 → 跳过 listItem → 整列表渲空。修为兼容 listItem 包装 + V1 直接 paragraph + 嵌套 list 三形态。 |

> 真机比对中发现并修了两处真 bug(highlight 黑字 / list 丢整块)——非常量调整,逐处单测 + 真机定位(其中黄方块经临时 DOM 诊断证实 = HandlesOverlay PARAM 参数拖点,属 shape handle 非渲染 bug,诊断已删)。

---

## 3. 共享视觉规格真源(架构核心)

**位置**:[src/lib/visual-spec/block-visual-spec.ts](../../../src/lib/visual-spec/block-visual-spec.ts)
- 中性位(`lib` 下),**纯数据,0 import three / 0 import pm-host.css / 0 import drivers 运行时** → W5 安全,atom-serializers / canvas-rendering 均可 import。
- `BLOCK_VISUAL_SPEC`:body / headings / list / quote / callout / code / horizontalRule / taskList / toggle / marks 全套规格。`headingFontSize()` 绝对 px 模型。`BASE_FONT_SIZE=16`。
- **初值逐条 = pm-host.css 现值**(注释标 css 选择器),即 note 权威观感。

**消费方(渲染态,全部替换硬编码)**:
- textBlock / list / quoteCallout / codeBlock / mathBlock / mathInline(svg/blocks/*)
- horizontalRule / taskList / toggleList(svg/blocks/*,E4 新建)
- svg/index.ts 默认字号;canvas-rendering NodeRenderer 兜底字号

**EC1 防漂机制**:[tests/lib/block-visual-spec-vs-pm-host-css.test.ts](../../../tests/lib/block-visual-spec-vs-pm-host-css.test.ts) 从 pm-host.css 抽各选择器值断言 == spec。**将来谁改了 note 的 pm-host.css 却忘同步 spec(graph 渲染态会漂离 note),本测变红**。非物理单一真源(方案甲),但单测兜底——总指挥拍板取此低风险路径。

---

## 4. R-shared 确认(note 主编辑器零回归)✅

`git diff feature/graph-shape-library-rebuild..HEAD --name-only` 全部落在:
**graph 渲染态消费链(atom-serializers/svg + canvas-rendering) + 新共享 spec + graph-canvas-view 注册 + 测试**。

> **pm-host.css / views/note / note-view / driver block node-view 全部零改动**(唯一命中是
> 读 pm-host.css 的防漂测,read-only)。note 正文该什么样还什么样 —— 只让渲染态向编辑态看齐,
> 未反向改编辑态既有观感(prompt R-shared 守住)。

---

## 5. 编辑 ⊆ 渲染 不变量(防黑洞)✅

- **slash 闸**:graph 编辑态 viewId=`graph-canvas-view`,slash 在 [graph-canvas-view/index.ts](../../../src/views/graph-canvas-view/index.ts) 注册处用 `filterSlashItemsToRenderable` 过滤,白名单 = `RENDERABLE_ATOM_TYPES`(数据驱动,E4 追加块即自动放开)。
- **二期块天然不在 canvas slash**:canvas 从不注册 NoteView 7 业务插入(image/table/media/column),无需额外关闸。
- **inputRules 不动**:schema 驱动,只产范围内块(heading/list/quote/hr/task/code),E4 补 hr/task/toggle 渲染后全覆盖。
- **不变量单测**:[graph-canvas-slash-render-coverage.test.ts](../../../tests/views/graph-canvas-slash-render-coverage.test.ts) 断言 canvas 可插 turn-into ⊆ RENDERABLE_ATOM_TYPES + 映射表全覆盖(防新命令静默漏过)。
- **fail loud 兜底**:渲染态遇未知块仍走 renderUnknownAtom warn 占位(非静默)。

---

## 6. 质量门(代码层)

- **tsc**:`0`
- **eslint**(本批触碰 src 文件):`0`
- **单测**:相关全绿。全量 `498 passed`;`8 failed = bulk-delete-perf-verify.test.ts` 是 **pre-existing 真 rocksdb/SurrealDB 环境 flake**(沿 A/B/C,与本批无关,handoff §4 已登记)。
- **W5 屏障**:atom-serializers + visual-spec **0 import three**(grep 实证)。
- **每 commit 自包含绿**。

---

## 7. ⚠️ 待用户真机截图比对(本专项重头,总指挥环境无 GUI)

逐块在画板节点「编辑态(双击浮层)↔ 渲染态(平时显示)」截图比对:

- [ ] **正文**:字号 16、行高 1.7 一致(原渲染态 14 偏小、行距挤)
- [ ] **heading**:h1=38/h2=28/h3=22 一致(原渲染态 base×倍率严重偏小)
- [ ] **list**:缩进 24、bullet 6、序号字号一致;大字号下 bullet 不再错位
- [ ] **blockquote**:竖条灰 #555(非蓝)、缩进 16、引用文字灰
- [ ] **callout**:半透明白底、圆角 4、padding 16、图标-文字 gap 8、图标框随字号
- [ ] **codeBlock**:字号 14、深灰 #2a2a2a + 1px 边框、圆角 4、padding 12·16
- [ ] **inline code**:橙字 #f78c6c + 圆角背景;**link 蓝 #8ab4f8**
- [ ] **math**:默认色 #e8eaed
- [ ] **轻量块新渲染**:插 divider/task/toggle 正确渲染,**不再灰字占位**
- [ ] **无黑洞**:graph slash 里二期块(table/media/column)**不出现**
- [ ] **note 主编辑器观感无变化**(R-shared)

> 真机发现偏差走「记录待总指挥确认」,不擅自再改常量(prompt §5「别猜视觉」)。

---

## 8. 二期专项 backlog(范围外,单列)

### 8.1 二期块渲染态(矢量 mesh 硬骨头)+ 对应 slash 放开
- **table / tableRow / tableCell / tableHeader**:矢量表格(网格线 + cell 内子块);放开 canvas slash table。
- **image**:media:// 取图 → 纹理 quad(类 callout icon-raster 路);圆角/裁剪。
- **audio / video / fileBlock**:占位卡 + 图标(矢量)或纹理;音视频不内联播放,画板用静态卡。
- **columnList / column**:多列布局(按列宽分配 contentWidth 递归)。
- 各自补 svg/index dispatch + RENDERABLE_ATOM_TYPES → slash 闸自动放开;真机比对。

### 8.2 mermaid(单独评估)
- renderMermaidDiagram 现在 driver 层(依赖 mermaid DOM 库,非纯矢量)→ W5 不能进 atom-serializers。
- 若要画板渲 mermaid:走 canvas-rendering 层栅格成纹理 quad(类 callout icon-raster),非 SVG 路。
- canvas slash 现未注册 mermaid → 当前无黑洞;放开前必须先补渲染。

### 8.3 一期 refinement(视觉细节,非「处处差」主因,可随二期或单独清)
- **list bullet 分层**:note L2 空心圆 / L3 实心方;渲染态恒实心圆。ordered note L1 `1.` / L2 `a.` / L3 `i.`;渲染态恒阿拉伯数字。
- **blockquote italic**:note 引用斜体;渲染态已对齐灰色未对齐斜体(注入 per-run italic mark 较侵入)。
- **taskList 删除线**:已完成项 note 有删除线;渲染态已灰色未画删除线(需额外 stroke path)。
- **callout 上传图 squircle 圆角**(22.37%)+ **lucide 描边色**:postC §4 遗留,icon-raster 未做。
- **inline highlight**:✅ 已修(`2e7590ff`,真机发现孤立黄方块触发)——渲染态对齐 note highlight.ts「黄/浅底强制黑字 #000」;默认色 'yellow' 与 note highlight mark 一致(vocab highlight 是另一套半透明橙,不在 graph 节点 doc 范畴)。**遗留**:高亮打在空格上 → 渲染态孤立色块(编辑态亦然,属真实数据非 bug)。

---

## 9. 交付物 checklist(prompt §7)

- [x] E1~E5 逐 commit 自包含绿(6 commit)
- [x] 完成报告(本文件)— 逐块对照(basemap §2)+ 共享规格真源(§3)+ EC1 决策(§1/basemap §3)+ R-shared 确认(§4)
- [x] 二期 backlog(§8)
- [x] 偏差走「记录待总指挥确认」(无擅自大改;mermaid 剔除/refinement 推迟均经总指挥拍/记录)
- [ ] **不合 main**:待真机 + 整条线稳后总指挥另议(沿 A/B/C 节奏)
