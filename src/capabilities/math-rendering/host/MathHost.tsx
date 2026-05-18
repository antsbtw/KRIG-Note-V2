/**
 * host/MathHost — Mafs 画布 React Host(prop-driven 黑盒)
 *
 * 单点屏障核心:**本文件 + ../compute/* 是 V2 中唯一 import `mafs` / `mathjs` /
 * `@cortex-js/compute-engine` 的位置**。
 *
 * driver 通过 `requireCapabilityApi('math-rendering').Host` 拿到本组件,传声明式
 * props(viewBox / curves / annotations 等),内部决定如何拼装 Mafs 元件。
 *
 * 设计原则:
 * - Prop-driven 黑盒:driver 0 接触 Mafs 元件(对齐 D1 决议)
 * - Curve discriminated union:fnOfX / parametric / polar / verticalLine / unsupported
 * - viewBox 只作"初始/重置视口"(driver PM 持久化);pan/zoom 实时变化走 onViewportChange
 *   通知,driver 可选择持久化或忽略(避免 undo 堆膨胀,见 viewport 拆分决议)
 */

import React from 'react';
import { Mafs, Plot, Point, Line, Coordinates } from 'mafs';
import './mafs-style';
import type {
  MathHostProps,
  Curve,
  MathAnnotation,
  MathEndpoint,
  AxisDisplayConfig,
} from '../types';
import { numericalDerivative } from '../compute/evaluator';

// ─── 主组件 ─────────────────────────────────────────────

export const MathHost: React.FC<MathHostProps> = ({
  viewBox,
  height,
  curves,
  annotations,
  endpoints,
  axis,
  zoom = true,
  pan = true,
  preserveAspectRatio = false,
  onViewportChange: _onViewportChange,
  // Mafs 0.21 没有公开 viewport 变化事件;预留参数,Phase 2 / 上游 SDK 支持后接通
}) => {
  return (
    <div className="mr-math-host" style={{ position: 'relative' }}>
      <Mafs
        viewBox={{ x: viewBox.x, y: viewBox.y }}
        preserveAspectRatio={preserveAspectRatio}
        height={height}
        zoom={zoom}
        pan={pan}
      >
        {renderAxis(axis)}
        {curves.map((c) => renderCurve(c))}
        {endpoints?.map((ep, i) => renderEndpoint(ep, i))}
        {annotations?.map((ann) => renderAnnotation(ann, curves))}
      </Mafs>
    </div>
  );
};

// ─── 坐标轴 / 网格 ─────────────────────────────────────

function renderAxis(axis?: AxisDisplayConfig): React.ReactNode {
  if (!axis) {
    // 默认显示标准坐标系
    return <Coordinates.Cartesian />;
  }
  const showAxes = axis.showAxes !== false;
  const showGrid = axis.showGrid !== false;
  const showNumbers = axis.showNumbers !== false;
  if (!showAxes && !showGrid) return null;

  return (
    <Coordinates.Cartesian
      xAxis={
        showAxes
          ? {
              labels: showNumbers ? undefined : () => '',
              // Mafs 不支持 step null,这里用 undefined(走 Mafs 默认自动步长)
              lines: axis.xStep ?? undefined,
              subdivisions: showGrid ? 2 : false,
            }
          : false
      }
      yAxis={
        showAxes
          ? {
              labels: showNumbers ? undefined : () => '',
              lines: axis.yStep ?? undefined,
              subdivisions: showGrid ? 2 : false,
            }
          : false
      }
    />
  );
}

// ─── 曲线渲染(按 union 分支) ────────────────────────

/** Mafs 的 style 仅 solid/dashed;driver 传 dotted 时降级为 dashed */
function normalizeStyle(s?: 'solid' | 'dashed' | 'dotted'): 'solid' | 'dashed' {
  return s === 'dashed' || s === 'dotted' ? 'dashed' : 'solid';
}

function renderCurve(c: Curve): React.ReactNode {
  switch (c.kind) {
    case 'fnOfX':
      return renderFnOfX(c);
    case 'parametric':
      return (
        <Plot.Parametric
          key={c.id}
          xy={c.xy}
          t={c.tDomain}
          color={c.color}
          style={normalizeStyle(c.style)}
          weight={c.lineWidth}
          opacity={c.opacity}
        />
      );
    case 'polar':
      return (
        <Plot.Parametric
          key={c.id}
          xy={(theta: number) => {
            const r = c.r(theta);
            return [r * Math.cos(theta), r * Math.sin(theta)];
          }}
          t={c.thetaDomain}
          color={c.color}
          style={normalizeStyle(c.style)}
          weight={c.lineWidth}
          opacity={c.opacity}
        />
      );
    case 'verticalLine':
      // Mafs 没有直接的 vertical line 元件;用 Line.ThroughPoints 接近 ±∞ 模拟
      return (
        <Line.ThroughPoints
          key={c.id}
          point1={[c.x, -1e6]}
          point2={[c.x, 1e6]}
          color={c.color}
          style={normalizeStyle(c.style)}
          weight={c.lineWidth}
          opacity={c.opacity}
        />
      );
    case 'unsupported':
      // 不渲染 — driver 负责通过其他途径显示 error
      return null;
  }
}

function renderFnOfX(c: Extract<Curve, { kind: 'fnOfX' }>): React.ReactNode {
  const style = normalizeStyle(c.style);
  // Mafs Plot.OfX 的 style 仅支持 solid/dashed,不支持 dotted(同 Line)
  const segments = c.segments && c.segments.length > 0 ? c.segments : null;

  return (
    <React.Fragment key={c.id}>
      {segments ? (
        segments.map((seg, si) => (
          <Plot.OfX
            key={`${c.id}-seg-${si}`}
            y={c.fn}
            domain={seg.domain}
            color={c.color}
            style={style}
            weight={c.lineWidth}
            opacity={c.opacity}
          />
        ))
      ) : (
        <Plot.OfX
          y={c.fn}
          color={c.color}
          style={style}
          weight={c.lineWidth}
          opacity={c.opacity}
        />
      )}
      {c.derivative && (
        <Plot.OfX
          y={numericalDerivative(c.fn)}
          color={c.color}
          style="dashed"
          opacity={0.6}
        />
      )}
    </React.Fragment>
  );
}

// ─── 标注 ─────────────────────────────────────────────

function renderAnnotation(ann: MathAnnotation, curves: Curve[]): React.ReactNode {
  // 在对应曲线上查 y 值;非 fnOfX 曲线暂不支持标注(driver 应避免传)
  const curve = curves.find((c) => c.id === ann.curveId);
  if (!curve || curve.kind !== 'fnOfX') return null;
  const y = curve.fn(ann.x);
  if (!isFinite(y)) return null;
  return (
    <Point
      key={ann.id}
      x={ann.x}
      y={y}
      color={ann.color ?? '#FF6B35'}
      svgCircleProps={{ r: ann.pointSize ?? 6 }}
    />
  );
}

// ─── 分段端点(空心 ○ / 实心 ●) ─────────────────────

function renderEndpoint(ep: MathEndpoint, i: number): React.ReactNode {
  const r = 4;
  const color = ep.color ?? '#2D7FF9';
  if (ep.closed) {
    return <Point key={`ep-${i}`} x={ep.x} y={ep.y} color={color} svgCircleProps={{ r }} />;
  }
  // 空心 — Mafs Point 没有 stroke-only 模式;用 svgCircleProps 设置 fill=white + stroke=color
  return (
    <Point
      key={`ep-${i}`}
      x={ep.x}
      y={ep.y}
      color={color}
      svgCircleProps={{ r, fill: 'white', stroke: color, strokeWidth: 2 }}
    />
  );
}
