/**
 * sections/ShapeEditor — 选中几何对象的属性(全屏 RightPanel 顶部;题意图 P1,2026-11-06)
 *
 * 坐标是表达式字符串(数字或引用参数),改了立刻生效;算不出来就在顶上写原因。
 */

import React, { useState } from 'react';
import { shapeSummary } from './ShapeSection';
import type { ShapeEntry, CoordExpr } from '../../types';
import { FUNCTION_COLORS } from '../../types';
import { shapeKindMeta } from '../../shapes';

const COLORS = [...FUNCTION_COLORS, '#9ca3af', '#ef4444'];
const GHOST_OPACITY = 0.35;

interface ShapeEditorProps {
  shape: ShapeEntry;
  error: string | undefined;
  onUpdate: (id: string, updates: Partial<ShapeEntry>) => void;
  onRemove: (id: string) => void;
  /** 不传就不显示「复制一份」(多选列表里展开的单项不单独复制) */
  onDuplicate?: () => void;
  /** 多选列表里展开时,标题已在行头,不再重复 */
  hideTitle?: boolean;
}

const stop = (e: React.KeyboardEvent) => e.stopPropagation();

function CoordRow({ label, value, onChange }: { label: string; value: CoordExpr | undefined; onChange: (v: CoordExpr) => void }) {
  const v = value ?? ['', ''];
  return (
    <div className="mv-fr-prop-row">
      <span className="mv-fr-prop-label">{label}</span>
      <input className="mv-fr-prop-input" style={{ width: 0, minWidth: 0 }} value={v[0]} placeholder="x"
        onChange={(e) => onChange([e.target.value, v[1]])} onKeyDown={stop} />
      <input className="mv-fr-prop-input" style={{ width: 0, minWidth: 0 }} value={v[1]} placeholder="y"
        onChange={(e) => onChange([v[0], e.target.value])} onKeyDown={stop} />
    </div>
  );
}

export const ShapeEditor: React.FC<ShapeEditorProps> = ({ shape: s, error, onUpdate, onRemove, onDuplicate, hideTitle }) => {
  const up = (u: Partial<ShapeEntry>) => onUpdate(s.id, u);
  const meta = shapeKindMeta(s.kind);
  const isLine = s.kind === 'segment' || s.kind === 'arrow';
  const hasStroke = isLine || s.kind === 'circle' || s.kind === 'polygon';

  return (
    <div className="mv-fr-section">
      {!hideTitle && <div className="mv-fr-section-title">{meta.label}</div>}
      {error && (
        <div className="mv-fr-hint" style={{ color: '#ef4444' }}>画不出来:{error}</div>
      )}
      <div className="mv-fr-props">
        {(s.kind === 'point' || s.kind === 'text') && (
          <CoordRow label="位置" value={s.at} onChange={(at) => up({ at })} />
        )}
        {isLine && (
          <>
            <CoordRow label="起点" value={s.from} onChange={(from) => up({ from })} />
            <CoordRow label="终点" value={s.to} onChange={(to) => up({ to })} />
          </>
        )}
        {s.kind === 'circle' && (
          <>
            <CoordRow label="圆心" value={s.center} onChange={(center) => up({ center })} />
            <div className="mv-fr-prop-row">
              <span className="mv-fr-prop-label">半径</span>
              <input className="mv-fr-prop-input" value={s.radius ?? ''}
                onChange={(e) => up({ radius: e.target.value })} onKeyDown={stop} />
            </div>
          </>
        )}

        {s.kind === 'polygon' && (
          <>
            {(s.points ?? []).map((pt, i) => (
              <CoordRow key={i} label={`顶点${i + 1}`} value={pt}
                onChange={(v) => up({ points: (s.points ?? []).map((q, k) => (k === i ? v : q)) })} />
            ))}
            <label className="mv-fr-prop-check">
              <input type="checkbox" checked={s.fill !== false}
                onChange={(e) => up({ fill: e.target.checked ? undefined : false })} />
              填充
            </label>
          </>
        )}

        <div className="mv-fr-prop-row">
          <span className="mv-fr-prop-label">{s.kind === 'text' ? '内容' : '标签'}</span>
          <input className="mv-fr-prop-input" value={s.text ?? ''}
            placeholder={s.kind === 'text' ? '' : '可不填'}
            onChange={(e) => up({ text: e.target.value })} onKeyDown={stop} />
        </div>

        <div className="mv-fr-prop-row" style={{ flexWrap: 'wrap', gap: 4 }}>
          <span className="mv-fr-prop-label">颜色</span>
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => up({ color: c })}
              title={c}
              style={{
                width: 18, height: 18, borderRadius: '50%', background: c, padding: 0, cursor: 'pointer',
                border: s.color === c ? '2px solid #ffffff' : '2px solid transparent',
              }}
            />
          ))}
        </div>

        {hasStroke && (
          <div className="mv-fr-prop-row">
            <span className="mv-fr-prop-label">线</span>
            {(['solid', 'dashed'] as const).map((st) => (
              <button key={st}
                style={{ whiteSpace: 'nowrap' }}
                className={`mv-style-btn ${(s.style === 'dotted' ? 'dashed' : s.style) === st ? 'mv-style-btn--active' : ''}`}
                onClick={() => up({ style: st })}>
                {st === 'solid' ? '实线' : '虚线'}
              </button>
            ))}
            <input className="mv-fr-prop-input" style={{ width: 44 }} type="number" min={1} max={10} step={0.5}
              value={s.lineWidth} title="线宽"
              onChange={(e) => { const n = Number(e.target.value); if (n > 0) up({ lineWidth: n }); }}
              onKeyDown={stop} />
          </div>
        )}

        <label className="mv-fr-prop-check" title="半透明,表示「此刻在这里」的虚影">
          <input type="checkbox" checked={(s.opacity ?? 1) < 1}
            onChange={(e) => up({ opacity: e.target.checked ? GHOST_OPACITY : undefined })} />
          虚影
        </label>

        {isLine && (
          <>
            <div className="mv-fr-prop-row">
              <span className="mv-fr-prop-label">刻度</span>
              <input className="mv-fr-prop-input" style={{ width: 56 }} type="number" min={0}
                placeholder="间隔" value={s.ticks?.step ?? ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') { up({ ticks: undefined }); return; }
                  up({ ticks: { ...(s.ticks ?? {}), step: Number(raw) } });
                }}
                onKeyDown={stop} />
            </div>
            {s.ticks && (
              <div className="mv-fr-prop-row">
                <span className="mv-fr-prop-label">刻度字</span>
                <input className="mv-fr-prop-input"
                  placeholder="逗号分隔,如 2:30,3:30;不填标距离"
                  value={(s.ticks.labels ?? []).join(',')}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const labels = raw.trim() === '' ? undefined : raw.split(/[,，]/).map((x) => x.trim());
                    up({ ticks: { step: s.ticks!.step, labels } });
                  }}
                  onKeyDown={stop} />
              </div>
            )}
            <label className="mv-fr-prop-check" title="在中点画 ✗,表示「题目不是问这个」">
              <input type="checkbox" checked={!!s.struck} onChange={(e) => up({ struck: e.target.checked || undefined })} />
              打叉
            </label>
          </>
        )}

        {onDuplicate && (
          <button className="mv-fr-remove-btn" style={{ color: '#e0e0e0' }} onClick={onDuplicate} title="⌘D">复制一份</button>
        )}
        <button className="mv-fr-remove-btn" onClick={() => onRemove(s.id)}>删除</button>
      </div>
    </div>
  );
};

/** 多选时的统一操作:颜色 / 实虚线 / 虚影 / 复制 / 删除 */
export const MultiShapeEditor: React.FC<{
  count: number;
  onUpdateAll: (updates: Partial<ShapeEntry>) => void;
  onDuplicate: () => void;
  onRemoveAll: () => void;
}> = ({ count, onUpdateAll, onDuplicate, onRemoveAll }) => (
  <div className="mv-fr-section">
    <div className="mv-fr-section-title">已选 {count} 个图形</div>
    <div className="mv-fr-props">
      <div className="mv-fr-prop-row" style={{ flexWrap: 'wrap', gap: 4 }}>
        <span className="mv-fr-prop-label">颜色</span>
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => onUpdateAll({ color: c })}
            title={c}
            style={{ width: 18, height: 18, borderRadius: '50%', background: c, padding: 0, cursor: 'pointer', border: '2px solid transparent' }}
          />
        ))}
      </div>
      <div className="mv-fr-prop-row">
        <span className="mv-fr-prop-label">线</span>
        <button className="mv-style-btn" style={{ whiteSpace: 'nowrap' }} onClick={() => onUpdateAll({ style: 'solid' })}>实线</button>
        <button className="mv-style-btn" style={{ whiteSpace: 'nowrap' }} onClick={() => onUpdateAll({ style: 'dashed' })}>虚线</button>
      </div>
      <div className="mv-fr-prop-row">
        <span className="mv-fr-prop-label">虚影</span>
        <button className="mv-style-btn" style={{ whiteSpace: 'nowrap' }} onClick={() => onUpdateAll({ opacity: GHOST_OPACITY })}>设为虚影</button>
        <button className="mv-style-btn" style={{ whiteSpace: 'nowrap' }} onClick={() => onUpdateAll({ opacity: undefined })}>取消</button>
      </div>
      <button className="mv-fr-remove-btn" style={{ color: '#e0e0e0' }} onClick={onDuplicate} title="⌘D">复制这 {count} 个</button>
      <button className="mv-fr-remove-btn" onClick={onRemoveAll}>删除这 {count} 个</button>
    </div>
  </div>
);

/**
 * 多选时右栏下半部分:逐个列出选中的元素,点一行就地展开它的完整编辑项
 * (2026-11-06 用户:「既然选了两个图形,那就在右边的框框列表这些选定的元素…用户就可以直接编辑了」)
 */
export const SelectedShapeList: React.FC<{
  shapes: ShapeEntry[];
  errors: Record<string, string>;
  onUpdate: (id: string, updates: Partial<ShapeEntry>) => void;
  onRemove: (id: string) => void;
}> = ({ shapes, errors, onUpdate, onRemove }) => {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="mv-fr-section">
      <div className="mv-fr-section-title">逐个编辑</div>
      <div className="mv-fr-ann-list">
        {shapes.map((s) => {
          const open = openId === s.id;
          const err = errors[s.id];
          return (
            <div key={s.id}>
              <div
                className={`mv-fr-ann-item ${open ? 'mv-fr-ann-item--selected' : ''}`}
                onClick={() => setOpenId(open ? null : s.id)}
                title={open ? '点一下收起' : '点一下展开编辑'}
              >
                <span className="mv-fr-ann-label" style={{ color: s.color }}>
                  {open ? '▾' : '▸'} {shapeKindMeta(s.kind).icon}
                </span>
                <span
                  className="mv-fr-ann-coord"
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: err ? '#ef4444' : undefined }}
                >
                  {err ? `⚠ ${shapeSummary(s)}` : shapeSummary(s)}
                </span>
                <button
                  className="mv-fr-ann-del"
                  onClick={(e) => { e.stopPropagation(); onRemove(s.id); }}
                  title="只删这一个"
                >
                  ×
                </button>
              </div>
              {open && (
                <div style={{ paddingLeft: 8, borderLeft: `2px solid ${s.color}`, marginBottom: 6 }}>
                  <ShapeEditor shape={s} error={err} onUpdate={onUpdate} onRemove={onRemove} hideTitle />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
