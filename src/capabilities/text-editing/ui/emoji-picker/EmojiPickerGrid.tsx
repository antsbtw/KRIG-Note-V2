/**
 * EmojiPickerGrid — emoji grid(L3 视觉层)
 *
 * 纯视觉组件:接 emojis + activeEmoji + onPick callback,不知道 emoji 去哪。
 * 复用方:EmojiPickerPanel(callout block-scoped 装配)。
 *
 * 与 ColorSwatchGrid 同模式,但 swatch 是 emoji 字符不是色块。
 */

interface EmojiPickerGridProps {
  /** emoji 列表(顺序即展示顺序)*/
  emojis: ReadonlyArray<string>;
  /** 当前 active emoji(等于该项时高亮)。null = 无 active */
  activeEmoji: string | null;
  /** 点击 emoji */
  onPick: (emoji: string) => void;
}

export function EmojiPickerGrid({ emojis, activeEmoji, onPick }: EmojiPickerGridProps) {
  return (
    <div className="krig-emoji-picker__grid">
      {emojis.map((e) => {
        const active = activeEmoji === e;
        return (
          <button
            key={e}
            type="button"
            className={`krig-emoji-picker__swatch${active ? ' active' : ''}`}
            title={e}
            onClick={() => onPick(e)}
          >
            {e}
          </button>
        );
      })}
    </div>
  );
}

/** Callout block 用 emoji 列表(对齐原 NodeView fallback cycle)*/
export const CALLOUT_EMOJIS: ReadonlyArray<string> = [
  '💡', '⚠️', '❌', '✅', 'ℹ️', '🔥', '📌', '💬', '🎯', '⭐',
];
