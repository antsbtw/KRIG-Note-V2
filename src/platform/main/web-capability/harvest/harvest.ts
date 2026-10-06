/**
 * `harvestPage` —— ⭐⭐⭐ **「选好页面,点一下,它自己采完」**
 *
 * ── 用户 2026-10-03 ──
 * 「应该是反过来,**我自己选定一个页面,点击开始采集,就采集**,
 * 　采集完毕后再验证采集的内容才对。」「每次采集 **10 页**。」
 *
 * ⚠️ 此前面板上有**五个**要人点的动作,而且**顺序错了就采不到** ——
 * 那是把编排推给了人。
 *
 * ── ⭐ 它替人做的编排(每一步都有实测来历)──
 *
 * ① **先装腿再重载** —— X 的首批推文在页面加载时就发完了,
 *    装腿晚于它就永远收不到(2026-10-02 实测:capture-start 与
 *    page-created 同一秒,而 HomeTimeline 早已发完)
 * ② **滚动触发下一页** —— X 要滚到接近底部才请求下一批
 * ③ **每轮滚完展开折叠的推文** —— 折叠时正文只有开头,剩下的没渲染
 * ④ **采够页数就停** —— 不是滚满轮数(轮次只是安全网)
 *
 * ⚠️ 本层**零 Electron、零站点知识**:什么算「一页」、每轮跑什么脚本,
 * 全由调用方用 `HarvestPlan` 表达。
 */

import type { PageId } from '../page/types';
import type { AcquiredItem } from '../acquire/types';
import type { HarvestDeps, HarvestPlan, HarvestReport } from './types';

/** 装腿之后等多久再重载 —— 让钩子注入生效 */
export const SETTLE_BEFORE_RELOAD_MS = 300;
/** 重载之后等多久再开始滚 —— 让首屏请求发出去 */
export const SETTLE_AFTER_RELOAD_MS = 1600;
/** 轮次安全网默认值 */
export const DEFAULT_MAX_ROUNDS = 40;
/** 时间安全网默认值 */
export const DEFAULT_MAX_MS = 180_000;

/**
 * ⭐⭐ 数「有几页」。
 *
 * ── ⚠️ 为什么判据要支持正则(2026-10-03 实测踩到)──
 *
 * 只支持「URL 含某子串」时,业务只能写死一张操作名清单 ——
 * 而 **X 改版加了 `UserOriginalsTimeline`**,清单里没有 →
 * 滚了 60 轮 44621px 却**采到 0 页**,而数据就在眼前。
 * ⭐ `feedback-search-community-before-sixth-guess`:
 * **平台侧改动不可能从自家代码推断出来** —— 所以判据要能表达
 * 「凡是 `*Timeline` 都算」这种**抗改版**的规则。
 *
 * ⚠️ 判据仍是**字符串**(以 `re:` 开头的当正则)——
 * 底座照样不认识任何站点,也收不了函数(函数过不了 IPC)。
 * ⚠️ 正则非法时**如实报**不静默跳过:静默会让「判据写错了」
 * 表现成「这页没数据」,方向完全相反。
 */
function matchPage(url: string, want: readonly string[]): boolean {
  for (const w of want) {
    if (!w.startsWith('re:')) {
      if (url.includes(w)) return true;
      continue;
    }
    try {
      if (new RegExp(w.slice(3)).test(url)) return true;
    } catch (e) {
      console.warn(`[web.harvest] 页面判据不是合法正则,已忽略: ${w}`, e);
    }
  }
  return false;
}

function countPages(items: readonly AcquiredItem[], want: readonly string[]): number {
  if (want.length === 0) return 0;
  return items.filter((x) => matchPage(x.url, want)).length;
}

/**
 * ⭐⭐⭐ 采这一页。
 *
 * ⚠️ 返回报告而不抛 —— **`problems` 空才算采全**,
 * 不空时数据照样给(采了一半也是真的)。
 */
export async function harvestPage(
  deps: HarvestDeps,
  pageId: PageId,
  plan: HarvestPlan = {},
): Promise<HarvestReport> {
  const t0 = deps.now();
  const pageWant = plan.pageUrlIncludes ?? [];
  const maxRounds = plan.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const maxMs = plan.maxMs ?? DEFAULT_MAX_MS;
  const afterRoundOut: unknown[] = [];

  // ── ① 先装腿 ──
  const legs = await deps.startAcquire(pageId, plan.noisyUrlSubstrings);

  /**
   * ── ② 再去页面 ──
   * ⚠️ 顺序不能反:先导航/重载的话首屏那批请求在装腿之前就发完了。
   * ⭐ 装腿后等一下,让页面钩子的注入生效(它要在站点脚本之前跑)。
   *
   * ⭐⭐ 给了 `gotoPage` 就**去那一页**,否则重载当前页 ——
   * 两者占同一个位置,因为解的是同一个竞态。
   */
  await deps.wait(SETTLE_BEFORE_RELOAD_MS);
  if (plan.gotoPage !== undefined) {
    const went = await deps.goto(pageId, plan.gotoPage.name, plan.gotoPage.params);
    if (!went) {
      /**
       * ⚠️ 没去成就**别接着采** —— 接着采会在**原来那页**上滚,
       * 然后把原页的数据当成目标页的交出去(静默串页,最难查的一种)。
       */
      const acq0 = deps.finishAcquire(pageId, t0);
      return {
        ok: false,
        problems: [`没能去到 ${plan.gotoPage.name} —— 没有在原页上接着采（那会串页）`],
        items: acq0.items, pages: 0, afterRound: [],
        rounds: 0, scrolledPx: 0, reachedBottom: false,
        stopReason: '导航失败', elapsedMs: deps.now() - t0, legs: acq0.legs,
      };
    }
  } else {
    deps.reload(pageId);
  }
  await deps.wait(SETTLE_AFTER_RELOAD_MS);

  // ── ③④ 滚动 + 每轮展开,采够页数就停 ──
  let stoppedByPages = false;
  /** ⭐ 时间安全网触发过没有 —— 不记的话停因会甩锅给「人工取消」 */
  let stoppedByTime = false;
  const scroll = await deps.scroll(pageId, {
    maxRounds,
    /**
     * ⭐ 每轮滚完:先跑业务的脚本(展开折叠),再看够不够。
     * ⚠️ 脚本失败**不中断** —— 展开失败只是少几条全文,不该让整轮作废。
     */
    afterRound: async () => {
      if (plan.afterRoundScriptId) {
        try {
          afterRoundOut.push(await deps.runScript(pageId, plan.afterRoundScriptId));
        } catch { /* 业务的事做砸了不影响采集 */ }
      }
    },
    /**
     * ⭐⭐ **采够页数就停** —— 用户:「每次采集 10 页」。
     * ⚠️ 在**每轮开头**判:这时上一轮的产出已经进来了。
     * ⚠️ 也看时间安全网 —— 防「页面一直给、永远停不下来」。
     */
    shouldStop: () => {
      /**
       * ⭐⭐⭐ **时间闸要留名** —— 2026-10-06 真机。
       *
       * ⚠️⚠️ 原先这里 `return true` 但**不留任何标记**,
       * 于是滚动循环按「外面叫停了」处理,停因写成
       * **「人工取消(第 222 轮前)」** —— 而人根本没点。
       * 我因此回头问用户「是你点的吗」,用户答「我没有任何点击」。
       * ⭐⭐ `feedback-dont-record-own-choices-as-user-requirements` 的同族:
       * **把自己做的决定记成别人做的**。停因是用来定位的,
       * 它说错了主语,下一步就查错了方向。
       */
      if (deps.now() - t0 > maxMs) { stoppedByTime = true; return true; }
      if (plan.wantPages === undefined) return false;
      const got = countPages(deps.peekAcquire(pageId), pageWant);
      if (got >= plan.wantPages) { stoppedByPages = true; return true; }
      return false;
    },
  });

  // ── ⑤ 停止采集,出报告 ──
  const acq = deps.finishAcquire(pageId, t0);
  const pages = countPages(acq.items, pageWant);

  /**
   * ⭐⭐ `problems` —— 空才算采全。
   * ⚠️ 每条都要能指向**该查哪里**,不是泛泛说「失败了」。
   */
  const problems: string[] = [...acq.problems];
  if (pageWant.length > 0 && pages === 0 && acq.items.length > 0) {
    problems.push(
      `采到 ${acq.items.length} 条响应,但**没有一条**是目标页面的数据`
      + ` —— 可能页面不对,或该站点的接口路径变了`,
    );
  }
  if (plan.wantPages !== undefined && pages < plan.wantPages) {
    problems.push(
      `只采到 ${pages} 页,不足 ${plan.wantPages} 页`
      + `(滚了 ${scroll.rounds} 轮 ${Math.round(scroll.scrolledPx)}px,${scroll.stopReason})`
      + (stoppedByTime
        ? ` —— **是撞上 ${Math.round(maxMs / 1000)}s 时间上限停的**,名单多半还有,`
          + '调大 maxMs 或分批采'
        : ' —— 可能这一页就这么多,或滚动轮次上限太小'),
    );
  }

  return {
    ok: problems.length === 0,
    problems,
    items: acq.items,
    pages,
    afterRound: afterRoundOut,
    rounds: scroll.rounds,
    scrolledPx: scroll.scrolledPx,
    reachedBottom: scroll.reachedBottom,
    /**
     * ⚠️ 三种「早停」要分得开 —— 它们的下一步完全不同:
     * 采够了=正常收工 / 到时间=**调大 maxMs 或分批** / 人工取消=人点的。
     */
    stopReason: stoppedByPages
      ? `已采够 ${pages} 页(目标 ${plan.wantPages})`
      : stoppedByTime
        ? `到时间上限 ${Math.round(maxMs / 1000)}s 停的（不是人点的）`
        : scroll.stopReason,
    elapsedMs: deps.now() - t0,
    legs: acq.legs,
  };
}
