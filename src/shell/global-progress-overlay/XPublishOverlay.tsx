/**
 * XPublishOverlay — X 发布的**局部**进度遮罩(只盖 X view 区,不锁全屏 note)
 *
 * 动机(总指挥 2026-06-14):X 发布耗时长,需进度反馈 + **冻结 X webview**(防驱动期间用户点 X
 *   破坏正在执行的脚本);但上传后跟 note 无关,故只遮 X view,不锁整个 app。
 *
 * 复用 GlobalProgressOverlay 的订阅逻辑 + 视觉(同套 .krig-progress-overlay 样式),区别:
 * - 只接 `scope==='x-view'` 的进度任务(全屏 overlay 跳过这些,见 GlobalProgressOverlay)。
 * - 外层加 `--local` 修饰类(absolute 盖父容器,父容器 .krig-ai-view 需 position:relative)。
 *
 * 渲染位置:AIView 的 .krig-ai-view 容器内(X webview 所在区)。
 */

import { useEffect, useRef, useState, type ReactElement } from 'react';
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

export function XPublishOverlay(): ReactElement | null {
  const [state, setState] = useState<ProgressState | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDismissTimer = (): void => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  };

  useEffect(() => {
    const unsubStart = window.electronAPI.onProgressStart((p: ProgressStartPayload) => {
      if (p.scope !== 'x-view') return; // 只接 X view 作用域(其余给全屏 overlay)
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
      if (p.success) {
        clearDismissTimer();
        dismissTimerRef.current = setTimeout(() => setState(null), 1200);
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
      className="krig-progress-overlay krig-progress-overlay--local"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="krig-progress-overlay__panel">
        <div className="krig-progress-overlay__title">{state.title}</div>
        {state.message && <div className="krig-progress-overlay__message">{state.message}</div>}

        <div className="krig-progress-overlay__bar-container">
          {state.indeterminate ? (
            <div className="krig-progress-overlay__bar krig-progress-overlay__bar--indeterminate">
              <div className="krig-progress-overlay__bar-fill krig-progress-overlay__bar-fill--indeterminate" />
            </div>
          ) : (
            <div className="krig-progress-overlay__bar">
              <div className="krig-progress-overlay__bar-fill" style={{ width: `${percent}%` }} />
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
          <div className="krig-progress-overlay__hint">正在驱动 X 文章,请勿操作 X 页面</div>
        )}
      </div>
    </div>
  );
}
