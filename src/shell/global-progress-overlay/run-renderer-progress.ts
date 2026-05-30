/**
 * runRendererProgress — renderer 端长任务的全屏进度封装
 *
 * 与 main 端 run-with-progress.ts 同契约,但任务跑在 renderer(如 import 的
 * markdown 解析 / 切割阶段)。通过 window.electronAPI.driveProgress 把
 * start/update/done 事件经 PROGRESS_DRIVE → main progress-bridge 回推,
 * 驱动同一个 <GlobalProgressOverlay/>。
 *
 * 用途:让"点击导入 → 解析 → 切割 → 写库 → 完成"全程显示**同一个**不消失的
 * overlay,期间 overlay 阻塞 UI(防止用户中途乱操作导致半成品 note 被编辑)。
 *
 * 红线:不改 run-with-progress.ts / GlobalProgressOverlay.tsx。
 */

import type {
  ProgressStartPayload,
  ProgressUpdatePayload,
  ProgressDonePayload,
} from '@shared/ipc/backup-types';

/** 进度上报回调签名 — 与 main 端 ProgressReporter 一致 */
export type ProgressReporter = (
  message: string,
  current?: number,
  total?: number,
) => void;

export interface RendererProgressHandle {
  taskId: string;
  /** 上报进度(message + 可选 current/total)*/
  report: ProgressReporter;
  /** 切回不定进度(只更 message,清掉百分比)*/
  reportIndeterminate: (message: string) => void;
}

interface RunOptions<T> {
  /** 起始是否不定进度(默认 true — 解析阶段先转圈)*/
  indeterminate?: boolean;
  /** 完成时把结果映射成成功/失败信息 */
  doneMessage?: (result: T) => { success: boolean; message: string };
  /**
   * 延迟显示阈值(ms,默认 0 = 立即显示)。
   *
   * > 0 时:START 事件延迟 delayMs 才 fire。若 task 在阈值内完成,**完全不显
   * overlay**(START 都没 fire → 无 DONE)。用于"打开 note"这类多数秒完成、
   * 只有长任务才该显进度的场景,避免每次快操作都闪一下全屏遮罩。
   *
   * 注意:delay 期间的 report() 会被缓冲,START fire 时 flush 最后一条;
   * 适合无中间进度或只有 indeterminate 的场景(逐项 loop 进度请用 delayMs=0)。
   */
  delayMs?: number;
}

function genTaskId(): string {
  return `rtask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 运行一个 renderer 端长任务,期间显示全屏进度遮罩。
 *
 * task 接收一个 handle,可在任务内多次 report / reportIndeterminate,
 * 甚至改 title 旁的进度语义(单文档切割 vs 批量文件,文案由调用方在 report
 * message 里自行区分)。
 */
export async function runRendererProgress<T>(
  title: string,
  task: (handle: RendererProgressHandle) => Promise<T>,
  options: RunOptions<T> = {},
): Promise<T> {
  const taskId = genTaskId();
  const { indeterminate = true, doneMessage, delayMs = 0 } = options;

  // overlay 是否已 fire START。delay 模式下在阈值后或 task 结束前由 ensureStarted() 翻转。
  let started = false;
  // delay 期间最后一条 update(START fire 时 flush)
  let pendingUpdate: ProgressUpdatePayload | null = null;
  let delayTimer: ReturnType<typeof setTimeout> | null = null;

  const fireStart = (): void => {
    const startPayload: ProgressStartPayload = { taskId, title, indeterminate };
    window.electronAPI.driveProgress({ kind: 'start', payload: startPayload });
    started = true;
    if (pendingUpdate) {
      window.electronAPI.driveProgress({ kind: 'update', payload: pendingUpdate });
      pendingUpdate = null;
    }
  };

  if (delayMs > 0) {
    delayTimer = setTimeout(fireStart, delayMs);
  } else {
    fireStart();
  }

  const pushUpdate = (payload: ProgressUpdatePayload): void => {
    if (started) {
      window.electronAPI.driveProgress({ kind: 'update', payload });
    } else {
      // 还没 START(delay 期内)→ 缓冲最后一条,START fire 时 flush
      pendingUpdate = payload;
    }
  };

  const report: ProgressReporter = (message, current, total) => {
    pushUpdate({ taskId, message, current, total });
  };

  const reportIndeterminate = (message: string): void => {
    // total 不传 → overlay 保持 indeterminate(GlobalProgressOverlay 的 update
    // 逻辑:p.total == null 时维持原 indeterminate 态)
    pushUpdate({ taskId, message });
  };

  const handle: RendererProgressHandle = { taskId, report, reportIndeterminate };

  try {
    const result = await task(handle);
    // task 在 delay 阈值内就完成 → 取消定时器,从未 fire START → 不显 overlay,直接返回
    if (delayTimer) clearTimeout(delayTimer);
    if (!started) return result;

    const done = doneMessage
      ? doneMessage(result)
      : { success: true, message: '完成' };
    const donePayload: ProgressDonePayload = {
      taskId,
      success: done.success,
      message: done.message,
    };
    window.electronAPI.driveProgress({ kind: 'done', payload: donePayload });
    return result;
  } catch (err) {
    if (delayTimer) clearTimeout(delayTimer);
    // 出错时:即便还没到 delay 阈值也要显一个失败 overlay(让用户知道操作失败了)
    if (!started) fireStart();
    const donePayload: ProgressDonePayload = {
      taskId,
      success: false,
      message: `失败:${(err as Error)?.message ?? String(err)}`,
    };
    window.electronAPI.driveProgress({ kind: 'done', payload: donePayload });
    throw err;
  }
}
