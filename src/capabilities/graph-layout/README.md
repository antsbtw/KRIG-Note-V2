# graph-layout capability

> v0.1 · Phase 1B · ELK 单点屏障

## 职责

封装 **elkjs**(Eclipse Layout Kernel 的 JS 移植),对外提供通用"图布局算法"接口 + mermaid 专用 loader adapter。

未来给画板自动布局 / BPMN / Mind map / 知识图谱 / mermaid 五类业务统一调用。

## 屏障原则

**本 capability 是 V2 唯一允许 import `elkjs` 和 `@mermaid-js/layout-elk` 的位置**(对齐 [canvas-rendering 的 Three.js 单点屏障](../canvas-rendering/) + [code-editing 的 CM6 单点屏障](../code-editing/) 模式)。

其他位置(view / driver / 其他 capability)0 import,通过 `requireCapabilityApi<GraphLayoutApi>('graph-layout')` 拿 API。

ESLint 规则:

```
no-restricted-imports:
  - elkjs                      只允许 src/capabilities/graph-layout/ 内
  - @mermaid-js/layout-elk     同上
```

## 业务方接入示例 — 通用布局

```ts
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { GraphLayoutApi } from '@capabilities/graph-layout/types';

const layout = requireCapabilityApi<GraphLayoutApi>('graph-layout');

const result = await layout.computeLayout(
  {
    nodes: [
      { id: 'A', width: 80, height: 40 },
      { id: 'B', width: 80, height: 40 },
      { id: 'C', width: 80, height: 40 },
    ],
    edges: [
      { id: 'e1', source: 'A', target: 'B' },
      { id: 'e2', source: 'B', target: 'C' },
    ],
  },
  {
    algorithm: 'layered',
    direction: 'RIGHT',
    spacing: { node: 50, layer: 60 },
  },
);

// result.nodes: [{id, x, y, width, height}, ...]
// result.edges: [{id, sections:[{startPoint, endPoint, bendPoints?}]}]
// result.width / result.height: 整图 bbox
```

## 业务方接入示例 — mermaid 注册 ELK loader

```ts
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { GraphLayoutApi } from '@capabilities/graph-layout/types';

const mermaidModule = (await import('mermaid')).default;
const layout = requireCapabilityApi<GraphLayoutApi>('graph-layout');

// getMermaidElkLoader 返回 Promise(lazy import @mermaid-js/layout-elk)
const elkLoader = await layout.getMermaidElkLoader();
(mermaidModule as unknown as {
  registerLayoutLoaders: (l: unknown) => void;
}).registerLayoutLoaders(elkLoader);

mermaidModule.initialize({ flowchart: { defaultRenderer: 'elk' } });
```

## 算法 preset(可选,业务方按需取)

| preset | 算法 | 适用 |
|--------|------|------|
| `layeredPreset` | layered (sugiyama) | 流程图 / BPMN / 有向知识图谱 |
| `mrtreePreset` | mrtree | Mind map / 树状结构 |
| `forcePreset` | force | 知识图谱 / 网状关系 |
| `radialPreset` | radial | 中心-叶 拓扑 |
| `stressPreset` | stress | 节点距离 ∝ 语义相似度 |

直接 import:

```ts
import { layeredPreset } from '@capabilities/graph-layout';
// 或:requireCapabilityApi('graph-layout') 不暴露 preset(api 接口纯方法,不挂常量)
// 业务方按需 import 模块级 preset 即可(driver/slot 允许)
```

> 注:**view 层**不允许直 import preset(走 capability api);driver / 其他 capability 允许走模块级 import(与 shape-library 双导出模式一致)。

## 依赖

- `elkjs@0.11.1`(顶层装,Phase 1B 引入)
- `@mermaid-js/layout-elk@0.2.1`(已存在,Phase 1B 接管 import 路径;其内部包了 elkjs@0.9.3)

两者底层 elkjs 版本不同(0.11.1 vs 0.9.3)是允许的 — mermaid loader 自带闭包内的 elkjs,我们的 computeLayout 走顶层 0.11.1。语义独立。

## 文件结构

```
src/capabilities/graph-layout/
├── README.md              本文件
├── index.ts               capability 注册 + 模块级 re-export
├── types.ts               对外类型(0 import elkjs)
├── elk-singleton.ts       lazy 全局 ELK 实例
├── compute-layout.ts      LayoutInput → elk.layout() → LayoutResult
├── algorithms/
│   ├── layered.ts         5 个 preset(纯 LayoutOptions 配置)
│   ├── mrtree.ts
│   ├── force.ts
│   ├── radial.ts
│   └── stress.ts
└── adapters/
    └── mermaid-elk-loader.ts  给 mermaid v11+ registerLayoutLoaders 用
```

## API

见 [./types.ts](./types.ts)。

`GraphLayoutApi`:
- `computeLayout(input, options) → Promise<LayoutResult>`
- `getElkInstance() → unknown` — 逃生通道,**不推荐业务方直接用**
- `getMermaidElkLoader() → unknown`(实际是 Promise<unknown>) — 给 mermaid 用

## Phase 路线

| Phase | 状态 | 内容 |
|-------|------|------|
| 1B | ✅ 当前 | capability 骨架 + computeLayout + mermaid adapter |
| 2 | 待 | mermaid-renderer.ts 切换到 capability |
| 后续 | 待 | 画板 graph canvas auto-layout / BPMN / Mind / 知识图谱 view 接入 |

## 不在 Phase 1 范围内

- ❌ 画板自动布局接入(等真业务方启动)
- ❌ ELK web worker 模式(默认走主线程同步;后续看性能再上 worker)
- ❌ 增量布局 / dirty 节点 patch(后续按需)
- ❌ port-based magnet routing(elkjs 支持 ports,但 V1 画板 magnet 体系尚未对齐)
