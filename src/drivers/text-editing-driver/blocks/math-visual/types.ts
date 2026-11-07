/**
 * math-visual driver block — 数据类型
 *
 * 1:1 迁自 V1 `src/plugins/note/blocks/math-visual/types.ts`,**删除 title 字段**
 * (Phase 1B 决议:title 改为 PM figcaption,见 spec.ts content: 'block')。
 *
 * 本文件 0 import mafs / mathjs / @cortex-js/compute-engine(driver 单点屏障)。
 * 渲染类型 (Curve / MathHostProps 等) 来自 capability `@capabilities/math-rendering`。
 */

import type { NoteDoc } from '@capabilities/note-card/types';

/** 函数绘图类型 */
export type PlotType = 'y-of-x' | 'vertical-line' | 'parametric' | 'polar' | 'implicit';

/** 一条函数曲线 — driver 持的"用户编辑数据"(由 driver 转成 capability Curve 喂给 MathHost) */
export interface FunctionEntry {
  id: string;
  expression: string;       // mathjs 语法;垂直线为常数值;参数方程为 "x(t);y(t)";极坐标为 "r(theta)"
  /** 用户原始输入(detectPlotType 归一化前);UI 显示用,缺省 fallback 到 expression */
  displayExpression?: string;
  label: string;            // 显示标签,如 "f(x)"
  color: string;            // 曲线颜色
  style: 'solid' | 'dashed' | 'dotted';
  lineWidth: number;        // 线宽 px
  visible: boolean;
  showDerivative: boolean;
  plotType?: PlotType;      // 默认 'y-of-x'
  /** 出现在哪几帧(P2 分帧);缺省 = 每帧都显示 */
  frames?: FrameRange;
  paramDomain?: [number, number]; // 参数方程 t 范围 / 极坐标 θ 范围,默认 [0, 2π]
  /** 曲线 label 位置(数据坐标);用户拖动后写入,缺省由 MathHost 自动计算 */
  labelPos?: [number, number];
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
  /** 分帧的图在 note 里默认怎么显示:逐帧翻页(缺省)/ 展开并排 */
  frameLayout?: 'step' | 'expand';
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

/** 全屏工具模式(Phase 2 接入;'shape' = 题意图 P1 画几何对象,具体画哪种由面板状态 shapeKind 定) */
export type ToolMode = 'move' | 'select' | 'annotate' | 'tangent' | 'normal' | 'integral' | 'feature' | 'export' | 'shape';

// ─── 几何对象(题意图 P1,2026-11-06) ───────────────────────

/** 说明卡片的内容格式 = note-card 公共组件的(2026-11-06 抽出,见 docs/10-business-design/note/note-card-公共组件设计.md) */
export type { NoteDoc, NoteNode } from '@capabilities/note-card/types';
// 设计稿:docs/10-business-design/math/题意图-几何对象与分帧设计.md §3.1

export type ShapeKind = 'point' | 'segment' | 'arrow' | 'circle' | 'text' | 'polygon';

/** 坐标 = 两个表达式字符串;可以是数字,也可以引用参数(如 "8*T") */
export type CoordExpr = [string, string];

export interface ShapeEntry {
  id: string;
  kind: ShapeKind;
  /** point / text 的位置 */
  at?: CoordExpr;
  /** segment / arrow 的起点、终点 */
  from?: CoordExpr;
  to?: CoordExpr;
  /** circle 的圆心、半径 */
  center?: CoordExpr;
  radius?: string;
  /** polygon(面)的顶点,至少 3 个 */
  points?: CoordExpr[];
  /** polygon 是否半透明填充;缺省 = 填充 */
  fill?: boolean;
  /**
   * 说明卡片(2026-11-06):标签 / 文字对象的内容是一小段 note(PM doc 信封,与 note / 画板文字节点同格式)。
   * 有它时按卡片显示;text 字段同步存它的纯文字(列表摘要、旧路径兜底显示用)。
   */
  note?: NoteDoc;
  /** 卡片宽(屏幕像素),缺省 220 */
  noteWidth?: number;
  /** 标签被拖开的偏移(屏幕像素,相对默认位置);缺省 = 默认位置 */
  labelOffset?: [number, number];
  /** text 的内容;point/segment/arrow/circle 的标签 */
  text?: string;
  color: string;
  style: 'solid' | 'dashed' | 'dotted';
  lineWidth: number;
  /** 0~1;虚影用 */
  opacity?: number;
  /** 刻度(segment / arrow):每 step 一道;labels 逗号分隔后依次标注 */
  ticks?: { step: number; labels?: string[] };
  /** 中点画 ✗(segment / arrow) */
  struck?: boolean;
  /** 出现在哪几帧(1 起数,含两端);缺省 = 每帧都显示。见 P2 分帧 */
  frames?: FrameRange;
}

// ─── 分帧(题意图 P2,2026-11-07) ───────────────────────────
// 设计稿 §3.2:一张图拆成几步讲,每帧配一句话;对象标「从第几帧出现、到第几帧为止」。

/** 1 起数,含两端;to 缺省 = 一直到最后一帧 */
export interface FrameRange {
  from: number;
  to?: number;
}

export interface FrameEntry {
  id: string;
  /** 这一帧配的那句话(通常是题目原句) */
  text: string;
}

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
  /** 几何对象(题意图 P1);缺省 = 无 */
  shapes?: ShapeEntry[];
  /** 分帧(题意图 P2);缺省或只有 0~1 帧 = 不分帧,行为与原来完全一致 */
  frames?: FrameEntry[];
  /** 每帧一张 SVG(全屏退出时生成);thumbnail 仍 = 最后一帧(完整图),X 长文等现有消费者不变 */
  frameThumbnails?: string[];
  // 全屏模式持久化(Phase 2 启用)
  tangentLines?: TangentLine[];
  normalLines?: NormalLine[];
  integralRegions?: IntegralRegion[];
  featurePoints?: FeaturePoint[];
  toolMode?: ToolMode;       // Phase 2:跨全屏持久,默认 'move'
  /** PR4(2026-05-26):全屏 ⛶ 退出时生成的 SVG 缩略图;inline 直接渲染 */
  thumbnail?: string | null;
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
