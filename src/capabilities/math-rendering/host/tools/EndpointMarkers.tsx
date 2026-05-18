/**
 * host/tools/EndpointMarkers — 分段函数端点标记 ○ / ●(capability 内部子组件)
 *
 * 1:1 迁自 V1 `fullscreen/tools/EndpointMarkers.tsx`。**用 useTransformContext**
 * 必须挂在 <Mafs> 内才能拿 viewTransform 转换数学→SVG 像素。
 *
 * 注意:本组件与 Phase 1A 的 MathHost.renderEndpoint(走 Mafs Point)是两条独立路径:
 * - Phase 1A renderEndpoint:走 props.endpoints,渲染 <Point>(简单场景)
 * - 本 Phase 2 EndpointMarkers:从 segments 自动计算端点 + 原生 SVG circle
 *   (V1 全屏专用,精度更高 + 白心 ○ 显示更明确)
 *
 * driver 全屏 Panel 用 overlays.showEndpoints=true 来启用本组件,自动取所有
 * fnOfX curves 的 segments 端点。
 */

import React from 'react';
import { useTransformContext } from 'mafs';

export interface EndpointData {
  x: number;
  y: number;
  closed: boolean;
}

interface EndpointMarkersProps {
  endpoints: EndpointData[];
  color: string;
  radius?: number;
}

export const EndpointMarkers: React.FC<EndpointMarkersProps> = ({
  endpoints,
  color,
  radius = 5,
}) => {
  const { viewTransform: m } = useTransformContext();
  // Matrix = [a, b, tx, c, d, ty]:px = x*a + y*b + tx, py = x*c + y*d + ty
  const toSvg = (mx: number, my: number): [number, number] => [
    mx * m[0] + my * m[1] + m[2],
    mx * m[3] + my * m[4] + m[5],
  ];

  return (
    <g>
      {endpoints.map((ep, i) => {
        const [px, py] = toSvg(ep.x, ep.y);
        if (ep.closed) {
          return <circle key={`ep-${i}`} cx={px} cy={py} r={radius} fill={color} />;
        }
        return (
          <g key={`ep-${i}`}>
            <circle cx={px} cy={py} r={radius} fill="#fff" />
            <circle cx={px} cy={py} r={radius} fill="none" stroke={color} strokeWidth={1.5} />
          </g>
        );
      })}
    </g>
  );
};
