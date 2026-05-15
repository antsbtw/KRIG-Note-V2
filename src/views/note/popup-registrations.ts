/**
 * NoteView popup 注册(L5-B3.4 + L5-B3.12)
 *
 * 注册:
 * - note-view.popup.link       — LinkPanel(2 Tab:笔记 + 网页)
 * - note-view.popup.color      — ColorPickerPanel(10 文字色 + 10 背景色 swatch)
 * - note-view.popup.note-link  — NoteLinkSearchPanel([[ 触发的笔记搜索面板)L5-B3.12
 *
 * (L4.1:dictionary 已迁到 help-panel-registry,见 help-panel-registrations.ts)
 */

import { popupRegistry } from '@slot/interaction-registries/popup-registry/popup-registry';
import { LinkPanel } from './link-panel/LinkPanel';
import { ColorPickerPanel } from '@capabilities/text-editing/ui/color-picker/ColorPickerPanel';
import { NoteLinkSearchPanel } from './note-link-search/NoteLinkSearchPanel';

export function registerNotePopups(): void {
  popupRegistry.register({
    id: 'text-editing.popup.link',
    view: 'note-view',
    Component: LinkPanel,
    estimatedSize: { width: 320, height: 360 },
  });

  popupRegistry.register({
    id: 'text-editing.popup.color',
    view: 'note-view',
    Component: ColorPickerPanel,
    estimatedSize: { width: 240, height: 200 },
  });

  popupRegistry.register({
    id: 'text-editing.popup.note-link',
    view: 'note-view',
    Component: NoteLinkSearchPanel,
    estimatedSize: { width: 280, height: 360 },
  });
}
