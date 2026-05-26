/**
 * sections/ParametersSection — 参数滑块 + 动画播放(全屏 LeftPanel)
 *
 * parameters 为空时整段不渲染(避免占空间)。
 * 动画态由 LeftPanel 持有(animating + onStartAnimation + onStopAnimation),
 * 本 section 仅消费 + 触发回调,不持有自己的动画 state。
 */

import React from 'react';
import type { Parameter } from '../../types';
import type { UseFunctionManagementResult } from '../../hooks/useFunctionManagement';

interface ParametersSectionProps {
  parameters: Parameter[];
  updateParameter: UseFunctionManagementResult['updateParameter'];
  animating: { paramName: string; speed: number } | null;
  onStartAnimation: (paramName: string, speed?: number) => void;
  onStopAnimation: () => void;
}

export const ParametersSection: React.FC<ParametersSectionProps> = ({
  parameters,
  updateParameter,
  animating,
  onStartAnimation,
  onStopAnimation,
}) => {
  if (parameters.length === 0) return null;

  return (
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
  );
};
