/**
 * ⭐⭐ 执行上下文 —— 「谁让它跑的」
 *
 * ── 用户 2026-09-18 定的设计要求 ──
 *
 * > 「对于函数的调用,确实应该记录调用者是谁,
 * >   系统必须有维护能力和追溯的能力才行。」
 *
 * 这不是调试工具,是**设计要求**。现在的留痕记的是「做了什么」
 * (`execute → ok → 1847ms`),答不出「为谁做的、谁让做的、哪次流程的第几步」。
 * 于是「ws-1 昨天那次采集,为 @someone 判过没」这种问题查不了。
 *
 * ── ⭐ 能力**不认识**上下文,只转发 ──
 *
 * `goto` 不该知道「我是被采集流程调用的」—— 它一旦知道就和业务绑死,
 * 那正是这一路在拆的东西。所以上下文是**调用方传进来**的一张凭据,
 * 能力原样带进留痕,**不解释它**。
 *
 * 与锚点表/页面表的依赖倒置同一个手法:底座不认识业务,业务把标识推进来。
 *
 * ── 追溯要能从任意一端查 ──
 *
 *   从推文查 → 这条推被谁判过、判了什么      靠 subject
 *   从流程查 → 这次跑了哪些步、哪步挂了      靠 runId + seq
 *   从能力查 → goto 今天被调 300 次,谁调的  靠 capability + trigger
 *
 * 三种查法对应 `flow_step_run` 上的三组索引。
 */

/** 谁发起的这次执行 */
export type TriggerKind =
  /** 人点的 */
  | 'human'
  /** 定时器 */
  | 'schedule'
  /** 上一步触发的(链式) */
  | 'chain';

/** 这次执行是**为谁**跑的 */
export interface ExecSubject {
  /** 'handle'(某个人) | 'tweet'(某条推) | 其它业务标识 */
  readonly kind: string;
  /**
   * 标识值。
   * ⚠️ handle 必须是**归一化后**的(库里 author_handle 带 @ 保留大小写,
   * x_author.handle 是归一化的;两边漂移会让追溯恒查不到且不报错 ——
   * 记忆 project-x-handle-normalize)。
   */
  readonly ref: string;
}

/**
 * 一次流程执行的上下文 —— 贯穿全链,每步原样携带。
 *
 * ⚠️ `runId` 必填:没有它,step 记录挂不到任何一次执行上,
 * 就成了一堆没有来历的孤儿行(而那正是要解决的问题)。
 */
export interface ExecContext {
  readonly runId: string;
  /** 跑的是哪条链 */
  readonly flowName: string;
  readonly trigger: TriggerKind;
  /** 发起者细节:人点的哪个按钮 / 哪个定时任务 / 上游 runId */
  readonly triggerRef?: string;
  /** 为谁跑的(整条 run 的主体;某一步可以有自己的 subject) */
  readonly subject?: ExecSubject;
  readonly wsId?: string;
}

/**
 * 一步的执行凭据 —— 在 `ExecContext` 上加「第几步、哪个能力」。
 *
 * ⭐ 由编排逐步派生,**能力自己不构造**。
 */
export interface StepContext extends ExecContext {
  /** 第几步,从 1 起。⚠️ 排序靠它,不靠时间戳(同毫秒会乱) */
  readonly seq: number;
  readonly stepId: string;
  /** 能力分类 —— 与 flow_step_run.step_type 同一套词 */
  readonly stepType: StepType;
  /** 具体调了哪个能力(goto / execute / inventory …) */
  readonly capability?: string;
  /** 这一步单独的主体(一条 run 可能逐个处理多个对象) */
  readonly stepSubject?: ExecSubject;
}

/**
 * 能力分类 —— 按「输入什么、输出什么、碰谁」切,不按业务切。
 *
 * ⚠️ 这套词与 `flow_step_run.step_type` 必须一致,
 * 否则写进去的记录查不出来(而且不会报错)。
 */
export type StepType =
  /** 取数:库/页面 → 事实。只读 */
  | 'fetch'
  /** 判决:事实 → 结论。对象是模型 */
  | 'judge'
  /** 动作:对外界产生影响(页面操作/发布) */
  | 'act'
  /** 写回:结论 → 自己的库。只写 */
  | 'write'
  /** 人决:把控制权交回给人,等点头 */
  | 'human';

/** 一步跑完的结果状态 —— 三态 + 两种「没跑」 */
export type StepStatus =
  | 'ok' | 'degraded' | 'failed'
  /** 条件不满足,没跑 */
  | 'skipped'
  /** 被规则拒绝(如域名不在白名单) */
  | 'rejected';

/**
 * 生成 runId。
 *
 * ⚠️ 用时间戳前缀 + 随机尾巴:时间戳让记录**天然按时间排序且可读**,
 * 随机尾巴防同毫秒撞车。不用纯随机 —— 那样光看 id 说不出「什么时候跑的」。
 */
export function newRunId(now: Date = new Date()): string {
  const ts = now.toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `run_${ts}_${rand}`;
}

/**
 * 从 run 上下文派生一步的上下文。
 *
 * ⭐ 这是**唯一**该造 StepContext 的地方 —— 各能力不自己拼,
 * 否则 seq 会各算各的,「第几步」就不可信了。
 */
export function deriveStep(
  ctx: ExecContext,
  step: {
    seq: number; stepId: string; stepType: StepType;
    capability?: string; subject?: ExecSubject;
  },
): StepContext {
  if (!Number.isInteger(step.seq) || step.seq < 1) {
    // fail loud:seq 错了会让「第几步」整条链失序,而现象是记录看着正常
    throw new Error(`[exec-context] seq 必须是 >=1 的整数,收到 ${String(step.seq)}`);
  }
  return {
    ...ctx,
    seq: step.seq,
    stepId: step.stepId,
    stepType: step.stepType,
    capability: step.capability,
    stepSubject: step.subject,
  };
}

/**
 * 一行留痕摘要 —— 给日志用,不进库。
 * ⭐ 带上 runId 与 seq,终端里 grep 一个 runId 就能把整条链串起来。
 */
export function describeStep(ctx: StepContext): string {
  const subj = ctx.stepSubject ?? ctx.subject;
  const who = subj ? ` for ${subj.kind}:${subj.ref}` : '';
  return `[${ctx.runId} #${ctx.seq} ${ctx.stepId}(${ctx.stepType})${who}]`;
}
