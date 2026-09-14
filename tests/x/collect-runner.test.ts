/**
 * ⭐⭐ 采集执行器守卫(`x-collect-runner.ts`)
 *
 * 守的是「三个答案」真的被执行,以及**四条血泪没在重写里丢掉**。
 *
 * ⚠️ 用**假 webContents**(鸭子类型),不 mock electron ——
 * `x-collect-runner.ts` 只 `import type { WebContents }`,运行期不碰 electron,
 * 这正是「执行器可单测」的前提。若将来有人在里面 `import { webContents }`,
 * 本文件会因加载失败而红 —— 那是**该红**。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WebContents } from 'electron';
import { runCollectStrategy } from '@platform/main/x/x-collect-runner';
import type { CollectStrategy, CollectStop } from '@capabilities/x-collect';

const RUNNER_SRC = readFileSync(
  join(process.cwd(), 'src/platform/main/x/x-collect-runner.ts'), 'utf-8',
).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** 假页面:模拟滚动位置、URL、元素数 */
class FakePage {
  scrollY = 0;
  url: string;
  /** 每滚一轮增加多少 scrollY;设 0 = 滚不动(到底) */
  step: number;
  elementCount = 5;
  loadCalls: string[] = [];

  constructor(opts: { url?: string; step?: number } = {}) {
    this.url = opts.url ?? 'https://x.com/search?q=test&f=live';
    this.step = opts.step ?? 800;
  }

  /**
   * ⚠️⚠️ **判据必须精确,别用 includes 猜**(2026-09-14 探针实证后改)。
   *
   * 初稿按关键词猜:`includes('querySelectorAll') && includes('length')` 判「等元素」。
   * 可滚动脚本里也有 `document.querySelectorAll('div')` 和 `all.length` ——
   * **于是滚动脚本被当成了等元素**,返回 5、`scrollY` 永远是 0,
   * 「能滚」与「滚不动」两个场景**跑出完全一样的结果**(探针:一次 `scroll->` 都没有)。
   *
   * 三条守卫因此假红。⭐ 教训:假页面要照被测代码的**真实脚本文本**分派,
   * 凭印象猜关键词,测的就不是同一件事。
   */
  asWebContents(): WebContents {
    const page = this;
    return {
      async loadURL(u: string) { page.loadCalls.push(u); page.url = u; },
      getURL: () => page.url,
      async executeJavaScript(script: string) {
        // 滚动脚本:唯一含 scrollBy 的。⚠️ 必须排在「等元素」前面
        if (script.includes('scrollBy')) { page.scrollY += page.step; return undefined; }
        // 回读位置:整段就是这一个表达式
        if (script.trim() === 'window.scrollY') return page.scrollY;
        // 等元素:整段是 document.querySelectorAll(<selector>).length
        if (script.startsWith('document.querySelectorAll')) return page.elementCount;
        throw new Error(`假页面不认识这段脚本: ${script.slice(0, 60)}`);
      },
    } as unknown as WebContents;
  }
}

function strategyWith(stop: CollectStop, over: Partial<CollectStrategy> = {}): CollectStrategy {
  return {
    id: 'fake', name: 'fake', description: 'fake strategy', paramsSchema: [],
    target: () => ({ url: 'https://x.com/search?q=test&f=live', describe: '假策略' }),
    arrived: () => ({ urlIncludes: '/search' }),
    stop: () => stop,
    ...over,
  };
}

const noopCapture = async () => [];

describe('⭐⭐ 三个答案真的被执行', () => {
  it('⭐ ① target() 的 URL 真的被导航到', async () => {
    const page = new FakePage();
    await runCollectStrategy(
      strategyWith({ kind: 'rounds', n: 1 }), {}, page.asWebContents(),
      { capture: noopCapture },
    );
    expect(page.loadCalls).toEqual(['https://x.com/search?q=test&f=live']);
  });

  it('⭐⭐ ② 落地校验:URL 不含要求片段 → **抛**,不继续抓', async () => {
    // 用户 2026-09-07 实测:被弹回首页时「页面上有推文」照样成立,
    // 于是把首页时间线当成搜索结果整批入库
    const page = new FakePage({ url: 'https://x.com/home' });
    const strategy = strategyWith({ kind: 'rounds', n: 1 }, {
      target: () => ({ url: 'https://x.com/home', describe: '假策略' }),
    });
    await expect(
      runCollectStrategy(strategy, {}, page.asWebContents(), { capture: noopCapture }),
    ).rejects.toThrow(/没落在目标页/);
  });

  it('⭐ 等元素超时 → 抛(fail loud,不静默当成空结果)', async () => {
    const page = new FakePage();
    page.elementCount = 0;   // 永远等不到
    await expect(
      runCollectStrategy(strategyWith({ kind: 'rounds', n: 1 }), {}, page.asWebContents(), {
        capture: noopCapture,
        // ⚠️ 必须传短超时:默认 10s > vitest 用例超时 5s,用例会先超时 ——
        //    于是「超时会不会 fail loud」这条**根本跑不完**(实测撞到过)。
        //    ⭐ 能被测到的 fail loud 才算数,故执行器把它开成了选项。
        readyTimeoutMs: 100,
      }),
    ).rejects.toThrow(/超时/);
  });
});

describe('⭐⭐ 四种停法各自生效', () => {
  it('rounds:滚满 n 轮就停', async () => {
    const page = new FakePage();
    const r = await runCollectStrategy(
      strategyWith({ kind: 'rounds', n: 3 }), {}, page.asWebContents(),
      { capture: noopCapture, settleMs: 0 },
    );
    expect(r.rounds).toBe(3);
    expect(r.stopReason).toContain('3 轮');
  });

  it('itemCount:收够 n 条就停', async () => {
    const page = new FakePage();
    let total = 0;
    const r = await runCollectStrategy(
      strategyWith({ kind: 'itemCount', n: 10 }), {}, page.asWebContents(),
      {
        capture: async () => { total += 4; return [1, 2, 3, 4]; },
        countOf: () => total,
        settleMs: 0,
      },
    );
    expect(r.rounds, '4+4+4=12 ≥ 10,第 3 轮停').toBe(3);
    expect(r.stopReason).toContain('收够');
  });

  it('⭐⭐ olderThan:滚过时间点就停(76 倍无用功那条)', async () => {
    const page = new FakePage();
    const cutoff = Date.now() - 12 * 3_600_000;
    // 第 3 轮开始返回「很旧」的条目
    let round = 0;
    const r = await runCollectStrategy(
      strategyWith({ kind: 'olderThan', beforeTs: cutoff }), {}, page.asWebContents(),
      {
        capture: async () => {
          round += 1;
          const ts = round >= 3 ? cutoff - 3_600_000 : Date.now() - 60_000;
          return [{ ts }];
        },
        timeOf: (i) => (i as { ts: number }).ts,
        settleMs: 0,
      },
    );
    expect(r.rounds).toBe(3);
    expect(r.stopReason).toContain('已滚过本轮深度');
  });

  it('⭐⭐ olderThan 缺 timeOf → **永不触发**,不是立刻停', async () => {
    // ⚠️ 若写成「取不到时间就停」,采集会一轮收工,现象是「采集不工作」且毫无线索
    const page = new FakePage();
    const r = await runCollectStrategy(
      strategyWith({ kind: 'olderThan', beforeTs: Date.now() }), {}, page.asWebContents(),
      { capture: async () => [{ ts: 1 }], settleMs: 0, maxRounds: 4 },   // 不给 timeOf
    );
    expect(r.rounds, '应一直滚到安全阀,不是第 1 轮就停').toBe(4);
  });

  it('⭐⭐ atBottom:靠 scrollY 连续 3 轮不变(血泪③:一轮就停是漏数据元凶)', async () => {
    const page = new FakePage({ step: 0 });   // 滚不动
    const r = await runCollectStrategy(
      strategyWith({ kind: 'atBottom' }), {}, page.asWebContents(),
      { capture: noopCapture, settleMs: 0 },
    );
    expect(r.reachedBottom).toBe(true);
    expect(r.stopReason).toContain('连续 3 轮未变');
    /**
     * ⚠️ **是 4 轮不是 3 轮 —— 别"修"回去**(2026-09-14 探针实证)。
     *
     * 时序:`lastScrollY` 初值 -1,而页面初始 scrollY=0。
     *   第 1 轮 回读 0 ≠ -1 → stuck=0(这一轮只是**建立基线**)
     *   第 2/3/4 轮 回读 0 === 0 → stuck 累到 3 → 判到底
     *
     * ⭐ 「连续 3 轮不变」数的是**比较次数**,第 1 轮没有可比的前值。
     * 期望写 3 是把「建立基线那轮」也算成了比较 —— 我初稿就错在这里。
     */
    expect(r.rounds, '1 轮建立基线 + 3 轮比较 = 4').toBe(4);
  });

  it('⭐ 还能滚时不许提前认定到底(反向锁)', async () => {
    const page = new FakePage({ step: 800 });
    const r = await runCollectStrategy(
      strategyWith({ kind: 'atBottom' }), {}, page.asWebContents(),
      { capture: noopCapture, settleMs: 0, maxRounds: 5 },
    );
    expect(r.reachedBottom).toBe(false);
    expect(r.stopReason).toContain('安全阀');
  });
});

describe('⭐ stopOverride:调用方可覆盖策略的默认停法', () => {
  it('⭐⭐ 给了 stopOverride 就**用它**,不用策略的 stop()', async () => {
    const page = new FakePage();
    // 策略说「滚 99 轮」,调用方覆盖成「滚 2 轮」
    const r = await runCollectStrategy(
      strategyWith({ kind: 'rounds', n: 99 }), {}, page.asWebContents(),
      { capture: noopCapture, settleMs: 0, stopOverride: { kind: 'rounds', n: 2 } },
    );
    expect(r.rounds, '应听调用方的 2,不是策略的 99').toBe(2);
  });

  it('⭐ 不给 stopOverride 时仍用策略的(反向锁:不是永远忽略策略)', async () => {
    const page = new FakePage();
    const r = await runCollectStrategy(
      strategyWith({ kind: 'rounds', n: 2 }), {}, page.asWebContents(),
      { capture: noopCapture, settleMs: 0 },
    );
    expect(r.rounds).toBe(2);
  });
});

describe('⭐ 边滚边抓(甲案)与中止', () => {
  it('⭐ 每轮都回调一次 onRound —— 不是滚完再抓(虚拟列表会删 DOM)', async () => {
    const page = new FakePage();
    const seen: number[] = [];
    await runCollectStrategy(
      strategyWith({ kind: 'rounds', n: 3 }), {}, page.asWebContents(),
      {
        capture: async (_wc, round) => [round],
        onRound: ({ round }) => { seen.push(round); },
        settleMs: 0,
      },
    );
    expect(seen, '三轮各回调一次').toEqual([0, 1, 2]);
  });

  it('⭐ 中止要如实报 aborted,不许装成正常跑完', async () => {
    const page = new FakePage();
    let n = 0;
    const r = await runCollectStrategy(
      strategyWith({ kind: 'rounds', n: 99 }), {}, page.asWebContents(),
      { capture: noopCapture, isAborted: () => ++n > 2, settleMs: 0 },
    );
    expect(r.aborted).toBe(true);
    expect(r.stopReason).toContain('中止');
  });
});

describe('⭐⭐ 执行器不认识任何具体策略', () => {
  it('源码里零处策略名 / 配方 / 推文概念', () => {
    for (const banned of ['keyword', 'author-watch', 'authorWatch', 'SearchRecipe', 'recipe', 'tweet_id']) {
      expect(RUNNER_SRC, `执行器提到了 "${banned}" —— 它只该认 CollectStrategy 契约`)
        .not.toContain(banned);
    }
  });

  it('⭐ 零处 switch (strategy.id) 这类分支', () => {
    expect(RUNNER_SRC).not.toMatch(/switch\s*\(\s*\w*\.?(strategyId|strategy\.id)\s*\)/);
  });

  it('守卫自检:执行器确实处理了全部四种 stop.kind(否则上面是空转的)', () => {
    for (const kind of ['rounds', 'itemCount', 'olderThan', 'atBottom']) {
      expect(RUNNER_SRC, `没处理 stop.kind='${kind}'`).toContain(`'${kind}'`);
    }
  });
});
