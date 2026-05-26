/**
 * MathVisualComponent — 函数可视化 inline 薄壳(PR4 2026-05-26 SVG 缓存方案)
 *
 * **架构定位**:inline 完全不跑 mafs / mathjs / marching squares。
 * 渲染源 = PM attrs.thumbnail(全屏 ⛶ 退出时生成的 SVG 字符串)。
 *
 * - 有 thumbnail → dangerouslySetInnerHTML 直接渲染 SVG(响应式宽度缩放,
 *   永远是全屏退出时的最佳视觉)
 * - 无 thumbnail(刚 slash 创建,还没进过全屏) → 显示"双击进入编辑" placeholder
 *
 * 交互入口:
 * - 顶部右上 hover toolbar:宽度档位(小/中/大/全宽) + ⛶ 全屏按钮
 * - 双击画布 → 进全屏
 *
 * 函数 CRUD / 参数 / 工具 / 标注 / 视图设置等编辑能力 全部走全屏 panel,
 * inline 不重复实现。
 */

import React, { useCallback } from 'react';
import type { MathVisualData, CanvasConfig } from './types';
import { DEFAULT_CANVAS_CONFIG } from './types';

interface MathVisualComponentProps {
  data: MathVisualData;
  onChange: (data: MathVisualData) => void;
  /** 全屏按钮 / 双击触发(由 NodeView 注入) */
  onFullscreen?: () => void;
}

const WIDTH_OPTIONS: Array<{ mode: 'sm' | 'md' | 'lg' | 'full'; label: string; title: string }> = [
  { mode: 'sm',   label: '小',   title: '40% 宽度' },
  { mode: 'md',   label: '中',   title: '60% 宽度' },
  { mode: 'lg',   label: '大',   title: '80% 宽度' },
  { mode: 'full', label: '全宽', title: '100% 宽度' },
];

export const MathVisualComponent: React.FC<MathVisualComponentProps> = ({
  data,
  onChange,
  onFullscreen,
}) => {
  const canvas: CanvasConfig = { ...DEFAULT_CANVAS_CONFIG, ...(data.canvas || {}) };
  const widthMode = canvas.widthMode ?? 'md';
  const thumbnail = data.thumbnail ?? null;

  const setWidthMode = useCallback(
    (next: 'sm' | 'md' | 'lg' | 'full') => {
      onChange({ ...data, canvas: { ...canvas, widthMode: next } });
    },
    [data, canvas, onChange],
  );

  const handleCanvasDoubleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onFullscreen) onFullscreen();
  }, [onFullscreen]);

  return (
    <div className="math-visual" onMouseDown={(e) => e.stopPropagation()}>
      {/* 顶部 hover 工具栏(idle 隐藏,绝对定位右上) */}
      <div className="mv-toolbar-row mv-toolbar-row--inline">
        {WIDTH_OPTIONS.map(({ mode, label, title }) => (
          <button
            key={mode}
            className={`mv-fn-btn mv-toolbar-btn ${widthMode === mode ? 'mv-fn-btn--active' : ''}`}
            onClick={() => setWidthMode(mode)}
            title={title}
          >
            {label}
          </button>
        ))}
        {onFullscreen && (
          <button
            className="mv-fn-btn mv-toolbar-btn"
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onFullscreen(); }}
            title="全屏编辑"
          >
            ⛶
          </button>
        )}
      </div>

      {/* 画布区:有 thumbnail 显 SVG;无则 placeholder。双击都进全屏 */}
      <div
        className="mv-canvas mv-canvas--inline-thumbnail"
        onDoubleClick={handleCanvasDoubleClick}
      >
        {thumbnail ? (
          <div
            className="mv-thumbnail-svg"
            dangerouslySetInnerHTML={{ __html: thumbnail }}
          />
        ) : (
          <div className="mv-empty-placeholder">
            <span className="mv-empty-placeholder__hint">双击进入编辑</span>
          </div>
        )}
      </div>
    </div>
  );
};
