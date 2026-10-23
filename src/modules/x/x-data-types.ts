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
      /**
       * ⭐ wcId = 采集用的那个 X 网页 —— 推文作者的关系(关注/被关注)是**它登录的号**看到的,
       * 主进程据此认号(1.2.27);不给就不写关系(如实报 skippedReason)。
       */
      readonly ctx: { readonly source: string; readonly searchRecipe?: string; readonly wsId?: string; readonly wcId?: number };
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
  /**
   * ⭐⭐⭐ **一页一存、存完回读**(2026-10-16,逐页账)—— 走与 saveTweets / saveUsers **同一条**存库路径
   * (记账、留痕、按号写关系都照旧),之后回读:返回库里**查得到**的 id(推文 tweet_id / 人 rest_id)。
   * 用户:「A页是多少条,落库多少条,对不上问题在哪里,直接就可以敲定了」
   */
  | {
      readonly op: 'savePageVerify';
      readonly tweets: readonly TweetRecord[];
      readonly tweetCtx: { readonly source: string; readonly searchRecipe?: string; readonly wsId?: string; readonly wcId?: number };
      readonly users: readonly XUserRecord[];
      /** 名单页才有;推文页存作者走 tweetCtx */
      readonly userCtx?: { readonly listSource: string; readonly wsId?: string; readonly wcId?: number };
    }
  | {
      readonly op: 'saveUsers';
      readonly records: readonly XUserRecord[];
      /** ⭐ wcId 同 saveTweets:名单里的关系是这个网页登录的号看到的 */
      readonly ctx: { readonly listSource: string; readonly wsId?: string; readonly wcId?: number };
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
  | { readonly op: 'opsStatus'; readonly wsId: string }
  /**
   * ⭐⭐ 认号(2026-10-16,1.2.27)—— 读这个 ws 的 X 网页登录的是谁;还没数字 id 时会开一次自己的主页。
   * 返回 `IdentifyResult`(x-account-repo.ts)。
   */
  | { readonly op: 'identifyAccount'; readonly wsId: string }
  /** ⭐ 这个 ws 记的登录号(只读库,不碰页面)—— 返回 `WsAccount | null` */
  | { readonly op: 'wsAccount'; readonly wsId: string }
  /** ⭐ 运营 → 人:关系概览(每组人数 + 其中蓝V)—— 返回 `PeopleOverview` */
  | { readonly op: 'peopleOverview'; readonly wsId: string }
  /** ⭐ 运营 → 人:列表 —— 返回 `{ total, rows }`;total 是命中总数,rows 最多 limit 条 */
  | { readonly op: 'queryPeople'; readonly wsId: string; readonly filter: PeopleFilter; readonly limit: number; readonly start: number }
  /** ⭐ 运营 → 人卡:按数字 id 取一个人 —— 返回 `PersonDetail | null` */
  | { readonly op: 'personDetail'; readonly wsId: string; readonly restId: string }
  /** ⭐ 排除 / 取消排除(人的决定,source = human)—— 返回 `{ restId, excluded }` */
  | { readonly op: 'setExcluded'; readonly restId: string; readonly excluded: boolean; readonly reason?: string }
  /** ⭐ 写一个人的全部标签(整组替换)—— 返回清洗后的标签 */
  | { readonly op: 'setTags'; readonly restId: string; readonly tags: readonly string[] }
  /** ⭐ 标签目录(有哪些标签、各几人)—— 返回 `Array<{ tag, count }>` */
  | { readonly op: 'tagCatalog' }
  /** ⭐ 任务「蓝V互关」概况(三件事各做到哪了)—— 返回 `BlueMutualOverview` */
  | { readonly op: 'blueMutualOverview'; readonly wsId: string }
  /** ⭐ 2 求关:候选名单 / 关注进度+回访 / 关注队列(加入、状态、暂停继续清空)—— 2026-10-16 M4 */
  | { readonly op: 'blueMutualCandidates'; readonly wsId: string; readonly limit: number }
  | { readonly op: 'blueMutualFollowProgress'; readonly wsId: string }
  | { readonly op: 'followQueueAdd'; readonly wsId: string; readonly items: ReadonlyArray<{ readonly restId: string; readonly handle: string; readonly reason?: string }> }
  | { readonly op: 'followQueueStatus'; readonly wsId: string }
  /**
   * ⭐ 第 4 阶段(2026-10-19):查回关 / 求关对象回关状态 / 一个人的互动时间线
   * followCheckRun 现在查一次(每天自动的那次在主进程定时跑);askFollowStatus 求关名单 + 上次查的结果
   */
  | { readonly op: 'followCheckRun'; readonly wsId: string }
  | { readonly op: 'askFollowStatus'; readonly wsId: string }
  | { readonly op: 'personTimeline'; readonly wsId: string; readonly restId: string }
  /** ⭐ 求关:准备一个人 —— 采他主页最新一页、选推文(或放弃)—— 返回 `AskPrepared`(2026-10-17) */
  | { readonly op: 'askPrepare'; readonly wsId: string; readonly restId: string; readonly handle: string }
  /** ⭐⭐ 求关:三个动作(点赞 → 留言 → 关注),每步核对,哪步没成停在哪步 —— 返回 `AskRunResult`(2026-10-17) */
  | { readonly op: 'askRun'; readonly wsId: string; readonly restId: string; readonly handle: string;
      readonly tweetId: string; readonly tweetText: string; readonly pickKind: 'tweet' | 'bio-latest' | 'other'; readonly reply: string;
      /** Gemma 原稿(用了草拟才有) */
      readonly aiText?: string;
      /** engage = 已互关的日常互动(点赞 + 回复,不关注,记 x_engage) */
      readonly mode?: 'ask' | 'engage' }
  /** ⭐ 互动卡准备(2026-10-22):采他主页、核对还是不是互关、选一条(他找过我就回那条) */
  | { readonly op: 'engagePrepare'; readonly wsId: string; readonly restId: string; readonly handle: string; readonly hisTweetId?: string }
  /** ⭐ 第 3 件事(2026-10-22):已互关蓝V的互动四组 + 互动队列;采互动(三条搜索,最近 90 天) */
  | { readonly op: 'engageOverview'; readonly wsId: string; readonly limit: number }
  | { readonly op: 'engageCollect'; readonly wsId: string }
  /** ⭐ 求关留言 Gemma 草拟(2026-10-21):范例取你亲手写过的;回 AskDraft */
  | { readonly op: 'askDraft'; readonly wsId: string; readonly tweetText: string; readonly name?: string; readonly bio?: string; readonly mode?: 'ask' | 'engage'; readonly context?: string;
      /** ⭐ 按你的点评改上一版;keep = 以后都这样(2026-10-22) */
      readonly revise?: { readonly previous: string; readonly note: string; readonly keep: boolean } }
  /** 你对 AI 草稿的长期要求:列出 / 停掉 / 恢复 */
  | { readonly op: 'draftRules'; readonly wsId: string; readonly mode: 'ask' | 'engage' }
  /** 互动前先过一轮:他 2 小时内有没有动静(用户 10-23) */
  | { readonly op: 'engageScreen'; readonly wsId: string; readonly restId: string; readonly handle: string; readonly hisAt?: string }
  /** 先放一放:这几天别再列他(用户 10-23) */
  | { readonly op: 'deferPerson'; readonly wsId: string; readonly restId: string; readonly mode: 'ask' | 'engage'; readonly tweetId?: string }
  | { readonly op: 'draftRuleActive'; readonly wsId: string; readonly id: string; readonly active: boolean }
  /** ⭐ 互动卡换了一条 → 重新读那条的来龙去脉(找原帖;库里缺就开详情页补采) */
  | { readonly op: 'engageThread'; readonly wsId: string; readonly restId: string; readonly tweetId: string }
  /** 左边 X 网页正在看的这条帖子(用户 10-22:「看到一个帖子不错,我可以选择它,然后再由AI草拟留言」) */
  | { readonly op: 'leftTweet'; readonly wsId: string }
  | { readonly op: 'followQueueControl'; readonly wsId: string; readonly action: 'pause' | 'resume' | 'clear' }
  /**
   * ⭐⭐⭐ 搜索:让页面自己翻页、只截获,每页逐页账(2026-10-16 真机 30 页全对)—— 操作台的搜索页走它。
   * 返回 `SearchScrollReport`(x-search-scroll.ts)。wantPages ≤ 40(SearchTimeline ~50 次/15 分钟)。
   */
  | { readonly op: 'searchScroll'; readonly wcId: number; readonly q: string; readonly f?: 'latest' | 'top'; readonly wantPages: number; readonly maxMs: number; readonly ownBusy?: string }
  /** ⭐ 抽查(2026-10-16):有没有比 after 新的右键「查库」请求 —— 返回 `SpotRequest | null` */
  | { readonly op: 'spotCheckPoll'; readonly wsId: string; readonly after: number }
  /** ⭐ 抽查:按推文 id / 人的 handle 查库 —— 返回 `SpotResult` */
  | { readonly op: 'spotCheckLookup'; readonly wsId: string; readonly kind: 'tweet' | 'person'; readonly tweetId?: string; readonly handle?: string }
  /** ⭐ 扫一遍互关倾向(算法层,1.2.30)—— 返回 `IntentScanReport` */
  | { readonly op: 'scanMutualIntent' }
  /** ⭐ 人标「有/无互关倾向」(source = human,算法不能覆盖) */
  | { readonly op: 'setMutualIntent'; readonly restId: string; readonly value: boolean }
  /**
   * ⭐⭐ 打开主页时核对一个人(2026-10-09)—— 载荷解析在 renderer 做(auditUserPayload),
   * 这里只写库。返回 `{ isNew, changes }`。
   */
  | { readonly op: 'refreshPerson'; readonly record: XUserRecord; readonly wcId: number }
  /** ⭐ 他的推文(人卡用)—— 返回 `{ total, rows }`,按作者数字 id 查 */
  | { readonly op: 'personTweets'; readonly restId: string; readonly limit: number }
  /** ⭐ 他的朋友圈(从推文现算)—— 返回 `{ tweets, people, rows }` */
  | { readonly op: 'friendCircle'; readonly wsId: string; readonly restId: string; readonly limit: number }
  /** ⭐ 采一个人时的**进度**落留痕(翻到第几页 / 歇 / 限流等待)—— 运行中也看得见 */
  | { readonly op: 'logPersonProgress'; readonly entry: { readonly handle: string; readonly tab: string; readonly attempt: number; readonly msg: string } }
  /**
   * ⭐⭐ 人卡采一个标签页 —— 采集在**主进程**跑(`x-person-collect.ts` → collectOnWebview,2026-10-13 3a)。
   * 回 `CollectOnWebviewResult`(去没去到页 / 推文 / 翻页账);存库、采集记录、重试仍由 renderer 做。
   */
  | {
      readonly op: 'collectPersonTab';
      readonly wcId: number; readonly page: string; readonly handle: string; readonly restId: string;
      /** 范围起点 ISO;不给 = 全部 */
      readonly start?: string;
      readonly pageCap: number; readonly attempt: number;
    }
  /** 正在跑的那次采集的最新一句进度(renderer 每秒问一次);没在跑回 null */
  | { readonly op: 'personCollectProgress'; readonly wcId: number }
  /** 人点了停止 —— 立标记,翻页每轮开头 / 歇着时每秒都会看 */
  | { readonly op: 'cancelPersonCollect'; readonly wcId: number }
  /** ⭐ 采一个人某个标签页的结果落留痕(页数 / 条数 / 停因)*/
  | {
      readonly op: 'logPersonCollect';
      readonly entry: {
        readonly restId: string; readonly handle: string; readonly range: string; readonly tab: string;
        readonly pages: number; readonly records: number; readonly inserted: number; readonly stopReason: string;
      };
    }
  /**
   * ⭐⭐ renderer → 主进程:把 X 网页登记(ws→wcId)与「忙」同步过去(`x-host-sync.ts`)。
   * ⚠️ 登记表每进程一份,后台 runner 在主进程 —— 不同步它永远看不到 X 网页。
   * wcId: null = 这个 ws 的 X 网页卸了。
   */
  | { readonly op: 'syncHost'; readonly wsId: string; readonly wcId: number | null }
  | { readonly op: 'syncBusy'; readonly wcId: number; readonly reason: string | null }
  /** ⭐ 后台此刻在不在用这个 webview 采(人手动操作前先问一句);回 `{ handle } | null` */
  | { readonly op: 'bgBusy'; readonly wcId: number }
  /** ⭐ 主进程那份「忙」(查回关 / 关注队列 / 求关 …)—— 登记表每进程一份,renderer 自己那份看不到(2026-10-19) */
  | { readonly op: 'mainBusy'; readonly wcId: number }
  /** ⭐⭐ 后台采集任务(2026-10-14 第 4 步)—— 直接调 `x-bg-job-repo` */
  /** kind = 'lists' 是采他的三个名单(2026-10-19,range 固定 all);不给 = 帖子/回复/转发 */
  | { readonly op: 'bgCreateJob'; readonly restId: string; readonly handle: string; readonly wsId: string; readonly range: string; readonly kind?: 'lists' }
  /**
   * ⭐ 关系采集任务(2026-10-20):读现状 → 比对库 → 定策略 → 建任务开跑;不给 restId = 我自己
   * relationJobs 这个号的关系采集任务;paceStatus 节奏(AI 自调,只读)
   */
  | { readonly op: 'relationStart'; readonly wsId: string; readonly restId?: string; readonly handle?: string }
  | { readonly op: 'relationJobs'; readonly wsId: string }
  | { readonly op: 'paceStatus' }
  /** ⭐ 人卡「他的名单」:三个名单各多少人 + 其中的求关候选(2026-10-19) */
  | { readonly op: 'personLists'; readonly wsId: string; readonly restId: string; readonly limit: number }
  /** 列任务;给 restId 只列这个人的,给 wsId 只列这个号的 */
  | { readonly op: 'bgListJobs'; readonly wsId?: string; readonly restId?: string }
  /** ⭐ 此刻在不在跑(runner 内存态)+ 这个号各状态任务数;回 `BgStatusView` */
  | { readonly op: 'bgStatus'; readonly wsId: string }
  | { readonly op: 'bgPauseJob'; readonly id: string }
  | { readonly op: 'bgResumeJob'; readonly id: string }
  | { readonly op: 'bgCancelJob'; readonly id: string }
  /** ⭐ 运营设置(人可设定的变量,含默认值合并)—— 返回 `{ settings, problems }` */
  | { readonly op: 'opsSettings' }
  /** ⭐ 改一个设置(带校验) */
  | { readonly op: 'setOpsSetting'; readonly key: string; readonly value: number }
  /** ⭐ 现在能不能取关(每日上限 + 最小间隔)—— dayStartIso 由 renderer 按本地时区给 */
  | { readonly op: 'unfollowGate'; readonly dayStartIso: string }
  /** ⭐ 记一条动作(只追加)*/
  | {
      readonly op: 'logAction';
      readonly entry: {
        readonly action: 'unfollow'; readonly targetRestId: string; readonly targetHandle: string;
        readonly decidedBy: 'human' | 'ai'; readonly result: 'ok' | 'failed';
        readonly reason?: string; readonly detail?: string;
        /** 哪个 ws 发起的 —— 时间线按号找动作要它(2026-10-19;之前的取关记录没有) */
        readonly wsId?: string;
      };
    };

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
