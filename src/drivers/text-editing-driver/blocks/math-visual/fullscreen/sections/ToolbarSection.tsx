/**
 * sections/ToolbarSection — 7 件工具按钮(全屏 LeftPanel)
 *
 * 工具:移动 / 框选 / 标注 / 切线 / 法线 / 积分 / 极值
 * feature 模式下额外显示"重新检测"按钮。
 */

import React from 'react';
import type { ToolMode } from '../../types';

const TOOLS: Array<{ mode: ToolMode; icon: string; label: string; title: string }> = [
  { mode: 'move',     icon: '✋', label: '移动',  title: '拖拽平移 / 滚轮缩放' },
  { mode: 'select',   icon: '⬚',  label: '框选',  title: '框选标注点,批量操作' },
  { mode: 'annotate', icon: '📍', label: '标注',  title: '点击曲线添加标注点' },
  { mode: 'tangent',  icon: '📐', label: '切线',  title: '点击曲线添加切线' },
  { mode: 'normal',   icon: '⊥',  label: '法线',  title: '点击曲线添加法线' },
  { mode: 'integral', icon: '∫',  label: '积分',  title: '点击画布选择积分区间' },
  { mode: 'feature',  icon: '🔍', label: '极值',  title: '自动检测极值/零点/拐点' },
];

interface ToolbarSectionProps {
  toolMode: ToolMode;
  onToolChange: (mode: ToolMode) => void;
  onRerunFeatures: () => void;
}

export const ToolbarSection: React.FC<ToolbarSectionProps> = ({
  toolMode,
  onToolChange,
  onRerunFeatures,
}) => {
  return (
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
    </div>
  );
};
