/**
 * host/ShapeLayer — 几何对象渲染(题意图 P1,2026-11-06)
 *
 * 点 / 线段 / 箭头 / 圆 / 文字,全部用 Mafs 原生元件画在同一张 SVG 里,
 * 所以全屏退出时的 SVG 缩略图自动带上它们。
 *
 * 文字只用 Mafs <Text>(SVG text),不用 <LaTeX>:
 * MathHost 的 LabelInteractionLayer 按 DOM 顺序把 .katex 节点对到曲线 label,
 * 这里再出 .katex 会把对应关系打乱。
 */

import React from 'react';
import { Point, Line, Vector, Circle, Text, Polygon } from 'mafs';
import type { ShapeSpec, LineShapeSpec } from '../types';
import { cardinalOf, tickPositions, leftNormal, formatTickValue } from '../compute/shape-geometry';

/** Mafs 的 style 仅 solid/dashed;dotted 降级为 dashed(与曲线一致) */
function strokeStyle(s?: 'solid' | 'dashed' | 'dotted'): 'solid' | 'dashed' {
  return s === 'dashed' || s === 'dotted' ? 'dashed' : 'solid';
}

const LABEL_SIZE = 15;
const STRUCK_COLOR = '#ef4444';

interface ShapeLayerProps {
  shapes: ShapeSpec[];
  selectedId?: string | null;
  viewBox: { x: [number, number]; y: [number, number] };
}

export function ShapeLayer({ shapes, selectedId, viewBox }: ShapeLayerProps): React.ReactElement {
  // 刻度短线的半长(数据单位):取可视范围的 1.2%,两个方向各算各的
  const tickHalf: [number, number] = [
    (viewBox.x[1] - viewBox.x[0]) * 0.012,
    (viewBox.y[1] - viewBox.y[0]) * 0.012,
  ];
  return (
    <>
      {shapes.map((s) => {
        const selected = s.id === selectedId;
        switch (s.kind) {
          case 'point':
            return (
              <React.Fragment key={s.id}>
                <Point
                  x={s.at[0]}
                  y={s.at[1]}
                  color={s.color}
                  opacity={s.opacity}
                  svgCircleProps={{ r: (s.size ?? 6) + (selected ? 3 : 0) }}
                />
                {s.label && (
                  <Text x={s.at[0]} y={s.at[1]} attach="ne" attachDistance={12} size={LABEL_SIZE} color={s.color}>
                    {s.label}
                  </Text>
                )}
              </React.Fragment>
            );
          case 'segment':
          case 'arrow':
            return <LineShape key={s.id} s={s} selected={selected} tickHalf={tickHalf} />;
          case 'circle': {
            const d = s.radius / Math.SQRT2;
            return (
              <React.Fragment key={s.id}>
                <Circle
                  center={s.center}
                  radius={s.radius}
                  color={s.color}
                  weight={(s.lineWidth ?? 2) + (selected ? 2 : 0)}
                  strokeStyle={strokeStyle(s.style)}
                  strokeOpacity={s.opacity ?? 1}
                  fillOpacity={0}
                />
                {s.label && (
                  <Text x={s.center[0] + d} y={s.center[1] + d} attach="ne" attachDistance={6} size={LABEL_SIZE} color={s.color}>
                    {s.label}
                  </Text>
                )}
              </React.Fragment>
            );
          }
          case 'polygon': {
            const n = s.points.length;
            const cx = s.points.reduce((a, p) => a + p[0], 0) / n;
            const cy = s.points.reduce((a, p) => a + p[1], 0) / n;
            return (
              <React.Fragment key={s.id}>
                <Polygon
                  points={s.points}
                  color={s.color}
                  weight={(s.lineWidth ?? 2) + (selected ? 2 : 0)}
                  strokeStyle={strokeStyle(s.style)}
                  strokeOpacity={s.opacity ?? 1}
                  fillOpacity={(s.fillOpacity ?? 0.15) * (s.opacity ?? 1)}
                />
                {s.label && (
                  <Text x={cx} y={cy} size={LABEL_SIZE} color={s.color}>
                    {s.label}
                  </Text>
                )}
              </React.Fragment>
            );
          }
          case 'text':
            return (
              <Text
                key={s.id}
                x={s.at[0]}
                y={s.at[1]}
                size={(s.size ?? 16) + (selected ? 2 : 0)}
                color={s.color}
                svgTextProps={{
                  opacity: s.opacity,
                  fontWeight: selected ? 700 : undefined,
                }}
              >
                {s.text}
              </Text>
            );
        }
      })}
    </>
  );
}

function LineShape({
  s,
  selected,
  tickHalf,
}: {
  s: LineShapeSpec;
  selected: boolean;
  tickHalf: [number, number];
}): React.ReactElement {
  const weight = (s.lineWidth ?? 2) + (selected ? 2 : 0);
  const style = strokeStyle(s.style);
  const opacity = s.opacity ?? 1;
  const [nx, ny] = leftNormal(s.from, s.to);
  const ticks = s.ticks ? tickPositions(s.from, s.to, s.ticks.step) ?? [] : [];
  const tickLabelAttach = cardinalOf(nx, ny);
  const mid: [number, number] = [(s.from[0] + s.to[0]) / 2, (s.from[1] + s.to[1]) / 2];

  return (
    <>
      {s.kind === 'arrow' ? (
        <Vector tail={s.from} tip={s.to} color={s.color} weight={weight} style={style} opacity={opacity} />
      ) : (
        <Line.Segment point1={s.from} point2={s.to} color={s.color} weight={weight} style={style} opacity={opacity} />
      )}

      {ticks.map((p, k) => {
        const label = s.ticks?.labels?.[k] ?? formatTickValue((s.ticks?.step ?? 0) * (k + 1));
        return (
          <React.Fragment key={`${s.id}-tick-${k}`}>
            <Line.Segment
              point1={[p[0] - nx * tickHalf[0], p[1] - ny * tickHalf[1]]}
              point2={[p[0] + nx * tickHalf[0], p[1] + ny * tickHalf[1]]}
              color={s.color}
              weight={2}
              opacity={opacity}
            />
            {label !== '' && (
              <Text x={p[0]} y={p[1]} attach={tickLabelAttach} attachDistance={10} size={13} color={s.color}>
                {label}
              </Text>
            )}
          </React.Fragment>
        );
      })}

      {s.label && (
        s.kind === 'arrow' ? (
          <Text
            x={s.to[0]}
            y={s.to[1]}
            attach={cardinalOf(s.to[0] - s.from[0], s.to[1] - s.from[1])}
            attachDistance={10}
            size={LABEL_SIZE}
            color={s.color}
          >
            {s.label}
          </Text>
        ) : (
          <Text x={mid[0]} y={mid[1]} attach={cardinalOf(-nx, -ny)} attachDistance={10} size={LABEL_SIZE} color={s.color}>
            {s.label}
          </Text>
        )
      )}

      {s.struck && (
        <Text x={mid[0]} y={mid[1]} size={22} color={STRUCK_COLOR} svgTextProps={{ fontWeight: 700 }}>
          ✗
        </Text>
      )}
    </>
  );
}
