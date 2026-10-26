/**
 * ⭐⭐⭐ 抽查:右键「查库」(2026-10-16)—— 主进程
 *
 * 用户 10-16:「在左边x的原图增加关联方法,增加一个右键菜单,由用户抽查好了。右键关联后,对应的右边应该弹出card
 * --从数据库搜索的结果。如果没有,代表着没有成功采集,如果多次抽查成功,说明是成功的」
 * 「这个就不应该分人还是推文,如果采人,就查找人,如果采推文,就查找推文」→ 按**这一页**是名单页还是推文页定
 * 「库里没有,就是漏采了」—— 不给「没查到」找借口
 * 卡片位置用户选 A:右栏运营面板(开着就显示,没开自动打开)。
 *
 * 流程:右键 → 页面脚本读那一点下面的推文 id / 人的 handle → 存成这个 ws 的「最新抽查请求」
 * → X 网页每秒问一次(X 无推送通道),拿到就打开运营面板并弹卡片 → 卡片按 id / handle 查库。
 */
import type { WebContents } from 'electron';
import { getXDB } from '@storage/surreal/client';
import { registerWebContextMenuExtension } from '@platform/main/web-context-menu/handler';
import { traceRecorder } from '@platform/main/web-capability/wiring/runtime';
import { normalizeHandle } from '@shared/types/x-timeline-types';
import { webviewPorts } from './x-collect-ports';
import { X_SCRIPTS } from './x-dom-scripts';
import { listXHostStates } from './x-host-registry';
import { readPerson } from './x-people-repo';
import type { PersonDetail } from './x-people-query';

export type SpotRequest = {
  readonly seq: number;
  readonly wsId: string;
  /** 这一页采的是推文还是人 —— 按页面定,不按点在哪 */
  readonly kind: 'tweet' | 'person';
  readonly tweetId?: string;
  readonly handle?: string;
  /** 页面上看到的字(给人对照用) */
  readonly text?: string;
  /** 没认出鼠标下面是谁 —— 说清楚,不猜 */
  readonly why?: string;
  readonly url: string;
  readonly at: string;
};

/** 名单页(关注者 / 我关注 / 蓝V关注者 …)查人,其余查推文 */
export function spotKindOfUrl(url: string): 'tweet' | 'person' {
  return /^https:\/\/(x|twitter)\.com\/[^/]+\/(followers|following|verified_followers|followers_you_follow|creator-subscriptions\/subscribers)(\/|\?|$)/.test(url)
    ? 'person' : 'tweet';
}

const latest = new Map<string, SpotRequest>();
let seq = 0;

function wsOfWc(wcId: number): string | null {
  for (const [ws, st] of listXHostStates()) if (st.wcId === wcId) return ws;
  return null;
}

async function spotAt(guest: WebContents, x: number, y: number): Promise<void> {
  const url = guest.getURL();
  const ws = wsOfWc(guest.id);
  if (ws === null) { console.warn(`[x.spot] 右键的网页 wc#${guest.id} 没登记到任何 ws`); return; }
  const kind = spotKindOfUrl(url);
  let raw: { tweetId?: string; handle?: string; text?: string; why?: string } = {};
  try {
    raw = (await webviewPorts(guest.id).runScript(X_SCRIPTS.spotTarget, { x, y, kind })) as typeof raw ?? {};
  } catch (e) {
    raw = { why: e instanceof Error ? e.message : String(e) };
  }
  seq += 1;
  const req: SpotRequest = {
    seq, wsId: ws, kind, url, at: new Date().toISOString(),
    tweetId: raw.tweetId, handle: raw.handle ? normalizeHandle(raw.handle) : undefined, text: raw.text,
    why: raw.tweetId || (kind === 'person' && raw.handle) ? undefined : (raw.why ?? '没认出鼠标下面是哪条'),
  };
  latest.set(ws, req);
  console.log(`[x.spot] ${ws} 抽查 ${kind === 'tweet' ? `推文 ${req.tweetId ?? '?'}` : `@${req.handle ?? '?'}`}${req.why ? `(${req.why})` : ''}`);
}

/** X 模块启动时调 —— 只在 x.com 上给「查库」 */
export function registerSpotCheckMenu(): () => void {
  return registerWebContextMenuExtension((guest, params) => {
    if (!/^https:\/\/(x|twitter)\.com\//.test(guest.getURL())) return [];
    return [{ label: '🔎 查库(核对是否采到)', click: () => { void spotAt(guest, params.x, params.y); } }];
  });
}

/** X 网页每秒问一次:有没有比 after 新的抽查请求 */
export function pollSpot(wsId: string, after: number): SpotRequest | null {
  const r = latest.get(wsId);
  return r && r.seq > after ? r : null;
}

export type SpotTweet = {
  readonly tweet_id: string; readonly text?: string; readonly author_handle?: string; readonly author_rest_id?: string;
  readonly created_at?: string; readonly fetched_at?: string; readonly source?: string; readonly search_recipe?: string;
};

export type SpotResult =
  | { readonly kind: 'tweet'; readonly found: false; readonly tweetId: string }
  | { readonly kind: 'tweet'; readonly found: true; readonly tweet: SpotTweet; readonly author: PersonDetail | null }
  | { readonly kind: 'person'; readonly found: false; readonly handle: string }
  | { readonly kind: 'person'; readonly found: true; readonly person: PersonDetail };

/** ⭐ 查库 —— 推文按 tweet_id;人按 handle(当前名)。account = 当前号数字 id(看关系用;没认出号给空串) */
export async function lookupSpot(account: string, req: { kind: 'tweet' | 'person'; tweetId?: string; handle?: string }): Promise<SpotResult> {
  const acct = account || '(未认号)';
  const db = getXDB();
  let result: SpotResult;
  if (req.kind === 'tweet') {
    const id = req.tweetId ?? '';
    const [rows] = await db.query<[SpotTweet[]]>(
      `SELECT tweet_id, text, author_handle, author_rest_id, source, search_recipe,
         (IF created_at != NONE THEN <string> created_at ELSE NONE END) AS created_at,
         (IF fetched_at != NONE THEN <string> fetched_at ELSE NONE END) AS fetched_at
       FROM x_tweet WHERE tweet_id = $id LIMIT 1`, { id },
    );
    const t = rows?.[0];
    result = t
      ? { kind: 'tweet', found: true, tweet: t, author: t.author_rest_id ? await readPerson(acct, t.author_rest_id) : null }
      : { kind: 'tweet', found: false, tweetId: id };
  } else {
    const h = normalizeHandle(req.handle ?? '');
    const [rows] = await db.query<[Array<{ rest_id: string }>]>('SELECT rest_id FROM x_author WHERE handle = $h LIMIT 1', { h });
    const p = rows?.[0] ? await readPerson(acct, rows[0].rest_id) : null;
    result = p ? { kind: 'person', found: true, person: p } : { kind: 'person', found: false, handle: h };
  }
  /** ⭐ 每次抽查留痕:命中 / 漏采 —— 事后数得出「抽了几次、漏了几次」 */
  traceRecorder.lifecycle({
    layer: 'web.net', event: result.found ? 'x-spot-hit' : 'x-spot-miss', pageId: 'x-data',
    detail: { kind: req.kind, tweetId: req.tweetId, handle: req.handle },
  });
  return result;
}
