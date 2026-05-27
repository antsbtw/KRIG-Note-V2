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

import { useEffect, useState } from 'react';
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

export function GlobalProgressOverlay() {
  const [state, setState] = useState<ProgressState | null>(null);

  useEffect(() => {
    const unsubStart = window.electronAPI.onProgressStart((p: ProgressStartPayload) => {
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
    });

    return () => {
      unsubStart();
      unsubUpdate();
      unsubDone();
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
            <button
              className="krig-progress-overlay__close-btn"
              onClick={() => setState(null)}
            >
              关闭
            </button>
          </div>
        )}
        {!state.done && (
          <div className="krig-progress-overlay__hint">请勿关闭窗口或操作应用</div>
        )}
      </div>
    </div>
  );
}
