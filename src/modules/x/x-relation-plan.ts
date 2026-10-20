/**
 * ⭐⭐ 关系采集:读现状 → 比对库 → 每个名单定策略(纯函数,2026-10-20)
 *
 * 用户 10-20:「在任务中添加一个"关系采集"这样的完整任务吧,具体要求是:1、先读取用户的bio,了解现状,
 *  followers/following/verified followers;2、比对库中的差距;制定采集策略,然后自动采集,并显示进度。」
 *
 * 策略(每个名单各自定,依据都写进 why,界面原样给人看):
 *  · X 显示 0 人 → 跳过
 *  · 库里没有 → 从头采全(full)
 *  · 库里比 X 多出一截 → 有人走了;增量只看得见新来的、看不见走的 → 全量对一遍(full)
 *  · 其余 → 从第一页增量采到追上(incremental):followers / following 按关注时间倒序,新来的都在最前(09-19 真快照证过)
 *  · 蓝V关注者:X 不显示总数 → 库里没有就采全,有就增量
 */
import type { BgListTab } from './x-bg-job';

export type RelMode = 'full' | 'incremental' | 'skip';
export type RelTabPlan = {
  /** X 主页上显示的人数;蓝V关注者 X 不给 → undefined */
  readonly xCount?: number;
  /** 开始前库里有几个 */
  readonly dbCount: number;
  readonly mode: RelMode;
  readonly why: string;
  /** 预计翻几页(一页约 50 人) */
  readonly estPages: number;
};
export type RelPlan = {
  readonly readAt: string;
  readonly target: { readonly restId: string; readonly handle: string };
  /** 采的是不是我自己的号(我的名单 → 写「他和我」的关系;别人的 → 记「谁在谁的名单里」) */
  readonly self: boolean;
  readonly tabs: Readonly<Record<BgListTab, RelTabPlan>>;
};
export type RelTabStats = {
  readonly seen: number;
  readonly fresh: number;
  readonly pages: number;
  /** 全量对完后标成「已不关注 / 已不在名单」的人数 */
  readonly reconciled?: number;
  readonly note?: string;
};

export const PER_PAGE = 50;
/** 增量追上的判据:连续这么多个库里已有的(与查回关同一个数) */
export const KNOWN_RUN = 30;

export function planTab(xCount: number | undefined, dbCount: number, self: boolean): RelTabPlan {
  if (xCount === 0) return { xCount, dbCount, mode: 'skip', why: 'X 显示 0 人', estPages: 0 };
  if (dbCount === 0) {
    return { xCount, dbCount, mode: 'full', why: '库里还没有 —— 从头采全', estPages: xCount === undefined ? 0 : Math.ceil(xCount / PER_PAGE) };
  }
  if (xCount === undefined) {
    return { xCount, dbCount, mode: 'incremental', why: `X 不显示总数,库里 ${dbCount} —— 从第一页增量采到追上`, estPages: Math.ceil(KNOWN_RUN / PER_PAGE) + 1 };
  }
  const tol = gapTolerance(xCount);
  if (dbCount > xCount + tol) {
    return {
      xCount, dbCount, mode: 'full',
      why: `库里比 X 多 ${dbCount - xCount} —— ${self ? '有人取关了' : '名单里有人走了'},增量看不见走的,全量对一遍`,
      estPages: Math.ceil(xCount / PER_PAGE),
    };
  }
  const need = Math.max(xCount - dbCount, 0);
  return {
    xCount, dbCount, mode: 'incremental',
    why: need > 0 ? `差 ${need} 人 —— 新来的在最前,从第一页增量采到追上` : '基本一致 —— 增量看一眼新来的',
    estPages: Math.ceil((need + KNOWN_RUN) / PER_PAGE),
  };
}

export function planRelation(input: {
  readonly target: { readonly restId: string; readonly handle: string };
  readonly self: boolean;
  readonly xCounts: { readonly followers?: number; readonly following?: number };
  readonly db: Readonly<Record<BgListTab, number>>;
  readonly now: Date;
}): RelPlan {
  return {
    readAt: input.now.toISOString(),
    target: input.target,
    self: input.self,
    tabs: {
      followers: planTab(input.xCounts.followers, input.db.followers, input.self),
      following: planTab(input.xCounts.following, input.db.following, input.self),
      verifiedFollowers: planTab(undefined, input.db.verifiedFollowers, input.self),
    },
  };
}

/** 「差多少算差出一截」—— 定策略和追上后复核用同一个口径 */
export function gapTolerance(xCount: number): number {
  return Math.max(20, Math.ceil(xCount * 0.02));
}

/**
 * ⭐⭐ 增量追上后复核(PDCA,2026-10-20 真机):追上了,但库里和 X 还差出一截 →
 * 差的不是新来的,是散在名单中间、以前没采到的人;增量从第一页往下永远找不到 → 升级成全量。
 * 返回升级原因;不用升级返回 undefined。
 */
export function escalateAfterCatchUp(tab: RelTabPlan, dbNow: number): string | undefined {
  if (tab.mode !== 'incremental' || tab.xCount === undefined) return undefined;
  const gap = tab.xCount - dbNow;
  if (gap <= gapTolerance(tab.xCount)) return undefined;
  return `增量追上了,可库里 ${dbNow} 还比 X 的 ${tab.xCount} 少 ${gap} —— 差的是名单中间以前没采到的人,改成全量`;
}

/**
 * ⭐ 全量对完能不能把「没再出现的」标成走了 —— 只有翻到 X 说到头、而且采到的人数够 X 显示的 98%。
 * 采不全就标 = 把还在的人误标成走了(本仓 2604→2244 卡住那种事就会变成一批假取关)。
 */
export function canReconcile(tab: RelTabPlan, seen: number, exhausted: boolean): { readonly ok: boolean; readonly why: string } {
  if (tab.mode !== 'full') return { ok: false, why: '不是全量,不对账' };
  if (!exhausted) return { ok: false, why: '没翻到底,不对账' };
  if (tab.xCount === undefined) return { ok: false, why: 'X 不给总数,不知道采全没有,不对账' };
  if (seen < tab.xCount * 0.98) return { ok: false, why: `只采到 ${seen} / ${tab.xCount},不到 98%,不标走了的(免得误标)` };
  return { ok: true, why: `采到 ${seen} / ${tab.xCount},翻到底了` };
}
