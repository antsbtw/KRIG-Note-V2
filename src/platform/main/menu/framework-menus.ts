/**
 * 框架级 Application Menu(L4 阶段最小集)
 *
 * 按 § 8 Q2=A:File / Edit(role)/ View / Window / Help 5 个顶级菜单。
 * 只填能立即生效的(View → Toggle DevTools)。
 * view / 能力的菜单项留 L5 注册时加。
 *
 * V1 教训:V1 app.ts 60+ 行硬编码菜单,V2 改为注册制。
 */

import { app, BrowserWindow } from 'electron';
import { menuRegistry } from '@slot/menu-registry/menu-registry';

/** 注册框架级 Application Menu */
export function registerFrameworkMenus(): void {
  // 注册框架级命令
  menuRegistry.registerCommand('app.quit', () => app.quit());
  menuRegistry.registerCommand('window.minimize', () => {
    BrowserWindow.getFocusedWindow()?.minimize();
  });
  menuRegistry.registerCommand('window.close', () => {
    BrowserWindow.getFocusedWindow()?.close();
  });
  menuRegistry.registerCommand('view.devtools.toggle', () => {
    BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools();
  });
  menuRegistry.registerCommand('view.reload', () => {
    BrowserWindow.getFocusedWindow()?.reload();
  });
  menuRegistry.registerCommand('help.about', () => {
    // L4 阶段占位,L5 / 后续可加 About 对话框
    console.log('[L4] About KRIG Note (placeholder)');
  });

  // KRIG Note(macOS 应用菜单)
  if (process.platform === 'darwin') {
    menuRegistry.register({
      id: 'app',
      label: app.name || 'KRIG Note',
      order: 0,
      items: [
        { id: 'about', label: 'About KRIG Note', command: 'help.about' },
        { id: 'sep1', label: '', separator: true },
        { id: 'quit', label: 'Quit KRIG Note', command: 'app.quit', accelerator: 'Cmd+Q' },
      ],
    });
  }

  // File 菜单
  menuRegistry.register({
    id: 'file',
    label: 'File',
    order: 1,
    items: [
      { id: 'import-markdown', label: 'Import Markdown...', command: 'file.import-markdown' },
      { id: 'import-word', label: 'Import Word...', command: 'file.import-word' },
      { id: 'import-word-pandoc', label: 'Import Word (High Quality)...', command: 'file.import-word-pandoc' },
      { id: 'sep-backup', label: '', separator: true },
      { id: 'backup', label: 'Backup All Data...', command: 'file.backup' },
      { id: 'restore', label: 'Restore from Backup...', command: 'file.restore' },
    ],
  });

  // Edit 菜单(用 Electron role 自动处理 Cmd+C/X/V/Z)
  menuRegistry.registerRoleMenu('edit', 'Edit', 2, 'editMenu');

  // View 菜单
  menuRegistry.register({
    id: 'view',
    label: 'View',
    order: 3,
    items: [
      { id: 'reload', label: 'Reload', command: 'view.reload', accelerator: 'CmdOrCtrl+R' },
      { id: 'devtools', label: 'Toggle Developer Tools', command: 'view.devtools.toggle', accelerator: 'CmdOrCtrl+Alt+I' },
    ],
  });

  // Window 菜单
  menuRegistry.register({
    id: 'window',
    label: 'Window',
    order: 4,
    items: [
      { id: 'minimize', label: 'Minimize', command: 'window.minimize', accelerator: 'CmdOrCtrl+M' },
      // Phase 4 Commit 2:⌘W 让给 web view 关 tab(对齐 Chrome),关窗口改 ⇧⌘W。
      { id: 'close', label: 'Close Window', command: 'window.close', accelerator: 'CmdOrCtrl+Shift+W' },
    ],
  });

  // Help 菜单
  menuRegistry.register({
    id: 'help',
    label: 'Help',
    order: 5,
    items: [
      { id: 'about', label: 'About KRIG Note', command: 'help.about' },
    ],
  });

  // 重建菜单
  menuRegistry.rebuild();
}
