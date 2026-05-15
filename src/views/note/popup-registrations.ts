/**
 * NoteView popup 注册(C4 后:PM 通用 popup color/link 已由 text-editing capability
 * 自注册;本文件仅留 note-link 搜索 popup 等 NoteView 业务专属或 C6 待迁项)
 *
 * 当前注册:
 * - text-editing.popup.note-link  — NoteLinkSearchPanel([[ 触发的笔记搜索面板,
 *                                    L5-B3.12 实装,C6 整目录搬到 capability)
 *
 * 已迁(由 text-editing capability/ui/popups.ts 自注册):
 * - text-editing.popup.color  — ColorPickerPanel
 * - text-editing.popup.link   — LinkPanel
 */

import { popupRegistry } from '@slot/interaction-registries/popup-registry/popup-registry';
import { NoteLinkSearchPanel } from './note-link-search/NoteLinkSearchPanel';

export function registerNotePopups(): void {
  popupRegistry.register({
    id: 'text-editing.popup.note-link',
    view: 'note-view',
    Component: NoteLinkSearchPanel,
    estimatedSize: { width: 280, height: 360 },
  });
}
