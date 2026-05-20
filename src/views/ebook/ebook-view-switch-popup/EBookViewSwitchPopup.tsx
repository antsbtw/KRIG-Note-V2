/**
 * EBookViewSwitchPopup — Toolbar ⊞ 按钮的视图切换菜单
 *
 * 5 项跟 NoteView toolbar-content.tsx 的 view-switch dropdown 对齐:
 *   📝 Note / 📕 eBook / 🌐 Web / 🤖 AI / 💭 Thought
 *
 * 选中后调 `ebook-view.open-right-slot` 命令(bus.slot.openRight),
 * 在右槽打开对应 view(若同 view 已在右槽,openRight 幂等覆盖)。
 */

import type { PopupCloseProps } from '@slot/interaction-registries/popup-registry/popup-types';
import { commandRegistry } from '@slot/command-registry/command-registry';
import './ebook-view-switch-popup.css';

interface ViewSwitchOption {
  id: string;
  label: string;
  viewType: string;
}

const OPTIONS: ViewSwitchOption[] = [
  { id: 'switch-note', label: '📝 Note', viewType: 'note-view' },
  { id: 'switch-ebook', label: '📕 eBook', viewType: 'ebook-view' },
  { id: 'switch-web', label: '🌐 Web', viewType: 'web-view' },
  { id: 'switch-ai', label: '🤖 AI', viewType: 'ai-view' },
  { id: 'switch-thought', label: '💭 Thought', viewType: 'thought-view' },
];

export function EBookViewSwitchPopup({ onClose }: PopupCloseProps) {
  function pick(viewType: string): void {
    commandRegistry.execute('ebook-view.open-right-slot', viewType);
    onClose();
  }

  return (
    <div className="krig-ebook-view-switch-popup">
      {OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          className="krig-ebook-view-switch-popup__item"
          onMouseDown={(e) => {
            e.preventDefault();
            pick(opt.viewType);
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
