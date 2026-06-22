/**
 * shape-library capability — 对外类型(L5-G2)
 *
 * 严格对齐 docs/10-business-design/graph/library/Library.md §2.1(ShapeDef)
 * 和 §3.1(SubstanceDef),V1 types.ts 直迁 + 拆离 Instance 系(归 graph-library-store /
 * canvas-rendering 各自 types,见决策 G2-10=B)。
 *
 * **P1-1 严格版屏障核心**:本文件 0 import three / 0 含 THREE.* 类型 /
 * 0 含 'three-mesh' / 'composite' 字面量;`evaluate` 方法只输出 `EvaluatedPath`
 * 纯数据(SVG path d 字符串 + magnets + textBox)。view / family-tree projection /
 * canvas-rendering 内部消费 EvaluatedPath 时各自把"路径表达式"转成自己的渲染态
 * (canvas-rendering 内部 path-to-three.ts 是唯一搬 THREE.Shape 的位置,G3 段实现)。
 */

// ─────────────────────────────────────────────────────────
// Shape
// ─────────────────────────────────────────────────────────

export type ShapeCategory = 'basic' | 'arrow' | 'flowchart' | 'line' | 'text';

/**
 * 几何范式(L5-G6c §2 统一范式;取代旧 `renderer: parametric|static-svg|custom`)。
 * - `parametric`:path/params/guides/handles 公式驱动(现状能力,载荷留 ShapeDef 顶层,D1=(b))
 * - `svg`:svgPath + viewBox(阶段 B 真消费;A 先留字段)
 * - `text`:无几何(纯文字框);文字层走 NodeRenderer 统一 fillTextLayer
 */
export type GeometryKind = 'parametric' | 'svg' | 'text';
export type AspectKind = 'variable' | 'fixed';
export type ParamUnit = 'ratio' | 'px' | 'deg';
export type ShapeSource = 'builtin' | 'plugin' | 'imported';

/** 公式中可出现的值:数字字面量、字符串(内置标识符 / 公式名)、嵌套公式 op */
export type FormulaValue = number | string | FormulaOp;

/**
 * OOXML 17 个操作符之一(详见 Library.md §2.2)
 * args 元素本身可以是字面量或嵌套 op,允许递归表达式
 */
export interface FormulaOp {
  op:
    | '*/' | '+-' | '+/' | 'abs' | 'sqrt' | 'mod' | 'pin'
    | 'max' | 'min' | 'val' | 'sin' | 'cos' | 'tan'
    | 'at2' | 'cat2' | 'sat2' | '?:';
  args: FormulaValue[];
}

export interface ShapeParam {
  type: 'number';
  default: number;
  min?: number;
  max?: number;
  label?: string;
  unit?: ParamUnit;
}

export interface ShapeGuide {
  name: string;
  op: FormulaOp['op'];
  args: FormulaValue[];
}

/**
 * 路径命令(对齐 SVG + OOXML pathLst)
 * 每个坐标参数都可以是数字或公式标识符
 */
export type PathCmd =
  | { cmd: 'M'; x: FormulaValue; y: FormulaValue }
  | { cmd: 'L'; x: FormulaValue; y: FormulaValue }
  | {
      cmd: 'A';
      rx: FormulaValue;
      ry: FormulaValue;
      x: FormulaValue;
      y: FormulaValue;
      'large-arc-flag'?: 0 | 1;
      'sweep-flag'?: 0 | 1;
    }
  | { cmd: 'Q'; x1: FormulaValue; y1: FormulaValue; x: FormulaValue; y: FormulaValue }
  | {
      cmd: 'C';
      x1: FormulaValue; y1: FormulaValue;
      x2: FormulaValue; y2: FormulaValue;
      x: FormulaValue;  y: FormulaValue;
    }
  | { cmd: 'Z' };

export interface MagnetPoint {
  id: string;
  x: number;  // 归一化 0..1
  y: number;
}

export interface ShapeHandle {
  param: string;
  axis: 'x' | 'y';
  from: FormulaValue;
  min?: FormulaValue;
  max?: FormulaValue;
  /**
   * 拖点单位(L5-G6c §3.5;阶段 A 定字段,阶段 B 接 UI)。
   * - `'ratio'`:相对节点尺寸(拖动反算时乘 w/h)
   * - `'px'`:绝对像素(箭头固定像素 → 拉长只加长箭身、三角不变形)
   */
  unit?: 'px' | 'ratio';
}

export interface TextBox {
  l: FormulaValue;
  t: FormulaValue;
  r: FormulaValue;
  b: FormulaValue;
}

export type DashType = 'solid' | 'dash' | 'dot' | 'dashDot' | 'longDash';
export type ArrowEndKind =
  | 'none' | 'arrow' | 'triangle' | 'diamond' | 'oval' | 'stealth';

export interface FillStyle {
  type: 'none' | 'solid';
  color?: string;
  transparency?: number; // 0..1
}

export interface LineStyle {
  type: 'none' | 'solid';
  color?: string;
  width?: number;
  dashType?: DashType;
}

export interface ArrowStyle {
  begin?: ArrowEndKind;
  end?: ArrowEndKind;
}

export interface DefaultStyle {
  fill?: FillStyle;
  line?: LineStyle;
  arrow?: ArrowStyle;
}

/**
 * Geometry — 几何范式锚点(L5-G6c §2 统一范式,D1=(b))。
 *
 * `kind` 是单一判定锚点(取代旧 `renderer` 字段);几何载荷(path/params/guides/
 * handles)按 D1=(b) 保留在 ShapeDef 顶层不下沉,阶段 A 改动最小、平移风险低,
 * 完全收口留阶段 B/C。
 */
export interface ShapeGeometry {
  kind: GeometryKind;
  /** `kind:'svg'` 用(阶段 B 真消费;A 先留字段):贴 SVG 抽出的 path d 字符串 */
  svgPath?: string;
  /** `kind:'svg'` 的视框(缺省时由 bbox 算,阶段 B) */
  viewBox?: { w: number; h: number };
}

/**
 * Shape 定义(JSON schema 镜像;L5-G6c 统一范式)。
 * - `geometry.kind:'parametric'`:90% shape,纯 JSON path/params/guides 公式描述
 * - `geometry.kind:'svg'`:贴 SVG path(阶段 B)
 * - `geometry.kind:'text'`:无几何,纯文字框(textGrows:true)
 */
export interface ShapeDef {
  id: string;                  // krig.{category}.{name}
  category: ShapeCategory;
  name: string;
  /** 几何范式锚点(取代旧 renderer 字段;L5-G6c §2) */
  geometry: ShapeGeometry;

  viewBox: { w: number; h: number };
  aspect: AspectKind;

  /** parametric 几何载荷(D1=(b) 保留顶层) */
  params?: Record<string, ShapeParam>;
  guides?: ShapeGuide[];
  path?: PathCmd[];

  magnets?: MagnetPoint[];
  handles?: ShapeHandle[];
  textBox?: TextBox;

  /**
   * 文字溢出是否撑高节点(L5-G6c §2 / L5G6b §3.2)。
   * - 文字框(kind:'text')= true:内容多自动撑高
   * - 几何 shape = false / 缺省:文字固定框,溢出可见(不改几何)
   */
  textGrows?: boolean;
  /** Picker 自由归类备用(L5-G6c §2;阶段 C 用) */
  tags?: string[];

  default_style?: DefaultStyle;

  source: ShapeSource;
}

// ─────────────────────────────────────────────────────────
// Substance
// ─────────────────────────────────────────────────────────

export type SubstanceSource = 'builtin' | 'user';

export interface ComponentTransform {
  x: number;
  y: number;
  w?: number;
  h?: number;
  rotation?: number;
  anchor?: 'topLeft' | 'center' | 'bottomRight';
}

/**
 * Line component 的内部端点引用:
 * - "comp:N" — 引用同一 substance 内 components[N] 的某 magnet
 * 例:{ component: 'comp:0', magnet: 'E' } = 第 0 个 component 的 East magnet
 */
export interface SubstanceLineEndpoint {
  /** "comp:N" 形式,N 是同一 substance components 数组的下标 */
  component: string;
  /** magnet id(N/S/E/W 等) */
  magnet: string;
}

export interface SubstanceComponent {
  type: 'shape' | 'substance';
  ref: string;                          // shape id 或 substance id
  transform: ComponentTransform;
  style_overrides?: Record<string, unknown>;
  /** 组件在 substance 内的角色(供 visual_rules 和 variant 引用) */
  binding?: string;                     // 如 'frame' | 'label' | 'icon'
  /** line 类 component 用:两端绑同 substance 内其他 component 的 magnet */
  endpoints?: [SubstanceLineEndpoint, SubstanceLineEndpoint];
}

export interface VisualRule {
  if: string;                           // 表达式字符串,运行时 eval
  apply: Record<string, unknown>;       // path-style key → value
}

export interface SubstanceDef {
  id: string;
  category?: string;
  name: string;
  description?: string;

  components: SubstanceComponent[];
  default_props?: Record<string, unknown>;
  visual_rules?: VisualRule[];

  source: SubstanceSource;
  created_at?: number;
  created_by?: string;
}

// ─────────────────────────────────────────────────────────
// 求值 / 渲染
// ─────────────────────────────────────────────────────────

/** 求值上下文 — 节点目标尺寸 + 用户调整的参数(覆盖 ShapeParam.default) */
export interface EvaluateContext {
  width: number;
  height: number;
  params?: Record<string, number>;
}

/**
 * 求值输入(传入 evaluate(id, props, ctx) 的 props 字段)— v1 字段空,
 * 留接口允许未来扩展(如 props 传 substance prop 给 visual_rules 求值).
 */
export interface EvaluateInput {
  // 暂未使用;substance 的 default_props 由 SubstanceDef 自己持有
}

/**
 * Shape 求值产物 — 纯数据,**0 含 THREE.* 类型**.
 *
 * canvas-rendering 内部消费:把 d 字符串喂给 path-to-three 工具拿 THREE.Shape,
 * 再生成 Mesh.其他消费者(family-tree projection / Library Picker 缩略图等)
 * 各自把 d 字符串转成自己需要的形态(SVG / preview thumb / etc.).
 *
 * 形态对齐 V1 ParametricOutput(plugins/graph/library/shapes/renderers/parametric.ts):
 * V1 输出 `{ d, width, height, magnets, textBox }`,V2 改名为 EvaluatedPath
 * (语义"求值后的路径表达式"更精确,且避开 V1 RenderOutput.kind 含 'three-mesh'
 * 字面量违反 P1-1 屏障的问题).
 */
export interface EvaluatedPath {
  /** SVG path d 字符串(M / L / A / Q / C / Z;4 位小数四舍五入) */
  d: string;
  /** 实际尺寸透传 */
  width: number;
  height: number;
  /** magnets 已转世界坐标(归一化 × 宽高) */
  magnets: Array<{ id: string; x: number; y: number }>;
  /** 文本框(已求值) */
  textBox?: { l: number; t: number; r: number; b: number };
}

export interface ShapePack {
  id: string;                           // pack 自己的 id(命名空间)
  shapes: ShapeDef[];
}

export interface SubstancePack {
  id: string;
  substances: SubstanceDef[];
}

// ─────────────────────────────────────────────────────────
// view 业务路径 API
// ─────────────────────────────────────────────────────────

export interface ShapeLibraryApi {
  shapes: {
    register(def: ShapeDef): void;
    get(id: string): ShapeDef | null;
    list(): ShapeDef[];
    listByCategory(category: ShapeCategory): ShapeDef[];
    /**
     * 求值:把 ShapeDef.path + params + guides 求值成"路径表达式数据".
     * 输出 EvaluatedPath(0 含 THREE 类型);id 不存在或 geometry.kind != 'parametric' 返 null.
     */
    evaluate(
      id: string,
      props: EvaluateInput,
      ctx: EvaluateContext,
    ): EvaluatedPath | null;
  };
  substances: {
    register(def: SubstanceDef): void;
    get(id: string): SubstanceDef | null;
    list(): SubstanceDef[];
    listByCategory(category: string): SubstanceDef[];
    // evaluate 留 v1.5+ 实施(G2-7=B 决策,composer / visual-rules 留空壳)
  };
}
