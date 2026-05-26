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

import React, { useMemo, useRef } from 'react';
import { Mafs, Plot, Point, Line, Coordinates, LaTeX } from 'mafs';
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
import { marchingSquares } from '../compute/marching-squares';
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
  onLabelMove,
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

  const hostRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={hostRef} className="mr-math-host" style={{ position: 'relative' }}>
      <Mafs
        viewBox={{ x: viewBox.x, y: viewBox.y }}
        preserveAspectRatio={preserveAspectRatio}
        height={height}
        zoom={zoom}
        pan={pan}
      >
        {renderAxis(axis)}
        {curves.map((c) => renderCurve(c, viewBox))}
        {curves.map((c, i) => (
          <DraggableLabel
            key={`${c.id}-label`}
            curve={c}
            idx={i}
            viewBox={viewBox}
            hostRef={hostRef}
            onLabelMove={onLabelMove}
          />
        ))}
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

function renderCurve(c: Curve, viewBox: { x: [number, number]; y: [number, number] }): React.ReactNode {
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
    case 'implicit':
      return renderImplicit(c, viewBox);
    case 'unsupported':
      return null;
  }
}

function renderImplicit(
  c: Extract<Curve, { kind: 'implicit' }>,
  viewBox: { x: [number, number]; y: [number, number] },
): React.ReactNode {
  const segments = marchingSquares(
    c.fn,
    viewBox.x[0], viewBox.x[1],
    viewBox.y[0], viewBox.y[1],
    c.resolution ?? 100,
  );
  return (
    <React.Fragment key={c.id}>
      {segments.map((seg, i) => (
        <Line.Segment
          key={`${c.id}-${i}`}
          point1={seg[0]}
          point2={seg[1]}
          color={c.color}
          style={normalizeStyle(c.style)}
          weight={c.lineWidth}
          opacity={c.opacity}
        />
      ))}
    </React.Fragment>
  );
}

/** DraggableLabel — 曲线 label,单指按住可直接拖动 (无 MovablePoint 小圆点)。
 *
 * 默认位置(labelPos 缺省时):
 * - y-of-x: 曲线上 x = viewBox 左 1/4 处的 (x, f(x)) + 略往上偏
 * - 其他类型: viewBox 顶部按 index 错开
 *
 * 拖动:onPointerDown 启动 → window pointermove 算 px → 数据坐标 delta;
 * stopPropagation 阻止冒泡到 mafs 的 pan handler。
 * macOS 双指扩张走 mafs 内置 onPinch(zoom=true 时启用)。
 */
function DraggableLabel({
  curve,
  idx,
  viewBox,
  hostRef,
  onLabelMove,
}: {
  curve: Curve;
  idx: number;
  viewBox: { x: [number, number]; y: [number, number] };
  hostRef: React.RefObject<HTMLDivElement>;
  onLabelMove?: (curveId: string, pos: [number, number]) => void;
}) {
  if (curve.kind === 'unsupported' || !curve.label) return null;

  const defaultPos = curve.labelPos ?? computeDefaultLabelPos(curve, idx, viewBox);

  const onPointerDown = (e: React.PointerEvent<SVGGElement>) => {
    if (!onLabelMove || !hostRef.current) return;
    e.stopPropagation(); // 阻止冒泡到 mafs pan handler
    const host = hostRef.current;
    const rect = host.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const xSpan = viewBox.x[1] - viewBox.x[0];
    const ySpan = viewBox.y[1] - viewBox.y[0];
    const pxPerDataX = rect.width / xSpan;
    const pxPerDataY = rect.height / ySpan;
    const startX = e.clientX;
    const startY = e.clientY;
    const startPos = defaultPos;

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / pxPerDataX;
      const dy = -(ev.clientY - startY) / pxPerDataY; // y 轴翻转
      onLabelMove(curve.id, [startPos[0] + dx, startPos[1] + dy]);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <g
      style={{ cursor: onLabelMove ? 'move' : 'default' }}
      onPointerDown={onPointerDown}
    >
      <LaTeX at={defaultPos} tex={curve.label} color={curve.color} />
    </g>
  );
}

function computeDefaultLabelPos(
  c: Curve,
  idx: number,
  viewBox: { x: [number, number]; y: [number, number] },
): [number, number] {
  const [xMin, xMax] = viewBox.x;
  const [yMin, yMax] = viewBox.y;
  const xSpan = xMax - xMin;
  const ySpan = yMax - yMin;

  if (c.kind === 'fnOfX') {
    // 曲线上 x = 左 1/4 的位置 + 略往上偏(避免压曲线)
    const x = xMin + xSpan * 0.25;
    const y = c.fn(x);
    if (Number.isFinite(y) && y >= yMin && y <= yMax) {
      return [x, y + ySpan * 0.05];
    }
  }
  // 其他类型:viewBox 顶部按 idx 错开,从上往下排
  const yTop = yMax - ySpan * 0.08;
  const yStep = ySpan * 0.1;
  return [xMin + xSpan * 0.1, yTop - idx * yStep];
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
