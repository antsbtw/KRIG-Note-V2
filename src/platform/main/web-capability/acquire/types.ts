/**
 * `web.acquire` —— **获取网页完整内容**(上层只说目标,不选方法)
 *
 * ── 用户 2026-10-02 ──
 * 「不是选择用哪条腿 —— 你要构建**获取完整信息的函数/或者类**。
 * 　底层能够可以做最小化的抽象函数,但**上层只关注某个具体的目标**呀。」
 *
 * ⭐ 这一层的全部意义:把「用 CDP 还是页面钩子、要不要重载、滚几轮、
 * 什么时候算采全」这些**实现决策**收进来,上层只说:
 *
 *     「把这一页的内容给我取全。」
 *
 * ── ⚠️ 与底下那些层的分工 ──
 *
 * | 层 | 回答的问题 |
 * |---|---|
 * | `net` / `hook` | **怎么**拿到一条响应(机制) |
 * | `page`         | **怎么**导航、滚动(机制) |
 * | ⭐ `acquire`   | **什么算取全了**(目标与判据) |
 * | 业务模块       | **取哪一页**(语义页面名 + 怎么解析) |
 *
 * ⚠️ 本层**不认识任何站点** —— 它不知道 X、不知道论坛。
 * 站点特有的东西(哪个端点才算正文)由调用方用 `AcquireGoal` 表达。
 */

import type { PageId } from '../page/types';

/**
 * ⭐⭐ 一次采集的**目标** —— 上层说这个,不说方法。
 *
 * ⚠️ 刻意**没有** `useCdp` / `useHook` / `reload` 这类开关:
 * 那是实现细节,给出来就等于让调用方替底座做决定
 * (用户 2026-10-02 点破的正是这个)。
 */
export type AcquireGoal = {
  /**
   * ⚠️⚠️ **本类型已清空** —— 2026-10-02 用户:
   * 「『命中目标 1 条』的意义?**采集数据就是全面的采集,没有数据研判的功能呀?**」
   *
   * ⭐ 对的。我原来放了 `wantUrlIncludes` / `wantAtLeast`,
   * 那是把**研判**(哪些算有用、够不够)塞进了**采集**。
   * 采集只该回答一件事:**收到了什么**。
   * 「这些够不够、哪条有用」是上层(业务模块)拿到数据之后的事。
   *
   * ⚠️ 留着这个空类型是为了 `awaitEnough` 的超时安全网,
   * **不是**为了将来往里塞筛选条件 —— 真要筛,在上层筛。
   */
  /** 最长等多久(毫秒)—— ⚠️ 安全网,防「等一个永远不来的载荷」 */
  readonly maxMs?: number;
};

/** 采到的一条 —— ⭐ 对外**只有这一种形状**,不分腿 */
export type AcquiredItem = {
  readonly url: string;
  readonly method: string;
  readonly status: number;
  /** 响应原文。⚠️ **不截断**(用户:「要保持信息的完整性,而不是片段」) */
  readonly text: string;
  readonly byteLength: number;
  readonly at: string;
  /**
   * ⚠️ 从哪条腿来的 —— **这是证据不是选项**。
   * 保留它是为了出问题时查得动(`both` 说明两条腿互证通过);
   * 调用方正常情况下**不该关心**这个字段。
   */
  readonly from: 'cdp' | 'hook' | 'both';
};

/**
 * ⭐⭐ 采集报告 —— **`problems` 空才算采全**。
 *
 * ⚠️ `ok` 由 `problems` 算出,不是独立字段 ——
 * 两者各说各话就是撒谎的入口(照搬 `ScrollReport` 的做法)。
 */
export type AcquireReport = {
  readonly ok: boolean;
  readonly problems: readonly string[];
  /** 合并去重后的完整结果 */
  readonly items: readonly AcquiredItem[];
  /**
   * ⚠️ **没有 `wanted`** —— 2026-10-02 删:
   * 「命中了几条」是**研判**,不是采集的事(用户原话:
   * 「采集数据就是全面的采集,没有数据研判的功能呀?」)。
   * ⭐ 想知道「哪些是推文」,拿 `items` 去问业务模块的核对器。
   */
  /**
   * ⚠️ **没有 rounds / scrolledPx** —— 那是控制那栏的报告
   * (`ScrollReport` 已经有了),采集不该重复记一份。
   */
  readonly elapsedMs: number;
  readonly stopReason: string;
  /**
   * ⭐ 各条腿的健康度 —— ⚠️ **诊断用,不是给人选的**。
   * 它回答「为什么只采到这么点」:
   * · 两条腿都 0      → 站点真的没发
   * · 只有一条有      → 另一条漏了,但**数据没丢**
   * · hookInjected 假 → 注入没生效
   */
  readonly legs: {
    readonly cdp: number;
    readonly hook: number;
    readonly both: number;
    readonly hookInjected: boolean;
    readonly cdpAttached: boolean;
  };
};

/**
 * 本层依赖的最小操作集 —— ⭐ 由 wiring 注入,本层零 Electron。
 *
 * ── ⚠️⚠️ 这里**没有** reload / scrollOnce(2026-10-02 拆出去)──
 *
 * 用户:「我觉得不要改变前面的逻辑,**控制是控制,采集是采集**。
 * 　你现在是简化了,但是**违背了逻辑**。控制/输出是分开的。」
 *
 * ⭐ 对的 —— 我把「翻页滚动」揉进了「采集」,而三栏的本意是:
 * · **控制**(web.page):goto / 重载 / 滚动 —— 人决定页面怎么动
 * · **输出**(web.net):开始收 / 停止收 / 收到了什么 —— 只管接
 *
 * ⚠️ 揉在一起的直接后果,本轮实测就看见了:
 * `rounds=0 scrolledPx=0` —— 重载后首屏就够数,**一轮都没滚**,
 * 采集替控制做了「要不要翻页」的决定,而人看不出来。
 */
export interface AcquireDeps {
  /** 把所有获取方法装上。返回各条腿是否就绪 */
  startAll(pageId: PageId): Promise<{ cdpAttached: boolean; hookInstalled: boolean }>;
  /** 全部停掉 */
  stopAll(pageId: PageId): void;
  /** 取当前合并去重后的结果 */
  snapshot(pageId: PageId): readonly AcquiredItem[];
  /** 各腿健康度 */
  legStats(pageId: PageId): { hookInjected: boolean };
  now(): number;
}
