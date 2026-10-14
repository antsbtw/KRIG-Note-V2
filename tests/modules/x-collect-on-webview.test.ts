/**
 * ⭐⭐ 对一个 webview 采一个标签页(主进程侧编排,2026-10-13 后台策略 3a)
 *
 * 编排从 renderer(`XOpsPeople.tsx::collectTweets`)搬到 `x-collect-on-webview.ts`,
 * 人卡与后台 runner 共用。这里钉两件事:
 *  ① 编排判断(没去到页不采 / 参数原样传 / 停得住)—— 行为测试,注入假 ports
 *  ② 主进程那份 ports 真的走能力层的同一组入口 + 同一份留痕 —— 源码守卫
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectOnWebview, type WebviewPorts } from '@modules/x/x-collect-on-webview';
import type { RunHarvest } from '@modules/x/x-collect-run';

const SEED = 'https://x.com/i/api/graphql/qid/SearchTimeline?variables=%7B%22rawQuery%22%3A%22vpn%22%7D';
const HEADERS = { authorization: 'Bearer TEST', 'x-csrf-token': 'test-csrf' };

/** 第 n 页:一条推 + 一个游标(cursor=null 表示没有下一页) */
const page = (n: number, cursor: string | null): string => {
  const entries: unknown[] = [{
    entryId: `tweet-${n}`,
    content: { itemContent: { tweet_results: { result: {
      rest_id: `t${n}`,
      legacy: { id_str: `t${n}`, full_text: `第${n}页` },
      core: { user_results: { result: { legacy: { screen_name: 'a' } } } },
    } } } },
  }];
  if (cursor !== null) entries.push({ entryId: 'cursor-bottom', content: { cursorType: 'Bottom', value: cursor } });
  return JSON.stringify({
    data: { search_by_raw_query: { search_timeline: { timeline: {
      instructions: [{ type: 'TimelineAddEntries', entries }],
    } } } },
  });
};

/** 假 ports:goto 可设成败;首页 + 每次 runScript 推进一页(无限页时游标永远在变) */
function fakePorts(opts: { gotoFails?: string; pages?: number } = {}): {
  ports: WebviewPorts;
  log: { gotos: Array<{ name: string; params: Record<string, string> }>; harvests: number; cursors: string[] };
} {
  const log = { gotos: [] as Array<{ name: string; params: Record<string, string> }>, harvests: 0, cursors: [] as string[] };
  let idx = 1;
  const total = opts.pages ?? Number.POSITIVE_INFINITY;
  const cur = (): string => page(idx, idx < total ? `c${idx}` : null);
  const ports: WebviewPorts = {
    async goto(name, params) {
      log.gotos.push({ name, params });
      return opts.gotoFails ? { ok: false, reason: opts.gotoFails } : { ok: true };
    },
    async harvest(plan) {
      log.harvests += 1;
      if (plan.gotoPage) return { items: [] };
      return { items: [{ url: SEED, text: cur(), requestHeaders: HEADERS }] } satisfies RunHarvest;
    },
    async runScript(_id, params) {
      log.cursors.push(String(params.cursor ?? ''));
      idx += 1;
      return { ok: true };
    },
  };
  return { ports, log };
}

const hooks = (cancelled = (): boolean => false) => ({
  cancelled, onProgress: (): void => {}, wait: async (): Promise<void> => {},
});

describe('⭐⭐ collectOnWebview 编排', () => {
  it('⭐⭐ 没去到这一页 → 一条都不采,如实说原因(别在原页上接着采)', async () => {
    const { ports, log } = fakePorts({ gotoFails: '没登记这个页名' });
    const r = await collectOnWebview(ports, { page: 'x.profile', handle: 'abc', restId: '1', pageCap: 30 }, hooks());
    expect(r).toEqual({ reached: false, reason: '没登记这个页名' });
    expect(log.harvests, '没去到页还在采 —— 会静默串页').toBe(0);
  });

  it('⭐ 去的是给定的页名,参数只带 handle(与人卡旧版一致)', async () => {
    const { ports, log } = fakePorts({ pages: 1 });
    await collectOnWebview(ports, { page: 'x.withReplies', handle: 'abc', restId: '1', pageCap: 30 }, hooks());
    expect(log.gotos).toEqual([{ name: 'x.withReplies', params: { handle: 'abc' } }]);
  });

  it('⭐⭐ 翻到 X 说没有下一页 → 记 exhausted;推文全进账', async () => {
    const { ports } = fakePorts({ pages: 3 });
    const r = await collectOnWebview(ports, { page: 'x.profile', handle: 'abc', restId: '1', pageCap: 30 }, hooks());
    if (!r.reached) throw new Error('应当去到了');
    expect(r.records.map((x) => x.id).sort()).toEqual(['t1', 't2', 't3']);
    expect(r.paging?.rounds).toBe(2);
  });

  it('⭐⭐ 页数上限由调用方给 —— 到了就停', async () => {
    const { ports, log } = fakePorts();
    const r = await collectOnWebview(ports, { page: 'x.profile', handle: 'abc', restId: '1', pageCap: 2 }, hooks());
    if (!r.reached) throw new Error('应当去到了');
    expect(log.cursors.length, '没按 pageCap 停 —— 后台一段会翻个没完').toBe(2);
    expect(r.paging?.stopReason).toMatch(/上限 2 页/);
  });

  it('⭐ 断点游标原样交给 runCollect(源码钉:不在这一层吞掉)', () => {
    const src = readFileSync(join(process.cwd(), 'src/modules/x/x-collect-on-webview.ts'), 'utf-8');
    expect(src).toMatch(/resumeCursor:\s*input\.resumeCursor/);
  });

  it('⭐ 喊停 → 停得住,已采到的留着', async () => {
    const { ports, log } = fakePorts();
    let stop = false;
    const h = hooks(() => stop);
    const r = await collectOnWebview(ports, { page: 'x.profile', handle: 'abc', restId: '1', pageCap: 30 }, {
      ...h,
      onProgress: () => { if (log.cursors.length >= 1) stop = true; },
    });
    if (!r.reached) throw new Error('应当去到了');
    expect(log.cursors.length, '喊停后还在翻').toBeLessThan(30);
    expect(r.records.length).toBeGreaterThan(0);
  });
});

describe('⭐⭐ 主进程 ports 走能力层的同一条路(源码守卫)', () => {
  const strip = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const PORTS = strip(readFileSync(join(process.cwd(), 'src/modules/x/x-collect-ports.ts'), 'utf-8'));
  const body = (name: string): string => {
    const i = PORTS.indexOf(`async ${name}(`);
    expect(i, `${name} 不见了 —— 本条要重写`).toBeGreaterThan(-1);
    const s = PORTS.slice(i, PORTS.indexOf('\n    },', i));
    expect(s.length, '切片空了 —— 断言会恒真').toBeGreaterThan(80);
    return s;
  };

  it('⭐⭐ harvest 调 harvestOnPage 且打 traceHarvest —— 走主进程也要有端点清单', () => {
    const b = body('harvest');
    expect(b, '没走引擎入口 —— 会漏掉「先清上一轮产出」').toMatch(/harvestOnPage\s*\(/);
    expect(b, '没打 harvest 留痕 —— 采完不知道收到了什么').toMatch(/traceHarvest\s*\(/);
  });

  it('⭐ goto 调 gotoOnPage 且打 traceGoto', () => {
    const b = body('goto');
    expect(b).toMatch(/gotoOnPage\s*\(/);
    expect(b, '没打导航留痕 —— 0 条时读不到人去了哪').toMatch(/traceGoto\s*\(/);
  });

  it('⭐ 每个动作都重新 resolve —— 页面关了就如实失败,不拿死 wc 接着用', () => {
    for (const n of ['goto', 'harvest', 'runScript']) {
      expect(body(n), `${n} 没有自己 resolve`).toMatch(/resolve\(\{\s*wcId\s*\}\)/);
    }
  });
});

/**
 * ⚠️⚠️ KNOWN_DEBT(2026-10-13,3a 发现,留给 3b)——「推文页的断点续采」在 runCollect 里**不生效**:
 *   · 翻页游标取 `推文账的游标 ?? lastUserCursor`,推文页首页就有推文游标 → 传入的 resumeCursor 被忽略
 *   · 返回的 nextCursor 是 lastUserCursor(只有名单页会更新)→ 推文页恒 undefined
 * 3a 只搬家、行为一字不改,所以这里**钉住现状**而不是修。
 * ⭐ 3b 修好 runCollect 后这两条会变红 —— 那时把它们改成正向断言(续得上 / 交得出游标),不要删。
 */
describe('⚠️ KNOWN_DEBT:推文页断点续采在 runCollect 里不生效(3b 要修)', () => {
  it('现状:推文页给了 resumeCursor,第一次翻页仍用首页的游标', async () => {
    const { ports, log } = fakePorts();
    await collectOnWebview(ports, {
      page: 'x.profile', handle: 'abc', restId: '1', pageCap: 1, resumeCursor: 'RESUME',
    }, hooks());
    expect(log.cursors[0]).toBe('c1');
  });

  it('现状:推文页翻到页数上限停下,nextCursor 交不出来', async () => {
    const { ports } = fakePorts();
    const r = await collectOnWebview(ports, { page: 'x.profile', handle: 'abc', restId: '1', pageCap: 2 }, hooks());
    if (!r.reached) throw new Error('应当去到了');
    expect(r.nextCursor).toBeUndefined();
    expect(r.exhausted).toBe(false);
  });
});
