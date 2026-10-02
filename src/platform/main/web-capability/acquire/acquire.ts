/**
 * `acquireContent` —— ⭐⭐ **「把这一页的内容取全」** 这一件事
 *
 * 用户 2026-10-02:
 * 「你要构建**获取完整信息的函数/或者类**…上层只关注某个具体的目标呀。」
 *
 * ⚠️ 本层**零 Electron、零站点知识** —— 所有外部动作走 `AcquireDeps`。
 *
 * ── ⭐ 它替调用方做的决定(这正是「上层不必关心」的那些)──
 *
 * ① **所有腿一起上**,不让调用方选
 * ② **先重载再采** —— 解「装腿晚于首次请求」的竞态
 *    (2026-10-02 实测:capture-start 与 page-created 同一秒,
 *     而 HomeTimeline 早已发完 → 捕到 0 条有用数据)
 * ③ **滚到「够了」或「真的到底」为止**,不是滚固定轮数
 *    (`feedback-pdca-close-the-loop`:停止由**数据判据**决定,
 *     不由预先猜的次数 —— 轮数当目标填 30 实采 250)
 * ④ **每轮回读真实产出量** —— 同一条铁律的第①点
 */

import type { PageId } from '../page/types';
import type { AcquireDeps, AcquireGoal, AcquiredItem, AcquireReport } from './types';

/** 轮次安全网默认值。⚠️ **安全网不是目标** —— 到底了就提前停 */
export const DEFAULT_MAX_ROUNDS = 60;
/** 时间安全网默认值 */
export const DEFAULT_MAX_MS = 120_000;
/** 每轮之后等多久(让懒加载补货) */
export const SETTLE_MS = 800;
/**
 * 连续几轮**既没新内容也没滚动**才算到底。
 * ⚠️ 一轮就停是血泪:时间线深处的懒加载经常要等好几秒,
 * **急着停是漏数据元凶**(`control.ts` 同款理由)。
 */
export const STUCK_ROUNDS = 3;

function hits(item: AcquiredItem, want: readonly string[]): boolean {
  if (want.length === 0) return true;
  return want.some((w) => item.url.includes(w));
}

/**
 * ⭐⭐⭐ 取全这一页的内容。
 *
 * ⚠️ 返回 `AcquireReport` 而不是抛 —— **`problems` 空才算采全**,
 * 不空时数据照样给(采了一半也是真的),由调用方决定够不够。
 */
export async function acquireContent(
  deps: AcquireDeps,
  pageId: PageId,
  goal: AcquireGoal = {},
): Promise<AcquireReport> {
  const want = goal.wantUrlIncludes ?? [];
  const maxRounds = goal.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const maxMs = goal.maxMs ?? DEFAULT_MAX_MS;
  const t0 = deps.now();

  // ── ① 所有腿一起上 ──
  const legs = await deps.startAll(pageId);

  /**
   * ── ② ⭐ 先重载 ──
   * ⚠️ 不重载的话首屏那批请求早已发完 —— 实测正是这个让「捕到 0 条有用数据」。
   * ⭐ 重载后页面从第一条请求开始,两条腿都在。
   */
  deps.reload(pageId);
  await deps.wait(SETTLE_MS * 2);

  let rounds = 0;
  let scrolledPx = 0;
  let stuck = 0;
  let stopReason = `达到轮次安全网 ${maxRounds}`;
  let lastWanted = countWanted(deps.snapshot(pageId), want);

  // ── ③④ 滚到「够了」或「真到底」为止,每轮回读真实产出 ──
  for (let i = 1; i <= maxRounds; i += 1) {
    rounds = i;

    if (deps.now() - t0 > maxMs) {
      stopReason = `达到时间安全网 ${maxMs}ms`;
      break;
    }

    /**
     * ⭐ **先判够不够,再决定要不要继续滚** ——
     * 放在轮次开头:上一轮的产出已经回读过了。
     */
    if (goal.wantAtLeast !== undefined && lastWanted >= goal.wantAtLeast) {
      stopReason = `已采够 ${lastWanted} 条(目标 ${goal.wantAtLeast})`;
      rounds = i - 1;
      break;
    }

    const moved = await deps.scrollOnce(pageId);
    scrolledPx += moved;
    await deps.wait(SETTLE_MS);

    /**
     * ⭐⭐ **回读真实产出量** —— `feedback-pdca-close-the-loop` 铁律①:
     * 「反复执行的循环必须『判断-执行-再判断-再执行』」。
     * ⚠️ 我踩过:数错元素致该数恒为 0,**等于没在看**。
     */
    const nowWanted = countWanted(deps.snapshot(pageId), want);
    const gained = nowWanted - lastWanted;
    lastWanted = nowWanted;

    /**
     * ⚠️ 到底的判据是**「既没新内容、也没滚动」连续 N 轮** ——
     * 只看滚动会漏掉「页面在加载但高度没变」,
     * 只看内容会漏掉「内容没变但还能滚」。
     */
    if (gained === 0 && moved <= 0) {
      stuck += 1;
      if (stuck >= STUCK_ROUNDS) {
        stopReason = `连续 ${STUCK_ROUNDS} 轮无新内容且滚不动 —— 到底了`;
        break;
      }
    } else {
      stuck = 0;
    }
  }

  deps.stopAll(pageId);

  const items = [...deps.snapshot(pageId)];
  const wanted = countWanted(items, want);
  const legStats = deps.legStats(pageId);
  const fromCount = (k: AcquiredItem['from']): number => items.filter((x) => x.from === k).length;

  /**
   * ⭐⭐ `problems` —— 空才算采全。
   * ⚠️ 每一条都要能指向**该查哪里**,不是泛泛说「失败了」。
   */
  const problems: string[] = [];
  if (!legs.cdpAttached && !legs.hookInstalled) {
    problems.push('两条获取腿都没起来 —— 什么也采不到(CDP attach 失败且页面钩子装不上)');
  }
  if (items.length === 0) {
    problems.push('一条响应都没有 —— 页面可能没发请求,或两条腿都失效');
  } else if (want.length > 0 && wanted === 0) {
    problems.push(
      `采到 ${items.length} 条响应,但**没有一条**命中目标(${want.join(' / ')})`
      + ' —— 可能页面不对,或该站点的接口路径变了',
    );
  }
  if (goal.wantAtLeast !== undefined && wanted < goal.wantAtLeast) {
    problems.push(`只采到 ${wanted} 条,不足目标 ${goal.wantAtLeast} 条 —— 结果不完整`);
  }
  /**
   * ⚠️ 只有一条腿有产出时**也要说** —— 数据没丢,但另一条腿哑了,
   * 下次可能两条都哑。⭐ 这不算 problem(数据是全的),放进 legs 让人看得见。
   */

  return {
    ok: problems.length === 0,
    problems,
    items,
    wanted,
    rounds,
    scrolledPx,
    elapsedMs: deps.now() - t0,
    stopReason,
    legs: {
      cdp: fromCount('cdp'),
      hook: fromCount('hook'),
      both: fromCount('both'),
      hookInjected: legStats.hookInjected,
      cdpAttached: legs.cdpAttached,
    },
  };
}

function countWanted(items: readonly AcquiredItem[], want: readonly string[]): number {
  return items.filter((x) => hits(x, want)).length;
}
