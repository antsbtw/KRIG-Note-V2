/**
 * EBookToolbar — view 内 toolbar 内容(L5-C2 + C3 扩展)
 *
 * V1 → V2 改写。C3 在 C2 基础上加:
 * - sidebar toggle(☰)— 切换 OutlinePanel 显示
 * - search 入口(🔍)— 切换 SearchBar 显示(Cmd+F 也触发)
 * - reflowable 模式分支:章节翻页 ‹›(替代页码)+ 进度显示 + 字号 A−/A+(替代缩放)
 *
 * fixed-page / reflowable 通过 renderMode 切换 center/right 区段内容。
 *
 * 砍掉(C4 / C5):annotation mode / bookmark / extract / SlotToggle / 锚定锁。
 *
 * 所有交互都通过 props callbacks(handlers 在 view 层组合 + 调 hostRef);
 * Toolbar 不直接持有 renderer / library / host。
 */

import { useState, useCallback, type KeyboardEvent, type ChangeEvent } from 'react';

export type EBookToolbarRenderMode = 'fixed-page' | 'reflowable' | null;

interface EBookToolbarProps {
  fileName: string;
  renderMode: EBookToolbarRenderMode;
  // 共用
  sidebarOpen: boolean;
  onSidebarToggle: () => void;
  onSearchOpen: () => void;
  /** 当前位置是否已书签(C4)*/
  isBookmarked: boolean;
  /** 切换书签(Cmd+D 也走这个)*/
  onBookmarkToggle: () => void;
  // fixed-page 专用
  currentPage: number;
  pageCount: number;
  scale: number;
  fitWidth: boolean;
  onPageChange: (page: number) => void;
  onScaleChange: (scale: number) => void;
  onFitWidthToggle: () => void;
  /** PDF 空间标注模式(C5,fixed-page 专用)*/
  pdfAnnotationMode?: 'off' | 'rect' | 'underline';
  /** 切换 PDF 标注模式(同模式再点 = 关闭) */
  onPdfAnnotationModeChange?: (mode: 'off' | 'rect' | 'underline') => void;
  // reflowable 专用
  epubChapter?: string;
  epubPercentage?: number;
  fontSize?: number;
  onPrevChapter?: () => void;
  onNextChapter?: () => void;
  onFontSizeChange?: (delta: number) => void;
}

const ZOOM_PRESETS = [
  { label: '50%', value: 0.5 },
  { label: '75%', value: 0.75 },
  { label: '100%', value: 1.0 },
  { label: '125%', value: 1.25 },
  { label: '150%', value: 1.5 },
  { label: '200%', value: 2.0 },
];

const FONT_STEP = 10;
const FONT_MIN = 60;
const FONT_MAX = 200;

export function EBookToolbar({
  fileName,
  renderMode,
  sidebarOpen,
  onSidebarToggle,
  onSearchOpen,
  isBookmarked,
  onBookmarkToggle,
  currentPage,
  pageCount,
  scale,
  fitWidth,
  onPageChange,
  onScaleChange,
  onFitWidthToggle,
  pdfAnnotationMode = 'off',
  onPdfAnnotationModeChange,
  epubChapter,
  epubPercentage,
  fontSize = 100,
  onPrevChapter,
  onNextChapter,
  onFontSizeChange,
}: EBookToolbarProps) {
  const [pageInput, setPageInput] = useState('');
  const [editingPage, setEditingPage] = useState(false);

  // ── fixed-page 导航 ──

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

  // ── 缩放 ──

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

  // ── 字号 ──

  const handleFontMinus = useCallback(() => {
    if (!onFontSizeChange) return;
    const next = Math.max(FONT_MIN, fontSize - FONT_STEP);
    onFontSizeChange(next);
  }, [fontSize, onFontSizeChange]);

  const handleFontPlus = useCallback(() => {
    if (!onFontSizeChange) return;
    const next = Math.min(FONT_MAX, fontSize + FONT_STEP);
    onFontSizeChange(next);
  }, [fontSize, onFontSizeChange]);

  // ── 渲染条件 ──

  const showFixedNav = renderMode === 'fixed-page' && pageCount > 0;
  const showReflowNav = renderMode === 'reflowable';

  return (
    <div className="krig-ebook-toolbar">
      {/* Left: sidebar toggle + 文件名 */}
      <div className="krig-ebook-toolbar__section krig-ebook-toolbar__section--left">
        {renderMode && (
          <button
            className={`krig-ebook-toolbar__btn ${sidebarOpen ? 'krig-ebook-toolbar__btn--active' : ''}`}
            onClick={onSidebarToggle}
            title="目录"
          >
            ☰
          </button>
        )}
        {fileName && (
          <span className="krig-ebook-toolbar__filename" title={fileName}>
            {fileName}
          </span>
        )}
      </div>

      {/* Center: 导航(按 renderMode 切换形态)*/}
      {showFixedNav && (
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

      {showReflowNav && (
        <div className="krig-ebook-toolbar__section krig-ebook-toolbar__section--center">
          <button
            className="krig-ebook-toolbar__btn"
            onClick={onPrevChapter}
            title="上一页 (←)"
          >
            ‹
          </button>
          <span className="krig-ebook-toolbar__epub-progress">
            {epubChapter ? `${epubChapter} · ` : ''}
            {Math.round((epubPercentage ?? 0) * 100)}%
          </span>
          <button
            className="krig-ebook-toolbar__btn"
            onClick={onNextChapter}
            title="下一页 (→)"
          >
            ›
          </button>
        </div>
      )}

      {/* Right: 书签 + 缩放 / 字号(按 renderMode 切换)+ 搜索 */}
      {showFixedNav && (
        <div className="krig-ebook-toolbar__section krig-ebook-toolbar__section--right">
          {/* C5:PDF 空间标注模式切换 */}
          <button
            className={`krig-ebook-toolbar__btn ${pdfAnnotationMode === 'rect' ? 'krig-ebook-toolbar__btn--active' : ''}`}
            onClick={() =>
              onPdfAnnotationModeChange?.(pdfAnnotationMode === 'rect' ? 'off' : 'rect')
            }
            title="线框标注(拖拽画矩形)"
          >
            ▢
          </button>
          <button
            className={`krig-ebook-toolbar__btn ${pdfAnnotationMode === 'underline' ? 'krig-ebook-toolbar__btn--active' : ''}`}
            onClick={() =>
              onPdfAnnotationModeChange?.(
                pdfAnnotationMode === 'underline' ? 'off' : 'underline',
              )
            }
            title="横线标注(拖拽画下划线)"
          >
            ▁
          </button>
          <button
            className={`krig-ebook-toolbar__btn ${isBookmarked ? 'krig-ebook-toolbar__btn--bookmark-active' : ''}`}
            onClick={onBookmarkToggle}
            title={isBookmarked ? '移除书签 (⌘D)' : '添加书签 (⌘D)'}
          >
            {isBookmarked ? '★' : '☆'}
          </button>
          <button
            className="krig-ebook-toolbar__btn"
            onClick={onSearchOpen}
            title="搜索 (⌘F)"
          >
            🔍
          </button>
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

      {showReflowNav && (
        <div className="krig-ebook-toolbar__section krig-ebook-toolbar__section--right">
          <button
            className={`krig-ebook-toolbar__btn ${isBookmarked ? 'krig-ebook-toolbar__btn--bookmark-active' : ''}`}
            onClick={onBookmarkToggle}
            title={isBookmarked ? '移除书签 (⌘D)' : '添加书签 (⌘D)'}
          >
            {isBookmarked ? '★' : '☆'}
          </button>
          <button
            className="krig-ebook-toolbar__btn"
            onClick={onSearchOpen}
            title="搜索 (⌘F)"
          >
            🔍
          </button>
          <button
            className="krig-ebook-toolbar__btn"
            onClick={handleFontMinus}
            title="缩小字号"
            disabled={fontSize <= FONT_MIN}
          >
            A−
          </button>
          <span className="krig-ebook-toolbar__font-size">{fontSize}%</span>
          <button
            className="krig-ebook-toolbar__btn"
            onClick={handleFontPlus}
            title="放大字号"
            disabled={fontSize >= FONT_MAX}
          >
            A+
          </button>
        </div>
      )}
    </div>
  );
}
