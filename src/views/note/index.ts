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
import { registerToolbar } from './toolbar-content';
import { registerFloatingToolbar } from './floating-toolbar-content';
import { registerSlashMenu } from './slash-menu-content';
import { registerHandleMenu } from './handle-menu-content';
import { registerContextMenu } from './context-menu-content';
import { registerNotePopups } from './popup-registrations';
import { registerLinkClickIntegration } from './link-click-integration';

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
  // L5-B1:NavSide 右键由 folderTreeContextMenuRegistry 管;view 全局 contextMenu 暂无
  // L5-B2 真有 PM 编辑区菜单需求时(粘贴/格式化等)在此重新注册
});

registerNoteCommands();
registerNavSide();
registerContextMenuItems();
registerToolbar();
registerFloatingToolbar();
registerSlashMenu();
registerHandleMenu();
registerContextMenu();
registerNotePopups();
registerLinkClickIntegration();
