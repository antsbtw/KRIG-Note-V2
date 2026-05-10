/**
 * EBookToolbar — view 内 toolbar 内容(L5-C2)
 *
 * V1 → V2 改写:src/plugins/ebook/components/EBookToolbar.tsx(305 行)→ 简版。
 * 砍掉(C2 不做):
 * - sidebar toggle / OutlinePanel(C3)
 * - annotation mode / bookmark(C4 / C5)
 * - 提取按钮(D-8 不在本迁移)
 * - SlotToggle / 锚定锁 / OpenFilePopup(D-9 锚定单独 / 不在本段)
 * - reflowable 章节导航(C3 起)
 *
 * 保留:文件名 + 上一页/下一页/页码输入/总页数 + 缩放(-/select/+)+ 适应宽度。
 *
 * 所有交互都通过 props callbacks(handlers 在 view 层组合 + 调 hostRef);
 * Toolbar 不直接持有 renderer / library。
 */

import { useState, useCallback, type KeyboardEvent, type ChangeEvent } from 'react';

interface EBookToolbarProps {
  fileName: string;
  currentPage: number;
  pageCount: number;
  scale: number;
  fitWidth: boolean;
  onPageChange: (page: number) => void;
  onScaleChange: (scale: number) => void;
  onFitWidthToggle: () => void;
}

const ZOOM_PRESETS = [
  { label: '50%', value: 0.5 },
  { label: '75%', value: 0.75 },
  { label: '100%', value: 1.0 },
  { label: '125%', value: 1.25 },
  { label: '150%', value: 1.5 },
  { label: '200%', value: 2.0 },
];

export function EBookToolbar({
  fileName,
  currentPage,
  pageCount,
  scale,
  fitWidth,
  onPageChange,
  onScaleChange,
  onFitWidthToggle,
}: EBookToolbarProps) {
  const [pageInput, setPageInput] = useState('');
  const [editingPage, setEditingPage] = useState(false);

  const handlePrevPage = useCallback(() => {
    if (currentPage > 1) onPageChange(currentPage - 1);
  }, [currentPage, onPageChange]);

  const handleNextPage = useCallback(() => {
    if (currentPage < pageCount) onPageChange(currentPage + 1);
  }, [currentPage, pageCount, onPageChange]);

  const handlePageInputFocus = useCallback(() => {
    setPageInput(String(currentPage));
    setEditingPage(true);
  }, [currentPage]);

  const handlePageInputBlur = useCallback(() => {
    setEditingPage(false);
    const page = parseInt(pageInput, 10);
    if (!isNaN(page) && page >= 1 && page <= pageCount) {
      onPageChange(page);
    }
  }, [pageInput, pageCount, onPageChange]);

  const handlePageInputKey = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      setEditingPage(false);
      setPageInput('');
    }
  }, []);

  const handleZoomChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value;
      if (val === 'fit-width') onFitWidthToggle();
      else onScaleChange(parseFloat(val));
    },
    [onScaleChange, onFitWidthToggle],
  );

  const handleZoomIn = useCallback(() => {
    const next = Math.min(scale + 0.25, 3.0);
    onScaleChange(Math.round(next * 100) / 100);
  }, [scale, onScaleChange]);

  const handleZoomOut = useCallback(() => {
    const next = Math.max(scale - 0.25, 0.25);
    onScaleChange(Math.round(next * 100) / 100);
  }, [scale, onScaleChange]);

  const showNav = pageCount > 0;

  return (
    <div className="krig-ebook-toolbar">
      {/* Left: 文件名 */}
      <div className="krig-ebook-toolbar__section krig-ebook-toolbar__section--left">
        {fileName && (
          <span className="krig-ebook-toolbar__filename" title={fileName}>
            {fileName}
          </span>
        )}
      </div>

      {/* Center: 导航(fixed-page 模式)*/}
      {showNav && (
        <div className="krig-ebook-toolbar__section krig-ebook-toolbar__section--center">
          <button
            className="krig-ebook-toolbar__btn"
            onClick={handlePrevPage}
            disabled={currentPage <= 1}
            title="上一页"
          >
            ‹
          </button>
          <input
            className="krig-ebook-toolbar__page-input"
            value={editingPage ? pageInput : String(currentPage)}
            onChange={(e) => setPageInput(e.target.value)}
            onFocus={handlePageInputFocus}
            onBlur={handlePageInputBlur}
            onKeyDown={handlePageInputKey}
          />
          <span className="krig-ebook-toolbar__page-info">of {pageCount}</span>
          <button
            className="krig-ebook-toolbar__btn"
            onClick={handleNextPage}
            disabled={currentPage >= pageCount}
            title="下一页"
          >
            ›
          </button>
        </div>
      )}

      {/* Right: 缩放控件 */}
      {showNav && (
        <div className="krig-ebook-toolbar__section krig-ebook-toolbar__section--right">
          <button
            className="krig-ebook-toolbar__btn"
            onClick={handleZoomOut}
            title="缩小"
          >
            −
          </button>
          <select
            className="krig-ebook-toolbar__zoom-select"
            value={fitWidth ? 'fit-width' : String(scale)}
            onChange={handleZoomChange}
          >
            <option value="fit-width">适应宽度</option>
            {ZOOM_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
            {!fitWidth && !ZOOM_PRESETS.some((p) => p.value === scale) && (
              <option value={scale}>{Math.round(scale * 100)}%</option>
            )}
          </select>
          <button
            className="krig-ebook-toolbar__btn"
            onClick={handleZoomIn}
            title="放大"
          >
            +
          </button>
        </div>
      )}
    </div>
  );
}
