/**
 * ⭐⭐ 采集的「停」—— 用户 2026-09-22 提出:「是否有一个暂停操作键?」
 *
 * ── 为什么非有不可 ──
 * 实测采 @KA594594 主页:滚动几分钟采到 287 条,其中 **261 篇长文**,
 * 随后逐篇进详情页补正文,每篇约 10 秒 → **43 分钟**,
 * 而这期间**没有任何办法停下来**,面板上连个按钮都没有。
 * 人只能看着它转,或者关掉整个 app。
 *
 * ⚠️ 「关掉 app」不是替代方案:那样这一趟的留痕**不会落盘**,
 * 于是「跑到哪儿了、为什么停」全部丢失 —— 又回到「靠猜」。
 *
 * ── 语义:停 = 「到此为止,把已有的收好」,不是「作废」 ──
 * ⭐ 已经入库的推**不回滚**(采集是增量的,回滚反而丢数据);
 * ⭐ 停下来之后**照常落留痕**,并如实写明「是人停的,不是采完了」——
 *    这两者在报告里绝不能长得一样(本仓最忌的「看着成功实际没有」)。
 *
 * ── 为什么用 wsId 做键 ──
 * 一个窗口一个 workspace,两个 ws 可能同时在采不同的页面;
 * 全局一个布尔会让「停 A」把 B 也停掉,而现象是「B 莫名其妙就不采了」。
 */

/** 被请求停止的 ws —— 值是请求时刻(ISO),便于留痕里写清是什么时候按的 */
const aborting = new Map<string, string>();

/** 没有 wsId 的调用(旧路径/无人值守)统一归到这个键下 */
const GLOBAL_KEY = '__global__';

const keyOf = (wsId?: string): string => wsId || GLOBAL_KEY;

/**
 * 请求停止某个 ws 的采集。
 *
 * ⚠️ 这是**协作式**的:它只置一个标志,由采集循环在下一个检查点自己退出。
 * 不做强行中断 —— 那会让写库写到一半,留下半条记录。
 */
export function requestAbort(wsId?: string): void {
  aborting.set(keyOf(wsId), new Date().toISOString());
}

/**
 * 这个 ws 被要求停了吗。
 *
 * ⚠️ 采集循环**每一轮**都要问一次,而且**长耗时的子步骤内部也要问**
 * (补正文 261 篇那种,不能只在整批开始时问一次 —— 那等于没有暂停键)。
 */
export function isAborted(wsId?: string): boolean {
  return aborting.has(keyOf(wsId));
}

/** 什么时候按的 —— 进留痕,让「人停的」有确切时刻 */
export function abortedAt(wsId?: string): string | undefined {
  return aborting.get(keyOf(wsId));
}

/**
 * 清掉标志 —— **每趟采集开始时必须调**。
 *
 * ⚠️ 不清的话:上一趟按过停,下一趟一开始就是「已停」状态,
 * 现象是「点了采集立刻就结束,什么也没采到」,而且报告说「已停止」——
 * 人会以为自己又按到了什么。
 */
export function clearAbort(wsId?: string): void {
  aborting.delete(keyOf(wsId));
}
