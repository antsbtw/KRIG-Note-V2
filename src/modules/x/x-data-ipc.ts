/**
 * ⭐⭐ X 的**数据** IPC(配方 CRUD + 推文落库)—— **X 自带,与 X 同生共死**
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
import { saveTweets } from './x-tweet-repo';
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
          return { status: 'ok', value: await saveTweets(p.records, p.ctx) };
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
