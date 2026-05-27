/**
 * runWithProgress — 长耗时任务的全屏进度封装(main 端)
 *
 * 把任务的"开始 / 阶段 / 完成"广播到主窗口 renderer,由 <GlobalProgressOverlay/>
 * 渲染全屏覆盖层。后台任务(backup / restore)在主进程跑,renderer 仅显示进度。
 *
 * V1 参考:src/main/window/progress.ts;V2 简化点:V2 是单 BrowserWindow,
 * 不需要独立 overlay WebContentsView,直接推到主窗口 webContents 即可。
 */

import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import type {
  ProgressStartPayload,
  ProgressUpdatePayload,
  ProgressDonePayload,
} from '@shared/ipc/backup-types';
import { getMainWindow } from './main-window';

/** 进度上报回调签名 — 供任务函数调用 */
export type ProgressReporter = (
  message: string,
  current?: number,
  total?: number,
) => void;

interface RunOptions<T> {
  /**
   * 完成时把任务结果映射成显示给用户的成功 / 失败信息。
   * 不提供则按 "完成" / "失败" 默认文案。
   */
  doneMessage?: (result: T) => { success: boolean; message: string };
}

function sendToMain(channel: string, payload: unknown): void {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

/**
 * 运行一个长耗时任务,期间显示全屏进度遮罩。
 *
 * @param title 显示在遮罩上的标题
 * @param task  任务函数,接收 reportProgress 回调
 */
export async function runWithProgress<T>(
  title: string,
  task: (reportProgress: ProgressReporter) => Promise<T>,
  options: RunOptions<T> = {},
): Promise<T> {
  const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { doneMessage } = options;

  const startPayload: ProgressStartPayload = { taskId, title, indeterminate: true };
  sendToMain(IPC_CHANNELS.PROGRESS_START, startPayload);

  const reportProgress: ProgressReporter = (message, current, total) => {
    const payload: ProgressUpdatePayload = { taskId, message, current, total };
    sendToMain(IPC_CHANNELS.PROGRESS_UPDATE, payload);
  };

  try {
    const result = await task(reportProgress);
    const done = doneMessage
      ? doneMessage(result)
      : { success: true, message: '完成' };
    const donePayload: ProgressDonePayload = {
      taskId,
      success: done.success,
      message: done.message,
    };
    sendToMain(IPC_CHANNELS.PROGRESS_DONE, donePayload);
    return result;
  } catch (err) {
    const donePayload: ProgressDonePayload = {
      taskId,
      success: false,
      message: `失败:${(err as Error)?.message ?? String(err)}`,
    };
    sendToMain(IPC_CHANNELS.PROGRESS_DONE, donePayload);
    throw err;
  }
}
