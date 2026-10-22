/**
 * ⭐⭐ 运营设置 + 取关闸门(2026-10-10)—— 纯函数,离线可测
 *
 * 用户 10-10:
 * · 「取消这个红线，我的未来是要AI接管不少工作的」(程序可以点按钮了)
 * · 取关的每日上限「这个作为变量，由我自己设定」
 *
 * ⚠️ 红线取消后,挡封号风险的只剩这些保护:节奏(每日上限 + 最小间隔)、异常即停、
 * 动作留痕、执行后核对。它们是 AI 接管的前提,不是可选项。
 */

/** 一个人可设定的变量 */
export type SettingDef = {
  readonly key: string;
  readonly label: string;
  readonly default: number;
  readonly min: number;
  readonly max: number;
  readonly unit: string;
};

export const SETTING_DEFS: readonly SettingDef[] = [
  /** 用户定的:默认 50,自己调 */
  { key: 'unfollow.daily_cap', label: '每日取关上限', default: 50, min: 0, max: 1000, unit: '个' },
  /** 我加的:两次取关的最小间隔(短时间大量取关是刷粉号的典型信号)—— 默认 20 秒,用户可改 */
  { key: 'unfollow.min_gap_sec', label: '两次取关最小间隔', default: 20, min: 5, max: 3600, unit: '秒' },
  /**
   * 当场采一个人的帖子/回复/转发时,每个标签页最多翻几页(2026-10-10)。
   * ⚠️ 真机:一天发 40–55 条的号,30 页只够约两周;一个月要约 60 页。用户可调。
   */
  { key: 'collect.live_page_cap', label: '当场采每页最多翻', default: 30, min: 1, max: 200, unit: '页' },
  /**
   * ⚠️ 后台采集的节奏(每段页数 / 两段间隔 / 名单两段间隔)2026-10-20 起不再是设置:
   * 由节奏自调(x-pace.ts / x_pace)按限流情况定 —— 用户:「这些是配置项,没有必要用户做配置,而是AI执行这些任务时自我优化就可以了。」
   */
  /**
   * ⭐ 关注(2026-10-16,蓝V互关 M4)—— 用户:「勾一批,程序按节奏慢慢关」;上限/间隔同取关,是人可调的变量。
   * 默认取保守(我的判断:X 对短时间大量关注比取关更敏感)。
   */
  { key: 'follow.daily_cap', label: '每日关注上限', default: 30, min: 0, max: 400, unit: '个' },
  /**
   * ⚠️ 只管**关注队列**(后台一个个关)的节奏;不是 X 的限制,求关卡(人一次点一个)不受它管。
   * 用户 10-17:「这个提示不对的,x没有这个限制,只是15个关注后需要等待一段时间」—— 原来闸门拿它拦求关,提示还说得像平台限制。
   */
  { key: 'follow.min_gap_sec', label: '关注队列:两次关注的间隔', default: 60, min: 10, max: 3600, unit: '秒' },
  /** 每次间隔再随机多等 0~N 秒 —— 定值本身也是指纹 */
  { key: 'follow.jitter_sec', label: '关注间隔随机加', default: 30, min: 0, max: 600, unit: '秒' },
  /** 关注满几天还没回关 → 进回访名单(用户 10-16:「回访 N 天」「正确」) */
  /**
   * ⭐ 连续关注满 N 个 → 歇 M 分钟(用户 10-17:「只是15个关注后需要等待一段时间」;歇多久用户选了「15 分钟」)。
   * 「连续」= 相邻两次成功关注隔不到 M 分钟;歇够 M 分钟,连续数自然清零。
   */
  { key: 'follow.burst_size', label: '连续关注几个后歇一会', default: 15, min: 1, max: 400, unit: '个' },
  { key: 'follow.burst_rest_min', label: '连续关注满后歇多久', default: 15, min: 1, max: 1440, unit: '分钟' },
  /**
   * ⭐ 求关准备时采他主页几页(用户 10-17:「既然有这个机会刷用户的主页,就应该跳转时采集一次这个推友的两页或多页最新的推文」)。
   * 选推文仍只看最近 10 条原创;多采的进库,是他的时间线。
   */
  { key: 'ask.collect_pages', label: '求关时采他主页几页', default: 2, min: 1, max: 10, unit: '页' },
  { key: 'follow.revisit_days', label: '关注后几天没回关算不回', default: 7, min: 1, max: 60, unit: '天' },
  /**
   * ⭐ 查回关(2026-10-19,第 4 阶段;用户选「每天自动一次」):从我的 followers 第一页往下翻,
   * 连续见到这么多个**原来就关注我**的人 = 追上上次了(followers 按关注时间倒序,新关注的在最前)。
   * 默认 30 沿用 09-19 快速增量的阈值(真快照复算过:新人连续排在最前、老人整体平移)。
   */
  { key: 'follow.check_known_run', label: '查回关:连续几个老关注者算追上', default: 30, min: 5, max: 500, unit: '个' },
  /** 一次最多翻几页(一页约 50 人)。Followers 端点约 50 次 / 15 分钟(记忆 project-x-user-list-coverage),20 页留足余量 */
  { key: 'follow.check_max_pages', label: '查回关:一次最多翻几页', default: 20, min: 1, max: 45, unit: '页' },
];

export type OpsSettings = Readonly<Record<string, number>>;

/** ⭐ 库里存的值 + 默认值合并;库里值越界或不是整数 → 用默认值,并报出来(不静默) */
export function mergeSettings(stored: ReadonlyArray<{ key: string; setting_value: unknown }>): {
  readonly settings: OpsSettings; readonly problems: string[];
} {
  const out: Record<string, number> = {};
  const problems: string[] = [];
  for (const d of SETTING_DEFS) {
    const row = stored.find((r) => r.key === d.key);
    const v = row?.setting_value;
    if (row === undefined) { out[d.key] = d.default; continue; }
    if (typeof v === 'number' && Number.isInteger(v) && v >= d.min && v <= d.max) out[d.key] = v;
    else { out[d.key] = d.default; problems.push(`${d.label} 库里的值 ${String(v)} 无效,用默认 ${d.default}`); }
  }
  return { settings: out, problems };
}

/** ⭐ 人改设置时校验 —— 不合法就拒绝并说为什么 */
export function validateSetting(key: string, value: unknown): string | null {
  const d = SETTING_DEFS.find((x) => x.key === key);
  if (d === undefined) return `不认识的设置 ${key}`;
  if (typeof value !== 'number' || !Number.isInteger(value)) return `${d.label}要是整数`;
  if (value < d.min || value > d.max) return `${d.label}要在 ${d.min}–${d.max}${d.unit} 之间`;
  return null;
}

/** ⭐ 本地「今天」的开始 —— 每日上限按人所在的时区算 */
export function localDayStart(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * ⭐⭐ 关注的量 —— 每日上限 + 连续满 N 个歇 M 分钟(只算成功的)。
 * @param recentDesc 最近几次成功关注的时间(新→旧,至少给 burst_size 条才判得出连续)
 * ⚠️ 这两条都是**我们自己的设置**,不是 X 的限制,提示里别说得像 X 的限制。
 * ⚠️⚠️ 用户 10-21:「你不要给工作乱约束呀,我的任务我自己控制,有问题提示就好了。」——
 *   人点的动作(求关卡 / 取关)allowed=false 也照做,只把 reason 当提醒显示;只有无人值守的关注队列拿 waitSec 来控节奏。
 */
export function followGate(s: OpsSettings, todayCount: number, recentDesc: readonly string[], now: Date): UnfollowGate {
  const cap = s['follow.daily_cap'];
  if (todayCount >= cap) {
    return { allowed: false, reason: `今天已关注 ${todayCount} 个,超过平时的量 ${cap}(我们的设置,不是 X 的限制)—— 留意 X 有没有提示限制`, todayCount, cap };
  }
  const size = s['follow.burst_size'];
  const restMs = s['follow.burst_rest_min'] * 60_000;
  const ts = recentDesc.map((x) => Date.parse(x)).filter((t) => Number.isFinite(t));
  if (ts.length > 0 && now.getTime() - ts[0] < restMs) {
    let streak = 1;
    while (streak < ts.length && ts[streak - 1] - ts[streak] < restMs) streak += 1;
    if (streak >= size) {
      const waitSec = Math.ceil((ts[0] + restMs - now.getTime()) / 1000);
      const until = new Date(ts[0] + restMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return { allowed: false, reason: `已连续关注 ${streak} 个,平时会歇 ${s['follow.burst_rest_min']} 分钟(约 ${until};我们的设置,不是 X 的限制)`, waitSec, todayCount, cap };
    }
  }
  return { allowed: true, todayCount, cap };
}

export type UnfollowGate = {
  readonly allowed: boolean;
  readonly reason?: string;
  /** 还要等几秒(间隔没到时) */
  readonly waitSec?: number;
  readonly todayCount: number;
  readonly cap: number;
};

/**
 * ⭐⭐ 取关的量 —— 每日上限 + 最小间隔。⚠️ 用户 10-21:只提醒不拦(见 followGate)。
 * 计数只算**成功**的取关(失败的不占额度,但失败会触发「异常即停」,见页面)。
 */
export function unfollowGate(
  s: OpsSettings, todayCount: number, lastAtIso: string | undefined, now: Date,
): UnfollowGate {
  const cap = s['unfollow.daily_cap'];
  const gap = s['unfollow.min_gap_sec'];
  if (todayCount >= cap) {
    return { allowed: false, reason: `今天已取关 ${todayCount} 个,超过平时的量 ${cap}(我们的设置,不是 X 的限制)`, todayCount, cap };
  }
  if (lastAtIso !== undefined) {
    const since = (now.getTime() - Date.parse(lastAtIso)) / 1000;
    if (since < gap) {
      const waitSec = Math.ceil(gap - since);
      return { allowed: false, reason: `离上次取关才 ${Math.floor(since)} 秒,平时间隔 ${gap} 秒(我们的设置)`, waitSec, todayCount, cap };
    }
  }
  return { allowed: true, todayCount, cap };
}
