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
import { registerNoteLinkSearchIntegration } from './note-link-search/integration';

registerView({
  id: 'note-view',
  install: [
    // W5 严格收尾:install 严格 capability-only(0 driver id)
    'selection',
    'clipboard',
    'undo-redo',
    'drag-and-drop',
    'insertion',
    'text-editing',   // W5 C4:driver 改 capability,view 通过 capability api 间接路由
  ],
  component: NoteView,
  navSideTab: { label: 'Note', icon: '📝', order: 1 },
  // W4.1:view 全局快捷键(原 NoteView 内嵌 useEffect 拆出)
  keymap: [
    {
      key: 'mod+k',
      command: 'note-view.popup-link',
      enabledWhen: ['has-text-selection', 'in-view-area'],
    },
    {
      key: 'mod+[',
      command: 'note-view.go-back',
      enabledWhen: ['in-view-area', 'not-in-input'],
    },
    {
      key: 'mod+]',
      command: 'note-view.go-forward',
      enabledWhen: ['in-view-area', 'not-in-input'],
    },
  ],
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
registerNoteLinkSearchIntegration();
