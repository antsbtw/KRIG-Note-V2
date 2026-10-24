/**
 * ⭐⭐ 认号 + x_ws_account 读写(仅 main 进程)—— 判断在 `x-account.ts`(纯)
 *
 * 用户 10-16 选 A:从 X 页面认号,不碰登录凭据。两种用法:
 * ① **写关系前核对**(`accountForWrite`):只在页面上读一下登录号,**不跳页**;
 *    号认不出 / 变了 / 还没数字 id → 这批不写关系,说清原因,并把页面上看到的号先记下。
 * ② **认号**(`identifyAccount`):运营面板打开时 / 人点「认号」;还没数字 id 时**开一次自己的主页**
 *    从 UserByScreenName 载荷拿 id。X 网页正忙(采集中 / 后台在跑)就让路不跳,说清楚。
 */

import { getXDB } from '@storage/surreal/client';
import { decideAccount, parseWhoAmI, type AccountDecision, type WhoAmIRaw, type WsAccount } from './x-account';
import { webviewPorts } from './x-collect-ports';
import { X_SCRIPTS } from './x-dom-scripts';
import { getXHostState, listXHostStates } from './x-host-registry';
import { acquirePage, releasePage } from './x-page-lock';
import { X_NOISY_URLS, X_PAGE_NAME } from './x-pages';
import { PROFILE_ENDPOINT, pickProfileUser } from './x-person-refresh';
import { auditUserPayload } from './x-user-audit';

type Row = { ws_id: string; handle: string; rest_id?: string; detected_at?: string };

export async function readWsAccount(wsId: string): Promise<WsAccount | null> {
  const [rows] = await getXDB().query<[Row[]]>(
    `SELECT ws_id, handle, rest_id, (IF detected_at != NONE THEN <string> detected_at ELSE NONE END) AS detected_at
       FROM type::record('x_ws_account', $ws)`, { ws: wsId },
  );
  const r = rows?.[0];
  return r ? { wsId: r.ws_id, handle: r.handle, restId: r.rest_id ?? undefined, detectedAt: r.detected_at ?? undefined } : null;
}

/** ⚠️ restId 不给 = 不知道(NONE),**不保留旧值** —— 换了号还留着旧 id 就是写错号 */
async function writeWsAccount(wsId: string, handle: string, restId: string | undefined): Promise<void> {
  const [rows] = await getXDB().query<[Array<{ ws_id: string }>]>(
    `UPSERT type::record('x_ws_account', $ws) SET ws_id = $ws, handle = $handle, rest_id = $rest_id, detected_at = time::now()
       RETURN ws_id`,
    { ws: wsId, handle, rest_id: restId },
  );
  if (!rows || rows.length !== 1) throw new Error(`[x.account] x_ws_account 没写上(${wsId})`);
  console.log(`[x.account] ${wsId} 登录号 = @${handle}${restId ? `(${restId})` : '(数字 id 未知)'}`);
}

/** 这个 X 网页属于哪个 ws —— 主进程的登记表(x-host-sync 同步过来的) */
function wsOfWc(wcId: number): string | null {
  for (const [ws, st] of listXHostStates()) if (st.wcId === wcId) return ws;
  return null;
}

async function whoAmIOnWc(wcId: number): Promise<{ handle: string } | { error: string }> {
  try {
    const raw = await webviewPorts(wcId).runScript(X_SCRIPTS.whoAmI, {});
    return parseWhoAmI(raw as WhoAmIRaw);
  } catch (e) {
    return { error: `认号脚本没跑成:${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * ⭐⭐ 写关系前核对:这批数据是哪个号看到的。
 * ⚠️ 不跳页(采集中跳页会打断采集);需要认号时只把页面上看到的 handle 记下(数字 id 置空)。
 */
export async function accountForWrite(wcId: number | undefined): Promise<AccountDecision> {
  if (wcId === undefined || !Number.isInteger(wcId)) {
    return { kind: 'error', reason: '没说是哪个 X 网页采的(缺 wcId),不知道是哪个号看到的' };
  }
  const ws = wsOfWc(wcId);
  if (ws === null) return { kind: 'error', reason: `X 网页 wc#${wcId} 没登记到任何 ws` };
  const seen = await whoAmIOnWc(wcId);
  const row = await readWsAccount(ws);
  const d = decideAccount(row, seen);
  if (d.kind === 'needIdentify' && (row === null || row.handle !== d.handle)) {
    await writeWsAccount(ws, d.handle, undefined);
  }
  return d;
}

export type IdentifyResult =
  | { readonly status: 'ok'; readonly account: WsAccount }
  | { readonly status: 'pending'; readonly handle?: string; readonly reason: string }
  | { readonly status: 'failed'; readonly reason: string };

const IDENTIFY_BUSY = '运营正在认号';

/**
 * ⭐⭐ 认号:页面读 handle → 库里已有同 handle 且有数字 id 就完事;否则开一次自己的主页拿数字 id。
 */
export async function identifyAccount(wsId: string): Promise<IdentifyResult> {
  const wcId = getXHostState(wsId)?.wcId;
  if (wcId === undefined) return { status: 'failed', reason: `${wsId} 的 X 网页没开,认不了号` };
  const seen = await whoAmIOnWc(wcId);
  if ('error' in seen) return { status: 'failed', reason: seen.error };
  const row = await readWsAccount(wsId);
  if (row && row.handle === seen.handle && row.restId) {
    await writeWsAccount(wsId, row.handle, row.restId);
    return { status: 'ok', account: { ...row } };
  }
  /** handle 变了 → 旧 id 作废;没变但没 id → 保持没 id */
  if (!row || row.handle !== seen.handle) await writeWsAccount(wsId, seen.handle, undefined);

  /** ⭐ 占住 X 网页(x-page-lock);被占着(含另一次认号 / 后台在采)→ 等它空了再认 */
  const lock = acquirePage(wcId, IDENTIFY_BUSY, 'ui');
  if (!lock.ok) return { status: 'pending', handle: seen.handle, reason: `${lock.why},等它空了再认(要开一次 @${seen.handle} 的主页)` };
  try {
    const h = await webviewPorts(wcId).harvest({
      gotoPage: { name: X_PAGE_NAME.profile, params: { handle: seen.handle } },
      pageUrlIncludes: [PROFILE_ENDPOINT], wantPages: 1, maxRounds: 3, maxMs: 10_000,
      noisyUrlSubstrings: X_NOISY_URLS,
    });
    if (!h) return { status: 'failed', reason: `开 @${seen.handle} 的主页没采到东西` };
    const users = h.items.filter((it) => it.url.includes(PROFILE_ENDPOINT)).flatMap((it) => auditUserPayload(it.text).items);
    const me = pickProfileUser(users, seen.handle);
    if (!me?.restId) return { status: 'failed', reason: `@${seen.handle} 的主页资料里找不到数字 id(主页资料请求${users.length === 0 ? '没来' : '来了但对不上'})` };
    await writeWsAccount(wsId, seen.handle, me.restId);
    return { status: 'ok', account: { wsId, handle: seen.handle, restId: me.restId } };
  } finally {
    releasePage(lock.token);
  }
}
