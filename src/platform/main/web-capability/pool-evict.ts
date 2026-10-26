/**
 * ⭐⭐ 采集池满了挤谁 —— 两条腿(CDP 会话 / 页面钩子)共用(2026-10-16)
 *
 * 真机(X 搜索页,只看蓝V):74 秒里浏览器发了 44 次头像请求、8 次账号信息,**内容一模一样**,
 * 池子(64 条)被这些重复塞满,先到的 19 页搜索结果里 17 页被挤掉 —— 采集数不够页就一直滚,
 * 浏览器跟着发了 20 次搜索 → 429。
 *
 * ⭐ 规则:超了先挤**后面还有一模一样一份**的最老那条(挤掉它不丢信息);没有重复才挤最老的,
 *    那是真丢数据 —— 返回丢了几条,调用方要说出来(fail loud)。
 * ⚠️ 站点无关:只看 url / 状态码 / 内容是否完全相同,不认识任何站点。
 */
export type PoolItem = { readonly url: string; readonly status?: number; readonly text: string };

const same = (a: PoolItem, b: PoolItem): boolean =>
  a.url === b.url && (a.status ?? 0) === (b.status ?? 0) && a.text.length === b.text.length && a.text === b.text;

/** 原地挤到不超过 max;返回「挤掉的不重复条数」(真丢的) */
export function evictOver<T extends PoolItem>(list: T[], max: number): number {
  let lostUnique = 0;
  while (list.length > max) {
    let idx = -1;
    for (let i = 0; i < list.length - 1 && idx < 0; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        if (same(list[i], list[j])) { idx = i; break; }
      }
    }
    if (idx >= 0) list.splice(idx, 1);
    else { list.shift(); lostUnique += 1; }
  }
  return lostUnique;
}
