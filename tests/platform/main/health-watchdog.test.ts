/**
 * ⭐⭐ 运行黑匣子(2026-10-16)—— 用户:「在卡死后有记录…这样你就可以复盘哪里卡死了」「你自己记录,定期分析」
 *
 * 钉:① 看门狗源码真能在 Worker 里跑、主进程不报平安就记「卡住」、恢复记「卡了多久」
 *    (源码是字符串 —— 只扫源码看不出会不会执行,必须真跑)
 *    ② 源码无反斜杠(project-x-inject-template-escape)③ 上次运行的四种判定 ④ 过期清理 ⑤ 宿主起停接线
 */
import { describe, it, expect } from 'vitest';
import { Worker } from 'node:worker_threads';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WATCHDOG_SOURCE } from '@platform/main/diagnostics/health/watchdog-source';
import { judgePreviousSession, sweepHealth, type HealthEvent } from '@platform/main/diagnostics/health/health-log';

const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });
const readEvents = (dir: string): HealthEvent[] => readdirSync(dir).flatMap((f) =>
  readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as HealthEvent));

describe('⭐⭐⭐ 看门狗线程(真起 Worker)', () => {
  it('源码里没有反斜杠(字符串里的转义会被吃掉)', () => {
    expect(WATCHDOG_SOURCE.includes(String.fromCharCode(92))).toBe(false);
  });

  it('主进程不报平安 → 记「卡住」+「还卡着」;恢复 → 记「恢复了、卡了多久」', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'krig-health-'));
    const w = new Worker(WATCHDOG_SOURCE, { eval: true, workerData: { dir, session: 's1', hangMs: 300, checkMs: 30, stillMs: 250 } });
    try {
      for (let i = 0; i < 5; i += 1) { w.postMessage({ type: 'beat' }); await sleep(40); }
      w.postMessage({ type: 'sample', data: { uptimeSec: 9, probes: { x: 1 } } });
      // 「卡住」:不再报平安
      await sleep(900);
      w.postMessage({ type: 'beat' });
      await sleep(80);
      const ev = readEvents(dir);
      const hang = ev.find((e) => e.event === 'main-hang');
      expect(hang, '卡住没记下来').toBeDefined();
      expect(hang!.session).toBe('s1');
      expect(hang!.silentMs as number).toBeGreaterThan(300);
      expect((hang!.lastSample as { uptimeSec: number }).uptimeSec, '卡住前最后一次体检要随记录写出').toBe(9);
      expect(ev.some((e) => e.event === 'main-still-hung'), '长时间卡住要补「还卡着」').toBe(true);
      const rec = ev.find((e) => e.event === 'main-recovered');
      expect(rec, '恢复没记下来').toBeDefined();
      expect(rec!.hungMs as number).toBeGreaterThan(800);
      expect(ev.filter((e) => e.event === 'main-hang')).toHaveLength(1);
    } finally {
      await w.terminate();
    }
  });

  it('一直报平安 → 什么都不写(不刷屏)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'krig-health-'));
    const w = new Worker(WATCHDOG_SOURCE, { eval: true, workerData: { dir, session: 's2', hangMs: 200, checkMs: 30, stillMs: 200 } });
    try {
      for (let i = 0; i < 15; i += 1) { w.postMessage({ type: 'beat' }); await sleep(40); }
      expect(existsSync(dir) ? readEvents(dir) : []).toEqual([]);
    } finally {
      await w.terminate();
    }
  });
});

describe('⭐⭐ 上次运行是怎么结束的', () => {
  const e = (event: string, ts: number, session: string, extra: Record<string, unknown> = {}): HealthEvent => ({ event, ts, session, ...extra });
  it('没有记录 → none', () => {
    expect(judgePreviousSession([e('session-start', 1, 'now')], 'now').kind).toBe('none');
  });
  it('有头有尾 → clean', () => {
    expect(judgePreviousSession([e('session-start', 1, 'a'), e('sample', 2, 'a'), e('session-end', 3, 'a'), e('session-start', 4, 'now')], 'now'))
      .toEqual({ kind: 'clean', session: 'a', endedAt: 3 });
  });
  it('⭐ 卡住后没恢复就没了 → hung-then-killed(带卡住时刻与最后一次体检)', () => {
    expect(judgePreviousSession([e('session-start', 1, 'a'), e('sample', 2, 'a'), e('main-hang', 5, 'a'), e('main-still-hung', 9, 'a')], 'now'))
      .toEqual({ kind: 'hung-then-killed', session: 'a', hangAt: 5, lastSampleAt: 2 });
  });
  it('卡过但恢复了、之后没正常结束 → unclean(不是卡死)', () => {
    expect(judgePreviousSession([e('session-start', 1, 'a'), e('main-hang', 5, 'a'), e('main-recovered', 7, 'a'), e('sample', 8, 'a')], 'now'))
      .toEqual({ kind: 'unclean', session: 'a', lastSeenAt: 8 });
  });
  it('只看最近一次运行', () => {
    expect(judgePreviousSession([e('session-start', 1, 'old'), e('main-hang', 2, 'old'), e('session-start', 3, 'a'), e('session-end', 4, 'a')], 'now').kind).toBe('clean');
  });
});

describe('过期清理 + 宿主接线', () => {
  it('超过 14 天的文件删掉,其余留着', () => {
    const dir = mkdtempSync(join(tmpdir(), 'krig-health-'));
    for (const d of ['2026-09-01', '2026-10-10', '2026-10-16']) writeFileSync(join(dir, `${d}.jsonl`), '');
    writeFileSync(join(dir, 'notes.txt'), '');
    expect(sweepHealth(dir, Date.parse('2026-10-16T12:00:00Z'))).toBe(1);
    expect(readdirSync(dir).sort()).toEqual(['2026-10-10.jsonl', '2026-10-16.jsonl', 'notes.txt']);
  });

  it('⭐ 宿主启动时起、before-quit 里停(常驻 timer + worker 铁律)', () => {
    const src = readFileSync(join(process.cwd(), 'src/platform/main/index.ts'), 'utf8');
    const quit = src.slice(src.indexOf("app.on('before-quit'"), src.indexOf("app.on('before-quit'") + 600);
    expect(quit.length).toBeGreaterThan(100);
    expect(quit).toMatch(/stopHealthMonitor\(\);/);
    expect(src).toMatch(/^\s*startHealthMonitor\(\);/m);
  });
});

describe('⭐ previous-session 那一行不许盖掉本次 session', () => {
  it('判定结果放在 previous 字段里(源码钉:不摊平)', () => {
    const src = readFileSync(join(process.cwd(), 'src/platform/main/diagnostics/health/health-monitor.ts'), 'utf8');
    expect(src).toMatch(/rec\(\{ event: 'previous-session', previous: prev \}\);/);
    expect(src).not.toMatch(/event: 'previous-session', \.\.\.prev/);
  });
});
