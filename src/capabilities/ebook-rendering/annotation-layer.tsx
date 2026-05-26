/**
 * AnnotationLayer — 空间标注覆盖层(单页)
 *
 * 2026-05-24 拍板架构重写:
 *   - 5 色 picker 字面 = 5 种 ThoughtType(thought/important/question/todo/analysis)
 *   - 颜色由 type 反查 THOUGHT_TYPE_META.color(单一真相源)
 *   - PageAnnotation 字段:markStyle (rect|underline 视觉) + thoughtType (语义) — 互不混淆
 *   - 创建回调 onAnnotationCreate 接 type;view 端 hook 反查颜色 + 截屏存 thumbnail
 *
 * 放在每个 page-wrapper 中,覆盖在 canvas 和 textLayer 之上。
 * 处理:
 * - 拖拽画框(rect 矩形 / underline 横线)
 * - 显示已有标注(背景色 + 半透明矩形,色从 thoughtType 反查 META)
 * - 选中后弹 5 type picker → 创建标注
 *
 * **PR-α-2 重构**:已有标注的"右键删除"路径删除 — 改走 L4 contextMenuRegistry
 * 接管(handoff §α-2)。AnnotationLayer 字面只负责渲染 + 创建,标注 div 上挂
 * `data-pdf-annotation-id={ann.id}`,ebook view 注册的 contextInfoProvider 通过
 * 此 attr 检测命中标注并构造 ContextInfo.custom.pdfAnnotationId。
 *
 * 坐标系:鼠标位置 / 绘制状态都基于 scale=1 的逻辑坐标(乘 scale 渲染),
 * 让标注在不同缩放下保持稳定。
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  THOUGHT_TYPE_META,
  USER_THOUGHT_TYPES,
  type ThoughtType,
} from '@shared/ipc/thought-types';

export interface PageAnnotation {
  id: string;
  /**
   * 视觉形态:
   * - rect           PDF 框选模式拖出的矩形(单 rect 渲染 + bg 半透明 + border)
   * - underline      框选模式下选 underline(单 rect 底线)— 当前 mode='rect' 不产生此值,留兼容
   * - highlight      PR-α-3 文字流模式 — textRects 逐 div 半透明 bg
   * - strikethrough  PR-α-3 文字流模式 — textRects 逐 div 中线
   * 创建时由 mode + picker 决定,字面不可改(改色只改 thoughtType)。
   */
  markStyle: 'rect' | 'underline' | 'highlight' | 'strikethrough';
  /** 语义类型(决定颜色) — TypeSwitcher 可改,改后 div 颜色 onListChanged 回流自动跟变 */
  thoughtType: ThoughtType;
  /** 哪一页(由父组件按 pageNum 过滤后传入,但保留字段方便上层维护)*/
  pageNum: number;
  /**
   * 坐标基于 scale=1 的页面尺寸。
   * rect 模式:用户拖出的矩形;
   * highlight/strikethrough 模式:选区 boundingRect(兜底渲染,主渲染走 textRects)。
   */
  rect: { x: number; y: number; w: number; h: number };
  /**
   * PR-α-3:highlight / strikethrough 选区跨行的 rects 数组(scale=1)。
   * 每行一个 rect(来自 range.getClientRects 减 textLayer 偏移)。
   * 缺失/空时退回单 rect 兜底渲染(老数据 / 选区只覆盖单行场景)。
   */
  textRects?: Array<{ x: number; y: number; w: number; h: number }>;
}

/** 创建标注的有效负载(pageNum 由 layer 注入,id 由 main 生成)*/
export type AnnotationDraft = Omit<PageAnnotation, 'id' | 'pageNum'>;

interface AnnotationLayerProps {
  pageNum: number;
  scale: number;
  pageWidth: number; // scale=1 时的页面宽度(预留扩展用)
  pageHeight: number; // scale=1 时的页面高度
  /** 2026-05-24 删 'underline' 取值 — 框选 = 加思考(对齐 Note ⌘⇧M 语义) */
  mode: 'off' | 'rect';
  annotations: PageAnnotation[];
  /** 跳源后短暂高亮的 annotation.id(thoughtId)— CSS 动画 .--flashing */
  flashAnnotationId?: string | null;
  onAnnotationCreate: (pageNum: number, annotation: AnnotationDraft) => void;
}

const MIN_SIZE = 5; // 最小尺寸(防误触)

export function AnnotationLayer({
  pageNum,
  scale,
  pageWidth: _pageWidth,
  pageHeight: _pageHeight,
  mode,
  annotations,
  flashAnnotationId = null,
  onAnnotationCreate,
}: AnnotationLayerProps) {
  const [drawing, setDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentPos, setCurrentPos] = useState({ x: 0, y: 0 });
  const layerRef = useRef<HTMLDivElement>(null);

  // 绘制完成后的 type picker 浮层(用户从 5 type 中选)
  const [typePicker, setTypePicker] = useState<{
    rect: { x: number; y: number; w: number; h: number };
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
    if (mode !== 'rect') return;

    const x = Math.min(startPos.x, currentPos.x);
    const y = Math.min(startPos.y, currentPos.y);
    const w = Math.abs(currentPos.x - startPos.x);
    const h = Math.abs(currentPos.y - startPos.y);

    // 最小尺寸检查(防误触)
    if (w < MIN_SIZE || h < MIN_SIZE) return;

    setTypePicker({ rect: { x, y, w, h } });
  }, [drawing, startPos, currentPos, mode]);

  // 点击空白关闭 picker
  useEffect(() => {
    if (!typePicker) return;
    const close = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      if (!target.closest('.krig-ebook-annotation-color-picker')) {
        setTypePicker(null);
      }
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [typePicker]);

  const handleTypeSelect = useCallback(
    (thoughtType: ThoughtType) => {
      if (!typePicker) return;
      onAnnotationCreate(pageNum, {
        markStyle: 'rect',
        thoughtType,
        rect: typePicker.rect,
      });
      setTypePicker(null);
    },
    [typePicker, pageNum, onAnnotationCreate],
  );

  // 当前绘制中的预览矩形(基于 scale=1)
  const previewRect = drawing && mode === 'rect'
    ? {
        x: Math.min(startPos.x, currentPos.x),
        y: Math.min(startPos.y, currentPos.y),
        w: Math.abs(currentPos.x - startPos.x),
        h: Math.abs(currentPos.y - startPos.y),
      }
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
      {/* 已有标注 — 颜色字面从 thoughtType 反查 META.color
       *
       * 渲染分支:
       * - rect:                          单 div(border + bg 半透明)
       * - underline:                     单 div(横线 — CSS .--underline 控)
       * - highlight / strikethrough:     textRects 逐 div(选区跨行多 rect)。
       *                                  textRects 缺失/空 → 退回单 rect 兜底渲染。
       *   每个 sub-div 都挂 data-pdf-annotation-id,右键命中走 α-2 contextInfoProvider。
       */}
      {annotations.flatMap((ann) => {
        const color = THOUGHT_TYPE_META[ann.thoughtType].color;
        const isFlashing = ann.id === flashAnnotationId;
        const baseCls = [
          'krig-ebook-annotation',
          `krig-ebook-annotation--${ann.markStyle}`,
          isFlashing ? 'krig-ebook-annotation--flashing' : '',
        ].filter(Boolean).join(' ');

        // 文字流模式 + textRects 有数据 → 逐 rect 渲染(每行一 div)
        const isTextFlow =
          ann.markStyle === 'highlight' || ann.markStyle === 'strikethrough';
        const useTextRects = isTextFlow && ann.textRects && ann.textRects.length > 0;

        if (useTextRects) {
          // highlight bg = 半透明色;strikethrough 走 CSS 渲染中线(背景透明)
          const bg = ann.markStyle === 'highlight' ? `${color}55` : 'transparent';
          return ann.textRects!.map((r, idx) => (
            <div
              key={`${ann.id}.${idx}`}
              data-pdf-annotation-id={ann.id}
              className={baseCls}
              style={{
                left: r.x * scale,
                top: r.y * scale,
                width: r.w * scale,
                height: r.h * scale,
                backgroundColor: bg,
                borderColor: 'transparent',
                ['--krig-ann-color' as string]: color,
              }}
            />
          ));
        }

        // rect / underline / 文字流兜底:单 rect
        return [
          <div
            key={ann.id}
            data-pdf-annotation-id={ann.id}
            className={baseCls}
            style={{
              left: ann.rect.x * scale,
              top: ann.rect.y * scale,
              width: ann.rect.w * scale,
              height: ann.rect.h * scale,
              backgroundColor:
                ann.markStyle === 'rect'
                  ? `${color}33` // 20% opacity hex(rect 半透明填充)
                  : ann.markStyle === 'highlight'
                  ? `${color}55` // 文字流兜底走半透明 bg
                  : color, // underline / strikethrough 走纯色,CSS 控线条位置
              borderColor: ann.markStyle === 'rect' ? color : 'transparent',
              ['--krig-ann-color' as string]: color,
            }}
          />,
        ];
      })}

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

      {/* 5 type picker — 5 色按钮字面对应 5 种思考分类(单一真相源) */}
      {typePicker && (
        <div
          className="krig-ebook-annotation-color-picker"
          style={{
            left: typePicker.rect.x * scale,
            top: (typePicker.rect.y + typePicker.rect.h) * scale + 8,
          }}
        >
          {USER_THOUGHT_TYPES.map((t) => {
            const meta = THOUGHT_TYPE_META[t];
            return (
              <button
                key={t}
                type="button"
                className="krig-ebook-annotation-color-picker__btn"
                style={{ backgroundColor: meta.color }}
                title={`${meta.icon} ${meta.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleTypeSelect(t);
                }}
              />
            );
          })}
          <button
            type="button"
            className="krig-ebook-annotation-color-picker__cancel"
            onClick={(e) => {
              e.stopPropagation();
              setTypePicker(null);
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
