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
  | { readonly kind: 'custom'; readonly script: ScriptId };

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
