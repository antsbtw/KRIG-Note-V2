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

import React, { useMemo, useRef, useState, useEffect, useLayoutEffect } from 'react';
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
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);

  // 点击 host 外部取消 label 选中(label 内部 pointerdown 已 stopPropagation,
  // 所以这里能正确区分"点别处" vs "点 label 本身")
  useEffect(() => {
    if (!selectedLabelId) return;
    const onDocDown = (e: MouseEvent) => {
      const host = hostRef.current;
      if (!host) return;
      const target = e.target as Node;
      if (!host.contains(target)) {
        setSelectedLabelId(null);
      }
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [selectedLabelId]);

  return (
    <div
      ref={hostRef}
      className="mr-math-host"
      style={{ position: 'relative' }}
      onPointerDownCapture={(e) => {
        // hit-area 内部已 stopPropagation,所以能进 capture 阶段的都是"不在任何 label
        // hit-area 内"的点击 → 取消选中。(注意 capture 阶段先于 hit-area 的冒泡监听
        // 触发,所以靠 e.target 来判断 — closest 命中 hit-area 就跳过)
        const target = e.target as Element | null;
        if (target?.closest('[data-label-hit-area]')) return;
        if (selectedLabelId) setSelectedLabelId(null);
      }}
    >
      <Mafs
        viewBox={{ x: viewBox.x, y: viewBox.y }}
        preserveAspectRatio={preserveAspectRatio}
        height={height}
        zoom={zoom}
        pan={pan}
      >
        {renderAxis(axis)}
        {curves.map((c) => renderCurve(c, viewBox))}
        {/* LaTeX label 渲染走 Mafs(SVG 内,被 mafs 接受);
            交互层(hit-area + 选中框)走 HTML overlay,见 Mafs 外的 LabelInteractionLayer */}
        {curves.map((c, i) => (
          <CurveLabel key={`${c.id}-label`} curve={c} idx={i} viewBox={viewBox} />
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

      {/* Label 交互层 — HTML overlay,绝对定位在 LaTeX 上方接 pointer 事件。
          Mafs 内部过滤非 mafs 子组件,SVG 加 <rect> 不渲染,所以 hit-area 必须在
          HTML 层(诊断:document.querySelectorAll('[data-label-hit-area]').length=0
          证实 SVG 内 rect 被 mafs 吃掉) */}
      <LabelInteractionLayer
        curves={curves}
        viewBox={viewBox}
        hostRef={hostRef}
        onLabelMove={onLabelMove}
        selectedLabelId={selectedLabelId}
        onSelect={setSelectedLabelId}
      />
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

/** CurveLabel — SVG 内只画 LaTeX,无交互(mafs 接受 LaTeX 组件) */
function CurveLabel({
  curve,
  idx,
  viewBox,
}: {
  curve: Curve;
  idx: number;
  viewBox: { x: [number, number]; y: [number, number] };
}) {
  if (curve.kind === 'unsupported' || !curve.label) return null;
  const pos = curve.labelPos ?? computeDefaultLabelPos(curve, idx, viewBox);
  return <LaTeX at={pos} tex={curve.label} color={curve.color} />;
}

/** LabelInteractionLayer — HTML 层 hit-area + 选中框,跟随 mafs LaTeX 实际 DOM 位置。
 *
 * 为什么不放 SVG 内:Mafs 过滤非 mafs 组件,自加 <rect>/<g> 不会出现在 SVG DOM 里
 * (诊断:document.querySelectorAll('[data-label-hit-area]').length === 0 证实)。
 *
 * 为什么不靠公式算位置:mafs 内部 SVG viewport 有 padding(留给坐标轴标签),
 * 数据坐标 (0,0) 在 SVG 内的 px 不等于 host div 中心,公式算出来位置偏。
 *
 * 实测方案:每帧扫 host 内 .katex 节点(mafs LaTeX 渲染产物),按 DOM 顺序与
 * 有 label 的 curves 一一对应,直接读 BCR 定位 hit-area 与选中框。
 *
 * 拖动期间 hit-area 实时跟随鼠标,松开后 PM 更新 → curves 重渲 → LaTeX 移动 →
 * useLayoutEffect 重新测量,完成一次同步。
 */
function LabelInteractionLayer({
  curves,
  viewBox,
  hostRef,
  onLabelMove,
  selectedLabelId,
  onSelect,
}: {
  curves: Curve[];
  viewBox: { x: [number, number]; y: [number, number] };
  hostRef: React.RefObject<HTMLDivElement | null>;
  onLabelMove?: (curveId: string, pos: [number, number]) => void;
  selectedLabelId: string | null;
  onSelect: (id: string | null) => void;
}) {
  // 每个 curve.id → { left, top, width, height } (相对 host)
  const [labelRects, setLabelRects] = useState<Map<string, { left: number; top: number; width: number; height: number }>>(new Map());

  // 跟踪有 label 的 curves(顺序与 mafs 内渲染 LaTeX 顺序一致)
  type LabeledCurve = Exclude<Curve, { kind: 'unsupported' }> & { label: string };
  const labeledCurves = useMemo(
    () => curves.filter(
      (c): c is LabeledCurve => c.kind !== 'unsupported' && !!c.label,
    ),
    [curves],
  );

  // 测量函数:每次 curves 变化 / window resize / 拖动后调用
  // 用 useLayoutEffect 确保 mafs 渲染完 DOM 后才测
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const measure = () => {
      const hostRect = host.getBoundingClientRect();
      // mafs LaTeX 输出 .katex 节点;按 DOM 顺序对应 labeledCurves
      const katexNodes = host.querySelectorAll('.katex');
      const next = new Map<string, { left: number; top: number; width: number; height: number }>();
      labeledCurves.forEach((c, i) => {
        const node = katexNodes[i];
        if (!node) return;
        const r = node.getBoundingClientRect();
        next.set(c.id, {
          left: r.left - hostRect.left,
          top: r.top - hostRect.top,
          width: r.width,
          height: r.height,
        });
      });
      setLabelRects(next);
    };

    measure();
    // ResizeObserver 监听 host 尺寸变化(viewport 变更/zoom)
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    // MutationObserver 监听 host 内 DOM 变化(curves 数变/label 文本变)
    const mo = new MutationObserver(measure);
    mo.observe(host, { childList: true, subtree: true, characterData: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [labeledCurves, viewBox, hostRef]);

  const interactive = !!onLabelMove;

  // 数据 px 换算(拖动 delta 用)
  const host = hostRef.current;
  const hostRect = host?.getBoundingClientRect();
  const xSpan = viewBox.x[1] - viewBox.x[0];
  const ySpan = viewBox.y[1] - viewBox.y[0];
  const pxPerDataX = hostRect && hostRect.width > 0 ? hostRect.width / xSpan : 1;
  const pxPerDataY = hostRect && hostRect.height > 0 ? hostRect.height / ySpan : 1;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
      }}
    >
      {labeledCurves.map((c, i) => {
        const r = labelRects.get(c.id);
        if (!r) return null;
        const selected = selectedLabelId === c.id;
        const dataPos = c.labelPos ?? computeDefaultLabelPos(c, i, viewBox);

        const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
          if (!interactive) {
            onSelect(c.id);
            return;
          }
          e.stopPropagation();
          e.preventDefault();
          const startX = e.clientX;
          const startY = e.clientY;
          const startPos = dataPos;
          const MOVE_THRESHOLD = 3;
          let dragging = false;

          const onMove = (ev: PointerEvent) => {
            const ddx = ev.clientX - startX;
            const ddy = ev.clientY - startY;
            if (!dragging) {
              if (selected || Math.abs(ddx) > MOVE_THRESHOLD || Math.abs(ddy) > MOVE_THRESHOLD) {
                dragging = true;
                if (!selected) onSelect(c.id);
              } else {
                return;
              }
            }
            const newX = startPos[0] + ddx / pxPerDataX;
            const newY = startPos[1] - ddy / pxPerDataY;
            onLabelMove!(c.id, [newX, newY]);
          };
          const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            if (!dragging && !selected) onSelect(c.id);
          };
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
        };

        // hit-area 直接套 LaTeX BCR(轻微 padding 便于点击)
        const PAD = 4;
        return (
          <div
            key={c.id}
            data-label-hit-area={c.id}
            onPointerDown={handlePointerDown}
            style={{
              position: 'absolute',
              left: r.left - PAD,
              top: r.top - PAD,
              width: r.width + PAD * 2,
              height: r.height + PAD * 2,
              cursor: interactive ? (selected ? 'move' : 'pointer') : 'pointer',
              pointerEvents: 'auto',
              border: selected ? `1px dashed ${c.color}` : 'none',
              background: selected ? `${c.color}1a` : 'transparent',
              borderRadius: 3,
              boxSizing: 'border-box',
            }}
          />
        );
      })}
    </div>
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
