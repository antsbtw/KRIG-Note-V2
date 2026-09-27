/**
 * 账号画像采集 —— 打开某人主页,截获 `UserByScreenName` 载荷落库。
 *
 * ⭐ 起因(2026-09-06):用户要求回复时先判断「这人是真实活跃用户还是推广者」。
 * 我查到 `x_author` 只有 36 行、粉丝数字段全空,就断言「只能靠正文推断」——
 * **那是把「库里没有」当成了「拿不到」**。用户指正:
 *   「你的逻辑限制在现有数据,而不是去挖掘事实。可以构建提取函数,
 *     让 Gemma4 去点击提取呀。我们所有的基础设施都具备了。」
 *
 * 他是对的。能力勘查 §2.4 早已实测记录 `UserByScreenName` 自带:
 *   core.created_at(账号年龄)/ relationship_counts(粉丝·关注)/
 *   tweet_counts / action_counts.favorites_count / profile_bio.description /
 *   is_blue_verified / relationship_perspectives(我与此人的关系,零额外请求)
 * `saveAuthorCounts()` 与 schema 字段也早就写好了 —— **全仓只是没有一处调用**。
 * 基础设施齐备,缺的只是这根接线。
 *
 * 手法与 x-timeline-harvester 同源:CDP attach → 截 GraphQL 响应 → 解析。
 * 不做 DOM 抓取:载荷是权威结构,DOM 易变(勘查 §2.1)。
 */

import { resolveXWebContents } from './x-webcontents';
import { captureXPayloads } from './x-net-capture';
import { saveAuthorCounts, type AuthorCounts } from '../db/x-author-repo';
import { normalizeHandle } from '@shared/types/x-timeline-types';

/** 从载荷里挖出来的画像 —— 比 AuthorCounts 多几项判断「是谁」要用的 */
export interface AuthorProfile extends AuthorCounts {
  handle: string;
  displayName?: string;
  bio?: string;
  location?: string;
  website?: string;
  isBlueVerified?: boolean;
  /** 我与此人的关系(载荷自带,零额外请求) */
  iFollow?: boolean;
  followsMe?: boolean;
  blocking?: boolean;
}

/**
 * 深搜载荷里的 user 结果对象。
 *
 * ⚠️ 不写死路径(`data.user.result`):X 的响应外层结构变过好几次,
 * 写死路径会在改版后**静默取不到**(返回 undefined 而不报错)。
 * 改为按特征找:带 `legacy` 或 `core` 且含 screen_name 的对象。
 */
function findUserResult(node: unknown, depth = 0): Record<string, unknown> | null {
  if (!node || typeof node !== 'object' || depth > 8) return null;
  const o = node as Record<string, unknown>;
  const core = o.core as Record<string, unknown> | undefined;
  const legacy = o.legacy as Record<string, unknown> | undefined;
  const hasName = typeof core?.screen_name === 'string' || typeof legacy?.screen_name === 'string';
  if (hasName && (o.rest_id || o.id_str || legacy || core)) return o;
  for (const v of Object.values(o)) {
    const hit = findUserResult(v, depth + 1);
    if (hit) return hit;
  }
  return null;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** 把 UserByScreenName 结果对象解析成画像。字段在新旧两种形态下都试一遍。 */
export function parseUserResult(result: Record<string, unknown>): AuthorProfile | null {
  const core = (result.core ?? {}) as Record<string, unknown>;
  const legacy = (result.legacy ?? {}) as Record<string, unknown>;
  const screenName = (core.screen_name ?? legacy.screen_name) as string | undefined;
  if (!screenName) return null;

  const relCounts = (result.relationship_counts ?? {}) as Record<string, unknown>;
  const tweetCounts = (result.tweet_counts ?? {}) as Record<string, unknown>;
  const actionCounts = (result.action_counts ?? {}) as Record<string, unknown>;
  const bio = (result.profile_bio ?? {}) as Record<string, unknown>;
  const persp = (result.relationship_perspectives ?? {}) as Record<string, unknown>;
  const verification = (result.verification ?? {}) as Record<string, unknown>;

  return {
    handle: normalizeHandle(screenName),
    displayName: (core.name ?? legacy.name) as string | undefined,
    // 新形态在 core/profile_bio,旧形态在 legacy —— 两边都认
    accountCreatedAt: (core.created_at ?? legacy.created_at) as string | undefined,
    followersCount: num(relCounts.followers) ?? num(legacy.followers_count),
    followingCount: num(relCounts.following) ?? num(legacy.friends_count),
    tweetCount: num(tweetCounts.tweets) ?? num(legacy.statuses_count),
    mediaCount: num(tweetCounts.media_tweets) ?? num(legacy.media_count),
    favouritesCount: num(actionCounts.favorites_count) ?? num(legacy.favourites_count),
    bio: (bio.description ?? legacy.description) as string | undefined,
    location: ((result.location as Record<string, unknown> | undefined)?.location
      ?? legacy.location) as string | undefined,
    website: (legacy.url ?? undefined) as string | undefined,
    isBlueVerified: result.is_blue_verified === true
      || verification.is_blue_verified === true,
    iFollow: persp.following === true || legacy.following === true,
    followsMe: persp.followed_by === true || legacy.followed_by === true,
    blocking: persp.blocking === true || legacy.blocking === true,
  };
}

/**
 * 打开 `x.com/<handle>` 并截获画像载荷。
 *
 * ⚠️ fail loud:超时/没截到就返回 error,**绝不返回一个空画像** ——
 * 空画像会被下游当成「这人没粉丝、刚注册」,比没有更糟。
 *
 * @param budgetMs 时间预算。画像是回复流程里的一环,不能让用户干等。
 */
export async function harvestAuthorProfile(
  handle: string,
  targetWcId?: number,
  budgetMs = 12_000,
): Promise<AuthorProfile | { error: string }> {
  const h = normalizeHandle(handle);
  if (!h) return { error: '空 handle' };

  const resolved = resolveXWebContents(targetWcId);
  if ('error' in resolved) return { error: resolved.error };
  const wc = resolved.wc;

  let profile: AuthorProfile | null = null;

  // ⭐ 步 6a:载荷捕获改走 web.net。
  // 迁移前这里是自己 attach + on('message') + getResponseBody,finally 里 detach ——
  // 而那个 detach 会在「本函数先 attach、别人后共用」时把别人一起掐掉
  // (见 x-net-capture.ts 的顺序依赖说明)。现在业务方**没有 detach 这个动作**。
  let channelFault: string | null = null;
  /**
   * 🔍 **一次性诊断**(2026-09-26,查「bio 采不到」)——
   * 现在的报错只说「没截到 UserByScreenName」,**没说截到了什么**。
   * 两种成因修法完全不同,而现在分不出来:
   *  · 一条载荷都没看见 → 通道/导航的问题
   *  · 看见别的但没有 UserByScreenName → X 改了接口名(像 followers 那次)
   * ⚠️ 定位后删掉。
   */
  const seenOps: string[] = [];
  const diagUnsub = captureXPayloads(wc, {
    urlIncludes: ['/i/api/graphql/'],
    onPayload: ({ url }) => {
      const op = url.match(/\/graphql\/[^/]+\/(\w+)/)?.[1] ?? url.slice(0, 60);
      if (!seenOps.includes(op)) seenOps.push(op);
    },
  });
  const unsubscribe = captureXPayloads(wc, {
    urlIncludes: ['/i/api/graphql/', 'UserByScreenName'],
    onPayload: ({ body }) => {
      if (profile) return;
      try {
        const found = findUserResult(JSON.parse(body));
        if (found) profile = parseUserResult(found);
      } catch { /* 非 JSON,忽略 */ }
    },
    // 旧实现在通道故障时是**静默**的 —— 现在记下来,超时后能说清是"没截到"还是"通道坏了"
    onChannelFault: (reason) => { channelFault ??= reason; },
  });

  try {
    wc.loadURL(`https://x.com/${h}`);
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline && !profile) {
      await new Promise((r) => setTimeout(r, 250));
    }
  } finally {
    // ⭐ 只退订,不 detach —— 通道由底座独占,别的模块不受影响
    unsubscribe();
    diagUnsub();
  }
  /** 🔍 诊断:这 12 秒里到底看见了哪些 GraphQL 接口 */
  console.log(`[🔍profile] @${h} 期间看见的接口(${seenOps.length}):`,
    seenOps.join(', ') || '(一条都没有)');

  if (!profile) {
    return {
      error: channelFault
        // ⚠️ 通道坏了和"没截到"是两回事,旧实现分不出来 —— 现在分得出
        ? `未截获 @${h} 的账号载荷:CDP 通道故障 —— ${channelFault}`
        /** 🔍 把看见的接口一并报出来 —— 「没截到」与「截到了别的」是两回事 */
        : `未截获 @${h} 的账号载荷(${budgetMs}ms 内)`
          + (seenOps.length > 0
            ? ` —— 期间看见了 ${seenOps.length} 个接口:${seenOps.slice(0, 6).join('、')}`
            : ' —— **期间一条 GraphQL 载荷都没看见**(导航或通道的问题)'),
    };
  }
  // 关系视角一并落库 —— 载荷自带、零额外请求,但此前只在内存里没存
  await saveAuthorCounts(h, {
    ...(profile as AuthorProfile),
    xBlocking: (profile as AuthorProfile).blocking,
  });
  return profile;
}

/** 画像新鲜度:超过这个时长就该重采(粉丝数会变) */
export const PROFILE_STALE_HOURS = 24 * 7;
