/**
 * ⭐ 互动卡「来龙去脉」—— 纯部分(类型 / 找原帖 / 拼给 Gemma 的上下文),renderer 与 main 都用(2026-10-22)
 * 读库 / 开详情页补采在 x-engage-thread.ts(主进程)。
 */
export type ThreadRow = {
  readonly tweet_id: string;
  readonly author_rest_id?: string;
  readonly author_handle?: string;
  readonly text?: string;
  readonly created_at?: string;
  readonly in_reply_to?: string;
  readonly conversation_id?: string;
  /** 回复给谁 / 提到了谁(数字 id)—— 「之后的来回」只收我回他 / 提到他的 */
  readonly in_reply_to_user_id?: string;
  readonly mention_ids?: readonly string[];
};

export type ThreadItem = {
  readonly id: string;
  readonly who: 'me' | 'him' | 'other';
  readonly handle?: string;
  readonly text: string;
  readonly at?: string;
  readonly isRoot: boolean;
  readonly isTarget: boolean;
};

export type EngageThread = {
  /** 原帖 → … → 目标(按回复关系往上找到的那一串,原帖在前) */
  readonly chain: readonly ThreadItem[];
  /** 往上找断了(上一层库里没有、补采也没拿到)—— 原帖不在 chain 里 */
  readonly gapAbove: boolean;
  /** 同一对话里,目标之后你和他的来回 */
  readonly later: readonly ThreadItem[];
};

export const MAX_HOPS = 30;

/** ⭐ 纯函数:从目标往上找原帖 + 之后的来回 */
export function buildThread(targetId: string, rows: readonly ThreadRow[], me: string, him: string): EngageThread {
  const byId = new Map(rows.map((r) => [r.tweet_id, r]));
  const item = (r: ThreadRow, isTarget: boolean): ThreadItem => ({
    id: r.tweet_id,
    who: r.author_rest_id === me ? 'me' : r.author_rest_id === him ? 'him' : 'other',
    handle: r.author_handle,
    text: r.text ?? '',
    at: r.created_at,
    isRoot: !r.in_reply_to,
    isTarget,
  });
  const target = byId.get(targetId);
  if (!target) return { chain: [], gapAbove: true, later: [] };
  const up: ThreadItem[] = [item(target, true)];
  let cur = target;
  let gapAbove = false;
  for (let i = 0; i < MAX_HOPS && cur.in_reply_to; i += 1) {
    const parent = byId.get(cur.in_reply_to);
    if (!parent) { gapAbove = true; break; }
    up.push(item(parent, false));
    cur = parent;
  }
  const chainIds = new Set(up.map((x) => x.id));
  const conv = target.conversation_id;
  const t0 = Date.parse(target.created_at ?? '');
  const later = rows
    .filter((r) => conv && r.conversation_id === conv && !chainIds.has(r.tweet_id)
      /**
       * ⚠️ 只收「你们俩之间的」:他发的,或我回他 / 提到他的(真机:原帖是我的推广帖,同一对话里我回了一堆别人,不能算你们的来回)
       */
      && (r.author_rest_id === him || (r.author_rest_id === me && (r.in_reply_to_user_id === him || (r.mention_ids ?? []).includes(him))))
      && Date.parse(r.created_at ?? '') > t0)
    .sort((a, b) => Date.parse(a.created_at ?? '') - Date.parse(b.created_at ?? ''))
    .map((r) => item(r, false));
  return { chain: up.reverse(), gapAbove, later };
}

/** 给 Gemma 的上下文:原帖 → 来回 → 他找我的那条 */
export function threadForPrompt(t: EngageThread): string {
  const name = (x: ThreadItem): string => (x.who === 'me' ? '我' : x.who === 'him' ? '他' : `@${x.handle ?? '别人'}`);
  return [...t.chain, ...t.later].map((x) => `${x.isRoot ? '[原帖] ' : ''}${x.isTarget ? '[要回的这条] ' : ''}${name(x)}:${x.text.replace(/\s+/g, ' ').slice(0, 160)}`).join('\n');
}

