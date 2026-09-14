/**
 * x_ws_role 表 CRUD —— X per-ws 角色(2026-09-03)
 *
 * 调用边界:仅 main 进程。走 **X 库(krig_x)**,用 getXDB()。
 *
 * 设计见 shared/types/x-ws-role-types.ts。核心约束:
 *  · 定时搜索采集只在 role='search' 的 ws 上跑
 *  · 活动核验只用 role='campaign' 的 ws,**拿到别的角色要 fail loud**
 *    —— 静默用了搜索 ws 的 webview,后果是两边互相打断且看不出原因
 */

import { getXDB } from '@storage/surreal/client';
import { normalizeHandle } from '@shared/types/x-timeline-types';
import { DEFAULT_X_WS_ROLE, DEFAULT_CAMPAIGN_INTERVAL_MINUTES,
  type XWsRole, type XWsRoleConfig } from '@shared/types/x-ws-role-types';

interface RoleRow {
  ws_id: string;
  role: string;
  article_id?: string | null;
  serves_refresh?: boolean;
  interval_minutes?: number | null;
}

function rowToConfig(r: RoleRow): XWsRoleConfig {
  return {
    wsId: r.ws_id,
    role: r.role as XWsRole,
    articleId: r.article_id ?? undefined,
    servesRefresh: r.serves_refresh ?? false,
    intervalMinutes: r.interval_minutes ?? undefined,
  };
}

/** 设定某 ws 的角色(幂等) */
export async function setWsRole(cfg: XWsRoleConfig): Promise<void> {
  if (!cfg.wsId) throw new Error('[x-ws-role-repo] setWsRole: wsId required');
  const db = getXDB();

  // 接口 B 的承接者只能有一个(端口冲突)—— 置新的之前先清旧的
  if (cfg.servesRefresh) {
    await db.query(
      `UPDATE x_ws_role SET serves_refresh = false
       WHERE serves_refresh = true AND ws_id != $wsId`,
      { wsId: cfg.wsId },
    );
  }

  const params = {
    wsId: cfg.wsId,
    role: cfg.role,
    // ⚠️ option 字段传 undefined→NONE,绝不传 null(SurrealDB 的 NONE ≠ NULL)
    articleId: cfg.articleId || undefined,
    servesRefresh: cfg.servesRefresh ?? false,
    interval: cfg.intervalMinutes ?? undefined,
  };
  const existing = await db.query<[RoleRow[]]>(
    `SELECT ws_id FROM x_ws_role WHERE ws_id = $wsId LIMIT 1`, { wsId: cfg.wsId });

  const setClause = `role = $role, article_id = $articleId,
    serves_refresh = $servesRefresh, interval_minutes = $interval, updated_at = time::now()`;
  if ((existing[0] ?? []).length > 0) {
    await db.query(`UPDATE x_ws_role SET ${setClause} WHERE ws_id = $wsId`, params);
  } else {
    await db.query(`CREATE x_ws_role SET ws_id = $wsId, ${setClause}`, params);
  }
  console.log(`[x-ws-role] ws=${cfg.wsId} → role=${cfg.role}`
    + `${cfg.articleId ? ` article=${cfg.articleId}` : ''}`
    + `${cfg.servesRefresh ? ' (承接 /refresh)' : ''}`);
}

/** 读某 ws 的角色;未配置返回 idle(**不参与定时任务**的安全默认) */
export async function getWsRole(wsId: string): Promise<XWsRoleConfig> {
  const db = getXDB();
  const res = await db.query<[RoleRow[]]>(
    `SELECT * FROM x_ws_role WHERE ws_id = $wsId LIMIT 1`, { wsId });
  const row = res[0]?.[0];
  return row ? rowToConfig(row) : { wsId, role: DEFAULT_X_WS_ROLE };
}

/** 列出所有已配置的角色 */
export async function listWsRoles(): Promise<XWsRoleConfig[]> {
  const db = getXDB();
  const res = await db.query<[RoleRow[]]>(`SELECT * FROM x_ws_role ORDER BY ws_id`);
  return (res[0] ?? []).map(rowToConfig);
}

/** 取指定角色的全部 ws */
export async function listWsByRole(role: XWsRole): Promise<XWsRoleConfig[]> {
  const db = getXDB();
  const res = await db.query<[RoleRow[]]>(
    `SELECT * FROM x_ws_role WHERE role = $role`, { role });
  return (res[0] ?? []).map(rowToConfig);
}

/**
 * 断言某 ws 具备指定角色 —— **不符就抛**。
 *
 * ⚠️ 这是本模块最重要的一个函数:活动任务若静默用了 role='search' 的 webview,
 * 两边会互相导航打断,而现象是「采集时断时续」「活动偶尔抓不到」——
 * 极难定位。故必须 fail loud(feedback-fail-loud-no-fallback)。
 */
export async function requireWsRole(wsId: string, role: XWsRole): Promise<XWsRoleConfig> {
  const cfg = await getWsRole(wsId);
  if (cfg.role !== role) {
    throw new Error(
      `[x-ws-role] ws=${wsId} 的角色是 '${cfg.role}',需要 '${role}'。`
      + `拒绝执行 —— 跨角色复用 webview 会让两个任务互相导航打断。`
      + `请在 X 设置里把该 ws 配成 '${role}',或换用正确的 ws。`,
    );
  }
  return cfg;
}

/** 取承接接口 B 的那个 campaign ws;没有则 null */
export async function getRefreshServingWs(): Promise<XWsRoleConfig | null> {
  const db = getXDB();
  const res = await db.query<[RoleRow[]]>(
    `SELECT * FROM x_ws_role WHERE role = 'campaign' AND serves_refresh = true LIMIT 1`);
  const row = res[0]?.[0];
  return row ? rowToConfig(row) : null;
}

/** campaign ws 的抓取间隔(分钟),带默认值 */
export function campaignInterval(cfg: XWsRoleConfig): number {
  return cfg.intervalMinutes ?? DEFAULT_CAMPAIGN_INTERVAL_MINUTES;
}

// ── per-ws 登录账号 ──────────────────────────────────────────────
// 用户 2026-09-03:「当前 ws 是登录什么账号,就核实这个 ws 的状态,
//   而不是跑到一个对应不上的 ws 来核实」。
// 身份是 ws 的属性(X webview 的登录态本就 per-ws / per-partition),
// 不是全局单例 —— 全局单例会让两个 ws 互相覆盖且不报错。

export interface WsAccount { wsId: string; handle: string; restId?: string; detectedAt?: string }

/** 记录某 ws 当前登录的账号(幂等) */
export async function setWsAccount(
  wsId: string, handle: string, restId?: string,
): Promise<void> {
  const h = normalizeHandle(handle);
  if (!wsId) throw new Error('[x-ws-role-repo] setWsAccount: wsId required');
  if (!h) throw new Error('[x-ws-role-repo] setWsAccount: handle required');

  const db = getXDB();
  const existing = await db.query<[Array<{ ws_id: string }>]>(
    `SELECT ws_id FROM x_ws_account WHERE ws_id = $wsId LIMIT 1`, { wsId });
  const params = { wsId, h, rid: restId || undefined };
  if ((existing[0] ?? []).length > 0) {
    await db.query(
      `UPDATE x_ws_account SET handle = $h, rest_id = $rid, detected_at = time::now()
       WHERE ws_id = $wsId`, params);
  } else {
    await db.query(
      `CREATE x_ws_account SET ws_id = $wsId, handle = $h, rest_id = $rid,
       detected_at = time::now()`, params);
  }
  console.log(`[x-ws-account] ws=${wsId} 登录账号 = @${h}${restId ? ` (uid ${restId})` : ''}`);
}

/** 读某 ws 登录的账号;未识别返回 null */
export async function getWsAccount(wsId: string): Promise<WsAccount | null> {
  const db = getXDB();
  const res = await db.query<[Array<Record<string, unknown>>]>(
    `SELECT * FROM x_ws_account WHERE ws_id = $wsId LIMIT 1`, { wsId });
  const r = res[0]?.[0];
  if (!r) return null;
  return {
    wsId: String(r.ws_id), handle: String(r.handle),
    restId: r.rest_id ? String(r.rest_id) : undefined,
    detectedAt: r.detected_at ? String(r.detected_at) : undefined,
  };
}

/**
 * 断言某 ws 已识别登录账号 —— 未识别就抛。
 *
 * ⚠️ 不回落到「全局 is_self」:那正是此前的错误 ——
 * 两个 ws 登不同账号时,全局值只会是其中一个,用它去核实另一个 ws
 * 会静默抓错人(现象是「抓不到/对不上」,不报错)。
 */
export async function requireWsAccount(wsId: string): Promise<WsAccount> {
  const a = await getWsAccount(wsId);
  if (!a) {
    throw new Error(
      `[x-ws-account] ws=${wsId} 尚未识别登录账号。`
      + `请在该 ws 里点「识别我的账号」—— 每个 ws 各自登录、各自识别,`
      + `不能用别的 ws 的账号代替(会核实到对不上的账号上)。`,
    );
  }
  return a;
}

/** 列出所有 ws 的登录账号 —— UI 一览用 */
export async function listWsAccounts(): Promise<WsAccount[]> {
  const db = getXDB();
  const res = await db.query<[Array<Record<string, unknown>>]>(
    `SELECT * FROM x_ws_account ORDER BY ws_id`);
  return (res[0] ?? []).map((r) => ({
    wsId: String(r.ws_id), handle: String(r.handle),
    restId: r.rest_id ? String(r.rest_id) : undefined,
    detectedAt: r.detected_at ? String(r.detected_at) : undefined,
  }));
}
