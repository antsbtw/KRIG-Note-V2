/**
 * host/ShapeLayer — 几何对象渲染(题意图 P1,2026-11-06)
 *
 * 点 / 线段 / 箭头 / 圆 / 文字 / 面,全部用 Mafs 原生元件画在同一张 SVG 里,
 * 所以全屏退出时的 SVG 缩略图自动带上它们。
 *
 * 文字只用 Mafs <Text>(SVG text),不用 <LaTeX>:
 * MathHost 的 LabelInteractionLayer 按 DOM 顺序把 .katex 节点对到曲线 label,
 * 这里再出 .katex 会把对应关系打乱。
 *
 * 标签位置走 compute/shape-geometry 的 labelLayout —— 与命中测试(shapeLabelBox)同一套。
 * 不用 Mafs Text 的 attachDistance:它的上下方向是反的(见 shape-geometry 注释)。
 */

import React from 'react';
import { Point, Line, Vector, Circle, Text, Polygon } from 'mafs';
import type { ShapeSpec, LineShapeSpec } from '../types';
import {
  cardinalOf, tickPositions, leftNormal, formatTickValue,
  labelLayout, labelShiftPx, type Cardinal, type Vec2,
} from '../compute/shape-geometry';

/** Mafs 的 style 仅 solid/dashed;dotted 降级为 dashed(与曲线一致) */
function strokeStyle(s?: 'solid' | 'dashed' | 'dotted'): 'solid' | 'dashed' {
  return s === 'dashed' || s === 'dotted' ? 'dashed' : 'solid';
}

const STRUCK_COLOR = '#ef4444';

/** 在锚点(数据坐标)旁按方位放一段字。Mafs 只负责对齐(attach),偏移用 transform 自己做。 */
function PlacedText({
  at, dir, distance, offset, size, color, children, svgTextProps,
}: {
  at: Vec2;
  dir: Cardinal | null;
  distance: number;
  offset?: Vec2;
  size: number;
  color: string;
  children: React.ReactNode;
  svgTextProps?: React.SVGAttributes<SVGTextElement>;
}) {
  const [dx, dy] = labelShiftPx({ at, dir, distance, size, text: '' }, offset);
  return (
    <Text
      x={at[0]}
      y={at[1]}
      attach={dir ?? undefined}
      attachDistance={0}
      size={size}
      color={color}
      svgTextProps={{ ...svgTextProps, transform: `translate(${dx} ${dy})` }}
    >
      {children}
    </Text>
  );
}

/** 对象的标签(点 / 线 / 箭头 / 圆 / 面);位置 = 默认布局 + 用户拖动偏移 */
function ShapeLabel({ s }: { s: ShapeSpec }) {
  const layout = labelLayout(s);
  if (!layout) return null;
  return (
    <PlacedText
      at={layout.at}
      dir={layout.dir}
      distance={layout.distance}
      offset={s.labelOffset}
      size={layout.size}
      color={s.color}
      svgTextProps={{ opacity: s.opacity }}
    >
      {layout.text}
    </PlacedText>
  );
}

interface ShapeLayerProps {
  shapes: ShapeSpec[];
  selectedIds?: string[];
  viewBox: { x: [number, number]; y: [number, number] };
}

export function ShapeLayer({ shapes, selectedIds, viewBox }: ShapeLayerProps): React.ReactElement {
  const selectedSet = new Set(selectedIds ?? []);
  // 刻度短线的半长(数据单位):取可视范围的 1.2%,两个方向各算各的
  const tickHalf: [number, number] = [
    (viewBox.x[1] - viewBox.x[0]) * 0.012,
    (viewBox.y[1] - viewBox.y[0]) * 0.012,
  ];
  return (
    <>
      {shapes.map((s) => {
        const selected = selectedSet.has(s.id);
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
                <ShapeLabel s={s} />
              </React.Fragment>
            );
          case 'segment':
          case 'arrow':
            return <LineShape key={s.id} s={s} selected={selected} tickHalf={tickHalf} />;
          case 'circle':
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
                <ShapeLabel s={s} />
              </React.Fragment>
            );
          case 'polygon':
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
                <ShapeLabel s={s} />
              </React.Fragment>
            );
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
  const tickLabelDir = cardinalOf(nx, ny);
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
              <PlacedText at={p} dir={tickLabelDir} distance={10} size={13} color={s.color}>
                {label}
              </PlacedText>
            )}
          </React.Fragment>
        );
      })}

      <ShapeLabel s={s} />

      {s.struck && (
        <Text x={mid[0]} y={mid[1]} size={22} color={STRUCK_COLOR} svgTextProps={{ fontWeight: 700 }}>
          ✗
        </Text>
      )}
    </>
  );
}
