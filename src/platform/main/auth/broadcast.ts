/**
 * auth 跨模块广播工具
 *
 * 抽出 broadcastAuthChanged 单独文件,对齐 note/broadcast.ts、bookmark/broadcast.ts 模板,
 * 避免 handler 既挂 ipcMain 又被其他模块 import 时引起注册副作用重复触发。
 *
 * 红线 4(多 ws 扇出守卫):主进程遍历**所有** BrowserWindow / webContents 发送 public 态;
 * renderer 侧加 active 守卫(阶段 4 实现),避免一次登录触发 N 次 UI / 菜单重建。
 *
 * 用法:auth-handler.ts 启动时 subscribe authService → 每次状态变化调本函数广播。
 */

import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import type { AuthState } from '@shared/auth/auth-types';

/** 广播 public 授权态到所有 renderer(不含 token)*/
export function broadcastAuthChanged(state: AuthState): void {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.AUTH_CHANGED, state);
      }
    }
  } catch (err) {
    console.warn('[auth] broadcast auth-changed failed:', err);
  }
}
