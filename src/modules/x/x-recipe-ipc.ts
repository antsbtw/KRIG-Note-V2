/**
 * ⭐⭐ 配方 CRUD 的 IPC —— **X 自带,与 X 同生共死**
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
import { X_RECIPE_CHANNEL, type XRecipeInvoke, type XRecipeResult } from '@shared/ipc/x-recipe-types';

const failed = (reason: string): XRecipeResult => ({ status: 'failed', reason });

/** ⚠️ 幂等 —— 多窗口/热重载下可能被调多次 */
let wired = false;

export function registerXRecipeIpc(): void {
  if (wired) return;
  wired = true;

  ipcMain.handle(X_RECIPE_CHANNEL, async (_e, p: XRecipeInvoke): Promise<XRecipeResult> => {
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
