/**
 * NoteView self-register 入口
 *
 * 见 DESIGN.md v0.2.2 § 1.1。
 *
 * import 时触发副作用:注册 view + 命令 + NavSide 内容。
 */

import { registerView } from '@slot/view-type-registry/register-view';
import { NoteView } from './NoteView';
import { registerNoteCommands } from './note-commands';
import { registerNavSide } from './nav-side-content';
import { registerContextMenuItems } from './context-menu-registrations';

registerView({
  id: 'note-view',
  install: [
    // 5 通用 capability
    'selection',
    'clipboard',
    'undo-redo',
    'drag-and-drop',
    'insertion',
    // driver(必经,Q-N1=B 显式声明)
    'text-editing-driver',
  ],
  component: NoteView,
  navSideTab: { label: 'Note', icon: '📝', order: 1 },
  contextMenu: [
    {
      id: 'note-view.create-note',
      label: '新建笔记',
      command: 'note-view.create-note',
      enabledWhen: 'always',
    },
  ],
});

registerNoteCommands();
registerNavSide();
registerContextMenuItems();
