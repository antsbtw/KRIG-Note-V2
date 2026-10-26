/**
 * ⭐⭐⭐ 存一页推文并回读(2026-10-16,逐页账)—— 主进程,搜索滚动截获 / 人卡 / 后台采集共用一份
 *
 * 用户:「A页是多少条,落库多少条,对不上问题在哪里,直接就可以敲定了」
 * 存推文 → 作者进人表(按采集网页认号写关系)→ 记账本(状态页对账靠它)→ 按 id 回读库里查得到哪些。
 * ⚠️ 回读不信存库返回的计数(`project-x-readback-lies` 那一族)。
 * ⭐ 第 5 步(2026-10-26):存 / 作者 / 记账走 x-save-batch 那一份 —— 原来这里直接写账本,账本记不上整页报失败(推文其实已进库)。
 */
import type { TweetRecord } from './x-timeline-audit';
import { existingTweetIds } from './x-tweet-repo';
import { saveTweetBatch } from './x-save-batch';

export async function saveTweetPage(p: {
  readonly tweets: readonly TweetRecord[];
  /** 来源页(x.search / x.profile / …) */
  readonly source: string;
  readonly searchRecipe?: string;
  /** 作者的配方来源(只有配方搜索才有) */
  readonly recipeName?: string;
  readonly wsId?: string;
  /** 采集用的 X 网页 —— 作者关系按它登录的号写 */
  readonly wcId?: number;
}): Promise<{ readonly inDb: readonly string[]; readonly inserted: number; readonly updated: number }> {
  const recs = p.tweets.filter((t) => t.id !== '');
  const sv = await saveTweetBatch(recs, { source: p.source, searchRecipe: p.searchRecipe, recipeName: p.recipeName, wsId: p.wsId, wcId: p.wcId });
  return { inDb: await existingTweetIds(recs.map((t) => t.id)), inserted: sv.inserted, updated: sv.updated };
}
