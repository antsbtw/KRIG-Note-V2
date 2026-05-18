/**
 * host/tools/AnnotationTool — 关键点标注(capability 内部子组件)
 *
 * 1:1 迁自 V1 `fullscreen/tools/AnnotationTool.tsx`。三态:
 * - 单选(selectedIdx === i)→ MovablePoint(可拖动)
 * - 多选(selectedIdxs.has(i)) → white fill + color 描边(框选高亮)
 * - 默认 → 静态 Point(可点选)
 *
 * Label 来源:spec.label > ANNOTATION_LABELS[i % 26](capability 内部维护标签序列)。
 */

import React from 'react';
import { Point, MovablePoint, Text } from 'mafs';
import type { AnnotationSpec } from '../../types';

/** 标注点自动命名序列(同 driver types.ANNOTATION_LABELS) */
const ANNOTATION_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

interface AnnotationToolProps {
  annotations: AnnotationSpec[];
  evalFns: Map<string, (x: number) => number>;
  pointSize: number;
  selectedIdx: number | null;
  selectedIdxs: Set<number>;
  onSelect?: (idx: number) => void;
  onMove?: (idx: number, newX: number) => void;
}

export const AnnotationTool: React.FC<AnnotationToolProps> = ({
  annotations,
  evalFns,
  pointSize,
  selectedIdx,
  selectedIdxs,
  onSelect,
  onMove,
}) => {
  return (
    <>
      {annotations.map((ann, i) => {
        const fn = evalFns.get(ann.curveId);
        if (!fn) return null;
        const y = fn(ann.x);
        if (!isFinite(y)) return null;

        const isSingleSelected = selectedIdx === i;
        const isMultiSelected = selectedIdxs.has(i);
        const color = ann.color || '#FF6B35';
        const showCoord = ann.showCoord !== false;
        const displayLabel = ann.label || ANNOTATION_LABELS[i % ANNOTATION_LABELS.length];

        return (
          <React.Fragment key={`ann-${ann.id}`}>
            {isSingleSelected && onMove ? (
              <MovablePoint
                point={[ann.x, y]}
                onMove={([newX]) => onMove(i, newX)}
                color={color}
              />
            ) : (
              <Point
                x={ann.x}
                y={y}
                color={isMultiSelected ? '#fff' : color}
                svgCircleProps={{
                  r: isMultiSelected ? pointSize + 2 : pointSize,
                  stroke: isMultiSelected ? color : undefined,
                  strokeWidth: isMultiSelected ? 2 : undefined,
                  style: { cursor: 'pointer' },
                  onClick: onSelect ? ((e: React.MouseEvent) => {
                    e.stopPropagation();
                    onSelect(i);
                  }) : undefined,
                }}
              />
            )}
            <Text
              x={ann.x}
              y={y}
              attach="n"
              attachDistance={pointSize + 6}
              size={11}
              color={isMultiSelected ? '#fff' : color}
            >
              {showCoord
                ? `${displayLabel} (${ann.x.toFixed(2)}, ${y.toFixed(2)})`
                : displayLabel}
            </Text>
          </React.Fragment>
        );
      })}
    </>
  );
};
