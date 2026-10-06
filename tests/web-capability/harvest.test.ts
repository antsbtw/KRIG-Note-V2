/**
 * `harvestPage` —— ⭐⭐⭐ **「选好页面,点一下,它自己采完」** 的编排
 *
 * ── 用户 2026-10-03 ──
 * 「应该是反过来,**我自己选定一个页面,点击开始采集,就采集**,
 * 　采集完毕后再验证采集的内容才对。」「每次采集 **10 页**。」
 *
 * ⚠️ 本层钉的是**编排顺序与停止判据**,不是机制
 * (控制/采集由 `HarvestDeps` 注入,这里全是假的)。
 */

import { describe, it, expect, vi } from 'vitest';
import { harvestPage } from '@platform/main/web-capability/harvest/harvest';
import type { HarvestDeps } from '@platform/main/web-capability/harvest/types';
import type { AcquiredItem } from '@platform/main/web-capability/acquire/types';
import type { PageId } from '@platform/main/web-capability/page/types';

const PAGE = 'p1' as unknown as PageId;
const item = (url: string): AcquiredItem => ({
  url, method: 'POST', status: 200, text: '{}', byteLength: 2,
  at: new Date().toISOString(), from: 'cdp',
});
const PAGE_URL = 'https://x.com/i/api/graphql/abc/HomeTimeline';

/**
 * 造假 deps。
 * @param perRound 每轮**新增**哪些响应(模拟滚动触发的请求)
 */
function deps(plan: {
  initial?: AcquiredItem[];
  perRound?: AcquiredItem[][];
  cdpAttached?: boolean;
  hookInstalled?: boolean;
  /** ⭐ 造「导航没去成」那条路 */
  gotoFails?: boolean;
  scriptThrows?: boolean;
} = {}) {
  const pool: AcquiredItem[] = [...(plan.initial ?? [])];
  const order: string[] = [];
  let round = 0;
  let t = 0;
  const d: HarvestDeps = {
    async startAcquire() {
      order.push('startAcquire');
      return {
        ok: (plan.cdpAttached ?? true) || (plan.hookInstalled ?? true),
        cdpAttached: plan.cdpAttached ?? true,
        hookInstalled: plan.hookInstalled ?? true,
      };
    },
    peekAcquire: () => [...pool],
    finishAcquire: () => {
      order.push('finishAcquire');
      return {
        ok: pool.length > 0,
        problems: pool.length === 0 ? ['一条响应都没有'] : [],
        items: [...pool],
        elapsedMs: 100,
        legs: {
          cdp: pool.length, hook: 0, both: 0,
          hookInjected: plan.hookInstalled ?? true,
          cdpAttached: plan.cdpAttached ?? true,
        },
      };
    },
    reload: () => { order.push('reload'); },
    /**
     * ⭐ 「先去那一页再采」—— 与 `reload` 占同一个位置(装腿之后)。
     * ⚠️ `plan.gotoFails` 用来造「没去成」那条路。
     */
    async goto(_p, name) {
      order.push(`goto:${name}`);
      return !(plan.gotoFails ?? false);
    },
    async scroll(_p, opts) {
      order.push('scroll');
      let rounds = 0;
      for (let i = 1; i <= (opts.maxRounds ?? 40); i += 1) {
        if (opts.shouldStop?.()) break;
        rounds = i;
        pool.push(...(plan.perRound?.[round] ?? []));
        round += 1;
        await opts.afterRound?.(i);
      }
      return { rounds, scrolledPx: rounds * 500, reachedBottom: false, stopReason: `滚了 ${rounds} 轮` };
    },
    async runScript() {
      order.push('runScript');
      if (plan.scriptThrows) throw new Error('脚本炸了');
      return { expanded: 1, tweets: [{ id: 't1', text: '展开后的全文' }] };
    },
    wait: async (ms) => { t += ms; },
    now: () => { t += 1; return t; },
  };
  return { d, order, pool };
}

describe('⭐⭐⭐ 编排顺序', () => {
  it('⭐⭐⭐ **先装腿、再重载** —— 顺序反了就错过首屏', async () => {
    /**
     * ⚠️ 2026-10-02 实测:`capture-start` 与 `page-created` 同一秒,
     * 而 X 的 `HomeTimeline` 早已发完 → **捕到 0 条有用数据**。
     * ⭐ 先重载的话,首屏那批请求在装腿之前就发完了 —— 同一个坑。
     */
    const { d, order } = deps({ perRound: [[item(PAGE_URL)]] });
    await harvestPage(d, PAGE, { maxRounds: 1, pageUrlIncludes: ['/HomeTimeline'] });
    const a = order.indexOf('startAcquire');
    const b = order.indexOf('reload');
    expect(a, '没装腿').toBeGreaterThan(-1);
    expect(b, '没重载 —— 会错过首屏那批请求').toBeGreaterThan(-1);
    expect(a, '**先重载后装腿** —— 首屏请求会在装腿前发完').toBeLessThan(b);
  });

  it('⭐⭐ 重载之后才滚 —— 否则滚的是旧页面', async () => {
    const { d, order } = deps({ perRound: [[item(PAGE_URL)]] });
    await harvestPage(d, PAGE, { maxRounds: 1 });
    expect(order.indexOf('reload')).toBeLessThan(order.indexOf('scroll'));
  });

  it('⭐ 最后才停止采集 —— 停早了后面滚出来的就收不到', async () => {
    const { d, order } = deps({ perRound: [[item(PAGE_URL)]] });
    await harvestPage(d, PAGE, { maxRounds: 1 });
    expect(order.indexOf('scroll')).toBeLessThan(order.indexOf('finishAcquire'));
  });
});

describe('⭐⭐⭐ 采够页数就停', () => {
  it('⭐⭐⭐ 够 3 页就停,**不滚满轮次**', async () => {
    /**
     * 用户 2026-10-03:「每次采集 10 页」。
     * ⚠️ `feedback-pdca-close-the-loop`:停止由**数据判据**决定,
     * 不由预先猜的次数(轮数当目标填 30 实采 250、填 600 有 43% 空转)。
     */
    const { d } = deps({
      perRound: Array.from({ length: 30 }, () => [item(PAGE_URL)]),
    });
    const r = await harvestPage(d, PAGE, {
      wantPages: 3, pageUrlIncludes: ['/HomeTimeline'], maxRounds: 30,
    });
    expect(r.pages).toBeGreaterThanOrEqual(3);
    expect(r.rounds, `够了还在滚(滚了 ${r.rounds} 轮)`).toBeLessThan(8);
    expect(r.stopReason, '没说清是采够了').toContain('采够');
    expect(r.ok, '采够了却报不完整').toBe(true);
  });

  it('⭐⭐ 「页」**不等于**「轮」 —— 一轮可能 0 页也可能多页', async () => {
    /**
     * ⚠️ 这是用户说「10 页」而不是「10 轮」的全部理由:
     * X 要滚到接近底部才发下一批,滚一轮未必出一页。
     */
    const { d } = deps({
      // 前 4 轮什么都没有,第 5 轮一次出 3 页
      perRound: [[], [], [], [], [item(PAGE_URL), item(PAGE_URL + '?2'), item(PAGE_URL + '?3')]],
    });
    const r = await harvestPage(d, PAGE, {
      wantPages: 2, pageUrlIncludes: ['/HomeTimeline'], maxRounds: 10,
    });
    expect(r.rounds, '空转了 4 轮才出页 —— 轮次与页数本来就不是一回事')
      .toBeGreaterThanOrEqual(5);
    expect(r.pages).toBeGreaterThanOrEqual(2);
  });

  it('⭐ 轮次是**安全网** —— 页数不够也会停', async () => {
    const { d } = deps({ perRound: [[item(PAGE_URL)]] });
    const r = await harvestPage(d, PAGE, {
      wantPages: 99, pageUrlIncludes: ['/HomeTimeline'], maxRounds: 3,
    });
    expect(r.rounds, '安全网没生效').toBeLessThanOrEqual(3);
    expect(r.ok, '不够却报采全').toBe(false);
    expect(r.problems.join(''), '没说清不足').toContain('不足');
  });

  it('⚠️ 不给 wantPages 时滚满轮次(不提前停)', async () => {
    const { d } = deps({ perRound: Array.from({ length: 5 }, () => [item(PAGE_URL)]) });
    const r = await harvestPage(d, PAGE, { maxRounds: 4, pageUrlIncludes: ['/HomeTimeline'] });
    expect(r.rounds).toBe(4);
  });
});

describe('⭐⭐ 每轮展开折叠的推文', () => {
  it('⭐⭐ 每轮都跑一次脚本,产出都收上来', async () => {
    const { d } = deps({ perRound: [[], [], []] });
    const r = await harvestPage(d, PAGE, {
      maxRounds: 3, afterRoundScriptId: 'x.expandAll',
    });
    expect(r.afterRound, '产出没收上来').toHaveLength(3);
    expect((r.afterRound[0] as { expanded: number }).expanded).toBe(1);
  });

  it('⭐⭐⭐ 脚本抛异常**不中断采集**', async () => {
    /**
     * ⚠️ 展开失败只是少几条全文,不该让整轮采集作废 ——
     * 而且症状会变成「滚了一轮就停」,**离真因很远**。
     */
    const { d } = deps({
      perRound: Array.from({ length: 4 }, () => [item(PAGE_URL)]),
      scriptThrows: true,
    });
    const r = await harvestPage(d, PAGE, {
      maxRounds: 4, afterRoundScriptId: 'x.expandAll', pageUrlIncludes: ['/HomeTimeline'],
    });
    expect(r.rounds, '脚本抛异常把采集中断了').toBe(4);
    expect(r.items.length, '数据也丢了').toBeGreaterThan(0);
  });

  it('⚠️ 不给脚本 id 时不跑', async () => {
    const { d, order } = deps({ perRound: [[]] });
    await harvestPage(d, PAGE, { maxRounds: 1 });
    expect(order, '没给脚本却跑了').not.toContain('runScript');
  });
});

describe('⭐⭐ problems:空才算采全', () => {
  it('⭐⭐ 采到响应但**没一条是目标页** → 报问题', async () => {
    /** ⚠️ 2026-10-02 实测:72 条响应里一条推文都没有(全是视频/心跳) */
    const { d } = deps({ perRound: [[item('https://video.twimg.com/a.m4s')]] });
    const r = await harvestPage(d, PAGE, {
      maxRounds: 1, pageUrlIncludes: ['/HomeTimeline'],
    });
    expect(r.ok).toBe(false);
    expect(r.problems.join(''), '没说清「没一条是目标页」').toContain('没有一条');
    expect(r.items.length, '不完整就把数据丢了').toBe(1);
  });

  it('⭐ 不足页数时**带上过程事实** —— 否则分不清采少了还是页面就这么多', async () => {
    const { d } = deps({ perRound: [[item(PAGE_URL)]] });
    const r = await harvestPage(d, PAGE, {
      wantPages: 10, pageUrlIncludes: ['/HomeTimeline'], maxRounds: 2,
    });
    const msg = r.problems.join('');
    expect(msg, '没说滚了几轮').toMatch(/轮/);
    expect(msg, '没说滚了多少像素').toMatch(/px/);
  });

  it('⭐⭐ `ok` 由 `problems` 算出,不是独立字段', async () => {
    const { d } = deps({ perRound: [[item(PAGE_URL)]] });
    const r = await harvestPage(d, PAGE, { maxRounds: 1, pageUrlIncludes: ['/HomeTimeline'] });
    expect(r.ok).toBe(r.problems.length === 0);
  });
});

describe('⭐ 报告里的过程事实', () => {
  it('⭐ 轮次/像素/页数/耗时都如实', async () => {
    const { d } = deps({ perRound: [[item(PAGE_URL)], [item(PAGE_URL + '?2')]] });
    const r = await harvestPage(d, PAGE, { maxRounds: 2, pageUrlIncludes: ['/HomeTimeline'] });
    expect(r.rounds).toBe(2);
    expect(r.scrolledPx).toBe(1000);
    expect(r.pages).toBe(2);
    expect(r.elapsedMs).toBeGreaterThan(0);
  });

  it('⭐ 两条腿都没起来 → 报问题', async () => {
    const { d } = deps({ cdpAttached: false, hookInstalled: false, perRound: [[]] });
    const r = await harvestPage(d, PAGE, { maxRounds: 1 });
    expect(r.ok).toBe(false);
  });
});

/**
 * ⭐⭐⭐ 「先去这一页再采」 —— 2026-10-03
 *
 * ── 为什么编排在底座而不是面板 ──
 * 用户 2026-10-03:「我自己选定一个页面,**点击开始采集,就采集**。」
 * 我加「取长文正文」时第一版在面板 onClick 里串了 `goto` + `harvest`,
 * 被守卫「输出栏只有一个发起动作」逮住 —— 那正是把编排又推回给人。
 */
describe('⭐⭐⭐ gotoPage:先去那一页再采', () => {
  it('⭐⭐ 给了 gotoPage → **去那一页**,不重载当前页', async () => {
    const { d, order } = deps({ perRound: [[item(PAGE_URL)]] });
    await harvestPage(d, PAGE, { gotoPage: { name: 'x.article', params: { articleId: '9' } } });
    expect(order, '没去目标页').toContain('goto:x.article');
    expect(order, '给了目标页还重载当前页 —— 那会留在原页').not.toContain('reload');
  });

  it('⭐⭐ 不给 gotoPage → 照旧重载当前页(原有行为一个字没变)', async () => {
    const { d, order } = deps({ perRound: [[item(PAGE_URL)]] });
    await harvestPage(d, PAGE, {});
    expect(order, '不给目标页却跑去导航了').not.toContain('goto:x.article');
    expect(order, '原有的重载没了').toContain('reload');
  });

  /**
   * ⚠️⚠️ **装腿必须在导航之前** —— 与 reload 同一个竞态:
   * 先导航的话新页首屏那批请求在腿装好之前就发完了。
   */
  it('⚠️⚠️ 顺序:先装腿**再**导航', async () => {
    const { d, order } = deps({ perRound: [[item(PAGE_URL)]] });
    await harvestPage(d, PAGE, { gotoPage: { name: 'x.article' } });
    const legs = order.indexOf('startAcquire');
    const nav = order.indexOf('goto:x.article');
    expect(legs, '没装腿').toBeGreaterThan(-1);
    expect(nav, '没导航').toBeGreaterThan(-1);
    expect(legs, '导航在装腿之前 —— 新页首屏那批请求会漏掉').toBeLessThan(nav);
  });

  /**
   * ⭐⭐⭐ **没去成就别接着采** —— 这是最要紧的一条。
   * 在原页上接着采,会把**原页的数据**当成目标页的交出去:
   * 静默串页,报告看着正常,数据全是错的。
   */
  it('⭐⭐⭐ 导航失败 → **不在原页上接着采**', async () => {
    const { d, order } = deps({ gotoFails: true, perRound: [[item(PAGE_URL)]] });
    const r = await harvestPage(d, PAGE, { gotoPage: { name: 'x.article' } });
    expect(order, '导航失败还接着滚 —— 采回来的是原页的数据(静默串页)')
      .not.toContain('scroll');
    expect(r.ok, '导航都失败了还报成功').toBe(false);
    expect(r.problems.join(''), '没说清为什么失败').toContain('没能去到');
    expect(r.pages, '失败却报采到了页数').toBe(0);
  });
});

/**
 * ⭐⭐⭐ **时间闸要留名** —— 2026-10-06 真机逼出来的。
 *
 * ⚠️⚠️ following 实跑滚了 221 轮 162571px,**正好撞上默认 180s**,
 * 停在 150 人。可停因写的是「**人工取消(第 222 轮前)**」——
 * 而人根本没点(我回头问了,用户答「我没有任何点击」)。
 * ⭐⭐ 停因说错了主语,下一步就查错方向:
 * 我差点去查「谁发了 scrollStop」,而真相是时间安全网自己到期了。
 */
describe('⭐⭐⭐ 早停要说清是谁停的', () => {
  it('⭐⭐⭐ 撞时间上限 → 停因必须说「不是人点的」', async () => {
    const { d } = deps({ initial: [], perRound: [] });
    /** ⭐ 把时钟推过上限 —— 第一轮开头就触发 */
    const rep = await harvestPage(
      { ...d, now: (() => { let t = 0; return () => { t += 100_000; return t; }; })() },
      'p1' as never,
      { maxMs: 1000, wantPages: 99 },
    );
    expect(rep.stopReason, '不许再甩锅给「人工取消」').not.toContain('人工取消');
    expect(rep.stopReason).toContain('时间上限');
    expect(rep.stopReason, '要明说不是人点的').toContain('不是人点的');
  });

  it('⭐⭐ 采够页数停的,停因仍说「已采够」—— 别被时间闸的改动带偏', async () => {
    const item = { url: 'https://x.com/i/api/graphql/a/UserTimeline', text: '{}' } as never;
    const { d } = deps({ initial: [item] });
    const rep = await harvestPage(d, 'p1' as never, {
      wantPages: 1, pageUrlIncludes: ['UserTimeline'],
    });
    expect(rep.stopReason).toContain('已采够');
    expect(rep.stopReason).not.toContain('时间上限');
  });

  it('⭐⭐ 没撞任何闸时,停因照常是滚动自己给的', async () => {
    const { d } = deps({ initial: [] });
    const rep = await harvestPage(d, 'p1' as never, { maxRounds: 2 });
    expect(rep.stopReason).toContain('滚了');
    expect(rep.stopReason).not.toContain('时间上限');
    expect(rep.stopReason).not.toContain('已采够');
  });
});
