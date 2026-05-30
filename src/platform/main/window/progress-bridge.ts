/**
 * progress-bridge — renderer 驱动进度的转发器(main 端)
 *
 * 背景:GlobalProgressOverlay 只订阅 main → renderer 的 PROGRESS_START/UPDATE/DONE。
 * runWithProgress 是 main 端工具,适合"任务在 main 跑"的场景(backup/restore)。
 *
 * 但 import 链路的解析 / 切割阶段在 renderer 跑(markdownToAtoms 等)。为了让这些
 * renderer 端长任务也能驱动**同一个** overlay,renderer 通过 PROGRESS_DRIVE 通道
 * 把 start/update/done 事件发给 main,main 原样回推给**发起事件的那个窗口**
 * (event.sender),overlay 即被驱动。
 *
 * 红线:不改 run-with-progress.ts / GlobalProgressOverlay.tsx(稳定共用件),
 * 仅新增本转发器复用既有 overlay 渲染。
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import type {
  ProgressDrivePayload,
  ProgressStartPayload,
  ProgressUpdatePayload,
  ProgressDonePayload,
} from '@shared/ipc/backup-types';
import { getMainWindow } from './main-window';

function emit(channel: string, payload: unknown): void {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

/**
 * main 端"手动驱动" overlay 的三个发射器 — 用于跨进程交接场景:
 * 任务先在 main 跑一段(只 start/update,**不 done**),再交给 renderer 继续
 * (renderer 用 runRendererProgress 起新 taskId,自然覆盖,无间隙)。
 *
 * 与 runWithProgress 的区别:runWithProgress 总会 fire done(适合任务全程在
 * main);这里的 start/update 不强制配 done,适合"main 解析 → renderer 写库"这种
 * 接力(word import 链路)。失败时调用方自己 fire done(success:false)。
 */
export function progressStart(payload: ProgressStartPayload): void {
  emit(IPC_CHANNELS.PROGRESS_START, payload);
}
export function progressUpdate(payload: ProgressUpdatePayload): void {
  emit(IPC_CHANNELS.PROGRESS_UPDATE, payload);
}
export function progressDone(payload: ProgressDonePayload): void {
  emit(IPC_CHANNELS.PROGRESS_DONE, payload);
}

export function registerProgressBridge(): void {
  ipcMain.on(IPC_CHANNELS.PROGRESS_DRIVE, (event, raw: unknown) => {
    const msg = raw as ProgressDrivePayload;
    if (!msg || typeof msg !== 'object' || event.sender.isDestroyed()) return;

    switch (msg.kind) {
      case 'start':
        event.sender.send(IPC_CHANNELS.PROGRESS_START, msg.payload);
        break;
      case 'update':
        event.sender.send(IPC_CHANNELS.PROGRESS_UPDATE, msg.payload);
        break;
      case 'done':
        event.sender.send(IPC_CHANNELS.PROGRESS_DONE, msg.payload);
        break;
      default:
        console.warn('[progress-bridge] unknown drive kind:', (msg as { kind?: unknown }).kind);
    }
  });
}
