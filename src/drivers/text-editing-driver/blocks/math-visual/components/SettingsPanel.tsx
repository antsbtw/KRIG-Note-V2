/**
 * SettingsPanel — 画布/坐标轴/网格/交互/数学 设置面板
 *
 * 1:1 迁自 V1 `src/plugins/note/blocks/math-visual/components/SettingsPanel.tsx`。
 * 零依赖。
 */

import React from 'react';
import type { CanvasConfig, AxisConfig, ScaleMode, AngleUnit, WidthMode } from '../types';
import { RangeInput } from './RangeInput';

export function SettingsPanel({
  canvas,
  axis,
  domain,
  range,
  setCanvas,
  setAxis,
  updateDomain,
  updateRange,
  onResetView,
}: {
  canvas: CanvasConfig;
  axis: AxisConfig;
  domain: [number, number];
  range: [number, number];
  setCanvas: (patch: Partial<CanvasConfig>) => void;
  setAxis: (patch: Partial<AxisConfig>) => void;
  updateDomain: (idx: 0 | 1, value: number) => void;
  updateRange: (idx: 0 | 1, value: number) => void;
  onResetView: () => void;
}) {
  return (
    <div className="mv-settings mv-settings--floating">
      {/* 视图范围 */}
      <div className="mv-settings-section">视图范围</div>
      <div className="mv-settings-row">
        <span className="mv-settings-label">x</span>
        <div className="mv-settings-btns">
          <RangeInput value={domain[0]} onCommit={(v) => updateDomain(0, v)} />
          <span className="mv-settings-unit">~</span>
          <RangeInput value={domain[1]} onCommit={(v) => updateDomain(1, v)} />
        </div>
      </div>
      <div className="mv-settings-row">
        <span className="mv-settings-label">y</span>
        <div className="mv-settings-btns">
          <RangeInput value={range[0]} onCommit={(v) => updateRange(0, v)} />
          <span className="mv-settings-unit">~</span>
          <RangeInput value={range[1]} onCommit={(v) => updateRange(1, v)} />
        </div>
      </div>
      <div className="mv-settings-row">
        <span className="mv-settings-label"></span>
        <div className="mv-settings-btns">
          <button className="mv-settings-btn" onClick={onResetView}>重置视图</button>
        </div>
      </div>

      {/* 画布 */}
      <div className="mv-settings-section">画布</div>
      <div className="mv-settings-row">
        <span className="mv-settings-label">宽度</span>
        <div className="mv-settings-btns">
          {([['sm', '小'], ['md', '中'], ['lg', '大'], ['full', '全宽']] as [WidthMode, string][]).map(([mode, label]) => (
            <button key={mode} className={`mv-settings-btn ${(canvas.widthMode ?? 'md') === mode ? 'mv-settings-btn--active' : ''}`}
              onClick={() => setCanvas({ widthMode: mode })}>{label}</button>
          ))}
        </div>
      </div>
      <div className="mv-settings-row">
        <span className="mv-settings-label">比例模式</span>
        <div className="mv-settings-btns">
          {([['fit', '自适应'], ['1:1', '等比 1:1'], ['free', '自由']] as [ScaleMode, string][]).map(([mode, label]) => (
            <button key={mode} className={`mv-settings-btn ${canvas.scaleMode === mode ? 'mv-settings-btn--active' : ''}`}
              onClick={() => setCanvas({ scaleMode: mode })}>{label}</button>
          ))}
        </div>
      </div>
      <div className="mv-settings-row">
        <span className="mv-settings-label">高度</span>
        <div className="mv-settings-btns">
          {[250, 350, 450, 550].map((h) => (
            <button key={h} className={`mv-settings-btn ${canvas.height === h ? 'mv-settings-btn--active' : ''}`}
              onClick={() => setCanvas({ height: h })}>{h}</button>
          ))}
          <RangeInput value={canvas.height} onCommit={(v) => setCanvas({ height: Math.max(150, Math.min(Math.round(v), 800)) })} />
          <span className="mv-settings-unit">px</span>
        </div>
      </div>

      {/* 坐标轴 */}
      <div className="mv-settings-section">坐标轴</div>
      <div className="mv-settings-row">
        <span className="mv-settings-label">显示</span>
        <div className="mv-settings-btns">
          <label className="mv-settings-check">
            <input type="checkbox" checked={axis.showAxes} onChange={(e) => setAxis({ showAxes: e.target.checked })} />坐标轴
          </label>
          <label className="mv-settings-check">
            <input type="checkbox" checked={axis.showAxisArrows} onChange={(e) => setAxis({ showAxisArrows: e.target.checked })} />箭头
          </label>
          <label className="mv-settings-check">
            <input type="checkbox" checked={axis.showNumbers} onChange={(e) => setAxis({ showNumbers: e.target.checked })} />刻度数字
          </label>
        </div>
      </div>
      <div className="mv-settings-row">
        <span className="mv-settings-label">轴标签</span>
        <div className="mv-settings-btns">
          <input className="mv-range-input" style={{ width: 36 }} value={axis.xLabel}
            onChange={(e) => setAxis({ xLabel: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()} />
          <input className="mv-range-input" style={{ width: 36 }} value={axis.yLabel}
            onChange={(e) => setAxis({ yLabel: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()} />
        </div>
      </div>
      <div className="mv-settings-row">
        <span className="mv-settings-label">刻度步长</span>
        <div className="mv-settings-btns">
          <span className="mv-settings-unit">x</span>
          <RangeInput value={axis.xStep ?? 0} onCommit={(v) => setAxis({ xStep: v > 0 ? v : null })} />
          <span className="mv-settings-unit">y</span>
          <RangeInput value={axis.yStep ?? 0} onCommit={(v) => setAxis({ yStep: v > 0 ? v : null })} />
          <span className="mv-settings-unit" style={{ color: '#666' }}>0=自动</span>
        </div>
      </div>

      {/* 网格 */}
      <div className="mv-settings-section">网格</div>
      <div className="mv-settings-row">
        <span className="mv-settings-label">显示</span>
        <div className="mv-settings-btns">
          <label className="mv-settings-check">
            <input type="checkbox" checked={canvas.showGrid} onChange={(e) => setCanvas({ showGrid: e.target.checked })} />网格线
          </label>
        </div>
      </div>

      {/* 交互 */}
      <div className="mv-settings-section">交互</div>
      <div className="mv-settings-row">
        <span className="mv-settings-label">操作</span>
        <div className="mv-settings-btns">
          <label className="mv-settings-check">
            <input type="checkbox" checked={canvas.zoom} onChange={(e) => setCanvas({ zoom: e.target.checked })} />滚轮缩放
          </label>
          <label className="mv-settings-check">
            <input type="checkbox" checked={canvas.pan} onChange={(e) => setCanvas({ pan: e.target.checked })} />拖拽平移
          </label>
        </div>
      </div>

      {/* 数学 */}
      <div className="mv-settings-section">数学</div>
      <div className="mv-settings-row">
        <span className="mv-settings-label">角度单位</span>
        <div className="mv-settings-btns">
          {([['rad', '弧度 rad'], ['deg', '角度 deg']] as [AngleUnit, string][]).map(([unit, label]) => (
            <button key={unit} className={`mv-settings-btn ${canvas.angleUnit === unit ? 'mv-settings-btn--active' : ''}`}
              onClick={() => setCanvas({ angleUnit: unit })}>{label}</button>
          ))}
        </div>
      </div>
      <div className="mv-settings-row">
        <span className="mv-settings-label">标注点</span>
        <div className="mv-settings-btns">
          {[4, 6, 8, 10].map((s) => (
            <button key={s} className={`mv-settings-btn ${canvas.pointSize === s ? 'mv-settings-btn--active' : ''}`}
              onClick={() => setCanvas({ pointSize: s })}>{s}px</button>
          ))}
        </div>
      </div>
    </div>
  );
}
