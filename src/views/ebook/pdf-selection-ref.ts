/**
 * pdf-selection-ref — PDF textLayer 最近一次选区缓存(模块级 ref)
 *
 * 用途:右键 contextInfoProvider 是纯函数无法读 EBookView React state;
 * EBookView mouseup handler 在 set state 之外也 write 此 ref,右键命令读 ref 拿到
 * 完整的 PdfTextSelectionEvent(pageNum + textRects + textContent + boundingRect),
 * 用于 ask-ai 命令落完整 BookAnchor(含 highlight 视觉)。
 *
 * 生命周期:
 * - 写:EBookView handlePdfTextSelected 始终 write(不依赖 pdfTextMode)
 * - 读:epub-context-menu / ebook-context-menu 内 ask-ai 命令读取
 * - 失效检查:读时通常会校验 window.getSelection().isCollapsed,collapsed = ref stale
 *   (用户 mouseup 后又点了别处取消选区)
 * - 清:dismissPdfTextPicker / 切书时清,避免跨场景误用
 */

import type { PdfTextSelectionEvent } from '@capabilities/ebook-rendering/hooks/use-pdf-text-selection';

let lastSelection: PdfTextSelectionEvent | null = null;

export function setLastPdfSelection(ev: PdfTextSelectionEvent | null): void {
  lastSelection = ev;
}

export function getLastPdfSelection(): PdfTextSelectionEvent | null {
  return lastSelection;
}
