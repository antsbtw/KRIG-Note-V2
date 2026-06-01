/**
 * Web view 下载 UI(Phase 3,Chrome 式重构)
 *
 * 形态:工具栏右侧一个下载图标按钮 + 点开弹出的下载列表面板(对齐 Chrome 右上角下载图标)。
 * - 图标:本次会话有过下载就常驻显示(关 app 才清);本次还没下载过 → 整个组件不渲染(不占空间)。
 * - 进行中下载有进度时,图标上叠加一个细环/角标(简化:进行中数量角标)。
 * - 点图标 → 展开面板,列出各条下载;点外部 / 再点图标 → 收起。
 *
 * 数据来自 main 推送的 onWebDownloadEvent(started/progress/done):
 * - started → 加一条(filename, total, received=0, status='progressing')
 * - progress → 更新 received/total
 * - done → completed 存 savePath(给「在 Finder 显示」);cancelled/interrupted 标失败
 *
 * 坑:
 * - getTotalBytes 可能为 0(未知大小)→ 不显百分比,显示「下载中…」。
 * - done state 可能 cancelled/interrupted,别当完成。savePath 仅 completed 有效。
 * - DownloadItem 不跨 IPC → 用 id 中转(取消调 webDownloadAction({id, action:'cancel'}))。
 *
 * 跨所有 tab 共享(不按 tab 分组),挂在 WebToolbar actions 区(翻译按钮旁)。
 */

import { useEffect, useRef, useState, type ReactElement } from 'react';

type DownloadStatus = 'progressing' | 'completed' | 'cancelled' | 'interrupted';

interface DownloadInfo {
  id: number;
  filename: string;
  received: number;
  total: number;
  status: DownloadStatus;
  savePath: string;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

export function WebDownloadBar(): ReactElement | null {
  const [downloads, setDownloads] = useState<DownloadInfo[]>([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const off = window.electronAPI.onWebDownloadEvent((payload) => {
      setDownloads((prev) => {
        if (payload.type === 'started') {
          const without = prev.filter((d) => d.id !== payload.id);
          return [
            ...without,
            {
              id: payload.id,
              filename: payload.filename,
              received: 0,
              total: payload.total ?? 0,
              status: 'progressing',
              savePath: '',
            },
          ];
        }

        if (payload.type === 'progress') {
          return prev.map((d) =>
            d.id === payload.id
              ? {
                  ...d,
                  received: payload.received ?? d.received,
                  total: payload.total ?? d.total,
                }
              : d,
          );
        }

        // done:state 可能 completed / cancelled / interrupted。
        const status: DownloadStatus =
          payload.state === 'completed'
            ? 'completed'
            : payload.state === 'interrupted'
              ? 'interrupted'
              : 'cancelled';
        return prev.map((d) =>
          d.id === payload.id
            ? {
                ...d,
                status,
                savePath: status === 'completed' ? (payload.savePath ?? '') : '',
              }
            : d,
        );
      });
    });
    return off;
  }, []);

  // 新下载开始时自动展开面板(对齐 Chrome:开始下载弹出列表)
  const prevCountRef = useRef(0);
  useEffect(() => {
    if (downloads.length > prevCountRef.current) setOpen(true);
    prevCountRef.current = downloads.length;
  }, [downloads.length]);

  // 点面板外部收起
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', handler);
    };
  }, [open]);

  // 本次会话没下载过 → 整个组件不渲染(图标不占空间)
  if (downloads.length === 0) return null;

  const dismiss = (id: number): void => {
    setDownloads((prev) => prev.filter((d) => d.id !== id));
  };

  const cancel = (id: number): void => {
    void window.electronAPI.webDownloadAction({ id, action: 'cancel' });
  };

  const activeCount = downloads.filter((d) => d.status === 'progressing').length;

  return (
    <div className="krig-web-download" ref={rootRef}>
      <button
        type="button"
        className="krig-web-toolbar__btn krig-web-download__icon"
        onClick={() => setOpen((v) => !v)}
        title="下载"
        aria-label="下载"
        aria-expanded={open}
      >
        {/* 下载箭头 icon */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12" />
          <path d="M7 10l5 5 5-5" />
          <path d="M5 21h14" />
        </svg>
        {activeCount > 0 && (
          <span className="krig-web-download__badge">{activeCount}</span>
        )}
      </button>

      {open && (
        <div className="krig-web-download__panel" role="menu">
          <div className="krig-web-download__panel-title">下载</div>
          {downloads.map((d) => {
            const hasTotal = d.total > 0;
            const percent = hasTotal
              ? Math.min(100, Math.round((d.received / d.total) * 100))
              : 0;
            return (
              <div key={d.id} className="krig-web-download__item">
                <div className="krig-web-download__row">
                  <span className="krig-web-download__name" title={d.filename}>
                    {d.filename}
                  </span>
                  {d.status === 'progressing' ? (
                    <button
                      type="button"
                      className="krig-web-download__btn"
                      onClick={() => cancel(d.id)}
                    >
                      取消
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="krig-web-download__dismiss"
                      onClick={() => dismiss(d.id)}
                      title="移除"
                      aria-label="移除"
                    >
                      ×
                    </button>
                  )}
                </div>

                {d.status === 'progressing' && (
                  <>
                    <div className="krig-web-download__track">
                      {hasTotal ? (
                        <div
                          className="krig-web-download__fill"
                          style={{ width: `${percent}%` }}
                        />
                      ) : (
                        <div className="krig-web-download__fill krig-web-download__fill--indeterminate" />
                      )}
                    </div>
                    <span className="krig-web-download__meta">
                      {hasTotal
                        ? `${percent}% · ${formatBytes(d.received)} / ${formatBytes(d.total)}`
                        : `下载中… ${formatBytes(d.received)}`}
                    </span>
                  </>
                )}

                {d.status === 'completed' && (
                  <div className="krig-web-download__done-row">
                    <span className="krig-web-download__meta krig-web-download__meta--done">
                      ✓ 已完成
                    </span>
                    {d.savePath && (
                      <button
                        type="button"
                        className="krig-web-download__btn"
                        onClick={() => void window.electronAPI.showItemInFolder(d.savePath)}
                      >
                        在 Finder 显示
                      </button>
                    )}
                  </div>
                )}

                {(d.status === 'cancelled' || d.status === 'interrupted') && (
                  <span className="krig-web-download__meta krig-web-download__meta--failed">
                    {d.status === 'cancelled' ? '已取消' : '下载中断'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
