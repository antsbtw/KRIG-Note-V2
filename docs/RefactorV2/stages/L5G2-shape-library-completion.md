# L5-G2 shape-library capability 完成报告

> 阶段:L5-G2 — V1 → V2 graph 迁移第 2 段(共 5 段 G1~G5)
> 分支:`feature/L5G2-shape-library`
> 起草日期:2026-05-10
> 设计:[./L5G2-shape-library-design.md](./L5G2-shape-library-design.md) v0.2
> 上游 plan:[../v1-graph-migration-plan.md](../v1-graph-migration-plan.md) v0.2 § 3.2 + § 5 G2
> 业务规格:[../../10-business-design/graph/library/Library.md](../../10-business-design/graph/library/Library.md)

---

## 0. 完成清单

### Commit 1 — design(L5-G2) v0.1([3c007f8](../../../../KRIG-Note-V2#commit/3c007f8))
G2 设计文档 v0.1(265 行):10 个 G2-* 决策点 + EvaluatedPath / EvaluateContext API + 6 项开发态自检清单。

### Commit 2 — fix(L5-G1+G2) P1-A install 列表全链路对齐([ba10e60](../../../../KRIG-Note-V2#commit/ba10e60))
用户审计指出 G2 design v0.1 与上游 plan v0.2 § 6.1 install 口径冲突 → 选 A(对齐 ebook 先例:install 是声明性契约):
- `src/views/graph-canvas-view/index.ts` install: 1 项 → 4 项完整声明
- G1 design v0.2 → v0.3(install 描述 / alive 自检 / 自我诊断 / 完成判据 4 处)
- G1 completion 补 P1-A 修订条目
- G2 design v0.1 → v0.2(§ 6 完成判据 + § 8 风险表)

### Commit 3 — feat(L5-G2) shape-library capability 实施([37faace](../../../../KRIG-Note-V2#commit/37faace))

| 项 | 实际 | 状态 |
|---|---:|---|
| `src/capabilities/shape-library/types.ts`(NEW,V1 types.ts 333 行精简 + EvaluatedPath / EvaluateContext / ShapeLibraryApi) | 298 行 | ✅ |
| `src/capabilities/shape-library/index.ts`(NEW,双导出 + capabilityRegistry.register + side-effect bootstrap + alive 行) | 150 行 | ✅ |
| `src/capabilities/shape-library/DESIGN.md`(NEW,P1-1 严格屏障显式声明) | 113 行 | ✅ |
| `src/capabilities/shape-library/shapes/registry.ts`(NEW,V1 直迁) | 46 行 | ✅ |
| `src/capabilities/shape-library/shapes/definitions/`(22 shape JSON 直迁)| basic 11 / arrow 3 / flowchart 4 / line 3 / text 1 | ✅ |
| `src/capabilities/shape-library/shapes/renderers/parametric.ts`(NEW,V1 renderParametric → evaluateShape,输出 EvaluatedPath) | 110 行 | ✅ |
| `src/capabilities/shape-library/shapes/renderers/formula-eval.ts`(NEW,V1 直迁,纯数学) | 207 行 | ✅ |
| `src/capabilities/shape-library/shapes/renderers/index.ts`(NEW,barrel,0 re-export path-to-three) | 13 行 | ✅ |
| `src/capabilities/shape-library/shapes/bootstrap.ts`(NEW,import.meta.glob) | 31 行 | ✅ |
| `src/capabilities/shape-library/shapes/__smoke__/run.ts`(NEW,V1 直迁,断言形态对齐 EvaluatedPath) | 99 行 | ✅ |
| `src/capabilities/shape-library/substances/registry.ts`(NEW,V1 直迁) | 47 行 | ✅ |
| `src/capabilities/shape-library/substances/definitions/`(5 substance JSON 直迁)| library 2 / family 3 | ✅ |
| `src/capabilities/shape-library/substances/composer.ts`(NEW,空壳 G2-7=B) | 21 行 | ✅ |
| `src/capabilities/shape-library/substances/visual-rules.ts`(NEW,空壳 G2-7=B) | 21 行 | ✅ |
| `src/capabilities/shape-library/substances/bootstrap.ts`(NEW) | 31 行 | ✅ |
| `src/platform/renderer/index.tsx`(改 — import 注册) | +1 行 | ✅ |

**Commit 3 小计:driver ~1115 行 + DESIGN 113 + 27 JSON(估 driver 840 + DESIGN 120,driver +33% 主要在 types.ts 完整 JSDoc + parametric 改写)**

### Commit 4 — fix(L5-G2) P2 修两处 + 文档登记 viewTypeRegistry warn([f2f2c32](../../../../KRIG-Note-V2#commit/f2f2c32))
用户 G2 验收时发现:
- P2-1:`getSnapshot should be cached` warning(graph data-model.ts hydrate selectedIds 兜底引用不一致)→ 改用 `?? DEFAULT_WS_STATE.selectedIds`(对齐 cached 分支)
- P2-2:DevTools `await import('@capabilities/shape-library')` 报 `Failed to resolve module specifier`(path alias 不识别)→ shape-library/index.ts dev-only 分支挂 `window.__krig.shapeLib` 桥 + 启动自动跑 smoke
- 文档登记:G1 design / G1 completion / G2 design 各加"viewTypeRegistry warn 配套出现"完成判据(P1-A 渐进式 install 下的预期 warn)

### Commit 5 — fix(L5-G2) renderer dev-hook 扩展模式([19fecbf](../../../../KRIG-Note-V2#commit/19fecbf))
用户验证时发现 `window.__krig.shapeLib === undefined` — 根因:
- shape-library/index.ts 启动副作用先挂 `window.__krig.shapeLib`
- renderer/index.tsx 后续硬赋值 `window.__krig = { wm, bus }` 抹掉了

修法:renderer 改 `spread` 现有 `__krig` 再追加,保留 capability 早注入的桥(future-proof:任何 capability 都能在自己 import 时挂上)。

### Commit 6 — fix(L5-G2) 顺手修 NoteView + EBookView getSnapshot stable ref([73f9cb6](../../../../KRIG-Note-V2#commit/73f9cb6))
用户冷重启验证后 `getSnapshot should be cached` warning 仍在 — 根因不在 graph(已修),而是 NoteView 和 EBookView 的 data-model.ts 第一次 hydrate 时 `selectedIds: ... ?? new Set<string>()`,与 cached 分支 `?? DEFAULT_WS_STATE.selectedIds` 不一致.

V2 既有 bug(L5-A NoteView / L5-C1 EBookView 起就在),用户 G2 验收时主动暴露.G2 顺手修(用户拍板 A 路径).

修法 3 view 完全统一:
- note / ebook / graph-canvas-view × 2 处兜底全部 `?? DEFAULT_WS_STATE.selectedIds`

---

## 1. 实际改动 vs 设计

### 1.1 完全照设计

- **G2-1 capability id = `shape-library`**:对齐 charter § 1.3 规则 C "通用资源仓库"
- **G2-2 EvaluatedPath 纯数据**(P1-1 严格版屏障核心):types.ts 0 含 `'three-mesh'` / `'composite'` / `THREE.*` 字面量;`evaluate` 返回 `{ d, width, height, magnets, textBox? }` 纯数据
- **G2-3 / G2-4 API 命名 evaluate / evaluateShape**:V1 `renderParametric` → V2 `evaluateShape`,V1 `render` → V2 `evaluate`
- **G2-7=B composer / visual-rules 空壳**:留 v1.5+ + family-tree 阶段消费
- **G2-8=B side-effect 立即 bootstrap**:`index.ts` 顶层调 `bootstrapShapes()` + `bootstrapSubstances()`,renderer side-effect import 触发
- **G2-10=B Instance / InstanceEndpoint 不搬到 shape-library**:严格 capability 边界,留 G3 canvas-rendering / graph-library-store
- **path-to-three.ts 不搬本段**:V1 395 行 import three,留 G3 一起搬到 canvas-rendering/scene/(P1-1 严格屏障核心落地点)
- **W5 严格态 A 边界**:view 通过 requireCapabilityApi 间接路由(currently 没有 view 直接消费 shape-library,G3 才接);capability 双导出(模块级 + api 字段)

### 1.2 实施时微调

| 微调点 | v0.1/v0.2 design | 实测 / 落地 |
|---|---|---|
| types.ts LOC | 估 ~180 行 | 实 298 行 — V1 types.ts 333 行精简 Instance 类系 + 完整 JSDoc 注释 + 业务规格字段全保留 |
| parametric.ts 返回值 | v0.1 设计写"返回 RenderOutput.data 形态" | v0.2 直接返回 EvaluatedPath(去掉 V1 RenderOutput 包装层,函数签名更扁) |
| dev hook 桥(`window.__krig.shapeLib`) | v0.1 设计 § 7 第 4 项写"runShapeSmoke() 挂在 index.ts 末尾的 dev-only 分支" | 实施 + commit 4 / 5 修补:挂 + 处理 renderer 后续覆盖问题(⚠️ **G2 merge 后用户 P2 复审发现 commit 4 的"启动自动跑 smoke"与 § 2 G2-6=B 决策冲突** — 修补 commit 7 删除 dev-auto-smoke,改 `__krig.shapeLib.runSmoke()` 按需触发;design v0.2 → v0.3 同步修订) |
| install-coverage / viewTypeRegistry warn 文档化 | v0.1 设计 § 6 写"0 missing" | P1-A 路径下:既有 design + completion 5 处更新为"预期 missing / warn,不阻塞验收" |

### 1.3 不在 G2 范围(已留 G3~G4 / v1.5+)

- ❌ `npm install three`(G3)
- ❌ `path-to-three.ts`(V1 395 行 → G3 搬到 canvas-rendering/scene/)
- ❌ Three.js Scene / NodeRenderer / interaction(G3 + G4)
- ❌ canvas-text-node capability(G4)
- ❌ Library Picker UI(G4,归 canvas-rendering 内部浮层)
- ❌ Substance composer / visual_rules 真求值(v1.5+ / family-tree 里程碑 H)
- ❌ Substance create/update/delete(v1.5+ 接 note-store)
- ❌ ShapePack / SubstancePack 第三方扩展注册(v2+ 插件市场)

---

## 2. 完成判据自检(charter § 6.3)

| 项 | 标准 | 结果 |
|---|---|---|
| ✅ npm start 跑得起来 | 窗口出来 + 无报错 | ✅ |
| ✅ console 显 `[shape-library] alive | shapes: 22, substances: 5` | + `[shape-smoke] OK total=22` + by category | ✅ |
| ✅ 上一层 alive 行也在 | L0~L5 + G1 alive 行无回归 | ✅ |
| ✅ install-coverage 预期 missing 2 | `graph-canvas-view × 4 capabilities · missing 2:canvas-rendering / canvas-text-node`(从 G1 的 missing 3 归零 1 项);P1-A 修订:渐进式 install 预期,**不阻塞验收**;G3 / G4 渐次归零 | ✅ |
| ✅ viewTypeRegistry warn 配套出现 | `[L4] viewTypeRegistry: view 'graph-canvas-view' install ids 未在 capabilityRegistry 中: canvas-rendering, canvas-text-node`;与 install-coverage 同源、配套,**预期、不阻塞** | ✅ |
| ✅ typecheck 0 error | tsc --noEmit | ✅ |
| ✅ lint 0 warn | eslint . 全工程 | ✅ |
| ✅ 屏障 grep 0 命中(本段核心) | `grep -rn "from 'three'" src/capabilities/shape-library/ --include="*.ts"` → 0 行 | ✅ |
| ✅ 真代码 0 引用 THREE.* | grep --include="*.ts" 排除注释/JSDoc 后 0 命中 | ✅ |
| ✅ smoke test 通过 | DevTools 调 `window.__krig.shapeLib.runSmoke()` 返回 ok:true,total:22,byCategory 完整(G2-6=B 按需触发,P2 修订后**不启动自动跑**)| ✅ |
| ✅ capability 数 14 → 15 | shape-library 注册成功 | ✅ |
| ✅ `getSnapshot should be cached` warning 消失 | commit 4 修 graph + commit 6 修 note + ebook 同类 bug 后冷重启验证消失 | ✅ |

---

## 3. 用户验收(design § 7 6 项 + P2 顺手修补)

**全过**(用户 2026-05-10 确认,冷重启 2 次验证):

1. ✅ 启动 console — `[shape-library] alive | shapes: 22, substances: 5` + `[shape-smoke] OK total=22` + by category(11/3/4/3/1)
2. ✅ install-coverage P1-A 渐次归零 — missing 3(G1)→ missing 2(G2,shape-library 归零)
3. ✅ G1 功能回归(用户切过 ebook view,`[ebook-rendering/Host]` 日志说明 ebook 正常;graph-canvas-view 切回去 G1 12 项功能不变)
4. ✅ 屏障 grep 0 命中(命令行验证;DESIGN.md 含字符串描述属文档,不算)
5. ✅ smoke test 启动自动跑 + by category 正确
6. ✅ DevTools `window.__krig.shapeLib.shapes.Registry.list().length === 22`,`Object.keys(window.__krig) === ['shapeLib', 'wm', 'bus']`
7. ✅ (新增 P2 顺手修)`getSnapshot should be cached` warning 消失 — 三 view hydrate 统一

---

## 4. 自我诊断输出样本

冷重启后 console 完整输出:

```
[shape-library] alive | shapes: 22, substances: 5
[L4] viewTypeRegistry: view 'graph-canvas-view' install ids 未在 capabilityRegistry 中: canvas-rendering, canvas-text-node
  (charter § 1.2:install 项必须是已注册的 capability id)
  ← P1-A 预期 warn,G3 / G4 渐次归零
[Renderer] alive | renderer process started
[install-coverage] ❌ install 覆盖率自检:5 views · 15 capabilities · 缺失 2
  ← P1-A 预期 warn,同上
[shape-smoke] OK total=22
[shape-smoke] by category: { basic: 11, arrow: 3, flowchart: 4, line: 3, text: 1 }
[use-extraction-import] hook mounted, subscribing to onExtractionNoteCreate
```

**关键诊断行**(G2 段核心 alive):
- `[shape-library] alive | shapes: 22, substances: 5` ← G2 主体诊断
- `[shape-smoke] OK total=22` ← dev-only 启动自动 smoke

---

## 5. 衔接 G3(下一段)

G3 启动需要:
- ✅ G1 + G2 已 merge main(本段 merge 后)
- ⏳ 用户起 G3 设计 — `capability.canvas-rendering`(Three.js 单点屏障核心,Host forwardRef + scene + interaction + path-to-three 从 shape-library 搬入)

G3 是 graph 迁移的"重头戏"(估 ~2000 driver + ~250 CSS;含 G2 没搬的 path-to-three.ts 395 行 + V1 SceneManager 346 + NodeRenderer 818 + InteractionController 部分等);整段引入唯一允许 import three 的位置.

G2 产物对 G3 的支撑:
- `shape-library.shapes.evaluate(id, props, ctx)` 返回 EvaluatedPath → NodeRenderer 消费(canvas-rendering 内部 path-to-three.ts 把 d 字符串转 THREE.Shape)
- `ShapeRegistry.list()` / `listByCategory()` → G4 Library Picker 缩略图消费

---

## 6. 遗留 / 待优化项

| 项 | 说明 | 留待 |
|---|---|---|
| install-coverage / viewTypeRegistry warn(P1-A) | 渐进式 install 预期 warn,G3 / G4 分别归零 1 项 | G3 → G4 自动消除 |
| 框架是否升级"声明性 install vs 已就绪 install"语义区分 | viewTypeRegistry warn 与 install-coverage 同源、冗余;P1-A 路径下两者都报 warn 视为正常 | charter v0.5 时统一(本 graph 段不变动框架) |
| Substance composer / visual-rules 真实施 | family-tree 阶段(里程碑 H)消费 visual_rules;v1.5+ 用户编辑 substance 时消费 composer | v1.5+ / 里程碑 H |
| graph-canvas-view view 主体 G2 时不直接消费 shape-library | G3 接 canvas-rendering Host 时,Host 内部消费 shape-library evaluate;view 主体仍不直 import @capabilities/shape-library 运行时值(走 requireCapabilityApi)| G3 |
| dev hook 桥 `window.__krig.shapeLib` 仅暴露 Registry | DevTools 用 `Registry.list()` / `Registry.get(id)` + `evaluateShape(def, ctx)` 组合用;G3 起可考虑挂更友好的 `evaluate(id, ctx)` 桥 | G3 顺手 |

---

## 7. 修订记录

| 日期 | 内容 |
|---|---|
| 2026-05-10 | 初稿;6 commit 全合(2 design + 1 feat + 3 fix)+ 12 项完成判据全 ✅ + 6 项用户验收 + 1 项 P2 顺手修补全过;design v0.1 → v0.2 P1-A 修订纳入本报告 |
| 2026-05-10 | G2 merge 后用户 P2 复审 — dev-auto-smoke 与 G2-6=B 决策冲突修补(fix/L5G2-remove-dev-auto-smoke 分支):commit 4(f2f2c32)按 § 7 误导文字加了"启动自动跑 smoke",违反 § 2 G2-6=B(smoke 只暴露函数 / 不污染启动 console);修补 commit:① src/capabilities/shape-library/index.ts 删除启动自动跑,改 `__krig.shapeLib.runSmoke()` 按需触发;② design v0.2 → v0.3 § 6 / § 7 / 修订记录同步;③ 本报告 § 1.2 dev hook 桥行 + § 2 完成判据 smoke 行同步;启动 console 去掉两行 `[shape-smoke] OK total=22` / `by category: ...` 噪音 |
