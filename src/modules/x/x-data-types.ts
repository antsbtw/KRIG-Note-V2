/**
 * X 模块的**数据** IPC 契约 —— ⭐ **X 自带,与 X 同生共死**
 *
 * ⚠️ 原名 `x-recipe-types`,2026-10-05 改名:
 * 落库(`saveTweets`)也要走这条通道,而「配方」装不下它。
 * ⭐ 一个模块一条数据通道,不是一个功能一条 —— 删 X 时少一个要删的点。
 *
 * ⚠️⚠️ **放在 X 模块里,不在 `shared/ipc/`** —— 2026-10-05 被守卫逮到:
 * 它 import X 的 `TweetRecord`,放 shared 就等于**共享层依赖 X**,
 * 删 X 时留下坏引用。与 `x-tweet-repo` 同一个教训(同一天栽两次)。
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
import type { TweetRecord } from './x-timeline-audit';

/**
 * ⚠️ 通道名**不在这里** —— 在 `@shared/ipc/channel-names` 的 `X_DATA_INVOKE`。
 * ⭐ 理由:preload 是单一文件、无法自注册,通道名放 X 就逼它 import `@modules/x`,
 * 「X 可卸载」守卫必红。留一行孤儿常量比那个代价小。
 * ⚠️ 但**契约类型留在 X**(它 import TweetRecord,放 shared 就是共享层依赖 X)。
 */

export type XDataInvoke =
  /** 列出全部配方(含停用的)—— 配置界面要看得见全部 */
  | { readonly op: 'list' }
  /**
   * 新增或改一条。
   * ⚠️ `id` 为空表示新增(由 repo 生成 ULID),非空是改。
   */
  | { readonly op: 'upsert'; readonly recipe: SearchRecipe }
  | { readonly op: 'delete'; readonly recipeId: string }
  /**
   * ⭐⭐⭐ **采到的推文落库** —— 2026-10-05。
   *
   * ⚠️ 为什么要走 IPC:`runCollect` 跑在 **renderer**,
   * 而 `getXDB()` 只有主进程有 —— 不能让 renderer 直接碰库。
   * ⚠️ `records` 是解析器产出的**完整记录**(五维),
   * 不是面板那份核对结果(preview 只 80 字)。
   */
  | {
      readonly op: 'saveTweets';
      readonly records: readonly TweetRecord[];
      readonly ctx: { readonly source: string; readonly searchRecipe?: string; readonly wsId?: string };
    };

/**
 * ⚠️ 三态 —— 与 `WebDomResult` 同一形状:
 * `ok` 由有没有问题算出来,不是独立字段(两者各说各话就是撒谎的入口)。
 */
export type XDataResult =
  | { readonly status: 'ok'; readonly value: unknown }
  | { readonly status: 'failed'; readonly reason: string };
