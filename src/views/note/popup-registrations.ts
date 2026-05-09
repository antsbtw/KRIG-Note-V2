/**
 * NoteView popup 注册(L5-B3.4 + L5-B3.12)
 *
 * 注册:
 * - note-view.popup.link       — LinkPanel(2 Tab:笔记 + 网页)
 * - note-view.popup.color      — ColorPickerPanel(10 文字色 + 10 背景色 swatch)
 * - note-view.popup.note-link  — NoteLinkSearchPanel([[ 触发的笔记搜索面板)L5-B3.12
 */

import { popupRegistry } from '@slot/interaction-registries/popup-registry/popup-registry';
import { LinkPanel } from './link-panel/LinkPanel';
import { ColorPickerPanel } from './color-picker/ColorPickerPanel';
import { NoteLinkSearchPanel } from './note-link-search/NoteLinkSearchPanel';
import { DictionaryPanel } from './dictionary-panel/DictionaryPanel';

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

  popupRegistry.register({
    id: 'note-view.popup.note-link',
    view: 'note-view',
    Component: NoteLinkSearchPanel,
    estimatedSize: { width: 280, height: 360 },
  });

  // L5-B3.20b:dictionary popup(查词 / 翻译 / 生词本)
  popupRegistry.register({
    id: 'note-view.popup.dictionary',
    view: 'note-view',
    Component: DictionaryPanel,
    estimatedSize: { width: 380, height: 480 },
  });
}
