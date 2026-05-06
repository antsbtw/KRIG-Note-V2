/**
 * NoteView popup 注册(L5-B3.4)
 *
 * 当前注册:
 * - note-view.popup.link — LinkPanel
 * 后续(本阶段后续提交):
 * - note-view.popup.color — ColorPickerPanel
 */

import { popupRegistry } from '@slot/interaction-registries/popup-registry/popup-registry';
import { LinkPanel } from './link-panel/LinkPanel';

export function registerNotePopups(): void {
  popupRegistry.register({
    id: 'note-view.popup.link',
    view: 'note-view',
    Component: LinkPanel,
    estimatedSize: { width: 320, height: 360 },
  });
}
