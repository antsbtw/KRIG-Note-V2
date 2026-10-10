/**
 * ⭐ 运营设置 + 动作记录 的读写(仅 main 进程)—— 规则在 `x-ops-settings.ts`(纯)
 *
 * ⚠️ 动作记录**只追加**,不改不删:它是出了问题时的依据,也是将来检验 AI 判断的依据。
 */

import { getXDB } from '@storage/surreal/client';
import { mergeSettings, unfollowGate, validateSetting, type OpsSettings, type UnfollowGate } from './x-ops-settings';

export async function readSettings(): Promise<{ settings: OpsSettings; problems: string[] }> {
  const [rows] = await getXDB().query<[Array<{ key: string; setting_value: unknown }>]>(
    'SELECT record::id(id) AS key, setting_value FROM x_setting',
  );
  return mergeSettings(rows ?? []);
}

export async function writeSetting(key: string, value: unknown): Promise<void> {
  const why = validateSetting(key, value);
  if (why !== null) throw new Error(`[x.ops] ${why}`);
  const [rows] = await getXDB().query<[Array<{ setting_value: unknown }>]>(
    "UPSERT type::record('x_setting', $k) SET setting_value = $v, updated_at = time::now() RETURN setting_value",
    { k: key, v: value },
  );
  if (!rows || rows[0]?.setting_value !== value) throw new Error(`[x.ops] 设置 ${key} 没写上`);
}

export type ActionEntry = {
  readonly action: 'unfollow';
  readonly targetRestId: string;
  readonly targetHandle: string;
  readonly decidedBy: 'human' | 'ai';
  readonly result: 'ok' | 'failed';
  readonly reason?: string;
  readonly detail?: string;
  readonly wsId?: string;
};

export async function appendAction(e: ActionEntry): Promise<void> {
  await getXDB().query(
    `CREATE x_action_log SET at = time::now(), action = $action, target_rest_id = $rid, target_handle = $handle,
       decided_by = $by, result = $result, reason = $reason, detail = $detail, ws_id = $ws`,
    {
      action: e.action, rid: e.targetRestId, handle: e.targetHandle, by: e.decidedBy, result: e.result,
      /** ⚠️ option 字段传 undefined(→ NONE),不传 null */
      reason: e.reason || undefined, detail: e.detail || undefined, ws: e.wsId || undefined,
    },
  );
}

/** ⭐ 现在能不能取关 —— 今天(从 dayStart 起)成功几次、最后一次何时,交给纯函数判 */
export async function readUnfollowGate(dayStartIso: string): Promise<UnfollowGate> {
  const { settings } = await readSettings();
  const [[today], [last]] = await getXDB().query<[Array<{ n: number }>, Array<{ last?: string }>]>(`
    SELECT count() AS n FROM x_action_log
      WHERE action = 'unfollow' AND result = 'ok' AND at >= type::datetime($since) GROUP ALL;
    SELECT <string> time::max(at) AS last FROM x_action_log
      WHERE action = 'unfollow' AND result = 'ok' GROUP ALL;`, { since: dayStartIso });
  return unfollowGate(settings, today?.n ?? 0, last?.last, new Date());
}
