/**
 * Web view 下载条(Phase 3)
 *
 * 轻量横条,跨所有 tab 共享一条(对齐 Chrome 浏览器级下载栏,不按 tab 分组),挂在
 * WebView 的 restart-banner 同层(toolbar 下、hosts 上)。
 *
 * 数据来自 main 推送的 onWebDownloadEvent(started/progress/done):
 * - started → 加一条(filename, total, received=0, status='progressing')
 * - progress → 更新 received/total
 * - done → state==='completed' 标完成(存 savePath,提供「在 Finder 显示」);
 *           cancelled/interrupted 标失败(不给「在 Finder 显示」)
 *
 * 坑:
 * - getTotalBytes 可能为 0(未知大小,如 chunked)→ 不显百分比,显示「下载中…」。
 * - done state 可能是 cancelled/interrupted,别当完成处理。
 * - savePath 仅 completed 有效。
 * - DownloadItem 不跨 IPC → 用 id 中转(取消调 webDownloadAction({id, action:'cancel'}))。
 *
 * 列表空 → 不渲染(下载条不显示)。
 */

import { useEffect, useState, type ReactElement } from 'react';

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

  useEffect(() => {
    const off = window.electronAPI.onWebDownloadEvent((payload) => {
      setDownloads((prev) => {
        if (payload.type === 'started') {
          // 同 id 不会重复(自增),但防御性去重。
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

  if (downloads.length === 0) return null;

  const dismiss = (id: number): void => {
    setDownloads((prev) => prev.filter((d) => d.id !== id));
  };

  const cancel = (id: number): void => {
    void window.electronAPI.webDownloadAction({ id, action: 'cancel' });
  };

  return (
    <div className="krig-web-download-bar">
      {downloads.map((d) => {
        const hasTotal = d.total > 0;
        const percent = hasTotal ? Math.min(100, Math.round((d.received / d.total) * 100)) : 0;
        return (
          <div key={d.id} className="krig-web-download-bar__item">
            <span className="krig-web-download-bar__name" title={d.filename}>
              {d.filename}
            </span>

            {d.status === 'progressing' && (
              <>
                <div className="krig-web-download-bar__track">
                  {hasTotal ? (
                    <div
                      className="krig-web-download-bar__fill"
                      style={{ width: `${percent}%` }}
                    />
                  ) : (
                    <div className="krig-web-download-bar__fill krig-web-download-bar__fill--indeterminate" />
                  )}
                </div>
                <span className="krig-web-download-bar__meta">
                  {hasTotal
                    ? `${percent}% · ${formatBytes(d.received)} / ${formatBytes(d.total)}`
                    : `下载中… ${formatBytes(d.received)}`}
                </span>
                <button
                  type="button"
                  className="krig-web-download-bar__btn"
                  onClick={() => cancel(d.id)}
                >
                  取消
                </button>
              </>
            )}

            {d.status === 'completed' && (
              <>
                <span className="krig-web-download-bar__meta krig-web-download-bar__meta--done">
                  ✓ 已完成
                </span>
                {d.savePath && (
                  <button
                    type="button"
                    className="krig-web-download-bar__btn"
                    onClick={() => void window.electronAPI.showItemInFolder(d.savePath)}
                  >
                    在 Finder 显示
                  </button>
                )}
                <button
                  type="button"
                  className="krig-web-download-bar__dismiss"
                  onClick={() => dismiss(d.id)}
                  title="关闭"
                  aria-label="关闭"
                >
                  ×
                </button>
              </>
            )}

            {(d.status === 'cancelled' || d.status === 'interrupted') && (
              <>
                <span className="krig-web-download-bar__meta krig-web-download-bar__meta--failed">
                  {d.status === 'cancelled' ? '已取消' : '下载中断'}
                </span>
                <button
                  type="button"
                  className="krig-web-download-bar__dismiss"
                  onClick={() => dismiss(d.id)}
                  title="关闭"
                  aria-label="关闭"
                >
                  ×
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
