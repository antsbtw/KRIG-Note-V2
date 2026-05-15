/**
 * callout emoji picker — driver 端 handler 注入点
 *
 * NodeView 内 emoji 点击时调 activeHandler.onOpen(view, blockPos, anchorEl);
 * capability 端通过 setCalloutEmojiHandler 注入 popup 启停逻辑(与 note-link
 * search handler 同模式 — driver 不依赖 React,handler 走 vanilla DOM 接口)。
 *
 * activeHandler null 时 NodeView fallback 到老 cycle 行为(防 capability 未装
 * 时挂掉)。
 */

import type { EditorView } from 'prosemirror-view';

export interface CalloutEmojiHandler {
  /** NodeView emoji 点击 → 调本回调,view 层启 popup */
  onOpen: (view: EditorView, blockPos: number, anchorEl: Element) => void;
  /** PM 内部需要关闭时(如 instance destroy)— 当前无调用方,保留对称性 */
  onClose: () => void;
}

let activeHandler: CalloutEmojiHandler | null = null;

export function setCalloutEmojiHandler(handler: CalloutEmojiHandler | null): void {
  activeHandler = handler;
}

export function getCalloutEmojiHandler(): CalloutEmojiHandler | null {
  return activeHandler;
}
