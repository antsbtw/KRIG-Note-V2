/**
 * NoteView popup 注册(L5-B3.4)
 *
 * 注册:
 * - note-view.popup.link  — LinkPanel(2 Tab:笔记 + 网页)
 * - note-view.popup.color — ColorPickerPanel(10 文字色 + 10 背景色 swatch)
 */

import { popupRegistry } from '@slot/interaction-registries/popup-registry/popup-registry';
import { LinkPanel } from './link-panel/LinkPanel';
import { ColorPickerPanel } from './color-picker/ColorPickerPanel';

export function registerNotePopups(): void {
  popupRegistry.register({
    id: 'note-view.popup.link',
    view: 'note-view',
    Component: LinkPanel,
    estimatedSize: { width: 320, height: 360 },
  });

  popupRegistry.register({
    id: 'note-view.popup.color',
    view: 'note-view',
    Component: ColorPickerPanel,
    estimatedSize: { width: 240, height: 200 },
  });
}
