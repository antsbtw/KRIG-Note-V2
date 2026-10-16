/**
 * ⭐⭐ 后台采集第 4 步(2026-10-14):X 网页登记跨进程同步 + bg* IPC 接线。
 *
 * ⚠️ 起因:x-host-registry 每进程一份,登记只在 renderer,后台 runner 在主进程读 —— 恒空,
 * runner 静默空转。runner 的真库测试在同一进程里 set,所以测不出来。
 * 这里钉住:① renderer 真把差异发出去(行为测,mock IPC)② renderer 入口真启动了同步
 * ③ 主进程收到后真写进自己的登记表 ④ bg* op 调的是 repo、暂停/恢复先读后写。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sent: unknown[] = [];
vi.mock('@modules/x/x-data-types', () => ({
  xDataCall: vi.fn(async (p: unknown) => { sent.push(p); return { status: 'ok', value: null }; }),
}));

import { syncOnce, _resetXHostSync } from '@modules/x/x-host-sync';
import { setXHostState, clearXHostState, setXHostBusy } from '@modules/x/x-host-registry';

const read = (p: string): string => readFileSync(resolve(__dirname, '../..', p), 'utf8');
/** 剥注释(⚠️ 不吃 https:// —— 守卫剥注释第四刀) */
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('x-host-sync:renderer 登记差异发给主进程', () => {
  beforeEach(() => {
    sent.length = 0;
    _resetXHostSync();
    for (const ws of ['ws-a', 'ws-b']) clearXHostState(ws);
    for (const wc of [11, 12]) setXHostBusy(wc, null);
  });

  it('登记 → 发 syncHost;同 wcId 再导航不重发;卸了发 null', () => {
    setXHostState('ws-a', 11, 'https://x.com/a');
    syncOnce();
    expect(sent).toEqual([{ op: 'syncHost', wsId: 'ws-a', wcId: 11 }]);
    sent.length = 0;
    setXHostState('ws-a', 11, 'https://x.com/b');
    syncOnce();
    expect(sent).toEqual([]);
    clearXHostState('ws-a');
    syncOnce();
    expect(sent).toEqual([{ op: 'syncHost', wsId: 'ws-a', wcId: null }]);
  });

  it('按 ws 一条条发(多窗口不互相覆盖):只动 ws-b 不重发 ws-a', () => {
    setXHostState('ws-a', 11, '');
    syncOnce();
    sent.length = 0;
    setXHostState('ws-b', 12, '');
    syncOnce();
    expect(sent).toEqual([{ op: 'syncHost', wsId: 'ws-b', wcId: 12 }]);
  });

  it('忙 → 发 syncBusy;不忙 → 发 null', () => {
    setXHostBusy(11, '运营正在核对这个人');
    syncOnce();
    expect(sent).toEqual([{ op: 'syncBusy', wcId: 11, reason: '运营正在核对这个人' }]);
    sent.length = 0;
    setXHostBusy(11, null);
    syncOnce();
    expect(sent).toEqual([{ op: 'syncBusy', wcId: 11, reason: null }]);
  });
});

describe('接线守卫', () => {
  it('⭐⭐ renderer 入口真启动了同步(去掉 runner 就静默空转)', () => {
    const src = strip(read('src/modules/x/renderer.ts'));
    expect(src).toMatch(/^startXHostSync\(\);/m);
  });

  it('⭐⭐ 主进程 syncHost/syncBusy 真写进主进程登记表,webview 销毁自己清', () => {
    const ipc = strip(read('src/modules/x/x-data-ipc.ts'));
    const host = ipc.slice(ipc.indexOf("case 'syncHost':"), ipc.indexOf("case 'syncBusy':"));
    expect(host.length).toBeGreaterThan(100);
    expect(host).toMatch(/setXHostState\(p\.wsId, p\.wcId/);
    expect(host).toMatch(/clearXHostState\(p\.wsId\)/);
    expect(host).toMatch(/wc\.once\('destroyed'/);
    const busy = ipc.slice(ipc.indexOf("case 'syncBusy':"), ipc.indexOf("case 'bgBusy':"));
    expect(busy).toMatch(/setXHostBusy\(p\.wcId/);
  });

  it('⭐ bg* op 调 repo;暂停/恢复先 readJob(UPSERT 不存在的 id 会建残行)', () => {
    const ipc = strip(read('src/modules/x/x-data-ipc.ts'));
    const seg = (a: string, b: string): string => {
      const s = ipc.slice(ipc.indexOf(a), ipc.indexOf(b));
      expect(s.length).toBeGreaterThan(30);
      return s;
    };
    expect(seg("case 'bgCreateJob':", "case 'bgListJobs':")).toMatch(/await createJob\(/);
    expect(seg("case 'bgCreateJob':", "case 'bgListJobs':")).toMatch(/isBgRange\(/);
    expect(seg("case 'bgListJobs':", "case 'bgPauseJob':")).toMatch(/await listJobs\(/);
    const pr = seg("case 'bgPauseJob':", "case 'bgCancelJob':");
    expect(pr.indexOf('await readJob(')).toBeGreaterThan(-1);
    expect(pr.indexOf('await readJob(')).toBeLessThan(pr.indexOf('setJobStatus('));
    expect(seg("case 'bgCancelJob':", "case 'opsSettings':")).toMatch(/await deleteJob\(/);
  });

  it('⭐ 人卡三个手动动作都先问后台在不在用这个网页', () => {
    const page = strip(read('src/modules/x/XOpsPeople.tsx'));
    for (const [a, b] of [
      ['const runVerify = useCallback', 'const h = await window.electronAPI'],
      ['const collectTweets = useCallback', 'setXHostBusy(wcId, COLLECT_BUSY)'],
      ['const unfollow = useCallback', 'setXHostBusy(wcId, UNFOLLOW_BUSY)'],
    ]) {
      const fn = page.slice(page.indexOf(a), page.indexOf(b));
      expect(fn.length, a).toBeGreaterThan(50);
      expect(fn, a).toMatch(/await bgBusyNote\(wcId\)/);
    }
  });
});

describe('⭐⭐ 后台「此刻在不在跑」提示(用户 10-14)', () => {
  const base = { live: null, waitNote: null, nextTickAt: 100_000, now: 40_000, counts: { queued: 0, running: 0, paused: 0, done: 0, failed: 0 } };

  it('正在跑 → 绿 + 谁 + 哪页', async () => {
    const { bgStatusLine } = await import('@modules/x/XBgStatus');
    const r = bgStatusLine({ ...base, counts: { ...base.counts, running: 1 },
      live: { jobId: 'j', handle: 'whyyoutouzhele', range: 'halfYear', startedAt: 0, msg: '采帖子…', pageMsg: '第 3 页' } });
    expect(r.tone).toBe('live');
    expect(r.text).toContain('@whyyoutouzhele(半年)');
    expect(r.text).toContain('第 3 页');
  });

  it('有任务没在跑 → 说原因 + 倒计时;X 网页没开是警告', async () => {
    const { bgStatusLine } = await import('@modules/x/XBgStatus');
    const w = bgStatusLine({ ...base, counts: { ...base.counts, queued: 1 }, waitNote: '距上段才 40 秒' });
    expect(w.tone).toBe('wait');
    expect(w.text).toContain('距上段才 40 秒');
    expect(w.text).toContain('约 60 秒后');
    expect(bgStatusLine({ ...base, counts: { ...base.counts, queued: 1 }, waitNote: '这个号的 X 网页没开,等它开' }).tone).toBe('warn');
    // runner 没在跑 —— 不许显示成正常等待
    expect(bgStatusLine({ ...base, counts: { ...base.counts, queued: 1 }, nextTickAt: null }).tone).toBe('warn');
  });

  it('没任务 → 空闲;有失败要说出来', async () => {
    const { bgStatusLine } = await import('@modules/x/XBgStatus');
    expect(bgStatusLine(base)).toEqual({ tone: 'idle', text: '后台空闲' });
    expect(bgStatusLine({ ...base, counts: { ...base.counts, failed: 1 } }).text).toContain('失败 1');
  });

  it('建任务 / 恢复后马上看一次(不干等 120 秒)', () => {
    const ipc = strip(read('src/modules/x/x-data-ipc.ts'));
    const create = ipc.slice(ipc.indexOf("case 'bgCreateJob':"), ipc.indexOf("case 'bgStatus':"));
    expect(create.length).toBeGreaterThan(100);
    expect(create).toMatch(/kickBgRunner\(\)/);
    const resume = ipc.slice(ipc.indexOf("await setJobStatus(p.id, 'queued')"), ipc.indexOf("case 'bgCancelJob':"));
    expect(resume).toMatch(/kickBgRunner\(\)/);
  });

  it('运营顶栏挂了提示', () => {
    expect(strip(read('src/modules/x/XOpsView.tsx'))).toMatch(/<BgIndicator wsId=\{workspaceId\} \/>/);
  });
});
