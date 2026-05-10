/**
 * EpubAnnotationPicker — EPUB 选区颜色 picker(L5-C4)
 *
 * V1 → V2 改写:V1 EBookView.tsx 的 .epub-annotation-picker UI(~25 行内联 JSX)
 * 提取到 capability 内,view 端只装配 + 传 props。
 *
 * 5 色对齐 V1:
 *   黄 #ffd43b / 绿 #69db7c / 蓝 #74c0fc / 紫 #b197fc / 红 #ff6b6b
 *
 * 用法(view 端):
 *   {ann.selection && (
 *     <EpubAnnotationPicker
 *       selection={ann.selection}
 *       containerWidth={containerEl?.clientWidth ?? 400}
 *       onColor={ann.createAnnotation}
 *       onCancel={ann.dismiss}
 *     />
 *   )}
 */

import type { EpubSelection } from '../hooks/use-epub-annotation';

const EPUB_COLORS = ['#ffd43b', '#69db7c', '#74c0fc', '#b197fc', '#ff6b6b'];

interface EpubAnnotationPickerProps {
  selection: EpubSelection;
  containerWidth: number;
  onColor: (color: string) => void;
  onCancel: () => void;
}

export function EpubAnnotationPicker({
  selection,
  containerWidth,
  onColor,
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
        {EPUB_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className="krig-ebook-annotation-picker__color"
            style={{ backgroundColor: c }}
            onClick={() => onColor(c)}
            title={`高亮 ${c}`}
          />
        ))}
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
