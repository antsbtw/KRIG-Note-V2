/**
 * ⭐⭐ 控制台一次调用 → 一条留痕:**纯逻辑,可单独跑**
 *
 * ── 为什么要从 handler 里抽出来 ──
 *
 * 这段逻辑是**本会话出 bug 最多的地方**,三次都是我写的:
 *  ① 耗时传了字面量 `0`(假事实:查「tap 要多久」会读到 0ms)
 *  ② 层归属一律写 `web.page`(`tap`/`type` 其实是 `web.input`,按层查询会说谎)
 *  ③ 「等不到」记成 `unexpected-format`(那是**站点改版探测器**,被正常否定结果污染)
 *
 * 而它当时埋在 `web-console-handler.ts` 里、**没有导出** ——
 * 于是 40 条守卫只能 `grep` 源码文本,**两次假绿**都出在这种扫法上
 * (见 [[feedback-guard-scope-to-the-branch]])。
 *
 * ⭐ 抽成纯函数后,测试**直接调它、断言返回值**,不再猜源码里有没有某个字符串。
 * 这正是本仓「能力层零 electron、接线层才碰」范式在 ipc 层的同款应用。
 *
 * ⚠️ 本文件**零 electron / 零 IO**:只做「这次调用该记成什么」的判断。
 * 真正往 `web.trace` 写由调用方做 —— 判断与副作用分开,判断才测得动。
 */

import type { CapabilityLayer } from '../web-capability/trace/types';

/** 底座返回的三态(只取本模块用得到的字段) */
export type CapabilityOutcome = {
  readonly status: string;
  readonly reason?: string;
  readonly missing?: readonly string[];
};

/**
 * ⚠️ 按**能力真正所属的层**归类,不是「都算 web.page」。
 * 归错层会让 `countByCapability` 与任何按层的查询直接说谎 ——
 * 遥测里一条归错的记录比没有更坏。
 */
export const LAYER_OF: Readonly<Record<string, CapabilityLayer>> = {
  ready: 'web.page',
  scrollUntil: 'web.page',
  tap: 'web.input',
  press: 'web.input',
  hover: 'web.input',
  type: 'web.input',
};

/** 判断结果:记成一条 recovery,还是一条 degradation */
export type TracePlan =
  | {
      readonly kind: 'recovery';
      readonly layer: CapabilityLayer;
      readonly what: string;
      readonly outcome: 'recovered' | 'failed';
      readonly detail: string;
    }
  | {
      readonly kind: 'degradation';
      readonly layer: CapabilityLayer;
      readonly capability: string;
      readonly operation: string;
      readonly category: 'unexpected-format' | 'resource-failure' | 'contract-violation';
      readonly reason: string;
      readonly inputRef: string;
      readonly rawSnippet: string;
    };

/** 失败原因里「锚点没登记」的稳定特征(底座原文) */
const ANCHOR_MISS = '无法解释成 selector';
/** 失败原因里「注入一直抛到超时」的稳定特征(`ControlEngine.ready` 原文) */
const INJECTION_ERROR = '最后一次注入异常';

/**
 * ⭐⭐ 一次调用该记成什么。
 *
 * ── 判据不是「失败了吗」,而是「**这次失败说明系统坏了吗**」──
 *
 * | 情形 | 记成 | 为什么 |
 * |---|---|---|
 * | 成功 | recovery(recovered) | 成功也要记,否则算不出成功率 |
 * | 锚点解释不出来 | degradation(契约违反) | 锚点表该改 —— 是真缺陷 |
 * | 注入一直抛到超时 | degradation(资源失败) | 页面/通道有问题 —— 是真缺陷 |
 * | 纯粹没等到 | **recovery(failed)** | 「问了,答案是否定的」—— 正常结果,不是降级 |
 * | degraded | degradation(格式外) | 做了但不完整 |
 *
 * ⚠️ 最后一行的「纯粹没等到」**绝不能记成 degradation**:
 * `countByCapability('unexpected-format')` 是站点改版探测器
 * (`03-observability.md` §3.3:某 adapter 格式外计数突然上升 = 那个站改版了)。
 * 拿「推文没消失」这种正常否定结果去喂它,X 真改版时指标早被顶高,涨上去也看不出来。
 */
export function planTrace(
  fn: string,
  params: unknown,
  result: CapabilityOutcome,
  elapsedMs: number,
): TracePlan {
  const layer = LAYER_OF[fn] ?? 'web.page';
  const inputRef = `${fn}:${JSON.stringify(params).slice(0, 200)}`;
  const reason = result.reason ?? '';

  if (result.status === 'ok') {
    return {
      kind: 'recovery', layer, what: `console:${fn}`, outcome: 'recovered',
      detail: `${elapsedMs}ms ${inputRef}`,
    };
  }

  const isAnchorMiss = reason.includes(ANCHOR_MISS);
  const hadInjectionError = reason.includes(INJECTION_ERROR);

  if (result.status === 'failed' && !isAnchorMiss && !hadInjectionError) {
    return {
      kind: 'recovery', layer, what: `console:${fn}`, outcome: 'failed',
      detail: `${elapsedMs}ms ${inputRef} —— ${reason}`,
    };
  }

  return {
    kind: 'degradation',
    layer,
    capability: 'x',
    operation: `console:${fn}`,
    category: isAnchorMiss
      ? 'contract-violation'
      : hadInjectionError ? 'resource-failure' : 'unexpected-format',
    reason: result.status === 'degraded'
      ? `缺: ${(result.missing ?? []).join(', ')}`
      : (reason || '(无原因)'),
    inputRef,
    rawSnippet: `${elapsedMs}ms`,
  };
}

/**
 * 日志后缀:把三态里的「为什么」摘出来。
 *
 * ⚠️ `failed` 有两种成因,现象一样但排查方向相反(改锚点表 vs 改等待时机);
 * `degraded` 的 `missing` 不打出来就等于没报。
 */
export function describeWhy(r: CapabilityOutcome): string {
  if (r.status === 'failed') return ` —— ${r.reason ?? '(无原因,这本身是 bug)'}`;
  if (r.status === 'degraded') return ` —— 缺: ${(r.missing ?? []).join(', ')}`;
  return '';
}
