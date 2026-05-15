/**
 * note-link 搜索面板 — view 层 popup 接入(L5-B3.12)
 *
 * driver 的 build-note-link-command-plugin 检测到 `[[` 触发时通过 setNoteLinkSearchHandler
 * 调本模块的 onOpen,本模块用 popupController.show 启 popup(NoteLinkSearchPanel)。
 *
 * anchor 用 view.coordsAtPos(plugin.from) 算锚点 → 临时 fake div 作 anchor 元素
 * (复用 NoteView Cmd+K fallback 模式 — 见 NoteView.tsx 中 fake anchor 处理)
 */

import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import { popupController } from '@slot/triggers/popup-controller';

const POPUP_ID = 'text-editing.popup.note-link';

export function registerNoteLinkSearchIntegration(): void {
  const textEditing = requireCapabilityApi<TextEditingApi>('text-editing');
  textEditing.setNoteLinkSearchHandler({
    onOpen(view) {
      // noteLinkCommandKey 通过 capability api 访问(不直 import driver)
      const noteLinkCommandKey = textEditing.noteLinkCommandKey as { getState(state: unknown): { active: boolean; from: number; to: number } | null };
      const s = noteLinkCommandKey.getState(view.state);
      if (!s?.active) return;
      // 用 [[ 起始位置 PM coords 作 anchor
      let coords: { left: number; top: number; bottom: number };
      try {
        coords = view.coordsAtPos(s.from);
      } catch {
        return;
      }
      const fake = document.createElement('div');
      fake.style.position = 'fixed';
      fake.style.left = `${coords.left}px`;
      fake.style.top = `${coords.bottom}px`;
      fake.style.width = '1px';
      fake.style.height = '1px';
      fake.style.pointerEvents = 'none';
      document.body.appendChild(fake);
      popupController.show(POPUP_ID, fake);
      window.setTimeout(() => fake.remove(), 0);
    },
    onClose() {
      const cur = popupController.getState();
      if (cur.visible && cur.activeId === POPUP_ID) {
        popupController.hide();
      }
    },
  });
}
