/**
 * EBook fullscreen overlay context — 模块级 SSOT 传 payload
 *
 * 对齐 [[code-block/fullscreen/menu-context]] 模式:fullscreenOverlayController.show(id) 不带参,
 * 而 EBookFullscreenPanel 需要知道 workspaceId / bookId / 初始位置才能正确加载与回写进度。
 *
 * 触发链:
 *   EBookToolbar 全屏按钮 click
 *     → setEBookFullscreenContext({ workspaceId, bookInfo, initialPosition })
 *     → fullscreenOverlayController.show('ebook-rendering.fullscreen.reader')
 *     → FullscreenOverlayBinding 渲染 EBookFullscreenPanel
 *     → Panel mount 时 getEBookFullscreenContext() 拿 ctx → 内部 host loadFromInfo
 *     → 翻页 / 缩放实时调 library.saveProgress(bookId, position)
 *     → 关闭(Esc / × / 业务方主动)时 Panel unmount → cleanup 清 ctx
 *
 * 进度同步:Panel 内独立 host,实时通过 library.saveProgress 落库;EBookView
 * 重新打开此书时 library.open 推流的 lastPosition 会反映最新位置。
 *
 * 单实例:fullscreenOverlayController 同一时刻只允许一个 overlay,模块级单变量不撞。
 */

import type { EBookLoadedInfo } from '@shared/ipc/ebook-types';

export interface EBookFullscreenContext {
  /** 所属 workspace(用于关闭后回到原 view) */
  workspaceId: string;
  /** 完整 EBookLoadedInfo — 直接喂给 host.loadFromInfo */
  bookInfo: EBookLoadedInfo;
  /**
   * EPUB 全屏布局对齐用 — view 主区当前 EPUB 单 column 实际渲染宽度(像素)。
   *
   * 全屏 panel 收到后:
   * - 限制 EBookHost main 容器宽 = 2 × viewColumnWidth(+ gap + padding),居中显示,两侧黑边
   * - 同步 max-inline-size 给 foliate paginator,避免 1000px 默认上限截断
   * - 单 column 宽与 view 主区精确相等 → paginator 切分文字位置一致 →
   *   单屏 page N 内容 = spread 左页内容,page N+1 = spread 右页内容(物理对齐)
   *
   * PDF 路径或 EPUB 未 ready 时 undefined;panel 走默认布局(占满 viewport)。
   */
  epubViewColumnWidth?: number;
}

let current: EBookFullscreenContext | null = null;

export function setEBookFullscreenContext(ctx: EBookFullscreenContext): void {
  current = ctx;
}

export function getEBookFullscreenContext(): EBookFullscreenContext | null {
  return current;
}

export function clearEBookFullscreenContext(): void {
  current = null;
}

/** Registry id 集中常量(view / capability 都要引) */
export const EBOOK_FULLSCREEN_OVERLAY_ID = 'ebook-rendering.fullscreen.reader';
