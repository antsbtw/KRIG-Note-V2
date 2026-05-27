/**
 * backup-restore 主进程模块出口
 *
 * 注册入口:src/platform/main/ipc/ipc-bus.ts initIpcBus()
 * 菜单项 click 触发由 src/platform/main/menu/framework-menus.ts 调用此模块。
 */

export { registerBackupMenu } from './register-backup-menu';
export { backupStore } from './backup-store';
