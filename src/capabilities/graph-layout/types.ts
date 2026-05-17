/**
 * graph-layout capability — 对外类型(Phase 1B)
 *
 * 单点屏障核心:**本 capability 是 V2 唯一允许 import elkjs 和
 * @mermaid-js/layout-elk 的位置**。
 *
 * 未来规划用 ELK 的业务(详见 docs/tasks/cm6-elk-capability-refactor.md §背景):
 * - 画板 graph canvas — 自动布局起点(用户拖完后凝结)
 * - BPMN 2.0 — `layered` (sugiyama)
 * - Mind map — `mrtree` / `radial`
 * - 知识图谱 — `force` / `stress` / `layered`
 * - mermaid — 通过 `getMermaidElkLoader()` 暴露给 mermaid.registerLayoutLoaders
 *
 * **本文件 0 import elkjs**(types.ts 只暴露与 SDK 无关的契约;getElkInstance / getMermaidElkLoader
 * 返回值用 unknown 抽象,消费方按需 cast 或直接传给下游 SDK)。
 */

// ─────────────────────────────────────────────────────────
// 通用输入 / 输出
// ─────────────────────────────────────────────────────────

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LayoutNodeInput {
  id: string;
  width: number;
  height: number;
}

export interface LayoutEdgeInput {
  id: string;
  source: string;
  target: string;
}

export interface LayoutInput {
  nodes: LayoutNodeInput[];
  edges: LayoutEdgeInput[];
}

export interface LayoutNodeResult {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutEdgeSection {
  startPoint: LayoutPoint;
  endPoint: LayoutPoint;
  bendPoints?: LayoutPoint[];
}

export interface LayoutEdgeResult {
  id: string;
  sections: LayoutEdgeSection[];
}

export interface LayoutResult {
  nodes: LayoutNodeResult[];
  edges: LayoutEdgeResult[];
  /** 整图 bbox(根节点的 width/height) */
  width: number;
  height: number;
}

// ─────────────────────────────────────────────────────────
// LayoutOptions(对齐 ELK 的常用算法 + 方向)
// ─────────────────────────────────────────────────────────

/**
 * 算法名 — ELK 官方常用算法集子集。
 * 详见 https://eclipse.dev/elk/reference/algorithms.html
 */
export type LayoutAlgorithm =
  | 'layered'   // sugiyama 风格分层(流程图 / BPMN 默认)
  | 'mrtree'    // 多根树(Mind map 默认)
  | 'force'     // 力导向
  | 'radial'    // 辐射树
  | 'stress'    // 应力模型
  | 'box';      // box-packing

export type LayoutDirection = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

export interface LayoutSpacing {
  /** 节点之间间距(同层) */
  node?: number;
  /** 层与层之间间距(layered 算法) */
  layer?: number;
  /** 边之间最小间距 */
  edge?: number;
}

export interface LayoutOptions {
  algorithm: LayoutAlgorithm;
  direction?: LayoutDirection;
  spacing?: LayoutSpacing;
  /**
   * 额外 ELK options 透传(string→string)。
   * 详见 https://eclipse.dev/elk/reference/options.html
   */
  extra?: Record<string, string>;
}

// ─────────────────────────────────────────────────────────
// Registry API(view / driver / capability 通过 requireCapabilityApi 拿)
// ─────────────────────────────────────────────────────────

export interface GraphLayoutApi {
  /**
   * 计算布局,返回每个节点的 x/y + 边的 polyline。
   *
   * 内部包装 elkjs:input 转 ElkNode → elk.layout() → 平铺回 LayoutResult。
   */
  computeLayout(input: LayoutInput, options: LayoutOptions): Promise<LayoutResult>;
  /**
   * 取 elkjs 实例(给某些 SDK 需要原始 ELK 引用的特殊用法)。
   * 类型 = `import('elkjs').default` 构造出的实例;消费方按需 cast。
   *
   * **不推荐业务方直接用** — 优先走 computeLayout。getElkInstance 仅作逃生通道。
   */
  getElkInstance(): unknown;
  /**
   * 取给 mermaid 用的 ELK loader。
   * 类型 = `import('@mermaid-js/layout-elk').default`;直接传给
   * `mermaidModule.registerLayoutLoaders(loader)`。
   *
   * mermaid v11+ 专用。
   */
  getMermaidElkLoader(): unknown;
}
