/**
 * ParameterSlider — 参数滑块
 *
 * 1:1 迁自 V1 `src/plugins/note/blocks/math-visual/components/ParameterSlider.tsx`。
 * 零依赖,纯 UI。
 */

import React from 'react';
import type { Parameter } from '../types';

export function ParameterSlider({
  param,
  onChange,
}: {
  param: Parameter;
  onChange: (value: number) => void;
}) {
  return (
    <div className="mv-param-row">
      <span className="mv-param-name">{param.name}</span>
      <input
        type="range"
        className="mv-param-slider"
        min={param.min}
        max={param.max}
        step={param.step}
        value={param.value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="mv-param-value">{param.value.toFixed(2)}</span>
    </div>
  );
}
