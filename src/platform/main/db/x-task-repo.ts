/**
 * ⭐⭐ `x_task` 表 CRUD —— 「先配置任务,再执行」的数据层
 *
 * 调用边界:仅 main 进程调用,直接 import `@storage/surreal/client`。
 * ⚠️ 走 **X 库(krig_x)**,用 `getXDB()` 而非 `getDB()`。
 *
 * ── 它替代 `search-recipe-repo.ts` ──
 *
 * ⚠️ 本 repo **不认识任何具体策略**:`params` 原样存取,
 * 校验交给 `CollectStrategyRegistry.validate()`(它读 paramsSchema)。
 * 在这里加 `if (strategyId === 'keyword')` 就等于把注册制退回枚举。
 */

import { getXDB } from '@storage/surreal/client';
import { generateUlid } from '@shared/ulid';
import type { XTask, XTaskInput, XTaskRunState } from '@shared/types/x-task';

interface TaskRow {
  task_id: string;
  name: string;
  description?: string;
  strategy_id: string;
  params?: Record<string, unknown>;
  enabled: boolean;
  interval_minutes: number;
  last_run_at?: string;
  ws_id?: string;
  run_state?: string;
  last_error?: string;
  last_result?: XTask['lastResult'];
}

function rowToTask(row: TaskRow): XTask {
  return {
    id: row.task_id,
    name: row.name,
    description: row.description ?? undefined,
    strategyId: row.strategy_id,
    // ⚠️ params 可能是 NONE(空对象没写进去)——回落成 {} 而不是 undefined,
    //    调用方少一处判空;空参数是合法状态(有些策略不需要参数)
    params: row.params ?? {},
    enabled: row.enabled,
    intervalMinutes: row.interval_minutes,
    lastRunAt: row.last_run_at != null ? String(row.last_run_at) : undefined,
    /**
     * ⚠️ **没有归属就 fail loud,绝不回落成空串**。
     *
     * 新模型下调度器按 ws 查任务(`WHERE ws_id = $wsId`),所以没归属的任务
     * **永远不会被执行** —— 而现象是「列表里有它,就是不跑」,毫无线索。
     * 回落成 '' 只会让它跑到一个不存在的 ws 上,更难查。
     *
     * 正常情况不可能走到这里:字段必填 + migration 1.1.9 已把历史空值补成 ws-2。
     * 真走到了,说明有人绕过 repo 直接写库。
     */
    wsId: (() => {
      if (!row.ws_id) {
        throw new Error(
          `[x-task-repo] 任务 ${row.task_id}「${row.name}」没有 ws 归属 —— `
          + '新模型下它永远不会被执行(调度器按 ws 查)。请指定 ws_id。',
        );
      }
      return row.ws_id;
    })(),
    runState: (row.run_state as XTaskRunState | undefined) ?? 'idle',
    lastError: row.last_error ?? undefined,
    lastResult: row.last_result ?? undefined,
  };
}

/**
 * 取某个 ws 的全部任务(配置面板用),按创建序。
 *
 * ⭐⭐ **wsId 必传** —— 任务归属于 ws(用户 2026-09-14:「在哪个窗口配置,
 * 就是打开哪个窗口才执行……任何的配置只是对自己的窗口负责」)。
 * ⚠️ 不提供「取全部 ws 的任务」的重载:那会让 UI 一不小心显示出别人的任务,
 * 而「显示了就可能被点执行」。要跨 ws 看,是另一个明确的运维需求,届时单开。
 */
export async function listAllTasks(wsId: string): Promise<XTask[]> {
  const db = getXDB();
  const res = await db.query<[TaskRow[]]>(
    `SELECT * FROM x_task WHERE ws_id = $wsId ORDER BY created_at ASC`, { wsId },
  );
  return (res[0] ?? []).map(rowToTask);
}

/**
 * 取某个 ws 里启用的任务(调度器用)。
 *
 * ⚠️ 同上必传 wsId:调度器**按 ws 逐个问**,而不是拿全部任务再过滤 ——
 * 后者会让「忘了过滤」变成「所有 ws 跑所有任务」,而且不报错。
 */
export async function listEnabledTasks(wsId: string): Promise<XTask[]> {
  const db = getXDB();
  const res = await db.query<[TaskRow[]]>(
    `SELECT * FROM x_task WHERE enabled = true AND ws_id = $wsId`, { wsId },
  );
  return (res[0] ?? []).map(rowToTask);
}

/**
 * 取单个任务。
 *
 * ⚠️ 取不到返回 null 而不是抛 —— 调用方(UI)常有「这个 id 还在不在」的正常询问。
 * **但调度器拿不到时必须 fail loud**,那是调用方的责任。
 */
export async function getTaskById(taskId: string): Promise<XTask | null> {
  const db = getXDB();
  const res = await db.query<[TaskRow[]]>(
    `SELECT * FROM x_task WHERE task_id = $id LIMIT 1`, { id: taskId },
  );
  const row = res[0]?.[0];
  return row ? rowToTask(row) : null;
}

/**
 * 新建或更新任务(幂等 upsert)。
 *
 * ⚠️ **不校验 params** —— 那要读 paramsSchema,是 capability 层的事。
 * 在这里校验会让 repo 认识具体策略,正是要避免的。
 */
export async function upsertTask(input: XTaskInput): Promise<string> {
  const db = getXDB();
  const id = input.id || generateUlid();

  const existing = await db.query<[Array<{ task_id: string }>]>(
    `SELECT task_id FROM x_task WHERE task_id = $id LIMIT 1`, { id },
  );

  // ⚠️ option 字段传 undefined → NONE;绝不传 null(SurrealDB 的 NONE ≠ NULL)
  const params = {
    id,
    name: input.name,
    desc: input.description || undefined,
    strategy: input.strategyId,
    p: input.params ?? {},
    enabled: input.enabled,
    interval: input.intervalMinutes,
    lastRun: input.lastRunAt ? new Date(input.lastRunAt) : undefined,
    wsId: input.wsId || undefined,
  };

  if ((existing[0] ?? []).length > 0) {
    await db.query(
      `UPDATE x_task SET
         name = $name, description = $desc, strategy_id = $strategy,
         params = $p, enabled = $enabled, interval_minutes = $interval,
         last_run_at = $lastRun, ws_id = $wsId
       WHERE task_id = $id`,
      params,
    );
  } else {
    await db.query(
      `CREATE x_task SET
         task_id = $id, name = $name, description = $desc,
         strategy_id = $strategy, params = $p,
         enabled = $enabled, interval_minutes = $interval,
         last_run_at = $lastRun, ws_id = $wsId,
         run_state = 'idle', created_at = time::now()`,
      params,
    );
  }
  return id;
}

export async function deleteTask(taskId: string): Promise<void> {
  const db = getXDB();
  await db.query(`DELETE FROM x_task WHERE task_id = $id`, { id: taskId });
}

/** 更新 last_run_at(调度器每轮跑完调) */
export async function updateTaskLastRunAt(taskId: string, at: string): Promise<void> {
  const db = getXDB();
  await db.query(
    `UPDATE x_task SET last_run_at = $at WHERE task_id = $id`,
    { at: new Date(at), id: taskId },
  );
}

/**
 * ⭐ 记录运行态。
 *
 * ⚠️ **失败必须留下 `lastError`** —— 「跑了没成功」和「没跑」在界面上
 * 长得一模一样(都是 last_run_at 没动)。不记原因就等于静默。
 *
 * ⚠️ 成功时**清掉** lastError:不清的话上次的错误会一直挂着,
 * 让人以为还坏着(本仓在别处踩过同款「陈旧错误」)。
 */
export async function setTaskRunState(
  taskId: string,
  state: XTaskRunState,
  detail?: { error?: string; result?: XTask['lastResult'] },
): Promise<void> {
  const db = getXDB();
  await db.query(
    `UPDATE x_task SET run_state = $state, last_error = $err, last_result = $result
     WHERE task_id = $id`,
    {
      id: taskId,
      state,
      err: state === 'failed' ? (detail?.error ?? '未给出原因') : undefined,
      result: detail?.result ?? undefined,
    },
  );
}

/**
 * ⚠️ 启动时把卡在 `running` 的任务复位。
 *
 * 任务执行**不跨进程存活** —— 上次退出时正在跑的任务,重启后它的 `running`
 * 是假的,会让调度器以为「还在跑」而永远跳过它(僵尸态)。
 * 同 `recoverStuckAiJudging` 的理由。
 */
export async function recoverStuckTasks(): Promise<number> {
  const db = getXDB();
  const res = await db.query<[Array<{ task_id: string }>]>(
    `UPDATE x_task SET run_state = 'idle' WHERE run_state = 'running' RETURN task_id`,
  );
  return (res[0] ?? []).length;
}
