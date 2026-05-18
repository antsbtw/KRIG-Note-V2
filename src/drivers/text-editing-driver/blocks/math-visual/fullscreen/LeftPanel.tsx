/**
 * fullscreen/LeftPanel — 全屏模式左侧面板
 *
 * 1:1 迁自 V1 `fullscreen/LeftPanel.tsx`。改造:
 * - extractParameters / latexToMathjs 走 capability(`requireCapabilityApi('math-rendering')`)
 * - KaTeX / LatexDisplay 用 driver components/KaTexHelpers(已迁,内部走 capability)
 *
 * 内容:标题输入 + 函数卡片列表 + 参数滑块(动画) + 工具栏(7 件)+ Export 三件套
 */

import React, { useState, useRef, useCallback } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { MathRenderingApi } from '@capabilities/math-rendering/types';
import type { MathVisualData, FunctionEntry, Parameter, ToolMode } from '../types';
import { createFunctionEntry } from '../types';
import { KaTeX, LatexDisplay } from '../components/KaTexHelpers';

interface LeftPanelProps {
  data: MathVisualData;
  onChange: (data: MathVisualData) => void;
  toolMode: ToolMode;
  onToolChange: (mode: ToolMode) => void;
  onExport: (mode: 'copy' | 'download') => void;
  onExportSvg: () => void;
  onRerunFeatures: () => void;
  animating: { paramName: string; speed: number } | null;
  onStartAnimation: (paramName: string, speed?: number) => void;
  onStopAnimation: () => void;
}

/** 工具定义 — V1 7 件 + 'export'(全屏内不放工具栏,export 走右下角 + 顶部) */
const TOOLS: Array<{ mode: ToolMode; icon: string; label: string; title: string }> = [
  { mode: 'move',     icon: '✋', label: '移动',  title: '拖拽平移 / 滚轮缩放' },
  { mode: 'select',   icon: '⬚',  label: '框选',  title: '框选标注点,批量操作' },
  { mode: 'annotate', icon: '📍', label: '标注',  title: '点击曲线添加标注点' },
  { mode: 'tangent',  icon: '📐', label: '切线',  title: '点击曲线添加切线' },
  { mode: 'normal',   icon: '⊥',  label: '法线',  title: '点击曲线添加法线' },
  { mode: 'integral', icon: '∫',  label: '积分',  title: '点击画布选择积分区间' },
  { mode: 'feature',  icon: '🔍', label: '极值',  title: '自动检测极值/零点/拐点' },
];

export const LeftPanel: React.FC<LeftPanelProps> = ({
  data,
  onChange,
  toolMode,
  onToolChange,
  onExport,
  onExportSvg,
  onRerunFeatures,
  animating,
  onStartAnimation,
  onStopAnimation,
}) => {
  const math = requireCapabilityApi<MathRenderingApi>('math-rendering');
  const { functions: fns, parameters, annotations } = data;

  // 函数管理
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

  return (
    <div className="mv-fullscreen-left">
      {/* 函数列表 */}
      <div className="mv-fl-section">
        <div className="mv-fl-section-title">函数</div>
        <div className="mv-fl-fn-list">
          {fns.map((fn) => (
            <FunctionCard
              key={fn.id}
              fn={fn}
              onUpdate={(updates) => updateFunction(fn.id, updates)}
              onRemove={() => removeFunction(fn.id)}
              canRemove={fns.length > 1}
            />
          ))}
        </div>
        <button className="mv-fl-add-btn" onClick={addFunction}>
          + 添加函数
        </button>
      </div>

      {/* 参数滑块 */}
      {parameters.length > 0 && (
        <div className="mv-fl-section">
          <div className="mv-fl-section-title">参数</div>
          {parameters.map((p) => (
            <div key={p.name} className="mv-fl-param-row">
              <span className="mv-fl-param-name">{p.name}</span>
              <input
                type="range"
                className="mv-fl-param-slider"
                min={p.min}
                max={p.max}
                step={p.step}
                value={p.value}
                onChange={(e) => updateParameter(p.name, Number(e.target.value))}
              />
              <span className="mv-fl-param-value">{p.value.toFixed(2)}</span>
              <button
                className={`mv-fl-fn-btn mv-fl-anim-btn ${animating?.paramName === p.name ? 'mv-fl-anim-btn--active' : ''}`}
                onClick={() => {
                  if (animating?.paramName === p.name) {
                    onStopAnimation();
                  } else {
                    onStartAnimation(p.name, p.step);
                  }
                }}
                title={animating?.paramName === p.name ? '停止动画' : '播放动画'}
              >
                {animating?.paramName === p.name ? '⏸' : '▶'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 工具栏 */}
      <div className="mv-fl-section">
        <div className="mv-fl-section-title">工具</div>
        <div className="mv-fl-tools">
          {TOOLS.map(({ mode, icon, label, title }) => (
            <button
              key={mode}
              className={`mv-fl-tool-btn ${toolMode === mode ? 'mv-fl-tool-btn--active' : ''}`}
              onClick={() => onToolChange(mode)}
              title={title}
            >
              <span className="mv-fl-tool-icon">{icon}</span>
              <span className="mv-fl-tool-label">{label}</span>
            </button>
          ))}
        </div>

        {toolMode === 'feature' && (
          <button className="mv-fl-action-btn" onClick={onRerunFeatures}>
            重新检测
          </button>
        )}

        <div className="mv-fl-export-group">
          <button className="mv-fl-action-btn" onClick={() => onExport('copy')}>
            📋 复制 PNG
          </button>
          <button className="mv-fl-action-btn" onClick={() => onExport('download')}>
            💾 下载 PNG
          </button>
          <button className="mv-fl-action-btn" onClick={onExportSvg}>
            🖼 下载 SVG
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── 函数卡片 ─────────────────────────────────────────

function FunctionCard({
  fn,
  onUpdate,
  onRemove,
  canRemove,
}: {
  fn: FunctionEntry;
  onUpdate: (updates: Partial<FunctionEntry>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const math = requireCapabilityApi<MathRenderingApi>('math-rendering');
  const [editing, setEditing] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const COLORS = ['#2D7FF9', '#00D4AA', '#FF6B35', '#A855F7', '#EC4899', '#EAB308', '#ef4444', '#8B5CF6', '#06B6D4', '#84CC16'];

  return (
    <div className="mv-fl-fn-card">
      <div className="mv-fl-fn-header">
        <span
          className="mv-fl-fn-color mv-fn-color--clickable"
          style={{ backgroundColor: fn.color }}
          onClick={() => setStyleOpen(!styleOpen)}
          title="点击修改颜色/线型"
        />
        <span className="mv-fl-fn-label">
          <KaTeX tex={fn.plotType === 'vertical-line' ? 'x =' : fn.label} />
        </span>
        <div style={{ flex: 1 }} />
        <button
          className={`mv-fl-fn-btn mv-fl-fn-btn-tex ${fn.showDerivative ? 'mv-fl-fn-btn--active' : ''}`}
          onClick={() => onUpdate({ showDerivative: !fn.showDerivative })}
          title="导数"
        >
          <KaTeX tex={`${fn.label.replace('(x)', "'(x)")}`} />
        </button>
        <button
          className={`mv-fl-fn-btn ${fn.visible ? '' : 'mv-fl-fn-btn--hidden'}`}
          onClick={() => onUpdate({ visible: !fn.visible })}
          title={fn.visible ? '隐藏' : '显示'}
        >
          {fn.visible ? '👁' : '👁‍🗨'}
        </button>
        {canRemove && (
          <button className="mv-fl-fn-btn mv-fl-fn-btn--remove" onClick={onRemove} title="移除">
            ×
          </button>
        )}
      </div>
      {styleOpen && (
        <div className="mv-style-popover" onMouseDown={(e) => e.stopPropagation()}>
          <div className="mv-style-colors">
            {COLORS.map((c) => (
              <span key={c}
                className={`mv-style-swatch ${c === fn.color ? 'mv-style-swatch--active' : ''}`}
                style={{ backgroundColor: c }}
                onClick={() => onUpdate({ color: c })}
              />
            ))}
          </div>
          <div className="mv-style-row">
            <span className="mv-style-label">线宽</span>
            <input type="range" min="1" max="6" step="0.5" value={fn.lineWidth || 2.5}
              className="mv-style-slider"
              onChange={(e) => onUpdate({ lineWidth: Number(e.target.value) })} />
            <span className="mv-style-value">{fn.lineWidth || 2.5}</span>
          </div>
          <div className="mv-style-row">
            <span className="mv-style-label">线型</span>
            <div className="mv-style-btns">
              {(['solid', 'dashed', 'dotted'] as const).map((s) => (
                <button key={s} className={`mv-style-btn ${s === fn.style ? 'mv-style-btn--active' : ''}`}
                  onClick={() => onUpdate({ style: s })}>
                  {s === 'solid' ? '━━' : s === 'dashed' ? '╌╌' : '┈┈'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="mv-fl-fn-expr-area">
        {editing ? (
          <input
            ref={inputRef}
            className="mv-fl-fn-input"
            value={fn.expression}
            onChange={(e) => onUpdate({ expression: e.target.value })}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setEditing(false);
              e.stopPropagation();
            }}
            onPaste={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const clip = e.clipboardData;
              let text = clip.getData('text/plain') || '';
              text = text.trim();
              if (!text) return;
              const eqMatch = text.match(/^[a-zA-Z]\s*(?:\([^)]*\))?\s*=\s*(.+)$/);
              if (eqMatch) text = eqMatch[1].trim();
              const expr = math.latexToMathjs(text);
              if (expr) {
                onUpdate({ expression: expr, sourceLatex: text });
              } else {
                onUpdate({ expression: text, sourceLatex: text });
              }
            }}
            autoFocus
          />
        ) : (
          <span
            className="mv-fl-fn-expr"
            onClick={() => setEditing(true)}
            title="点击编辑表达式"
          >
            <LatexDisplay expression={fn.expression} />
          </span>
        )}
      </div>
    </div>
  );
}
