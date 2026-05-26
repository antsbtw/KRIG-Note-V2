/**
 * math-rendering capability — 对外类型(Phase 1A)
 *
 * 单点屏障核心:**本 capability 是 V2 唯一允许 import `mafs` / `mathjs` /
 * `@cortex-js/compute-engine` 的位置**。其他 view / driver / capability 通过
 * `requireCapabilityApi<MathRenderingApi>('math-rendering')` 拿 MathHost + 计算 API。
 *
 * 设计对齐参考:capabilities/code-editing/types.ts(命令式 Handle + Host props 模式)
 * 详见 docs/tasks/math-visual-migration-prompt.md §D1。
 *
 * **本文件 0 import mafs / mathjs / @cortex-js/compute-engine**(types.ts 只暴露
 * 与 SDK 无关的契约;实际 SDK 类型在 host/ + compute/ 内消费)。
 */

import type { ComponentType } from 'react';

// ─────────────────────────────────────────────────────────
// Curve discriminated union
// ─────────────────────────────────────────────────────────

/** 通用曲线样式 */
export interface CurveStyle {
  color: string;
  style?: 'solid' | 'dashed' | 'dotted';
  lineWidth?: number;
  opacity?: number;
  /** 曲线 label(LaTeX 文本,如 "f(x) = x^2");缺省不显示 */
  label?: string;
  /** label 位置(数据坐标);缺省由 MathHost 自动计算 */
  labelPos?: [number, number];
}

/** y = f(x) — 最常见 */
export interface FnOfXCurve extends CurveStyle {
  kind: 'fnOfX';
  id: string;
  fn: (x: number) => number;
  /** 限定 x 范围(默认 viewBox.x);分段函数时按 segments 拆 */
  segments?: Array<{ domain: [number, number] }>;
  /** 数值导数曲线(虚线、半透明) */
  derivative?: boolean;
}

/** 参数方程 x(t), y(t) */
export interface ParametricCurve extends CurveStyle {
  kind: 'parametric';
  id: string;
  xy: (t: number) => [number, number];
  tDomain: [number, number];
}

/** 极坐标 r(θ) — 渲染时内部转 [r·cos θ, r·sin θ] */
export interface PolarCurve extends CurveStyle {
  kind: 'polar';
  id: string;
  r: (theta: number) => number;
  thetaDomain: [number, number];
}

/** 垂直直线 x = c */
export interface VerticalLineCurve extends CurveStyle {
  kind: 'verticalLine';
  id: string;
  x: number;
}

/** 隐式方程 F(x, y) = 0 — 渲染时 marching squares 算等值线
 * F(x,y) 返回标量,曲线 = { (x,y) | F(x,y) = 0 } */
export interface ImplicitCurve extends CurveStyle {
  kind: 'implicit';
  id: string;
  fn: (x: number, y: number) => number;
  /** 网格分辨率(默认 100);x/y 方向各 N 个采样格子 */
  resolution?: number;
}

/** 表达式无法解析时的占位 — 不渲染,但保留 id+error 给调用方显示 */
export interface UnsupportedCurve {
  kind: 'unsupported';
  id: string;
  error: string;
}

export type Curve =
  | FnOfXCurve
  | ParametricCurve
  | PolarCurve
  | VerticalLineCurve
  | ImplicitCurve
  | UnsupportedCurve;

// ─────────────────────────────────────────────────────────
// 标注 / 间断端点
// ─────────────────────────────────────────────────────────

/** 关键点标注(画布上一个圆点 + 标签) */
export interface MathAnnotation {
  id: string;
  curveId: string;        // 对应 Curve.id;capability 会查 fn(x) 算 y
  x: number;
  label?: string;
  color?: string;
  pointSize?: number;
}

/** 分段函数端点(空心 ○ / 实心 ●) */
export interface MathEndpoint {
  curveId: string;
  x: number;
  y: number;
  closed: boolean;        // true=实心,false=空心
  color?: string;
}

// ─────────────────────────────────────────────────────────
// Overlay specs(全屏工具配置,Phase 2)
//
// 9 件工具迁 capability 内部,driver 通过 MathHostProps.overlays 传配置 + 回调。
// 设计:每类工具传 spec[] (含数据 id + 显示属性) + 回调
// (onTangentMove / onAnnotationMove / onIntegralMove 等)。
// ─────────────────────────────────────────────────────────

/** 切线工具配置(对应 driver TangentLine 数据) */
export interface TangentSpec {
  id: string;
  curveId: string;     // 关联 curve.id(必须是 fnOfX 类型,内部 derivative 求斜率)
  x: number;
  color?: string;
  fixed?: boolean;     // false = 可拖动(MovablePoint),true = 静态
  showSlope?: boolean; // 显示 "k = 斜率"
}

/** 法线工具配置(对应 driver NormalLine) */
export interface NormalSpec {
  id: string;
  curveId: string;
  x: number;
  color?: string;
  fixed?: boolean;
  showSlope?: boolean;
}

/** 积分区域工具配置(对应 driver IntegralRegion) */
export interface IntegralSpec {
  id: string;
  curveId: string;
  a: number;
  b: number;
  color?: string;
  showValue?: boolean; // 显示面积值
}

/** 特征点工具配置(对应 driver FeaturePoint;capability 也支持自检测) */
export interface FeaturePointSpec {
  id: string;
  curveId: string;
  x: number;
  y: number;
  type: 'maximum' | 'minimum' | 'zero' | 'inflection';
}

/** 标注工具配置(对应 driver Annotation) */
export interface AnnotationSpec {
  id: string;          // capability 用,driver 端可用 idx 同步
  curveId: string;
  x: number;
  label?: string;      // 默认 ANNOTATION_LABELS[idx]
  color?: string;
  showCoord?: boolean; // 默认 true
}

/** 黎曼和工具配置 */
export interface RiemannSpec {
  curveId: string;
  a: number;
  b: number;
  n: number;
  mode: 'left' | 'right' | 'midpoint';
  color?: string;
  showSum?: boolean;
}

/**
 * 工具叠加层(Phase 2);driver 全屏 Panel 拼好后传给 MathHost。
 *
 * 设计:driver 用 PM 持久数据(tangentLines/normalLines/integralRegions/...) 转换。
 * 这里类型与 driver types 一致(curveId == functionId 同义)。
 *
 * 用户在画布上拖动 MovablePoint → onOverlayChange 回调,driver 写回 PM。
 */
export interface OverlaysConfig {
  tangents?: TangentSpec[];
  normals?: NormalSpec[];
  integrals?: IntegralSpec[];
  features?: FeaturePointSpec[];
  /** 标注选中状态(单选 idx 显示为 MovablePoint,多选用框选高亮)
   *  设计:annotations[] + selectedAnnotationIdx + selectedAnnotationIdxs 三件套独立 prop */
  annotations?: AnnotationSpec[];
  selectedAnnotationIdx?: number | null;
  selectedAnnotationIdxs?: Set<number>;
  /** 黎曼和(单实例,跟随当前选中积分;driver 决定何时塞) */
  riemann?: RiemannSpec | null;
  /** Hover 坐标提示(开关) */
  hoverCoords?: boolean;
  /** 端点 ○/● 标记(开关) — 由 MathHost 根据 fnOfX.segments 自动计算 */
  showEndpoints?: boolean;
}

/** Overlay 用户交互回调集合(driver 全屏 Panel 接收) */
export interface OverlayCallbacks {
  /** 切线点拖动 → 新 x 坐标 */
  onTangentMove?: (id: string, newX: number) => void;
  /** 法线点拖动 → 新 x 坐标 */
  onNormalMove?: (id: string, newX: number) => void;
  /** 积分区域 a / b 边界拖动 */
  onIntegralMove?: (id: string, key: 'a' | 'b', newX: number) => void;
  /** 标注点 onSelect(单击非选中标注切换单选) */
  onAnnotationSelect?: (idx: number) => void;
  /** 标注点拖动(MovablePoint 单选时) */
  onAnnotationMove?: (idx: number, newX: number) => void;
}

// ─────────────────────────────────────────────────────────
// MathHost(画布)
// ─────────────────────────────────────────────────────────

/** 画布坐标范围 */
export interface ViewBox {
  x: [number, number];
  y: [number, number];
}

/** 坐标轴 / 网格配置 — driver 直传,capability 内部转 Mafs Coordinates props */
export interface AxisDisplayConfig {
  showGrid?: boolean;
  gridStyle?: 'solid' | 'dashed' | 'dotted';
  showAxes?: boolean;
  showAxisArrows?: boolean;
  showNumbers?: boolean;
  xLabel?: string;
  yLabel?: string;
  xStep?: number | null;   // null = 自动
  yStep?: number | null;
}

/** Viewport 变化(pan/zoom)— transient 通知,driver 通常不必写 PM */
export interface ViewportState {
  x: [number, number];
  y: [number, number];
}

export interface MathHostProps {
  /** 初始可视范围(driver 持久化;pan/zoom 走 onViewportChange 不直接改此 prop) */
  viewBox: ViewBox;
  /** 画布高度 px;capability 自管宽度(撑满容器) */
  height: number;
  /** 曲线列表 */
  curves: Curve[];
  /** 关键点标注 */
  annotations?: MathAnnotation[];
  /** 分段函数端点 */
  endpoints?: MathEndpoint[];
  /** 坐标轴显示配置 */
  axis?: AxisDisplayConfig;
  /** 允许滚轮缩放(走 Mafs 内置;默认 true) */
  zoom?: boolean;
  /** 允许拖拽平移(走 Mafs 内置;默认 true) */
  pan?: boolean;
  /** Mafs 的 preserveAspectRatio;默认 false(允许 fit/1:1 模式由 driver 计算 viewBox)。
   * Mafs 0.21 API:`false`(默认) 或 `'contain'`(保 1:1 像素比) */
  preserveAspectRatio?: false | 'contain';
  /** Transient viewport 通知(pan/zoom 触发);driver 视情况持久化或忽略 */
  onViewportChange?: (vp: ViewportState) => void;

  /** 曲线 label 拖动回调(用户拖到新位置后触发);driver 持久化进 FunctionEntry.labelPos */
  onLabelMove?: (curveId: string, pos: [number, number]) => void;

  // ── Overlay 工具(Phase 2 全屏接入) ──
  /** 工具叠加层配置 — 切线/法线/积分/特征点/标注/黎曼和/HoverCoords/端点 */
  overlays?: OverlaysConfig;
  /** Overlay 交互回调(driver 写回 PM) */
  overlayCallbacks?: OverlayCallbacks;
  /** 点大小(标注/特征/端点都用) — 默认 6 */
  pointSize?: number;
}

// ─────────────────────────────────────────────────────────
// Compute API(纯函数,SDK 收敛)
// ─────────────────────────────────────────────────────────

/** 参数定义(滑块绑定) */
export interface MathParameter {
  name: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
}

/** createEvalFn 结果 */
export interface EvalResult {
  fn: ((x: number) => number) | null;
  error: string | null;
  /** 分段函数的端点信息(普通表达式为空) */
  endpoints: EndpointInfo[];
}

/** 分段函数边界端点 */
export interface EndpointInfo {
  x: number;
  closed: boolean;
  branchIndex: number;
}

/** 分段函数解析结果 */
export interface PiecewiseResult {
  evalFn: (x: number) => number;
  endpoints: EndpointInfo[];
}

/** 连续段(间断处分割后的) */
export interface ContSeg {
  domain: [number, number];
  leftEndpoint: { x: number; y: number; closed: boolean };
  rightEndpoint: { x: number; y: number; closed: boolean };
}

/** PlotType 启发式判定 */
export type PlotType = 'y-of-x' | 'vertical-line' | 'parametric' | 'polar' | 'implicit';

// ─────────────────────────────────────────────────────────
// Registry API(view/driver 通过 requireCapabilityApi 拿)
// ─────────────────────────────────────────────────────────

export interface MathRenderingApi {
  /** React 画布 Host 组件 */
  Host: ComponentType<MathHostProps>;

  // ── 表达式求值 ──
  /** 表达式 → 求值函数(mathjs 编译 + LaTeX fallback + 分段函数支持) */
  createEvalFn(
    expression: string,
    params: MathParameter[],
    sourceLatex?: string,
  ): EvalResult;
  /** 提取表达式中的 free symbols(参数名;独立变量 x/t/theta 与内置函数排除) */
  extractParameters(expression: string): string[];
  /** 数值微分(h=1e-6 中心差) */
  numericalDerivative(fn: (x: number) => number): (x: number) => number;

  // ── 间断检测 / 分段 ──
  detectDiscontinuities(
    fn: (x: number) => number,
    xMin: number,
    xMax: number,
  ): number[];
  buildSegments(
    fn: (x: number) => number,
    discs: number[],
    xMin: number,
    xMax: number,
  ): ContSeg[];

  // ── plot type 启发式 ──
  detectPlotType(expression: string): { plotType: PlotType; expression: string; displayExpression: string };

  // ── LaTeX 转换 ──
  /** LaTeX → mathjs 表达式字符串(失败返 null) */
  latexToMathjs(latex: string): string | null;
  /** LaTeX → 求值函数(含分段函数,失败返 null) */
  latexToFunction(latex: string): ((x: number) => number) | null;
  /** LaTeX → 求值函数 + 端点信息(仅分段函数返非 null) */
  latexToFunctionWithEndpoints(latex: string): PiecewiseResult | null;

  // ── 工厂 API:非 y-of-x 类型的曲线构造(driver 不直 import mathjs) ──
  /**
   * 参数方程 "x(t);y(t)" → (t) => [x, y] | null。
   * expression 必须含分号分隔的两段(由 detectPlotType 判定);失败返 null。
   */
  makeParametricFn(
    expression: string,
    params: MathParameter[],
  ): ((t: number) => [number, number]) | null;
  /**
   * 极坐标 r(theta) → (theta) => [r·cos θ, r·sin θ] | null。
   * MathHost.kind='polar' 内部已经做了坐标转换,本 API 返回的是直接给 Curve.xy 的形式;
   * driver 调它后塞进 `{ kind: 'parametric', xy: ..., tDomain: paramDomain }`。
   * (capability 也支持直接传 `{ kind: 'polar', r, thetaDomain }`,二选一)
   */
  makePolarFn(
    expression: string,
    params: MathParameter[],
  ): ((theta: number) => number) | null;
  /**
   * "x = <常数>" → 数值常量 c | null。driver 拿到 c 后构造 `{ kind: 'verticalLine', x: c }`。
   * 实际就是 Number(expression) 包装 + isFinite 校验,纯粹避免 driver 写散落判断。
   */
  makeVerticalLineX(expression: string): number | null;
  /**
   * 隐式方程 "F(x,y)=0" → (x, y) => F | null。
   * expression 必须是已经归一化为 F(x,y) 形式(左 - 右,detectPlotType 已处理);
   * 失败返 null。driver 拿到后构造 `{ kind: 'implicit', fn: ... }`。
   */
  makeImplicitFn(
    expression: string,
    params: MathParameter[],
  ): ((x: number, y: number) => number) | null;
  /**
   * mathjs 表达式 → LaTeX 字符串(供 KaTeX 渲染),失败返 null。
   * driver 拿 latex 字符串后传给 katex.render(supplied externally)。
   */
  exprToLatex(expression: string): string | null;

  // ── Phase 2:全屏专用数值计算 ──
  /** 中心差分一阶导数(h=1e-7,Tangent/Normal 工具用) */
  derivative(fn: (x: number) => number, x: number, h?: number): number;
  /** 中心差分二阶导数(h=1e-5,拐点检测用) */
  secondDerivative(fn: (x: number) => number, x: number, h?: number): number;
  /** Simpson 法则积分(默认 200 段) */
  integrate(fn: (x: number) => number, a: number, b: number, n?: number): number;
  /**
   * Self-contained SVG 导出(PR4 2026-05-26):clone SVG + 内联 mafs/katex CSS
   * rule + 默认主题变量;返回独立可渲染字符串(不依赖外部 CSS,可直接
   * dangerouslySetInnerHTML 或下载为文件外部打开)。
   */
  exportSelfContainedSvg(svgEl: SVGElement): string;
  /** 特征点扫描(零点 / 极值 / 拐点);types 默认全 4 类 */
  detectFeaturePoints(
    fn: (x: number) => number,
    functionId: string,
    xMin: number,
    xMax: number,
    opts?: { types?: Set<'maximum' | 'minimum' | 'zero' | 'inflection'> },
  ): Array<{
    id: string;
    functionId: string;
    x: number;
    y: number;
    type: 'maximum' | 'minimum' | 'zero' | 'inflection';
    auto: boolean;
  }>;
}
