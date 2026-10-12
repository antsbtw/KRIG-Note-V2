/**
 * ⭐⭐ 一个人的「朋友圈」—— 从推文**现算**(纯函数,离线可测;2026-10-10)
 *
 * 用户:「主要是观察这个用户主要和哪些用户互动，找到它的朋友圈。」
 * ⭐ 关系第二性、派生可重算:互动关系就在推文里(回复 / 提及 / 引用 / 转发),推文存全了随时现算,
 * 不另存一份会过时的关系表。
 *
 * 权重(讨论时定的方向:回复最能说明关系近,转发最弱):
 * 他回复对方 / 对方回复他 = 3,引用 = 2,提及 / 转发 = 1。
 * ⚠️ 排除他自己(回复自己的串推不算朋友)。
 */

export type CircleTweet = {
  readonly author_rest_id?: string;
  readonly author_handle?: string;
  readonly in_reply_to_user_id?: string;
  readonly in_reply_to_user?: string;
  readonly mention_ids?: readonly string[];
  readonly mentions?: readonly string[];
  readonly quoted_author_id?: string;
  readonly retweet_of_author_id?: string;
};

export type CircleEntry = {
  readonly id: string;
  /** 推文里见过的 handle(人表里没有这个人时用它显示)*/
  readonly handleSeen?: string;
  readonly reply: number;
  readonly theyReply: number;
  readonly mention: number;
  readonly quote: number;
  readonly retweet: number;
  readonly score: number;
};

/** 朋友圈里的一个人 —— 计数 + 人表里的资料(人表里没有时 inTable=false)*/
export type CirclePerson = CircleEntry & {
  readonly handle?: string;
  readonly display_name?: string;
  readonly avatar?: string;
  readonly is_blue_verified?: boolean;
  readonly i_follow?: boolean;
  readonly follows_me?: boolean;
  readonly chinese: boolean;
  readonly inTable: boolean;
};

export const CIRCLE_WEIGHTS = { reply: 3, theyReply: 3, quote: 2, mention: 1, retweet: 1 } as const;

type Acc = { id: string; handleSeen?: string; reply: number; theyReply: number; mention: number; quote: number; retweet: number };

/**
 * @param his    他自己发的推文(author_rest_id = selfId)
 * @param toHim  别人回复他的推文(in_reply_to_user_id = selfId)
 */
export function computeCircle(selfId: string, his: readonly CircleTweet[], toHim: readonly CircleTweet[]): CircleEntry[] {
  const m = new Map<string, Acc>();
  const bump = (id: string | undefined, k: keyof typeof CIRCLE_WEIGHTS, handle?: string): void => {
    if (!id || id === selfId) return;
    const a = m.get(id) ?? { id, reply: 0, theyReply: 0, mention: 0, quote: 0, retweet: 0 };
    a[k] += 1;
    if (handle && !a.handleSeen) a.handleSeen = handle;
    m.set(id, a);
  };
  for (const t of his) {
    if (t.author_rest_id !== selfId) continue;
    bump(t.in_reply_to_user_id, 'reply', t.in_reply_to_user);
    (t.mention_ids ?? []).forEach((id, i) => {
      /** ⚠️ 回复时 X 会自动把被回复者放进提及 —— 已经算过「回复」就不重复算「提及」 */
      if (id === t.in_reply_to_user_id) return;
      /**
       * ⚠️ 转发的外层正文是「RT @原作者: …」,提及里自动带着原作者 —— 已经算过「转发」就不重复算
       * (2026-10-10 真机:赛博信访局「提及 11 转发 11」两数恒等,就是这么来的)。
       */
      if (id === t.retweet_of_author_id) return;
      bump(id, 'mention', t.mentions?.[i]);
    });
    bump(t.quoted_author_id, 'quote');
    bump(t.retweet_of_author_id, 'retweet');
  }
  for (const t of toHim) {
    if (t.in_reply_to_user_id !== selfId) continue;
    bump(t.author_rest_id, 'theyReply', t.author_handle);
  }
  return [...m.values()]
    .map((a) => ({
      ...a,
      score: a.reply * CIRCLE_WEIGHTS.reply + a.theyReply * CIRCLE_WEIGHTS.theyReply
        + a.quote * CIRCLE_WEIGHTS.quote + a.mention * CIRCLE_WEIGHTS.mention + a.retweet * CIRCLE_WEIGHTS.retweet,
    }))
    .sort((x, y) => y.score - x.score || x.id.localeCompare(y.id));
}

/** ⭐ 名字或 bio 是中文、且不是日文 —— 与人页「中文名或 bio(不含日文)」同一条规则 */
export function looksChinese(name?: string, bio?: string): boolean {
  const t = `${name ?? ''} ${bio ?? ''}`;
  const han = /[一-鿿]/.test(t);
  const kana = (t.match(/[ぁ-ねは-ゖァ-ヺ]/g) ?? []).length;
  return han && kana < 2;
}
