/**
 * ⭐⭐ 日常诊断日志(2026-10-19)—— 用户:「AI必须有能力执行日常的诊断方式-- terminal log/devtools log」
 *
 * 钉:① 写入器按天分片、写失败不抛但响、恢复时报丢了几条
 *    ② 主进程 console 照常打终端 + 落盘;stop 还原**原来那个**函数
 *    ③ 网页日志带 wc / url / pageId;加载失败、限流丢弃都留痕
 *    ④ 30 天老化 ⑤ 读取工具的时间窗 / 筛选 / 坏行计数
 *    ⑥ ⭐ 端到端:注入一条网页报错 → 真跑 `scripts/logs.mjs` 读得出来且带 pageId(设计 §11 P1 验收)
 *    ⑦ 宿主接线:拿锁后立刻起、before-quit 最终分支里停
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WebContents } from 'electron';
import { DailyLogWriter, MAX_MSG_CHARS, sweepLogs } from '@platform/main/diagnostics/logs/log-file';
import { tapMainConsole } from '@platform/main/diagnostics/logs/main-console-tap';
import { MAX_PER_MIN, tapPageConsole } from '@platform/main/diagnostics/logs/page-console-tap';
import { bindPageHost, pageIdOfWebContents, unbindPageHost } from '@platform/main/web-capability/wiring/page-hosts';
import type { PageId } from '@platform/main/web-capability/page/types';
// @ts-expect-error —— 纯 JS 工具模块,无类型声明
import { filterRecords, formatRecord, parseDuration, parseTime, readStream } from '../../../scripts/lib/log-query.mjs';

const tmp = (): string => mkdtempSync(join(tmpdir(), 'krig-logs-'));
const lines = (file: string): Array<Record<string, unknown>> =>
  readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
const D1 = Date.parse('2026-10-19T10:00:00Z');

describe('① 写入器', () => {
  it('一行一条、按 UTC 日期换文件', () => {
    const dir = tmp();
    const w = new DailyLogWriter(dir, () => {});
    w.write({ ts: D1, msg: 'a' });
    w.write({ ts: D1 + 1, msg: 'b' });
    w.write({ ts: D1 + 86_400_000, msg: 'c' });
    w.close();
    expect(readdirSync(dir).sort()).toEqual(['2026-10-19.jsonl', '2026-10-20.jsonl']);
    expect(lines(join(dir, '2026-10-19.jsonl')).map((r) => r.msg)).toEqual(['a', 'b']);
    expect(lines(join(dir, '2026-10-20.jsonl')).map((r) => r.msg)).toEqual(['c']);
  });

  it('⭐ 写失败不抛、只响一次;恢复时报丢了几条', () => {
    const base = tmp();
    const blocker = join(base, 'blocked');
    writeFileSync(blocker, '');            // 目录位置被一个文件占了 → mkdir 失败
    const report = vi.fn();
    const w = new DailyLogWriter(join(blocker, 'main'), report);
    expect(() => { w.write({ ts: D1 }); w.write({ ts: D1 }); w.write({ ts: D1 }); }).not.toThrow();
    expect(report).toHaveBeenCalledTimes(1);
    expect(String(report.mock.calls[0][0])).toMatch(/落盘失败/);
    // 恢复:把占位的文件挪走,mkdir 就能成功
    rmSync(blocker);
    w.write({ ts: D1, msg: 'ok' });
    expect(report).toHaveBeenCalledTimes(2);
    expect(String(report.mock.calls[1][0])).toMatch(/恢复.*丢了 3 条/);
    w.close();
  });
});

describe('② 主进程 console', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('⭐ 照常打终端 + 落盘带级别;stop 还原原函数', () => {
    const dir = tmp();
    const w = new DailyLogWriter(dir, () => {});
    const origError = console.error;
    const seen: unknown[][] = [];
    console.error = (...a: unknown[]): void => { seen.push(a); };   // 冒充「终端」
    const fakeTerminal = console.error;
    const tap = tapMainConsole(w, 'run1', () => D1);
    try {
      console.error('出事了', { code: 429 });
    } finally {
      tap.stop();
    }
    expect(console.error, 'stop 必须还原成接管前那个函数').toBe(fakeTerminal);
    console.error = origError;
    w.close();
    expect(seen).toEqual([['出事了', { code: 429 }]]);
    const recs = lines(join(dir, '2026-10-19.jsonl'));
    expect(recs).toEqual([{ ts: D1, run: 'run1', level: 'error', msg: "出事了 { code: 429 }" }]);
  });

  it('超长消息截断并记原长', () => {
    const dir = tmp();
    const w = new DailyLogWriter(dir, () => {});
    const orig = console.warn;
    console.warn = (): void => {};
    const tap = tapMainConsole(w, 'r', () => D1);
    console.warn('x'.repeat(MAX_MSG_CHARS + 5));
    tap.stop();
    console.warn = orig;
    w.close();
    const [r] = lines(join(dir, '2026-10-19.jsonl'));
    expect((r.msg as string).length).toBe(MAX_MSG_CHARS);
    expect(r.truncated).toBe(MAX_MSG_CHARS + 5);
    expect(r.level).toBe('warning');
  });
});

/** 冒充一个 WebContents:只需要 tap 用到的那几样 */
function fakeWc(id: number, url: string): WebContents & EventEmitter {
  const e = new EventEmitter() as unknown as WebContents & EventEmitter & { _url: string; _dead: boolean };
  Object.assign(e, {
    id, _url: url, _dead: false,
    getURL: () => e._url,
    getType: () => 'webview',
    isDestroyed: () => e._dead,
    hostWebContents: { id: 1 },
  });
  return e;
}

describe('③ 网页 DevTools 日志', () => {
  it('⭐ console-message 带 wc / url / pageId / 来源;加载失败也记', () => {
    const dir = tmp();
    const w = new DailyLogWriter(dir, () => {});
    const wc = fakeWc(12, 'https://x.com/search?q=a');
    tapPageConsole(wc, { writer: w, run: 'r', resolvePageId: (x) => (x === wc ? 'page_3_abc' : null), now: () => D1 });
    wc.emit('console-message', { level: 'error', message: 'Uncaught TypeError: boom', sourceId: 'https://abs.twimg.com/main.js', lineNumber: 7 });
    wc.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://x.com/', true);
    w.close();
    const recs = lines(join(dir, '2026-10-19.jsonl'));
    expect(recs[0]).toMatchObject({
      wc: 12, type: 'webview', host: 1, pageId: 'page_3_abc', url: 'https://x.com/search?q=a',
      kind: 'console', level: 'error', msg: 'Uncaught TypeError: boom', src: 'https://abs.twimg.com/main.js', line: 7,
    });
    expect(recs[1]).toMatchObject({ kind: 'load-fail', level: 'error', errorCode: -105, mainFrame: true });
  });

  it('同一个 wc 只挂一次(不然每条记 N 遍)', () => {
    const dir = tmp();
    const w = new DailyLogWriter(dir, () => {});
    const wc = fakeWc(13, 'https://a/');
    const deps = { writer: w, run: 'r', resolvePageId: () => null, now: () => D1 };
    tapPageConsole(wc, deps);
    tapPageConsole(wc, deps);
    wc.emit('console-message', { level: 'info', message: 'hi' });
    w.close();
    const recs = lines(join(dir, '2026-10-19.jsonl'));
    expect(recs).toHaveLength(1);
    expect(recs[0].pageId, '没登记过的页面不带 pageId,但照记').toBeUndefined();
  });

  it('⭐ 限流:超出只计数,下一分钟补一行 dropped 说丢了几条', () => {
    const dir = tmp();
    const w = new DailyLogWriter(dir, () => {});
    const wc = fakeWc(14, 'https://spam/');
    let t = D1;
    tapPageConsole(wc, { writer: w, run: 'r', resolvePageId: () => null, now: () => t });
    for (let i = 0; i < MAX_PER_MIN + 7; i += 1) wc.emit('console-message', { level: 'info', message: `m${i}` });
    t += 61_000;
    wc.emit('console-message', { level: 'info', message: 'next' });
    w.close();
    const recs = lines(join(dir, '2026-10-19.jsonl'));
    expect(recs.filter((r) => r.kind === 'console')).toHaveLength(MAX_PER_MIN + 1);
    const dropped = recs.find((r) => r.kind === 'dropped');
    expect(dropped?.count).toBe(7);
    expect(recs[recs.length - 1].msg, 'dropped 必须排在下一分钟第一条之前').toBe('next');
  });

  it('页面销毁时补报未报的丢弃数', () => {
    const dir = tmp();
    const w = new DailyLogWriter(dir, () => {});
    const wc = fakeWc(15, 'https://spam/') as WebContents & EventEmitter & { _dead: boolean };
    tapPageConsole(wc, { writer: w, run: 'r', resolvePageId: () => null, now: () => D1 });
    for (let i = 0; i < MAX_PER_MIN + 2; i += 1) wc.emit('console-message', { level: 'info', message: 'x' });
    wc._dead = true;
    wc.emit('destroyed');
    w.close();
    const dropped = lines(join(dir, '2026-10-19.jsonl')).find((r) => r.kind === 'dropped');
    expect(dropped?.count).toBe(2);
    expect(dropped?.url, '销毁后用最后一次取到的 url').toBe('https://spam/');
  });
});

describe('③b wc → pageId 反查', () => {
  it('登记过的返回 pageId,没登记的返回 null', () => {
    const a = fakeWc(31, 'https://x.com/');
    const b = fakeWc(32, 'https://other/');
    bindPageHost('page_t_a' as PageId, a);
    try {
      expect(pageIdOfWebContents(a)).toBe('page_t_a');
      expect(pageIdOfWebContents(b)).toBeNull();
    } finally {
      unbindPageHost('page_t_a' as PageId);
    }
    expect(pageIdOfWebContents(a)).toBeNull();
  });
});

describe('④ 老化', () => {
  it('main / page 两条流都删超过 30 天的,其余留着', () => {
    const dir = tmp();
    for (const s of ['main', 'page']) {
      mkdirSync(join(dir, s));
      for (const d of ['2026-09-10', '2026-09-25', '2026-10-19']) writeFileSync(join(dir, s, `${d}.jsonl`), '');
      writeFileSync(join(dir, s, 'notes.txt'), '');
    }
    expect(sweepLogs(dir, D1)).toBe(2);
    expect(readdirSync(join(dir, 'main')).sort()).toEqual(['2026-09-25.jsonl', '2026-10-19.jsonl', 'notes.txt']);
  });
});

describe('⑤ 读取工具', () => {
  it('时间窗 + 坏行计数 + 跨天', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'page'));
    writeFileSync(join(dir, 'page', '2026-10-19.jsonl'),
      `${JSON.stringify({ ts: D1, level: 'info', msg: 'in' })}\n{"ts":半行\n${JSON.stringify({ ts: D1 - 3_600_000, level: 'info', msg: 'early' })}\n`);
    writeFileSync(join(dir, 'page', '2026-10-20.jsonl'), `${JSON.stringify({ ts: D1 + 86_400_000, level: 'error', msg: 'next day' })}\n`);
    const r = readStream(dir, 'page', D1 - 60_000, D1 + 86_400_000);
    expect(r.records.map((x: { msg: string }) => x.msg)).toEqual(['in', 'next day']);
    expect(r.badLines).toBe(1);
  });

  it('筛选:级别(≥)/ pageId 前缀 / url / grep 都是 AND', () => {
    const recs = [
      { ts: 1, stream: 'page', level: 'error', pageId: 'page_3_a', url: 'https://x.com/a', msg: 'HTTP 429' },
      { ts: 2, stream: 'page', level: 'info', pageId: 'page_3_a', url: 'https://x.com/a', msg: 'HTTP 429' },
      { ts: 3, stream: 'page', level: 'error', pageId: 'page_4_b', url: 'https://x.com/b', msg: 'HTTP 429' },
      { ts: 4, stream: 'main', level: 'warning', msg: 'cursor stuck' },
    ];
    expect(filterRecords(recs, { level: 'warn' }).map((r: { ts: number }) => r.ts)).toEqual([1, 3, 4]);
    expect(filterRecords(recs, { level: 'error', page: 'page_3' }).map((r: { ts: number }) => r.ts)).toEqual([1]);
    expect(filterRecords(recs, { grep: /CURSOR/i }).map((r: { ts: number }) => r.ts)).toEqual([4]);
    expect(filterRecords(recs, { url: '/b' }).map((r: { ts: number }) => r.ts)).toEqual([3]);
  });

  it('显示时去掉 ANSI 颜色码(文件里不动)', () => {
    const line = formatRecord({ ts: D1, stream: 'main', level: 'warning', msg: '[storage] \u001b[33m WARN\u001b[0m bye' });
    expect(line).toMatch(/WRN main \| \[storage\]  WARN bye$/);
  });

  it('认不出的时长 / 时刻 / 级别如实报错,不当成「全部」', () => {
    expect(parseDuration('10m')).toBe(600_000);
    expect(() => parseDuration('10 分钟')).toThrow(/认不出/);
    expect(() => parseTime('昨天')).toThrow(/认不出/);
    expect(() => filterRecords([], { level: 'fatal' })).toThrow(/认不出/);
    const at = parseTime('14:30', Date.parse('2026-10-19T00:00:00'));
    expect(new Date(at).getHours()).toBe(14);
  });
});

describe('⑥ ⭐⭐ 端到端:注入一条网页报错 → 工具读得出来且带 pageId', () => {
  it('写入端 → 文件 → 真跑 scripts/logs.mjs', () => {
    const dir = tmp();
    const w = new DailyLogWriter(join(dir, 'page'), () => {});
    const wc = fakeWc(21, 'https://x.com/home');
    const now = Date.now();
    tapPageConsole(wc, { writer: w, run: 'e2e', resolvePageId: () => 'page_9_e2e', now: () => now });
    wc.emit('console-message', { level: 'error', message: 'Uncaught Error: KRIG_DIAG_PROBE_e2e', sourceId: 'https://x.com/x.js', lineNumber: 1 });
    w.close();
    const out = execFileSync('node', ['scripts/logs.mjs', '--dir', dir, '--since', '5m', '--grep', 'KRIG_DIAG_PROBE', '--level', 'error'], {
      cwd: process.cwd(), encoding: 'utf8',
    });
    expect(out).toMatch(/命中 1 条/);
    expect(out).toMatch(/ERR wc#21 page_9_e2e x\.com\/home \| Uncaught Error: KRIG_DIAG_PROBE_e2e/);
    const json = execFileSync('node', ['scripts/logs.mjs', '--dir', dir, '--since', '5m', '--page', 'page_9', '--json'], { encoding: 'utf8' });
    const rec = JSON.parse(json.trim().split('\n').pop() as string) as Record<string, unknown>;
    expect(rec).toMatchObject({ pageId: 'page_9_e2e', url: 'https://x.com/home', wc: 21, level: 'error' });
  });

  it('参数写错如实退出(退出码 2),不静默给全部', () => {
    let code = 0;
    try {
      execFileSync('node', ['scripts/logs.mjs', '--dir', tmp(), '--sinse', '5m'], { stdio: 'pipe' });
    } catch (e) {
      code = (e as { status: number }).status;
    }
    expect(code).toBe(2);
  });
});

describe('⑦ 宿主接线', () => {
  const src = readFileSync(join(process.cwd(), 'src/platform/main/index.ts'), 'utf8');

  it('⭐ 拿到单实例锁的分支里立刻起(早于 whenReady,接住启动日志)', () => {
    const lockElse = src.slice(src.indexOf('if (!app.requestSingleInstanceLock())'), src.indexOf('app.whenReady()'));
    const elseBranch = lockElse.slice(lockElse.indexOf('} else {'));
    expect(elseBranch.length).toBeGreaterThan(20);
    expect(elseBranch).toMatch(/^\s*startDiagnosticLogs\(\{ resolvePageId: pageIdOfWebContents \}\);/m);
  });

  it('⭐ before-quit 的最终分支(关库之后)停', () => {
    const quit = src.slice(src.indexOf("app.on('before-quit'"));
    const finalBranch = quit.slice(quit.indexOf('if (reconciled) {'), quit.indexOf('return;', quit.indexOf('if (reconciled) {')));
    expect(finalBranch.length).toBeGreaterThan(20);
    expect(finalBranch).toMatch(/shutdownStorageSync\(\);[\s\S]*^\s*stopDiagnosticLogs\(\);/m);
  });
});
