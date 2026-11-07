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

import React, { useEffect, useState } from 'react';
import { Point, Line, Vector, Circle, Text, Polygon, useTransformContext, vec } from 'mafs';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { NoteCardApi, NoteNode } from '@capabilities/note-card/types';
import type { ShapeSpec, LineShapeSpec } from '../types';
import {
  cardinalOf, tickPositions, leftNormal, formatTickValue,
  labelLayout, labelShiftPx, labelOriginPx, setCardSize, DEFAULT_NOTE_WIDTH,
  type Cardinal, type Vec2, type LabelLayout,
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

/**
 * 说明卡片:note 块 → note-card 公共组件 renderSvg(文字转路径的独立 SVG)→ 嵌进 Mafs 这张 SVG。
 * 同一张图里,所以退出全屏导出的缩略图自带卡片。
 * 画好后登记实际尺寸(setCardSize),命中测试按它算。
 */
function NoteCard({ s, layout, onMeasured }: { s: ShapeSpec; layout: LabelLayout; onMeasured?: (id: string) => void }) {
  const { viewTransform, userTransform } = useTransformContext();
  const [card, setCard] = useState<{ svg: string; w: number; h: number } | null>(null);
  const width = s.noteWidth ?? DEFAULT_NOTE_WIDTH;
  const note = s.note;

  useEffect(() => {
    if (!note || note.length === 0) { setCard(null); return; }
    let cancelled = false;
    requireCapabilityApi<NoteCardApi>('note-card')
      .renderSvg(note as NoteNode[], { width, color: s.color })
      .then(({ svg, width: w, height: h }) => {
        if (cancelled) return;
        setCardSize(s.id, w, h);
        setCard({ svg, w, h });
        onMeasured?.(s.id);
      })
      .catch((e: unknown) => {
        // 不吞:画不出来就在控制台说清楚是哪张卡片
        console.error(`[math-rendering] 说明卡片 ${s.id} 渲染失败`, e);
      });
    return () => { cancelled = true; };
  }, [note, width, s.color, s.id, onMeasured]);

  if (!card) return null;
  const anchor = vec.transform(layout.at, vec.matrixMult(viewTransform, userTransform)) as Vec2;
  const [x0, y0] = labelOriginPx(anchor, layout, card.w, card.h, s.labelOffset);
  return (
    // 选中框不画在这里:由 note-card 的 CardFrame(HTML 浮层)显示,也就不会被存进缩略图
    <g transform={`translate(${x0} ${y0})`} opacity={s.opacity}>
      <g dangerouslySetInnerHTML={{ __html: card.svg }} />
    </g>
  );
}

/** 对象的标签(点 / 线 / 箭头 / 圆 / 面);位置 = 默认布局 + 用户拖动偏移;有 note 时画成卡片 */
function ShapeLabel({ s, onMeasured }: { s: ShapeSpec; onMeasured?: (id: string) => void }) {
  const layout = labelLayout(s);
  if (!layout) return null;
  if (s.note && s.note.length > 0) return <NoteCard s={s} layout={layout} onMeasured={onMeasured} />;
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
  onCardMeasured?: (id: string) => void;
  /**
   * 当前不显示的对象(分帧:不在当前帧)。照样渲染、只是 display:none ——
   * 说明卡片是异步画的,拿掉再放回要重画;逐帧导出缩略图时等不及,会漏卡片。
   */
  hiddenIds?: string[];
}

export function ShapeLayer({ shapes, selectedIds, viewBox, onCardMeasured, hiddenIds }: ShapeLayerProps): React.ReactElement {
  const selectedSet = new Set(selectedIds ?? []);
  const hiddenSet = new Set(hiddenIds ?? []);
  // 刻度短线的半长(数据单位):取可视范围的 1.2%,两个方向各算各的
  const tickHalf: [number, number] = [
    (viewBox.x[1] - viewBox.x[0]) * 0.012,
    (viewBox.y[1] - viewBox.y[0]) * 0.012,
  ];
  return (
    <>
      {shapes.map((s) => {
        const el = (() => {
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
                <ShapeLabel s={s} onMeasured={onCardMeasured} />
              </React.Fragment>
            );
          case 'segment':
          case 'arrow':
            return <LineShape key={s.id} s={s} selected={selected} tickHalf={tickHalf} onCardMeasured={onCardMeasured} />;
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
                <ShapeLabel s={s} onMeasured={onCardMeasured} />
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
                <ShapeLabel s={s} onMeasured={onCardMeasured} />
              </React.Fragment>
            );
          case 'text': {
            const layout = labelLayout(s);
            if (layout) return <NoteCard key={s.id} s={s} layout={layout} onMeasured={onCardMeasured} />;
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
        }
        })();
        return hiddenSet.has(s.id) ? <g key={s.id} display="none">{el}</g> : el;
      })}
    </>
  );
}

function LineShape({
  s,
  selected,
  tickHalf,
  onCardMeasured,
}: {
  s: LineShapeSpec;
  selected: boolean;
  tickHalf: [number, number];
  onCardMeasured?: (id: string) => void;
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

      <ShapeLabel s={s} onMeasured={onCardMeasured} />

      {s.struck && (
        <Text x={mid[0]} y={mid[1]} size={22} color={STRUCK_COLOR} svgTextProps={{ fontWeight: 700 }}>
          ✗
        </Text>
      )}
    </>
  );
}
