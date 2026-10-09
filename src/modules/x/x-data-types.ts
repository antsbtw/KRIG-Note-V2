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
import type { XUserRecord } from './x-user-audit';
import type { PeopleFilter } from './x-people-query';

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
    }
  /**
   * ⭐⭐⭐ **采到的 X 用户落库** —— 2026-10-05。
   *
   * ⚠️ 与 `saveTweets` 并列、**不合并成一个 `save`** ——
   * 两者的「不许覆盖」清单完全不同:
   * 推文护的是 `accepted`/`ai_verdict`(AI 与人工填的),
   * 用户护的是 `blocked`/`watched`/`note`(屏蔽名单与追踪名单)。
   * ⭐ 合成一个泛型 op 就要在里面分流,而分流写错**不报错**、
   * 表现成「屏蔽点了没反应」。
   *
   * ⚠️ `listSource` 会原样进 `x_author.list_memberships`(累加不覆盖),
   * 所以必须是**稳定的词**(followers / following / verifiedFollowers)——
   * 今天写 'followers' 明天写 '关注者' 会让同一个名单记成两个。
   */
  | {
      readonly op: 'saveUsers';
      readonly records: readonly XUserRecord[];
      readonly ctx: { readonly listSource: string; readonly wsId?: string };
    }
  /**
   * ⭐⭐⭐ **断点续采:读上次停在哪** —— 2026-10-07。
   *
   * ⚠️ `Followers` 端点约 50 次/窗口就 429,而 X 每次都从**第 1 页**给游标。
   * 不续采的话整个配额浪费在重采已入库的人上。
   */
  | { readonly op: 'readCursor'; readonly scope: string }
  /**
   * ⭐⭐ **存断点** —— 每跑结束都存,不管是采完了还是被挡了。
   * ⚠️ 「被挡下」那次正是最需要存的。
   */
  | {
      readonly op: 'saveCursor';
      readonly cursor: {
        readonly scope: string;
        readonly bottomCursor?: string;
        readonly exhausted: boolean;
        readonly lastRound?: number;
        readonly lastReason?: string;
        readonly totalSeen?: number;
      };
    }
  /** ⭐ 清断点 —— 面板「从头采」用。⚠️ 删的是派生状态,人一个不少 */
  | { readonly op: 'clearCursor'; readonly scope: string }
  /**
   * ⭐⭐ 运营 → 状态 的全部数字(2026-10-07)—— 返回 `OpsStatus`(x-ops-status.ts)。
   * 人数 / 推文数 / 各名单更新时间 / 近几天账本 / 还没采集的类别。
   */
  | { readonly op: 'opsStatus' }
  /** ⭐ 运营 → 人:关系概览(每组人数 + 其中蓝V)—— 返回 `PeopleOverview` */
  | { readonly op: 'peopleOverview' }
  /** ⭐ 运营 → 人:列表 —— 返回 `{ total, rows }`;total 是命中总数,rows 最多 limit 条 */
  | { readonly op: 'queryPeople'; readonly filter: PeopleFilter; readonly limit: number; readonly start: number }
  /** ⭐ 运营 → 人卡:按数字 id 取一个人 —— 返回 `PersonDetail | null` */
  | { readonly op: 'personDetail'; readonly restId: string }
  /** ⭐ 排除 / 取消排除(人的决定,source = human)—— 返回 `{ restId, excluded }` */
  | { readonly op: 'setExcluded'; readonly restId: string; readonly excluded: boolean }
  /** ⭐ 写一个人的全部标签(整组替换)—— 返回清洗后的标签 */
  | { readonly op: 'setTags'; readonly restId: string; readonly tags: readonly string[] }
  /** ⭐ 标签目录(有哪些标签、各几人)—— 返回 `Array<{ tag, count }>` */
  | { readonly op: 'tagCatalog' };

/**
 * ⚠️ 三态 —— 与 `WebDomResult` 同一形状:
 * `ok` 由有没有问题算出来,不是独立字段(两者各说各话就是撒谎的入口)。
 */
/**
 * ⭐⭐⭐ **X 侧的类型化入口** —— 2026-10-07。
 *
 * ⚠️⚠️ 共享层的 `xDataInvoke` 现在收发 `unknown`(不透明载荷),
 * 因为写上 X 的类型名会让「删 X」真的编译不过 ——
 * 守卫扫不到 `import(...)` 的类型位置用法,**可卸载性是假的**。
 *
 * ⭐ 类型安全没丢,只是**收窄的地方挪到了 X 自己这边**:
 * 调用方用这个函数,参数与返回照样有完整检查。
 * ⚠️ 这是唯一允许做 `as` 的地方 —— 别在各个调用点散着写。
 */
export async function xDataCall(payload: XDataInvoke): Promise<XDataResult> {
  const api = (globalThis as { electronAPI?: { xDataInvoke?(p: unknown): Promise<unknown> } })
    .electronAPI;
  if (api?.xDataInvoke === undefined) {
    /** ⚠️ fail loud:通道没挂上就说清楚,别回个空壳让人以为「存了」 */
    return { status: 'failed', reason: '[x.data] electronAPI.xDataInvoke 不存在 —— 通道没接上' };
  }
  return await api.xDataInvoke(payload) as XDataResult;
}

export type XDataResult =
  | { readonly status: 'ok'; readonly value: unknown }
  | { readonly status: 'failed'; readonly reason: string };
