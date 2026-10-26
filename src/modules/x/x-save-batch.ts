/**
 * ⭐⭐ 采到的一批推文 / 人落库 —— 一份(Module5-04 第 3 步 3b,2026-10-24 从 x-data-ipc 原样搬出)
 *
 * 原来写在 IPC 的 saveTweets / saveUsers 两个 case 里,「核对落库」(savePageVerify)再绕回 IPC 调它们一次。
 * 现在三个能力(x.tweet.save / x.user.save / x.page.saveVerify)都调这里,不再绕路。
 * 每批:落库 → 本批统计 → 留痕 → 记账本(x_collect_log);推文还顺手把作者写进人表(按采集网页认号)。
 */
import { listAllRecipes } from '@platform/main/db/search-recipe-repo';
import { traceRecorder } from '@platform/main/web-capability/wiring/runtime';
import { recipeNameForQuery } from './x-recipe-query';
import { saveTweets } from './x-tweet-repo';
import { refreshPerson, saveTweetAuthors, saveUsers } from './x-user-repo';
import type { XUserRecord } from './x-user-audit';
import type { AccountDecision } from './x-account';
import { appendCollectLog, type CollectLogEntry } from './x-collect-log-repo';
import { accountForWrite } from './x-account-repo';
import { statsLine, summarizeBatch } from './x-batch-stats';

export type TweetBatch = Parameters<typeof saveTweets>[0];
/** wcId = 采集用的那个 X 网页 —— 作者的关系是它登录的号看到的(主进程据此认号);不给就不写关系 */
export type TweetCtx = Parameters<typeof saveTweets>[1] & {
  readonly wcId?: number;
  /** 作者的配方来源;不给就按 searchRecipe 对配方表 */
  readonly recipeName?: string;
};
export type UserBatch = Parameters<typeof saveUsers>[0];
export type UserCtx = Parameters<typeof saveUsers>[1] & { readonly wcId?: number };

/**
 * ⭐⭐ 落库后记账本(x_collect_log)—— 增长曲线 / 名单更新时间 / 对账全靠它。
 * ⚠️ 记账失败**不让落库报失败**(人已经进库了),但**留痕**:
 * 漏记的那批会在状态页「对账」里现形(账本合计 ≠ 表行数),届时能从这条留痕查到原因。
 */
export async function logCollect(e: CollectLogEntry): Promise<void> {
  try {
    await appendCollectLog(e);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.error(`[x.data] 账本没记上(${e.kind}/${e.source}):${why}`);
    traceRecorder.lifecycle({
      layer: 'web.net', event: 'x-collect-log-failed', pageId: 'x-data',
      detail: { kind: e.kind, source: e.source, inserted: e.inserted, why },
    });
  }
}

/**
 * ⭐⭐⭐ **采到的推文落库** —— 2026-10-05。
 * ⚠️ 返回 `inserted / updated / failed` 原样回去 ——
 * 合成一个「保存了 N 条」的话,「全是重复的」和「全是新的」
 * 长得一模一样,而那正是 `INSERT IGNORE` 当年藏住的东西。
 */
export async function saveTweetBatch(records: TweetBatch, ctx: TweetCtx): Promise<Awaited<ReturnType<typeof saveTweets>> & { stats: ReturnType<typeof summarizeBatch>; statsLine: string }> {
  const r = await saveTweets(records, ctx);
  const stats = summarizeBatch(records);
  console.log(`[x.data] 本批(${ctx?.source || '?'}):${statsLine(stats)}`);
  traceRecorder.lifecycle({
    layer: 'web.net',
    event: r.failed.length > 0 || r.inserted + r.updated === 0 ? 'x-save-incomplete' : 'x-save-ok',
    pageId: 'x-data',
    detail: {
      given: records.length, inserted: r.inserted, updated: r.updated, failed: r.failed.length,
      firstFailure: r.failed[0]?.why ?? '(none)', source: ctx?.source ?? '(empty)', stats,
    },
  });
  await logCollect({
    kind: 'tweets', source: ctx?.source || 'unknown', given: records.length,
    inserted: r.inserted, updated: r.updated, failed: r.failed.length, wsId: ctx?.wsId,
  });
  /** 顺手把推文作者写进人表(按采集网页认号);失败不让推文落库报失败,但响 + 留痕 */
  try {
    const recipeName = ctx?.recipeName ?? recipeNameForQuery(ctx?.searchRecipe, ctx?.searchRecipe ? await listAllRecipes() : []);
    const account = await accountForWrite(ctx?.wcId);
    const a = await saveTweetAuthors(records, recipeName, account);
    traceRecorder.lifecycle({
      layer: 'web.net',
      event: a.failed.length > 0 ? 'x-save-authors-incomplete' : 'x-save-authors-ok',
      pageId: 'x-data',
      detail: {
        inserted: a.inserted, updated: a.updated, skippedNoRestId: a.skippedNoRestId,
        failed: a.failed.length, firstFailure: a.failed[0]?.why ?? '(none)',
        recipe: recipeName ?? '(没对上配方)',
        relationAccount: a.relation.account ?? '(无)', relationWritten: a.relation.written, relationChanged: a.relation.changed,
        relationSkipped: a.relation.skippedReason ?? '(none)', relationFailed: a.relation.failed,
      },
    });
    await logCollect({
      kind: 'users', source: 'tweet-authors', given: a.inserted + a.updated + a.failed.length,
      inserted: a.inserted, updated: a.updated, failed: a.failed.length, wsId: ctx?.wsId,
    });
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.error(`[x.data] 推文作者没写进人表:${why}`);
    traceRecorder.lifecycle({ layer: 'web.net', event: 'x-save-authors-incomplete', pageId: 'x-data', detail: { why } });
  }
  return { ...r, stats, statsLine: statsLine(stats) };
}

/**
 * 采到的人落库(名单页)—— listSource 必填(调用方校验):它会进 list_memberships。
 * account:调用方已经认过号(查回关 / 名单采集)就直接给,不给按 ctx.wcId 认
 */
export async function saveUserBatch(records: UserBatch, ctx: UserCtx, account?: AccountDecision): Promise<Awaited<ReturnType<typeof saveUsers>>> {
  const r = await saveUsers(records, ctx, account ?? await accountForWrite(ctx.wcId));
  traceRecorder.lifecycle({
    layer: 'web.net',
    event: r.failed.length > 0 || r.inserted + r.updated === 0 ? 'x-save-users-incomplete' : 'x-save-users-ok',
    pageId: 'x-data',
    detail: {
      given: records.length, inserted: r.inserted, updated: r.updated,
      skippedNoHandle: r.skippedNoHandle, skippedNoRestId: r.skippedNoRestId,
      failed: r.failed.length, firstFailure: r.failed[0]?.why ?? '(none)', listSource: ctx.listSource,
      relationAccount: r.relation.account ?? '(无)', relationWritten: r.relation.written, relationChanged: r.relation.changed,
      relationSkipped: r.relation.skippedReason ?? '(none)', relationFailed: r.relation.failed,
    },
  });
  await logCollect({
    kind: 'users', source: ctx.listSource, given: records.length,
    inserted: r.inserted, updated: r.updated, failed: r.failed.length, wsId: ctx.wsId,
  });
  return r;
}

/**
 * ⭐ 用刚从他主页读到的资料更新人表 + 「我和他」的关系 —— 一份(第 5 步,2026-10-26)
 * 点人核对 / x.person.refresh / 关系采集都调这里;原来关系采集那份不留痕、新人不记账。
 */
export async function savePersonRefresh(rec: XUserRecord, account: AccountDecision): ReturnType<typeof refreshPerson> {
  const d = await refreshPerson(rec, account);
  traceRecorder.lifecycle({
    layer: 'web.net', event: 'x-person-refresh', pageId: 'x-data',
    detail: {
      restId: rec.restId, handle: rec.handle, isNew: d.isNew, changes: d.changes,
      relationAccount: d.relation.account ?? '(无)', relationSkipped: d.relation.skippedReason ?? '(none)',
    },
  });
  if (d.isNew) await logCollect({ kind: 'users', source: 'profile-refresh', given: 1, inserted: 1, updated: 0, failed: 0 });
  return d;
}
