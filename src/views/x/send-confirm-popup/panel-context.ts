/**
 * XSendConfirmPanel — 模块级 pending context(X 集成 阶段 2.5-a,写方向)
 *
 * popupController.show(POPUP_ID, anchor) 只能传 anchor element,不能传业务 payload
 * (同 ask-ai-popup/panel-context.ts 模式)。本模块缓存「发到 X 确认弹窗」打开时的
 * 待发内容,panel mount 时读(consume,读完即清)。
 *
 * 同时刻只允许一个 panel 实例(单例 popup),pending 写入即覆盖。
 */

/** 发送类型:普通推 vs 回复某推 */
export interface XSendConfirmContext {
  /**
   * 降级后的纯文本(markdownToTweetText 的结果)—— 弹窗预览 / 可编辑的初值。
   * 「所见即所发」:这正是会注入 X 框的内容。
   */
  text: string;
  /** 取的是整篇 doc(true)还是选区(false)—— 仅用于弹窗文案提示 */
  usedWholeDoc: boolean;
  /**
   * 回复目标预览(作者 + 正文片段)。非 null = 回复路径(填入该推 reply 框);
   * null = 普通推(填入 compose 框)。仅用于弹窗文案,真正的注入目标由 onConfirm 闭包持有。
   */
  replyPreview: string | null;
  /**
   * 确认回调:用户点「填入 X」时调,传当前(可能已编辑的)文本。
   * send-to-x 在此回调里做 ensureXVisible + 注入(发推 / 就地弹回复框)+ 失败降级。
   *
   * 返回 Promise<void>:弹窗会在 await 期间禁用按钮(防重复点),完成后由弹窗自行 close。
   */
  onConfirm: (finalText: string) => void | Promise<void>;
}

let pending: XSendConfirmContext | null = null;

export function setPendingXSendConfirm(ctx: XSendConfirmContext): void {
  pending = ctx;
}

export function consumePendingXSendConfirm(): XSendConfirmContext | null {
  const ctx = pending;
  pending = null;
  return ctx;
}

/** popup ID(popupRegistry 注册 + popupController.show 用) */
export const X_SEND_CONFIRM_POPUP_ID = 'x-view.popup.send-confirm';
