/**
 * ⭐⭐ 执行者契约 —— 能力层的第四类
 *
 * ── 用户定的层级(2026-09-15)──
 *
 * > 「在 Gemma 之下都是执行者,只是对象不同而已。」
 *
 * 那三类基础函数(控制 `goto`/`ready` · 输入 `type`/`tap` · 输出 `dom`/`net`)
 * **也是执行者**,只是对象是网页。本文件给的是「对象是模型」的那一类。
 * 在指挥(Gemma)眼里它们是一类东西:**给个任务,回个结果,三态**。
 *
 *   指挥(Gemma)—— 决定找谁执行、拿结果做什么
 *       │
 *       └── 执行者(契约相同,对象不同)
 *            ├── 网页执行者     对象=页面   goto/type/tap/ready/dom   ✅ 已有
 *            ├── 本地模型执行者 对象=文本   Gemma/Ollama              ← 本文件
 *            ├── 网页AI执行者   对象=对话   Claude 网页版,五步走      待做
 *            └── (将来)视频/其它能力                                留门不盖
 *
 * ── 三条不可协商 ──
 *
 * ① **执行者不认识任何具体模型**。谁来执行是**参数**,不是常量。
 *    这样「算力涨了换更好的模型」「同时发给三个 AI 择优」都是改配置/改编排,
 *    不用碰本层代码。
 *
 * ② **执行者之间不互相调用**,也不写数据库。
 *    串行、并行、核验、择优、落库 —— 全是**编排**的事。
 *    ⭐ 这一条让执行者可以在函数测试面板上**单独跑而不动你的数据**。
 *    反例就在仓里:`judgeWithOllama` 把「标记 ai_judging → 调模型 → 解析 →
 *    失败回滚 pending → 写回 verdict」焊死在一个函数里,于是它既不能复用到
 *    「蓝V该不该点赞」,也不能安全地单独跑(一跑就改库)。
 *
 * ③ ⭐⭐ **「模型说不」是 `Ok`,不是 `Failed`。**
 *    模型正常工作并给出否定结论 = 执行成功。
 *    只有**没执行成**(模型挂了/超时/返回解析不了)才是 `Failed`。
 *    混在一起的话,指挥层就分不清「判了说不行」和「根本没跑起来」——
 *    而这两者的处置完全相反(前者接受结论,后者该重试)。
 *    现有 `ai_declined` 正是混着的。
 *
 * ⚠️ **留门不盖房**:产物类型现在只有「判断」一种。将来加视频/其它能力,
 * 是**加一种产物**,不是改接口。本文件不预先为想象中的需求写任何字段 ——
 * 「类型有 JSON 有渲染层零消费」的死字段是本仓库常见形态(见记忆 def 块那条)。
 */

import type { Result } from '../web-capability/result';

/** 执行者的名字 —— 留痕与择优时要知道「这条结果是谁给的」 */
export type ExecutorName = string & { readonly __brand: 'ExecutorName' };

/**
 * 任务:要执行者做什么。
 *
 * ⚠️ `kind` 现在只有 `'judge'` 一种。加新种类时,**产物类型要同步加一支**,
 * 否则会出现「任务能发、产物没法表达」的半截状态。
 */
export interface ExecuteTask {
  /** 任务种类 —— 决定产物的形状 */
  readonly kind: 'judge';
  /**
   * 判据 / 指令:要它判什么、按什么标准。
   * ⭐ **判什么由调用方给**,执行者不内置任何业务判据 ——
   * 「VPN 求助该不该回」和「蓝V该不该点赞」走同一个执行者,差别全在这里。
   */
  readonly instruction: string;
  /** 期望产物是不是结构化 JSON。false 时产物是纯文本 */
  readonly structured?: boolean;
}

/**
 * ⭐⭐ 素材 = **一份卷宗**:主体 + 若干附件。
 *
 * ── 用户 2026-09-17 订正 ──
 *
 * > 「素材是一个附件,而不是一个推文而已:
 * >   主体——这条推文本身;附件——推主概况,这个推文的上下文——
 * >   它是回复别人,还是求助,时间上连续的帖子都是什么?」
 *
 * 初版把素材当成**一段字符串**,那表达不了「主体 + 附件」,
 * 更表达不了**哪些附件没取到** —— 而后者恰恰是判断质量的关键:
 * 「看着单条推瞎猜」与「看过上下文才下结论」必须能区分开。
 *
 * ── ⭐ 卷宗是**编排的产物**,不是判断执行者自己去查的 ──
 *
 * 取附件是**另一类执行者**的活(对象=数据库):
 *   `fetchAuthorProfile` / `fetchThreadContext` / `fetchRecentPosts` …
 * 每个独立、三态、互不调用。**取哪几样**由编排决定 ——
 * 判 VPN 求助要上下文,判蓝V该不该点赞可能只要推主概况。
 *
 * ⚠️ 判断执行者**照旧不碰数据库**。这条破了它就又变成 `judgeWithOllama`
 * (一跑就改你的数据,既不能复用也不能单独跑)。
 *
 * ── `missing` 从哪来 ──
 *
 * **从各取数执行者的三态汇总而来**:谁返回 `Failed`,谁的名字就进 `missing`。
 * 不用另写一套「怎么知道缺了什么」的逻辑 —— 三态本身就带着这个信息。
 */
export interface ExecuteMaterial {
  /**
   * 主体 —— **必有**。判的就是它(如推文正文)。
   * ⚠️ 空主体是 `Failed`,不是「缺附件」:没有主体就没有可判的东西。
   */
  readonly content: string;

  /**
   * 附件 —— 各自**可缺**。键是附件名(进 prompt 时原样当小标题),
   * 值是已取到的内容。
   *
   * ⭐ 只放**取到了**的。没取到的不要塞空对象/空串占位 ——
   * 那会让模型以为「查过了,是空的」,而事实是「压根没查到」。
   * 两者结论方向相反(记忆 feedback-check-sample-contains-phenomenon)。
   */
  readonly attachments?: Readonly<Record<string, unknown>>;

  /**
   * ⭐⭐ 没取到的附件名单 —— 由编排从各取数执行者的失败汇总。
   *
   * 执行者**照常判**,但结果会是 `Degraded(产物, missing)`:
   * 「判了,但没看见推主概况和上下文」。
   *
   * ⚠️ 为什么不因此拒判:本仓今天三项附件基本都没数据
   * (`x_author` 36 行且粉丝数全空;`in_reply_to` 3782 条里只有 48 条有)。
   * 「等数据齐了再判」等于现在什么都判不了。
   * 但**必须标明**它是在信息不全的情况下判的。
   */
  readonly missing?: readonly string[];
}

/**
 * 产物:执行者给出的东西。
 *
 * ⚠️ `verdict` 是**执行者的结论**,不是「该不该做某事」的最终决定 ——
 * 最终决定是编排层的事(可能要三个执行者择优,可能还要核验一轮)。
 */
export interface JudgeOutcome {
  readonly kind: 'judge';
  /** 结论正文 —— 结构化任务下是 JSON 串,纯文本任务下是原文 */
  readonly content: string;
  /** 解析出来的结构(structured 时才有);解析不了是 Failed,不是这里给 undefined */
  readonly parsed?: unknown;
  /** ⭐ 谁给的 —— 择优/核验/留痕都要 */
  readonly by: ExecutorName;
  /** 耗时,毫秒 —— 「哪个执行者慢」要能看见 */
  readonly elapsedMs: number;
  /** 执行者自报的模型标识(便于回看「这条是哪个模型判的」) */
  readonly model?: string;
}

export type ExecuteOutcome = JudgeOutcome;

/**
 * ⭐⭐ 执行者接口 —— 所有执行者长一个样。
 *
 * 指挥层只认这个接口:**不知道**这次执行是本地算的、
 * 还是从网页上抠回来的、还是将来某个视频服务生成的。
 */
export interface Executor {
  /** 执行者名字(留痕/择优用) */
  readonly name: ExecutorName;
  /**
   * 执行一次。
   *
   * ⚠️ **只做一次**。并行发三份、择优、核验 —— 全在编排层,
   * 执行者不知道自己是不是并行的一员。
   */
  execute(task: ExecuteTask, material: ExecuteMaterial): Promise<Result<ExecuteOutcome>>;
}

/** 便捷铸造 —— 与 `AnchorName` 同款手法,不用 `as never` */
export function executorName(n: string): ExecutorName {
  return n as ExecutorName;
}
