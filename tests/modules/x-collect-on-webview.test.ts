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
const page = (n: number, cursor: string | null, dated = false): string => {
  /** dated:第 n 页他自己的推文 = 10-(15-n) 日;第 1 页另带一条 2022 的旧推(置顶 / 被引用的旧推) */
  const tw = (id: string, at?: string): unknown => ({
    entryId: `tweet-${id}`,
    content: { itemContent: { tweet_results: { result: {
      rest_id: id,
      legacy: { id_str: id, full_text: `第${n}页`, ...(at ? { created_at: at } : {}) },
      core: { user_results: { result: { rest_id: '1', legacy: { screen_name: 'a' } } } },
    } } } },
  });
  const entries: unknown[] = dated
    ? [tw(`t${n}`, `Wed Oct ${15 - n} 11:20:00 +0000 2026`), ...(n === 1 ? [tw('pin', 'Thu Oct 13 07:47:49 +0000 2022')] : [])]
    : [tw(`t${n}`)];
  if (cursor !== null) entries.push({ entryId: 'cursor-bottom', content: { cursorType: 'Bottom', value: cursor } });
  return JSON.stringify({
    data: { search_by_raw_query: { search_timeline: { timeline: {
      instructions: [{ type: 'TimelineAddEntries', entries }],
    } } } },
  });
};

/** 假 ports:goto 可设成败;首页 + 每次 runScript 推进一页(无限页时游标永远在变) */
function fakePorts(opts: { gotoFails?: string; pages?: number; dated?: boolean } = {}): {
  ports: WebviewPorts;
  log: { gotos: Array<{ name: string; params: Record<string, string> }>; harvests: number; cursors: string[] };
} {
  const log = { gotos: [] as Array<{ name: string; params: Record<string, string> }>, harvests: 0, cursors: [] as string[] };
  let idx = 1;
  const total = opts.pages ?? Number.POSITIVE_INFINITY;
  const cur = (): string => page(idx, idx < total ? `c${idx}` : null, opts.dated === true);
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

  it('⭐⭐ 翻页前沿 = 最后一页他自己最新那条(不是这一段最新,也不被旧推拉回几年前)', async () => {
    // 2026-10-14 真机:后台进度原来显示「采到 今天」;真库这一段混着 2022 的旧推
    const { ports } = fakePorts({ pages: 4, dated: true });
    const r = await collectOnWebview(ports, { page: 'x.profile', handle: 'abc', restId: '1', pageCap: 30 }, hooks());
    if (!r.reached) throw new Error('应当去到了');
    expect(r.records.some((x) => x.createdAt?.endsWith('2022')), '样本里要真有旧推,否则测不出被拉偏').toBe(true);
    expect(r.frontierAt?.slice(0, 10)).toBe('2026-10-11');
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
 * ⭐⭐ 推文页断点续采(2026-10-13,3b 修好)——
 *   · 有 resumeCursor 时,**第一次翻页就从断点续**,不再用首页游标
 *   · 翻到页数上限停下,**交得出 nextCursor**(下次从这续)
 * 这是后台策略分段跑的地基:一段翻 N 页就停、存断点,下段从断点接着翻。
 * ⚠️ 修在 runCollect(x-collect-run.ts),改动要害=「别碰坏名单页游标逻辑」(那段带血泪)。
 */
describe('⭐⭐ 推文页断点续采(3b 修好)', () => {
  it('⭐ 有 resumeCursor → 第一次翻页就用断点,不用首页游标', async () => {
    const { ports, log } = fakePorts();
    await collectOnWebview(ports, {
      page: 'x.profile', handle: 'abc', restId: '1', pageCap: 1, resumeCursor: 'RESUME',
    }, hooks());
    expect(log.cursors[0], '没从断点续 —— 后台分段会从头重采').toBe('RESUME');
  });

  it('⭐⭐ 推文页翻到页数上限停 → 交得出 nextCursor(下次续)', async () => {
    const { ports } = fakePorts();
    const r = await collectOnWebview(ports, { page: 'x.profile', handle: 'abc', restId: '1', pageCap: 2 }, hooks());
    if (!r.reached) throw new Error('应当去到了');
    expect(r.nextCursor, '上限停却交不出游标 —— 下段无从续起').toBeTruthy();
    expect(r.exhausted, '上限停不是到头').toBe(false);
  });

  it('⚠️ 无 resumeCursor(正常首采)→ 行为不变:第一次翻页用首页游标', async () => {
    const { ports, log } = fakePorts();
    await collectOnWebview(ports, {
      page: 'x.profile', handle: 'abc', restId: '1', pageCap: 1,
    }, hooks());
    expect(log.cursors[0], '首采不该受断点续采改动影响').toBe('c1');
  });
});

describe('⭐⭐⭐ 人卡 / 后台:一页一存、存完回读(2026-10-16 逐页账)', () => {
  it('每页都交给 savePage;新增数累计;逐页账带出来', async () => {
    const { ports } = fakePorts({ pages: 3 });
    const saved: string[][] = [];
    const r = await collectOnWebview(ports, { page: 'x.profile', handle: 'a', restId: '1', pageCap: 30 }, {
      ...hooks(),
      savePage: async (tweets) => { saved.push(tweets.map((t) => t.id)); return { inDb: tweets.map((t) => t.id), inserted: tweets.length }; },
    });
    if (!r.reached) throw new Error('应当到达');
    expect(saved).toEqual([['t1'], ['t2'], ['t3']]);
    expect(r.pageInserted).toBe(3);
    expect(r.ledger.map((l) => l.page)).toEqual([0, 1, 2]);
    expect(r.ledgerProblem).toBeUndefined();
  });

  it('⭐⭐ 回读少一条 → 重采一次仍少 → 停在这页,ledgerProblem 写「落库层」(后台据此判这一段失败)', async () => {
    /** ⚠️ 按**游标**给页(同一个游标重采拿回同一页)—— fakePorts 每调一次就推进,会把「重采」变成「下一页」 */
    let idx = 1;
    const ports: WebviewPorts = {
      async goto() { return { ok: true }; },
      async harvest(plan) {
        if (plan.gotoPage) return { items: [] };
        return { items: [{ url: SEED, text: page(idx, `c${idx}`), requestHeaders: HEADERS }] } satisfies RunHarvest;
      },
      async runScript(_id, params) { idx = Number(String(params.cursor).slice(1)) + 1; return { ok: true }; },
    };
    const r = await collectOnWebview(ports, { page: 'x.profile', handle: 'a', restId: '1', pageCap: 30 }, {
      ...hooks(),
      savePage: async (tweets) => ({ inDb: tweets.map((t) => t.id).filter((id) => id !== 't2'), inserted: 1 }),
    });
    if (!r.reached) throw new Error('应当到达');
    expect(r.ledgerProblem).toContain('落库层');
    expect(r.ledger.at(-1)?.notInDb).toEqual(['t2']);
  });

  it('后台:ledgerProblem → 这一段 failure(异常即停);新增算每页累计的', () => {
    const src = readFileSync(join(process.cwd(), 'src/modules/x/x-bg-runner.ts'), 'utf8');
    expect(src).toMatch(/if \(r\.ledgerProblem !== undefined\) \{\s*return \{[^}]*failure: r\.ledgerProblem \}/);
    expect(src).toMatch(/saved \+= r\.pageInserted \+ sv\.inserted;/);
    expect(readFileSync(join(process.cwd(), 'src/modules/x/x-person-collect.ts'), 'utf8')).toMatch(/savePage: \(tweets\) => saveTweetPage\(\{ tweets, source: input\.page, wcId: input\.wcId \}\)/);
  });
});
