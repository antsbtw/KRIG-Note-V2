/**
 * V2 storage 主入口
 *
 * 调用边界 (decision 008 §4.0):
 * - View 层禁止 import @storage
 * - Capability / Platform 层可 import
 * - 业务层通过 capability API 间接访问
 */
import { initSurrealDB, shutdownSurrealDB, shutdownSurrealDBAsync, getDB, getXDB, getFlowDB } from './surreal/client';
import { runMigrations } from './migrations/runner';
import { runXMigrations } from './migrations/x-runner';
import { runFlowMigrations } from './migrations/flow-runner';
import { surrealStorage } from './surreal/storage';
import { runCardinalityCheck } from './health/cardinality-check';
import { sweepPendingIntents } from './intent-log';

export type {
  StorageAPI,
  StorageOptions,
  PutAtomInput,
  PutAtomInputUnsafe,
  AtomFilter,
  PutEdgeInput,
  EdgeFilter,
  SubgraphQuery,
  SubgraphResult,
  StorageTransaction,
} from './api';

export const storage = surrealStorage;

export async function initStorage(): Promise<void> {
  await initSurrealDB();
  await runMigrations(getDB());
  // X 库独立 migration 序列(自己的 schema_version,与上面的 1.9.x 无关)。
  // 放在笔记库 migration 之后、业务 sweeper 之前:两者无依赖,顺序只求可预期。
  //
  // ⚠️ 失败必须响(reliability-charter「故障必须响,不静默坍缩」):
  // main/index.ts 对 initStorage 的 catch 只 console.error,app 会照常起来。
  // 2026-09-01 就是这样吃了一次哑巴亏 —— X migration 因缺 DEFINE DATABASE 全程失败,
  // 而界面一切正常,krig_x 却根本不存在,查了一轮才发现。
  // 这里额外打一条**显眼**的错误横幅:X 功能此时是坏的(getXDB 能连但表不存在),
  // 与其让它在用户点开 X 面板时报一堆看不懂的次生错误,不如启动时就吼出来。
  try {
    await runXMigrations(getXDB());
  } catch (err) {
    console.error(
      '\n' + '='.repeat(72) +
      '\n[storage] ✗✗✗ X 库(krig_x)migration 失败 —— X 功能不可用 ✗✗✗' +
      '\n  笔记库不受影响(独立 database),但 X 的采集/收件箱/AI 判断都会报错。' +
      '\n  排查:curl 问库 `INFO FOR NS` 看 krig_x 在不在、`INFO FOR TABLE x_tweet` 看字段。' +
      '\n' + '='.repeat(72) + '\n',
      err,
    );
    // ⚠️ **不 rethrow**。曾经在这里 throw 过,是设计错误:
    // 它会逃出 initStorage → 被 main/index.ts 的 catch 接住 → 启动继续,
    // 但**后面的 sweepPendingIntents / runCardinalityCheck 被整段跳过** ——
    // 把「X 库坏了」放大成「笔记库的完整性自检没跑」,正好违背上面那句
    // "笔记库不受影响"。X 是独立 database,它的故障不该拖累笔记库的启动步骤。
    // 响 = 上面这条横幅(够显眼);不 = 中断别人的初始化。
  }

  /**
   * ⭐ 工作流库(krig_flow)独立 migration 序列 —— 执行记录表。
   *
   * ⚠️ 与 X 同款处理:**失败要响,但不 rethrow**(理由见上面那段)。
   * 差别在于「坏了会怎样」:
   *  · X 坏 → 采集/收件箱不可用
   *  · flow 坏 → **所有调用都变成没有来历的孤儿记录**,
   *    「谁让它跑的、为哪条推跑的」事后**补不回来**。
   *    采集照样能跑,但跑过的事查不出来 —— 这正是用户要的
   *    「系统必须有维护能力和追溯能力」那一条的反面。
   */
  try {
    await runFlowMigrations(getFlowDB());
  } catch (err) {
    console.error(
      '\n' + '='.repeat(72) +
      '\n[storage] ✗✗✗ 工作流库(krig_flow)migration 失败 —— 执行记录不可用 ✗✗✗' +
      '\n  笔记库 / X 库不受影响(独立 database)。' +
      '\n  后果:流程照样能跑,但**跑过什么查不出来**(谁调的/为谁跑的/第几步全丢)。' +
      '\n  排查:curl 问库 `INFO FOR NS` 看 krig_flow 在不在、`INFO FOR DB` 看两张表。' +
      '\n' + '='.repeat(72) + '\n',
      err,
    );
  }
  // SP-3 sweeper:扫未完成 intent 续完/回滚。在 migrations 后(intent 表已建)、
  // cardinality-check 前(半状态可能正是 cardinality 误判源,先清半状态)。
  // 各 op resolver 由 capability 在 initIpcBus 阶段(initStorage 之前)注册;未注册的
  // op sweeper 会 log 跳过不阻塞启动(详 design §3.4)。
  await sweepPendingIntents();
  // P0a-bis K3+K4:cardinality 一对一约束 self-check + keep-latest 自愈
  // (在 runMigrations 后,任何业务 IPC 调用前)
  await runCardinalityCheck(surrealStorage);
  console.log('[storage] initialized');
}

export async function shutdownStorage(): Promise<void> {
  await shutdownSurrealDBAsync();
}

/** before-quit 同步关闭 (不等子进程退出) */
export function shutdownStorageSync(): void {
  shutdownSurrealDB();
}
