/**
 * ⭐ 读「左边 X 网页正在看的这条帖子」—— 主进程(2026-10-22)
 *
 * 用户 10-22:「如果我在浏览中看到一个帖子不错,我可以选择它,然后再由AI草拟留言。我来确认。」
 * 用户 10-22 又说:「点击阅读,就代表着要回这个推文了。」—— 卡片跟着左边走:左边点开哪条(/status/<id>)就回哪条,
 * 库里找这条;库里没有 → 打开详情页补采进库再读。
 */
import { webContents } from 'electron';
import { getXDB } from '@storage/surreal/client';
import { webviewPorts } from './x-collect-ports';
import { X_NOISY_URLS, X_PAGE_NAME } from './x-pages';
import { auditTimelinePayload } from './x-timeline-audit';
import { saveTweetPage } from './x-save-page';
import { tweetIdOfUrl } from './x-tweet-url';

export type LeftTweet = {
  readonly id: string; readonly text: string; readonly createdAt?: string;
  readonly authorRestId?: string; readonly authorHandle?: string; readonly url: string;
};

export { tweetIdOfUrl };

async function readRow(id: string): Promise<LeftTweet | null> {
  const [rows] = await getXDB().query<[Array<{ text?: string; created_at?: string; author_rest_id?: string; author_handle?: string }>]>(
    `SELECT text, (IF created_at != NONE THEN <string> created_at ELSE NONE END) AS created_at, author_rest_id, author_handle FROM x_tweet WHERE tweet_id = $id`,
    { id },
  );
  const r = rows?.[0];
  if (!r?.text) return null;
  return { id, text: r.text, createdAt: r.created_at ?? undefined, authorRestId: r.author_rest_id, authorHandle: r.author_handle, url: `https://x.com/${r.author_handle ?? 'i'}/status/${id}` };
}

export async function readLeftTweet(wcId: number): Promise<{ ok: true; tweet: LeftTweet } | { ok: false; why: string }> {
  const wc = webContents.fromId(wcId);
  if (!wc || wc.isDestroyed()) return { ok: false, why: 'X 网页没开' };
  const id = tweetIdOfUrl(wc.getURL());
  if (!id) return { ok: false, why: '左边现在不是一条帖子的页面 —— 先在左边点开那条帖子(地址里有 /status/)' };
  const got = await readRow(id);
  if (got) return { ok: true, tweet: got };
  /** 库里没有:打开详情页补采(TweetDetail 带这条本身) */
  try {
    const rep = await webviewPorts(wcId).harvest({
      gotoPage: { name: X_PAGE_NAME.status, params: { tweetId: id } },
      pageUrlIncludes: ['/TweetDetail'], wantPages: 1, maxRounds: 3, maxMs: 15_000, noisyUrlSubstrings: X_NOISY_URLS,
    });
    const tweets = (rep?.items ?? []).filter((it) => it.url.includes('/TweetDetail'))
      .flatMap((it) => auditTimelinePayload(it.text).items.map((a) => a.record)).filter((t) => t.id !== '');
    if (tweets.length > 0) await saveTweetPage({ tweets, source: X_PAGE_NAME.status, wcId });
  } catch (e) {
    return { ok: false, why: `补采这条出错:${e instanceof Error ? e.message : String(e)}` };
  }
  const again = await readRow(id);
  return again ? { ok: true, tweet: again } : { ok: false, why: `打开了这条(${id}),但没读到正文 —— 可能被删 / 受保护` };
}
