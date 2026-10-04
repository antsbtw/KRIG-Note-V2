/**
 * X 配方(search_recipes)的 IPC 契约 —— ⭐ **X 模块自带**
 *
 * ⚠️ 为什么通道名不进 `channel-names.ts`:
 * 用户 2026-09-30 的第一性约束是「X 可以很简单地卸载和安装」,
 * 守卫 `x-module-detachable` 的改法原话:
 * **「X 自带视图/IPC/repo/schema,启动时推给底座」**。
 * 放进共享表就等于删 X 时多一个删不掉的点。
 *
 * ⚠️ 也**不能挂到 `web-dom.invoke` 上** —— 那是 web 能力层的通道,
 * 而配方是**库里的业务数据**;挂上去就要在能力层 import 业务 repo,
 * 撞「能力层不许 import 业务层」那道守卫。
 */

import type { SearchRecipe } from '@shared/types/x-timeline-types';

/** ⭐ 通道名 —— 与 X 模块同生共死 */
export const X_RECIPE_CHANNEL = 'x-recipe.invoke';

export type XRecipeInvoke =
  /** 列出全部配方(含停用的)—— 配置界面要看得见全部 */
  | { readonly op: 'list' }
  /**
   * 新增或改一条。
   * ⚠️ `id` 为空表示新增(由 repo 生成 ULID),非空是改。
   */
  | { readonly op: 'upsert'; readonly recipe: SearchRecipe }
  | { readonly op: 'delete'; readonly recipeId: string };

/**
 * ⚠️ 三态 —— 与 `WebDomResult` 同一形状:
 * `ok` 由有没有问题算出来,不是独立字段(两者各说各话就是撒谎的入口)。
 */
export type XRecipeResult =
  | { readonly status: 'ok'; readonly value: unknown }
  | { readonly status: 'failed'; readonly reason: string };
