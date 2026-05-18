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
  Annotation, FunctionEntry,
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
    tangentLines: a.tangentLines || [],
    normalLines: a.normalLines || [],
    integralRegions: a.integralRegions || [],
    featurePoints: a.featurePoints || [],
    toolMode: a.toolMode || 'move',
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
  tr = tr.setNodeAttribute(nodePos, 'tangentLines', data.tangentLines || []);
  tr = tr.setNodeAttribute(nodePos, 'normalLines', data.normalLines || []);
  tr = tr.setNodeAttribute(nodePos, 'integralRegions', data.integralRegions || []);
  tr = tr.setNodeAttribute(nodePos, 'featurePoints', data.featurePoints || []);
  tr = tr.setNodeAttribute(nodePos, 'toolMode', data.toolMode || 'move');
  view.dispatch(tr);
}

// ─── Inner Panel(被 ErrorBoundary 包裹) ────────────────

const InnerPanel: React.FC<FullscreenOverlayCloseProps> = ({ onClose }) => {
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
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = entry.contentRect.height - 32;
        if (h > 100) setCanvasHeight(Math.round(h));
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
      if (fn.plotType === 'parametric' || fn.plotType === 'polar' || fn.plotType === 'vertical-line') {
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
    const out: Curve[] = [];
    for (const c of compiledFns) {
      const { fn, evalFn, contSegs } = c;
      if (!fn.visible) continue;

      if (fn.plotType === 'vertical-line') {
        const x = math.makeVerticalLineX(fn.expression);
        if (x == null) continue;
        out.push({ kind: 'verticalLine', id: fn.id, x, color: fn.color, style: fn.style, lineWidth: fn.lineWidth });
        continue;
      }
      if (fn.plotType === 'parametric') {
        const xy = math.makeParametricFn(fn.expression, parameters);
        if (!xy) continue;
        const [tMin, tMax] = fn.paramDomain || [0, 2 * Math.PI];
        out.push({ kind: 'parametric', id: fn.id, xy, tDomain: [tMin, tMax], color: fn.color, style: fn.style, lineWidth: fn.lineWidth });
        continue;
      }
      if (fn.plotType === 'polar') {
        const r = math.makePolarFn(fn.expression, parameters);
        if (!r) continue;
        const [tMin, tMax] = fn.paramDomain || [0, 2 * Math.PI];
        out.push({ kind: 'polar', id: fn.id, r, thetaDomain: [tMin, tMax], color: fn.color, style: fn.style, lineWidth: fn.lineWidth });
        continue;
      }
      if (!evalFn) continue;
      out.push({
        kind: 'fnOfX', id: fn.id, fn: evalFn,
        segments: contSegs.length > 0 ? contSegs.map((s) => ({ domain: s.domain })) : undefined,
        derivative: fn.showDerivative,
        color: fn.color, style: fn.style, lineWidth: fn.lineWidth,
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
    const svgEl = canvasRef.current?.querySelector('svg');
    if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'math-visual.svg';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // ── 画布交互 ──

  const pageToMath = useCallback((e: React.MouseEvent): { mathX: number; mathY: number } | null => {
    const svgEl = canvasRef.current?.querySelector('svg');
    if (!svgEl) return null;
    const rect = svgEl.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const relY = (e.clientY - rect.top) / rect.height;
    return {
      mathX: domain[0] + relX * (domain[1] - domain[0]),
      mathY: range[1] - relY * (range[1] - range[0]),
    };
  }, [domain, range]);

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
    if (toolMode !== 'select') return;
    const pos = pageToSvgPx(e);
    if (pos) { setBoxSelectStart(pos); setBoxSelectEnd(pos); }
  }, [toolMode, pageToSvgPx]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (toolMode !== 'select' || !boxSelectStart) return;
    const pos = pageToSvgPx(e);
    if (pos) setBoxSelectEnd(pos);
  }, [toolMode, boxSelectStart, pageToSvgPx]);

  const handleCanvasMouseUp = useCallback(() => {
    if (toolMode !== 'select' || !boxSelectStart || !boxSelectEnd) {
      setBoxSelectStart(null); setBoxSelectEnd(null);
      return;
    }
    const svgEl = canvasRef.current?.querySelector('svg');
    if (!svgEl) { setBoxSelectStart(null); setBoxSelectEnd(null); return; }
    const rect = svgEl.getBoundingClientRect();
    const toMathX = (px: number) => domain[0] + (px / rect.width) * (domain[1] - domain[0]);
    const toMathY = (px: number) => range[1] - (px / rect.height) * (range[1] - range[0]);
    const x1 = Math.min(toMathX(boxSelectStart.x), toMathX(boxSelectEnd.x));
    const x2 = Math.max(toMathX(boxSelectStart.x), toMathX(boxSelectEnd.x));
    const y1 = Math.min(toMathY(boxSelectStart.y), toMathY(boxSelectEnd.y));
    const y2 = Math.max(toMathY(boxSelectStart.y), toMathY(boxSelectEnd.y));
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
  }, [toolMode, boxSelectStart, boxSelectEnd, annotations, evalFnMap, domain, range]);

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (toolMode === 'move' || toolMode === 'export' || toolMode === 'select') return;
    const coords = pageToMath(e);
    if (!coords) return;
    const { mathX, mathY } = coords;
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
  }, [toolMode, fns, evalFnMap, domain, pageToMath, findNearbyAnnotation, addAnnotation, addTangent, addNormal, addIntegral]);

  // ── Keymap:Esc 退出 + Delete/Backspace 删除选中 ──

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (toolMode !== 'move') setToolMode('move');
        else onClose();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (toolMode === 'select' && selectedAnnotationIdxs.size > 0) removeSelectedAnnotations();
        else if (toolMode === 'annotate' && selectedAnnotationIdx !== null) removeAnnotation(selectedAnnotationIdx);
        else if (toolMode === 'tangent' && selectedTangentId) removeTangent(selectedTangentId);
        else if (toolMode === 'normal' && selectedNormalId) removeNormal(selectedNormalId);
        else if (toolMode === 'integral' && selectedIntegralId) removeIntegral(selectedIntegralId);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose, toolMode, setToolMode, selectedAnnotationIdx, selectedAnnotationIdxs, selectedTangentId, selectedNormalId, selectedIntegralId,
      removeAnnotation, removeSelectedAnnotations, removeTangent, removeNormal, removeIntegral]);

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
        />

        <div
          className={`mv-fullscreen-canvas ${toolMode !== 'move' ? 'mv-fullscreen-canvas--tool' : ''} ${toolMode === 'select' ? 'mv-fullscreen-canvas--select' : ''}`}
          ref={canvasRef}
          onClick={handleCanvasClick}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
        >
          <MathHost
            viewBox={{ x: domain, y: range }}
            height={canvasHeight}
            curves={curves}
            axis={axisConfig}
            zoom={toolMode === 'move' && canvas.zoom !== false}
            pan={toolMode === 'move' && canvas.pan !== false}
            preserveAspectRatio={false}
            overlays={overlays}
            overlayCallbacks={overlayCallbacks}
            pointSize={canvas.pointSize || 6}
          />

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
