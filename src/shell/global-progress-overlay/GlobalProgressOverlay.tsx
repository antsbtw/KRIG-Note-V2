/**
 * GlobalProgressOverlay — 全屏进度遮罩(renderer)
 *
 * 通过 window.electronAPI.onProgress* 订阅 main 端任务事件,
 * 在任务存活期间渲染一层 fixed inset:0 的覆盖层,阻塞 UI 并显示进度。
 *
 * 主要使用场景:File → Backup All Data / Restore from Backup。
 *
 * V1 参考:src/renderer/shell/GlobalProgressOverlay.tsx;V2 简化点 —
 * V2 直接挂在主 BrowserWindow renderer 内(<App> 的 sibling),
 * 不再需要独立的 overlay WebContentsView。
 */

import { useEffect, useRef, useState } from 'react';
import type {
  ProgressStartPayload,
  ProgressUpdatePayload,
  ProgressDonePayload,
} from '@shared/ipc/backup-types';
import './global-progress-overlay.css';

interface ProgressState {
  taskId: string;
  title: string;
  message?: string;
  indeterminate: boolean;
  current: number;
  total: number;
  done: boolean;
  success?: boolean;
  doneMessage?: string;
}

/**
 * 成功完成后自动消失的停留时长(ms)。
 *
 * 2026-05-29:导入/打开/删除/backup 这类操作完成只是"告知",不该让用户再点
 * "关闭"。成功(success===true)→ 停留 SUCCESS_DISMISS_MS 让用户看清结果再
 * 自动消失;失败(success===false)→ 保留"关闭"键,让用户看清错误后手动关
 * (尤其 restore 失败这类重要信息不能自动溜走)。
 */
const SUCCESS_DISMISS_MS = 1200;

export function GlobalProgressOverlay() {
  const [state, setState] = useState<ProgressState | null>(null);
  // 自动消失定时器(成功 done 后启动;新任务 START / 手动关闭 / unmount 时清除)
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDismissTimer = (): void => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  };

  useEffect(() => {
    const unsubStart = window.electronAPI.onProgressStart((p: ProgressStartPayload) => {
      // 新任务开始 → 取消上一个任务的自动消失定时器(避免它误清掉新 overlay)
      clearDismissTimer();
      setState({
        taskId: p.taskId,
        title: p.title,
        message: p.message,
        indeterminate: p.indeterminate ?? true,
        current: 0,
        total: 0,
        done: false,
      });
    });

    const unsubUpdate = window.electronAPI.onProgressUpdate((p: ProgressUpdatePayload) => {
      setState((prev) => {
        if (!prev || prev.taskId !== p.taskId) return prev;
        return {
          ...prev,
          message: p.message ?? prev.message,
          current: p.current ?? prev.current,
          total: p.total ?? prev.total,
          indeterminate: p.total == null ? prev.indeterminate : false,
        };
      });
    });

    const unsubDone = window.electronAPI.onProgressDone((p: ProgressDonePayload) => {
      setState((prev) => {
        if (!prev || prev.taskId !== p.taskId) return prev;
        return { ...prev, done: true, success: p.success, doneMessage: p.message };
      });
      // 成功 → 停留片刻后自动消失(只清这个 taskId,且未被新任务/手动关替换时才清)。
      // 失败 → 不自动消失,保留"关闭"键。
      if (p.success) {
        clearDismissTimer();
        dismissTimerRef.current = setTimeout(() => {
          dismissTimerRef.current = null;
          setState((prev) => (prev && prev.taskId === p.taskId ? null : prev));
        }, SUCCESS_DISMISS_MS);
      }
    });

    return () => {
      unsubStart();
      unsubUpdate();
      unsubDone();
      clearDismissTimer();
    };
  }, []);

  if (!state) return null;

  const percent =
    state.indeterminate || state.total === 0
      ? null
      : Math.min(100, Math.round((state.current / state.total) * 100));

  return (
    <div
      className="krig-progress-overlay"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="krig-progress-overlay__panel">
        <div className="krig-progress-overlay__title">{state.title}</div>
        {state.message && (
          <div className="krig-progress-overlay__message">{state.message}</div>
        )}

        <div className="krig-progress-overlay__bar-container">
          {state.indeterminate ? (
            <div className="krig-progress-overlay__bar krig-progress-overlay__bar--indeterminate">
              <div className="krig-progress-overlay__bar-fill krig-progress-overlay__bar-fill--indeterminate" />
            </div>
          ) : (
            <div className="krig-progress-overlay__bar">
              <div
                className="krig-progress-overlay__bar-fill"
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
        </div>

        {!state.indeterminate && percent != null && (
          <div className="krig-progress-overlay__percent">
            {percent}% ({state.current}/{state.total})
          </div>
        )}

        {state.done && (
          <div className="krig-progress-overlay__done-row">
            <div
              className={
                state.success
                  ? 'krig-progress-overlay__text--success'
                  : 'krig-progress-overlay__text--error'
              }
            >
              {state.doneMessage ?? (state.success ? '完成' : '失败')}
            </div>
            {/* 成功 = 告知性提示,停留 1.2s 自动消失,不给"关闭"键;
                失败 = 保留"关闭"键让用户看清错误后手动关 */}
            {!state.success && (
              <button
                className="krig-progress-overlay__close-btn"
                onClick={() => {
                  clearDismissTimer();
                  setState(null);
                }}
              >
                关闭
              </button>
            )}
          </div>
        )}
        {!state.done && (
          <div className="krig-progress-overlay__hint">请勿关闭窗口或操作应用</div>
        )}
      </div>
    </div>
  );
}
