/**
 * PdfTextAnnotationPicker — PR-α-3b 文字流选区 picker
 *
 * PDF textLayer 选区命中后弹出,选 color(thoughtType)+ markStyle 后创建标注。
 *
 * UX 单行紧凑(对齐用户拍板 P2=B):
 *   ┌─────────────────────────────────┐
 *   │ ● ● ● ● ●  │  [H] [S]  ✕        │
 *   └─────────────────────────────────┘
 * - 5 色按钮:USER_THOUGHT_TYPES 反查 META.color
 * - markStyle:Highlight(默认)/ Strikethrough,点 H/S 切换 active 态
 * - ✕:关闭(view 端走 onCancel)
 * - 点色 → 用当前 markStyle + 该 type 创建 → 关
 *
 * 定位:选区底部居中(picker 顶部对齐 anchor.y + 8),用 position: fixed
 * (anchor 是 viewport-relative 坐标)。
 */

import { useState } from 'react';
import {
  THOUGHT_TYPE_META,
  USER_THOUGHT_TYPES,
  type ThoughtType,
} from '@shared/ipc/thought-types';

type PdfTextMarkStyle = 'highlight' | 'strikethrough';

interface PdfTextAnnotationPickerProps {
  /** 选区屏幕锚点(viewport-relative px) */
  anchor: { x: number; y: number };
  /** 用户选择(thoughtType + markStyle)→ view 端 createFromTextSelection */
  onConfirm: (type: ThoughtType, markStyle: PdfTextMarkStyle) => void;
  /** ✕ / 外部点击 / ESC 关闭 */
  onCancel: () => void;
}

const PICKER_WIDTH_EST = 240;

export function PdfTextAnnotationPicker({
  anchor,
  onConfirm,
  onCancel,
}: PdfTextAnnotationPickerProps) {
  const [markStyle, setMarkStyle] = useState<PdfTextMarkStyle>('highlight');

  const vpWidth = window.innerWidth;
  const left = Math.max(
    8,
    Math.min(anchor.x - PICKER_WIDTH_EST / 2, vpWidth - PICKER_WIDTH_EST - 8),
  );
  const top = anchor.y + 8;

  return (
    <div
      className="krig-pdf-text-picker"
      style={{ position: 'fixed', left, top, zIndex: 200 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="krig-pdf-text-picker__colors">
        {USER_THOUGHT_TYPES.map((t) => {
          const meta = THOUGHT_TYPE_META[t];
          return (
            <button
              key={t}
              type="button"
              className="krig-pdf-text-picker__color"
              style={{ backgroundColor: meta.color }}
              title={`${meta.icon} ${meta.label}`}
              onClick={() => onConfirm(t, markStyle)}
            />
          );
        })}
      </div>

      <div className="krig-pdf-text-picker__divider" />

      <div className="krig-pdf-text-picker__styles">
        <button
          type="button"
          className={`krig-pdf-text-picker__style${markStyle === 'highlight' ? ' krig-pdf-text-picker__style--active' : ''}`}
          title="高亮"
          onClick={() => setMarkStyle('highlight')}
        >
          H
        </button>
        <button
          type="button"
          className={`krig-pdf-text-picker__style${markStyle === 'strikethrough' ? ' krig-pdf-text-picker__style--active' : ''}`}
          title="删除线"
          onClick={() => setMarkStyle('strikethrough')}
        >
          S
        </button>
      </div>

      <button
        type="button"
        className="krig-pdf-text-picker__cancel"
        title="取消"
        onClick={onCancel}
      >
        ✕
      </button>
    </div>
  );
}
