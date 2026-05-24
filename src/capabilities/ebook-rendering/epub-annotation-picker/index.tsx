/**
 * EpubAnnotationPicker — EPUB 选区 type picker
 *
 * 2026-05-24 拍板:5 色 picker 字面对齐 5 种 ThoughtType,颜色 = 类型(单一真相源)。
 * 用户选按钮 → 回传 ThoughtType,view 调 hook.createAnnotation(type) → META.color 反查。
 *
 * 用法(view 端):
 *   {ann.selection && (
 *     <EpubAnnotationPicker
 *       selection={ann.selection}
 *       containerWidth={containerEl?.clientWidth ?? 400}
 *       onType={ann.createAnnotation}
 *       onCancel={ann.dismiss}
 *     />
 *   )}
 */

import {
  THOUGHT_TYPE_META,
  USER_THOUGHT_TYPES,
  type ThoughtType,
} from '@shared/ipc/thought-types';
import type { EpubSelection } from '../hooks/use-epub-annotation';

interface EpubAnnotationPickerProps {
  selection: EpubSelection;
  containerWidth: number;
  onType: (type: ThoughtType) => void;
  onCancel: () => void;
}

export function EpubAnnotationPicker({
  selection,
  containerWidth,
  onType,
  onCancel,
}: EpubAnnotationPickerProps) {
  // 居中固定到选区下方,但水平限制在 [20, containerWidth - 220]
  const left = Math.max(
    20,
    Math.min(selection.x - 100, containerWidth - 220),
  );
  const top = selection.y + 8;

  return (
    <div
      className="krig-ebook-annotation-picker"
      style={{
        position: 'absolute',
        left,
        top,
        bottom: 'auto',
        transform: 'none',
      }}
    >
      <div className="krig-ebook-annotation-picker__colors">
        {USER_THOUGHT_TYPES.map((t) => {
          const meta = THOUGHT_TYPE_META[t];
          return (
            <button
              key={t}
              type="button"
              className="krig-ebook-annotation-picker__color"
              style={{ backgroundColor: meta.color }}
              onClick={() => onType(t)}
              title={`${meta.icon} ${meta.label}`}
            />
          );
        })}
        <button
          type="button"
          className="krig-ebook-annotation-picker__cancel"
          onClick={onCancel}
          title="取消"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
