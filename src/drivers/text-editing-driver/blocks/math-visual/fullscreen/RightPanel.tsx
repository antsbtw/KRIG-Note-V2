/**
 * fullscreen/RightPanel — 全屏模式右侧属性面板
 *
 * 1:1 迁自 V1 `fullscreen/RightPanel.tsx`。根据 toolMode 切显示:
 * - move/export → 空状态提示
 * - annotate/select → 标注列表 + 选中项编辑(+ 框选批量删除)
 * - tangent / normal → 选中切线/法线属性
 * - integral → 选中积分属性 + 黎曼和配置
 * - feature → 特征点类型过滤
 */

import React from 'react';
import type {
  ToolMode, TangentLine, NormalLine, IntegralRegion,
  FeaturePointType, Annotation,
} from '../types';
import { ANNOTATION_LABELS } from '../types';

/** RiemannMode 与 capability 同步(driver 内独立维护避免跨边界类型 import) */
type RiemannMode = 'left' | 'right' | 'midpoint';

interface RightPanelProps {
  toolMode: ToolMode;
  // 标注
  annotations: Annotation[];
  evalFns: Map<string, (x: number) => number>;
  selectedAnnotation: Annotation | null;
  selectedAnnotationIdx: number | null;
  selectedAnnotationIdxs: Set<number>;
  onSelectAnnotation: (idx: number) => void;
  onUpdateAnnotation: (idx: number, updates: Partial<Annotation>) => void;
  onRemoveAnnotation: (idx: number) => void;
  onRemoveSelectedAnnotations: () => void;
  // 切线
  selectedTangent: TangentLine | null;
  onUpdateTangent: (id: string, updates: Partial<TangentLine>) => void;
  onRemoveTangent: (id: string) => void;
  // 法线
  selectedNormal: NormalLine | null;
  onUpdateNormal: (id: string, updates: Partial<NormalLine>) => void;
  onRemoveNormal: (id: string) => void;
  // 积分
  selectedIntegral: IntegralRegion | null;
  onUpdateIntegral: (id: string, updates: Partial<IntegralRegion>) => void;
  onRemoveIntegral: (id: string) => void;
  // 黎曼和
  riemannConfig: { n: number; mode: RiemannMode } | null;
  onRiemannChange: (config: { n: number; mode: RiemannMode } | null) => void;
  // 特征点
  featureVisibleTypes: Set<FeaturePointType>;
  onToggleFeatureType: (type: FeaturePointType) => void;
}

export const RightPanel: React.FC<RightPanelProps> = ({
  toolMode,
  annotations,
  evalFns,
  selectedAnnotation,
  selectedAnnotationIdx,
  selectedAnnotationIdxs,
  onSelectAnnotation,
  onUpdateAnnotation,
  onRemoveAnnotation,
  onRemoveSelectedAnnotations,
  selectedTangent,
  onUpdateTangent,
  onRemoveTangent,
  selectedNormal,
  onUpdateNormal,
  onRemoveNormal,
  selectedIntegral,
  onUpdateIntegral,
  onRemoveIntegral,
  riemannConfig,
  onRiemannChange,
  featureVisibleTypes,
  onToggleFeatureType,
}) => {
  if (toolMode === 'move' || toolMode === 'export') {
    return (
      <div className="mv-fullscreen-right mv-fullscreen-right--empty">
        <div className="mv-fr-placeholder">
          <span className="mv-fr-placeholder-icon">☰</span>
          <span className="mv-fr-placeholder-text">选中对象后显示属性</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mv-fullscreen-right">
      {/* 标注 + 框选 */}
      {(toolMode === 'annotate' || toolMode === 'select') && (
        <>
          <div className="mv-fr-section">
            <div className="mv-fr-section-title">
              标注点 ({annotations.length})
            </div>
            {annotations.length === 0 ? (
              <div className="mv-fr-hint">
                {toolMode === 'annotate' ? '点击曲线添加标注点' : '框选标注点进行批量操作'}
              </div>
            ) : (
              <div className="mv-fr-ann-list">
                {annotations.map((ann, i) => {
                  const fn = evalFns.get(ann.functionId);
                  const y = fn ? fn(ann.x) : NaN;
                  const label = ANNOTATION_LABELS[i % ANNOTATION_LABELS.length];
                  const isSelected = selectedAnnotationIdx === i;
                  const isMultiSelected = selectedAnnotationIdxs.has(i);

                  return (
                    <div
                      key={i}
                      className={`mv-fr-ann-item ${isSelected ? 'mv-fr-ann-item--selected' : ''} ${isMultiSelected ? 'mv-fr-ann-item--multi' : ''}`}
                      onClick={() => onSelectAnnotation(i)}
                    >
                      <span className="mv-fr-ann-label">{label}</span>
                      <span className="mv-fr-ann-coord">
                        ({ann.x.toFixed(2)}, {isFinite(y) ? y.toFixed(2) : '—'})
                      </span>
                      <button
                        className="mv-fr-ann-del"
                        onClick={(e) => { e.stopPropagation(); onRemoveAnnotation(i); }}
                        title="删除"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {toolMode === 'select' && selectedAnnotationIdxs.size > 0 && (
              <button
                className="mv-fr-remove-btn"
                onClick={onRemoveSelectedAnnotations}
                style={{ marginTop: 8 }}
              >
                删除选中 ({selectedAnnotationIdxs.size})
              </button>
            )}
          </div>

          {selectedAnnotation && selectedAnnotationIdx !== null && (
            <div className="mv-fr-section">
              <div className="mv-fr-section-title">
                标注 {ANNOTATION_LABELS[selectedAnnotationIdx % ANNOTATION_LABELS.length]} 属性
              </div>
              <div className="mv-fr-props">
                <div className="mv-fr-prop-row">
                  <span className="mv-fr-prop-label">x</span>
                  <input
                    className="mv-fr-prop-input"
                    type="number"
                    step="0.1"
                    value={selectedAnnotation.x.toFixed(3)}
                    onChange={(e) => onUpdateAnnotation(selectedAnnotationIdx, { x: Number(e.target.value) })}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </div>
                <div className="mv-fr-prop-row">
                  <span className="mv-fr-prop-label">标签</span>
                  <input
                    className="mv-fr-prop-input"
                    type="text"
                    value={selectedAnnotation.label}
                    placeholder={ANNOTATION_LABELS[selectedAnnotationIdx % ANNOTATION_LABELS.length]}
                    onChange={(e) => onUpdateAnnotation(selectedAnnotationIdx, { label: e.target.value })}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </div>
                <div className="mv-fr-prop-row">
                  <label className="mv-fr-prop-check">
                    <input
                      type="checkbox"
                      checked={selectedAnnotation.showCoord !== false}
                      onChange={(e) => onUpdateAnnotation(selectedAnnotationIdx, { showCoord: e.target.checked })}
                    />
                    显示坐标
                  </label>
                </div>
                <button
                  className="mv-fr-remove-btn"
                  onClick={() => onRemoveAnnotation(selectedAnnotationIdx)}
                >
                  删除标注
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* 切线 */}
      {toolMode === 'tangent' && (
        <div className="mv-fr-section">
          <div className="mv-fr-section-title">切线</div>
          {selectedTangent ? (
            <div className="mv-fr-props">
              <div className="mv-fr-prop-row">
                <span className="mv-fr-prop-label">x₀</span>
                <input
                  className="mv-fr-prop-input"
                  type="number"
                  step="0.1"
                  value={selectedTangent.x.toFixed(3)}
                  onChange={(e) => onUpdateTangent(selectedTangent.id, { x: Number(e.target.value) })}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </div>
              <div className="mv-fr-prop-row">
                <label className="mv-fr-prop-check">
                  <input type="checkbox" checked={selectedTangent.showSlope}
                    onChange={(e) => onUpdateTangent(selectedTangent.id, { showSlope: e.target.checked })} />
                  显示斜率
                </label>
              </div>
              <div className="mv-fr-prop-row">
                <label className="mv-fr-prop-check">
                  <input type="checkbox" checked={selectedTangent.fixed}
                    onChange={(e) => onUpdateTangent(selectedTangent.id, { fixed: e.target.checked })} />
                  固定位置
                </label>
              </div>
              <button className="mv-fr-remove-btn" onClick={() => onRemoveTangent(selectedTangent.id)}>
                删除切线
              </button>
            </div>
          ) : (
            <div className="mv-fr-hint">点击曲线添加切线</div>
          )}
        </div>
      )}

      {/* 法线 */}
      {toolMode === 'normal' && (
        <div className="mv-fr-section">
          <div className="mv-fr-section-title">法线</div>
          {selectedNormal ? (
            <div className="mv-fr-props">
              <div className="mv-fr-prop-row">
                <span className="mv-fr-prop-label">x₀</span>
                <input
                  className="mv-fr-prop-input"
                  type="number"
                  step="0.1"
                  value={selectedNormal.x.toFixed(3)}
                  onChange={(e) => onUpdateNormal(selectedNormal.id, { x: Number(e.target.value) })}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </div>
              <div className="mv-fr-prop-row">
                <label className="mv-fr-prop-check">
                  <input type="checkbox" checked={selectedNormal.showSlope}
                    onChange={(e) => onUpdateNormal(selectedNormal.id, { showSlope: e.target.checked })} />
                  显示斜率
                </label>
              </div>
              <div className="mv-fr-prop-row">
                <label className="mv-fr-prop-check">
                  <input type="checkbox" checked={selectedNormal.fixed}
                    onChange={(e) => onUpdateNormal(selectedNormal.id, { fixed: e.target.checked })} />
                  固定位置
                </label>
              </div>
              <button className="mv-fr-remove-btn" onClick={() => onRemoveNormal(selectedNormal.id)}>
                删除法线
              </button>
            </div>
          ) : (
            <div className="mv-fr-hint">点击曲线添加法线</div>
          )}
        </div>
      )}

      {/* 积分 */}
      {toolMode === 'integral' && (
        <div className="mv-fr-section">
          <div className="mv-fr-section-title">积分区域</div>
          {selectedIntegral ? (
            <div className="mv-fr-props">
              <div className="mv-fr-prop-row">
                <span className="mv-fr-prop-label">a</span>
                <input className="mv-fr-prop-input" type="number" step="0.1"
                  value={selectedIntegral.a.toFixed(3)}
                  onChange={(e) => onUpdateIntegral(selectedIntegral.id, { a: Number(e.target.value) })}
                  onKeyDown={(e) => e.stopPropagation()} />
              </div>
              <div className="mv-fr-prop-row">
                <span className="mv-fr-prop-label">b</span>
                <input className="mv-fr-prop-input" type="number" step="0.1"
                  value={selectedIntegral.b.toFixed(3)}
                  onChange={(e) => onUpdateIntegral(selectedIntegral.id, { b: Number(e.target.value) })}
                  onKeyDown={(e) => e.stopPropagation()} />
              </div>
              <div className="mv-fr-prop-row">
                <label className="mv-fr-prop-check">
                  <input type="checkbox" checked={selectedIntegral.showValue}
                    onChange={(e) => onUpdateIntegral(selectedIntegral.id, { showValue: e.target.checked })} />
                  显示面积
                </label>
              </div>
              <button className="mv-fr-remove-btn" onClick={() => onRemoveIntegral(selectedIntegral.id)}>
                删除区域
              </button>
              <div style={{ marginTop: 8 }}>
                <label className="mv-fr-prop-check">
                  <input
                    type="checkbox"
                    checked={riemannConfig !== null}
                    onChange={(e) => onRiemannChange(e.target.checked ? { n: 10, mode: 'left' } : null)}
                  />
                  黎曼和
                </label>
              </div>
              {riemannConfig && (
                <div className="mv-fr-props" style={{ marginTop: 4 }}>
                  <div className="mv-fr-prop-row">
                    <span className="mv-fr-prop-label">n</span>
                    <input type="range" min="2" max="100" step="1"
                      value={riemannConfig.n}
                      className="mv-style-slider" style={{ flex: 1 }}
                      onChange={(e) => onRiemannChange({ ...riemannConfig, n: Number(e.target.value) })} />
                    <span className="mv-fr-prop-label" style={{ minWidth: 28, textAlign: 'right' }}>{riemannConfig.n}</span>
                  </div>
                  <div className="mv-fr-prop-row">
                    {(['left', 'midpoint', 'right'] as RiemannMode[]).map((m) => (
                      <button key={m}
                        className={`mv-style-btn ${riemannConfig.mode === m ? 'mv-style-btn--active' : ''}`}
                        onClick={() => onRiemannChange({ ...riemannConfig, mode: m })}>
                        {m === 'left' ? '左' : m === 'right' ? '右' : '中'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="mv-fr-hint">点击画布选择积分区间</div>
          )}
        </div>
      )}

      {/* 特征点 */}
      {toolMode === 'feature' && (
        <div className="mv-fr-section">
          <div className="mv-fr-section-title">特征点类型</div>
          <div className="mv-fr-props">
            {([
              ['zero', '零点', '#22c55e'],
              ['maximum', '极大值', '#ef4444'],
              ['minimum', '极小值', '#3b82f6'],
              ['inflection', '拐点', '#a855f7'],
            ] as [FeaturePointType, string, string][]).map(([type, label, color]) => (
              <div key={type} className="mv-fr-prop-row">
                <label className="mv-fr-prop-check">
                  <input type="checkbox" checked={featureVisibleTypes.has(type)}
                    onChange={() => onToggleFeatureType(type)} />
                  <span style={{ color }}>{label}</span>
                </label>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
