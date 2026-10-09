/**
 * ⭐⭐ 打开某人主页时**顺手核对**他的资料(2026-10-09)—— 纯函数,离线可测
 *
 * 用户 2026-10-08/09 定的:
 * · 「选定右边的用户，左边页面弹出来，就把这个页面的数据再读取一次」
 * · 单击就**自动**核对(只监听页面本来就会发的请求,不额外请求 X)
 * · 核对出变化**直接更新库并提示**
 *
 * 数据来源:主页加载时 X 自己会请求 `UserByScreenName`,载荷里有这个人的完整资料
 * 与「我关注他 / 他关注我」。解析复用 `auditUserPayload`(它找 JSON 里所有用户对象)。
 *
 * ── ⚠️ 守着的几件事(与推文作者写人表同一套)──
 * ① 身份 = 数字 id;按 rest_id 写,不按 handle
 * ② 只写有值的字段 —— 载荷缺的不冲成 NONE
 * ③ 旧的观察不覆盖新的 —— fetched_at 放最后赋值(SET 按顺序执行)
 * ④ 人工字段 / 名单字段一个都不碰
 * ⑤ handle 变了,旧的进曾用名(只加不减)
 */

import { normalizeHandle } from '@shared/types/x-timeline-types';
import type { XUserRecord } from './x-user-audit';

/** ⭐ 主页资料那条接口 —— 站点知识,放在 X 模块 */
export const PROFILE_ENDPOINT = 'UserByScreenName';

/**
 * ⭐ 从解析出的用户里挑出**这个人自己**。
 * ⚠️ 载荷里可能还带别的用户对象(推荐、认证机构…)—— 优先按数字 id 对,其次按 handle。
 * 对不上返回 undefined,**不拿第一个凑数**。
 */
export function pickProfileUser(
  users: readonly XUserRecord[], handle: string, restId?: string,
): XUserRecord | undefined {
  if (restId) {
    const byId = users.find((u) => u.restId === restId);
    if (byId) return byId;
  }
  const h = normalizeHandle(handle);
  return users.find((u) => normalizeHandle(u.handle) === h);
}

const nonEmpty = (v: string | undefined): string | undefined => (v === undefined || v.trim() === '' ? undefined : v);

/** 载荷字段 → 表字段 —— 只有这些会被写(④) */
const FIELDS: ReadonlyArray<readonly [string, (r: XUserRecord) => unknown]> = [
  ['display_name', (r) => nonEmpty(r.name)],
  ['avatar', (r) => nonEmpty(r.avatar)],
  ['bio', (r) => nonEmpty(r.bio)],
  ['location', (r) => nonEmpty(r.location)],
  ['website', (r) => nonEmpty(r.website)],
  ['followers_count', (r) => r.followersCount],
  ['following_count', (r) => r.followingCount],
  ['tweet_count', (r) => r.statusesCount],
  ['media_count', (r) => r.mediaCount],
  ['is_blue_verified', (r) => r.isBlueVerified],
  ['is_verified', (r) => r.isVerified],
  ['is_protected', (r) => r.isProtected],
  ['i_follow', (r) => r.following],
  ['follows_me', (r) => r.followedBy],
];

/** 导出给守卫:核对写库可能碰到的全部字段 */
export const PERSON_REFRESH_FIELDS: readonly string[] = [
  'rest_id', 'handle', 'handle_history', 'account_created_at', 'fetched_at', ...FIELDS.map(([c]) => c),
];

/** X 的 created_at(`Fri Oct 04 12:00:00 +0000 2026`)→ ISO;解析不了就不写,不拿现在顶替 */
function toIso(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

export function buildPersonRefresh(
  r: XUserRecord, observedAt: string,
): { readonly sql: string; readonly vars: Record<string, unknown> } {
  const NEWER = '(fetched_at = NONE OR fetched_at <= type::datetime($obs))';
  const when = (col: string, v: string): string => `${col} = IF ${NEWER} THEN ${v} ELSE ${col} END`;
  const handle = normalizeHandle(r.handle);
  const vars: Record<string, unknown> = { rest_id: r.restId, handle, obs: observedAt };
  const sets = [
    'rest_id = $rest_id',
    /** ⑤ 先记曾用名(要用改之前的 handle),再改 handle */
    `handle_history = IF ${NEWER} AND handle != NONE AND handle != $handle
      THEN array::union(handle_history ?? [], [handle]) ELSE handle_history END`,
    when('handle', '$handle'),
  ];
  for (const [col, get] of FIELDS) {
    const v = get(r);
    if (v !== undefined) { sets.push(when(col, `$${col}`)); vars[col] = v; }
  }
  const created = toIso(r.createdAt);
  if (created !== undefined) {
    sets.push(when('account_created_at', 'type::datetime($created)'));
    vars.created = created;
  }
  /** ⚠️ 必须最后 —— 见 ③ */
  sets.push(when('fetched_at', 'type::datetime($obs)'));
  return {
    sql: `UPSERT type::record('x_author', $rest_id) SET ${sets.join(', ')} RETURN BEFORE;`,
    vars,
  };
}

/** 核对前的样子(RETURN BEFORE 拿到的) */
export type PersonBefore = {
  readonly handle?: string;
  readonly i_follow?: boolean;
  readonly follows_me?: boolean;
  readonly is_blue_verified?: boolean;
  readonly followers_count?: number;
  readonly following_count?: number;
  readonly fetched_at?: unknown;
} | null | undefined;

const relation = (iFollow?: boolean, followsMe?: boolean): string => {
  if (iFollow === true && followsMe === true) return '互关';
  if (iFollow === true) return '我关注·他没回关';
  if (followsMe === true) return '他关注·我没回关';
  if (iFollow === false && followsMe === false) return '互不关注';
  return '关系不明';
};

/**
 * ⭐ 核对出的变化 —— 给人看的。
 * ⚠️ 关系、handle、蓝V 算「变化」;粉丝数每天都在变,只在列出变化时**顺带**带上,不单独算一条变化。
 */
export function diffPerson(
  before: PersonBefore, r: XUserRecord, observedAt: string,
): { readonly isNew: boolean; readonly stale: boolean; readonly changes: string[] } {
  if (before === null || before === undefined) return { isNew: true, stale: false, changes: [] };
  /**
   * ⚠️ 这次观察比库里的旧 → SQL 什么都没写(③),这里也**不许报变化** ——
   * 2026-10-09 临时库实测:第一版照样报「互关 → 互不关注」,而库里根本没变。
   */
  const f = before.fetched_at as { toISOString?: () => string } | string | undefined;
  const beforeAt = typeof f === 'string' ? Date.parse(f) : f?.toISOString ? Date.parse(f.toISOString()) : NaN;
  if (!Number.isNaN(beforeAt) && beforeAt > Date.parse(observedAt)) {
    return { isNew: false, stale: true, changes: [] };
  }
  const changes: string[] = [];
  const iF = r.following ?? before.i_follow;
  const fM = r.followedBy ?? before.follows_me;
  const was = relation(before.i_follow, before.follows_me);
  const now = relation(iF, fM);
  if (was !== now) changes.push(`关系 ${was} → ${now}`);
  const h = normalizeHandle(r.handle);
  if (before.handle !== undefined && before.handle !== h) changes.push(`改名 @${before.handle} → @${h}`);
  if (r.isBlueVerified !== undefined && before.is_blue_verified !== undefined && r.isBlueVerified !== before.is_blue_verified) {
    changes.push(r.isBlueVerified ? '变成蓝V' : '不再是蓝V');
  }
  return { isNew: false, stale: false, changes };
}
