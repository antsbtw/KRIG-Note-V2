/**
 * 执行记录仓库 —— 把「谁让它跑的」真正写进 `krig_flow`。
 *
 * ⚠️ 这是**唯一**写 flow 表的地方。散落写入会让字段口径漂移,
 * 而漂移的表现是「记录在,但查不出来」(索引对不上),最难查的那种。
 *
 * ── 一条纪律:记录失败**绝不拦住业务** ──
 *
 * 留痕挂了,流程要照常跑完 —— 否则「为了能追溯」反而把功能弄坏了。
 * 但也**绝不静默**:写不进去要 warn 出来,否则「记录是空的」会被
 * 误读成「没跑过」,那比没有记录更坏。
 */

import { getFlowDB } from '@storage/surreal/client';
import type { ExecContext, StepContext, StepStatus } from './exec-context';

/** 开一条 run —— 流程起步时调一次 */
export async function startRun(ctx: ExecContext): Promise<void> {
  try {
    await getFlowDB().query(
      `CREATE flow_run SET
         run_id = $runId, flow_name = $flowName, trigger = $trigger,
         trigger_ref = $triggerRef, subject_kind = $subjectKind, subject_ref = $subjectRef,
         ws_id = $wsId, status = 'running', started_at = time::now()`,
      {
        runId: ctx.runId,
        flowName: ctx.flowName,
        trigger: ctx.trigger,
        // ⚠️ option<T> 传 undefined 不传 null —— NONE ≠ NULL,`?? null` 就是 bug
        triggerRef: ctx.triggerRef ?? undefined,
        subjectKind: ctx.subject?.kind ?? undefined,
        subjectRef: ctx.subject?.ref ?? undefined,
        wsId: ctx.wsId ?? undefined,
      },
    );
  } catch (err) {
    console.warn(`[flow-repo] 开 run 失败(流程继续跑,但这次执行查不到):${String(err)}`);
  }
}

/**
 * 记一步。
 *
 * ⭐⭐ **被跳过 / 被拒绝的也要记**(设计 Module5-01 §6.3 明确要求)。
 * 只记成功的话,「为什么没发生」永远查不出来 —— 而那恰恰是最常问的问题。
 */
export async function recordStep(
  ctx: StepContext,
  result: {
    status: StepStatus;
    input?: unknown;
    output?: unknown;
    missing?: readonly string[];
    /** 失败/跳过/拒绝的原因 —— 三种都往这里写 */
    reasoning?: string;
    durationMs: number;
  },
): Promise<void> {
  try {
    const subj = ctx.stepSubject ?? ctx.subject;
    await getFlowDB().query(
      `CREATE flow_step_run SET
         run_id = $runId, seq = $seq, step_id = $stepId, step_type = $stepType,
         capability = $capability, input = $input, output = $output,
         status = $status, missing = $missing, reasoning = $reasoning,
         subject_ref = $subjectRef, duration_ms = $durationMs, created_at = time::now()`,
      {
        runId: ctx.runId,
        seq: ctx.seq,
        stepId: ctx.stepId,
        stepType: ctx.stepType,
        capability: ctx.capability ?? undefined,
        // ⚠️ 入参/出参原样存(FLEXIBLE object)—— 回放靠它,压缩就没法回放了
        input: (result.input ?? undefined) as Record<string, unknown> | undefined,
        output: (result.output ?? undefined) as Record<string, unknown> | undefined,
        status: result.status,
        missing: result.missing && result.missing.length > 0
          ? [...result.missing] : undefined,
        reasoning: result.reasoning ?? undefined,
        subjectRef: subj?.ref ?? undefined,
        durationMs: Math.max(0, Math.round(result.durationMs)),
      },
    );
  } catch (err) {
    console.warn(`[flow-repo] 记 step 失败(不拦流程):${String(err)}`);
  }
}

/**
 * 收一条 run。
 *
 * ⚠️ `status` 由**调用方**汇总给出,这里不替它算 ——
 * 「一步 degraded 算整条 degraded 还是 ok」是业务决定,不是仓库决定。
 */
export async function endRun(
  runId: string,
  status: 'ok' | 'degraded' | 'failed',
  error?: string,
): Promise<void> {
  try {
    /**
     * ⚠️⚠️ **duration 必须用 `duration::millis()`** —— 2026-09-24 实测揪出:
     * 原来写 `math::floor((time::now() - started_at) / 1ms)`,算出来是 **NaN**,
     * 被 schema 拒收(`Expected none | int but found NaN`)→ **整条 UPDATE 失败**
     * → run **永远停在 running**。
     *
     * ⚠️ 而下面的 catch 把它吞成了 warn,于是**两次运行都卡在 running 也没人发现** ——
     * 「跑到一半崩了」与「跑完了」在记录里长得一模一样,正是本仓最忌的形态。
     */
    const res = await getFlowDB().query<[unknown]>(
      `UPDATE flow_run SET
         status = $status, ended_at = time::now(), error = $error,
         duration_ms = duration::millis(time::now() - started_at)
       WHERE run_id = $runId`,
      { runId, status, error: error ?? undefined },
    );
    /**
     * ⭐ **写了但一行都没更新**也要响 —— runId 对不上时 UPDATE 不报错、
     * 只是影响 0 行,而记录照样停在 running。
     */
    const rows = Array.isArray(res?.[0]) ? (res[0] as unknown[]).length : 0;
    if (rows === 0) {
      console.warn(`[flow-repo] ⚠️ endRun 没更新到任何行(run_id=${runId})—— 记录会停在 running`);
    }
  } catch (err) {
    /** ⚠️ 不静默:收不了 run 就是「这次执行没有结局」,必须看得见 */
    console.error(`[flow-repo] ⚠️⚠️ 收 run 失败,记录会停在 running(run_id=${runId}):${String(err)}`);
  }
}

/** 一次执行的完整回看 —— run 头 + 每步 */
export async function readRun(runId: string): Promise<{
  run: Record<string, unknown> | null;
  steps: Array<Record<string, unknown>>;
}> {
  const db = getFlowDB();
  const res = await db.query<[Array<Record<string, unknown>>, Array<Record<string, unknown>>]>(
    `SELECT * FROM flow_run WHERE run_id = $runId LIMIT 1;
     SELECT * FROM flow_step_run WHERE run_id = $runId ORDER BY seq ASC;`,
    { runId },
  );
  return { run: res?.[0]?.[0] ?? null, steps: res?.[1] ?? [] };
}

/** 最近 N 次执行 —— 面板列表用 */
export async function listRuns(limit = 20): Promise<Array<Record<string, unknown>>> {
  const res = await getFlowDB().query<[Array<Record<string, unknown>>]>(
    `SELECT run_id, flow_name, trigger, subject_kind, subject_ref,
            status, started_at, duration_ms
       FROM flow_run ORDER BY started_at DESC LIMIT $limit`,
    { limit },
  );
  return res?.[0] ?? [];
}

/**
 * ⭐ 反查:某个对象(handle / tweet_id)都被谁跑过。
 *
 * 这正是「从推文查:这条推被谁判过、判了什么」那条路 ——
 * 没有它,追溯就只能从流程往下看,不能从对象往回查。
 */
export async function findStepsBySubject(
  subjectRef: string, limit = 50,
): Promise<Array<Record<string, unknown>>> {
  const res = await getFlowDB().query<[Array<Record<string, unknown>>]>(
    `SELECT run_id, seq, step_id, step_type, capability, status,
            reasoning, created_at, duration_ms
       FROM flow_step_run WHERE subject_ref = $ref
       ORDER BY created_at DESC LIMIT $limit`,
    { ref: subjectRef, limit },
  );
  return res?.[0] ?? [];
}
