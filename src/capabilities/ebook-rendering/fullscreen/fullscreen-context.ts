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
