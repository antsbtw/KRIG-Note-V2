# L5-G6c 阶段 C 后真机修复批 + 编辑↔渲染一致性专项交接

> 执行人:实施对话 · 验收人:总指挥 + 用户真机 · 日期:2026-06-22
> 分支:`feature/graph-shape-library-rebuild`(A/B/C 之上;**不合 main**)
> 状态:**本批真机修复收口,待验收;编辑态↔渲染态视觉一致性另立专项(见 §3)**

---

## 0. 背景

阶段 C 主线收口后用户真机暴露一串 bug(callout 文字丢失 / 双击不能编辑 / 浮条遮挡 / 重影 / 浮条丢 section / 图标缺失 / 图标大小不一致)。本批逐个真机定位修复(每个都「先看真实数据 / 加诊断 log 实测后删」)。修到「图标大小不一致」时判定:**编辑态(PM NodeView)↔ 渲染态(atomsToSvg→SVGLoader mesh)的视觉一致性是系统性差异,零散修不如统一梳理 → 另立专项**。本批先收口。

---

## 1. 本批提交(9 个,逐个 tsc 0 / eslint 0 / 单测绿)

| commit | 修复 |
|---|---|
| `e69edc91` | Picker 分类收敛为 Basic + Geometry(对齐 Freeform,arrow/line 并进 Basic 混排、substance 不进 Picker;纯展示层,def.category 不动护住 line 渲染) |
| `b95fe306` | **bug1** atomsToSvg 渲 callout/blockquote 子内容(原降级 `[Quote]`/`[Callout]` 丢内容 → 递归子块 + 装饰) |
| `4245b420` | **bug2** 双击几何 shape 起空 doc 进编辑(原 `inst.doc===undefined` 硬拦;诊断 log 坐实后改惰性起 doc;line 不可编辑) |
| `2354dd11` | bug2 续:几何 shape 编辑浮层**透明**(不遮几何)+ 挂载**自动聚焦**(否则打不了字) |
| `26d8a515` | 进编辑**隐藏渲染态文字层**,消除与透明浮层的文字重影 |
| `8068ee87` | 几何 shape 单击出 **fill/line/text 三 section**(对齐 Freeform,不再因带 doc 判 'text' 类丢 line/fill;双击才进编辑) |
| `4c13b279` | callout 图标渲不出 → 临时填充矢量灯泡(后被 `44dbc5e9` 纹理路取代) |
| `44dbc5e9` | callout 图标**忠实还原** emoji/lucide/上传图 — 新建「图标→栅格 canvas→THREE 纹理 quad」渲染路(icon-raster.ts) |
| `36ce5b14` | callout 图标**尺寸对齐编辑态**(框 = baseFontSize×1.5 / emoji glyph 0.75×框,随字号缩放) |

**全量自检(HEAD):** tsc `0` · eslint(本批触碰目录)`0` · 单测 `115/115 绿`(`tests/lib/` + `tests/capabilities/`)· 工作树干净。

---

## 2. 本批新增能力 / 关键架构

- **callout/blockquote SVG 渲染**(`blocks/quoteCallout.ts`):递归子块 + 左竖条 / 圆角底框;callout 图标走 `IconRect` 不在 SVG 画(渲染链 SVGLoader 渲不出 emoji/位图/stroke)。
- **图标纹理路**(新子系统):`atomsToSvgWithLinks` 增 `icons: IconRect[]` 输出(同 links bbox 套路)→ `icon-raster.ts` 把 emoji(canvas fillText)/lucide(renderToStaticMarkup SVG→Image)/上传图(fetch media://→ImageBitmap)栅格成 canvas → `TextRenderer` 贴 `CanvasTexture` quad(mesh.scale.y=-1 抵消 group Y 翻转;disposeGroup 补释放 material.map)。
- **画板编辑交互对齐 Freeform**:单击 shape = 选中(fill/line/text 浮条);双击 = 进文字编辑(几何 shape 惰性起 doc、透明浮层、自动聚焦、隐藏底层文字防重影);line 不可编辑。
- **Picker 两分类**:`displayBucket` 展示层映射(geometry→Geometry,其余→Basic),def.category 不动(护 line 渲染)。

---

## 3. ⭐ 后续专项:编辑态 ↔ 渲染态视觉一致性

**问题本质:** 画板节点有两套渲染:
- **编辑态** = text-editing PM `NodeView`(真 DOM + pm-host.css,所见即所得)
- **渲染态** = `atomsToSvg` → `SVGLoader` → THREE mesh(节点平时显示的)

两套独立实现同一份 doc,**视觉规格(字号 / 行高 / 图标尺寸 / 各 block 间距 / 颜色 / padding)各自硬编码,没有共享真源 → 处处会有差异**。本批已对齐的(callout 图标尺寸)只是冰山一角。

**已知/预期的差异点(专项要系统过一遍):**
1. **默认字号**:渲染态 `instance.text_size` 缺省 14;编辑态 note 正文 ~16 → 文字整体偏小。
2. **callout/blockquote**:padding / 竖条粗细 / 底框圆角 / 图标-文字间距 两边各定。
3. **list**:bullet 大小 / 缩进 / 序号字号。
4. **heading / 行高 / 段间距**。
5. **link / code / 高亮** 等 inline 视觉。
6. callout 图标当前栅格比例已对齐,但 lucide 描边色 / 上传图圆角(编辑器 22.37% squircle)未对齐。

**专项建议做法:**
- 先出「编辑态 pm-host.css 规格 vs 渲染态 atomsToSvg 常量」**对照差异清单**(逐 block);
- 抽**共享视觉规格常量**(字号/行高/padding/图标比),两套渲染同源消费,从根上消除「各定各的」;
- 每条差异真机比对编辑/渲染截图验收(对齐本批纪律)。

**交接锚点(渲染态规格散落处):**
- `src/lib/atom-serializers/svg/blocks/*`(textBlock/list/codeBlock/mathBlock/quoteCallout 各自常量)
- `src/capabilities/canvas-rendering/scene/icon-raster.ts`(图标栅格比例)
- 编辑态真源:`src/drivers/text-editing-driver/pm-host.css` + 各 block NodeView

---

## 4. 遗留(随专项或单独处理)
- **默认字号 14 vs 16**:渲染态默认字号未对齐 note 正文(本批没动,属一致性专项第 1 条)。
- **lucide 描边色 / 上传图 squircle 圆角**:图标纹理路已通,但这两个视觉细节未对齐编辑器。
- **`bulk-delete-perf-verify.test.ts`**:pre-existing 真 rocksdb 环境 flake,与本批无关(沿 A/B/C)。

---

## 5. 验收

- [x] 总指挥代码层:本批 9 commit,tsc 0 / eslint 新增 0 / 115 单测绿 / W5 守住 / 屏障 0。
- [ ] 用户真机(本批重头):callout 文字不丢 + 图标忠实(emoji/lucide/上传)+ 图标大小一致;双击几何 shape 透明编辑能打字无重影;单击出 fill/line/text 浮条;Picker 两分类。
- [ ] 编辑↔渲染一致性专项:立项后系统对齐(本批不覆盖)。

---

## 6. 总指挥验收结论(2026-06-22,拿真实代码逐条核,非采信自述)

**✅ 阶段 C 本体 + postC 真机修复批,代码层合并验收通过。**(C 完成报告先前未补总指挥结论,本结论一并涵盖 C 主线达成 + 本批 9 commit。)

| 核验项 | 方法 | 结论 |
|---|---|---|
| **bug1 callout/blockquote 文字丢失** | 读 quoteCallout.ts + 单测 | ✅ 原落 renderUnknownAtom 降级 `[Quote]` 丢子内容;新模块递归渲子块(renderChild 注入避循环 import,嵌 math/list 不丢)+81 测。 |
| **bug2 诊断 log 删净** | grep canvas-rendering/serializers | ✅ 0 残留临时 `console.log/debug`(唯一命中是 charter §5 自我诊断常驻,非临时)。守"别猜+定位后删"铁律。 |
| **callout 图标纹理 quad(新渲染路,最易泄漏)** | 读 icon-raster + disposeGroup | ✅ 缓存层存 HTMLCanvasElement(LRU 上限不泄漏);**disposeGroup 专门加 `material.map?.dispose()`**(注释明写"material.dispose 不释放纹理,CanvasTexture 须单独 dispose")——主动堵了 three 纹理泄漏坑。 |
| **W5 边界** | grep atom-serializers import three | ✅ atom-serializers(SVG 层)0 import three;icon-raster 在 canvas-rendering(three 合法位)。 |
| **质量门** | 亲跑 | ✅ tsc 0;单测 477 绿(全量;含本批相关);8 红=`bulk-delete-perf-verify` pre-existing rocksdb 环境。工作树干净。 |
| **专项边界判断** | 读 §3 交接 | ✅ **认可主动止损**:把"两套渲染(编辑 PM NodeView / 渲染 atomsToSvg)视觉规格各自硬编码、无共享真源"识别为**系统性根因**,另立专项是对的——零散修永远修不完。**没把本批该修的功能性 bug 推走**(bug1/bug2/浮条/图标渲不出都在本批修了),推走的是"视觉规格统一(字号/行高/padding/squircle)"这层架构动作。 |

**裁决:**
1. **阶段 C + postC 批代码层通过。** 整条 Graph shape 库重建线(A 清空+范式 / B SVG+拖点 / C 分类+首批+substance / postC 真机修复)**主线收口**。
2. **✅ 准予「编辑↔渲染一致性」立项为独立专项**(§3 边界认可:对照差异清单 → 抽共享视觉规格常量两套同源消费 → 逐条真机截图比对)。正确的架构方向,不该塞进 shape 重建线。
3. **真机验收留用户**(本批重头在真机)。总指挥环境无 GUI。
4. **仍不合 main**:待编辑↔渲染专项 + 整条线真机稳后再议(沿 A/B/C 节奏)。
