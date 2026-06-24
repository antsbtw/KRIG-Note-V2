# L5-G6c 阶段 B 完成报告 — SVG 链路 + 拖动点 handles UI

> 执行人:实施对话 · 验收人:总指挥 · 日期:2026-06-22
> 分支:`feature/graph-shape-library-rebuild`(阶段 A 之上;**不合 main**)
> 权威:[L5G6c §3.1 SVG / §3.5 handles](./L5G6c-shape-library-nocode-design.md) · [phaseB-prompt](../../tasks/2026-06-22-graph-shape-rebuild-phaseB-prompt.md) · [phaseB 拆解+决策](../../tasks/2026-06-22-graph-shape-rebuild-phaseB-breakdown.md)
> 状态:**✅ 总指挥代码层验收通过(2026-06-22,见 §9)+ 用户真机留待(箭头不变形 / SVG 拖入 / 双击文字层)**

---

## 9. 总指挥验收结论(2026-06-22,拿真实代码逐条核,非采信自述)

**✅ 阶段 B 代码层验收通过,正式认可完成。**

| 核验项 | 方法 | 结论 |
|---|---|---|
| **核心诉求:箭头不变形** | 读 px-ratio 单测断言原文 + 跑 | ✅ 真断言:px 箭头 `hl 恒定 30`(w 拉大不变)、箭身 `w-hl` 变长(370>小);**反证** ratio 箭头 `hlLarge/hlSmall≈w 比`(等比=变形)锁住语义。非空验。 |
| **B2.2 反算逻辑** | 读 `reverseParamFromDrag` | ✅ 数值微分求灵敏度(`(posAt(p0+ε)-posAt(p0-ε))/2ε`)+ `axisDelta/sensitivity`,夹 min/max,灵敏度≈0 fail-safe。通用正确(不假设线性/不需符号反演),px/ratio 自然各归各。 |
| **B1 SVG fail loud** | 读 svg-to-shapedef | ✅ 不支持元素(gradient/filter/image/text/use/mask/clippath…)→ warn+null,不静默吞。 |
| **W5 边界** | grep 6 处 shape-library import 逐个核 | ✅ 全 `import type {`(多行);canvas-rendering 运行时走 requireCapabilityApi,零运行时 import。实施者自述属实。 |
| **质量门** | 亲跑 | ✅ tsc 0;单测 452 绿(含 A 回归);8 红=`bulk-delete-perf-verify`(pre-existing rocksdb,与本刀无关)。 |
| **probe 污染 Picker** | find definitions | ⛔→✅ **已裁决并代办**:probe 在 `definitions/basic/` 会被 bootstrap 扫进用户 Picker。总指挥 `git mv` 移到 `shapes/__fixtures__/`(单测 path.resolve 直读、不靠 bootstrap,同步改路径后 33 单测仍绿);`definitions/` 现仅 `.gitkeep`,Picker 干净。 |

**裁决:probe 处置 = 移出 definitions 到 `__fixtures__`(总指挥代办,非保留进 Picker / 非删——保作回归 fixture)。**

**欠条兑现 / 顺延确认**:
- ✅ **M3 欠条(阶段 A)代码层已兑现**:probe shape 可拖入 + 双击编辑,文字层路径打通。**真机视觉**(SVG 拖入渲染 / 双击文字落 textBox / 箭头拖点不变形)→ 用户 npm start 实测(总指挥环境无 GUI)。
- ✅ 顺带修了 A2 遗留(Host setInstanceLookup 漏传 doc → 文字节点 handle 判定失效),B2.1 补上——认可。
- 诊断 log 改数值契约单测:无 GUI 环境合理替代,真机坐标留用户。

**裁决:阶段 B 通过。** 准予起草阶段 C(分类骨架 + 首批真 shape + substance 重建)prompt。**仍不合 main。**

---

## 0. 总览

阶段 B(无代码两条核心能力)5 commit + 1 fixture commit,逐 commit 自包含绿。5 决策点(SVG1/PROBE/B2.3/HV1/HV2)总指挥拍定后落地。

| commit | 子段 | 要点 |
|---|---|---|
| `211f1349` | B1.1 svg-to-shapedef 导入器 | DOMParser 提取 + d 归一化(H/V/S/T/相对→M/L/C/Q/A/Z)+ fail loud |
| `9885d9fd` | B1.2 evaluate svg kind | svgPath 缩放到节点尺寸 → pathToThree 复用;NodeRenderer 删 A 跳过点 |
| `ae738d77` | B1.3 bootstrap 扫 .svg | 运行期 glob `?raw` + 文件名约定;probe .svg |
| `5f78493b` | B2.1 param 拖点求值+绘制 | evaluateHandles + HandlesOverlay 黄方点动态 list + paramHitTest |
| `37832355` | B2.2 param 拖动落地 | reverseParamFromDrag 数值灵敏度反算 + InteractionController 拖动生命周期 |
| `339fcba1` | B2 probe fixture + 验收 | __b_probe_arrow.json(headLenPx px handle)端到端不变形 |

**全量自检(HEAD):** tsc `0` · eslint(shape-library + canvas-rendering 全触碰目录)`0` · 单测 `89/89 绿`(含 A 回归)· W5 屏障(canvas-rendering 0 运行时 import shape-library,全走 requireCapabilityApi)守住。

---

## 1. 决策落地(总指挥 2026-06-22 拍定)
- **SVG1 = (b) 导入时归一化** ✅:`normalizePathD` 在 svg-to-shapedef 把 H/V→L、S→C(反射)、T→Q(反射)、相对→绝对、逗号/粘连→空格分隔;渲染层 `parseSvgPathD`(只认 M/L/A/Q/C/Z 空格分隔)不动。
- **PROBE = (a) 借 basic** ✅:`__b_probe_svg.svg` + `__b_probe_arrow.json` 落 `definitions/basic/`,Picker 直接可见;**验收后移 `__fixtures__` 或删(遗留,见 §3)**。
- **B2.3 = 降级 backlog** ✅:本阶段只做拖点(B2.1/B2.2);浮条「形状参数」section 留阶段 C。
- **HV1 = 单轴** ✅ · **HV2 = 黄方点** ✅(PlaneGeometry 方块 + 黄填蓝边,区别 resize 白圆 / rotate 绿圆)。

---

## 2. 逐子段

### B1.1 — svg-to-shapedef(`211f1349`)
- `parseSvgToShapeDef(svg, meta)`:DOMParser 取 `<path d>` 多 path 合并、读 viewBox(无则 bbox 估)、自动 magnets(N/S/E/W)、textBox 缺省整框;sidecar 覆盖(SV1=b)。
- `normalizePathD`:任意 d → 空格分隔绝对 M/L/A/Q/C/Z 子集(SVG1=b)。
- fail loud:渐变/位图/`<image>`/`<text>`/滤镜/无 path/不支持命令 → warn + null;不支持元素扫全 tagName 小写比对(XML 保留驼峰、querySelector 大小写敏感的坑)。
- W5:shape-library 内,0 import three(DOMParser 是 web API)。
- 验收:`shape-library-svg-import.test.ts` 15 例(d 归一化 8 + 导入器 7,jsdom 环境)。

### B1.2 — evaluate svg kind(`9885d9fd`)
- `evaluateShape` svg 分支 → `evaluateSvg`:svgPath(viewBox 空间)按 target/viewBox 缩放(`scaleSvgPathD`)→ `EvaluatedPath`;magnets 归一化×尺寸。
- NodeRenderer:删 A 留的 svg fail-loud 跳过,svg 与 parametric 同走 evaluate→pathToThree。
- 验收:svg-import.test.ts +2 例(缩放/viewBox 退化 null),共 17。

### B1.3 — bootstrap 扫 .svg(`ae738d77`)
- bootstrap 扩 `import.meta.glob('./definitions/**/*.svg', {query:'?raw',import:'default',eager})` → `parseSvgToShapeDef`(文件名约定 `<category>/<name>.svg`)→ register;category 校验已知集,未知 fail loud 跳过。
- probe `__b_probe_svg.svg`(五角星,含 H 命令验归一化)。
- 验收:svg-import.test.ts +1 端到端(读真 probe.svg → 解析 H 归一化 + evaluate),共 18。

### B2.1 — param 拖点求值+绘制(`5f78493b`)
- `evaluateHandles(shape, ctx)` → `EvaluatedHandle[]`(shape-local px);from 公式求值沿 axis,cross-axis 取中心;挂 `ShapeLibraryApi.shapes.evaluateHandles`。
- HandlesOverlay:`setParamHandleProvider`(Host 注入,走 api 求值)+ 动态黄方点 mesh 池 + `layoutParamHandles`(local→bbox 中心相对屏幕像素,Y 与几何 group 一致)+ `paramHitTest`。
- **顺带修 A2 遗留**:Host `setInstanceLookup` 原只传 `size_lock` 漏 `doc`,致 `allowedHandlesFor` 永远 ALL_HANDLES(文字节点错出 8 handle)→ 补传 doc。
- 验收:formula-px-ratio.test.ts +3 例(from 求值 / px 分界恒定 / 空数组),共 9。

### B2.2 — param 拖动落地(`37832355`)
- `reverseParamFromDrag`:数值灵敏度(from 在 param±ε 求导)把 shape-local axis 位移换算回 param 增量,夹 min/max;px(灵敏度≈±1)/ ratio(≈±refDim)自然各归各,无需符号反演;灵敏度≈0 fail safe;挂 `ShapeLibraryApi.shapes.reverseParamFromDrag`。
- InteractionController:`paramDragging` 状态 + handleMouseDown 优先 `paramHitTest` → `startParamDrag`(快照 params/size/rotation,对齐 startResize)→ `applyParamDrag`(world 去 rotation → shape-local → axis 分量 → 反算 → 就地改 inst.params + nodeRenderer.update)→ mouseup 清 + onInstancesChange(undo 对齐)。
- 验收:formula-px-ratio.test.ts +4 例(px sensitivity=-1 / 夹 min-max / ratio≈w / handle 不存在 null),共 13。

### B2 probe fixture + 验收(`339fcba1`)
- `__b_probe_arrow.json`:parametric 箭头,headLenPx px-unit + handle(from=x1=w-headLenPx)。
- 验收:formula-px-ratio.test.ts +2 端到端(读真 def → evaluate 可渲染 d + evaluateHandles + **拉长 w 箭头三角 headLenPx 恒定不变形**),共 15。

---

## 3. 偏差 / 遗留(待总指挥确认)

1. **【遗留】probe fixture 暂留 `definitions/basic/`**:`__b_probe_svg.svg` + `__b_probe_arrow.json` 验机制用,当前进 Picker basic 分类(PROBE=a)。prompt §7 说验收后移 `__fixtures__` 或删 —— **建议保留作回归 fixture**(单测已引 `__b_probe_arrow.json`),但**移出 `definitions/` 避免污染 Picker**:挪到 `shapes/__fixtures__/`(单测改读新路径)。**请总指挥拍:保留进 Picker / 移 __fixtures__ / 删?** 暂留 basic 不阻塞,但会出现在用户 Picker。

2. **【M3 欠条兑现 — 代码层完成,真机留用户】**:阶段 A 的 M3 欠条(库空无真 shape 可挂 doc → 文字层真机不可验)在阶段 B **代码层已具备兑现条件**:probe shape 可拖入 + 带 doc 双击编辑。文字层渲染单测(A2 已绿)+ probe 端到端(B 已绿)覆盖数据链;**真机视觉(双击打字文字落 textBox / SVG 拖入渲染 / 箭头拖点不变形)需用户 `npm start` 实测** —— 总指挥环境无 GUI,留用户最终验收。

3. **【偏差待确认】别猜坐标的诊断 log**:prompt §3 红线 4 要求 handle 位置求值 + 拖动反算「加临时诊断 log 实测后删」。因总指挥环境无 GUI,改为**离线单测固化坐标契约**(evaluateHandles 位置 / reverseParamFromDrag 反算 / 真 probe def 不变形,均纯函数 node 可测,数值精确断言);真机坐标实测随 §2 M3 留用户。**这是无 GUI 环境的必然替代,数值契约比 log 更强。**

4. **【环境】`bulk-delete-perf-verify.test.ts`**:沿阶段 A,pre-existing 真 rocksdb sidecar 环境 flake,与本刀无关(未跑入本阶段相关套件)。

---

## 4. 自检输出(HEAD)

```
tsc --noEmit            → exit 0
eslint(shape-library + canvas-rendering 全目录)→ exit 0
W5 屏障:canvas-rendering 0 运行时 import shape-library(grep 仅 import type;
         evaluateHandles/reverseParamFromDrag 走 requireCapabilityApi)
vitest(B + A 回归)→ 89/89 绿
  · shape-library-svg-import.test.ts        18(B1.1/B1.2/B1.3)
  · shape-library-formula-px-ratio.test.ts  15(A4 + B2.1/B2.2/B2 验收)
  · shape-library-text-unify.test.ts         4(A2 回归)
  · migration-1.6.0-graph-doc-inline.test.ts 4(A3 回归)
  · 其余既有回归 绿
```

---

## 5. 阶段 B 末态 + 阶段 C 交接

**当前态:** 无代码库两条核心能力端到端通 —— ① 丢 .svg → 解析 → Picker → 拖入渲染(svg kind 复用 pathToThree);② 带 handle 的 parametric shape → 黄方点拖点 → px/ratio 反算 → 箭头不变形。库仍基本空(只 2 个 probe fixture)。

**阶段 C 接力(分类骨架 + 首批真 shape + substance 重建):**
- 建 basic/geometry 目录 + 其余分类空目录;Basic 填矩形/文字框/多边形,箭头用 px handle(probe 转正)。
- **B2.3 backlog**:浮条「形状参数」section(registry hasParams 派生)。
- **probe fixture 处置**(§3 #1):转正 or 移 __fixtures__ or 删。
- **M3 / B 真机验收**(§3 #2):用户 npm start 实测文字层 + SVG 拖入 + 箭头拖点不变形。
- substance def 对齐/重建(A5 遗留:frame/label 悬空)。
