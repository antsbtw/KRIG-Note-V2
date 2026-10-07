/**
 * ⭐⭐ X 的**数据** IPC(配方 CRUD + 推文落库 + 用户落库)—— **X 自带,与 X 同生共死**
 *
 * ⚠️ `search-recipe-repo` 本来就在(表、CRUD 都齐),
 * 缺的只是「renderer 怎么调到它」这一环。
 *
 * ⚠️⚠️ 本文件**只做接线**:参数校验 + 调 repo + 三态返回。
 * 业务判据(配方怎么翻译成查询)在 `x-recipe-query.ts`,不在这儿。
 */

import { ipcMain } from 'electron';
import {
  listAllRecipes, upsertRecipe, deleteRecipe,
} from '@platform/main/db/search-recipe-repo';
import { traceRecorder } from '@platform/main/web-capability/wiring/runtime';
import { saveTweets } from './x-tweet-repo';
import { saveUsers } from './x-user-repo';
import { readCursor, saveCursor, clearCursor } from './x-cursor-repo';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import type { XDataInvoke, XDataResult } from './x-data-types';

const failed = (reason: string): XDataResult => ({ status: 'failed', reason });

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
          const r = await saveUsers(p.records, p.ctx);
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
              failed: r.failed.length,
              firstFailure: r.failed[0]?.why ?? '(none)',
              listSource: p.ctx.listSource,
            },
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
