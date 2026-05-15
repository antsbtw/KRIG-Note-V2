/**
 * note-link 搜索面板 — capability 端 popup 接入(L5-B3.12;C6 上提)
 *
 * driver 的 build-note-link-command-plugin 检测到 `[[` 时通过 setNoteLinkSearchHandler
 * 调本模块的 onOpen,本模块用 popupController.show 启 popup(NoteLinkSearchPanel)。
 *
 * anchor 用 view.coordsAtPos(plugin.from) 算锚点 → 临时 fake div 作 anchor 元素
 * (复用 NoteView Cmd+K fallback 模式)
 *
 * 装配:capability 加载时自调一次(详 capabilities/text-editing/index.ts);
 * driver activeHandler 是模块级单例,view 各自注册会互相覆盖,故归 capability 自管。
 */

import { setNoteLinkSearchHandler, noteLinkCommandKey } from '@drivers/text-editing-driver';
import { popupController } from '@slot/triggers/popup-controller';

const POPUP_ID = 'text-editing.popup.note-link';

interface NoteLinkPluginState {
  active: boolean;
  from: number;
  to: number;
}

/** capability 加载时一次性注册 driver note-link search handler */
export function registerNoteLinkSearchIntegration(): void {
  setNoteLinkSearchHandler({
    onOpen(view) {
      const key = noteLinkCommandKey as unknown as {
        getState(state: unknown): NoteLinkPluginState | null;
      };
      const s = key.getState(view.state);
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
