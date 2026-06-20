/**
 * FontEmbedConfirmPanel — 模块级 pending context(L5-G7.4,嵌入确认弹窗)
 *
 * 仿 X 2.5-a send-confirm-popup/panel-context.ts:popupController.show 只能传 anchor,
 * 不能传 payload,故用模块级 pending 缓存 + panel mount 时 consume(读完即清)。
 *
 * 与 X 不同:嵌入是**异步等用户确认**的流程(embedSystemFont 要 await 结果),故 pending
 * 带一个 resolve 回调 —— 用户点「嵌入」→ resolve(true),点「取消」/ESC/点外 → resolve(false)。
 */

export interface FontEmbedConfirmContext {
  /** 字体族名(弹窗标题展示) */
  family: string;
  /** 体积 KB(用于 8MB 守卫文案;来自先行的预估或 0=未知) */
  sizeKb: number;
  /** 是否超 8MB 阈值(超了才是"守卫确认",否则普通确认) */
  overThreshold: boolean;
  /** 用户决定回调:true=嵌入,false=取消。只调一次。 */
  resolve: (confirmed: boolean) => void;
}

let pending: FontEmbedConfirmContext | null = null;

export function setPendingFontEmbedConfirm(ctx: FontEmbedConfirmContext): void {
  // 若已有未决 pending(理论不该,单例 popup),先按取消结掉,防 promise 泄漏
  if (pending) pending.resolve(false);
  pending = ctx;
}

export function consumePendingFontEmbedConfirm(): FontEmbedConfirmContext | null {
  const ctx = pending;
  pending = null;
  return ctx;
}

export const FONT_EMBED_CONFIRM_POPUP_ID = 'graph-canvas.popup.font-embed-confirm';

/** 锁定文案(设计 §6):嵌入确认弹窗 + 面板 license 提示同源 */
export const FONT_EMBED_LICENSE_TEXT =
  '嵌入字体会随画板内容一起保存和分发。系统预装的商业字体(如苹方、微软雅黑等)' +
  '可能限制再分发,导出 / 分享前请确认你拥有分发权利。';
