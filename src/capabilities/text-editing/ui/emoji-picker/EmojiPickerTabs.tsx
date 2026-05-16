/**
 * EmojiPickerTabs — Notion 风格 4 tab 栏(表情符号/图标/上传/移除)
 *
 * D023 Step 5.5.3:Icons tab 字面解 disabled(v2 实施)。
 * D024 Step 5.6:Upload tab 字面解 disabled(v3 实施)。
 * Remove 仍 disabled(用户字面决议"无意义",不做)。
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
  { id: 'icons', label: 'Icons', disabled: false },
  { id: 'upload', label: 'Upload', disabled: false },
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
