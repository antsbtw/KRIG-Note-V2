/**
 * `ready` / `scrollUntil` 数据模型(`01-contract.md` §9.4 / §9.5)
 *
 * ⚠️ 与 `page/types.ts` 分开放:那里是**身份与事实**(步 1 已定死),
 * 这里是**动作的输入输出**。混在一个文件会让「改动作」看起来像「改身份」。
 */

import type { AnchorName, ScriptId } from '../dom/types';

export type { AnchorName, ScriptId };

/**
 * `ready` 的判据(§9.4)。
 *
 * ⭐ `anchorGone` 是**必须**的:X 发长文每一步都要等「模态**关闭**」才能进下一步。
 * 没有它,`x-article-driver` 那套「点 Update → 等模态关 → 下一 step」就没法表达,
 * 于是每一步都在**脏态**上启动 —— 那正是 `x-article-driver.ts:377` 记的连环失败。
 */
export type ReadyCriterion =
  | { readonly kind: 'anchorAppears'; readonly anchor: AnchorName }
  /** ⭐ 模态关闭判据,必须有 */
  | { readonly kind: 'anchorGone'; readonly anchor: AnchorName }
  | { readonly kind: 'urlIncludes'; readonly fragment: string }
  /** 预注册脚本(不收脚本字符串,同 `web.dom`)*/
  | { readonly kind: 'custom'; readonly script: ScriptId }
  /**
   * ⭐⭐ **全部满足**才算到位(2026-09-15 实测补的)。
   *
   * ── 为什么非有不可 ──
   *
   * 用户填了个**不存在的账号** `fang_dani` 跑 `goto x.withReplies`,
   * 结果 `recovered` —— 因为 X 对不存在的用户**保持 URL 不变**、
   * 在页内渲染「账号不存在」,而判据只比 URL,于是
   * 「到了他的页」与「到了错误页」**分不开**。
   *
   * 四个分支互斥,表达不了「URL 对 **且** 页面上真有推文」——
   * 这个组合子就是为此。
   *
   * ⚠️ `of` 为空数组必须 fail loud:空的「全部满足」恒真,
   * 那等于没有判据,比没有更坏(它看起来像有)。
   */
  | { readonly kind: 'all'; readonly of: readonly ReadyCriterion[] };

/**
 * 停止判据(§9.5)。
 *
 * ⚠️⚠️ **这里没有「DOM 条数不变就停」,也没有任何日期判据 —— 是刻意的**:
 *  - 血泪②:站点用虚拟列表,滚过的元素被从 DOM 删除,
 *    「当前 DOM 条数」不是进度(实测出现 +0 / −1,**不涨反降**)
 *  - 血泪④:「见过的最旧一条」≠ 覆盖深度(站点把置顶/热门旧内容排前面,
 *    一条 3 月的推就让判据误以为覆盖 166 天)→ **日期只做显示,绝不做停止判据**
 *
 * 想按「抓够了没有」停,用 `custom` 脚本或在业务侧编排 —— 那是调用方的判断,不是底座的。
 */
export type ScrollStop =
  /** ⭐ 血泪③:只有 `scrollY` **连续多轮不变**才算真到底 */
  | { readonly kind: 'atBottom' }
  | { readonly kind: 'rounds'; readonly n: number }
  | { readonly kind: 'anchorAppears'; readonly anchor: AnchorName }
  | { readonly kind: 'custom'; readonly script: ScriptId };

export type ScrollOptions = {
  /**
   * 每轮滚屏高的几成。默认 **0.55~0.85 抖动** ——
   * 匀速请求是风控最容易识别的特征(`x-timeline-harvester.ts:308` 的理由)。
   */
  readonly stepRatio?: number;
  readonly maxRounds?: number;
  /** 每轮后等渲染(懒加载补货) */
  readonly settleMs?: number;
  /**
   * ⭐ 连续几轮 `scrollY` 不变才算到底。**默认 ≥3**。
   *
   * ⚠️ 一轮不变就停 = 血泪③ 的复发形态:时间线夹着别人的内容很正常,
   * 深处的懒加载在几百轮后经常要等好几秒,**急着停是漏数据元凶**。
   */
  readonly stuckRounds?: number;
};

/** 每轮的痕迹。⚠️ 只记位置与耗时 —— **不记 DOM 条数**(血泪②) */
export type RoundTrace = {
  readonly round: number;
  readonly scrollY: number;
  readonly docHeight: number;
  /** 连续未变的轮数(到底判据的依据) */
  readonly stuck: number;
  readonly elapsedMs: number;
  /** 这一轮是滚的内部容器还是主文档 —— 排查「怎么滚不动」的第一条线索 */
  readonly usedContainer: boolean;
};

/**
 * 滚动报告(§9.5)。
 *
 * ⭐ **`problems` 空数组才算过关** —— `ok` 由它算出,不许两者各说各话。
 *
 * 三层自校验里本步只做 **A(滚动确实发生了)**;
 * B(条数 vs 分母)和 C(时间连续性)要有「抓到的数据」才谈得上,
 * 而本层**只滚不抓**(§9.5「必须与捕获解耦」)。
 * `problems` 的形状能容纳它们 —— 将来业务编排 `scrollUntil` + `capture` 时补。
 */
export type ScrollReport = {
  /** ⚠️ 恒等于 `problems.length === 0`,不是独立字段 */
  readonly ok: boolean;
  readonly problems: readonly string[];
  readonly rounds: number;
  readonly scrolledPx: number;
  readonly reachedBottom: boolean;
  readonly stopReason: string;
  readonly trace: readonly RoundTrace[];
};

// ═══════════════════════════════════════════════════════
//  `goto` —— 语义导航(§9.3)
// ═══════════════════════════════════════════════════════

/**
 * ⭐ `goto` 的目标是**语义**,不是 URL。
 *
 * ⚠️ 形状用**契约文档 §9.3 那份**(判别联合),不是 `web-page.ts` 里那份 branded 串
 * ——用户 2026-09-15 拍板。理由:`params` 能带类型(handle / tweetId 不会互串),
 * 且 `kind:'url'` 把「仅 adapter 内部可用」**显式表达出来**,
 * 而不是靠注释约束。
 *
 * ⚠️⚠️ `kind:'url'` **只许 adapter 自己用**:业务方传语义名,
 * adapter 把它翻成 URL。站点改版时变的是 URL,不变的是「我要去发推页」——
 * 这是「改版只改一层」的直接兑现。
 */
export type PageTarget =
  | { readonly kind: 'semantic'; readonly name: string; readonly params?: Readonly<Record<string, string>> }
  /** ⚠️ 仅 adapter 内部可用 —— 业务方不该构造它 */
  | { readonly kind: 'url'; readonly url: string };

/**
 * 语义页面表 —— **adapter 的活**(与 `AnchorResolver` 同源)。
 *
 * ⚠️ 解释不出来返回 null(调用方据此 Failed),**不返回兜底 URL**:
 * 兜底会让「页面名打错了」表现为「导航到了别的页面」,
 * 而那正是 2026-09-07「把首页时间线当搜索结果」整批入库的形态。
 */
export interface PageResolver {
  /** 语义名 + 参数 → 可导航 URL 与到位判据。解释不出来返回 null */
  resolve(
    name: string,
    params?: Readonly<Record<string, string>>,
  ): { url: string; arrival: ReadyCriterion; describe: string } | null;
  /** 已登记的页面名 —— 验收台列给人看,免得靠记忆猜 */
  names?(): string[];
}

/**
 * 导航报告(§9.3)。
 *
 * ⭐ 返回**事实**:请求的是什么、实际落在哪、等了多久、`loadURL` 有没有 reject。
 * ⚠️ 不返回一个光秃秃的 ok —— 「到位」与「到对地方」是两件事,
 * 人和调用方都要能分开看。
 */
export type GotoReport = {
  readonly requestedUrl: string;
  /** 实际落地 URL(`loadURL` 之后真实的那个,不是请求的那个) */
  readonly landedUrl: string;
  readonly elapsedMs: number;
  readonly describe: string;
  /**
   * `loadURL` 是否 reject 过。
   * ⚠️ **reject 不算失败** —— 站点自行接管导航时必 reject(X 的 ERR_ABORTED),
   * 页面照样会到位。但要留痕,否则「为什么慢」无从查起。
   */
  readonly loadRejected?: string;
};
