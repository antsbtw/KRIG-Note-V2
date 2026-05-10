/**
 * AnnotationLayer — 空间标注覆盖层(单页,L5-C5)
 *
 * V1 → V2 直迁:src/plugins/ebook/components/AnnotationLayer.tsx(203 行)。
 * 改动:CSS 类前缀对齐 V2(.annotation-* → .krig-ebook-annotation-*)。
 *
 * 放在每个 page-wrapper 中,覆盖在 canvas 和 textLayer 之上。
 * 处理:
 * - 拖拽画框(rect 矩形 / underline 横线)
 * - 显示已有标注(背景色 + 半透明矩形)
 * - 点击松手后弹出 5 色 picker → 创建标注
 * - 已有标注右键 → 删除
 *
 * 坐标系:鼠标位置 / 绘制状态都基于 scale=1 的逻辑坐标(乘 scale 渲染),
 * 让标注在不同缩放下保持稳定。
 */

import { useState, useRef, useCallback, useEffect } from 'react';

export interface PageAnnotation {
  id: string;
  type: 'rect' | 'underline';
  color: string;
  /** 哪一页(由父组件按 pageNum 过滤后传入,但保留字段方便上层维护)*/
  pageNum: number;
  /** 坐标基于 scale=1 的页面尺寸 */
  rect: { x: number; y: number; w: number; h: number };
}

/** 创建标注的有效负载(pageNum 由 layer 注入,id 由 main 生成)*/
export type AnnotationDraft = Omit<PageAnnotation, 'id' | 'pageNum'>;

interface AnnotationLayerProps {
  pageNum: number;
  scale: number;
  pageWidth: number; // scale=1 时的页面宽度(预留扩展用)
  pageHeight: number; // scale=1 时的页面高度
  mode: 'off' | 'rect' | 'underline';
  annotations: PageAnnotation[];
  onAnnotationCreate: (pageNum: number, annotation: AnnotationDraft) => void;
  onAnnotationDelete: (id: string) => void;
}

const COLORS = ['#ffd43b', '#69db7c', '#74c0fc', '#b197fc', '#ff6b6b'];
const UNDERLINE_HEIGHT = 3; // 横线高度(scale=1 下的像素)
const MIN_SIZE = 5; // 最小尺寸(防误触)

export function AnnotationLayer({
  pageNum,
  scale,
  pageWidth: _pageWidth,
  pageHeight: _pageHeight,
  mode,
  annotations,
  onAnnotationCreate,
  onAnnotationDelete,
}: AnnotationLayerProps) {
  const [drawing, setDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentPos, setCurrentPos] = useState({ x: 0, y: 0 });
  const layerRef = useRef<HTMLDivElement>(null);

  // 绘制完成后的 picker 浮层
  const [colorPicker, setColorPicker] = useState<{
    rect: { x: number; y: number; w: number; h: number };
    type: 'rect' | 'underline';
  } | null>(null);

  const getScaledPos = useCallback(
    (e: React.MouseEvent) => {
      const el = layerRef.current;
      if (!el) return { x: 0, y: 0 };
      const bounds = el.getBoundingClientRect();
      return {
        x: (e.clientX - bounds.left) / scale,
        y: (e.clientY - bounds.top) / scale,
      };
    },
    [scale],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (mode === 'off') return;
      e.preventDefault();
      const pos = getScaledPos(e);
      setStartPos(pos);
      setCurrentPos(pos);
      setDrawing(true);
    },
    [mode, getScaledPos],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!drawing) return;
      setCurrentPos(getScaledPos(e));
    },
    [drawing, getScaledPos],
  );

  const handleMouseUp = useCallback(() => {
    if (!drawing) return;
    setDrawing(false);

    const x = Math.min(startPos.x, currentPos.x);
    const y = Math.min(startPos.y, currentPos.y);
    const w = Math.abs(currentPos.x - startPos.x);
    const h =
      mode === 'underline' ? UNDERLINE_HEIGHT : Math.abs(currentPos.y - startPos.y);

    // 最小尺寸检查(防误触)
    if (w < MIN_SIZE || (mode === 'rect' && h < MIN_SIZE)) return;

    const rect =
      mode === 'underline'
        ? { x, y: startPos.y, w, h: UNDERLINE_HEIGHT }
        : { x, y, w, h };

    setColorPicker({ rect, type: mode as 'rect' | 'underline' });
  }, [drawing, startPos, currentPos, mode]);

  // 点击空白关闭 picker
  useEffect(() => {
    if (!colorPicker) return;
    const close = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      if (!target.closest('.krig-ebook-annotation-color-picker')) {
        setColorPicker(null);
      }
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [colorPicker]);

  const handleColorSelect = useCallback(
    (color: string) => {
      if (!colorPicker) return;
      onAnnotationCreate(pageNum, {
        type: colorPicker.type,
        color,
        rect: colorPicker.rect,
      });
      setColorPicker(null);
    },
    [colorPicker, pageNum, onAnnotationCreate],
  );

  // 当前绘制中的预览矩形(基于 scale=1)
  const previewRect = drawing
    ? (() => {
        const x = Math.min(startPos.x, currentPos.x);
        const y = Math.min(startPos.y, currentPos.y);
        const w = Math.abs(currentPos.x - startPos.x);
        const h =
          mode === 'underline'
            ? UNDERLINE_HEIGHT
            : Math.abs(currentPos.y - startPos.y);
        return mode === 'underline'
          ? { x, y: startPos.y, w, h: UNDERLINE_HEIGHT }
          : { x, y, w, h };
      })()
    : null;

  return (
    <div
      ref={layerRef}
      className="krig-ebook-annotation-layer"
      style={{
        cursor: mode !== 'off' ? 'crosshair' : 'default',
        pointerEvents: mode !== 'off' ? 'auto' : 'none',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => {
        if (drawing) setDrawing(false);
      }}
    >
      {/* 已有标注 */}
      {annotations.map((ann) => (
        <div
          key={ann.id}
          className={`krig-ebook-annotation krig-ebook-annotation--${ann.type}`}
          style={{
            left: ann.rect.x * scale,
            top: ann.rect.y * scale,
            width: ann.rect.w * scale,
            height: ann.rect.h * scale,
            backgroundColor:
              ann.type === 'rect'
                ? `${ann.color}33` // 20% opacity hex
                : ann.color,
            borderColor: ann.type === 'rect' ? ann.color : 'transparent',
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onAnnotationDelete(ann.id);
          }}
        />
      ))}

      {/* 绘制中的预览 */}
      {previewRect && (
        <div
          className={`krig-ebook-annotation krig-ebook-annotation--preview krig-ebook-annotation--${mode}`}
          style={{
            left: previewRect.x * scale,
            top: previewRect.y * scale,
            width: previewRect.w * scale,
            height: previewRect.h * scale,
          }}
        />
      )}

      {/* 颜色选择 picker */}
      {colorPicker && (
        <div
          className="krig-ebook-annotation-color-picker"
          style={{
            left: colorPicker.rect.x * scale,
            top: (colorPicker.rect.y + colorPicker.rect.h) * scale + 8,
          }}
        >
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className="krig-ebook-annotation-color-picker__btn"
              style={{ backgroundColor: c }}
              onClick={(e) => {
                e.stopPropagation();
                handleColorSelect(c);
              }}
            />
          ))}
          <button
            type="button"
            className="krig-ebook-annotation-color-picker__cancel"
            onClick={(e) => {
              e.stopPropagation();
              setColorPicker(null);
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
