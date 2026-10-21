/**
 * ⭐⭐ 「这是哪个号看到的」+ 关系按号存(2026-10-16,蓝V互关 M0)—— 纯函数,离线可测
 *
 * 用户 10-16:「互相覆盖是很严重的问题哦,应该是分字段,判断起来简单吧?」
 * 认号方式用户选 A(10-16):**从 X 页面认**(左侧「个人资料」链接),不碰登录凭据;
 * 第一次认到某个号,开一次它的主页从载荷拿数字 id。
 *
 * ── ⚠️ 守着的几件事 ──
 * ① X 载荷里的 following / followed_by 是**看的那个号**的视角 —— 写关系必须知道是哪个号在看
 * ② 认不出号 / 号对不上 → **这批不写关系**,说清原因(fail loud),绝不猜、绝不写到别的号名下
 * ③ 号用数字 id(handle 会改:antsBTW → otun_myvpn)
 * ④ 旧观察不覆盖新观察:observed_at 放最后赋值(SET 按顺序执行)
 * ⑤ 自己与自己不建关系
 */

import { normalizeHandle } from '@shared/types/x-timeline-types';

/** 一个 ws 登录的号(x_ws_account 一行) */
export type WsAccount = {
  readonly wsId: string;
  readonly handle: string;
  /** 数字 id —— 还没认出来时为空 */
  readonly restId?: string;
  readonly detectedAt?: string;
};

/**
 * ⭐ 认号脚本(`x.whoAmI`)在页面上看到的东西 —— 两处页面标记各报各的,由这里判断。
 * ⚠️ 这两个 data-testid 是 X 的页面结构,**真机才验得出**;哪个没找到就如实是 undefined。
 */
export type WhoAmIRaw = {
  /** 左侧导航「个人资料」链接的 href(如 `/otun_myvpn`) */
  readonly profileHref?: string;
  /** 左下角账号切换按钮里的文字(含 `@otun_myvpn`) */
  readonly switcherText?: string;
  readonly why?: string;
};

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
/**
 * X 的系统路径 —— 长得像 handle 但不是人(`/i/flow/login`、`/home`…)。
 * ⚠️ 链接没指到个人主页时(未登录、页面改版)会落到这些上,认成名叫「i」的号就是写错号。
 */
const RESERVED = new Set(['i', 'home', 'explore', 'notifications', 'messages', 'settings', 'search', 'compose', 'login', 'logout', 'signup', 'tos', 'privacy']);

/**
 * ⭐ 从页面标记里认出登录的 handle。
 * ⚠️ 两处都有时必须一致;不一致就报错,不挑一个(那正是「我是谁」漂移的老坑)。
 */
export function parseWhoAmI(raw: WhoAmIRaw | null | undefined): { readonly handle: string } | { readonly error: string } {
  if (!raw) return { error: '认号脚本没有返回' };
  const fromHref = (() => {
    const seg = (raw.profileHref ?? '').replace(/^https?:\/\/[^/]+/, '').split(/[/?#]/).filter((s) => s !== '')[0];
    return seg !== undefined && HANDLE_RE.test(seg) && !RESERVED.has(seg.toLowerCase()) ? normalizeHandle(seg) : undefined;
  })();
  const fromSwitcher = (() => {
    const m = /@([A-Za-z0-9_]{1,15})\b/.exec(raw.switcherText ?? '');
    return m ? normalizeHandle(m[1]) : undefined;
  })();
  if (fromHref && fromSwitcher && fromHref !== fromSwitcher) {
    return { error: `页面上两处登录号不一致:个人资料链接 @${fromHref} / 账号按钮 @${fromSwitcher}` };
  }
  const h = fromHref ?? fromSwitcher;
  if (!h) return { error: `页面上找不到登录号(个人资料链接与账号按钮都没有)${raw.why ? `:${raw.why}` : ''}` };
  return { handle: h };
}

/**
 * ⭐⭐ 这次写关系用哪个号 —— 库里登记的号 vs 页面此刻登录的号。
 * · 页面认不出 → 不写(error)
 * · 库里没登记 / 登记的 handle 与页面不同 / 还没数字 id → 不写,需要(重新)认号(needIdentify)
 */
export type AccountDecision =
  | { readonly kind: 'ok'; readonly restId: string; readonly handle: string }
  | { readonly kind: 'needIdentify'; readonly handle: string; readonly reason: string }
  | { readonly kind: 'error'; readonly reason: string };

export function decideAccount(
  row: WsAccount | null | undefined, seen: { readonly handle: string } | { readonly error: string },
): AccountDecision {
  if ('error' in seen) return { kind: 'error', reason: seen.error };
  if (!row) return { kind: 'needIdentify', handle: seen.handle, reason: `还没认过这个号(页面登录的是 @${seen.handle})` };
  if (row.handle !== seen.handle) {
    return { kind: 'needIdentify', handle: seen.handle, reason: `登录的号变了:库里记的是 @${row.handle},页面上是 @${seen.handle}` };
  }
  if (!row.restId) return { kind: 'needIdentify', handle: seen.handle, reason: `@${seen.handle} 的数字 id 还没拿到` };
  return { kind: 'ok', restId: row.restId, handle: row.handle };
}

/** 一条关系观察 —— 来自名单、推文作者、主页核对 */
export type RelationObservation = {
  readonly person: string;
  readonly iFollow?: boolean;
  readonly followsMe?: boolean;
  readonly observedAt: string;
};

/**
 * ⭐⭐ 写一条关系的 SQL(`RETURN BEFORE`:核对时要拿旧关系算变化)。
 * 返回 null = 不用写(两个标记都不知道 / 自己对自己)。
 * ⚠️ 只写有值的标记 —— 载荷没带的不冲成 NONE。
 * ⚠️ 不用 `UPSERT ... WHERE`(没匹配什么都不写也不报错)。
 */
export function buildRelationUpsert(
  account: string, o: RelationObservation,
): { readonly sql: string; readonly vars: Record<string, unknown> } | null {
  if (account === '' || o.person === '') throw new Error('[x.relation] 号或人的数字 id 为空');
  if (o.person === account) return null;
  if (o.iFollow === undefined && o.followsMe === undefined) return null;
  const NEWER = '(observed_at = NONE OR observed_at <= type::datetime($obs))';
  const when = (col: string, v: string): string => `${col} = IF ${NEWER} THEN ${v} ELSE ${col} END`;
  const sets = ['account = $account', 'person = $person'];
  const vars: Record<string, unknown> = { account, person: o.person, obs: o.observedAt };
  if (o.iFollow !== undefined) { sets.push(when('i_follow', '$i_follow')); vars.i_follow = o.iFollow; }
  if (o.followsMe !== undefined) { sets.push(when('follows_me', '$follows_me')); vars.follows_me = o.followsMe; }
  /** ⚠️ 必须最后 —— 见 ④ */
  sets.push(when('observed_at', 'type::datetime($obs)'));
  return {
    sql: `UPSERT type::record('x_relation', [$account, $person]) SET ${sets.join(', ')} RETURN BEFORE;`,
    vars,
  };
}

/** 关系表那一行改之前的样子(`RETURN BEFORE`);null = 这个号以前没记过他 */
export type RelationRowBefore = {
  readonly i_follow?: boolean;
  readonly follows_me?: boolean;
  readonly observed_at?: unknown;
} | null;

/** SDK 给的 datetime 是 DateTime 类(有 toISOString),HTTP/测试里可能是字符串 */
function toMs(v: unknown): number {
  if (typeof v === 'string') return Date.parse(v);
  const f = v as { toISOString?: () => string } | undefined;
  return f?.toISOString ? Date.parse(f.toISOString()) : NaN;
}
const toIso = (v: unknown): string | undefined => {
  const ms = toMs(v);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
};

/**
 * ⭐⭐ 关系变了才记一条(2026-10-16,schema 1.2.28)—— 用户:「增加一个表，记录关系的变化的，不久没有这个问题啦?」
 * 「当前关系」在 x_relation(每个号对每个人一行);**变化**只追加进 x_relation_change,没变不写 → 记录量小。
 *
 * 返回 null = 不用记:
 * · 两个标记都不知道 / 自己对自己(与 buildRelationUpsert 同口径,那边也没写)
 * · 这次观察比库里旧(时间守卫让 upsert 什么都没改)
 * · 关系与之前一样
 * ⭐ 这个号**第一次**记到他(before = null)也记一条:那是基线(「从关系不明 → 看到的关系」)。
 * ⭐ prev_observed_at = 上一次看到旧关系的时间 → 变化发生在 (prev_observed_at, observed_at] 之间。
 */
export function buildRelationChange(
  account: string, before: RelationRowBefore, o: RelationObservation, source: string,
): { readonly sql: string; readonly vars: Record<string, unknown> } | null {
  if (o.person === account) return null;
  if (o.iFollow === undefined && o.followsMe === undefined) return null;
  const beforeAt = before ? toMs(before.observed_at) : NaN;
  if (!Number.isNaN(beforeAt) && beforeAt > Date.parse(o.observedAt)) return null;
  const fromI = before?.i_follow ?? undefined;
  const fromF = before?.follows_me ?? undefined;
  const toI = o.iFollow ?? fromI;
  const toF = o.followsMe ?? fromF;
  if (before !== null && fromI === toI && fromF === toF) return null;
  return {
    sql: `CREATE x_relation_change SET account = $account, person = $person,
      from_i_follow = $from_i, from_follows_me = $from_f, to_i_follow = $to_i, to_follows_me = $to_f,
      observed_at = type::datetime($obs),
      prev_observed_at = IF $prev != NONE THEN type::datetime($prev) ELSE NONE END,
      source = $source;`,
    /** ⚠️ 不知道就传 undefined(→ NONE),不传 null(option 字段传 null 全挂) */
    vars: {
      account, person: o.person, from_i: fromI, from_f: fromF, to_i: toI, to_f: toF,
      obs: o.observedAt, prev: before ? toIso(before.observed_at) : undefined, source,
    },
  };
}

/** 写关系的结果 —— 写没写、为什么没写,原样给调用方报出来 */
export type RelationWriteReport = {
  /** 这批是哪个号看到的;认不出就是 undefined */
  readonly account?: string;
  readonly written: number;
  /** 其中关系**变了**(含这个号第一次记到他)、记进 x_relation_change 的条数 */
  readonly changed: number;
  /** 整批没写关系的原因(认不出号 / 号变了)—— 有它就说明这批人的关系**没进库** */
  readonly skippedReason?: string;
  readonly failed: number;
  readonly firstFailure?: string;
};

/**
 * ⭐⭐ 读关系:把**当前号**的关系接到人表上 —— 用法 `SELECT … FROM ${PEOPLE_WITH_RELATION} WHERE i_follow = true …`。
 * 同名字段 i_follow / follows_me 会盖住人表上停用的旧字段(2026-10-16 临时库 3.0.4 实测:7100 人 ~40ms)。
 * ⚠️ 调用方必须给 `$acct`(号的数字 id);没有这个号的关系 → 两个标记都是 NONE(=关系不明)。
 */
const REL = "type::record('x_relation', [$acct, rest_id])";
/**
 * ⚠️ 排除我自己(2026-10-21 用户截图:「去求关怎么有"打墙的蚂蚁"呢?这是我自己呀?」)——
 * 自己也在人表里,和自己没有关系记录(两个标记都空),于是落进「关系不明」,Bio 写着「蓝V互关」又被当成求关候选。
 * 「人 + 我和他的关系」这张视图里本来就不该有我;改在这一处,人页 / 概览 / 候选 / 关系采集计数一起对。
 */
export const PEOPLE_WITH_RELATION =
  `(SELECT *, ${REL}.i_follow AS i_follow, ${REL}.follows_me AS follows_me FROM x_author WHERE rest_id != $acct)`;

/** 单个人(人卡)版本 —— `$rest_id` 是他的数字 id */
export const PERSON_WITH_RELATION =
  `(SELECT *, ${REL}.i_follow AS i_follow, ${REL}.follows_me AS follows_me FROM type::record('x_author', $rest_id))`;
