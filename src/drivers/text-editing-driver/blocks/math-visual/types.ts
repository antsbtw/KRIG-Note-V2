/**
 * math-visual driver block — 数据类型
 *
 * 1:1 迁自 V1 `src/plugins/note/blocks/math-visual/types.ts`,**删除 title 字段**
 * (Phase 1B 决议:title 改为 PM figcaption,见 spec.ts content: 'block')。
 *
 * 本文件 0 import mafs / mathjs / @cortex-js/compute-engine(driver 单点屏障)。
 * 渲染类型 (Curve / MathHostProps 等) 来自 capability `@capabilities/math-rendering`。
 */

/** 函数绘图类型 */
export type PlotType = 'y-of-x' | 'vertical-line' | 'parametric' | 'polar';

/** 一条函数曲线 — driver 持的"用户编辑数据"(由 driver 转成 capability Curve 喂给 MathHost) */
export interface FunctionEntry {
  id: string;
  expression: string;       // mathjs 语法;垂直线为常数值;参数方程为 "x(t);y(t)";极坐标为 "r(theta)"
  label: string;            // 显示标签,如 "f(x)"
  color: string;            // 曲线颜色
  style: 'solid' | 'dashed' | 'dotted';
  lineWidth: number;        // 线宽 px
  visible: boolean;
  showDerivative: boolean;
  plotType?: PlotType;      // 默认 'y-of-x'
  paramDomain?: [number, number]; // 参数方程 t 范围 / 极坐标 θ 范围,默认 [0, 2π]
  sourceLatex?: string;     // 来源 LaTeX(拖入时保留,Phase 3 UI 入口)
  sourceAtomId?: string;    // 来源 mathBlock/mathInline 的 atomId(Phase 3 UI 入口)
}

/** 可调参数(所有曲线共享) */
export interface Parameter {
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
}

/** 关键点标注 */
export interface Annotation {
  x: number;
  functionId: string;       // 标注在哪条曲线上
  label: string;
  showCoord?: boolean;      // 是否显示坐标值
  color?: string;           // 自定义颜色
}

/** 切线 */
export interface TangentLine {
  id: string;
  functionId: string;
  x: number;                // 切点 x 坐标
  fixed: boolean;           // 是否固定(false = 可拖动)
  showSlope: boolean;       // 是否显示斜率值
  color?: string;
}

/** 法线 */
export interface NormalLine {
  id: string;
  functionId: string;
  x: number;
  fixed: boolean;
  showSlope: boolean;
  color?: string;
}

/** 积分区域 */
export interface IntegralRegion {
  id: string;
  functionId: string;
  a: number;
  b: number;
  color?: string;
  showValue: boolean;
}

/** 特征点类型 */
export type FeaturePointType = 'maximum' | 'minimum' | 'zero' | 'inflection';

/** 特征点(极值/零点/拐点) */
export interface FeaturePoint {
  id: string;
  functionId: string;
  x: number;
  y: number;
  type: FeaturePointType;
  auto: boolean;
}

/** 坐标比例模式 */
export type ScaleMode = 'fit' | '1:1' | 'free';

/** 角度单位 */
export type AngleUnit = 'rad' | 'deg';

/** 坐标轴配置 */
export interface AxisConfig {
  showAxes: boolean;
  showAxisArrows: boolean;
  xLabel: string;
  yLabel: string;
  xStep: number | null;
  yStep: number | null;
  showNumbers: boolean;
}

/** 画板宽度档位(相对父容器百分比,fit 模式下高度按 4:3 联动) */
export type WidthMode = 'sm' | 'md' | 'lg' | 'full';

/** 画布显示配置 */
export interface CanvasConfig {
  height: number;
  scaleMode: ScaleMode;
  widthMode?: WidthMode;
  showGrid: boolean;
  gridStyle: 'solid' | 'dashed' | 'dotted';
  axis: AxisConfig;
  angleUnit: AngleUnit;
  pointSize: number;
  zoom: boolean;
  pan: boolean;
}

/** 默认坐标轴配置 */
export const DEFAULT_AXIS_CONFIG: AxisConfig = {
  showAxes: true,
  showAxisArrows: true,
  xLabel: 'x',
  yLabel: 'y',
  xStep: null,
  yStep: null,
  showNumbers: true,
};

/** 默认画布配置 */
export const DEFAULT_CANVAS_CONFIG: CanvasConfig = {
  height: 350,
  scaleMode: 'fit',
  widthMode: 'md',
  showGrid: true,
  gridStyle: 'solid',
  axis: DEFAULT_AXIS_CONFIG,
  angleUnit: 'rad',
  pointSize: 6,
  zoom: true,
  pan: true,
};

/** 全屏工具模式(Phase 2 接入) */
export type ToolMode = 'move' | 'select' | 'annotate' | 'tangent' | 'normal' | 'integral' | 'feature' | 'export';

/** 标注点自动命名序列 */
export const ANNOTATION_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/**
 * MathVisual Block 完整数据(去 title — 已用 PM figcaption)。
 *
 * 全屏模式的 tangentLines / normalLines / integralRegions / featurePoints
 * 字段在 Phase 1B 已定义但 UI 未启用,Phase 2 接入。
 *
 * toolMode (Phase 2):**唯一持久化的全屏 UI 状态** — 跨全屏记住"上次在哪个工具",
 * 用户体验友好。其他全屏 UI 状态(selected*Id / animating / riemannConfig /
 * featureVisibleTypes / boxSelect*)仍在 Panel React state(关闭全屏即丢)。
 */
export interface MathVisualData {
  functions: FunctionEntry[];
  domain: [number, number];
  range: [number, number];
  parameters: Parameter[];
  annotations: Annotation[];
  canvas: CanvasConfig;
  // 全屏模式持久化(Phase 2 启用)
  tangentLines?: TangentLine[];
  normalLines?: NormalLine[];
  integralRegions?: IntegralRegion[];
  featurePoints?: FeaturePoint[];
  toolMode?: ToolMode;       // Phase 2:跨全屏持久,默认 'move'
}

/** 自动分配色板 */
export const FUNCTION_COLORS = [
  '#2D7FF9', // 蓝
  '#00D4AA', // 青绿
  '#FF6B35', // 橙
  '#A855F7', // 紫
  '#EC4899', // 粉
  '#EAB308', // 黄
];

/** 标签序列 */
const LABELS = ['f', 'g', 'h', 'p', 'q', 'r', 's', 't', 'u', 'v'];

/** 创建默认函数条目 */
export function createFunctionEntry(
  index: number,
  expression = '',
  sourceLatex?: string,
): FunctionEntry {
  return {
    id: String(Date.now()) + '-' + index,
    expression,
    label: `${LABELS[index % LABELS.length]}(x)`,
    color: FUNCTION_COLORS[index % FUNCTION_COLORS.length],
    style: 'solid',
    lineWidth: 2.5,
    visible: true,
    showDerivative: false,
    sourceLatex,
  };
}
