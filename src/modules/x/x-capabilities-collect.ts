/**
 * ⭐⭐ X 采集流水线的能力(Module5-04 第 3 步第 3b 批,2026-10-24)—— 和界面流程绑在一起的那 10 个
 *
 * 这批的特点:界面先占住网页(人卡采主页 / 操作台采集),再请主进程干活 —— 执行器认「带锁进来」(reuse):
 * 只核对 token 真是现在的持有者,不再申请,跑完不替它放;不带 token 的(任务页「找蓝V」)执行器自己占、自己放。
 * 存推文 / 存人 / 核对落库共用 x-save-batch.ts 一份(原来「核对落库」绕回 IPC 再调一次)。
 * ⚠️ 搜索不查搜索额度(原样):这是人点的基础操作,「我的任务我自己控制」(用户 10-21);自动的(找求助帖 / 采互动)在各自能力里查。
 */
import { capFailed } from '@platform/main/capability/capability';
import { listAllRecipes } from '@platform/main/db/search-recipe-repo';
import { traceRecorder } from '@platform/main/web-capability/wiring/runtime';
import { Bad, digits, int, str, xCap, type O } from './x-capabilities-common';
import { collectSearchByScroll, SEARCH_SCROLL_BUSY } from './x-search-scroll';
import { recipeNameForQuery } from './x-recipe-query';
import { cancelPersonCollect, collectPersonTab } from './x-person-collect';
import { refreshPerson } from './x-user-repo';
import { accountForWrite, readWsAccount } from './x-account-repo';
import { logCollect, saveTweetBatch, saveUserBatch, type TweetBatch, type TweetCtx, type UserBatch, type UserCtx } from './x-save-batch';
import { existingTweetIds } from './x-tweet-repo';
import { existingUserIds } from './x-user-repo';
import { lookupSpot, pollSpot } from './x-spot-check';
import { scanMutualIntent } from './x-people-repo';
import { getXHostState } from './x-host-registry';
import type { XUserRecord } from './x-user-audit';

const input = <I extends O>(def: Parameters<typeof xCap<I>>[1]): void => xCap('input', def);
const control = <I extends O>(def: Parameters<typeof xCap<I>>[1]): void => xCap('control', def);
const optStr = (o: O, k: string): string | undefined => (typeof o[k] === 'string' && o[k] !== '' ? (o[k] as string) : undefined);
const arr = (o: O, k: string, nonEmpty: boolean): unknown[] => {
  if (!Array.isArray(o[k]) || (nonEmpty && (o[k] as unknown[]).length === 0)) throw new Bad(nonEmpty ? `${k} 要非空数组` : `${k} 要数组`);
  return o[k] as unknown[];
};
const objOf = (o: O, k: string): O => { if (!o[k] || typeof o[k] !== 'object') throw new Bad(`要 ${k}`); return o[k] as O; };

export function registerXCollectCapabilities(): void {
  input({
    id: 'x.search.scroll', describe: '搜索截获:左边 X 网页打开搜索页自己翻页,逐页对账、存库、回读(配方名自动对上)',
    inputDoc: {
      wsId: '哪个 workspace 的 X 网页(与 wcId 二选一)', wcId: '直接给 X 网页的 webContents id', q: '搜索串',
      f: 'latest(默认)/ top', wantPages: '最多几页,1–40(防限流)', maxMs: '最多跑多久,10s–15min,默认 10min',
      recipeName: '可选:配方名(不给就按搜索串对)', ownToken: '可选:界面已占住网页时带上它的锁',
    },
    parse: (o) => {
      const wcId = o.wcId === undefined ? getXHostState(str(o, 'wsId'))?.wcId ?? -1 : int(o, 'wcId', 0, Number.MAX_SAFE_INTEGER);
      if (o.f !== undefined && o.f !== 'latest' && o.f !== 'top') throw new Bad('f 只认 latest / top');
      return {
        wcId, q: str(o, 'q'), f: (o.f as 'latest' | 'top' | undefined) ?? 'latest',
        wantPages: int(o, 'wantPages', 1, 40), maxMs: int(o, 'maxMs', 10_000, 15 * 60_000, 10 * 60_000),
        recipeName: optStr(o, 'recipeName'), ownToken: optStr(o, 'ownToken'),
      };
    },
    page: (i) => `${SEARCH_SCROLL_BUSY}「${i.q.slice(0, 20)}」`, pageWc: (i) => i.wcId, reuse: (i) => i.ownToken,
    run: async (i, _a, page) => {
      const recipeName = i.recipeName ?? recipeNameForQuery(i.q, await listAllRecipes());
      const r = await collectSearchByScroll({ wcId: page.wcId, q: i.q, f: i.f, wantPages: i.wantPages, maxMs: i.maxMs, recipeName, ownToken: page.token });
      traceRecorder.lifecycle({
        layer: 'web.net', event: r.ok ? 'x-search-scroll-ok' : 'x-search-scroll-failed', pageId: 'x-data',
        detail: { q: i.q, why: r.why, totals: r.totals, rateLimited: r.rateLimited, report: r.reportFile },
      });
      if (!r.ok) throw capFailed(r.why ?? '搜索截获没成');
      return r;
    },
    summarize: (out) => {
      const r = out as { totals?: unknown; rateLimited?: boolean; reportFile?: string };
      return { totals: r.totals, rateLimited: r.rateLimited, reportFile: r.reportFile };
    },
  });

  input({
    id: 'x.person.collectTab', describe: '采一个人主页的一个标签页(帖子 / 回复 / 转发):游标翻页,一页一存、逐页账',
    inputDoc: {
      wcId: 'X 网页的 webContents id', page: 'x.profile / x.withReplies / x.reposts', handle: '他的 handle', restId: '他的数字 id',
      start: '可选:范围起点 ISO(不给 = 全部)', pageCap: '最多几页', attempt: '第几次尝试(留痕用)', resumeCursor: '可选:从这个游标续',
      ownToken: '可选:界面已占住网页时带上它的锁',
    },
    parse: (o) => ({
      wcId: int(o, 'wcId', 0, Number.MAX_SAFE_INTEGER), page: str(o, 'page'), handle: str(o, 'handle'), restId: str(o, 'restId'),
      start: optStr(o, 'start'), pageCap: int(o, 'pageCap', 1, 1000), attempt: int(o, 'attempt', 1, 100, 1),
      resumeCursor: optStr(o, 'resumeCursor'), ownToken: optStr(o, 'ownToken'),
    }),
    page: (i) => `采 @${i.handle} ${i.page}`, pageWc: (i) => i.wcId, reuse: (i) => i.ownToken,
    subject: (i) => `x_author:${i.restId}`,
    run: (i) => collectPersonTab({ wcId: i.wcId, page: i.page, handle: i.handle, restId: i.restId, start: i.start, pageCap: i.pageCap, attempt: i.attempt, resumeCursor: i.resumeCursor }),
    summarize: (out) => {
      const r = out as { reached?: boolean; records?: unknown[]; pageInserted?: number; ledgerProblem?: string };
      return { reached: r.reached, records: r.records?.length, pageInserted: r.pageInserted, ledgerProblem: r.ledgerProblem };
    },
  });

  control({
    id: 'x.person.cancelCollect', describe: '停掉某个 X 网页上正在采的那个人(翻页每轮开头 / 歇着时会看这个标记)',
    inputDoc: { wcId: 'X 网页的 webContents id' },
    parse: (o) => ({ wcId: int(o, 'wcId', 0, Number.MAX_SAFE_INTEGER) }),
    run: (i) => {
      const hit = cancelPersonCollect(i.wcId);
      console.log(`[x.people] 停止采集 wc#${i.wcId}:${hit ? '已通知主进程' : '主进程这边没有在跑的(renderer 自己会停)'}`);
      return { cancelled: hit };
    },
  });

  control({
    id: 'x.person.refresh', describe: '用刚从他主页读到的资料更新人表 + 「我和他」的关系(按采集网页认号)',
    inputDoc: { record: '用户记录(要有数字 id + handle)', wcId: '读到它的 X 网页(认号用;不给就不写关系)' },
    parse: (o) => {
      const rec = o.record as XUserRecord | undefined;
      if (!rec || typeof rec.restId !== 'string' || rec.restId === '' || typeof rec.handle !== 'string') throw new Bad('要一条带数字 id 的用户记录');
      return { record: rec, wcId: o.wcId === undefined ? undefined : int(o, 'wcId', 0, Number.MAX_SAFE_INTEGER) };
    },
    subject: (i) => `x_author:${i.record.restId}`,
    run: async (i) => {
      const rec = i.record;
      const d = await refreshPerson(rec, await accountForWrite(i.wcId));
      traceRecorder.lifecycle({
        layer: 'web.net', event: 'x-person-refresh', pageId: 'x-data',
        detail: {
          restId: rec.restId, handle: rec.handle, isNew: d.isNew, changes: d.changes,
          relationAccount: d.relation.account ?? '(无)', relationSkipped: d.relation.skippedReason ?? '(none)',
        },
      });
      if (d.isNew) await logCollect({ kind: 'users', source: 'profile-refresh', given: 1, inserted: 1, updated: 0, failed: 0 });
      return d;
    },
  });

  control({
    id: 'x.tweet.save', describe: '采到的一批推文落库(并把作者写进人表);返回新增 / 更新 / 失败原样',
    inputDoc: { records: '推文记录数组(非空)', ctx: '{ source, searchRecipe?, wsId?, wcId? }' },
    parse: (o) => ({ records: arr(o, 'records', true) as TweetBatch, ctx: objOf(o, 'ctx') as unknown as TweetCtx }),
    run: (i) => saveTweetBatch(i.records, i.ctx),
    summarize: (out) => {
      const r = out as { inserted: number; updated: number; failed: unknown[] };
      return { inserted: r.inserted, updated: r.updated, failed: r.failed.length };
    },
  });

  control({
    id: 'x.user.save', describe: '采到的一批人(名单页)落库;listSource 必填(会进 list_memberships)',
    inputDoc: { records: '用户记录数组(非空)', ctx: '{ listSource, wsId?, wcId? }' },
    parse: (o) => {
      const ctx = objOf(o, 'ctx');
      if (typeof ctx.listSource !== 'string' || ctx.listSource.trim() === '') throw new Bad('ctx.listSource 必填(它会进 list_memberships,空值会永久留在每个人档案里)');
      return { records: arr(o, 'records', true) as UserBatch, ctx: ctx as unknown as UserCtx };
    },
    run: (i) => saveUserBatch(i.records, i.ctx),
    summarize: (out) => {
      const r = out as { inserted: number; updated: number; failed: unknown[] };
      return { inserted: r.inserted, updated: r.updated, failed: r.failed.length };
    },
  });

  control({
    id: 'x.page.saveVerify', describe: '一页采到的推文 + 人落库,再回读哪些真进库了(对账用)',
    inputDoc: { tweets: '推文数组', tweetCtx: '{ source, … }', users: '用户数组', userCtx: '有人时必填:{ listSource, … }' },
    parse: (o) => {
      const tweets = (Array.isArray(o.tweets) ? o.tweets : []) as TweetBatch;
      const users = (Array.isArray(o.users) ? o.users : []) as UserBatch;
      if (users.length > 0) {
        const uc = o.userCtx as { listSource?: unknown } | undefined;
        if (!uc || typeof uc.listSource !== 'string' || uc.listSource.trim() === '') throw new Bad('有人但没给 userCtx.listSource');
      }
      return { tweets, users, tweetCtx: (o.tweetCtx ?? { source: 'unknown' }) as TweetCtx, userCtx: o.userCtx as UserCtx | undefined };
    },
    run: async (i) => {
      const counts = { tweetsInserted: 0, usersInserted: 0, usersUpdated: 0 };
      if (i.tweets.length > 0) counts.tweetsInserted = (await saveTweetBatch(i.tweets, i.tweetCtx)).inserted;
      if (i.users.length > 0 && i.userCtx) {
        const r = await saveUserBatch(i.users, i.userCtx);
        counts.usersInserted = r.inserted;
        counts.usersUpdated = r.updated;
      }
      const inDb = [
        ...await existingTweetIds(i.tweets.map((t) => t.id).filter((x) => x !== '')),
        ...await existingUserIds(i.users.map((u) => u.restId).filter((x): x is string => typeof x === 'string' && x !== '')),
      ];
      return { inDb, ...counts };
    },
    summarize: (out) => {
      const r = out as { inDb: unknown[]; tweetsInserted: number; usersInserted: number; usersUpdated: number };
      return { inDb: r.inDb.length, tweetsInserted: r.tweetsInserted, usersInserted: r.usersInserted, usersUpdated: r.usersUpdated };
    },
  });

  input({
    id: 'x.spot.poll', describe: '右键「查库」抽查:这个 workspace 有没有新的抽查请求(界面每秒问一次)', probe: true,
    inputDoc: { wsId: '哪个 workspace', after: '上次看到的序号' },
    parse: (o) => ({ wsId: str(o, 'wsId'), after: int(o, 'after', 0, Number.MAX_SAFE_INTEGER) }),
    run: (i) => pollSpot(i.wsId, i.after),
  });

  input({
    id: 'x.spot.lookup', describe: '抽查:库里有没有这条推文 / 这个人、存得对不对',
    inputDoc: { wsId: '哪个 workspace 的号', kind: 'tweet / person', tweetId: '查推文时给', handle: '查人时给' },
    parse: (o) => {
      if (o.kind !== 'tweet' && o.kind !== 'person') throw new Bad('kind 只认 tweet / person');
      const tweetId = o.kind === 'tweet' ? digits(o, 'tweetId') : undefined;
      const handle = o.kind === 'person' ? str(o, 'handle') : undefined;
      return { wsId: str(o, 'wsId'), kind: o.kind as 'tweet' | 'person', tweetId, handle };
    },
    /** ⚠️ 没认出号也查(原样):查不到「我和他」的关系时 lookupSpot 自己写明「未认号」 */
    run: async (i) => lookupSpot((await readWsAccount(i.wsId))?.restId ?? '', { kind: i.kind, tweetId: i.tweetId, handle: i.handle }),
  });

  control({
    id: 'x.intent.scan', describe: '扫一遍互关倾向(算法:Bio / 名字 / 推文里有互关字样的标上;人标过的不动)',
    inputDoc: {}, parse: () => ({}),
    run: async () => {
      const r = await scanMutualIntent();
      traceRecorder.lifecycle({ layer: 'web.net', event: 'x-intent-scan', pageId: 'x-data', detail: { ...r } });
      return r;
    },
  });
}
