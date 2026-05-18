# math-rendering capability

> v0.1 · Phase 1A · Mafs + mathjs + compute-engine 单点屏障

## 职责

封装 **Mafs**(函数曲线 SVG 画布)+ **mathjs**(表达式求值/AST/编译)+ **@cortex-js/compute-engine**(LaTeX → MathJSON 解析),对外提供 React `MathHost` 组件 + 计算函数。

V1 `math-visual` block 迁到 V2 时,所有"画函数 + 求值 + LaTeX 解析"职责收敛到本 capability。driver 内的 NodeView + 全屏 Panel 通过 `requireCapabilityApi<MathRenderingApi>('math-rendering')` 消费,**0 import mafs / mathjs / @cortex-js/compute-engine**。

## 屏障原则

**本 capability 是 V2 唯一允许 import `mafs` / `mathjs` / `@cortex-js/compute-engine` 的位置**(对齐 [code-editing 的 CM6 单点屏障](../code-editing/) + [canvas-rendering 的 Three.js 单点屏障](../canvas-rendering/) 模式)。

其他位置(view / driver / 其他 capability / shell / workspace / slot)0 import,通过:

```ts
const { MathHost, createEvalFn, ... } = requireCapabilityApi<MathRenderingApi>('math-rendering');
```

拿 Host + 计算 API。

ESLint 规则:

```
no-restricted-imports:
  - mafs / mafs/*                       只允许 src/capabilities/math-rendering/
  - mathjs                              同上
  - @cortex-js/compute-engine           同上
```

## 业务方接入示例

```tsx
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { MathRenderingApi, Curve } from '@capabilities/math-rendering/types';

function MyMathBlock({ data, onChange }: { data: MyData; onChange: (d: MyData) => void }) {
  const { MathHost, createEvalFn, detectPlotType } = requireCapabilityApi<MathRenderingApi>('math-rendering');

  const curves: Curve[] = data.functions.map((f) => {
    const { plotType, expression } = detectPlotType(f.expression);
    if (plotType === 'y-of-x') {
      const { fn } = createEvalFn(expression, data.parameters);
      if (!fn) return { kind: 'unsupported', id: f.id, error: 'parse failed', color: f.color };
      return { kind: 'fnOfX', id: f.id, fn, color: f.color, style: f.style, lineWidth: f.lineWidth };
    }
    // ... 其他 plotType
  });

  return (
    <MathHost
      viewBox={{ x: data.domain, y: data.range }}
      height={350}
      curves={curves}
      annotations={data.annotations}
      onViewportChange={(viewport) => { /* transient state, 不进 PM */ }}
    />
  );
}
```

## 设计要点

### 1. Prop-driven 黑盒

`MathHost` 接受**声明式 props**(viewBox / curves / annotations / tools 等),内部决定使用哪些 Mafs 元件 + 如何组合。driver 0 接触 Mafs 元件,未来切换渲染引擎(如 D3 / Three.js)不影响 driver。

### 2. Curve discriminated union

`Curve` 是 `{ kind: 'fnOfX' | 'parametric' | 'polar' | 'verticalLine' | 'unsupported', ... }` discriminated union。capability 内部 switch 渲染对应 Mafs 元件。

新增 plot 类型 = 加 union 分支 + 在 MathHost 内加 case,driver 用法不变。

### 3. Viewport 持久化拆分

- `viewBox`(props,driver 控)= **PM 持久化**的画布范围 = "reset 默认起点"
- 内部 pan/zoom 由 Mafs 自管,通过 `onViewportChange` 暴露 transient state(driver 接收但不必写 PM,避免 undo 堆膨胀)

### 4. 计算 API 分离

`MathHost` 不直接执行 LaTeX/expression → fn 转换,driver 在 props 装配前调:
- `createEvalFn(expr, params)` — mathjs 编译 + LaTeX fallback
- `extractParameters(expr)` — AST 遍历 free symbols
- `latexToMathjs(latex)` / `latexToFunction(latex)` — LaTeX 转换 + 分段函数
- `numericalDerivative(fn)` — 数值微分
- `detectDiscontinuities` / `buildSegments` — 间断检测 + 连续段
- `detectPlotType(expr)` — 启发式判断 y-of-x / vertical / parametric

driver 拿到 `fn: (x) => number` + segments 后,构造 `Curve` 数组传给 MathHost。

## 文件结构

```
src/capabilities/math-rendering/
├── README.md              本文件
├── index.ts               capability 注册 + 模块级 export
├── types.ts               对外类型(0 import mafs/mathjs)
├── host/
│   ├── MathHost.tsx       React Host(Mafs 画布,prop-driven)
│   └── mafs-style.ts      mafs/core.css import + 主题覆盖
└── compute/
    ├── evaluator.ts       createEvalFn / extractParameters / numericalDerivative
    ├── discontinuity.ts   detectDiscontinuities / buildSegments
    ├── plot-detect.ts     detectPlotType
    └── latex-converter.ts LaTeX → mathjs(compute-engine 收敛)
```

## API 速查

见 [./types.ts](./types.ts)。

`MathRenderingApi` 对外暴露:

| 字段 | 类型 | 说明 |
|------|------|------|
| `MathHost` | `ComponentType<MathHostProps>` | React 画布组件 |
| `createEvalFn` | `(expr, params, srcLatex?) => EvalResult` | 表达式 → 求值函数 |
| `extractParameters` | `(expr) => string[]` | 提取 free symbols(参数名) |
| `numericalDerivative` | `(fn) => fn'` | 数值微分(h=1e-6) |
| `detectDiscontinuities` | `(fn, xMin, xMax) => number[]` | 间断点检测 |
| `buildSegments` | `(fn, discs, xMin, xMax) => ContSeg[]` | 连续段构建 |
| `detectPlotType` | `(expr) => { plotType, expression }` | 启发式 plot type |
| `latexToMathjs` | `(latex) => string \| null` | LaTeX → mathjs 字符串 |
| `latexToFunction` | `(latex) => fn \| null` | LaTeX → 求值函数(含分段) |
| `latexToFunctionWithEndpoints` | `(latex) => PiecewiseResult \| null` | LaTeX → 求值函数 + 端点 |

## Phase 路线

| Phase | 状态 | 内容 |
|-------|------|------|
| 1A | ✅ 当前 | capability 骨架 + Mafs/mathjs/compute-engine 收敛 + Host(prop-driven) |
| 1B | 待 | driver 内 math-visual block 接入(inline 模式) |
| 2 | 待 | 全屏 + 9 件工具(通过 MathHost 的 `overlays` props 配置式接入) |
| 3 | 待 | help-panel + 跨 block 拖入 |

## 不在 Phase 1A 范围内

- ❌ driver 内 math-visual block(Phase 1B 起,通过 capability API 消费)
- ❌ 工具叠加(切线/法线/积分/特征点)— Phase 2 通过 `overlays` props 扩展
- ❌ light theme(占位)
- ❌ Mafs 默认 pan/zoom 之外的自定义交互
