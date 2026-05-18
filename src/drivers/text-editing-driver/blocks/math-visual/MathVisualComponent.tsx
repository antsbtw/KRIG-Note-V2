/**
 * MathVisualComponent — 函数可视化主组件(driver 内)
 *
 * 1:1 改造自 V1 `src/plugins/note/blocks/math-visual/MathVisualComponent.tsx`,核心差异:
 * - 0 import mafs / mathjs(driver 单点屏障);全走 `math-rendering` capability
 * - V1 内嵌的 `<Plot.OfX>` / `<Plot.Parametric>` / `<Line.ThroughPoints>` 元件
 *   被转成 `Curve[]` 配置,喂给 capability `MathHost`(prop-driven 黑盒)
 * - V1 的 `SmartGrid` + `InlineEndpoints` 由 MathHost 内部接管(axis + endpoints props)
 *
 * Phase 1B 范围:全屏按钮 disabled(占位);Phase 2 接入 L2 fullscreen overlay。
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  MathRenderingApi,
  Curve,
  MathAnnotation,
  MathEndpoint,
  AxisDisplayConfig,
} from '@capabilities/math-rendering/types';
import type {
  FunctionEntry, Parameter, MathVisualData, CanvasConfig, AxisConfig,
} from './types';
import { createFunctionEntry, DEFAULT_CANVAS_CONFIG, DEFAULT_AXIS_CONFIG } from './types';
import {
  FunctionRow, ParameterSlider, RangeInput, SettingsPanel,
} from './components';

// ─── Props ──────────────────────────────────────────────

interface MathVisualComponentProps {
  data: MathVisualData;
  onChange: (data: MathVisualData) => void;
  /** 全屏按钮点击(Phase 2);由 NodeView 注入(setContext + controller.show) */
  onFullscreen?: () => void;
  /** Help-panel ? 按钮点击(Phase 3);NodeView 注入,接 insertFn 把表达式注入到 active 函数行 */
  onShowHelp?: (insertFn: (expr: string) => void) => void;
}

// ─── 主组件 ─────────────────────────────────────────────

export const MathVisualComponent: React.FC<MathVisualComponentProps> = ({
  data,
  onChange,
  onFullscreen,
  onShowHelp,
}) => {
  const math = requireCapabilityApi<MathRenderingApi>('math-rendering');
  const { Host: MathHost } = math;

  const { functions: fns, domain, range, parameters, annotations } = data;
  const canvas: CanvasConfig = {
    ...DEFAULT_CANVAS_CONFIG,
    ...(data.canvas || {}),
    axis: { ...DEFAULT_AXIS_CONFIG, ...((data.canvas || {}) as Partial<CanvasConfig>).axis },
  };
  const axis = canvas.axis;
  const [settingsOpen, setSettingsOpen] = useState(false);

  const setCanvas = useCallback(
    (patch: Partial<CanvasConfig>) => onChange({ ...data, canvas: { ...canvas, ...patch } }),
    [data, canvas, onChange],
  );
  const setAxis = useCallback(
    (patch: Partial<AxisConfig>) => onChange({ ...data, canvas: { ...canvas, axis: { ...axis, ...patch } } }),
    [data, canvas, axis, onChange],
  );

  // ── 函数管理 ──

  const updateFunction = useCallback(
    (id: string, updates: Partial<FunctionEntry>) => {
      if (updates.expression !== undefined) {
        const detected = math.detectPlotType(updates.expression);
        updates = { ...updates, plotType: detected.plotType, expression: detected.expression };
      }

      const newFns = fns.map((f) => (f.id === id ? { ...f, ...updates } : f));

      if (updates.expression !== undefined) {
        const allExprs = newFns.filter((f) => f.plotType !== 'vertical-line').map((f) => f.expression);
        const allVarNames = new Set<string>();
        for (const expr of allExprs) {
          for (const v of math.extractParameters(expr)) allVarNames.add(v);
        }
        const newParams: Parameter[] = [];
        for (const name of allVarNames) {
          const existing = parameters.find((p) => p.name === name);
          newParams.push(existing || { name, value: 1, min: -5, max: 5, step: 0.1 });
        }
        onChange({ ...data, functions: newFns, parameters: newParams });
      } else {
        onChange({ ...data, functions: newFns });
      }
    },
    [data, fns, parameters, onChange, math],
  );

  const addFunction = useCallback(() => {
    const newFn = createFunctionEntry(fns.length);
    onChange({ ...data, functions: [...fns, newFn] });
  }, [data, fns, onChange]);

  // Phase 3:help-panel Insert 回调 — 接 expr,自动 detectPlotType + extractParameters
  // 创建新函数 + 同步参数(对齐 V1 insertFromHelp 行为)
  const insertFromHelp = useCallback((expr: string) => {
    const newFn = createFunctionEntry(fns.length, expr);
    const detected = math.detectPlotType(expr);
    newFn.plotType = detected.plotType;
    newFn.expression = detected.expression;
    if (detected.plotType === 'parametric') {
      newFn.label = newFn.label.replace('(x)', '(t)');
    }
    const allFns = [...fns, newFn];
    const allExprs = allFns.filter((f) => f.plotType !== 'vertical-line').map((f) => f.expression);
    const allVarNames = new Set<string>();
    for (const e of allExprs) {
      for (const v of math.extractParameters(e)) allVarNames.add(v);
    }
    const newParams: Parameter[] = [];
    for (const name of allVarNames) {
      const existing = parameters.find((p) => p.name === name);
      newParams.push(existing || { name, value: 1, min: -5, max: 5, step: 0.1 });
    }
    onChange({ ...data, functions: allFns, parameters: newParams });
  }, [data, fns, parameters, onChange, math]);

  const removeFunction = useCallback(
    (id: string) => {
      if (fns.length <= 1) return;
      const newFns = fns.filter((f) => f.id !== id);
      const newAnns = annotations.filter((a) => a.functionId !== id);
      onChange({ ...data, functions: newFns, annotations: newAnns });
    },
    [data, fns, annotations, onChange],
  );

  const updateParameter = useCallback(
    (name: string, value: number) => {
      const newParams = parameters.map((p) =>
        p.name === name ? { ...p, value } : p,
      );
      onChange({ ...data, parameters: newParams });
    },
    [data, parameters, onChange],
  );

  // ── 编译曲线 + 错误信息 + 端点 ──

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
        fn.plotType === 'vertical-line'
      ) {
        return { fn, evalFn: null, contSegs: [], error: null };
      }
      const result = math.createEvalFn(fn.expression, parameters, fn.sourceLatex);
      const discs = result.fn ? math.detectDiscontinuities(result.fn, domain[0], domain[1]) : [];
      const contSegs = result.fn ? math.buildSegments(result.fn, discs, domain[0], domain[1]) : [];
      return { fn, evalFn: result.fn, contSegs, error: result.error };
    });
  }, [fns, parameters, domain, math]);

  // ── 转 curves[] 喂给 MathHost ──

  const curves: Curve[] = useMemo(() => {
    const out: Curve[] = [];
    for (const c of compiledFns) {
      const { fn, evalFn, contSegs } = c;
      if (!fn.visible) continue;

      if (fn.plotType === 'vertical-line') {
        const x = math.makeVerticalLineX(fn.expression);
        if (x == null) continue;
        out.push({
          kind: 'verticalLine', id: fn.id, x,
          color: fn.color, style: fn.style, lineWidth: fn.lineWidth,
        });
        continue;
      }

      if (fn.plotType === 'parametric') {
        const xy = math.makeParametricFn(fn.expression, parameters);
        if (!xy) continue;
        const [tMin, tMax] = fn.paramDomain || [0, 2 * Math.PI];
        out.push({
          kind: 'parametric', id: fn.id, xy, tDomain: [tMin, tMax],
          color: fn.color, style: fn.style, lineWidth: fn.lineWidth,
        });
        continue;
      }

      if (fn.plotType === 'polar') {
        const r = math.makePolarFn(fn.expression, parameters);
        if (!r) continue;
        const [tMin, tMax] = fn.paramDomain || [0, 2 * Math.PI];
        out.push({
          kind: 'polar', id: fn.id, r, thetaDomain: [tMin, tMax],
          color: fn.color, style: fn.style, lineWidth: fn.lineWidth,
        });
        continue;
      }

      // y-of-x:可能有分段
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

  // ── 端点(分段函数边界 ○/●) ──

  const endpoints: MathEndpoint[] = useMemo(() => {
    const out: MathEndpoint[] = [];
    for (const c of compiledFns) {
      if (!c.fn.visible || c.contSegs.length === 0) continue;
      for (const seg of c.contSegs) {
        out.push({ curveId: c.fn.id, x: seg.leftEndpoint.x, y: seg.leftEndpoint.y, closed: seg.leftEndpoint.closed, color: c.fn.color });
        out.push({ curveId: c.fn.id, x: seg.rightEndpoint.x, y: seg.rightEndpoint.y, closed: seg.rightEndpoint.closed, color: c.fn.color });
      }
    }
    return out;
  }, [compiledFns]);

  // ── 标注 ──

  const hostAnnotations: MathAnnotation[] = useMemo(() => {
    return annotations.map((ann, i) => ({
      id: `ann-${i}`,
      curveId: ann.functionId,
      x: ann.x,
      label: ann.label,
      color: ann.color ?? '#FF6B35',
      pointSize: canvas.pointSize,
    }));
  }, [annotations, canvas.pointSize]);

  // ── axis 配置 ──

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

  // ── 画布尺寸 ──

  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(600);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) setCanvasWidth(entry.contentRect.width || 600);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // ── viewBox 与高度计算(scaleMode:fit/1:1/free) ──

  const xSpan = domain[1] - domain[0];
  const ySpan = range[1] - range[0];

  let viewX: [number, number] = domain;
  let viewY: [number, number] = range;
  let finalHeight = canvas.height;

  if (canvas.scaleMode === 'fit') {
    const aspectRatio = canvasWidth / canvas.height;
    const dataRatio = xSpan / ySpan;
    if (dataRatio > aspectRatio) {
      const targetYSpan = xSpan / aspectRatio;
      const yCenter = (range[0] + range[1]) / 2;
      viewY = [yCenter - targetYSpan / 2, yCenter + targetYSpan / 2];
    } else {
      const targetXSpan = ySpan * aspectRatio;
      const xCenter = (domain[0] + domain[1]) / 2;
      viewX = [xCenter - targetXSpan / 2, xCenter + targetXSpan / 2];
    }
  } else if (canvas.scaleMode === '1:1') {
    const computed = Math.round(canvasWidth * (ySpan / xSpan));
    finalHeight = Math.max(200, Math.min(computed, 800));
  }

  // ── 定义域/值域 ──

  const updateDomain = useCallback(
    (idx: 0 | 1, value: number) => {
      const newDomain: [number, number] = [...domain] as [number, number];
      newDomain[idx] = value;
      if (newDomain[0] >= newDomain[1]) return;
      onChange({ ...data, domain: newDomain });
    },
    [data, domain, onChange],
  );

  const updateRange = useCallback(
    (idx: 0 | 1, value: number) => {
      const newRange: [number, number] = [...range] as [number, number];
      newRange[idx] = value;
      if (newRange[0] >= newRange[1]) return;
      onChange({ ...data, range: newRange });
    },
    [data, range, onChange],
  );

  // ── 渲染 ──

  return (
    <div className="math-visual" onMouseDown={(e) => e.stopPropagation()}>
      {/* 全屏按钮(absolute 浮层,与函数行错开:函数行 padding-right 留 36px) */}
      {onFullscreen && (
        <button
          className="mv-fullscreen-btn"
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onFullscreen(); }}
          title="全屏编辑"
        >
          ⛶
        </button>
      )}

      {/* 函数列表 */}
      <div className="mv-fn-list">
        {fns.map((fn) => {
          const compiled = compiledFns.find((c) => c.fn.id === fn.id);
          return (
            <FunctionRow
              key={fn.id}
              fn={fn}
              onUpdate={(updates) => updateFunction(fn.id, updates)}
              onRemove={() => removeFunction(fn.id)}
              canRemove={fns.length > 1}
              error={compiled?.error ?? null}
            />
          );
        })}
        <button className="mv-add-fn" onClick={addFunction}>+ 添加函数</button>
      </div>

      {/* 参数滑块 */}
      {parameters.length > 0 && (
        <div className="mv-params">
          {parameters.map((p) => (
            <ParameterSlider key={p.name} param={p} onChange={(val) => updateParameter(p.name, val)} />
          ))}
        </div>
      )}

      {/* Mafs 画布 */}
      <div className="mv-canvas" ref={canvasRef} style={{ position: 'relative' }}>
        <MathHost
          viewBox={{ x: viewX, y: viewY }}
          height={finalHeight}
          curves={curves}
          annotations={hostAnnotations}
          endpoints={endpoints}
          axis={axisConfig}
          zoom={canvas.zoom}
          pan={canvas.pan}
          preserveAspectRatio={false}
        />
        {settingsOpen && (
          <SettingsPanel canvas={canvas} axis={axis} setCanvas={setCanvas} setAxis={setAxis} />
        )}
      </div>

      {/* 工具栏 — 画布下方独立一行,hover 时显示 */}
      <div className="mv-floating-toolbar">
        <div className="mv-range-group">
          <span className="mv-range-label">x</span>
          <RangeInput value={domain[0]} onCommit={(v) => updateDomain(0, v)} />
          <span className="mv-range-sep">~</span>
          <RangeInput value={domain[1]} onCommit={(v) => updateDomain(1, v)} />
        </div>
        <div className="mv-range-group">
          <span className="mv-range-label">y</span>
          <RangeInput value={range[0]} onCommit={(v) => updateRange(0, v)} />
          <span className="mv-range-sep">~</span>
          <RangeInput value={range[1]} onCommit={(v) => updateRange(1, v)} />
        </div>
        <button
          className="mv-fn-btn"
          onClick={() =>
            onChange({ ...data, domain: [-5, 5], range: [-5, 5], canvas: { ...canvas, height: 350 } })
          }
          title="重置视图"
        >
          重置
        </button>
        <div style={{ flex: 1 }} />
        {onShowHelp && (
          <button
            className="mv-fn-btn"
            onClick={() => onShowHelp(insertFromHelp)}
            title="函数参考"
          >
            ?
          </button>
        )}
        <button
          className={`mv-fn-btn ${settingsOpen ? 'mv-fn-btn--active' : ''}`}
          onClick={() => setSettingsOpen(!settingsOpen)}
          title="显示设置"
        >
          设置
        </button>
      </div>
    </div>
  );
};
