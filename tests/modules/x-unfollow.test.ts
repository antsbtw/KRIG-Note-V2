/**
 * ⭐⭐ 取关(2026-10-10)—— 用户取消了「不由程序点按钮」的红线:
 * 「取消这个红线，我的未来是要AI接管不少工作的」;每日上限「这个作为变量，由我自己设定」。
 * ⚠️ 红线取消后挡封号风险的只剩这些保护 —— 本文件把它们钉住。
 * 页面上的点击是否真的点对,只有真机验得出(脚本自己的逻辑在 x-dom-scripts.test 里用假页面跑过)。
 */
import { describe, it, expect } from 'vitest';
import { capOfOp, ipcHandles, readCapBlock } from './_x-ipc-wiring';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SETTING_DEFS, mergeSettings, validateSetting, unfollowGate, followGate, localDayStart,
} from '@modules/x/x-ops-settings';

const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');
const S = {
  'unfollow.daily_cap': 50, 'unfollow.min_gap_sec': 20, 'collect.live_page_cap': 30,
  // ⚠️ 后台采集节奏(bg.*)2026-10-20 起不是设置了,由 x_pace 按限流自调
  // 2026-10-16 蓝V互关 M4:关注的节奏与回访天数
  'follow.daily_cap': 400, 'follow.min_gap_sec': 60, 'follow.jitter_sec': 30, 'follow.revisit_days': 7,
  // 2026-10-17 求关:连续 15 个歇 15 分钟(用户选的);准备时采他主页 2 页
  'follow.burst_size': 15, 'follow.burst_rest_min': 15, 'ask.collect_pages': 2,
  // 2026-10-19 第 4 阶段查回关:连续 30 个老关注者算追上(沿用 09-19 快速增量阈值);一次最多 20 页
  'follow.check_known_run': 30, 'follow.check_max_pages': 20,
};

describe('设置', () => {
  it('⭐ 默认:每日上限 50(用户定的)、最小间隔 20 秒;库里没有就用默认', () => {
    expect(mergeSettings([]).settings).toEqual(S);
    expect(SETTING_DEFS.find((d) => d.key === 'unfollow.daily_cap')!.default).toBe(50);
  });
  it('⭐ 库里值无效 → 用默认并报出来(不静默)', () => {
    const r = mergeSettings([{ key: 'unfollow.daily_cap', setting_value: 'abc' }]);
    expect(r.settings['unfollow.daily_cap']).toBe(50);
    expect(r.problems).toHaveLength(1);
    expect(mergeSettings([{ key: 'unfollow.daily_cap', setting_value: 30 }]).settings['unfollow.daily_cap']).toBe(30);
  });
  it('⭐ 人改设置要校验:整数、范围、认识的键', () => {
    expect(validateSetting('unfollow.daily_cap', 30)).toBeNull();
    expect(validateSetting('unfollow.daily_cap', 2.5)).not.toBeNull();
    expect(validateSetting('unfollow.daily_cap', -1)).not.toBeNull();
    expect(validateSetting('unfollow.min_gap_sec', 1)).not.toBeNull();
    expect(validateSetting('nope', 1)).not.toBeNull();
  });
});

describe('⭐⭐⭐ 关注闸门(10-17 改:没有「两次最小间隔」,连续满 15 个歇 15 分钟)', () => {
  const now = new Date('2026-10-17T12:00:00Z');
  /** 每隔 1 分钟关一个,最新那个在 ago 分钟前 */
  const series = (n: number, ago: number): string[] =>
    Array.from({ length: n }, (_, i) => new Date(now.getTime() - (ago + i) * 60_000).toISOString());

  it('⭐ 用户 10-17:「x没有这个限制」—— 刚关完一个马上关下一个,放行', () => {
    expect(followGate(S, 2, [new Date(now.getTime() - 47_000).toISOString()], now).allowed).toBe(true);
    expect(followGate(S, 14, series(14, 0), now).allowed).toBe(true);
  });

  it('⭐⭐ 连续关满 15 个 → 歇 15 分钟,给出还要等几秒;提示说清是我们的设置', () => {
    const g = followGate(S, 15, series(15, 2), now);
    expect(g.allowed).toBe(false);
    expect(g.waitSec).toBe(13 * 60);
    expect(g.reason).toContain('连续关注 15 个');
    expect(g.reason).toContain('我们的设置');
    expect(g.reason).not.toContain('可改');
  });

  it('歇够了 → 连续数清零,放行;中间断过 15 分钟的不算连续', () => {
    expect(followGate(S, 15, series(15, 15), now).allowed).toBe(true);
    const broken = [...series(10, 0), ...series(5, 40)];
    expect(followGate(S, 15, broken, now).allowed).toBe(true);
  });

  it('每日到 400(X 公布的每天关注上限)才提醒;默认是 400 不是 30(用户 10-22 目标每天新增 200~300 互关)', () => {
    expect(followGate(S, 400, [], now)).toMatchObject({ allowed: false });
    expect(followGate(S, 30, [], now).allowed).toBe(true);
    expect(SETTING_DEFS.find((d) => d.key === 'follow.daily_cap')!.default).toBe(400);
  });
});

describe('⭐⭐⭐ 取关闸门', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  it('到了每日上限 → allowed=false 带提醒(调用方只提醒不拦,用户 10-21)', () => {
    const g = unfollowGate(S, 50, undefined, now);
    expect(g.allowed).toBe(false);
    expect(g.reason).toContain('平时的量 50');
    expect(unfollowGate({ ...S, 'unfollow.daily_cap': 60 }, 50, undefined, now).allowed).toBe(true);
  });
  it('离上次太近就不许,并给出还要等几秒', () => {
    const g = unfollowGate(S, 3, '2026-10-10T11:59:50Z', now);
    expect(g.allowed).toBe(false);
    expect(g.waitSec).toBe(10);
    expect(unfollowGate(S, 3, '2026-10-10T11:59:30Z', now).allowed).toBe(true);
  });
  it('「今天」按本地时区算', () => {
    const d = localDayStart(new Date(2026, 9, 10, 23, 30));
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 10, 0]);
  });
});

describe('⭐⭐⭐ 取关流程(页面)', () => {
  const PAGE = read('src/modules/x/XOpsPeople.tsx');
  const fn = PAGE.slice(PAGE.indexOf('const unfollow = useCallback'), PAGE.indexOf('/** 单击:选中'));
  /** ⭐ 2026-10-19 取关核心抽到 x-unfollow-run.ts(运营人卡 + 任务页「满 N 天没回关」共用一份) */
  const RUN = read('src/modules/x/x-unfollow-run.ts');
  const core = RUN.slice(RUN.indexOf('export async function unfollowOnce'), RUN.indexOf('export type VerifyOutcome'));

  it('顺序:暂停检查 → 调共用取关 → 核对;共用取关里:闸门 → 占住网页 → 去主页 → 点 → 记录', () => {
    expect(fn.length).toBeGreaterThan(600);
    expect(core.length).toBeGreaterThan(1200);
    const at = (src: string, s: string): number => { const i = src.indexOf(s); expect(i, `找不到 ${s}`).toBeGreaterThan(-1); return i; };
    const page = ['if (unfollowPaused !== null)', 'await unfollowOnce(', 'await runVerify(p);'].map((x) => at(fn, x));
    expect(page).toEqual([...page].sort((a, b) => a - b));
    const order = [
      "op: 'unfollowGate'",
      'gate.allowed ? undefined : gate.reason',
      'await acquireXPage(wcId, busyLabel)',
      "op: 'goto'",
      'scriptId: X_SCRIPTS.unfollow',
      "op: 'logAction'",
    ].map((x) => at(core, x));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('⭐⭐ 成功失败都留记录;不成功(且不是「本来就没关注」)就暂停,要人点恢复', () => {
    expect(core).toMatch(/result: result\.done \? 'ok' : 'failed'/);
    expect(fn).toMatch(/\} else \{\s*\/\*\*[^*]*\*\/\s*setUnfollowPaused\(/);
    expect(PAGE).toMatch(/onClick=\{\(\) => \{ setUnfollowPaused\(null\);/);
  });

  it('⭐⭐ 取关期间占住网页(主进程的锁),拿不到就不动;结束(含出错)一定放掉', () => {
    expect(core).toMatch(/const lock = await acquireXPage\(wcId, busyLabel\);\s*if \(!lock\.ok\) return \{ blocked:/);
    expect(core).toMatch(/\} finally \{\s*await releaseXPage\(lock\.token\);/);
  });

  it('⭐ 只有「我关注他」的人才出现取关入口', () => {
    expect(PAGE).toMatch(/\{menu\.p\.i_follow === true && \(/);
    expect(PAGE).toMatch(/\{p\.i_follow === true && \(\s*<button type="button" style=\{S\.btn\} disabled=\{unfollowing\} onClick=\{\(\) => onUnfollow\(p\)\}/);
  });

  it('⭐ 接线:设置 / 闸门 / 记录三个 op 契约有、handler 有;迁移登记了', () => {
    const TYPES = read('src/modules/x/x-data-types.ts');
    const IPC = read('src/modules/x/x-data-ipc.ts');
    for (const op of ['opsSettings', 'setOpsSetting', 'unfollowGate', 'logAction']) {
      expect(TYPES).toMatch(new RegExp(`op: '${op}'`));
      expect(ipcHandles(IPC, op), op).toBe(true);
    }
    expect(read('src/storage/migrations/x-runner.ts')).toMatch(/version: '1\.2\.24'[\s\S]{0,200}up: x_migration_1_2_24/);
  });

  it('⚠️ 设置表字段不叫 value(SurrealQL 关键字,临时库实测 parse error)', () => {
    const ddl = read('src/storage/surreal/x-schema.ts');
    const block = ddl.slice(ddl.indexOf('const X_SCHEMA_1_2_24'), ddl.indexOf('`;', ddl.indexOf('const X_SCHEMA_1_2_24')));
    expect(block).toContain('setting_value ON x_setting');
    expect(block).not.toMatch(/FIELD IF NOT EXISTS value\b/);
  });
});
