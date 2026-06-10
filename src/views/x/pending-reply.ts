/**
 * X 回复目标 pending 缓存(X 集成 阶段 2,写方向)
 *
 * 仿阶段 0/1 / AI 的 pending 模式:用户在某条推上右键「在 note 里写回复」时,记下
 * 「这是对哪条推的回复」(tweetUrl + 简短预览),等用户在 note 里写好内容触发「发到 X」
 * 时取出 —— 有 pending → 走 pasteReply(注入该推 reply 框);无 pending → 走 pasteTweet
 * (发普通推)。
 *
 * 模块级单例(renderer 侧),与 ai-extraction 的 pending-thought 同性质。
 */

export interface XReplyTarget {
  /** 被回复推文的 status URL */
  tweetUrl: string;
  /** 简短预览(作者 + 正文片段)— 仅用于 UI 提示用户「正在回复哪条」*/
  preview: string;
  /** 记下的时间戳(去重 / 诊断)*/
  setAt: number;
}

let pendingReply: XReplyTarget | null = null;

/** 记下回复目标(右键「在 note 里写回复」时调)*/
export function setPendingXReply(target: XReplyTarget): void {
  pendingReply = target;
}

/** 仅取不删(UI 提示 / 诊断用)*/
export function peekPendingXReply(): XReplyTarget | null {
  return pendingReply;
}

/** 取出 + 清(「发到 X」消费时调:有则走回复路径)*/
export function consumePendingXReply(): XReplyTarget | null {
  const t = pendingReply;
  pendingReply = null;
  return t;
}

/** 清(用户取消 / 切换目标时)*/
export function clearPendingXReply(): void {
  pendingReply = null;
}
