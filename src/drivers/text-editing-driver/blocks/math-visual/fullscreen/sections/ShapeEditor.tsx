/**
 * sections/ShapeEditor — 选中几何对象的属性(全屏 RightPanel 顶部;题意图 P1,2026-11-06)
 *
 * 坐标是表达式字符串(数字或引用参数),改了立刻生效;算不出来就在顶上写原因。
 */

import React, { useState } from 'react';
import type { ShapeEntry, CoordExpr } from '../../types';
import { FUNCTION_COLORS } from '../../types';
import { shapeKindMeta } from '../../shapes';

const COLORS = [...FUNCTION_COLORS, '#9ca3af', '#ef4444'];
const GHOST_OPACITY = 0.35;

interface ShapeEditorProps {
  shape: ShapeEntry;
  error: string | undefined;
  onUpdate: (id: string, updates: Partial<ShapeEntry>) => void;
  /** 多选列表里展开时,标题已在行头,不再重复 */
  hideTitle?: boolean;
  /** 打开说明卡片原地编辑(画布上) */
  onEditCard?: (id: string) => void;
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

// 复制 / 删除 / 图层走右键菜单与快捷键(2026-11-06 用户:「复制删除用右键菜单好了」),这里只放编辑项
export const ShapeEditor: React.FC<ShapeEditorProps> = ({ shape: s, error, onUpdate, hideTitle, onEditCard }) => {
  const up = (u: Partial<ShapeEntry>) => onUpdate(s.id, u);
  const meta = shapeKindMeta(s.kind);
  const isLine = s.kind === 'segment' || s.kind === 'arrow';
  const hasStroke = isLine || s.kind === 'circle' || s.kind === 'polygon';

  return (
    <div className={hideTitle ? undefined : 'mv-fr-section'}>
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

        {s.note ? (
          // 说明卡片:内容是一小段 note,在画布上原地编辑;这里只预览 + 入口
          <>
            <div className="mv-fr-prop-row" style={{ alignItems: 'flex-start' }}>
              <span className="mv-fr-prop-label">{s.kind === 'text' ? '内容' : '标签'}</span>
              <div
                title="双击画布上的卡片,或点「编辑卡片」"
                style={{
                  flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', fontSize: 12, color: '#e0e0e0',
                  background: '#252525', border: '1px solid #444', borderRadius: 4, padding: '3px 6px',
                  maxHeight: 96, overflow: 'auto',
                }}
              >
                {s.text || '(空)'}
              </div>
            </div>
            <div className="mv-fr-prop-row">
              <span className="mv-fr-prop-label" />
              {onEditCard && (
                <button className="mv-style-btn" style={{ whiteSpace: 'nowrap' }} onClick={() => onEditCard(s.id)}>编辑卡片</button>
              )}
              <button className="mv-style-btn" style={{ whiteSpace: 'nowrap' }} title="去掉格式,只留文字(单行显示)"
                onClick={() => up({ note: undefined, text: (s.text ?? '').split('\n')[0] })}>
                转回纯文字
              </button>
            </div>
            <div className="mv-fr-prop-row">
              <span className="mv-fr-prop-label">卡片宽</span>
              <input className="mv-fr-prop-input" style={{ width: 0, minWidth: 56 }} type="number" min={80} max={800} step={10}
                value={s.noteWidth ?? 220}
                onChange={(e) => { const n = Number(e.target.value); if (n >= 80) up({ noteWidth: n }); }}
                onKeyDown={stop} />
            </div>
          </>
        ) : (
          <div className="mv-fr-prop-row">
            <span className="mv-fr-prop-label">{s.kind === 'text' ? '内容' : '标签'}</span>
            <input className="mv-fr-prop-input" value={s.text ?? ''}
              placeholder={s.kind === 'text' ? '' : '可不填'}
              onChange={(e) => up({ text: e.target.value })} onKeyDown={stop} />
            {onEditCard && (
              <button className="mv-style-btn" style={{ whiteSpace: 'nowrap' }}
                title="多行、列表、公式……(也可以双击画布上的标签)"
                onClick={() => onEditCard(s.id)}>
                卡片
              </button>
            )}
          </div>
        )}
        {s.labelOffset && s.kind !== 'text' && (
          <div className="mv-fr-prop-row">
            <span className="mv-fr-prop-label">标签位置</span>
            <span className="mv-fr-hint" style={{ margin: 0 }}>已拖动</span>
            <button className="mv-style-btn" style={{ whiteSpace: 'nowrap' }} onClick={() => up({ labelOffset: undefined })}>复位</button>
          </div>
        )}

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
            <input className="mv-fr-prop-input" style={{ width: 0, minWidth: 40 }} type="number" min={1} max={10} step={0.5}
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

        <div className="mv-fr-hint">双击标签写多行 / 列表 / 公式;拖标签挪位置;右键:复制 / 删除 / 调图层</div>
      </div>
    </div>
  );
};

/** 多选时的统一修改:颜色 / 实虚线 / 虚影;默认收起(用户:「整体变换这些用途不大,可以先收起来」) */
export const MultiShapeEditor: React.FC<{
  count: number;
  onUpdateAll: (updates: Partial<ShapeEntry>) => void;
}> = ({ count, onUpdateAll }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="mv-fr-section">
      <div className="mv-fr-section-title" style={{ cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} 整体修改这 {count} 个
      </div>
      {open && (
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
        </div>
      )}
    </div>
  );
};

/**
 * 多选时:选中的元素从上到下直接排开,每个都是完整的编辑区(不折叠、不点选)
 * (2026-11-06 用户:「直接元素列表就好了,不要用户点击选择 tab 了…从上至下排列展开,方便用户直接修改」)
 * 不放进 .mv-fr-ann-list:那个容器限高 300px 内部滚动,第二个元素会被挤到框外。
 */
export const SelectedShapeList: React.FC<{
  shapes: ShapeEntry[];
  errors: Record<string, string>;
  onUpdate: (id: string, updates: Partial<ShapeEntry>) => void;
  onRemove: (id: string) => void;
  onEditCard?: (id: string) => void;
}> = ({ shapes, errors, onUpdate, onRemove, onEditCard }) => (
  <>
    {shapes.map((s) => (
      <div key={s.id} className="mv-fr-section" style={{ borderLeft: `3px solid ${s.color}` }}>
        <div className="mv-fr-section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: s.color }}>{shapeKindMeta(s.kind).icon}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {shapeKindMeta(s.kind).label}{s.text ? ` · ${s.text}` : ''}
          </span>
          <button className="mv-fr-ann-del" onClick={() => onRemove(s.id)} title="删掉这一个">×</button>
        </div>
        <ShapeEditor shape={s} error={errors[s.id]} onUpdate={onUpdate} hideTitle onEditCard={onEditCard} />
      </div>
    ))}
  </>
);
