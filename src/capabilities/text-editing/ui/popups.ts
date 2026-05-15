/**
 * text-editing popup 注册(C4 上提 + C6 加 note-link)
 *
 * Popup 跟菜单 item 不同:菜单 item 是"按 view 显示哪些条目"(view 决定内容),
 * popup 是"id → Component 映射"(全局唯一)。
 *
 * popup-registry 内部是 Map<id, item>,按 id 全局唯一;PopupBinding 只按 id 取
 * Component 渲染,view 字段不参与渲染过滤。因此 popup 注册由 capability 自己管,
 * 一次性注册全部 PM 通用 popup;view 不主动注册 popup,仅在浮条/toolbar/keymap
 * 等处通过 popupController.show 触发对应 popup id。
 *
 * view 字段:undefined(对齐 popup-types.ts:25 "全 view 可用" 约定)
 *
 * note-link 搜索 popup 由 driver build-note-link-command-plugin 检测 `[[`
 * 触发 setNoteLinkSearchHandler.onOpen,handler 内 popupController.show 弹起。
 * handler 装配走 registerNoteLinkSearchIntegration()(view 自管,因 driver handler
 * 注入是 capability-level 单一来源 — 多 view 注册会互相覆盖,与 popup 同理)。
 */

import { popupRegistry } from '@slot/interaction-registries/popup-registry/popup-registry';
import { ColorPickerPanel } from './color-picker/ColorPickerPanel';
import { LinkPanel } from './link-panel/LinkPanel';
import { NoteLinkSearchPanel } from './note-link-search/NoteLinkSearchPanel';

/** capability 加载时一次性注册所有 PM 通用 popup */
export function registerTextEditingPopups(): void {
  popupRegistry.register({
    id: 'text-editing.popup.color',
    Component: ColorPickerPanel,
    estimatedSize: { width: 240, height: 200 },
  });

  popupRegistry.register({
    id: 'text-editing.popup.link',
    Component: LinkPanel,
    estimatedSize: { width: 320, height: 360 },
  });

  popupRegistry.register({
    id: 'text-editing.popup.note-link',
    Component: NoteLinkSearchPanel,
    estimatedSize: { width: 280, height: 360 },
  });
}
