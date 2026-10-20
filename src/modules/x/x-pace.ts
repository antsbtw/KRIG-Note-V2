/**
 * ⭐⭐ 节奏自调 —— 纯判断(2026-10-20)
 *
 * 用户 10-20:「这些是配置项,没有必要用户做配置,而是AI执行这些任务时自我优化就可以了。根据限流出现的不同来调整这些参数。
 *  人参与进来,不是代表着这是一个石器时代的产品吗?」
 *
 * 每种接口(名单三种 / 推文时间线)各有一份节奏:两段间隔 + 每段翻几页。
 * · 撞到限流 → 当场放慢:间隔翻倍、页数减半(不把任务判失败,歇够了接着采)
 * · 已经慢到最慢还撞 → 举手(任务停下,说明白)—— 不无限硬撞
 * · 连续 3 段顺利、且最近一小时没撞过 → 加快一点:间隔 ×0.8、页数 +2
 * 起点取以前人填的默认值;记忆 project-x-user-list-coverage:Followers 约 50 次 / 15 分钟。
 */

export type PaceKey = 'list:followers' | 'list:following' | 'list:verifiedFollowers' | 'timeline';

export type PaceState = {
  readonly gapSec: number;
  readonly pages: number;
  readonly okStreak: number;
  readonly limitedAt?: string;
};

export const PACE_BOUNDS = { minGap: 60, maxGap: 3600, minPages: 2, maxPages: 30 } as const;

export function defaultPace(key: PaceKey): PaceState {
  return key === 'timeline' ? { gapSec: 120, pages: 10, okStreak: 0 } : { gapSec: 300, pages: 10, okStreak: 0 };
}

/** 一段跑完的结果里,哪些算「被限流」 */
export function isRateLimited(text: string | undefined): boolean {
  return /429|限流|Rate limit|rate limit/.test(text ?? '');
}

export type PaceDecision = {
  readonly next: PaceState;
  readonly event?: { readonly kind: 'slower' | 'faster'; readonly why: string };
  /** 已经最慢还被限流 —— 交给人 */
  readonly giveUp?: string;
};

const COOL_MS = 3600_000;

export function adjustPace(s: PaceState, outcome: 'ok' | 'limited', now: Date): PaceDecision {
  const B = PACE_BOUNDS;
  if (outcome === 'limited') {
    if (s.gapSec >= B.maxGap && s.pages <= B.minPages) {
      return {
        next: { ...s, okStreak: 0, limitedAt: now.toISOString() },
        giveUp: `已经放到最慢(每 ${Math.round(s.gapSec / 60)} 分钟 ${s.pages} 页)还被限流 —— 先停下,可能是号被限制了,需要人看一眼`,
      };
    }
    const next = { gapSec: Math.min(s.gapSec * 2, B.maxGap), pages: Math.max(Math.floor(s.pages / 2), B.minPages), okStreak: 0, limitedAt: now.toISOString() };
    return { next, event: { kind: 'slower', why: '撞到限流 —— 间隔翻倍、每段页数减半' } };
  }
  const streak = s.okStreak + 1;
  const recentlyLimited = s.limitedAt !== undefined && now.getTime() - Date.parse(s.limitedAt) < COOL_MS;
  const atFastest = s.gapSec <= B.minGap && s.pages >= B.maxPages;
  if (streak >= 3 && !recentlyLimited && !atFastest) {
    const next = { ...s, gapSec: Math.max(Math.round(s.gapSec * 0.8), B.minGap), pages: Math.min(s.pages + 2, B.maxPages), okStreak: 0 };
    return { next, event: { kind: 'faster', why: '连续 3 段顺利、一小时内没撞过限流 —— 加快一点' } };
  }
  return { next: { ...s, okStreak: streak } };
}
