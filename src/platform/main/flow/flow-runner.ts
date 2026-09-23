/**
 * ⭐⭐⭐ **编排执行器** —— 按编排档把已有能力串起来跑,每步落一条执行记录。
 *
 * ── 用户 2026-09-23 拍板 ──
 * > 「下一步做一个任务编排试试,这样逐步的拆解抽象。
 * >   否则还是找不到该抽象到哪个颗粒度比较好。」
 *
 * ── 这个文件**不做**什么(很重要) ──
 *
 * ⚠️ **不重新实现任何能力**。四步全是现成函数:
 *   goto → XPageResolver + goToUrl / collect → autoCollect
 *   judge → runJudgeBatch    / planReply → planReplies
 * 编排层只负责「按顺序调、把结果记下来」。
 * ⭐ 一旦编排层自己解释起参数或重写逻辑,就成了第二份实现 —— 两份必漂。
 *
 * ⚠️ **不做分支/循环/条件跳转**(Module5 设计 2026-04 就定过)。
 * 编排档是「可重组的步骤序列」,不是一门小语言:
 * 有了分支,「这次为什么走了那条路」又变成要人去猜的事。
 *
 * ── 失败语义 ──
 * ⭐ **一步失败就停,后面的标 skipped**(不是继续往下跑)。
 * 理由:四步是**有依赖**的 —— 没采到数据,判断就没有输入;
 * 硬往下跑会得到一串「成功但产出 0」,而真因埋在第一步。
 * ⚠️ 但**已经跑完的步骤不回滚**:采到的数据是增量的,回滚反而丢数据。
 */

import { newRunId, deriveStep, type ExecContext } from './exec-context';
import { startRun, recordStep, endRun } from './flow-run-repo';
import type {
  FlowRecipe, FlowStep, FlowStepOutcome,
} from '@shared/types/flow-recipe-types';

/**
 * 能力适配器 —— 由调用方注入。
 *
 * ⚠️ **不在这里直接 import 那四个能力**:
 * flow 是通用层,直接依赖 X 的模块会让它变成「X 专用编排器」,
 * 而下一个业务(邮件?)就得再抄一份。
 * ⭐ 注入进来,编排层只认这四个签名。
 */
export interface FlowCapabilities {
  goto(params: Record<string, unknown>, wsId?: string): Promise<FlowStepOutcome>;
  collect(params: Record<string, unknown>, wsId?: string): Promise<FlowStepOutcome>;
  judge(params: Record<string, unknown>, wsId?: string): Promise<FlowStepOutcome>;
  planReply(params: Record<string, unknown>, wsId?: string): Promise<FlowStepOutcome>;
}

export interface FlowRunResult {
  runId: string;
  flowName: string;
  /** 每一步的结果 —— ⚠️ 跳过的也在里面,否则「没跑」与「没这一步」分不开 */
  steps: Array<{
    id: string; kind: string; label: string;
    status: 'ok' | 'failed' | 'skipped';
    produced: number; error?: string; note?: string; elapsedMs: number;
  }>;
  ok: boolean;
  /** 哪一步断的 —— 空 = 全跑完了 */
  failedAt?: string;
  elapsedMs: number;
}

/** ⭐ 停止标志由调用方给 —— 与采集的暂停键同一套语义(协作式,到检查点才停) */
export type AbortCheck = () => boolean;

/**
 * 跑一份编排档。
 *
 * @param recipe 编排档(步骤序列)
 * @param caps   能力适配器
 * @param opts.isAborted 人按了停就在下一步之前退出
 */
export async function runFlow(
  recipe: FlowRecipe,
  caps: FlowCapabilities,
  opts: { wsId?: string; trigger?: 'manual' | 'schedule'; isAborted?: AbortCheck } = {},
): Promise<FlowRunResult> {
  const t0 = Date.now();
  const runId = newRunId();
  const wsId = opts.wsId ?? recipe.wsId;

  const ctx: ExecContext = {
    runId,
    flowName: recipe.name,
    /** ⚠️ TriggerKind 是 human|schedule|chain —— 没有 'manual' 这个值 */
    trigger: opts.trigger === 'schedule' ? 'schedule' : 'human',
    triggerRef: recipe.recipeId,
    wsId,
  };

  /**
   * ⚠️ 起头就写 `flow_run` —— 不能等跑完再写:
   * 跑到一半 app 崩了的话,那次运行就**完全没有痕迹**,
   * 而「崩了」与「没跑过」在记录里长得一样。
   */
  await startRun(ctx).catch((e) => {
    console.warn('[flow-runner] startRun 失败(不拦执行):', e);
  });

  const steps: FlowRunResult['steps'] = [];
  let failedAt: string | undefined;
  let seq = 0;

  for (const step of recipe.steps) {
    seq += 1;
    const label = step.label || step.kind;
    /** ⚠️ deriveStep 收的是一个对象,不是位置参数 */
    const stepCtx = deriveStep(ctx, {
      seq, stepId: step.id, stepType: kindToStepType(step.kind), capability: step.kind,
    });

    /**
     * ⭐ 三种「不跑」的理由要**分开记**,不能都叫 skipped 了事:
     *  · 前面断了      → 后续步骤没有输入,跑了也没意义
     *  · 人按了停      → 与「失败」完全不同
     *  · 档里关掉了    → 是配置,不是故障
     * ⚠️ 合成一种的话,回看时「这一步为什么没跑」又要靠猜。
     */
    const skipReason = failedAt
      ? `前一步「${failedAt}」失败,本步没有输入`
      : opts.isAborted?.()
        ? '人工停止'
        : step.enabled === false
          ? '编排档里关掉了这一步'
          : undefined;

    if (skipReason) {
      steps.push({ id: step.id, kind: step.kind, label, status: 'skipped', produced: 0, note: skipReason, elapsedMs: 0 });
      await recordStep(stepCtx, {
        status: 'skipped', input: step.params, reasoning: skipReason, durationMs: 0,
      }).catch(() => { /* 留痕失败不拦执行 */ });
      continue;
    }

    const fn = caps[step.kind as keyof FlowCapabilities];
    if (typeof fn !== 'function') {
      /** ⚠️ fail loud:编排档写了一个不存在的 kind,必须当场说清楚 */
      const err = `编排档里的步骤类型「${step.kind}」没有对应能力`;
      failedAt = step.id;
      steps.push({ id: step.id, kind: step.kind, label, status: 'failed', produced: 0, error: err, elapsedMs: 0 });
      await recordStep(stepCtx, { status: 'failed', input: step.params, reasoning: err, durationMs: 0 }).catch(() => {});
      continue;
    }

    const s0 = Date.now();
    let out: FlowStepOutcome;
    try {
      out = await fn(step.params ?? {}, wsId);
    } catch (e) {
      /** ⚠️ 能力抛异常也要落记录 —— 否则这一步在 flow_step_run 里根本不存在 */
      out = { ok: false, produced: 0, error: String(e).slice(0, 300), elapsedMs: Date.now() - s0 };
    }

    if (!out.ok) failedAt = step.id;
    steps.push({
      id: step.id, kind: step.kind, label,
      status: out.ok ? 'ok' : 'failed',
      produced: out.produced, error: out.error, note: out.note, elapsedMs: out.elapsedMs,
    });
    await recordStep(stepCtx, {
      status: out.ok ? 'ok' : 'failed',
      input: step.params,
      /** ⭐ 产出数进 output —— 「跑了但产出 0」日后回看要查得到 */
      output: { produced: out.produced, note: out.note },
      reasoning: out.error,
      durationMs: out.elapsedMs,
    }).catch(() => {});
  }

  const elapsedMs = Date.now() - t0;
  const ok = !failedAt;
  /** ⚠️ endRun 收的是 runId 不是 ctx */
  await endRun(runId, ok ? 'ok' : 'failed', failedAt ? `断在步骤「${failedAt}」` : undefined)
    .catch(() => {});

  return { runId, flowName: recipe.name, steps, ok, failedAt, elapsedMs };
}

/**
 * 步骤类型 → `flow_step_run.step_type`。
 *
 * ⚠️ 与能力层的 `STEP_TYPE_OF` **同一套词**(act/fetch/judge)——
 * 另起一套会让两边的审计数据对不上,而那种错在数据里看不出来。
 */
function kindToStepType(kind: string): 'act' | 'fetch' | 'judge' {
  if (kind === 'goto') return 'act';
  if (kind === 'judge' || kind === 'planReply') return 'judge';
  return 'fetch';
}
