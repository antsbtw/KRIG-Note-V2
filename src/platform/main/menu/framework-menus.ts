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
import { importChromeBookmarks } from '../bookmark/chrome-import';
import { wsCreate, getActiveWorkspace, getFullState, onWorkspacesChanged } from '../workspace/workspace-manager-main';
import { createWindow, getFocusedWindowWsId } from '../window/main-window';
import type { MenuItem } from '@slot/menu-registry/menu-types';

/** 注册框架级 Application Menu */
export function registerFrameworkMenus(): void {
  // 注册框架级命令
  menuRegistry.registerCommand('app.quit', () => app.quit());
  menuRegistry.registerCommand('window.new', () => {
    const active = getActiveWorkspace();
    const ws = wsCreate(active?.slotBinding);
    void createWindow(ws.id);
  });
  // window.open-profile.<wsId> — 动态注册，ws 列表变化时会整批替换
  // 不需要预注册；buildProfileSubmenu 每次重建时重新注册所有命令
  menuRegistry.registerCommand('window.minimize', () => {
    BrowserWindow.getFocusedWindow()?.minimize();
  });
  menuRegistry.registerCommand('window.close', () => {
    BrowserWindow.getFocusedWindow()?.close();
  });
  menuRegistry.registerCommand('file.import-chrome-bookmarks', () => {
    void importChromeBookmarks(BrowserWindow.getFocusedWindow()).catch((err) => {
      console.error('[chrome-import] importChromeBookmarks failed:', err);
    });
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

  const buildProfileSubmenu = (): MenuItem[] => {
    const { workspaces } = getFullState();
    const currentWsId = getFocusedWindowWsId();
    return workspaces
      .filter((ws) => ws.id !== currentWsId)
      .map((ws) => {
        const cmdId = `window.open-profile.${ws.id}`;
        menuRegistry.registerCommand(cmdId, () => void createWindow(ws.id));
        return { id: cmdId, label: ws.label, command: cmdId };
      });
  };

  // File 菜单
  menuRegistry.register({
    id: 'file',
    label: 'File',
    order: 1,
    items: [
      { id: 'new-window', label: 'New Window', command: 'window.new', accelerator: 'CmdOrCtrl+Shift+N' },
      { id: 'new-window-profile', label: 'New Window with Profile', dynamicSubmenu: buildProfileSubmenu },
      { id: 'sep-new', label: '', separator: true },
      { id: 'import-markdown', label: 'Import Markdown...', command: 'file.import-markdown' },
      { id: 'import-word', label: 'Import Word...', command: 'file.import-word' },
      { id: 'import-word-pandoc', label: 'Import Word (High Quality)...', command: 'file.import-word-pandoc' },
      { id: 'import-chrome-bookmarks', label: 'Import Chrome Bookmarks...', command: 'file.import-chrome-bookmarks' },
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

  // workspace 增删改名 → 重建菜单（dynamicSubmenu 重新计算）
  onWorkspacesChanged(() => menuRegistry.rebuild());

  // 焦点窗口切换 → 重建菜单（过滤的 currentWsId 随之变化）
  app.on('browser-window-focus', () => menuRegistry.rebuild());

  // 重建菜单
  menuRegistry.rebuild();
}
