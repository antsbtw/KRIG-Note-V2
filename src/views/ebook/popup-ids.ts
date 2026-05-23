/**
 * Popup id 常量(单独文件避免 index.ts ↔ EBookToolbar.tsx 循环 import)。
 *
 * index.ts 注册 popup 时用,EBookToolbar.tsx 触发 toggle 时也用。
 */

export const EBOOK_OPEN_POPUP_ID = 'ebook-view.popup.open';
export const EBOOK_VIEW_SWITCH_POPUP_ID = 'ebook-view.popup.view-switch';
export const EBOOK_AA_POPUP_ID = 'ebook-view.popup.aa';
