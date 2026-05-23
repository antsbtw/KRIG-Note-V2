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

import { useState, useCallback, type KeyboardEvent, type ChangeEvent, type MouseEvent } from 'react';
import { popupController } from '@slot/triggers/popup-controller';
import { EBOOK_OPEN_POPUP_ID, EBOOK_VIEW_SWITCH_POPUP_ID, EBOOK_AA_POPUP_ID } from './popup-ids';

/** 书签丝带图标(对齐 Apple Books / Kindle 设计)— active=填充,inactive=描边
 *  与 EBookFullscreenPanel 内同款,view/panel 各自重复一份避免接口膨胀 */
function BookmarkIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="14"
      height="16"
      viewBox="0 0 14 16"
      fill={active ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 1.5h10v13L7 11l-5 3.5V1.5z" />
    </svg>
  );
}

export type EBookToolbarRenderMode = 'fixed-page' | 'reflowable' | null;

interface EBookToolbarProps {
  fileName: string;
  renderMode: EBookToolbarRenderMode;
  // 共用
  sidebarOpen: boolean;
  onSidebarToggle: () => void;
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
  /** PDF 提取(C6,fixed-page 专用)— 上传到 KRIG Knowledge Platform 并打开 web-view */
  onExtract?: () => void;
  /** 提取按钮 disabled(上传中)*/
  extractDisabled?: boolean;
  // reflowable 专用
  /** EPUB 章节进度比例(0-1)— 仅在 epubPages 未就绪时降级显示 */
  epubPercentage?: number;
  /** EPUB 全书页码(从 foliate location.current,1-based)— 与 PDF currentPage 对齐 */
  epubPage?: number;
  /** EPUB 全书总页数(location.total)— 与 PDF pageCount 对齐 */
  epubPages?: number;
  onPrevChapter?: () => void;
  onNextChapter?: () => void;
  // 注:fontSize / 字号变化已迁到 Aa popup,toolbar 不再接收
  /** 进入全屏沉浸阅读(L2 overlay)*/
  onFullscreen: () => void;
  /** 关闭当前 ebook view(× 按钮)*/
  onClose: () => void;
}

const ZOOM_PRESETS = [
  { label: '50%', value: 0.5 },
  { label: '75%', value: 0.75 },
  { label: '100%', value: 1.0 },
  { label: '125%', value: 1.25 },
  { label: '150%', value: 1.5 },
  { label: '200%', value: 2.0 },
];

// 字号 +/- 已迁到 Aa popup 内部;以下常量留作 props 类型守门(view 仍传 fontSize)

export function EBookToolbar({
  fileName,
  renderMode,
  sidebarOpen,
  onSidebarToggle,
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
  onExtract,
  extractDisabled = false,
  epubPercentage,
  epubPage = 0,
  epubPages = 0,
  onPrevChapter,
  onNextChapter,
  onFullscreen,
  onClose,
}: EBookToolbarProps) {
  const [pageInput, setPageInput] = useState('');
  const [editingPage, setEditingPage] = useState(false);

  // ── 页码导航(PDF/EPUB 通用)──
  // EPUB 路径用 epubPage/epubPages,onPageChange 上层(EBookView)调 host.goToPage
  // 自动按 renderMode 分发到正确 renderer
  const isReflow = renderMode === 'reflowable';
  const inputCurrentPage = isReflow ? epubPage : currentPage;
  const inputTotalPages = isReflow ? epubPages : pageCount;

  const handlePrevPage = useCallback(() => {
    if (inputCurrentPage > 1) onPageChange(inputCurrentPage - 1);
  }, [inputCurrentPage, onPageChange]);

  const handleNextPage = useCallback(() => {
    if (inputCurrentPage < inputTotalPages) onPageChange(inputCurrentPage + 1);
  }, [inputCurrentPage, inputTotalPages, onPageChange]);

  const handlePageInputFocus = useCallback(() => {
    setPageInput(String(inputCurrentPage));
    setEditingPage(true);
  }, [inputCurrentPage]);

  const handlePageInputBlur = useCallback(() => {
    setEditingPage(false);
    const page = parseInt(pageInput, 10);
    if (!isNaN(page) && page >= 1 && page <= inputTotalPages) {
      onPageChange(page);
    }
  }, [pageInput, inputTotalPages, onPageChange]);

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

  // 字号 +/- 已迁到 Aa popup 内部,toolbar 不再直接操纵

  // ── 通用尾部 handlers(Open / ⊞ 走 popup-registry;🔄 仍占位)──

  const handleOpenClick = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    popupController.toggle(EBOOK_OPEN_POPUP_ID, e.currentTarget);
  }, []);

  const handleViewSwitchClick = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    popupController.toggle(EBOOK_VIEW_SWITCH_POPUP_ID, e.currentTarget);
  }, []);

  const handleAaClick = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    popupController.toggle(EBOOK_AA_POPUP_ID, e.currentTarget);
  }, []);

  const handleReloadPlaceholder = useCallback(() => {
    console.log('[ebook-toolbar] reload — 占位符');
  }, []);

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
          {epubPages > 0 ? (
            <>
              <input
                className="krig-ebook-toolbar__page-input"
                value={editingPage ? pageInput : String(epubPage)}
                onChange={(e) => setPageInput(e.target.value)}
                onFocus={handlePageInputFocus}
                onBlur={handlePageInputBlur}
                onKeyDown={handlePageInputKey}
                title="点击输入页号跳转"
              />
              <span className="krig-ebook-toolbar__page-info">of {epubPages}</span>
            </>
          ) : (
            // EPUB 还没分页就绪时降级显示百分比(很短暂,relocate 后立即变页码)
            <span className="krig-ebook-toolbar__epub-progress">
              {Math.round((epubPercentage ?? 0) * 100)}%
            </span>
          )}
          <button
            className="krig-ebook-toolbar__btn"
            onClick={onNextChapter}
            title="下一页 (→)"
          >
            ›
          </button>
        </div>
      )}

      {/* Right: 模式特定按钮(标注/书签/缩放 或 字号)+ 通用尾部(Open / 🔄 / ⊞▾ / ×)*/}
      <div className="krig-ebook-toolbar__section krig-ebook-toolbar__section--right">
        {/* — PDF 专属:标注模式 + 书签 + 提取 + 缩放 — */}
        {showFixedNav && (
          <>
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
              <BookmarkIcon active={isBookmarked} />
            </button>
            {onExtract && (
              <button
                className="krig-ebook-toolbar__btn"
                onClick={onExtract}
                disabled={extractDisabled}
                title="提取 PDF 到 Note(KRIG Knowledge Platform)"
              >
                📤
              </button>
            )}
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
          </>
        )}

        {/* — EPUB 专属:Aa popup(字号 + 主题)+ 书签 — */}
        {showReflowNav && (
          <>
            <button
              className="krig-ebook-toolbar__btn"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleAaClick}
              title="字号 / 主题"
              aria-label="字号 / 主题"
            >
              <span className="krig-ebook-toolbar__aa-small">A</span>
              <span className="krig-ebook-toolbar__aa-large">A</span>
            </button>
            <button
              className={`krig-ebook-toolbar__btn ${isBookmarked ? 'krig-ebook-toolbar__btn--bookmark-active' : ''}`}
              onClick={onBookmarkToggle}
              title={isBookmarked ? '移除书签 (⌘D)' : '添加书签 (⌘D)'}
            >
              <BookmarkIcon active={isBookmarked} />
            </button>
          </>
        )}

        {/* — 通用尾部:Open(popup)/ 🔄(占位)/ ⊞(popup)/ × — */}
        <button
          className="krig-ebook-toolbar__btn krig-ebook-toolbar__btn--open"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleOpenClick}
          title="打开电子书"
        >
          Open
        </button>
        <button
          className="krig-ebook-toolbar__btn"
          onClick={handleReloadPlaceholder}
          title="重置(占位符)"
        >
          🔄
        </button>
        <button
          className="krig-ebook-toolbar__btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleViewSwitchClick}
          title="切换视图"
        >
          ⊞
        </button>
        {renderMode && (
          <button
            className="krig-ebook-toolbar__btn"
            onClick={onFullscreen}
            title="全屏沉浸阅读"
            aria-label="全屏沉浸阅读"
          >
            ⛶
          </button>
        )}
        <button
          className="krig-ebook-toolbar__btn krig-ebook-toolbar__btn--close"
          onClick={onClose}
          title="关闭此面板"
          aria-label="关闭此面板"
        >
          ×
        </button>
      </div>
    </div>
  );
}
