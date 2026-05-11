# L5-G2 设计 — Shape + Substance 资源仓库 capability

> v0.3 · 2026-05-10 · G2 merge 后用户 P2 复审(dev-auto-smoke 与 G2-6=B 决策冲突修订)
>
> 配套:
> - 上游 plan:[../v1-graph-migration-plan.md](../v1-graph-migration-plan.md) v0.2 § 3.2 + § 5 G2
> - 业务规格(权威):[../../10-business-design/graph/library/Library.md](../../10-business-design/graph/library/Library.md)
> - 同位参考:[./L5G1-graph-platform-and-skeleton-design.md](./L5G1-graph-platform-and-skeleton-design.md) v0.2(同段 design 模板)
>
> **本段定位**:Graph 迁移 5 段切片(G1~G5)第 2 段。**只做 shape-library capability**(22 个 shape JSON + 5 个内置 substance JSON + parametric renderer + OOXML 公式求值器);**0 import three**(P1-1 严格版屏障核心)。

---

## 0. 一句话目标

V2 启动时,console 显 `[Capability] alive | registered: [..., 'shape-library']` + `Shape: 22, Substance: 5` 诊断;ShapeRegistry / SubstanceRegistry 22+5 全注册;smoke test 通过(所有 shape 在 200×100 尺寸下能渲染出非空 SVG path d,无 NaN / Infinity)。

完整对应 v0.2 plan § 5 G2 段验收清单:

> npm start → console 显 `Shape: 22, Substance: 5` 诊断行;G3 之前 Library 用不上,本段无 UI 验收;**屏障 grep 结果 0 命中**

---

## 1. 范围(In/Out)

### 1.1 本段做(In)

- [x] **capabilities/shape-library/** 全套:
  - `types.ts`:ShapeDef / SubstanceDef / FormulaOp / FormulaValue / PathCmd / MagnetPoint / ShapeHandle / TextBox / DefaultStyle / FillStyle / LineStyle / ArrowStyle / VisualRule / ShapePack / SubstancePack / EvaluatedPath / EvaluateContext / ShapeLibraryApi(**0 import three;0 含 THREE.* 类型;0 含 Instance / InstanceEndpoint** — 后者归 graph-library-store / canvas-rendering)
  - `shapes/registry.ts`:V1 直迁
  - `shapes/definitions/`:22 个 shape JSON 直迁(basic 11 / arrow 3 / flowchart 4 / line 3 / text 1)
  - `shapes/renderers/parametric.ts`:V1 直迁,**对外 API 名改为 `evaluateShape`**(返回 EvaluatedPath 纯数据,对齐 plan v0.2 § 3.2 API 命名 `evaluate`)
  - `shapes/renderers/formula-eval.ts`:V1 直迁(纯数学,0 三方依赖)
  - `shapes/bootstrap.ts`:`import.meta.glob` 扫 22 JSON 注册(V1 V2 同形)
  - `shapes/__smoke__/run.ts`:V1 直迁,断言形态改为"输出 EvaluatedPath"
  - `substances/registry.ts`:V1 直迁
  - `substances/definitions/`:5 个 substance JSON 直迁(library 2 / family 3)
  - `substances/bootstrap.ts`:同 shapes
  - `substances/composer.ts`:空壳(留 v1.5+ 真组合求值)
  - `substances/visual-rules.ts`:空壳(留 family-tree 阶段消费 visual_rules)
  - `index.ts`:双导出 + `capabilityRegistry.register({ id: 'shape-library', api })`
  - `DESIGN.md`:对齐 ebook-library / graph-library-store DESIGN 模板,**第一章显式声明 "0 import three"**(P1-1 严格版屏障落地点)
- [x] **renderer/index.tsx** 加 `import '@capabilities/shape-library'`(side-effect 注册)
- [x] **alive 自检**:启动 console 显示 `Shape: 22, Substance: 5`(独立诊断行)

### 1.2 本段不做(Out)

- ❌ `npm install three`(G3 引入)
- ❌ `path-to-three.ts`(V1 395 行 import three;G3 一起搬到 `capabilities/canvas-rendering/scene/`)
- ❌ `capabilities/canvas-rendering/`(G3 + G4)
- ❌ Three.js Scene / NodeRenderer / interaction
- ❌ Library Picker UI(G4,归 canvas-rendering capability 内部浮层)
- ❌ Substance 真组合渲染逻辑(composer / visual-rules 留空壳)
- ❌ Substance create/update/delete(v1.5+,需要 substance 独立 note 化)
- ❌ ShapePack / SubstancePack 第三方扩展注册(v2+ 插件市场)
- ❌ view 端消费(G3 NodeRenderer 才开始消费 evaluateShape 返回的 EvaluatedPath)
- ❌ family-tree projection / visual_rules 求值(里程碑 H,基础设施留空壳)

---

## 2. 决策清单(本段细化)

| # | 决策点 | A(默认) | B(替代) | 推荐 |
|---|---|---|---|---|
| **G2-1** | capability id 字面值 | **`shape-library`**(对齐 plan v0.2 § 3.2 + charter § 1.3 规则 C「能力颗粒度按未来可扩展原则」)| `graph-shape-library` / `library` | A — 通用资源仓库,不带 graph 前缀(future:family-tree / mindmap 等都消费它) |
| **G2-2** | `RenderOutput` 类型保留 vs 改名 | **A 改名为 `EvaluatedPath`**(纯数据;v0.2 plan § 3.2 命名)— V1 `RenderOutput.kind = 'svg-path' \| 'three-mesh' \| 'composite'`,V2 严格屏障下不允许 `'three-mesh'` 标签出现 | 沿用 V1 `RenderOutput` 名 | **A**(P1-1 严格版屏障核心):types.ts 完全不出现 `'three-mesh'` 字面量;EvaluatedPath 含 `d` / `width` / `height` / `magnets` / `textBox` 五个字段(对齐 V1 ParametricOutput 形态) |
| **G2-3** | API 方法命名:`render` vs `evaluate` | **A `evaluate`**(对齐 plan v0.2 § 3.2:`evaluate(id, props, ctx): EvaluatedPath`)| 沿用 V1 `render` 名 | **A**:`render` 容易让 view 误以为"输出可挂 scene 的 mesh";`evaluate` 字面"求值",明示输出纯数据 |
| **G2-4** | path 求值函数命名:`renderParametric` vs `evaluateShape` | **A `evaluateShape`**(对齐 G2-3) | 沿用 V1 `renderParametric` | **A**:函数名与 API 命名一致;V1 的 `renderParametric` 名 V1 内部叫法保留不必带到 V2 |
| **G2-5** | shape-library 是否暴露 EvaluateContext 类型给 view 直接用 | A 暴露 — 通过 `types.ts` 公开 | **B 只导给 canvas-rendering 内部用** | **A**(实用):view / family-tree projection / canvas-rendering 都需要它,暴露简单 |
| **G2-6** | smoke test 是否启动时跑 | A 启动跑 — `bootstrap()` 后顺手跑一遍 | **B 只暴露函数,view 端开发面板按需跑** | **B**(对齐 V1):smoke 输出污染 console,只在开发场景按需;`bootstrap()` 内不主动调 |
| **G2-7** | Substance composer / visual-rules 是否真实现 | A 实现 — 把 V1 NodeRenderer 内"substance 展开 components"逻辑抽出来 | **B 留空壳**(v1.5+ 实现) | **B**(对齐 G1 范围控制原则):G2 只做"注册 + 求值 Shape",substance 真渲染由 G3 NodeRenderer 内部处理;family-tree 阶段需要 visual_rules 时再实现 |
| **G2-8** | bootstrap 时机 | A 显式调用(view / install-coverage 时确保 ready) | **B `import 'shape-library'` 副作用立即 bootstrap** | **B**(对齐 V1 SubstanceRegistry / V2 既有 capability 注册模式):`index.ts` 顶层立即调 `ShapeRegistry.bootstrap()` + `SubstanceRegistry.bootstrap()`;renderer side-effect import 触发 |
| **G2-9** | smoke test 文件位置 | A `__smoke__/run.ts`(V1 同位) | B `__tests__/smoke.ts`(对齐 V2 既有 test 命名风格) | **A**(V1 直迁,改路径增加额外工作量;V2 也没强 test 目录约定) |
| **G2-10** | `Instance` / `InstanceEndpoint` / `TextNodeAtoms` 等 V1 types.ts 含画板实例类型是否搬到 shape-library/types.ts | A 搬过来 — V1 同文件 | **B 不搬**(留 G3 canvas-rendering 内或 graph-library-store/types) | **B**(严格按 capability 边界):shape-library 是"资源仓库",Instance 是"画板上的实例"概念,不属于 shape-library 职责;留 G3 |

---

## 3. 文件清单(物理路径 + LOC 估算)

### 3.1 新增

```
src/capabilities/shape-library/
├── index.ts                      ~50  行(双导出 + capabilityRegistry.register + bootstrap 触发 + 诊断行)
├── types.ts                      ~180 行(V1 types.ts 333 → 砍 Instance/InstanceEndpoint/TextNodeAtoms,只留 Shape + Substance + Render 类型;G2-2 改 EvaluatedPath)
├── shapes/
│   ├── registry.ts               ~66 行(V1 直迁)
│   ├── definitions/              22 个 shape JSON 直迁
│   │   ├── basic/(11 files)
│   │   ├── arrow/(3 files)
│   │   ├── flowchart/(4 files)
│   │   ├── line/(3 files)
│   │   └── text/(1 file)
│   ├── renderers/
│   │   ├── parametric.ts         ~110 行(V1 103 → 改函数名 + 输出类型对齐 EvaluatedPath)
│   │   ├── formula-eval.ts       ~203 行(V1 直迁,纯数学)
│   │   └── index.ts              ~10 行 re-export(V1 path-to-three 行删掉)
│   ├── bootstrap.ts              ~20 行(独立文件容易被 index.ts 调用;V1 bootstrap 嵌在 ShapeRegistry 类里,V2 拆出)
│   └── __smoke__/run.ts          ~100 行(V1 直迁 + 改断言形态对齐 EvaluatedPath)
├── substances/
│   ├── registry.ts               ~63 行(V1 直迁)
│   ├── definitions/
│   │   ├── library/(2 files)
│   │   └── family/(3 files)
│   ├── composer.ts               ~10 行(留空壳 + TODO,G2-7=B)
│   ├── visual-rules.ts           ~10 行(留空壳 + TODO,G2-7=B)
│   └── bootstrap.ts              ~20 行
└── DESIGN.md                     ~120 行(P1-1 严格版屏障显式声明 + 对外 API + 与 graph-library-store / canvas-rendering 装配关系 + G2 不做项明示)

合计估算:driver ~840 行 + 27 JSON 资源 + DESIGN ~120 行
```

### 3.2 修改

```
src/platform/renderer/index.tsx                  + 1 行(@capabilities/shape-library)
```

> v0.2 plan § 5 G2 估算 ~700 行 — 本设计估 ~840 行,溢出 ~140 行主要在:`types.ts` 不再单文件复用 V1 types.ts(V1 333 行混合 Shape + Substance + Instance,V2 拆离后 shape-library/types.ts 反而还是 ~180 行 + bootstrap 拆出独立文件 + DESIGN 多一份),与 plan 估算误差范围内可接受。

---

## 4. capabilityRegistry api 形状

完全对齐 plan v0.2 § 3.2:

```ts
export interface ShapeLibraryApi {
  shapes: {
    register(def: ShapeDef): void;
    get(id: string): ShapeDef | null;
    list(): ShapeDef[];
    listByCategory(category: ShapeCategory): ShapeDef[];
    /** 求值:把 ShapeDef.path + params + guides 求值成"路径表达式数据"
     *  输出 EvaluatedPath(数组 of {cmd, ...numbers}),0 含 THREE 类型 */
    evaluate(id: string, props: EvaluateInput, ctx: EvaluateContext): EvaluatedPath | null;
  };
  substances: {
    register(def: SubstanceDef): void;
    get(id: string): SubstanceDef | null;
    list(): SubstanceDef[];
    listByCategory(category: string): SubstanceDef[];
    // 求值方法 — G2-7=B 留空壳,v1.5+ 实现
    // evaluate(id, props, ctx): EvaluatedSubstance | null;
  };
}
```

**`EvaluatedPath` 纯数据形态**:

```ts
export interface EvaluatedPath {
  /** SVG path d 字符串(M / L / A / Q / C / Z) */
  d: string;
  /** 实际尺寸透传 */
  width: number;
  height: number;
  /** magnets 已转世界坐标(归一化 0..1 × 宽高)*/
  magnets: Array<{ id: string; x: number; y: number }>;
  /** 文本框(已求值)*/
  textBox?: { l: number; t: number; r: number; b: number };
}

export interface EvaluateContext {
  width: number;
  height: number;
  params?: Record<string, number>;
}

export interface EvaluateInput {
  // v1 与 EvaluateContext 一样,留接口允许未来扩展(如 props 传 substance prop)
}
```

> **v0.2 plan § 3.2 把 `props` 和 `ctx` 拆两个参数**;本 design 保留(API `evaluate(id, props, ctx)`),但 v1 实际 `props` 字段空(shape 不消费 substance props,留 substance.evaluate 用)。

---

## 5. 自我诊断(charter § 5)

启动时 console 应额外显示:

```
[Capability] alive | registered: [..., 'shape-library']
[shape-library] alive | shapes: 22, substances: 5
```

第二行由 `capabilities/shape-library/index.ts` 在 `bootstrap()` 完成后输出。

---

## 6. 完成判据(charter § 6.3)

| 项 | 标准 |
|---|---|
| ✅ npm start 跑得起来 | 无报错 |
| ✅ console 显 `shape-library` alive 行 | + `shapes: 22, substances: 5` |
| ✅ 上一层 alive 行也在 | L0~L5 + G1 alive 行无回归 |
| ✅ install-coverage missing 3 → 2 | graph-canvas-view install 4 项中 shape-library 在本段归零;启动 console 显 `missing: canvas-rendering, canvas-text-node`(P1-A 修订:install 是声明性契约;G3 / G4 分别再归零 1 项);全工程 capability 数 14 → 15 |
| ✅ viewTypeRegistry warn 配套出现 | 同 install-coverage,registerView 时校验 install ids 是否在 capabilityRegistry,缺失则 `[L4] viewTypeRegistry: view 'graph-canvas-view' install ids 未在 capabilityRegistry 中: canvas-rendering, canvas-text-node`;**P1-A 修订:渐进式 install 下这条 warn 是预期,与 install-coverage 同源、配套,不阻塞验收**(framework 自检冗余但稳妥保留 — V2 不为 graph 一段调整框架告警语义)|
| ✅ typecheck 0 error | tsc --noEmit |
| ✅ lint 0 warn | eslint . 全工程 |
| ✅ **屏障 grep 0 命中**(本段核心)| `grep -rn "from 'three'" src/capabilities/shape-library/` → 0 行 |
| ✅ smoke test 通过 | DevTools 调 `window.__krig.shapeLib.runSmoke()` 返回 ok:true,total:22,failures:[](G2-6=B 按需触发,不启动自动跑)|

---

## 7. 用户验收清单(本段无 UI,改为开发态自检)

按此顺序手测/手验(本段没有用户可见 UI):

1. **启动** — npm start → 出窗口 → console 显:
   - `[Capability] alive` 含 `shape-library`
   - `[shape-library] alive | shapes: 22, substances: 5`
   - L0~L5 + G1 alive 行无回归
2. **手测 G1 功能没坏** — 切 Graph view → 创建画板 → 重命名 → 删除(G1 验收 12 项的 4~10 项再跑一遍,确认 G2 没破坏既有功能)
3. **屏障 grep**(命令行):
   ```
   grep -rn "from 'three'" src/capabilities/shape-library/   # 应 0 命中
   grep -rn "import.*'three'" src/capabilities/shape-library/ # 应 0 命中
   grep -rn "THREE\." src/capabilities/shape-library/        # 应 0 命中
   ```
4. **smoke test**(在 DevTools console,按需触发 — 对齐 G2-6=B,**不**启动自动跑):
   ```js
   // 用 dev-only 桥(path alias 不识别走 __krig)
   await window.__krig.shapeLib.runSmoke();
   // 期望:{ ok: true, total: 22, failed: [], byCategory: { basic: 11, arrow: 3, flowchart: 4, line: 3, text: 1 } }
   ```
   ⚠️ v0.1 设计文档此处曾写"或挂在 index.ts dev-only 分支启动自动跑"
   — 与 G2-6=B 决策(smoke 不污染启动 console)矛盾,v0.3 修订删除该误导,
   实施时按 G2-6=B 走"按需触发"路径.
5. **typecheck / lint** — 命令行 `npx tsc --noEmit && npx eslint .` 全 0
6. **renderer 注册闭环** — DevTools 跑:
   ```js
   (await import('@slot/capability-registry/capability-registry')).capabilityRegistry.has('shape-library')  // true
   ```

---

## 8. 风险登记

| 风险 | 缓解 |
|---|---|
| V1 types.ts 333 行混合 Shape / Substance / Instance,搬运时容易把 Instance 带过来违反 G2-10=B | types.ts 写作时按 G2-10 严格区分:只搬 Shape 系 + Substance 系 + Render 系 + Pack 系;Instance / InstanceEndpoint / TextNodeAtoms / InstanceKind 等明确不搬;靠 grep 验证 |
| V1 RenderOutput.kind 含 `'three-mesh'` 字面量,搬过来违反 P1-1 | G2-2 决策:改名 EvaluatedPath,完全删 RenderOutput 类型;types.ts 0 含 `'three-mesh'` / `'composite'` 字面量(`'svg-path'` 也不再需要,因为 EvaluatedPath 不带 kind 字段) |
| smoke test 启动时跑会污染 console | G2-6=B:`runShapeSmoke()` 只暴露函数,不在 bootstrap 中调 |
| import.meta.glob 在打包时找不到 JSON | 沿用 V1 V2 既有路径风格(`./definitions/**/*.json` + `{ eager: true }`)— V2 ebook / learning 已验证 vite glob OK |
| substance composer / visual-rules 留空壳,G3 / 里程碑 H 实施时容易忘了实现 | DESIGN.md 在"不做项"明示,留 TODO 注释:`// G2-7=B:留 v1.5+ 实施` |
| V1 shape JSON 的字段(如 handles[0].from 用 FormulaOp)V2 types 不兼容 | types.ts 完全照搬 V1 字段定义,JSON 直接通过 `import` 加载,无额外 schema validation;运行时 evaluateShape 期间报错由 try/catch 兜底,smoke test 检出 |
| graph-canvas-view 的 install 列表本段是否变 | **不变 — 4 项已在 G1 P1-A 修订时完整声明**(`graph-library-store` / `shape-library` / `canvas-rendering` / `canvas-text-node`);install-coverage 在本段从 "missing 3" 自动归到 "missing 2"(shape-library 注册即归零);view 文件本段 0 改动 |

---

## 9. 实施分 commit

单 commit(对齐 G1 的"双 commit"但本段无 view 改动,无 platform 改动,纯一个 capability):

### 单 commit — feat(capabilities/shape-library):资源仓库 capability(估 ~840 行 + 27 JSON)
- `src/capabilities/shape-library/` 全套
- `src/platform/renderer/index.tsx` + 1 行
- 验证:typecheck 0 + lint 0 warn + 屏障 grep 0 + console 显示 `Shape: 22, Substance: 5` + smoke test ok:true

---

## 10. 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-05-10 | v0.1 | 初稿;G2 范围 + 10 决策点 + 文件清单 + EvaluatedPath / EvaluateContext API + 6 项验收清单(开发态自检) + 单 commit 拆分 + 风险登记 |
| 2026-05-10 | v0.2 | 启动前用户 P1-A 复审 — install 列表口径与上游 plan 冲突修订:v0.1 § 6 完成判据"install-coverage 0 missing(view 未 install shape-library,G3 才加)"+ § 8 风险表"install 列表 G2 后不更新"等"渐进式 install"表述,与 plan v0.2 § 6.1 写的"install: 4 项"口径冲突 → 选 A(对齐 ebook 既有先例:install 是声明性契约,不是已就绪声明):① § 6 完成判据 install-coverage 改"missing 3 → 2(shape-library 归零)";② § 8 风险表"install 不变"明示 4 项已在 G1 P1-A 修订时完整声明;③ 联动改 G1 design v0.2 → v0.3 + G1 completion 补 P1-A 修订条目 + view 实际代码 install 1 项 → 4 项 |
| 2026-05-10 | v0.3 | G2 merge 后用户 P2 复审 — dev-auto-smoke 与 G2-6=B 决策冲突修订:v0.1 § 7 第 4 项写"或把 runShapeSmoke 挂 dev-only 分支启动自动跑",与 § 2 表 G2-6=B(smoke 只暴露函数 / 不污染启动 console)矛盾;实施 commit 4(f2f2c32)按 § 7 误导文字加了 dev-auto-smoke;v0.3 修订:① § 7 第 4 项删除误导文字,改写为 "DevTools 按需触发 `window.__krig.shapeLib.runSmoke()`";② § 6 smoke 完成判据同步;③ 代码修补 src/capabilities/shape-library/index.ts 删除启动自动跑,改挂 `runSmoke` 函数到 `__krig.shapeLib` 桥(单独 fix commit);④ G2 completion 补"P2 dev-auto-smoke 修订"条目 |
