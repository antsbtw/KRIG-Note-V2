/**
 * sections/ViewSection — 视图范围 / 等比例 / 网格坐标轴开关(全屏 LeftPanel)
 *
 * 题意图 P1(2026-11-06)补上:原 SettingsPanel 写好了但没挂到任何界面上,
 * 全屏里改不了 x/y 范围、关不掉网格坐标轴;题意图(方位示意图)两样都要。
 */

import React, { useState } from 'react';
import type { MathVisualData, CanvasConfig, AxisConfig } from '../../types';

interface ViewSectionProps {
  data: MathVisualData;
  onChange: (data: MathVisualData) => void;
}

/** 失焦 / 回车才提交;输入到一半(如 "-")不写回 */
function NumInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const n = Number(text);
    if (text.trim() !== '' && isFinite(n)) onCommit(n);
    setText(null);
  };
  return (
    <input
      className="mv-fr-prop-input"
      style={{ width: 56 }}
      value={text ?? String(value)}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

export const ViewSection: React.FC<ViewSectionProps> = ({ data, onChange }) => {
  const canvas = data.canvas;
  const axis = canvas.axis;
  const setCanvas = (patch: Partial<CanvasConfig>) => onChange({ ...data, canvas: { ...canvas, ...patch } });
  const setAxis = (patch: Partial<AxisConfig>) => setCanvas({ axis: { ...axis, ...patch } });
  const setDomain = (i: 0 | 1, v: number) => {
    const d: [number, number] = [...data.domain];
    d[i] = v;
    if (d[0] < d[1]) onChange({ ...data, domain: d });
  };
  const setRange = (i: 0 | 1, v: number) => {
    const r: [number, number] = [...data.range];
    r[i] = v;
    if (r[0] < r[1]) onChange({ ...data, range: r });
  };

  return (
    <div className="mv-fl-section">
      <div className="mv-fl-section-title">视图</div>
      <div className="mv-fr-props">
        <div className="mv-fr-prop-row">
          <span className="mv-fr-prop-label">x</span>
          <NumInput value={data.domain[0]} onCommit={(v) => setDomain(0, v)} />
          <span>~</span>
          <NumInput value={data.domain[1]} onCommit={(v) => setDomain(1, v)} />
        </div>
        <div className="mv-fr-prop-row">
          <span className="mv-fr-prop-label">y</span>
          <NumInput value={data.range[0]} onCommit={(v) => setRange(0, v)} />
          <span>~</span>
          <NumInput value={data.range[1]} onCommit={(v) => setRange(1, v)} />
        </div>
        <label className="mv-fr-prop-check" title="x、y 一个单位一样长(方位图、几何图要开)">
          <input
            type="checkbox"
            checked={canvas.scaleMode === '1:1'}
            onChange={(e) => setCanvas({ scaleMode: e.target.checked ? '1:1' : 'fit' })}
          />
          等比例
        </label>
        <label className="mv-fr-prop-check">
          <input type="checkbox" checked={canvas.showGrid} onChange={(e) => setCanvas({ showGrid: e.target.checked })} />
          网格
        </label>
        <label className="mv-fr-prop-check">
          <input type="checkbox" checked={axis.showAxes} onChange={(e) => setAxis({ showAxes: e.target.checked })} />
          坐标轴
        </label>
        <label className="mv-fr-prop-check">
          <input type="checkbox" checked={axis.showNumbers} onChange={(e) => setAxis({ showNumbers: e.target.checked })} />
          刻度数字
        </label>
      </div>
    </div>
  );
};
