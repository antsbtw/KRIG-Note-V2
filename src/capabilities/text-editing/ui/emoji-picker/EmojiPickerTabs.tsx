/**
 * EmojiPickerTabs — Notion 风格 4 tab 栏(表情符号/图标/上传/移除)
 *
 * v1 只激活"Emojis" tab,后 3 个 stub disabled(prompt §5 字面留 v2/v3)。
 * disabled tab 视觉淡化 + cursor not-allowed + 不可 click 不触发任何行为。
 */

export type EmojiPickerTabId = 'emojis' | 'icons' | 'upload' | 'remove';

interface TabDef {
  id: EmojiPickerTabId;
  label: string;
  disabled: boolean;
}

const TABS: ReadonlyArray<TabDef> = [
  { id: 'emojis', label: 'Emojis', disabled: false },
  { id: 'icons', label: 'Icons', disabled: true },
  { id: 'upload', label: 'Upload', disabled: true },
  { id: 'remove', label: 'Remove', disabled: true },
];

interface Props {
  activeTab: EmojiPickerTabId;
  onTabChange: (tab: EmojiPickerTabId) => void;
}

export function EmojiPickerTabs({ activeTab, onTabChange }: Props) {
  return (
    <div className="krig-emoji-picker__tabs">
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        const classes = [
          'krig-emoji-picker__tab',
          isActive && 'krig-emoji-picker__tab--active',
          tab.disabled && 'krig-emoji-picker__tab--disabled',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <button
            key={tab.id}
            type="button"
            className={classes}
            disabled={tab.disabled}
            onClick={tab.disabled ? undefined : () => onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
