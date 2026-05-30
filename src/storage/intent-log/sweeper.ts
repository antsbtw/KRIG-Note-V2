/**
 * sweeper — 启动时扫描未完成 intent,续完/回滚(SP-3 数据层可靠性)
 *
 * 挂载点:initStorage() 内,migrations 之后、cardinality-check 之前(半状态可能
 * 正是 cardinality 误判源,先清半状态)。详 design §3.4。
 *
 * 架构:sweeper 本身**不懂业务**(不依赖 note/folder 语义)。各 op 的"如何续完"
 * 由对应 capability 在启动早期注册 resolver(registerIntentResolver),sweeper 按
 * intent.op 派发。这样 storage 层不反向依赖 capability(分层不破)。
 *
 * 幂等:resolver 从 intent.cursor 续(删/回滚天然幂等);sweeper 自身崩溃 → intent
 * 留 pending,下次启动重试。失败的 intent log 告警,不静默堆积。
 */

import type { IntentEntity, IntentOp } from './types';
import { listPendingIntents, deleteIntent } from './intent-store';

/**
 * op resolver:从 intent 当前 cursor 续完该操作(完成后自行删 intent,或抛错留 pending)。
 * 由 capability 注册;未注册的 op 在 sweep 时 log 警告并跳过(不阻塞启动)。
 */
export type IntentResolver = (intent: IntentEntity) => Promise<void>;

const resolvers = new Map<IntentOp, IntentResolver>();

/** capability 启动早期注册某 op 的续完逻辑 */
export function registerIntentResolver(op: IntentOp, resolver: IntentResolver): void {
  if (resolvers.has(op)) {
    console.warn(`[sweeper] intent resolver for '${op}' already registered, overwriting`);
  }
  resolvers.set(op, resolver);
}

/** 启动时调用:扫 pending intent,逐个派发给 resolver 续完 */
export async function sweepPendingIntents(): Promise<void> {
  let pending: IntentEntity[];
  try {
    pending = await listPendingIntents();
  } catch (err) {
    console.error('[sweeper] listPendingIntents failed, skip sweep:', err);
    return;
  }
  if (pending.length === 0) {
    return;
  }

  console.log(`[sweeper] found ${pending.length} pending intent(s), resolving…`);
  let resolved = 0;
  let failed = 0;
  for (const intent of pending) {
    const resolver = resolvers.get(intent.op);
    if (!resolver) {
      console.warn(
        `[sweeper] no resolver for op '${intent.op}' (intent ${intent.id}); ` +
          `leaving pending — register a resolver or clear manually`,
      );
      failed++;
      continue;
    }
    try {
      await resolver(intent);
      // resolver 约定自行删 intent;若没删(防御),这里兜底删,避免重复 sweep
      await deleteIntent(intent.id).catch(() => {});
      resolved++;
    } catch (err) {
      console.error(`[sweeper] resolver for intent ${intent.id} (${intent.op}) failed:`, err);
      failed++;
    }
  }
  console.log(`[sweeper] done — resolved=${resolved} failed=${failed}`);
}
