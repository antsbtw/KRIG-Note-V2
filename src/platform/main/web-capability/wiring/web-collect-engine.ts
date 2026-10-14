/**
 * ⭐⭐ 采集引擎 ——「对一个 webview 跑采集」的零件 + 每个页面的会话状态
 *
 * 2026-10-13 从 `ipc-dom.ts` **原样搬出**(后台采集策略 3a,交接见
 * `docs/handoff/x-collect-engine-extraction-3a.md`)。逻辑一字未改,只换了文件位置。
 *
 * ── 为什么要搬 ──
 *
 * `ipc-dom.ts` 原来既接 IPC、又揣着采集引擎(会话表、两条腿、harvest/acquire 依赖)。
 * 后台 runner 跑在主进程、**没有 renderer**,却也要跑采集 —— 引擎锁在 IPC 接线文件里,
 * 它就只能绕一圈 IPC 或者复制一份(复制必漂)。
 * ⭐ 拆开后:本文件只管「对一个 webview 采」,**不认识 IPC**;
 * `ipc-dom.ts` 只管把 renderer 的请求接到这里。
 *
 * ⚠️ 本文件仍在 `wiring/`(能力层唯一允许碰 Electron 的地方),
 * 且**不认识任何站点**(`capability-site-agnostic` 守卫钉着)——
 * X 的编排(runCollect 等)住在 `src/modules/x/`,只往下调这里。
 *
 * ⚠️ 留痕分工(用户 2026-10-13 拍板):harvest/acquire 的厚重留痕
 * (byKind / endpoints 聚合)**留在调用方**(ipc-dom 的各 case),本文件只采 + 返回数据。
 */

import type { WebContents } from 'electron';

/** ⭐ 两份名单是不是同一份(顺序也算)—— 判「要不要重建钩子」 */
export function sameList(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * ⭐⭐⭐ 一条**合并后**的采集结果 —— 对外只有这一种形状。
 *
 * 用户 2026-10-02:「我需要的是**完整的数据**,而不是分这么多类别」。
 * ⚠️ `from` 不是给人选的,是**证据**:它说明这条是从哪条腿来的,
 * 出问题时才查得动(两条腿都有 → 可互相对账)。
 */
export type MergedItem = {
  readonly url: string;
  readonly method: string;
  readonly status: number;
  readonly text: string;
  readonly byteLength: number;
  readonly at: string;
  /** 'cdp' | 'hook' | 'both' —— ⭐ 证据,不是选项 */
  readonly from: 'cdp' | 'hook' | 'both';
  /**
   * ⭐⭐ X 发这条请求时用的请求头 —— 游标翻页要原样重发。
   * ⚠️ 只有 CDP 腿拿得到(钩子腿在页面里,看不见真实请求头)。
   */
  readonly requestHeaders?: Readonly<Record<string, string>>;
};

/**
 * ⭐⭐ 去重键。
 *
 * ⚠️ 两条腿会拿到**同一条响应**(这正是互证的前提),
 * 不去重的话人看到的条数**虚高一倍**。
 *
 * ⚠️ 为什么用 `url + status + byteLength` 而不是只用 url:
 * 同一个 URL 在一次采集里会被请求多次(翻页、轮询),
 * 只按 url 去重会把**不同轮次的数据**当成重复丢掉 —— 那是真丢数据。
 * ⭐ 加上 `byteLength` 后,内容不同的就留得住。
 */
export function dedupKey(url: string, status: number, text: string): string {
  /**
   * ⚠️⚠️ **不能用 `byteLength`** —— 2026-10-02 真机实测:
   * 同一个 `HomeTimeline` 响应,CDP 报 **267.2KB**、页面钩子报 **248.4KB**
   * (CDP 数的是**原始字节**,钩子数的是 **UTF-8 解码后的字符**)。
   * 进了去重键就**永远配不上** → 同一条被算两次 → `both` 该有的互证也没了。
   *
   * ⭐ 改用**内容前缀**:同一条响应两条腿拿到的文本是一样的,
   * 而同一 URL 的不同轮次(翻页/轮询)内容必然不同 —— 两头都兜住。
   * ⚠️ 只取前 256 字符:整段比对在几百 KB 的载荷上太贵,
   * 而 JSON 的前 256 字符已经包含了游标/首条 id 这类区分度最高的东西。
   */
  return `${url.split('?')[0]}|${status}|${text.slice(0, 256)}`;
}

/**
 * 读 partition —— 与 `ai/interceptor.ts:350` 同款。
 * ⚠️ `PageFacts.partition` 必填且底座**不猜**(`prepare` 要挂 webRequest)。
 */
export function readPartition(wc: WebContents): string {
  try {
    const p = wc.session.storagePath;
    return p ? `persist:${p.split('/').pop()}` : 'persist:webview';
  } catch {
    return 'persist:webview';
  }
}
