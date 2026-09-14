/**
 * ⭐⭐ 采集执行器 —— 把「三个答案」跑起来(`agent/Module5-02-x-pipeline.md` §1.2.2)
 *
 * ── 分工 ──
 *
 * ```
 * 策略(x-collect/)   声明:① 去哪 ② 怎样算到位 ③ 什么时候停   ⚠️ 不执行
 * 本文件             执行:导航 → 等到位 → 落地校验 → 滚 → 每轮回调
 * 调用方             处理:抓到的推怎么过滤、怎么入库          ⚠️ 不关心怎么滚
 * ```
 *
 * ⭐ **本文件不认识任何具体策略**,也不认识「配方」「推文」——
 * 它只认 `CollectStrategy` 契约。加一种新策略,这里一个字都不用改。
 *
 * ── ⚠️ 「滚抓解耦」在这里打了个折扣,是**用户 2026-09-14 拍板的甲案** ──
 *
 * `01-contract.md` §9.5 要求「滚动必须与捕获解耦」。严格照做 = 先滚完再抓,
 * 但那样**必然丢数据**:虚拟列表滚过的 DOM 会被删(血泪②,实测 +0/−1 不涨反降)。
 *
 * ⭐ 所以这里解耦的是「**判停逻辑**」,不是「**抓取时机**」:
 *  - 判停:四种 `CollectStop` 统一在本文件判,策略只声明要哪种 —— **真解耦了**
 *  - 抓取:仍是**边滚边抓**(每轮回调 `onRound`),与现有 `scanRecipe` 行为一致
 *
 * 代价说明白:本文件确实知道「每轮要回调一次让人抓」这件事。
 * 换来的是**行为零变化 + 不丢数据**。这是有意的取舍,不是没做到。
 */

import type { WebContents } from 'electron';
import type {
  CollectArrival,
  CollectParams,
  CollectStop,
  CollectStrategy,
} from '@shared/types/x-collect-strategy';

/** 等元素出现的默认超时 */
const READY_TIMEOUT_MS = 10_000;
const READY_POLL_MS = 500;
/** ⚠️ 轮次**安全阀**,不是判停条件 —— 正常情况靠策略的 stop() 收工 */
const DEFAULT_MAX_ROUNDS = 200;
/** 连续几轮 scrollY 不变才算真到底(血泪③:一轮就停是漏数据元凶) */
const STUCK_ROUNDS = 3;

export type RoundInput = {
  readonly round: number;
  /** 本轮从页面上抓到的东西 —— 形状由调用方的 capture 决定,本文件不解释 */
  readonly items: readonly unknown[];
};

export type CollectRunOptions = {
  /** ⭐ 每轮抓一次。⚠️ 返回本轮抓到的东西,供判停用(itemCount / olderThan 要看它) */
  capture(wc: WebContents, round: number): Promise<readonly unknown[]>;
  /** 每轮抓完后的处理(过滤/入库)。本文件不关心它做什么 */
  onRound?(input: RoundInput): Promise<void> | void;
  /**
   * ⭐ 从一条 item 取发布时间(epoch ms)—— `olderThan` 判停要用。
   * 取不到返回 null。⚠️ 不给这个函数时,`olderThan` 退化成永不触发(见下)。
   */
  timeOf?(item: unknown): number | null;
  /** 累计去重后的条数 —— `itemCount` 判停要用。不给则用「本轮条数累加」 */
  countOf?(): number;
  /** 检查是否被用户中止 */
  isAborted?(): boolean;
  maxRounds?: number;
  /**
   * 等页面到位的超时。
   *
   * ⚠️ 开成选项是因为**调用方配不了就没法测** —— 默认 10s 超过了测试框架的
   * 用例超时,于是「超时会不会 fail loud」这条守卫根本跑不完(实测撞到过)。
   * 能被测到的 fail loud 才算数。
   */
  readyTimeoutMs?: number;
  /**
   * ⭐ 覆盖策略给的停止判据。
   *
   * 策略的 `stop()` 是**默认值**;调用方手上有更准的上下文时可以覆盖 ——
   * 与 `01-contract.md` §9.5「停的条件由调用方传」同源:
   * **底座不替调用方决定什么时候算够了**。
   *
   * 典型用例:`scanRecipe` 已按 `computeScrollDepthMs` 算好本轮深度
   * (含 lastRunAt / bufferHours / 12h 封顶的全部口径),直接喂进来,
   * 免得同一个量在策略里再算一遍、日后两处漂移。
   */
  stopOverride?: CollectStop;
  /** 每轮滚完等多久(懒加载补货)。默认 1500~2700ms 抖动 */
  settleMs?: number;
};

export type CollectRunReport = {
  readonly rounds: number;
  readonly stopReason: string;
  readonly reachedBottom: boolean;
  /** ⚠️ 中止/异常都要如实说,不许静默当成「正常跑完」 */
  readonly aborted: boolean;
};

/**
 * 等页面到位。
 *
 * ⚠️ 轮询里的 catch **不是兜底掩盖错误**:X 是 SPA,进站后还会自己再跳一次,
 * 旧文档正在拆、新文档还没 commit 的窗口里注入必被 Electron 拒。
 * 真正的失败判据是**超时**,由下面的 throw 负责 —— fail loud 那条路没变。
 */
async function waitArrived(
  wc: WebContents,
  arrival: CollectArrival,
  timeoutMs = READY_TIMEOUT_MS,
): Promise<void> {
  const selector = arrival.awaitSelector ?? 'article[data-testid="tweet"]';
  const script = `document.querySelectorAll(${JSON.stringify(selector)}).length`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await wc.executeJavaScript(script).catch(() => null);
    if (typeof count === 'number' && count > 0) return;
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }
  throw new Error(`[x-collect-runner] 等 ${selector} 超时(${timeoutMs}ms)`);
}

/**
 * ⭐⭐ 落地校验 —— **这条不是可有可无的**。
 *
 * 用户 2026-09-07 实测:采回来的推大多既不含关键词也不含求助信号,
 * 真因不是 X 搜索「宽松」,而是**压根在读别的页面**(被弹回首页 / 路由接管),
 * 而「页面上有没有推文」这个判据对此完全无感。
 */
function assertLanded(wc: WebContents, arrival: CollectArrival, describe: string): void {
  const landed = wc.getURL();
  if (!landed.includes(arrival.urlIncludes)) {
    throw new Error(
      `[x-collect-runner] ${describe}:没落在目标页(要求 URL 含 "${arrival.urlIncludes}"),` +
        `实际在 ${landed.slice(0, 80)} —— 本轮中止` +
        '(继续抓只会把别的页面当成目标结果入库)',
    );
  }
}

/** 滚一屏。主文档滚不动就找内部滚动容器(X 时间线的形态) */
const SCROLL_SCRIPT = `(function () {
  var y = window.scrollY;
  window.scrollBy(0, window.innerHeight * 0.85);
  if (window.scrollY === y) {
    var all = document.querySelectorAll('div');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.scrollHeight > el.clientHeight + 400) {
        el.scrollTop = el.scrollTop + el.clientHeight * 0.85; break;
      }
    }
  }
})()`;

/**
 * ⭐ 判停 —— 四种 `CollectStop` 统一在这里判。
 *
 * ⚠️ 返回 null 表示「继续滚」。
 */
function shouldStop(
  stop: CollectStop,
  ctx: { round: number; items: readonly unknown[]; total: number; timeOf?: (i: unknown) => number | null },
): string | null {
  switch (stop.kind) {
    case 'rounds':
      return ctx.round + 1 >= stop.n ? `已滚满 ${stop.n} 轮` : null;

    case 'itemCount':
      return ctx.total >= stop.n ? `已收够 ${ctx.total}/${stop.n} 条` : null;

    case 'olderThan': {
      // ⚠️ 没给 timeOf 就**永不触发**,而不是当成「立刻停」——
      // 后者会让采集一轮就收工,现象是「采集不工作」且毫无线索。
      if (!ctx.timeOf) return null;
      const times = ctx.items
        .map((i) => ctx.timeOf!(i))
        .filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
      if (!times.length) return null;
      const oldest = Math.min(...times);
      return oldest < stop.beforeTs
        ? `已滚过本轮深度(最旧一条 ${new Date(oldest).toISOString()} < ${new Date(stop.beforeTs).toISOString()})`
        : null;
    }

    case 'atBottom':
      // 真到底由外层的 stuckRounds 统一判(它需要跨轮的 scrollY 状态)
      return null;
  }
}

/**
 * ⭐⭐ 跑一个策略。
 *
 * **本文件不认识任何具体策略** —— 它只认契约。
 */
export async function runCollectStrategy(
  strategy: CollectStrategy,
  params: CollectParams,
  wc: WebContents,
  options: CollectRunOptions,
): Promise<CollectRunReport> {
  // ① 去哪
  const target = strategy.target(params);
  // ② 怎样算到位
  const arrival = strategy.arrived(params);
  // ③ 什么时候停 —— 策略给默认值,调用方可覆盖(见 stopOverride 注释)
  const stop = options.stopOverride ?? strategy.stop(params);

  console.log(`[x-collect-runner] ${target.describe} → ${target.url}`);

  // ⚠️ loadURL 要 await:不等它,下面的轮询会在旧文档正在拆卸时就注入被拒。
  // ⚠️ 但 await 本身也可能 reject —— X 常见 ERR_ABORTED(它自己的路由接管了
  //   这次导航),那**不是失败**:页面照样会到位,交给 waitArrived 判定。
  //   真失败由 waitArrived 超时 throw,fail loud 这条路没变。
  await wc.loadURL(target.url).catch((err: unknown) => {
    console.warn('[x-collect-runner] loadURL 未正常 resolve(X 常自行接管导航),继续等元素:', err);
  });
  await waitArrived(wc, arrival, options.readyTimeoutMs);
  assertLanded(wc, arrival, target.describe);

  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  let lastScrollY = -1;
  let stuckRounds = 0;
  let total = 0;
  let rounds = 0;
  let reachedBottom = false;
  let aborted = false;
  let stopReason = `达到轮次安全阀 ${maxRounds}`;

  for (let round = 0; round < maxRounds; round++) {
    rounds = round + 1;

    if (options.isAborted?.()) {
      aborted = true;
      stopReason = '用户中止';
      break;
    }

    // ── 抓(甲案:边滚边抓)──
    const items = await options.capture(wc, round);
    total = options.countOf ? options.countOf() : total + items.length;

    await options.onRound?.({ round, items });

    // ── 判停(策略声明的那种)──
    const reason = shouldStop(stop, { round, items, total, timeOf: options.timeOf });
    if (reason) {
      stopReason = reason;
      break;
    }

    // ── 滚 ──
    await wc.executeJavaScript(SCROLL_SCRIPT).catch(() => {});
    const settle = options.settleMs ?? 1500 + Math.random() * 1200;
    await new Promise((r) => setTimeout(r, settle));

    // ⚠️ 滚动**之后**回读才是真实位置(血泪①:smooth 是异步的,曾因此测了个寂寞)
    const y = (await wc.executeJavaScript('window.scrollY').catch(() => -1)) as number;
    if (y === lastScrollY) {
      stuckRounds++;
      // ⭐ 血泪③:只有连续多轮不变才算真到底。一轮就停是漏数据元凶
      if (stuckRounds >= STUCK_ROUNDS) {
        reachedBottom = true;
        stopReason = `滚不动了(scrollY=${y} 连续 ${STUCK_ROUNDS} 轮未变)`;
        break;
      }
    } else {
      stuckRounds = 0;
    }
    lastScrollY = y;
  }

  console.log(`[x-collect-runner] ${target.describe} 结束:${rounds} 轮,${stopReason}`);
  return { rounds, stopReason, reachedBottom, aborted };
}
