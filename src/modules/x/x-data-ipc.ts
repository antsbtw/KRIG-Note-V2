/**
 * ⭐⭐ X 的**数据** IPC(配方 CRUD + 推文落库 + 用户落库)—— **X 自带,与 X 同生共死**
 *
 * ⚠️ `search-recipe-repo` 本来就在(表、CRUD 都齐),
 * 缺的只是「renderer 怎么调到它」这一环。
 *
 * ⚠️⚠️ 本文件**只做接线**:参数校验 + 调 repo + 三态返回。
 * 业务判据(配方怎么翻译成查询)在 `x-recipe-query.ts`,不在这儿。
 */

import { ipcMain, webContents } from 'electron';
import {
  listAllRecipes, upsertRecipe, deleteRecipe,
} from '@platform/main/db/search-recipe-repo';
import { recipeNameForQuery } from './x-recipe-query';
import { traceRecorder } from '@platform/main/web-capability/wiring/runtime';
import { saveTweets } from './x-tweet-repo';
import { saveUsers, saveTweetAuthors, refreshPerson } from './x-user-repo';
import { readCursor, saveCursor, clearCursor } from './x-cursor-repo';
import { appendCollectLog, readOpsStatus, type CollectLogEntry } from './x-collect-log-repo';
import { queryPeople, readFriendCircle, readPeopleOverview, readPerson, readPersonTweets, readTagCatalog, setExcluded, setTags } from './x-people-repo';
import { appendAction, readSettings, readUnfollowGate, writeSetting } from './x-ops-actions-repo';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import type { XDataInvoke, XDataResult } from './x-data-types';
import { clearXHostState, getXHostState, setXHostBusy, setXHostState } from './x-host-registry';
import { bgRunnerStatus, bgRunningOn, kickBgRunner } from './x-bg-runner';
import { accountForWrite, identifyAccount, readWsAccount } from './x-account-repo';
import { createJob, deleteJob, listJobs, readJob, setJobStatus } from './x-bg-job-repo';
import { isBgRange } from './x-bg-job';
import type { TimelineRange } from './x-person-timeline';
import { cancelPersonCollect, collectPersonTab, personCollectProgress, tracePersonProgress } from './x-person-collect';

const failed = (reason: string): XDataResult => ({ status: 'failed', reason });

/**
 * ⭐⭐ 读关系要知道看哪个号(1.2.27)—— 这个 ws 记的登录号的数字 id。
 * ⚠️ 没认出来就**明说**,不退回「全库那份」(那正是互相覆盖的老问题)。
 */
async function accountOfWs(wsId: unknown): Promise<{ restId: string } | { reason: string }> {
  if (typeof wsId !== 'string' || wsId === '') return { reason: '[x.data] 缺 wsId —— 关系按号存,不知道看哪个号' };
  const a = await readWsAccount(wsId);
  if (!a) return { reason: `${wsId} 还没认出登录的是哪个号 —— 打开 X 网页,在运营面板点「认号」` };
  if (!a.restId) return { reason: `${wsId} 登录的是 @${a.handle},但数字 id 还没拿到 —— 在运营面板点「认号」` };
  return { restId: a.restId };
}

/**
 * ⭐⭐ 落库后记账本(x_collect_log)—— 增长曲线 / 名单更新时间 / 对账全靠它。
 * ⚠️ 记账失败**不让落库报失败**(人已经进库了),但**留痕**:
 * 漏记的那批会在状态页「对账」里现形(账本合计 ≠ 表行数),届时能从这条留痕查到原因。
 */
async function logCollect(e: CollectLogEntry): Promise<void> {
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

/** ⚠️ 幂等 —— 多窗口/热重载下可能被调多次 */
let wired = false;

export function registerXDataIpc(): void {
  if (wired) return;
  wired = true;

  ipcMain.handle(IPC_CHANNELS.X_DATA_INVOKE, async (_e, p: XDataInvoke): Promise<XDataResult> => {
    try {
      switch (p?.op) {
        case 'list':
          return { status: 'ok', value: await listAllRecipes() };

        case 'upsert': {
          const r = p.recipe;
          /**
           * ⚠️ fail loud:名字空的配方在列表里是一行空白,
           * 人既认不出也删不掉(`feedback-fail-loud-no-fallback`:
           * 别兜底成「未命名」—— 那会把「填错了」变成「看起来正常」)。
           */
          if (!r || typeof r.name !== 'string' || r.name.trim() === '') {
            return failed('[x.recipe] 配方必须有名字');
          }
          return { status: 'ok', value: await upsertRecipe(r) };
        }

        /**
         * ⭐⭐⭐ **采到的推文落库** —— 2026-10-05。
         * ⚠️ 返回 `inserted / updated / failed` 原样回去 ——
         * 合成一个「保存了 N 条」的话,「全是重复的」和「全是新的」
         * 长得一模一样,而那正是 `INSERT IGNORE` 当年藏住的东西。
         */
        case 'saveTweets': {
          if (!Array.isArray(p.records) || p.records.length === 0) {
            return failed('[x.data] saveTweets 没给记录');
          }
          /**
           * ⚠️⚠️ `source` 空**不拒收** —— 2026-10-05 想清楚的:
           * 「认不出这是哪一页」与「这批数据不要了」是**两件事**,
           * 为一个元数据丢掉真数据不值当。
           * ⭐ 由 repo 记成 `unknown`(事实:确实不知道),而不是让面板
           * 编一个页名出来(那次编造被守卫当场逮到)。
           */
          const r = await saveTweets(p.records, p.ctx);
          /**
           * ⭐⭐⭐ **落库结果落盘** —— 2026-10-05 第三跑逼出来的。
           *
           * ⚠️⚠️ 三跑都是「面板报入库 N 条、库里 0 行」,而我**读不出为什么**:
           * `console.log` 只在启动 app 的终端里,留痕文件里一个字都没有 ——
           * 于是每一跑都只能去真库里猜,**猜错了三次**。
           * ⭐ 写进留痕,下一跑我自己读得到,不用再问人。
           */
          traceRecorder.lifecycle({
            layer: 'web.net',
            event: r.failed.length > 0 || r.inserted + r.updated === 0
              ? 'x-save-incomplete' : 'x-save-ok',
            pageId: 'x-data',
            detail: {
              given: p.records.length,
              inserted: r.inserted,
              updated: r.updated,
              failed: r.failed.length,
              /** ⚠️ 只记第一条原因 —— 整批同因时 N 条一模一样 */
              firstFailure: r.failed[0]?.why ?? '(none)',
              source: p.ctx?.source ?? '(empty)',
            },
          });
          await logCollect({
            kind: 'tweets', source: p.ctx?.source || 'unknown', given: p.records.length,
            inserted: r.inserted, updated: r.updated, failed: r.failed.length, wsId: p.ctx?.wsId,
          });

          /**
           * ⭐⭐ 作者顺带进人表(2026-10-08)—— 「互不关注 = 配方找到的人」的来源。
           * ⚠️ 推文已经存好了;这一步失败**不让存推文报失败**,但留痕 + 记账(对账会现形)。
           * 配方名:推文上记的是查询串,在这里对回配方名;对不上就不记(不猜)。
           */
          try {
            const recipes = p.ctx?.searchRecipe ? await listAllRecipes() : [];
            const recipeName = recipeNameForQuery(p.ctx?.searchRecipe, recipes);
            const account = await accountForWrite(p.ctx?.wcId);
            const a = await saveTweetAuthors(p.records, recipeName, account);
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
              inserted: a.inserted, updated: a.updated, failed: a.failed.length, wsId: p.ctx?.wsId,
            });
          } catch (e) {
            const why = e instanceof Error ? e.message : String(e);
            console.error(`[x.data] 推文作者没写进人表:${why}`);
            traceRecorder.lifecycle({
              layer: 'web.net', event: 'x-save-authors-incomplete', pageId: 'x-data',
              detail: { why },
            });
          }
          return { status: 'ok', value: r };
        }

        /**
         * ⭐⭐⭐ **采到的 X 用户落库** —— 2026-10-05。
         * ⚠️ 返回 `inserted / updated / skippedNoHandle / failed` **原样回去**:
         * 「全是老人」和「全是新人」合成一个数就分不出来,
         * 而增量采集(以后要做的)全靠这个分别。
         */
        case 'saveUsers': {
          if (!Array.isArray(p.records) || p.records.length === 0) {
            return failed('[x.data] saveUsers 没给记录');
          }
          /**
           * ⚠️⚠️ `listSource` **要拒收空** —— 与 `source` 的处理**故意不同**。
           * `source` 只是「这批从哪来」的元数据,空了记 `unknown` 就行;
           * 而 `listSource` 会进 `list_memberships`(累加不覆盖),
           * 空值会在每个人的名单里**永久留下一个空字符串**,
           * 之后「他在不在我的关注者里」这个问题就带着一条读不懂的记录。
           * ⭐ 这是写进**人的档案**里的,不是这一跑的标签。
           */
          if (typeof p.ctx?.listSource !== 'string' || p.ctx.listSource.trim() === '') {
            return failed('[x.data] saveUsers 必须给 listSource（它会进 list_memberships，空值会永久留在每个人档案里）');
          }
          const r = await saveUsers(p.records, p.ctx, await accountForWrite(p.ctx.wcId));
          /**
           * ⭐⭐⭐ **落库结果落盘** —— 同 `saveTweets` 那条教训:
           * `console.log` 只在启动 app 的终端里,留痕文件里一个字都没有,
           * 于是「面板报入库 N 条、库里 0 行」只能去真库里猜(我猜错过三次)。
           */
          traceRecorder.lifecycle({
            layer: 'web.net',
            event: r.failed.length > 0 || r.inserted + r.updated === 0
              ? 'x-save-users-incomplete' : 'x-save-users-ok',
            pageId: 'x-data',
            detail: {
              given: p.records.length,
              inserted: r.inserted,
              updated: r.updated,
              /** ⭐ 无 handle 被挡下的单独记 —— 它不是写库失败,混一起会指错层 */
              skippedNoHandle: r.skippedNoHandle,
              /** ⭐ 身份是数字 id —— 没有 id 的不建人,单独记 */
              skippedNoRestId: r.skippedNoRestId,
              failed: r.failed.length,
              firstFailure: r.failed[0]?.why ?? '(none)',
              listSource: p.ctx.listSource,
              /** ⭐ 关系按号写(1.2.27)—— 没写的原因必须看得见 */
              relationAccount: r.relation.account ?? '(无)', relationWritten: r.relation.written, relationChanged: r.relation.changed,
              relationSkipped: r.relation.skippedReason ?? '(none)', relationFailed: r.relation.failed,
            },
          });
          await logCollect({
            kind: 'users', source: p.ctx.listSource, given: p.records.length,
            inserted: r.inserted, updated: r.updated, failed: r.failed.length, wsId: p.ctx.wsId,
          });
          return { status: 'ok', value: r };
        }

        /**
         * ⭐⭐⭐ **断点续采** —— 2026-10-07。
         * ⚠️ scope 为空要拒收:那会让所有名单共用一个断点,
         * A 名单的游标被 B 续采,而那种错在数据里看不出来。
         */
        case 'readCursor': {
          if (typeof p.scope !== 'string' || p.scope.trim() === '') {
            return failed('[x.data] readCursor 缺 scope');
          }
          /** ⭐ 读不到回 null —— 调用方据此从头采,这是正确行为不是降级 */
          return { status: 'ok', value: await readCursor(p.scope) };
        }

        case 'saveCursor': {
          if (typeof p.cursor?.scope !== 'string' || p.cursor.scope.trim() === '') {
            return failed('[x.data] saveCursor 缺 scope');
          }
          await saveCursor(p.cursor);
          return { status: 'ok', value: { saved: p.cursor.scope } };
        }

        case 'clearCursor': {
          if (typeof p.scope !== 'string' || p.scope.trim() === '') {
            return failed('[x.data] clearCursor 缺 scope');
          }
          await clearCursor(p.scope);
          return { status: 'ok', value: { cleared: p.scope } };
        }

        case 'delete':
          if (!p.recipeId) return failed('[x.recipe] delete 缺 recipeId');
          await deleteRecipe(p.recipeId);
          return { status: 'ok', value: { deleted: p.recipeId } };

        /** ⭐⭐ 运营 → 状态(2026-10-07)—— 只读 */
        case 'opsStatus': {
          const acc = await accountOfWs(p.wsId);
          if ('reason' in acc) return failed(acc.reason);
          return { status: 'ok', value: await readOpsStatus(acc.restId) };
        }

        /** ⭐⭐ 认号(1.2.27)—— 结果三态原样回去,pending/failed 的原因给人看 */
        case 'identifyAccount': {
          if (typeof p.wsId !== 'string' || p.wsId === '') return failed('[x.data] identifyAccount 缺 wsId');
          const r = await identifyAccount(p.wsId);
          traceRecorder.lifecycle({
            layer: 'web.net', event: `x-account-identify-${r.status}`, pageId: 'x-data',
            detail: { wsId: p.wsId, ...(r.status === 'ok' ? { handle: r.account.handle, restId: r.account.restId } : { reason: r.reason }) },
          });
          return { status: 'ok', value: r };
        }

        case 'wsAccount':
          if (typeof p.wsId !== 'string' || p.wsId === '') return failed('[x.data] wsAccount 缺 wsId');
          return { status: 'ok', value: await readWsAccount(p.wsId) };

        /** ⭐ 运营 → 人(2026-10-08)—— 只读 */
        case 'peopleOverview': {
          const acc = await accountOfWs(p.wsId);
          if ('reason' in acc) return failed(acc.reason);
          return { status: 'ok', value: await readPeopleOverview(acc.restId) };
        }

        case 'queryPeople': {
          /** ⚠️ limit 要有上界:几千行连头像一起过 IPC 再全渲染,面板会卡 */
          if (!Number.isInteger(p.limit) || p.limit <= 0 || p.limit > 500) {
            return failed('[x.data] queryPeople 的 limit 要在 1–500 之间');
          }
          if (!Number.isInteger(p.start) || p.start < 0) {
            return failed('[x.data] queryPeople 的 start 要是非负整数');
          }
          const acc = await accountOfWs(p.wsId);
          if ('reason' in acc) return failed(acc.reason);
          return { status: 'ok', value: await queryPeople(acc.restId, p.filter, p.limit, p.start) };
        }

        case 'personDetail': {
          if (typeof p.restId !== 'string' || p.restId === '') {
            return failed('[x.data] personDetail 缺 restId —— 人的身份是数字 id');
          }
          const acc = await accountOfWs(p.wsId);
          if ('reason' in acc) return failed(acc.reason);
          return { status: 'ok', value: await readPerson(acc.restId, p.restId) };
        }

        case 'setExcluded':
          if (typeof p.restId !== 'string' || p.restId === '' || typeof p.excluded !== 'boolean') {
            return failed('[x.data] setExcluded 要 restId(数字 id)和 excluded(true/false)');
          }
          await setExcluded(p.restId, p.excluded);
          /** ⭐ 人的决定也留痕 —— 以后回头看「我排除过谁、何时」不用猜 */
          console.log(`[x.people] ${p.excluded ? '排除' : '取消排除'} ${p.restId}`);
          return { status: 'ok', value: { restId: p.restId, excluded: p.excluded } };

        case 'setTags': {
          if (typeof p.restId !== 'string' || p.restId === '' || !Array.isArray(p.tags)
            || p.tags.some((t) => typeof t !== 'string')) {
            return failed('[x.data] setTags 要 restId(数字 id)和 tags(字符串数组)');
          }
          const tags = await setTags(p.restId, p.tags);
          console.log(`[x.people] 标签 ${p.restId} → ${tags.length > 0 ? tags.join('、') : '(清空)'}`);
          return { status: 'ok', value: tags };
        }

        case 'tagCatalog':
          return { status: 'ok', value: await readTagCatalog() };

        /**
         * ⭐⭐⭐ renderer 的 X 网页登记同步进主进程(`x-host-sync.ts`)—— 后台 runner 靠它。
         * ⚠️ webview 销毁时主进程自己清掉:窗口直接关掉时 renderer 来不及发「卸了」,
         * 不清的话 runner 拿已销毁的 wcId 去采 → 没去到页 → 任务被标 failed。
         */
        case 'syncHost': {
          if (typeof p.wsId !== 'string' || p.wsId === '') return failed('[x.data] syncHost 缺 wsId');
          if (p.wcId === null) { clearXHostState(p.wsId); return { status: 'ok', value: { cleared: p.wsId } }; }
          if (!Number.isInteger(p.wcId)) return failed('[x.data] syncHost 的 wcId 要是整数或 null');
          const wc = webContents.fromId(p.wcId);
          if (!wc || wc.isDestroyed()) return failed(`[x.data] syncHost:wc#${p.wcId} 不存在或已销毁`);
          setXHostState(p.wsId, p.wcId, '');
          const ws = p.wsId; const id = p.wcId;
          wc.once('destroyed', () => {
            /** ⚠️ 只清「还是这个 wc」的登记 —— 同 ws 可能已换成新 webview */
            if (getXHostState(ws)?.wcId === id) clearXHostState(ws);
            setXHostBusy(id, null);
          });
          console.log(`[x.host] ${p.wsId} 的 X 网页 = wc#${p.wcId}(后台采集可见)`);
          return { status: 'ok', value: { wsId: p.wsId, wcId: p.wcId } };
        }

        case 'syncBusy':
          if (!Number.isInteger(p.wcId)) return failed('[x.data] syncBusy 缺 wcId');
          setXHostBusy(p.wcId, typeof p.reason === 'string' && p.reason !== '' ? p.reason : null);
          return { status: 'ok', value: { wcId: p.wcId } };

        case 'bgBusy':
          if (!Number.isInteger(p.wcId)) return failed('[x.data] bgBusy 缺 wcId');
          return { status: 'ok', value: bgRunningOn(p.wcId) };

        /** ⭐⭐ 后台采集任务(2026-10-14 第 4 步)—— 只做校验 + 调 repo */
        case 'bgCreateJob': {
          if (typeof p.restId !== 'string' || p.restId === '' || typeof p.handle !== 'string' || p.handle === '') {
            return failed('[x.data] bgCreateJob 要 restId(数字 id)和 handle');
          }
          if (typeof p.wsId !== 'string' || p.wsId === '') return failed('[x.data] bgCreateJob 缺 wsId —— 任务属于发起的号');
          /** ⚠️ month 当场采,不进后台;别的字符串一律拒(别兜底成 all) */
          if (!isBgRange(p.range as TimelineRange)) return failed(`[x.data] bgCreateJob 范围只接 halfYear/year/all,收到 ${String(p.range)}`);
          const r = await createJob({ restId: p.restId, handle: p.handle, wsId: p.wsId, range: p.range as 'halfYear' | 'year' | 'all' });
          traceRecorder.lifecycle({
            layer: 'web.net', event: 'x-bg-job-create', pageId: 'x-data',
            detail: { id: r.id, created: r.created, handle: p.handle, range: p.range, wsId: p.wsId },
          });
          kickBgRunner();
          return { status: 'ok', value: r };
        }

        /** ⭐⭐ 此刻状态(运营顶栏 / 人卡「在不在跑」)+ 这个号各状态任务数 */
        case 'bgStatus': {
          if (typeof p.wsId !== 'string' || p.wsId === '') return failed('[x.data] bgStatus 缺 wsId');
          const jobs = await listJobs(p.wsId);
          const counts: Record<string, number> = { queued: 0, running: 0, paused: 0, done: 0, failed: 0 };
          for (const j of jobs) counts[j.status] = (counts[j.status] ?? 0) + 1;
          return { status: 'ok', value: { ...bgRunnerStatus(p.wsId), counts, now: Date.now() } };
        }

        case 'bgListJobs': {
          const jobs = await listJobs(typeof p.wsId === 'string' && p.wsId !== '' ? p.wsId : undefined);
          const mine = typeof p.restId === 'string' && p.restId !== '' ? jobs.filter((j) => j.restId === p.restId) : jobs;
          return { status: 'ok', value: mine };
        }

        case 'bgPauseJob':
        case 'bgResumeJob': {
          if (typeof p.id !== 'string' || p.id === '') return failed(`[x.data] ${p.op} 缺 id`);
          /**
           * ⚠️ 先读:UPSERT 对不存在的 id 会**建出一条残行**(只有 status),
           * 而终态(done/failed)也不许被暂停/恢复改回去 —— 都要明说。
           */
          const job = await readJob(p.id);
          if (!job) return failed(`[x.data] ${p.op}:任务 ${p.id} 不存在(可能已取消)`);
          if (p.op === 'bgPauseJob') {
            if (job.status !== 'queued' && job.status !== 'running') return failed(`[x.data] 任务是「${job.status}」,不能暂停`);
            await setJobStatus(p.id, 'paused');
          } else {
            if (job.status !== 'paused') return failed(`[x.data] 任务是「${job.status}」,不是暂停状态`);
            await setJobStatus(p.id, 'queued');
            kickBgRunner();
          }
          return { status: 'ok', value: { id: p.id } };
        }

        case 'bgCancelJob': {
          if (typeof p.id !== 'string' || p.id === '') return failed('[x.data] bgCancelJob 缺 id');
          await deleteJob(p.id);
          return { status: 'ok', value: { id: p.id } };
        }

        /** ⭐ 运营设置 / 取关闸门 / 动作记录(2026-10-10) */
        case 'opsSettings':
          return { status: 'ok', value: await readSettings() };

        case 'setOpsSetting':
          await writeSetting(p.key, p.value);
          console.log(`[x.ops] 设置 ${p.key} = ${p.value}`);
          return { status: 'ok', value: { key: p.key, value: p.value } };

        case 'unfollowGate':
          if (typeof p.dayStartIso !== 'string' || Number.isNaN(Date.parse(p.dayStartIso))) {
            return failed('[x.data] unfollowGate 要 dayStartIso(本地今天的开始)');
          }
          return { status: 'ok', value: await readUnfollowGate(p.dayStartIso) };

        case 'logAction': {
          const e = p.entry;
          if (!e || e.action !== 'unfollow' || !e.targetRestId || !e.targetHandle
            || (e.decidedBy !== 'human' && e.decidedBy !== 'ai') || (e.result !== 'ok' && e.result !== 'failed')) {
            return failed('[x.data] logAction 的记录不完整');
          }
          await appendAction(e);
          /** ⭐ 动作也打到主进程日志 —— 人看的那块屏(feedback-log-where-the-human-looks) */
          console.log(`[x.ops] ${e.decidedBy === 'human' ? '人' : 'AI'} ${e.action} @${e.targetHandle} → ${e.result}${e.detail ? `(${e.detail})` : ''}`);
          traceRecorder.lifecycle({
            layer: 'web.net', event: `x-action-${e.result}`, pageId: 'x-data',
            detail: { action: e.action, target: e.targetHandle, restId: e.targetRestId, by: e.decidedBy, detail: e.detail ?? '' },
          });
          return { status: 'ok', value: { logged: true } };
        }

        case 'logPersonProgress':
          /** ⭐ 与主进程采集时写的是同一份(`x-person-collect.ts`):event: 'x-person-progress' */
          tracePersonProgress(p.entry);
          return { status: 'ok', value: { logged: true } };

        case 'collectPersonTab': {
          if (!Number.isInteger(p.wcId)) return failed('[x.data] collectPersonTab 缺 wcId');
          if (typeof p.page !== 'string' || p.page === '' || typeof p.handle !== 'string' || p.handle === ''
            || typeof p.restId !== 'string' || p.restId === '') {
            return failed('[x.data] collectPersonTab 缺 page / handle / restId');
          }
          if (!Number.isInteger(p.pageCap) || p.pageCap <= 0) return failed('[x.data] collectPersonTab 的 pageCap 要是正整数');
          return { status: 'ok', value: await collectPersonTab(p) };
        }

        case 'personCollectProgress':
          return { status: 'ok', value: personCollectProgress(p.wcId) };

        case 'cancelPersonCollect': {
          const hit = cancelPersonCollect(p.wcId);
          console.log(`[x.people] 停止采集 wc#${p.wcId}:${hit ? '已通知主进程' : '主进程这边没有在跑的(renderer 自己会停)'}`);
          return { status: 'ok', value: { cancelled: hit } };
        }

        case 'logPersonCollect': {
          const e = p.entry;
          console.log(`[x.people] 采 @${e.handle} ${e.tab}(${e.range}):${e.pages} 页 ${e.records} 条(新 ${e.inserted})—— ${e.stopReason || '(无停因)'}`);
          traceRecorder.lifecycle({ layer: 'web.net', event: 'x-person-collect', pageId: 'x-data', detail: { ...e } });
          return { status: 'ok', value: { logged: true } };
        }

        case 'friendCircle': {
          if (typeof p.restId !== 'string' || p.restId === '') return failed('[x.data] friendCircle 缺 restId');
          if (!Number.isInteger(p.limit) || p.limit <= 0 || p.limit > 200) return failed('[x.data] friendCircle 的 limit 要在 1–200 之间');
          const acc = await accountOfWs(p.wsId);
          if ('reason' in acc) return failed(acc.reason);
          return { status: 'ok', value: await readFriendCircle(acc.restId, p.restId, p.limit) };
        }

        case 'personTweets':
          if (typeof p.restId !== 'string' || p.restId === '') return failed('[x.data] personTweets 缺 restId');
          if (!Number.isInteger(p.limit) || p.limit <= 0 || p.limit > 200) {
            return failed('[x.data] personTweets 的 limit 要在 1–200 之间');
          }
          return { status: 'ok', value: await readPersonTweets(p.restId, p.limit) };

        case 'refreshPerson': {
          const rec = p.record;
          if (!rec || typeof rec.restId !== 'string' || rec.restId === '' || typeof rec.handle !== 'string') {
            return failed('[x.data] refreshPerson 要一条带数字 id 的用户记录');
          }
          const d = await refreshPerson(rec, await accountForWrite(p.wcId));
          traceRecorder.lifecycle({
            layer: 'web.net', event: 'x-person-refresh', pageId: 'x-data',
            detail: {
              restId: rec.restId, handle: rec.handle, isNew: d.isNew, changes: d.changes,
              relationAccount: d.relation.account ?? '(无)', relationSkipped: d.relation.skippedReason ?? '(none)',
            },
          });
          /** ⭐ 新人记账 —— 否则状态页对账差出一个 */
          if (d.isNew) {
            await logCollect({ kind: 'users', source: 'profile-refresh', given: 1, inserted: 1, updated: 0, failed: 0 });
          }
          return { status: 'ok', value: d };
        }

        default:
          /** ⚠️ 不认识的 op 要**明说**,不静默回 ok */
          return failed(`[x.recipe] 不认识的 op: ${String((p as { op?: string })?.op)}`);
      }
    } catch (e) {
      /** ⚠️ 异常如实往上报 —— 吞掉的话界面会显示「保存成功」而库里没有 */
      return failed(`[x.recipe] ${e instanceof Error ? e.message : String(e)}`);
    }
  });
}
