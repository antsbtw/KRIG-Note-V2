/**
 * MathVisualFullscreenPanel — L2 fullscreen overlay 主 Component
 *
 * 设计:
 * - Mount 时 getMathVisualFullscreenContext() 拿 (instanceId, nodePos),从 PM doc 读初始
 *   MathVisualData;Panel 内 React state 镜像 data,onChange 实时写回 PM
 * - Unmount cleanup:lastDataRef 走 view.dispatch(对齐 CodeFullscreenPanel 模式,
 *   memory feedback_react_unmount_child_cleanup_order)
 * - toolMode 唯一持久化到 PM attrs;其他工具状态(selected*Id / animating /
 *   riemannConfig / featureVisibleTypes / boxSelect)仅 Panel state(关闭丢)
 *
 * 整体结构对齐 V1 MathVisualFullscreen.tsx:
 * - 顶部 header(标题 + ×)
 * - 三栏 body:LeftPanel | 中央 Mafs 画布(走 capability MathHost + overlays) | RightPanel
 * - Esc/Delete/Backspace keymap
 * - 9 类工具数据 add/update/remove handler + click-to-add 分发
 */

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  MathRenderingApi, Curve, OverlaysConfig, OverlayCallbacks,
  AxisDisplayConfig,
} from '@capabilities/math-rendering/types';
import type { FullscreenOverlayCloseProps } from '@slot/interaction-registries/fullscreen-overlay-registry/types';
import { instanceRegistry } from '../../../instance-registry';
import type {
  MathVisualData, CanvasConfig, ToolMode,
  TangentLine, NormalLine, IntegralRegion, FeaturePoint, FeaturePointType,
  Annotation, FunctionEntry, ShapeEntry, ShapeKind,
} from '../types';
import { DEFAULT_CANVAS_CONFIG, DEFAULT_AXIS_CONFIG } from '../types';
import {
  getMathVisualFullscreenContext,
  clearMathVisualFullscreenContext,
} from './menu-context';
import { LeftPanel } from './LeftPanel';
import { RightPanel } from './RightPanel';
import { LegendOverlay } from './LegendOverlay';
import { FullscreenErrorBoundary } from './FullscreenErrorBoundary';
import {
  compileShapes, createShape, shapeKindMeta, fitEqualScale, relToData, snap, snapStep,
  zoomView, panView, boundsOfShapes, MAFS_VIEWBOX_PADDING,
  hitTest, shapeHandles, translateShape, setHandle, duplicateShape, dataToPx, POLYGON_MIN_POINTS,
  shapesInRect,
  type Vec2, type View, type PxFrame, type HandlePart,
} from '../shapes';
import type { ShapeSpec } from '@capabilities/math-rendering/types';

type RiemannMode = 'left' | 'right' | 'midpoint';

/** 从 PM node 读 MathVisualData(对齐 node-view getDataFromNode 实现) */
function readDataFromPM(instanceId: string, nodePos: number): MathVisualData | null {
  const inst = instanceRegistry.get(instanceId);
  if (!inst) return null;
  const node = inst.view.state.doc.nodeAt(nodePos);
  if (!node || node.type.name !== 'mathVisual') return null;
  const a = node.attrs;
  return {
    functions: a.functions || [],
    domain: a.domain || [-5, 5],
    range: a.range || [-5, 5],
    parameters: a.parameters || [],
    annotations: a.annotations || [],
    canvas: {
      ...DEFAULT_CANVAS_CONFIG,
      ...(a.canvas || {}),
      axis: { ...DEFAULT_AXIS_CONFIG, ...((a.canvas || {}).axis || {}) },
    },
    shapes: a.shapes || [],
    tangentLines: a.tangentLines || [],
    normalLines: a.normalLines || [],
    integralRegions: a.integralRegions || [],
    featurePoints: a.featurePoints || [],
    toolMode: a.toolMode || 'move',
    thumbnail: a.thumbnail ?? null,
  };
}

/** 把 MathVisualData 写回 PM 对应 mathVisual node attrs */
function writeDataToPM(
  instanceId: string,
  nodePos: number,
  data: MathVisualData,
): void {
  const inst = instanceRegistry.get(instanceId);
  if (!inst) return;
  const view = inst.view;
  const node = view.state.doc.nodeAt(nodePos);
  if (!node || node.type.name !== 'mathVisual') return;
  let tr = view.state.tr;
  tr = tr.setNodeAttribute(nodePos, 'functions', data.functions);
  tr = tr.setNodeAttribute(nodePos, 'domain', data.domain);
  tr = tr.setNodeAttribute(nodePos, 'range', data.range);
  tr = tr.setNodeAttribute(nodePos, 'parameters', data.parameters);
  tr = tr.setNodeAttribute(nodePos, 'annotations', data.annotations);
  tr = tr.setNodeAttribute(nodePos, 'canvas', data.canvas);
  tr = tr.setNodeAttribute(nodePos, 'shapes', data.shapes || []);
  tr = tr.setNodeAttribute(nodePos, 'tangentLines', data.tangentLines || []);
  tr = tr.setNodeAttribute(nodePos, 'normalLines', data.normalLines || []);
  tr = tr.setNodeAttribute(nodePos, 'integralRegions', data.integralRegions || []);
  tr = tr.setNodeAttribute(nodePos, 'featurePoints', data.featurePoints || []);
  tr = tr.setNodeAttribute(nodePos, 'toolMode', data.toolMode || 'move');
  if (data.thumbnail !== undefined) tr = tr.setNodeAttribute(nodePos, 'thumbnail', data.thumbnail);
  view.dispatch(tr);
}

// ─── Inner Panel(被 ErrorBoundary 包裹) ────────────────

const InnerPanel: React.FC<FullscreenOverlayCloseProps> = ({ onClose: rawOnClose }) => {
  const math = requireCapabilityApi<MathRenderingApi>('math-rendering');
  const ctxRef = useRef(getMathVisualFullscreenContext());

  // 初始读 PM doc
  const initialDataRef = useRef<MathVisualData | null>(null);
  if (initialDataRef.current === null && ctxRef.current) {
    initialDataRef.current = readDataFromPM(ctxRef.current.instanceId, ctxRef.current.nodePos);
  }

  const [data, setData] = useState<MathVisualData>(
    initialDataRef.current ?? {
      functions: [], domain: [-5, 5], range: [-5, 5],
      parameters: [], annotations: [], canvas: DEFAULT_CANVAS_CONFIG, toolMode: 'move',
    },
  );

  // lastValueRef 用于 unmount cleanup(对齐 CodeFullscreenPanel 模式)
  const lastDataRef = useRef<MathVisualData>(data);

  // onChange 接 PM 实时写回 + 镜像更新
  const onChange = useCallback((newData: MathVisualData) => {
    lastDataRef.current = newData;
    setData(newData);
    const ctx = ctxRef.current;
    if (ctx) writeDataToPM(ctx.instanceId, ctx.nodePos, newData);
  }, []);

  // Unmount cleanup:用 lastDataRef 兜底写一次(React unmount 时 setState 已废)
  useEffect(() => {
    return () => {
      const ctx = ctxRef.current;
      if (ctx) {
        // PM doc 在 onChange 实时更新,这里只是兜底;若中途 instance destroyed
        // writeDataToPM 内 instanceRegistry.get 会返回 undefined,安全跳过
        writeDataToPM(ctx.instanceId, ctx.nodePos, lastDataRef.current);
      }
      clearMathVisualFullscreenContext();
    };
  }, []);

  // 关闭前抓 SVG 缩略图写回 PM(inline 静态显示用)
  // PR4(2026-05-26)走 SVG 缓存方案 — onClose 前在 React 仍 mount 时
  // querySelector 拿 canvasRef 内 mafs 输出的 svg outerHTML
  const onClose = useCallback(() => {
    const ctx = ctxRef.current;
    const svgEl = canvasRef.current?.querySelector('svg') as SVGElement | null;
    if (ctx && svgEl) {
      // 走 capability self-contained 导出 — 内联 mafs/katex CSS,inline 独立渲染
      const thumbnail = math.exportSelfContainedSvg(svgEl);
      const nextData = { ...lastDataRef.current, thumbnail };
      lastDataRef.current = nextData;
      writeDataToPM(ctx.instanceId, ctx.nodePos, nextData);
    }
    rawOnClose();
  }, [rawOnClose, math]);

  const { functions: fns, domain, range, parameters, annotations } = data;
  const tangentLines = data.tangentLines || [];
  const normalLines = data.normalLines || [];
  const integralRegions = data.integralRegions || [];
  const featurePoints = data.featurePoints || [];

  const canvas: CanvasConfig = data.canvas;
  const axis = canvas.axis;

  // ── 工具状态(部分持久化:toolMode 走 PM;其他 Panel state) ──
  const toolMode = data.toolMode || 'move';
  const setToolMode = useCallback((mode: ToolMode) => onChange({ ...data, toolMode: mode }), [data, onChange]);

  const [selectedTangentId, setSelectedTangentId] = useState<string | null>(null);
  const [selectedNormalId, setSelectedNormalId] = useState<string | null>(null);
  const [selectedIntegralId, setSelectedIntegralId] = useState<string | null>(null);
  const [selectedAnnotationIdx, setSelectedAnnotationIdx] = useState<number | null>(null);
  const [selectedAnnotationIdxs, setSelectedAnnotationIdxs] = useState<Set<number>>(new Set());
  const [featureVisibleTypes, setFeatureVisibleTypes] = useState<Set<FeaturePointType>>(
    new Set(['zero', 'maximum', 'minimum', 'inflection']),
  );
  const [riemannConfig, setRiemannConfig] = useState<{ n: number; mode: RiemannMode } | null>(null);
  const [animating, setAnimating] = useState<{ paramName: string; speed: number } | null>(null);
  const animTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 框选
  const [boxSelectStart, setBoxSelectStart] = useState<{ x: number; y: number } | null>(null);
  const [boxSelectEnd, setBoxSelectEnd] = useState<{ x: number; y: number } | null>(null);

  // 画布高度(ResizeObserver 测量容器)
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasHeight, setCanvasHeight] = useState(600);
  const [canvasWidth, setCanvasWidth] = useState(0);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = entry.contentRect.height - 32;
        if (h > 100) setCanvasHeight(Math.round(h));
        if (entry.contentRect.width > 100) setCanvasWidth(Math.round(entry.contentRect.width));
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // ── 编译曲线(走 capability;parametric/polar/vertical-line 走对应工厂) ──

  type CompiledFn = {
    fn: FunctionEntry;
    evalFn: ((x: number) => number) | null;
    contSegs: Array<{ domain: [number, number]; leftEndpoint: { x: number; y: number; closed: boolean }; rightEndpoint: { x: number; y: number; closed: boolean } }>;
    error: string | null;
  };

  const compiledFns: CompiledFn[] = useMemo(() => {
    return fns.map((fn) => {
      if (
        fn.plotType === 'parametric' ||
        fn.plotType === 'polar' ||
        fn.plotType === 'vertical-line' ||
        fn.plotType === 'implicit'
      ) {
        return { fn, evalFn: null, contSegs: [], error: null };
      }
      const result = math.createEvalFn(fn.expression, parameters, fn.sourceLatex);
      const discs = result.fn ? math.detectDiscontinuities(result.fn, domain[0], domain[1]) : [];
      const contSegs = result.fn ? math.buildSegments(result.fn, discs, domain[0], domain[1]) : [];
      return { fn, evalFn: result.fn, contSegs, error: result.error };
    });
  }, [fns, parameters, domain, math]);

  const evalFnMap = useMemo(() => {
    const map = new Map<string, (x: number) => number>();
    for (const c of compiledFns) {
      if (c.evalFn) map.set(c.fn.id, c.evalFn);
    }
    return map;
  }, [compiledFns]);

  // ── 转 curves[] 喂 MathHost(同 inline MathVisualComponent 逻辑) ──

  const curves: Curve[] = useMemo(() => {
    // 曲线 label LaTeX:
    // - implicit: 仅原方程 (label "f(x)" 对二元方程无意义)
    // - vertical-line: "x = <c>"
    // - displayExpression 已含 "y=" / "r=" / 含 "=" 二元方程: 直接用 displayExpression 原样
    //   (避免 "f(x) = y = x²" 这种二重等号)
    // - 否则: "<fn.label> = <latex(expr)>" (用户只写右侧表达式时,加上 "f(x) = " 前缀)
    const labelFor = (fn: FunctionEntry): string | undefined => {
      const expr = fn.displayExpression ?? fn.expression;
      if (fn.plotType === 'implicit') {
        return math.exprToLatex(expr) ?? expr;
      }
      if (fn.plotType === 'vertical-line') {
        return `x = ${fn.expression}`;
      }
      // displayExpression 含 = → 用户原写法本身就是方程,直接用
      if (expr.includes('=')) {
        return math.exprToLatex(expr) ?? expr;
      }
      const tex = math.exprToLatex(expr) ?? expr;
      return `${fn.label} = ${tex}`;
    };

    const out: Curve[] = [];
    for (const c of compiledFns) {
      const { fn, evalFn, contSegs } = c;
      if (!fn.visible) continue;
      const label = labelFor(fn);

      if (fn.plotType === 'vertical-line') {
        const x = math.makeVerticalLineX(fn.expression);
        if (x == null) continue;
        out.push({ kind: 'verticalLine', id: fn.id, x, color: fn.color, style: fn.style, lineWidth: fn.lineWidth, label, labelPos: fn.labelPos });
        continue;
      }
      if (fn.plotType === 'parametric') {
        const xy = math.makeParametricFn(fn.expression, parameters);
        if (!xy) continue;
        const [tMin, tMax] = fn.paramDomain || [0, 2 * Math.PI];
        out.push({ kind: 'parametric', id: fn.id, xy, tDomain: [tMin, tMax], color: fn.color, style: fn.style, lineWidth: fn.lineWidth, label, labelPos: fn.labelPos });
        continue;
      }
      if (fn.plotType === 'polar') {
        const r = math.makePolarFn(fn.expression, parameters);
        if (!r) continue;
        const [tMin, tMax] = fn.paramDomain || [0, 2 * Math.PI];
        out.push({ kind: 'polar', id: fn.id, r, thetaDomain: [tMin, tMax], color: fn.color, style: fn.style, lineWidth: fn.lineWidth, label, labelPos: fn.labelPos });
        continue;
      }
      if (fn.plotType === 'implicit') {
        const fnImpl = math.makeImplicitFn(fn.expression, parameters);
        if (!fnImpl) continue;
        out.push({ kind: 'implicit', id: fn.id, fn: fnImpl, color: fn.color, style: fn.style, lineWidth: fn.lineWidth, label, labelPos: fn.labelPos });
        continue;
      }
      if (!evalFn) continue;
      out.push({
        kind: 'fnOfX', id: fn.id, fn: evalFn,
        segments: contSegs.length > 0 ? contSegs.map((s) => ({ domain: s.domain })) : undefined,
        derivative: fn.showDerivative,
        color: fn.color, style: fn.style, lineWidth: fn.lineWidth, label, labelPos: fn.labelPos,
      });
    }
    return out;
  }, [compiledFns, parameters, math]);

  const axisConfig: AxisDisplayConfig = useMemo(() => ({
    showGrid: canvas.showGrid,
    gridStyle: canvas.gridStyle,
    showAxes: axis.showAxes,
    showAxisArrows: axis.showAxisArrows,
    showNumbers: axis.showNumbers,
    xLabel: axis.xLabel,
    yLabel: axis.yLabel,
    xStep: axis.xStep,
    yStep: axis.yStep,
  }), [canvas, axis]);

  // ── 实际视口:等比例模式下按画布宽高放宽一个方向(题意图 P1) ──
  const baseView = useMemo(() => {
    const base = { x: domain, y: range };
    return canvas.scaleMode === '1:1' ? fitEqualScale(base, canvasWidth, canvasHeight) : base;
  }, [domain, range, canvas.scaleMode, canvasWidth, canvasHeight]);

  // ── 缩放 / 平移(2026-11-06 用户:「应该有放大和缩小的功能」)──
  // 视口由我们自己管,不用 Mafs 内置 zoom/pan:内置的不落盘,且缩放后点击换算对不上。
  // 拖动 / 滚轮过程中只改 liveView(不写 PM),停下来再一次性写回 domain/range。
  const [liveView, setLiveView] = useState<View | null>(null);
  const view: View = liveView ?? baseView;
  const viewRef = useRef<View>(view);
  viewRef.current = view;
  const dataForViewRef = useRef(data);
  dataForViewRef.current = data;

  const commitView = useCallback((v: View) => {
    const r = (n: number) => Math.round(n * 1000) / 1000;
    const cur = dataForViewRef.current;
    onChange({ ...cur, domain: [r(v.x[0]), r(v.x[1])], range: [r(v.y[0]), r(v.y[1])] });
    setLiveView(null);
  }, [onChange]);

  // 滚轮缩放(以鼠标为中心);原生监听才能 preventDefault
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (e: WheelEvent) => {
      const svg = el.querySelector('svg');
      if (!svg) return;
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const cur = viewRef.current;
      const anchor = relToData((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height, cur);
      const next = zoomView(cur, Math.exp(e.deltaY * 0.0015), anchor);
      viewRef.current = next;
      setLiveView(next);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => commitView(viewRef.current), 300);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (timer) clearTimeout(timer);
    };
  }, [commitView]);

  // 移动模式下拖动画布平移
  const startPan = useCallback((e: React.MouseEvent, onClickNoMove?: () => void) => {
    const svg = canvasRef.current?.querySelector('svg');
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const start = viewRef.current;
    const sx = e.clientX;
    const sy = e.clientY;
    const perPxX = (start.x[1] - start.x[0] + 2 * MAFS_VIEWBOX_PADDING) / rect.width;
    const perPxY = (start.y[1] - start.y[0] + 2 * MAFS_VIEWBOX_PADDING) / rect.height;
    let moved = false;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      moved = true;
      const next = panView(start, -dx * perPxX, dy * perPxY);
      viewRef.current = next;
      setLiveView(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (moved) commitView(viewRef.current);
      else onClickNoMove?.();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [commitView]);

  const zoomBy = useCallback((factor: number) => {
    const v = viewRef.current;
    commitView(zoomView(v, factor, [(v.x[0] + v.x[1]) / 2, (v.y[0] + v.y[1]) / 2]));
  }, [commitView]);

  // ── 几何对象(题意图 P1) ──
  // 拖动过程中只改 liveShapes(不写 PM),松手一次性写回
  const [liveShapes, setLiveShapes] = useState<ShapeEntry[] | null>(null);
  const shapes = useMemo(() => liveShapes ?? data.shapes ?? [], [liveShapes, data.shapes]);
  const [shapeKind, setShapeKind] = useState<ShapeKind>('point');
  const [pendingPoints, setPendingPoints] = useState<Vec2[]>([]);
  // 可多选(框选 / Shift+点击);只选中一个时才显示手柄和单个对象的属性
  const [selectedShapeIds, setSelectedShapeIds] = useState<string[]>([]);
  const selectedShapeId = selectedShapeIds.length === 1 ? selectedShapeIds[0] : null;
  const setSelectedShapeId = useCallback((id: string | null) => setSelectedShapeIds(id ? [id] : []), []);
  const toggleShapeSelected = useCallback((id: string) => {
    setSelectedShapeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const compiledShapes = useMemo(
    () => compileShapes(shapes, math.evalScalar, parameters),
    [shapes, parameters, math],
  );
  const fitAll = useCallback(() => {
    commitView(boundsOfShapes(compiledShapes.specs) ?? { x: [-5, 5], y: [-5, 5] });
  }, [compiledShapes, commitView]);

  const shapeSpecs: ShapeSpec[] = useMemo(() => {
    const extra: ShapeSpec[] = [];
    // 没点完的图形:灰点 + 灰线(面的顶点之间连起来)
    pendingPoints.forEach((p, i) => {
      extra.push({ kind: 'point', id: `__pending-${i}`, at: p, color: '#9ca3af', size: 5 });
      if (i > 0) {
        extra.push({ kind: 'segment', id: `__pending-seg-${i}`, from: pendingPoints[i - 1], to: p, color: '#9ca3af', style: 'dashed', lineWidth: 1.5 });
      }
    });
    // 选中对象的手柄:白点
    const sel = compiledShapes.specs.find((sp) => sp.id === selectedShapeId);
    if (sel) {
      for (const h of shapeHandles(sel)) {
        extra.push({ kind: 'point', id: `__handle-${h.part}`, at: h.at, color: '#ffffff', size: 5 });
      }
    }
    return extra.length > 0 ? [...compiledShapes.specs, ...extra] : compiledShapes.specs;
  }, [compiledShapes, pendingPoints, selectedShapeId]);

  /** 当前画布的像素框(命中测试 / 像素距离用) */
  const getFrame = useCallback((): (PxFrame & { rect: DOMRect }) | null => {
    const svg = canvasRef.current?.querySelector('svg');
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return { view: viewRef.current, width: rect.width, height: rect.height, rect };
  }, []);

  const addShape = useCallback((shape: ShapeEntry) => {
    onChange({ ...data, shapes: [...shapes, shape] });
    setSelectedShapeId(shape.id);
  }, [data, shapes, onChange]);
  const updateShape = useCallback((id: string, updates: Partial<ShapeEntry>) => {
    onChange({ ...data, shapes: shapes.map((sh) => (sh.id === id ? { ...sh, ...updates } : sh)) });
  }, [data, shapes, onChange]);
  const removeShape = useCallback((id: string) => {
    onChange({ ...data, shapes: shapes.filter((sh) => sh.id !== id) });
    setSelectedShapeIds((prev) => prev.filter((x) => x !== id));
  }, [data, shapes, onChange]);
  const removeSelectedShapes = useCallback(() => {
    const del = new Set(selectedShapeIds);
    onChange({ ...data, shapes: shapes.filter((sh) => !del.has(sh.id)) });
    setSelectedShapeIds([]);
  }, [data, shapes, selectedShapeIds, onChange]);
  /** 多选时统一改(颜色 / 虚影 / 线型) */
  const updateSelectedShapes = useCallback((updates: Partial<ShapeEntry>) => {
    const sel = new Set(selectedShapeIds);
    onChange({ ...data, shapes: shapes.map((sh) => (sel.has(sh.id) ? { ...sh, ...updates } : sh)) });
  }, [data, shapes, selectedShapeIds, onChange]);
  const selectedShape = shapes.find((sh) => sh.id === selectedShapeId) ?? null;

  const pickShapeKind = useCallback((kind: ShapeKind) => {
    setShapeKind(kind);
    setPendingPoints([]);
    if (toolMode !== 'shape') onChange({ ...data, toolMode: 'shape' });
  }, [toolMode, data, onChange]);

  // 离开画图形模式:丢掉没点完的第一点
  useEffect(() => {
    if (toolMode !== 'shape') setPendingPoints([]);
    if (toolMode !== 'shape' && toolMode !== 'move' && toolMode !== 'select') setSelectedShapeIds([]);
  }, [toolMode]);

  const handleShapeClick = useCallback((p: Vec2) => {
    const sp: Vec2 = [
      snap(p[0], snapStep(view.x[1] - view.x[0])),
      snap(p[1], snapStep(view.y[1] - view.y[0])),
    ];
    const clicks = shapeKindMeta(shapeKind).clicks;
    if (clicks === 'many') {
      // 面:点回第一个点(10px 内)且够 3 个顶点 → 完成
      const frame = getFrame();
      if (frame && pendingPoints.length >= POLYGON_MIN_POINTS) {
        const a = dataToPx(pendingPoints[0], frame);
        const b = dataToPx(p, frame);
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= 10) {
          setPendingPoints([]);
          addShape(createShape('polygon', pendingPoints, shapes.length));
          return;
        }
      }
      setPendingPoints([...pendingPoints, sp]);
      return;
    }
    const pts = [...pendingPoints, sp];
    if (pts.length < clicks) {
      setPendingPoints(pts);
      return;
    }
    setPendingPoints([]);
    addShape(createShape(shapeKind, pts, shapes.length));
  }, [view, shapeKind, pendingPoints, shapes.length, addShape, getFrame]);

  const finishPolygon = useCallback(() => {
    if (shapeKind !== 'polygon' || pendingPoints.length < POLYGON_MIN_POINTS) return false;
    setPendingPoints([]);
    addShape(createShape('polygon', pendingPoints, shapes.length));
    return true;
  }, [shapeKind, pendingPoints, shapes.length, addShape]);

  const shapeHint = (() => {
    if (toolMode !== 'shape') {
      if (selectedShapeIds.length > 1) return `已选 ${selectedShapeIds.length} 个:拖动一起移动;方向键微调,⌘D 复制,Backspace 删除;Shift+点击加选/去掉`;
      if (selectedShapeId) return '拖动图形移动;拖白点改位置;方向键微调,⌘D 复制,Backspace 删除';
      return toolMode === 'select' ? '在空白处拖出方框,完全框住的图形会被选中;Shift 可追加' : null;
    }
    const label = shapeKindMeta(shapeKind).label;
    if (pendingPoints.length === 0) return `${label}:${shapeKindMeta(shapeKind).hint}`;
    if (shapeKind === 'polygon') {
      return pendingPoints.length >= POLYGON_MIN_POINTS
        ? `面:已点 ${pendingPoints.length} 个顶点,点回第一个点或按回车完成(Esc 取消)`
        : `面:已点 ${pendingPoints.length} 个顶点,至少 ${POLYGON_MIN_POINTS} 个(Esc 取消)`;
    }
    return `${label}:已点第一点,再点一下完成(Esc 取消)`;
  })();

  // ── 画布上选中 / 拖动(2026-11-06 用户:「还有选定对象和操作的能力吧?」)──
  // 拖完松手时浏览器还会补发一次 click;用这个标记吞掉,免得画图形模式下又加一个
  const suppressClickRef = useRef(false);
  /** 框选时按着 Shift:追加而不是替换 */
  const boxAdditiveRef = useRef(false);

  const startShapeDrag = useCallback((
    e: React.MouseEvent, id: string, part: HandlePart | null, groupIds: string[] = [id],
  ) => {
    const frame = getFrame();
    const orig = (data.shapes ?? []).find((sh) => sh.id === id);
    const spec = compiledShapes.specs.find((sp) => sp.id === id);
    if (!frame || !orig || !spec) return;
    const group = new Set(part === null ? groupIds : [id]);
    const toData = (ev: { clientX: number; clientY: number }) =>
      relToData((ev.clientX - frame.rect.left) / frame.width, (ev.clientY - frame.rect.top) / frame.height, frame.view);
    const start = toData(e);
    const stepX = snapStep(frame.view.x[1] - frame.view.x[0]);
    const stepY = snapStep(frame.view.y[1] - frame.view.y[0]);
    const all = data.shapes ?? [];
    let latest: ShapeEntry[] | null = null;
    const sx = e.clientX;
    const sy = e.clientY;
    const onMove = (ev: MouseEvent) => {
      if (!latest && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 3) return;
      const cur = toData(ev);
      if (part === null) {
        const dx = snap(cur[0] - start[0], stepX);
        const dy = snap(cur[1] - start[1], stepY);
        latest = all.map((sh) => (group.has(sh.id) ? translateShape(sh, dx, dy) : sh));
      } else {
        const next = setHandle(orig, spec, part, [snap(cur[0], stepX), snap(cur[1], stepY)]);
        latest = all.map((sh) => (sh.id === id ? next : sh));
      }
      setLiveShapes(latest);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (latest) {
        suppressClickRef.current = true;
        onChange({ ...dataForViewRef.current, shapes: latest });
      }
      setLiveShapes(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [getFrame, data.shapes, compiledShapes, onChange]);

  /** 鼠标下是哪个图形(或选中图形的哪个手柄) */
  const hitAt = useCallback((e: { clientX: number; clientY: number }) => {
    const frame = getFrame();
    if (!frame) return null;
    return hitTest(
      compiledShapes.specs,
      [e.clientX - frame.rect.left, e.clientY - frame.rect.top],
      frame,
      selectedShapeId,
    );
  }, [getFrame, compiledShapes, selectedShapeId]);

  const [hoverShape, setHoverShape] = useState(false);

  const nudgeSelected = useCallback((dx: number, dy: number) => {
    if (selectedShapeIds.length === 0) return;
    const sel = new Set(selectedShapeIds);
    onChange({ ...data, shapes: shapes.map((sh) => (sel.has(sh.id) ? translateShape(sh, dx, dy) : sh)) });
  }, [data, shapes, selectedShapeIds, onChange]);

  const duplicateSelected = useCallback(() => {
    if (selectedShapeIds.length === 0) return;
    const v = viewRef.current;
    const step: Vec2 = [snapStep(v.x[1] - v.x[0]) * 2, -snapStep(v.y[1] - v.y[0]) * 2];
    const copies = shapes
      .filter((sh) => selectedShapeIds.includes(sh.id))
      .map((sh, i) => duplicateShape(sh, step, shapes.length + i));
    onChange({ ...data, shapes: [...shapes, ...copies] });
    setSelectedShapeIds(copies.map((c) => c.id));
  }, [data, shapes, selectedShapeIds, onChange]);

  // ── 9 类工具数据 handler ──

  const addTangent = useCallback((functionId: string, x: number) => {
    const newTl: TangentLine = { id: `tl-${Date.now()}`, functionId, x, fixed: false, showSlope: true };
    onChange({ ...data, tangentLines: [...tangentLines, newTl] });
    setSelectedTangentId(newTl.id);
  }, [data, tangentLines, onChange]);
  const updateTangent = useCallback((id: string, updates: Partial<TangentLine>) => {
    onChange({ ...data, tangentLines: tangentLines.map((tl) => tl.id === id ? { ...tl, ...updates } : tl) });
  }, [data, tangentLines, onChange]);
  const removeTangent = useCallback((id: string) => {
    onChange({ ...data, tangentLines: tangentLines.filter((tl) => tl.id !== id) });
    if (selectedTangentId === id) setSelectedTangentId(null);
  }, [data, tangentLines, selectedTangentId, onChange]);
  const selectedTangent = tangentLines.find((tl) => tl.id === selectedTangentId) || null;

  const addNormal = useCallback((functionId: string, x: number) => {
    const newNl: NormalLine = { id: `nl-${Date.now()}`, functionId, x, fixed: false, showSlope: true };
    onChange({ ...data, normalLines: [...normalLines, newNl] });
    setSelectedNormalId(newNl.id);
  }, [data, normalLines, onChange]);
  const updateNormal = useCallback((id: string, updates: Partial<NormalLine>) => {
    onChange({ ...data, normalLines: normalLines.map((nl) => nl.id === id ? { ...nl, ...updates } : nl) });
  }, [data, normalLines, onChange]);
  const removeNormal = useCallback((id: string) => {
    onChange({ ...data, normalLines: normalLines.filter((nl) => nl.id !== id) });
    if (selectedNormalId === id) setSelectedNormalId(null);
  }, [data, normalLines, selectedNormalId, onChange]);
  const selectedNormal = normalLines.find((nl) => nl.id === selectedNormalId) || null;

  const addIntegral = useCallback((functionId: string, a: number, b: number) => {
    const newIr: IntegralRegion = { id: `ir-${Date.now()}`, functionId, a, b, showValue: true };
    onChange({ ...data, integralRegions: [...integralRegions, newIr] });
    setSelectedIntegralId(newIr.id);
  }, [data, integralRegions, onChange]);
  const updateIntegral = useCallback((id: string, updates: Partial<IntegralRegion>) => {
    onChange({ ...data, integralRegions: integralRegions.map((ir) => ir.id === id ? { ...ir, ...updates } : ir) });
  }, [data, integralRegions, onChange]);
  const removeIntegral = useCallback((id: string) => {
    onChange({ ...data, integralRegions: integralRegions.filter((ir) => ir.id !== id) });
    if (selectedIntegralId === id) setSelectedIntegralId(null);
  }, [data, integralRegions, selectedIntegralId, onChange]);
  const selectedIntegral = integralRegions.find((ir) => ir.id === selectedIntegralId) || null;

  const addAnnotation = useCallback((functionId: string, x: number) => {
    const newAnn: Annotation = { x, functionId, label: '', showCoord: true };
    const newList = [...annotations, newAnn];
    onChange({ ...data, annotations: newList });
    setSelectedAnnotationIdx(newList.length - 1);
  }, [data, annotations, onChange]);
  const updateAnnotation = useCallback((idx: number, updates: Partial<Annotation>) => {
    onChange({ ...data, annotations: annotations.map((a, i) => i === idx ? { ...a, ...updates } : a) });
  }, [data, annotations, onChange]);
  const removeAnnotation = useCallback((idx: number) => {
    onChange({ ...data, annotations: annotations.filter((_, i) => i !== idx) });
    if (selectedAnnotationIdx === idx) setSelectedAnnotationIdx(null);
  }, [data, annotations, selectedAnnotationIdx, onChange]);
  const removeSelectedAnnotations = useCallback(() => {
    onChange({ ...data, annotations: annotations.filter((_, i) => !selectedAnnotationIdxs.has(i)) });
    setSelectedAnnotationIdxs(new Set());
    setSelectedAnnotationIdx(null);
  }, [data, annotations, selectedAnnotationIdxs, onChange]);
  const selectedAnnotation = selectedAnnotationIdx !== null ? annotations[selectedAnnotationIdx] || null : null;

  // 特征点
  const runFeatureDetection = useCallback(() => {
    const allPoints: FeaturePoint[] = [];
    for (const c of compiledFns) {
      if (!c.evalFn || !c.fn.visible) continue;
      const pts = math.detectFeaturePoints(c.evalFn, c.fn.id, domain[0], domain[1], {
        types: featureVisibleTypes,
      });
      allPoints.push(...pts);
    }
    onChange({ ...data, featurePoints: allPoints });
  }, [compiledFns, domain, featureVisibleTypes, data, onChange, math]);

  useEffect(() => {
    if (toolMode === 'feature') runFeatureDetection();
  }, [toolMode]); // 故意只依赖 toolMode

  const toggleFeatureType = useCallback((type: FeaturePointType) => {
    setFeatureVisibleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  // ── 动画播放 ──

  const dataRef = useRef(data);
  dataRef.current = data;

  const startAnimation = useCallback((paramName: string, speed = 0.05) => {
    if (animTimerRef.current) clearInterval(animTimerRef.current);
    setAnimating({ paramName, speed });
    animTimerRef.current = setInterval(() => {
      const cur = dataRef.current;
      const newParams = cur.parameters.map((p) => {
        if (p.name !== paramName) return p;
        let newVal = p.value + speed;
        if (newVal > p.max) newVal = p.min;
        if (newVal < p.min) newVal = p.max;
        return { ...p, value: Math.round(newVal * 100) / 100 };
      });
      onChange({ ...cur, parameters: newParams });
    }, 50);
  }, [onChange]);

  const stopAnimation = useCallback(() => {
    if (animTimerRef.current) {
      clearInterval(animTimerRef.current);
      animTimerRef.current = null;
    }
    setAnimating(null);
  }, []);

  useEffect(() => {
    return () => {
      if (animTimerRef.current) clearInterval(animTimerRef.current);
    };
  }, []);

  // ── 导出(driver 侧 DOM 操作,svgToPngBlob 不进 capability) ──

  const handleExport = useCallback(async (mode: 'copy' | 'download') => {
    const svgEl = canvasRef.current?.querySelector('svg');
    if (!svgEl) return;
    try {
      const blob = await svgToPngBlob(svgEl as SVGSVGElement);
      if (mode === 'copy') {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'math-visual.png';
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('[MathVisualFullscreen] 导出失败:', err);
    }
  }, []);

  const handleExportSvg = useCallback(() => {
    const svgEl = canvasRef.current?.querySelector('svg') as SVGElement | null;
    if (!svgEl) return;
    // 走 capability self-contained 导出 — 文件外部打开也带样式
    const svgData = math.exportSelfContainedSvg(svgEl);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'math-visual.svg';
    a.click();
    URL.revokeObjectURL(url);
  }, [math]);

  // ── 画布交互 ──

  const pageToMath = useCallback((e: React.MouseEvent): { mathX: number; mathY: number } | null => {
    const svgEl = canvasRef.current?.querySelector('svg');
    if (!svgEl) return null;
    const rect = svgEl.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const relY = (e.clientY - rect.top) / rect.height;
    // 算上 Mafs 四周 0.5 单位边距与等比例放宽(原先按 domain/range 直接线性换算,点下去会偏)
    const [mathX, mathY] = relToData(relX, relY, view);
    return { mathX, mathY };
  }, [view]);

  const findNearbyAnnotation = useCallback((mathX: number, mathY: number): number => {
    const xT = (domain[1] - domain[0]) * 0.02;
    const yT = (range[1] - range[0]) * 0.02;
    for (let i = 0; i < annotations.length; i++) {
      const ann = annotations[i];
      const fn = evalFnMap.get(ann.functionId);
      if (!fn) continue;
      const annY = fn(ann.x);
      if (!isFinite(annY)) continue;
      if (Math.abs(ann.x - mathX) < xT && Math.abs(annY - mathY) < yT) return i;
    }
    return -1;
  }, [annotations, evalFnMap, domain, range]);

  const pageToSvgPx = useCallback((e: React.MouseEvent) => {
    const svgEl = canvasRef.current?.querySelector('svg');
    if (!svgEl) return null;
    const rect = svgEl.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as Element | null;
    if (target?.closest('[data-label-hit-area], .mafs-movable-point, [data-view-controls]')) return;
    if (e.button !== 0) return;
    if (toolMode === 'move' || toolMode === 'select') {
      // 点中图形:Shift → 加选/去掉;否则选中(已在多选里就保持多选)并可拖,拖的是整组
      const hit = hitAt(e);
      if (hit) {
        if (e.shiftKey && hit.part === null) {
          toggleShapeSelected(hit.id);
          return;
        }
        const inSel = selectedShapeIds.includes(hit.id);
        const group = inSel ? selectedShapeIds : [hit.id];
        if (!inSel) setSelectedShapeIds([hit.id]);
        startShapeDrag(e, hit.id, hit.part, group);
        return;
      }
      if (toolMode === 'move') {
        // 点空白:拖动 = 平移;没拖动 = 取消选中
        startPan(e, () => { if (!e.shiftKey) setSelectedShapeIds([]); });
        return;
      }
      // 框选模式点空白:开始拉方框
      boxAdditiveRef.current = e.shiftKey;
    }
    if (toolMode === 'shape' && pendingPoints.length === 0) {
      // 画图形模式下只有拖选中图形的白点才算拖动,其余点击照常添加
      const hit = hitAt(e);
      if (hit && hit.part !== null) {
        startShapeDrag(e, hit.id, hit.part);
        return;
      }
    }
    if (toolMode !== 'select') return;
    const pos = pageToSvgPx(e);
    if (pos) { setBoxSelectStart(pos); setBoxSelectEnd(pos); }
  }, [toolMode, pageToSvgPx, startPan, hitAt, startShapeDrag, pendingPoints.length, selectedShapeIds, toggleShapeSelected]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if ((toolMode === 'move' || toolMode === 'select') && !boxSelectStart) {
      const over = hitAt(e) !== null;
      if (over !== hoverShape) setHoverShape(over);
      return;
    }
    if (toolMode !== 'select' || !boxSelectStart) return;
    const pos = pageToSvgPx(e);
    if (pos) setBoxSelectEnd(pos);
  }, [toolMode, boxSelectStart, pageToSvgPx, hitAt, hoverShape]);

  const handleCanvasMouseUp = useCallback(() => {
    if (toolMode !== 'select' || !boxSelectStart || !boxSelectEnd) {
      setBoxSelectStart(null); setBoxSelectEnd(null);
      return;
    }
    const svgEl = canvasRef.current?.querySelector('svg');
    if (!svgEl) { setBoxSelectStart(null); setBoxSelectEnd(null); return; }
    const rect = svgEl.getBoundingClientRect();
    const toMathX = (px: number) => relToData(px / rect.width, 0, view)[0];
    const toMathY = (px: number) => relToData(0, px / rect.height, view)[1];
    const x1 = Math.min(toMathX(boxSelectStart.x), toMathX(boxSelectEnd.x));
    const x2 = Math.max(toMathX(boxSelectStart.x), toMathX(boxSelectEnd.x));
    const y1 = Math.min(toMathY(boxSelectStart.y), toMathY(boxSelectEnd.y));
    const y2 = Math.max(toMathY(boxSelectStart.y), toMathY(boxSelectEnd.y));
    // 框住的几何对象(完全框住才算);框太小(就是点了一下空白)→ 取消选中
    const tiny = Math.abs(boxSelectEnd.x - boxSelectStart.x) + Math.abs(boxSelectEnd.y - boxSelectStart.y) < 4;
    const inBox = tiny ? [] : shapesInRect(compiledShapes.specs, { x: [x1, x2], y: [y1, y2] });
    setSelectedShapeIds((prev) => (boxAdditiveRef.current ? [...prev, ...inBox.filter((id) => !prev.includes(id))] : inBox));
    const selected = new Set<number>();
    for (let i = 0; i < annotations.length; i++) {
      const ann = annotations[i];
      const fn = evalFnMap.get(ann.functionId);
      if (!fn) continue;
      const annY = fn(ann.x);
      if (!isFinite(annY)) continue;
      if (ann.x >= x1 && ann.x <= x2 && annY >= y1 && annY <= y2) selected.add(i);
    }
    setSelectedAnnotationIdxs(selected);
    setBoxSelectStart(null); setBoxSelectEnd(null);
  }, [toolMode, boxSelectStart, boxSelectEnd, annotations, evalFnMap, view, compiledShapes]);

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    if (toolMode === 'move' || toolMode === 'export' || toolMode === 'select') return;
    const coords = pageToMath(e);
    if (!coords) return;
    const { mathX, mathY } = coords;
    if (toolMode === 'shape') {
      handleShapeClick([mathX, mathY]);
      return;
    }
    const firstVisibleFn = fns.find((fn) => fn.visible && evalFnMap.has(fn.id));
    if (!firstVisibleFn) return;
    switch (toolMode) {
      case 'annotate': {
        const nearIdx = findNearbyAnnotation(mathX, mathY);
        if (nearIdx >= 0) setSelectedAnnotationIdx(nearIdx);
        else addAnnotation(firstVisibleFn.id, mathX);
        break;
      }
      case 'tangent': addTangent(firstVisibleFn.id, mathX); break;
      case 'normal':  addNormal(firstVisibleFn.id, mathX); break;
      case 'integral': {
        const halfW = (domain[1] - domain[0]) * 0.05;
        addIntegral(firstVisibleFn.id, mathX - halfW, mathX + halfW);
        break;
      }
    }
  }, [toolMode, fns, evalFnMap, domain, pageToMath, findNearbyAnnotation, addAnnotation, addTangent, addNormal, addIntegral, handleShapeClick]);

  // ── Keymap:Esc 退出 + Delete/Backspace 删除选中 ──

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (pendingPoints.length > 0) setPendingPoints([]);
        else if (selectedShapeIds.length > 0) setSelectedShapeIds([]);
        else if (toolMode !== 'move') setToolMode('move');
        else onClose();
        return;
      }
      if (e.key === 'Enter' && finishPolygon()) {
        e.preventDefault();
        return;
      }
      const shapeTool = toolMode === 'shape' || toolMode === 'move' || toolMode === 'select';
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && shapeTool) {
        e.preventDefault();
        setSelectedShapeIds(shapes.map((sh) => sh.id));
        return;
      }
      if (selectedShapeIds.length > 0 && shapeTool) {
        const v = viewRef.current;
        const k = e.shiftKey ? 5 : 1;
        const sx = snapStep(v.x[1] - v.x[0]) * k;
        const sy = snapStep(v.y[1] - v.y[0]) * k;
        const nudge: Record<string, Vec2> = { ArrowLeft: [-sx, 0], ArrowRight: [sx, 0], ArrowUp: [0, sy], ArrowDown: [0, -sy] };
        if (nudge[e.key]) {
          e.preventDefault();
          nudgeSelected(nudge[e.key][0], nudge[e.key][1]);
          return;
        }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
          e.preventDefault();
          duplicateSelected();
          return;
        }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (selectedShapeIds.length > 0 && shapeTool) removeSelectedShapes();
        else if (toolMode === 'select' && selectedAnnotationIdxs.size > 0) removeSelectedAnnotations();
        else if (toolMode === 'annotate' && selectedAnnotationIdx !== null) removeAnnotation(selectedAnnotationIdx);
        else if (toolMode === 'tangent' && selectedTangentId) removeTangent(selectedTangentId);
        else if (toolMode === 'normal' && selectedNormalId) removeNormal(selectedNormalId);
        else if (toolMode === 'integral' && selectedIntegralId) removeIntegral(selectedIntegralId);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose, toolMode, setToolMode, selectedAnnotationIdx, selectedAnnotationIdxs, selectedTangentId, selectedNormalId, selectedIntegralId,
      removeAnnotation, removeSelectedAnnotations, removeTangent, removeNormal, removeIntegral,
      pendingPoints, selectedShapeIds, removeSelectedShapes, finishPolygon, nudgeSelected, duplicateSelected, shapes]);

  // ── label 拖动:写回对应 fn 的 labelPos ──

  const handleLabelMove = useCallback((curveId: string, pos: [number, number]) => {
    const newFns = fns.map((f) => (f.id === curveId ? { ...f, labelPos: pos } : f));
    onChange({ ...data, functions: newFns });
  }, [data, fns, onChange]);

  // ── overlays 配置(传给 capability MathHost) ──

  const overlays: OverlaysConfig = useMemo(() => ({
    tangents: tangentLines.map((tl) => ({ id: tl.id, curveId: tl.functionId, x: tl.x, color: tl.color, fixed: tl.fixed, showSlope: tl.showSlope })),
    normals: normalLines.map((nl) => ({ id: nl.id, curveId: nl.functionId, x: nl.x, color: nl.color, fixed: nl.fixed, showSlope: nl.showSlope })),
    integrals: integralRegions.map((ir) => ({ id: ir.id, curveId: ir.functionId, a: ir.a, b: ir.b, color: ir.color, showValue: ir.showValue })),
    features: toolMode === 'feature' ? featurePoints.map((p) => ({ id: p.id, curveId: p.functionId, x: p.x, y: p.y, type: p.type })) : [],
    annotations: annotations.map((ann, i) => ({ id: `ann-${i}`, curveId: ann.functionId, x: ann.x, label: ann.label, color: ann.color, showCoord: ann.showCoord })),
    selectedAnnotationIdx: toolMode === 'annotate' ? selectedAnnotationIdx : null,
    selectedAnnotationIdxs: toolMode === 'select' ? selectedAnnotationIdxs : new Set(),
    riemann: riemannConfig && selectedIntegral ? {
      curveId: selectedIntegral.functionId,
      a: Math.min(selectedIntegral.a, selectedIntegral.b),
      b: Math.max(selectedIntegral.a, selectedIntegral.b),
      n: riemannConfig.n,
      mode: riemannConfig.mode,
      color: selectedIntegral.color,
      showSum: true,
    } : null,
    hoverCoords: toolMode === 'move',
    showEndpoints: true,
  }), [tangentLines, normalLines, integralRegions, featurePoints, annotations,
       toolMode, selectedAnnotationIdx, selectedAnnotationIdxs, riemannConfig, selectedIntegral]);

  const overlayCallbacks: OverlayCallbacks = useMemo(() => ({
    onTangentMove: (id, newX) => updateTangent(id, { x: newX }),
    onNormalMove: (id, newX) => updateNormal(id, { x: newX }),
    onIntegralMove: (id, key, newX) => updateIntegral(id, { [key]: newX }),
    onAnnotationSelect: (idx) => setSelectedAnnotationIdx(idx),
    onAnnotationMove: (idx, newX) => updateAnnotation(idx, { x: newX }),
  }), [updateTangent, updateNormal, updateIntegral, updateAnnotation]);

  const MathHost = math.Host;

  return (
    <div
      className="mv-fullscreen-overlay"
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {/* 顶部栏 */}
      <div className="mv-fullscreen-header">
        <span className="mv-fullscreen-title">MathVisual 工作台</span>
        <div style={{ flex: 1 }} />
        <button className="mv-fullscreen-close" onClick={onClose} title="关闭 (Esc)">
          ×
        </button>
      </div>

      {/* 三栏主体 */}
      <div className="mv-fullscreen-body">
        <LeftPanel
          data={data}
          onChange={onChange}
          toolMode={toolMode}
          onToolChange={setToolMode}
          onExport={handleExport}
          onExportSvg={handleExportSvg}
          onRerunFeatures={runFeatureDetection}
          animating={animating}
          onStartAnimation={startAnimation}
          onStopAnimation={stopAnimation}
          shapeKind={shapeKind}
          onPickShapeKind={pickShapeKind}
          shapeErrors={compiledShapes.errors}
          selectedShapeIds={selectedShapeIds}
          onSelectShape={(id, additive) => (additive ? toggleShapeSelected(id) : setSelectedShapeId(id))}
          onRemoveShape={removeShape}
        />

        <div
          className={`mv-fullscreen-canvas ${toolMode !== 'move' ? 'mv-fullscreen-canvas--tool' : ''} ${toolMode === 'select' ? 'mv-fullscreen-canvas--select' : ''}`}
          style={toolMode === 'move' ? { cursor: hoverShape ? 'move' : 'grab' }
            : toolMode === 'select' && hoverShape ? { cursor: 'move' } : undefined}
          ref={canvasRef}
          onClick={handleCanvasClick}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
        >
          <MathHost
            viewBox={view}
            shapes={shapeSpecs}
            selectedShapeIds={selectedShapeIds}
            height={canvasHeight}
            curves={curves}
            axis={axisConfig}
            zoom={false}
            pan={false}
            preserveAspectRatio={false}
            overlays={overlays}
            overlayCallbacks={overlayCallbacks}
            onLabelMove={handleLabelMove}
            pointSize={canvas.pointSize || 6}
          />

          <div
            data-view-controls
            style={{ position: 'absolute', top: 10, right: 10, display: 'flex', gap: 4, zIndex: 2 }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {([
              ['＋', '放大', () => zoomBy(1 / 1.25)],
              ['−', '缩小', () => zoomBy(1.25)],
              ['⤢', '显示全部图形', fitAll],
            ] as Array<[string, string, () => void]>).map(([icon, title, fn]) => (
              <button
                key={title}
                title={title}
                onClick={fn}
                style={{
                  width: 30, height: 30, borderRadius: 6, cursor: 'pointer',
                  background: '#2a2a2a', border: '1px solid #4a4a4a', color: '#e0e0e0', fontSize: 16,
                }}
              >
                {icon}
              </button>
            ))}
          </div>

          {boxSelectStart && boxSelectEnd && (
            <div
              className="mv-box-select-rect"
              style={{
                left: Math.min(boxSelectStart.x, boxSelectEnd.x),
                top: Math.min(boxSelectStart.y, boxSelectEnd.y),
                width: Math.abs(boxSelectEnd.x - boxSelectStart.x),
                height: Math.abs(boxSelectEnd.y - boxSelectStart.y),
              }}
            />
          )}

          <div className="mv-fullscreen-coords">
            <span>x: [{domain[0]}, {domain[1]}]</span>
            <span>y: [{range[0]}, {range[1]}]</span>
            {canvas.scaleMode === '1:1' && <span>等比例</span>}
            {toolMode !== 'move' && (
              <span className="mv-fullscreen-coords-tool">工具: {toolMode}</span>
            )}
          </div>
        </div>

        <LegendOverlay functions={fns} />

        <RightPanel
          toolMode={toolMode}
          annotations={annotations}
          evalFns={evalFnMap}
          selectedAnnotation={selectedAnnotation}
          selectedAnnotationIdx={selectedAnnotationIdx}
          selectedAnnotationIdxs={selectedAnnotationIdxs}
          onSelectAnnotation={(idx) => setSelectedAnnotationIdx(idx)}
          onUpdateAnnotation={updateAnnotation}
          onRemoveAnnotation={removeAnnotation}
          onRemoveSelectedAnnotations={removeSelectedAnnotations}
          selectedTangent={selectedTangent}
          onUpdateTangent={updateTangent}
          onRemoveTangent={removeTangent}
          selectedNormal={selectedNormal}
          onUpdateNormal={updateNormal}
          onRemoveNormal={removeNormal}
          selectedIntegral={selectedIntegral}
          onUpdateIntegral={updateIntegral}
          onRemoveIntegral={removeIntegral}
          riemannConfig={riemannConfig}
          onRiemannChange={setRiemannConfig}
          featureVisibleTypes={featureVisibleTypes}
          onToggleFeatureType={toggleFeatureType}
          selectedShape={selectedShape}
          selectedShapeError={selectedShape ? compiledShapes.errors[selectedShape.id] : undefined}
          onUpdateShape={updateShape}
          onRemoveShape={removeShape}
          onDuplicateShape={duplicateSelected}
          multiSelectCount={selectedShapeIds.length}
          onUpdateSelectedShapes={updateSelectedShapes}
          onRemoveSelectedShapes={removeSelectedShapes}
          shapeHint={shapeHint}
        />
      </div>
    </div>
  );
};

// ─── 导出(driver 侧 DOM 操作 - 不进 capability) ───────

/**
 * Mafs SVG → PNG Blob(Retina 2x)
 * V1 svgToPngBlob 直迁,纯 DOM 操作,留 driver 内。
 */
function svgToPngBlob(svgElement: SVGSVGElement, scale = 2): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const { width, height } = svgElement.getBoundingClientRect();
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return reject(new Error('Canvas not supported'));

    const svgData = new XMLSerializer().serializeToString(svgElement);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const img = new Image();
    img.onload = () => {
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob((pngBlob) => {
        if (pngBlob) resolve(pngBlob);
        else reject(new Error('PNG conversion failed'));
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('SVG load failed'));
    };
    img.src = url;
  });
}

// ─── Outer Panel(注册到 L2 overlay registry 的 Component)─────

export const MathVisualFullscreenPanel: React.FC<FullscreenOverlayCloseProps> = (props) => (
  <FullscreenErrorBoundary onClose={props.onClose}>
    <InnerPanel {...props} />
  </FullscreenErrorBoundary>
);
