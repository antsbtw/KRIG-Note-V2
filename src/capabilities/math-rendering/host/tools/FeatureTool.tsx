/**
 * host/tools/FeatureTool — 特征点渲染(capability 内部子组件)
 *
 * 1:1 迁自 V1 `fullscreen/tools/FeatureTool.tsx`。纯展示,无交互。
 * 数据来源:driver 调 capability `detectFeaturePoints` 计算后塞入 PM persist。
 */

import React from 'react';
import { Point, Text } from 'mafs';
import type { FeaturePointSpec } from '../../types';

type FeaturePointType = 'maximum' | 'minimum' | 'zero' | 'inflection';

/** 特征点类型 → 颜色/标签 */
const FEATURE_STYLE: Record<FeaturePointType, { color: string; label: string }> = {
  maximum:    { color: '#ef4444', label: '极大' },
  minimum:    { color: '#3b82f6', label: '极小' },
  zero:       { color: '#22c55e', label: '零点' },
  inflection: { color: '#a855f7', label: '拐点' },
};

interface FeatureToolProps {
  features: FeaturePointSpec[];
  /** 类型过滤(driver Panel 内 RightPanel 选择) */
  visibleTypes: Set<FeaturePointType>;
}

export const FeatureTool: React.FC<FeatureToolProps> = ({
  features,
  visibleTypes,
}) => {
  return (
    <>
      {features.filter((p) => visibleTypes.has(p.type)).map((p) => {
        const style = FEATURE_STYLE[p.type];
        return (
          <React.Fragment key={p.id}>
            <Point
              x={p.x}
              y={p.y}
              color={style.color}
              svgCircleProps={{ r: 5 }}
            />
            <Text
              x={p.x}
              y={p.y}
              attach="n"
              attachDistance={10}
              size={11}
              color={style.color}
            >
              {`${style.label} (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`}
            </Text>
          </React.Fragment>
        );
      })}
    </>
  );
};
