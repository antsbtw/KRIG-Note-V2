# shape-library capability

> v0.1 · 2026-05-10 · L5-G2
>
> 配套:
> - [../../../docs/RefactorV2/v1-graph-migration-plan.md](../../../docs/RefactorV2/v1-graph-migration-plan.md) v0.2 § 3.2
> - [../../../docs/RefactorV2/stages/L5G2-shape-library-design.md](../../../docs/RefactorV2/stages/L5G2-shape-library-design.md) v0.2
> - 业务规格(权威):[../../../docs/10-business-design/graph/library/Library.md](../../../docs/10-business-design/graph/library/Library.md)

## P1-1 严格版屏障落地点

**本 capability 0 import three**(P1-1 严格版屏障核心,详见 v1-graph-migration-plan.md v0.2 § 0 + § 3.2)。

- types.ts `EvaluatedPath` 是纯数据(d 字符串 + magnets + textBox),**0 含 THREE.* 类型字面量**
- shapes/renderers/parametric.ts 求值 → 输出 EvaluatedPath,**0 import three**
- shapes/renderers/formula-eval.ts 纯数学,**0 三方依赖**
- shapes/renderers/index.ts 不 re-export V1 `shapeToThree / pathToThree`(那些迁到
  `capabilities/canvas-rendering/scene/path-to-three.ts`,G3 实施)

`three` 全部圈在 `capabilities/canvas-rendering/scene/`(G3 唯一允许 import three 的位置)。

ESLint `no-restricted-imports` 白名单:**只允许** `capabilities/canvas-rendering/` import three;`shape-library/` 不在白名单。

## 职责

Shape 定义(22 个内置)+ Substance 定义(5 个内置)+ 参数化求值器 + OOXML 17 操作符公式求值器。

view + canvas-rendering capability + 后续 family-tree variant 都通过此 capability 消费 Shape / Substance 资源,**view 不直触 registry**(W5)。

## 实现位置

| 层 | 路径 | LOC | 备注 |
|---|---|---|---|
| Renderer 入口 | `src/capabilities/shape-library/index.ts` | ~150 | 双导出 + Registry 注册 + side-effect bootstrap + alive 行 |
| 类型 | `src/capabilities/shape-library/types.ts` | ~250 | Shape / Substance / EvaluatedPath / EvaluateContext / ShapeLibraryApi |
| shapes/registry.ts | | ~50 | ShapeRegistry 类(V1 直迁,拆 bootstrap 出独立文件) |
| shapes/definitions/ | 22 JSON | — | basic 11 / arrow 3 / flowchart 4 / line 3 / text 1 |
| shapes/renderers/parametric.ts | | ~110 | evaluateShape 函数(V1 renderParametric 改名 + 输出 EvaluatedPath 而非 RenderOutput) |
| shapes/renderers/formula-eval.ts | | ~203 | OOXML 17 操作符求值(V1 直迁,纯数学) |
| shapes/renderers/index.ts | | ~10 | barrel(0 re-export path-to-three) |
| shapes/bootstrap.ts | | ~30 | import.meta.glob 扫 JSON 注册 |
| shapes/__smoke__/run.ts | | ~110 | V1 直迁,断言形态对齐 EvaluatedPath |
| substances/registry.ts | | ~45 | SubstanceRegistry 类(V1 直迁) |
| substances/definitions/ | 5 JSON | — | library 2 + family 3 |
| substances/composer.ts | | ~20 | **空壳**(G2-7=B,留 v1.5+) |
| substances/visual-rules.ts | | ~20 | **空壳**(G2-7=B,family-tree 阶段消费) |
| substances/bootstrap.ts | | ~30 | 同 shapes |

## API 形状

详见 `types.ts` 的 `ShapeLibraryApi` 接口。

```ts
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { ShapeLibraryApi } from '@capabilities/shape-library/types';

const lib = requireCapabilityApi<ShapeLibraryApi>('shape-library');

// 列所有 shape
const shapes = lib.shapes.list();
// 按 category 过滤
const basics = lib.shapes.listByCategory('basic');
// 求值 — 拿 SVG path d 字符串 + magnets + textBox(0 含 THREE.* 字面量)
const path = lib.shapes.evaluate('krig.basic.roundRect', {}, { width: 200, height: 100 });
//   path = { d: 'M 15 0 L 185 0 ...', width: 200, height: 100, magnets: [...], textBox: {...} }

// Substance
const subs = lib.substances.list();
const familyPerson = lib.substances.get('library.family.person');
```

## W5 严格态边界(audit § 5.2 A)

- **View 侧(强制)**:走 `requireCapabilityApi('shape-library')` 间接路由
- **Driver/slot 侧(允许)**:可直 import 单例 export(`ShapeRegistry / SubstanceRegistry / evaluateShape`)兜底
- 模块级 export 同时挂(双导出),对齐 V2 既有 capability 现行写法

## 装配关系(charter § 1.3 表格)

- shape-library 内部依赖:**仅** `@slot/capability-registry`(注册自身)
- shape-library 不依赖 driver(无 driver 层)
- shape-library 不依赖 canvas-rendering / graph-library-store / canvas-text-node
  (底层资源能力,被其他能力反向消费)

## 零业务 npm import

本 capability 是纯数据 + 纯数学:
- `@slot/capability-registry/capability-registry`(Registry 注册)
- 相对路径 `./types` / `./shapes/*` / `./substances/*`
- `vite/client` types(for `import.meta.glob`,纯类型)
- **0 import three / 0 import prosemirror-* / 0 import electron**

启动时验证(屏障 grep):
```sh
grep -rn "from 'three'" src/capabilities/shape-library/   # 应 0 命中
grep -rn "import.*'three'" src/capabilities/shape-library/ # 应 0 命中
grep -rn "THREE\\." src/capabilities/shape-library/        # 应 0 命中
```

## 不做的事(G2 范围外)

| 不做 | 说明 |
|---|---|
| `npm install three` | G3 引入(canvas-rendering 才需) |
| path-to-three.ts(SVG path → THREE.Shape) | V1 395 行 import three,留 G3 一起搬到 `capabilities/canvas-rendering/scene/` |
| Substance composer 真实施 | G2-7=B 空壳;v1.5+ 实施 |
| Substance visual_rules 求值 | 同上;family-tree 阶段(里程碑 H)真消费 |
| Substance create/update/delete | v1.5+ 接 note-store(每个 substance 一篇 note) |
| ShapePack / SubstancePack 第三方扩展注册 | v2+ 插件市场 |
| Library Picker UI | G4(归 canvas-rendering 内部浮层) |
| 完整 OOXML 187 shape | v1.5+ 持续扩展(当前 22 个覆盖 family-tree + 通用画板需求) |
| Custom renderer 复杂 shape | v1.5+ 按需加 |
| 用户从 SVG / .pptx 导入 shape | v1.5+ |
