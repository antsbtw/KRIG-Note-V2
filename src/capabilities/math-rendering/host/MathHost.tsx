/**
 * host/MathHost — Mafs 画布 React Host(prop-driven 黑盒)
 *
 * 单点屏障核心:**本文件 + ../compute/* 是 V2 中唯一 import `mafs` / `mathjs` /
 * `@cortex-js/compute-engine` 的位置**。
 *
 * driver 通过 `requireCapabilityApi('math-rendering').Host` 拿到本组件,传声明式
 * props(viewBox / curves / annotations / overlays 等),内部决定如何拼装 Mafs 元件。
 *
 * 设计原则:
 * - Prop-driven 黑盒:driver 0 接触 Mafs 元件(对齐 D1 决议)
 * - Curve discriminated union:fnOfX / parametric / polar / verticalLine / unsupported
 * - viewBox 只作"初始/重置视口"(driver PM 持久化);pan/zoom 实时变化走 onViewportChange
 *   通知,driver 可选择持久化或忽略(避免 undo 堆膨胀)
 * - Phase 2:overlays props 接 8 类工具配置(切线/法线/积分/特征/标注/黎曼/HoverCoords/端点),
 *   capability 内部子组件渲染 — driver 全屏 Panel 仅传配置 + 回调
 */

import React, { useMemo } from 'react';
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
import { buildSegments, detectDiscontinuities } from '../compute/discontinuity';
import {
  TangentTool, NormalTool, IntegralTool, AnnotationTool,
  FeatureTool, RiemannTool, EndpointMarkers, HoverCoords,
} from './tools';
import type { EndpointData } from './tools';

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
  overlays,
  overlayCallbacks,
  pointSize = 6,
}) => {
  // 从 curves 提取 fnOfX 类型 → evalFns / fnColors Map(工具消费)
  const { evalFns, fnColors, visibleFnIds } = useMemo(() => {
    const fns = new Map<string, (x: number) => number>();
    const colors = new Map<string, string>();
    const visible = new Set<string>();
    for (const c of curves) {
      if (c.kind === 'fnOfX') {
        fns.set(c.id, c.fn);
        colors.set(c.id, c.color);
        visible.add(c.id);
      }
    }
    return { evalFns: fns, fnColors: colors, visibleFnIds: visible };
  }, [curves]);

  // 自动端点(分段函数)— 走 overlays.showEndpoints 启用
  const autoEndpoints: EndpointData[] = useMemo(() => {
    if (!overlays?.showEndpoints) return [];
    const out: EndpointData[] = [];
    for (const c of curves) {
      if (c.kind !== 'fnOfX' || !c.segments || c.segments.length === 0) continue;
      // 用 buildSegments 在 segments 周边算端点 closed/open(若 driver 未传完整 segments,本地从 fn+discontinuity 重算)
      for (const seg of c.segments) {
        // 简化:本 capability 内每个 segment 两端各算一次,closed 取近端 finite 判定
        const [a, b] = seg.domain;
        const yA = c.fn(a);
        const yB = c.fn(b);
        if (isFinite(yA)) out.push({ x: a, y: yA, closed: true });
        if (isFinite(yB)) out.push({ x: b, y: yB, closed: true });
      }
    }
    return out;
  }, [overlays?.showEndpoints, curves]);

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

        {/* ── Phase 2:工具叠加层 ── */}
        {overlays?.tangents && overlays.tangents.length > 0 && (
          <TangentTool
            tangents={overlays.tangents}
            evalFns={evalFns}
            fnColors={fnColors}
            onMove={overlayCallbacks?.onTangentMove}
          />
        )}
        {overlays?.normals && overlays.normals.length > 0 && (
          <NormalTool
            normals={overlays.normals}
            evalFns={evalFns}
            fnColors={fnColors}
            onMove={overlayCallbacks?.onNormalMove}
          />
        )}
        {overlays?.integrals && overlays.integrals.length > 0 && (
          <IntegralTool
            integrals={overlays.integrals}
            evalFns={evalFns}
            fnColors={fnColors}
            onMove={overlayCallbacks?.onIntegralMove}
          />
        )}
        {overlays?.features && overlays.features.length > 0 && (
          <FeatureTool
            features={overlays.features}
            visibleTypes={new Set(['maximum', 'minimum', 'zero', 'inflection'])}
          />
        )}
        {overlays?.annotations && overlays.annotations.length > 0 && (
          <AnnotationTool
            annotations={overlays.annotations}
            evalFns={evalFns}
            pointSize={pointSize}
            selectedIdx={overlays.selectedAnnotationIdx ?? null}
            selectedIdxs={overlays.selectedAnnotationIdxs ?? new Set()}
            onSelect={overlayCallbacks?.onAnnotationSelect}
            onMove={overlayCallbacks?.onAnnotationMove}
          />
        )}
        {overlays?.riemann && (() => {
          const fn = evalFns.get(overlays.riemann.curveId);
          if (!fn) return null;
          const color = overlays.riemann.color ?? fnColors.get(overlays.riemann.curveId) ?? '#2D7FF9';
          return (
            <RiemannTool
              fn={fn}
              a={overlays.riemann.a}
              b={overlays.riemann.b}
              n={overlays.riemann.n}
              mode={overlays.riemann.mode}
              color={color}
              showSum={overlays.riemann.showSum !== false}
            />
          );
        })()}
        {overlays?.hoverCoords && (
          <HoverCoords
            evalFns={evalFns}
            fnColors={fnColors}
            visibleFnIds={visibleFnIds}
          />
        )}
        {overlays?.showEndpoints && autoEndpoints.length > 0 && (
          <EndpointMarkers endpoints={autoEndpoints} color="#2D7FF9" />
        )}
      </Mafs>
    </div>
  );
};

// ─── 坐标轴 / 网格 ─────────────────────────────────────

function renderAxis(axis?: AxisDisplayConfig): React.ReactNode {
  if (!axis) {
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
      return null;
  }
}

function renderFnOfX(c: Extract<Curve, { kind: 'fnOfX' }>): React.ReactNode {
  const style = normalizeStyle(c.style);
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

// ─── 分段端点(空心 ○ / 实心 ●,driver 显式传 endpoints) ─────────────────────

function renderEndpoint(ep: MathEndpoint, i: number): React.ReactNode {
  const r = 4;
  const color = ep.color ?? '#2D7FF9';
  if (ep.closed) {
    return <Point key={`ep-${i}`} x={ep.x} y={ep.y} color={color} svgCircleProps={{ r }} />;
  }
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

// 留接口为未来引用(避免 unused import 警告;buildSegments + detectDiscontinuities
// 供 overlay 自动端点路径备用,Phase 1A 已可用)
void buildSegments;
void detectDiscontinuities;
