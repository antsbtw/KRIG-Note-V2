/**
 * ⭐⭐ 查回关 + 人的互动时间线 —— 纯函数(2026-10-19,蓝V互关求关第 4 阶段)
 *
 * 用户 10-17:「这些动作完毕后,要记录关注时间,定期检查对方是否回关,建立和对方互动的时间线。
 *  确保未来能够定期互动,最终把对方发展为我们的客户。」
 * 用户 10-19 定:每天自动查一次 · 满 N 天没回关的只列出来由人决定 · 时间线放人卡「互动」栏。
 *
 * ⚠️ 本文件不碰库、不碰 Electron —— 判定逻辑都在这里,离线可测。
 */

/* ───────────────────────── 追上了没有 ───────────────────────── */

/**
 * ⭐ 从我的 followers 第一页往下数:连续见到 `limit` 个**原来就关注我**的人 = 追上上次了。
 *
 * 依据(09-19 快速增量,真快照复算):followers 严格按关注时间倒序,新关注的连续排在最前。
 * ⚠️ 「连续」不是「累计」:见到一个新人就清零 —— 新人夹在老人中间说明还没追上。
 * ⚠️ 判据用**这一跑见到的人**,不是累计表(累计表里见过的不会再来,判据会永不成立 —— 09-19 记过的坑)。
 */
export function makeKnownRunTracker(known: ReadonlySet<string>, limit: number): {
  feed(ids: readonly string[]): void;
  readonly state: { readonly run: number; readonly caughtUp: boolean; readonly seen: number; readonly fresh: readonly string[] };
} {
  const seen = new Set<string>();
  const fresh: string[] = [];
  let run = 0;
  let caughtUp = false;
  return {
    feed(ids) {
      for (const id of ids) {
        /**
         * ⚠️ 追上之后不再数(10-19 真机:同一页里先连续 30 个老关注者,后面又冒出一个库里没记过的**老**关注者,
         * 计数清零,停因写成「连续 15 个」,那人还被算进了「新关注我」)。追上之后的人照样存库,只是不再计数。
         */
        if (caughtUp) break;
        if (id === '' || seen.has(id)) continue;
        seen.add(id);
        if (known.has(id)) { run += 1; if (run >= limit) caughtUp = true; } else { run = 0; fresh.push(id); }
      }
    },
    get state() { return { run, caughtUp, seen: seen.size, fresh }; },
  };
}

const DAY_MS = 24 * 3600_000;
/** 上次没成功的,隔这么久再试(不等一整天;也不连珠炮) */
const RETRY_MS = 2 * 3600_000;

/** ⭐ 这个号该不该自动查回关了(用户 10-19 选「每天自动一次」):成功的隔一天;没成的隔 2 小时再试 */
export function followCheckDue(last: { readonly at: string; readonly ok: boolean } | null, now: number): boolean {
  if (last === null) return true;
  const age = now - Date.parse(last.at);
  return age >= (last.ok ? DAY_MS : RETRY_MS);
}

/* ───────────────────────── 求关对象的回关状态 ───────────────────────── */

export type AskRow = {
  readonly person: string;
  readonly handle: string;
  readonly at: string;
  readonly followed?: 'ok' | 'already' | 'failed';
};

export type RelationNow = { readonly follows_me?: boolean; readonly i_follow?: boolean; readonly observed_at?: string };

export type RelationChangeRow = {
  readonly person: string;
  readonly observed_at: string;
  readonly prev_observed_at?: string;
  readonly from_follows_me?: boolean;
  readonly to_follows_me?: boolean;
  readonly from_i_follow?: boolean;
  readonly to_i_follow?: boolean;
  readonly source: string;
};

export type LastCheck = { readonly at: string; readonly caughtUp: boolean; readonly ok: boolean };

export type AskStatus = {
  readonly person: string;
  readonly handle: string;
  /** 第一次求关成功关注他的时间 */
  readonly askedAt: string;
  readonly askDays: number;
  /**
   * back       他关注了我
   * waiting    还没满 N 天
   * overdue    满 N 天,最近一次完整的查回关确认他没关注我 → 列给人决定
   * unconfirmed 满 N 天,但还没有一次「追上了」的查回关在求关之后 —— 不能说他没回关
   * dropped    我已经不关注他了(取关过)
   */
  readonly status: 'back' | 'waiting' | 'overdue' | 'unconfirmed' | 'dropped';
  /** 回关发生在哪段时间里(上次看到他还没关注 ~ 第一次看到他已关注);他求关前就关注我时为 undefined */
  readonly backBetween?: { readonly from?: string; readonly to: string };
  /** 求关前他就已经关注我了 */
  readonly alreadyBefore?: boolean;
};

/**
 * ⭐⭐ 每个求关对象现在什么状态。
 * ⚠️ 只算「关注那一步成了 / 本来就关注着」的求关;关注失败的那次不算求关成了。
 * ⚠️ 「没回关」必须有一次**追上了**的查回关、且在求关之后 —— 否则只是「没看到」,标 unconfirmed(不猜)。
 */
export function classifyAsks(input: {
  readonly asks: readonly AskRow[];
  readonly relations: ReadonlyMap<string, RelationNow>;
  readonly changes: readonly RelationChangeRow[];
  readonly lastCaughtUp?: string;
  readonly now: Date;
  readonly revisitDays: number;
}): AskStatus[] {
  const first = new Map<string, AskRow>();
  for (const a of input.asks) {
    if (a.followed !== 'ok' && a.followed !== 'already') continue;
    const cur = first.get(a.person);
    if (!cur || Date.parse(a.at) < Date.parse(cur.at)) first.set(a.person, a);
  }
  const out: AskStatus[] = [];
  for (const a of first.values()) {
    const rel = input.relations.get(a.person);
    const askedMs = Date.parse(a.at);
    const askDays = Math.floor((input.now.getTime() - askedMs) / 86_400_000);
    const base = { person: a.person, handle: a.handle, askedAt: a.at, askDays };
    if (rel?.follows_me === true) {
      /** 他变成关注我的那条变化;没有 from(首次记录)且已关注 = 第一次看到时就关注着 */
      const turned = input.changes
        .filter((c) => c.person === a.person && c.to_follows_me === true && c.from_follows_me !== true)
        .sort((x, y) => Date.parse(y.observed_at) - Date.parse(x.observed_at))[0];
      const before = turned !== undefined && Date.parse(turned.observed_at) <= askedMs;
      out.push({
        ...base, status: 'back',
        alreadyBefore: before || a.followed === 'already' && turned === undefined ? true : undefined,
        backBetween: turned && !before ? { from: turned.prev_observed_at, to: turned.observed_at } : undefined,
      });
      continue;
    }
    if (rel?.i_follow === false) { out.push({ ...base, status: 'dropped' }); continue; }
    if (askDays < input.revisitDays) { out.push({ ...base, status: 'waiting' }); continue; }
    const confirmed = input.lastCaughtUp !== undefined && Date.parse(input.lastCaughtUp) > askedMs;
    out.push({ ...base, status: confirmed ? 'overdue' : 'unconfirmed' });
  }
  return out.sort((x, y) => Date.parse(x.askedAt) - Date.parse(y.askedAt));
}

/* ───────────────────────── 人的互动时间线 ───────────────────────── */

export type TimelineEvent = {
  readonly at: string;
  /** 时间只知道一个范围时,from 是范围起点(at 是终点)*/
  readonly from?: string;
  readonly who: 'me' | 'him';
  readonly kind: 'ask' | 'like' | 'reply' | 'follow' | 'unfollow' | 'followed-me' | 'unfollowed-me' | 'mention' | 'quote' | 'retweet' | 'first-seen';
  readonly text: string;
  readonly detail?: string;
  readonly tweetId?: string;
};

export type ActionRow = { readonly at: string; readonly action: string; readonly result: string; readonly reason?: string; readonly detail?: string };
export type TweetRow = {
  readonly tweet_id: string;
  readonly created_at?: string;
  readonly text?: string;
  readonly author_rest_id?: string;
  readonly in_reply_to_user_id?: string;
  readonly mention_ids?: readonly string[];
  readonly quoted_author_id?: string;
  readonly retweet_of_author_id?: string;
};
export type AskDetailRow = AskRow & {
  readonly tweet_id: string; readonly tweet_text?: string; readonly reply_text?: string; readonly reply_id?: string;
  readonly liked?: string; readonly replied?: string; readonly failed_step?: string;
};

const short = (s: string | undefined, n = 80): string => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
const STEP: Record<string, string> = { ok: '✓', already: '·已', failed: '✗', unseen: '?' };

/**
 * ⭐⭐ 一个人一条线,从早到晚。数据来源只有库里已有的:求关记录 · 动作记录 · 关系变化 · 已采到的推文。
 * ⚠️ 他给我点赞、他看没看过我 —— 这些没有采集,不在线上(界面要说明)。
 * ⚠️ 关系变化的时间是**看到的时间**:回关写成「在上次看到 ~ 这次看到之间」,不假装精确。
 */
export function buildTimeline(input: {
  readonly me: string;
  readonly person: string;
  readonly asks: readonly AskDetailRow[];
  readonly actions: readonly ActionRow[];
  readonly changes: readonly RelationChangeRow[];
  readonly tweets: readonly TweetRow[];
}): TimelineEvent[] {
  const ev: TimelineEvent[] = [];
  const askReplyIds = new Set(input.asks.map((a) => a.reply_id).filter((x): x is string => !!x));
  for (const a of input.asks) {
    const steps = [`赞${STEP[a.liked ?? ''] ?? '—'}`, `留言${STEP[a.replied ?? ''] ?? '—'}`, `关注${STEP[a.followed ?? ''] ?? '—'}`].join(' ');
    ev.push({
      at: a.at, who: 'me', kind: 'ask', tweetId: a.tweet_id,
      text: `求关(${steps})${a.failed_step ? ` —— 停在${a.failed_step}` : ''}`,
      detail: [a.tweet_text ? `他的帖子「${short(a.tweet_text)}」` : '', a.reply_text ? `我留言「${short(a.reply_text)}」` : ''].filter(Boolean).join('\n'),
    });
  }
  /** 求关那几个动作已经在上面一条里了;动作记录里只补求关以外的(取关、关注队列 …) */
  for (const x of input.actions) {
    if ((x.reason ?? '').startsWith('求关')) continue;
    const kind = (['like', 'reply', 'follow', 'unfollow'] as const).find((k) => k === x.action);
    if (!kind) continue;
    const name = { like: '点赞', reply: '回复', follow: '关注', unfollow: '取关' }[kind];
    ev.push({ at: x.at, who: 'me', kind, text: `${name}${x.result === 'ok' ? '' : '(没成)'}`, detail: x.detail ?? x.reason });
  }
  for (const c of input.changes) {
    if (c.from_follows_me === undefined && c.from_i_follow === undefined) {
      const st = [c.to_follows_me === true ? '他关注我' : '他没关注我', c.to_i_follow === true ? '我关注他' : '我没关注他'].join(' · ');
      ev.push({ at: c.observed_at, who: 'him', kind: 'first-seen', text: `第一次记录关系:${st}`, detail: `来源 ${c.source}` });
      continue;
    }
    if (c.to_follows_me === true && c.from_follows_me !== true) {
      ev.push({ at: c.observed_at, from: c.prev_observed_at, who: 'him', kind: 'followed-me', text: '他关注了我', detail: `看到于 ${c.source}` });
    } else if (c.to_follows_me === false && c.from_follows_me === true) {
      ev.push({ at: c.observed_at, from: c.prev_observed_at, who: 'him', kind: 'unfollowed-me', text: '他取关了我', detail: `看到于 ${c.source}` });
    }
  }
  for (const t of input.tweets) {
    if (!t.created_at) continue;
    const mine = t.author_rest_id === input.me;
    const other = mine ? input.person : input.me;
    if (t.author_rest_id !== input.me && t.author_rest_id !== input.person) continue;
    if (mine && askReplyIds.has(t.tweet_id)) continue;
    const who = mine ? 'me' : 'him';
    const base = { at: t.created_at, who, tweetId: t.tweet_id, detail: short(t.text, 120) } as const;
    if (t.in_reply_to_user_id === other) ev.push({ ...base, kind: 'reply', text: mine ? '我回复了他' : '他回复了我' });
    else if (t.retweet_of_author_id === other) ev.push({ ...base, kind: 'retweet', text: mine ? '我转发了他' : '他转发了我' });
    else if (t.quoted_author_id === other) ev.push({ ...base, kind: 'quote', text: mine ? '我引用了他' : '他引用了我' });
    else if ((t.mention_ids ?? []).includes(other)) ev.push({ ...base, kind: 'mention', text: mine ? '我提到了他' : '他提到了我' });
  }
  return ev.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
