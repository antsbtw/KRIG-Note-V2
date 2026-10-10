/**
 * ⭐⭐ 取关(2026-10-10)—— 用户取消了「不由程序点按钮」的红线:
 * 「取消这个红线，我的未来是要AI接管不少工作的」;每日上限「这个作为变量，由我自己设定」。
 * ⚠️ 红线取消后挡封号风险的只剩这些保护 —— 本文件把它们钉住。
 * 页面上的点击是否真的点对,只有真机验得出(脚本自己的逻辑在 x-dom-scripts.test 里用假页面跑过)。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SETTING_DEFS, mergeSettings, validateSetting, unfollowGate, localDayStart,
} from '@modules/x/x-ops-settings';

const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');
const S = { 'unfollow.daily_cap': 50, 'unfollow.min_gap_sec': 20 };

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

describe('⭐⭐⭐ 取关闸门', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  it('到了每日上限就不许,并说清楚(可在设置里改)', () => {
    const g = unfollowGate(S, 50, undefined, now);
    expect(g.allowed).toBe(false);
    expect(g.reason).toContain('上限 50');
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

  it('顺序:暂停检查 → 忙检查 → 闸门 → 去主页 → 点 → 记录 → 核对', () => {
    expect(fn.length).toBeGreaterThan(1500);
    const at = (s: string): number => { const i = fn.indexOf(s); expect(i, `找不到 ${s}`).toBeGreaterThan(-1); return i; };
    const order = [
      'if (unfollowPaused !== null)',
      'getXHostBusy(wcId)',
      "op: 'unfollowGate'",
      'if (!gv.allowed)',
      "op: 'goto'",
      'scriptId: X_SCRIPTS.unfollow',
      "op: 'logAction'",
      'await runVerify(p);',
    ].map(at);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('⭐⭐ 成功失败都留记录;不成功(且不是「本来就没关注」)就暂停,要人点恢复', () => {
    expect(fn).toMatch(/result: result\.done \? 'ok' : 'failed'/);
    expect(fn).toMatch(/\} else \{\s*setUnfollowPaused\(/);
    expect(PAGE).toMatch(/onClick=\{\(\) => \{ setUnfollowPaused\(null\);/);
  });

  it('⭐⭐ 取关期间登记忙,结束(含出错)一定清掉', () => {
    expect(fn).toMatch(/setXHostBusy\(wcId, UNFOLLOW_BUSY\)/);
    expect(fn).toMatch(/\} finally \{\s*setXHostBusy\(wcId, null\);/);
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
      expect(IPC).toMatch(new RegExp(`case '${op}':`));
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
