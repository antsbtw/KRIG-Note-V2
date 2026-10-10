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

export type UnfollowGate = {
  readonly allowed: boolean;
  readonly reason?: string;
  /** 还要等几秒(间隔没到时) */
  readonly waitSec?: number;
  readonly todayCount: number;
  readonly cap: number;
};

/**
 * ⭐⭐ 现在能不能取关 —— 每日上限 + 最小间隔。
 * 计数只算**成功**的取关(失败的不占额度,但失败会触发「异常即停」,见页面)。
 */
export function unfollowGate(
  s: OpsSettings, todayCount: number, lastAtIso: string | undefined, now: Date,
): UnfollowGate {
  const cap = s['unfollow.daily_cap'];
  const gap = s['unfollow.min_gap_sec'];
  if (todayCount >= cap) {
    return { allowed: false, reason: `今天已取关 ${todayCount} 个,到了上限 ${cap}(可在设置里改)`, todayCount, cap };
  }
  if (lastAtIso !== undefined) {
    const since = (now.getTime() - Date.parse(lastAtIso)) / 1000;
    if (since < gap) {
      const waitSec = Math.ceil(gap - since);
      return { allowed: false, reason: `离上次取关才 ${Math.floor(since)} 秒,最小间隔 ${gap} 秒`, waitSec, todayCount, cap };
    }
  }
  return { allowed: true, todayCount, cap };
}
