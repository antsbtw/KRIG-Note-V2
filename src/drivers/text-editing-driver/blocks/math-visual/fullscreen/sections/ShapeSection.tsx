/**
 * sections/ShapeSection — 几何对象:选画哪种 + 对象列表(题意图 P1,2026-11-06)
 *
 * 选一种 → 进 toolMode 'shape',在画布上点击添加;列表点一行 → 右栏编辑属性。
 * 算不出来的对象在列表里标红并写原因,不静默消失。
 */

import React from 'react';
import type { ShapeEntry, ShapeKind, ToolMode } from '../../types';
import { SHAPE_KINDS, shapeKindMeta } from '../../shapes';

interface ShapeSectionProps {
  shapes: ShapeEntry[];
  errors: Record<string, string>;
  toolMode: ToolMode;
  shapeKind: ShapeKind;
  onPickKind: (kind: ShapeKind) => void;
  selectedShapeIds: string[];
  /** additive = Shift+点击:加选 / 去掉 */
  onSelectShape: (id: string, additive: boolean) => void;
  onRemoveShape: (id: string) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
}

/** 列表里一行的摘要(左栏列表 / 右栏多选列表共用) */
export function shapeSummary(s: ShapeEntry): string {
  const p = (c?: [string, string]) => (c ? `(${c[0]}, ${c[1]})` : '(?)');
  switch (s.kind) {
    case 'point': return `${s.text ? s.text + ' ' : ''}${p(s.at)}`;
    case 'text': return `「${s.text ?? ''}」${p(s.at)}`;
    case 'segment':
    case 'arrow': return `${s.text ? s.text + ' ' : ''}${p(s.from)} → ${p(s.to)}`;
    case 'circle': return `${s.text ? s.text + ' ' : ''}圆心 ${p(s.center)} r=${s.radius ?? '?'}`;
    case 'polygon': return `${s.text ? s.text + ' ' : ''}${s.points?.length ?? 0} 个顶点`;
  }
}

export const ShapeSection: React.FC<ShapeSectionProps> = ({
  shapes,
  errors,
  toolMode,
  shapeKind,
  onPickKind,
  selectedShapeIds,
  onSelectShape,
  onRemoveShape,
  onContextMenu,
}) => {
  return (
    <div className="mv-fl-section">
      <div className="mv-fl-section-title">图形</div>
      <div className="mv-fl-tools">
        {SHAPE_KINDS.map(({ kind, icon, label, hint }) => (
          <button
            key={kind}
            className={`mv-fl-tool-btn ${toolMode === 'shape' && shapeKind === kind ? 'mv-fl-tool-btn--active' : ''}`}
            onClick={() => onPickKind(kind)}
            title={hint}
          >
            <span className="mv-fl-tool-icon">{icon}</span>
            <span className="mv-fl-tool-label">{label}</span>
          </button>
        ))}
      </div>

      {shapes.length > 0 && (
        // 图层顺序:列表越靠上越在前面(和常见绘图软件一致);数组里越靠后越在上面,所以倒着列
        <div className="mv-fr-ann-list" style={{ marginTop: 8 }} title="越靠上的越在前面;右键可调图层">
          {[...shapes].reverse().map((s) => {
            const err = errors[s.id];
            return (
              <div
                key={s.id}
                className={`mv-fr-ann-item ${selectedShapeIds.includes(s.id) ? 'mv-fr-ann-item--selected' : ''}`}
                onClick={(e) => onSelectShape(s.id, e.shiftKey)}
                onContextMenu={(e) => { e.preventDefault(); onContextMenu(s.id, e.clientX, e.clientY); }}
                title={err ? `画不出来:${err}` : undefined}
              >
                <span className="mv-fr-ann-label" style={{ color: s.color }}>
                  {shapeKindMeta(s.kind).icon}
                </span>
                <span
                  className="mv-fr-ann-coord"
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: err ? '#ef4444' : undefined }}
                >
                  {err ? `⚠ ${shapeSummary(s)}` : shapeSummary(s)}
                </span>
                <button
                  className="mv-fr-ann-del"
                  onClick={(e) => { e.stopPropagation(); onRemoveShape(s.id); }}
                  title="删除"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
