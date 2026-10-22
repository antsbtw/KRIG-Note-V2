/**
 * ⭐⭐ 互动卡的「来龙去脉」—— 找到这条互动所在对话的原帖,排成一条线(2026-10-22)
 *
 * 用户 10-22:「这里应该列举更长一点的上下文,原帖是那个,第一轮互动是那些,第二轮互动是那些。这样才完整。
 *  x上也是不够完整,导致经常不清楚起因贴是那个,接续补上。」「最好办法是找到这个互动帖子的原帖。」
 *
 * 从目标推文沿 in_reply_to 一路往上找到原帖(没有上一层的那条);库里缺哪一层,就打开目标推文的详情页
 * (TweetDetail 载荷带着上文一路到原帖)补采进库再找。再列出同一对话里你和他在目标之后的来回。
 */
import { getXDB } from '@storage/surreal/client';
import { webviewPorts } from './x-collect-ports';
import { X_NOISY_URLS, X_PAGE_NAME } from './x-pages';
import { auditTimelinePayload } from './x-timeline-audit';
import { saveTweetPage } from './x-save-page';

import { MAX_HOPS, buildThread, type EngageThread, type ThreadRow } from './x-engage-thread-model';
export { buildThread, threadForPrompt, type EngageThread, type ThreadItem, type ThreadRow } from './x-engage-thread-model';

const SELECT = `SELECT tweet_id, author_rest_id, author_handle, text, (IF created_at != NONE THEN <string> created_at ELSE NONE END) AS created_at,
  in_reply_to, conversation_id FROM x_tweet`;

async function readRows(ids: readonly string[], conv?: string): Promise<ThreadRow[]> {
  const [rows] = await getXDB().query<[ThreadRow[]]>(
    `${SELECT} WHERE tweet_id IN $ids OR (conversation_id != NONE AND conversation_id = $conv)`,
    { ids: [...ids], conv: conv ?? '' },
  );
  return rows ?? [];
}

/** 从库里沿回复关系往上读(每层一次查询,最多 MAX_HOPS 层) */
async function readChain(targetId: string): Promise<ThreadRow[]> {
  const got = new Map<string, ThreadRow>();
  let next: string | undefined = targetId;
  for (let i = 0; i <= MAX_HOPS && next && !got.has(next); i += 1) {
    const res: [ThreadRow[]] = await getXDB().query<[ThreadRow[]]>(`${SELECT} WHERE tweet_id = $id`, { id: next });
    const r: ThreadRow | undefined = res[0]?.[0];
    if (!r) break;
    got.set(r.tweet_id, r);
    next = r.in_reply_to || undefined;
  }
  const conv = got.get(targetId)?.conversation_id;
  const all = await readRows([...got.keys()], conv);
  for (const r of all) got.set(r.tweet_id, r);
  return [...got.values()];
}

/**
 * ⭐ 主进程:读来龙去脉;库里往上找断了 → 打开目标推文的详情页补采(TweetDetail 带上文到原帖)→ 再读。
 * 调用方负责「X 网页忙」的让路与登记(互动卡准备时已占着网页)。
 */
export async function loadEngageThread(wcId: number, me: string, him: string, targetId: string): Promise<EngageThread & { readonly fetched: boolean; readonly fetchNote?: string }> {
  let rows = await readChain(targetId);
  let thread = buildThread(targetId, rows, me, him);
  if (!thread.gapAbove && thread.chain.length > 0) return { ...thread, fetched: false };
  let fetchNote: string | undefined;
  try {
    const rep = await webviewPorts(wcId).harvest({
      gotoPage: { name: X_PAGE_NAME.status, params: { tweetId: targetId } },
      pageUrlIncludes: ['/TweetDetail'], wantPages: 1, maxRounds: 3, maxMs: 15_000, noisyUrlSubstrings: X_NOISY_URLS,
    });
    const items = (rep?.items ?? []).filter((it) => it.url.includes('/TweetDetail'));
    const tweets = items.flatMap((it) => auditTimelinePayload(it.text).items.map((a) => a.record)).filter((t) => t.id !== '');
    if (tweets.length > 0) await saveTweetPage({ tweets, source: X_PAGE_NAME.status, wcId });
    else fetchNote = '打开详情页没拿到对话载荷';
  } catch (e) {
    fetchNote = `补采上文出错:${e instanceof Error ? e.message : String(e)}`;
  }
  rows = await readChain(targetId);
  thread = buildThread(targetId, rows, me, him);
  if (thread.gapAbove && !fetchNote) fetchNote = '详情页里也没给到原帖(可能被删 / 受保护 / 层数太深)';
  return { ...thread, fetched: true, fetchNote };
}
