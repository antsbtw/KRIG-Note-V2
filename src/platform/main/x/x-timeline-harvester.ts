/**
 * X 时间线通用采集器 —— **一个函数,把某个页面上 X 会显示的推文全部拿下**。
 *
 * 用户 2026-09-02 定的做法:
 * 「先做好网页自动滚动,获取全部 X 上显示的推文的函数吧,**包含校验方法**。
 *   这个函数过关再考虑其他的问题。也就是点开那个菜单,
 *   都能够获取完整的 X 显示的推文及元数据。」
 *
 * ── 为什么要单独抽出来 ──────────────────────────────────────────
 * 滚动逻辑此前散在三个文件里(reply-collector / payload-inspector /
 * author-timeline-spike),同样的 bug 要修三遍,而且**每次都以为修好了**。
 * 实测代价:用户拿官网点击数据一核对 —— 10 天 433 条回复,库里只有 81 条(19%)。
 *
 * ── 踩过的坑,全部固化在这里(改动前先读)────────────────────────
 * ① `behavior:'smooth'` 是**异步**的:调用立刻返回、滚动尚未发生,
 *    在那之后读 scrollY 读到的是**滚动前**的值 → 等于没测量。
 *    ⇒ 必须同步 scrollBy,且**滚动之后**才回读。
 * ② X 用**虚拟列表**:滚过去的 article 会被从 DOM 删除,
 *    所以「当前 DOM 条数」不是进度 —— 实测出现过 +0 / -1(不涨反降)。
 *    ⇒ 进度只看**跨轮累计的去重 id 数**。
 * ③ 「没有新数据」≠「到底了」:时间线里夹着别人的推很正常,
 *    急着停是漏数据的元凶。
 *    ⇒ 只有 scrollY **连续多轮不变**才算真到底。
 * ④ 「见过的最旧一条」≠ 覆盖深度:X 把置顶/热门旧推排在前面,
 *    一条 3 月的推就让判据误以为已覆盖 166 天。
 *    ⇒ 日期只做**显示**,绝不做停止判据。
 *
 * ── 校验(用户要求「包含校验方法」)──────────────────────────────
 * 每次采集返回 HarvestReport,自带三层校验,**任何一层不通过都如实标红**:
 *  A. 滚动确实发生了(scrollY 单调增长 / 最终 stuck)
 *  B. 抓到的条数 vs 页面声称的总数(有基线时)
 *  C. 时间连续性 —— 抓到的日期有没有大洞(洞 = 漏采信号)
 */

import { webContents as allWebContents } from 'electron';
import {
  extractPeopleFrom, findPagingCursor, withCursor, buildRefetchScript, isPeopleOp, isPageDataOp,
  countTimelineEntries,
  type HarvestedPerson,
} from './x-people-harvester';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { resolveXWebContents } from './x-webcontents';
/**
 * ⭐ 载荷捕获走 `web.net`(2026-09-27 迁移)——
 * 本模块**不再碰 debugger**,也就掐不断别的订阅者(如抓 bio)。
 */
import { captureXPayloads, type XPayload } from './x-net-capture';
/** ⭐ 暂停键 —— 滚动可能跑 5000 轮,必须有出口 */
import { isAborted } from './x-collect-abort';
/** ⭐ DOM 抽取与「点开 Show more」—— 与右键提取、tweet-fetcher 共用同一套选择器 */
import { TWEET_SCRAPE_FN_BODY } from '../tweet-fetcher/extract-script';

/**
 * ⭐ 连续这么多轮没有新数据就判定「采到底了」。
 * 实测:X 每页 50 人、约 6-7 轮一页 → 40 轮 ≈ 6 个正常页间隔,不会误停;
 * 而真到底时实测空转 259 轮,40 足够早地发现。
 */
const NO_GAIN_LIMIT = 40;

/**
 * ⭐⭐ **快速增量的停止判据** —— 连续见到这么多**已知的人**就算「追上了」。
 *
 * ── 为什么是「连续」不是「累计」──
 *
 * 一页 50 人里夹着几个已知的很正常(上次采集与这次之间,X 的分页边界会挪),
 * 但**连续** 30 个都是已知的,只有一种解释:已经翻进上次采过的区域了。
 *
 * ⚠️ 阈值必须**小于一页人数**(实测 50-100/页),否则第一页就翻完了还没触发,
 * 等于白翻一页;又要**远大于零星交错**。取 30。
 *
 * ⭐ 与 `NO_GAIN_LIMIT` 是两回事:
 * · NO_GAIN_LIMIT = 全量的「X 不再给新数据」(到底了)
 * · KNOWN_RUN_LIMIT = 增量的「新人已经翻完了」(追上了)
 */
const KNOWN_RUN_LIMIT = 30;

/** 一条采集到的原始推文(字段照搬 X 载荷,不做业务解释) */
export interface HarvestedTweet {
  tweetId: string;
  authorHandle?: string;
  /**
   * 作者的数字 id(core.user_results.result.rest_id)。
   * 契约要求「有就务必给」—— OAuth 拿到的也是这个,按它匹配最稳
   * (username 会改名,rest_id 不会)。实测 131/131 条都有。
   */
  authorRestId?: string;
  /**
   * 这条推**自己**带了图片或视频。
   *
   * ⚠️ 契约的定义很窄(§2.1),三个不算:
   *  · 链接预览卡(card)不算 —— 那是 X 给外链生成的,不是用户上传的
   *  · 引用的原文里的图不算 —— 那是别人的图
   *  · 回复里 @ 到的推的图不算
   * 故只认 legacy.extended_entities.media,不下钻 quoted_status_result、
   * 不看 card。活动判定「有效留言」直接依赖这个字段,宽了会误发奖励。
   */
  hasMedia: boolean;
  /** 媒体类型(photo/video/animated_gif),便于运营核对;判定只用 hasMedia */
  mediaTypes?: string[];
  text: string;
  createdAt?: string;
  lang?: string;
  inReplyToStatusId?: string;
  inReplyToScreenName?: string;
  conversationId?: string;
  quotedStatusId?: string;
  /** ⚠️ 长推(note_tweet 的 Show more)**或**长文正文 —— 两者都算「拿到了全文」 */
  isLongText: boolean;
  /**
   * ⭐ 这条是**长文(Article)**吗 —— 与长推**分开统计**。
   *
   * ⚠️ 用户 2026-09-21 实测踩到:报告把 72 篇长文算进「长推(Show more)」,
   * 还报「最长 48 字 ⚠️ 疑似被截断」—— 48 字是**标题的正常长度**,
   * 根本没截断。下一个人会去查一个不存在的 bug。
   *
   * ⭐ 只要载荷里有 article 结构就为真(**不论是否拿到正文**):
   * 列表页只给标题+摘要也是长文,这样才能如实说「有几篇长文、其中几篇有正文」。
   */
  isArticle: boolean;
  /**
   * ⭐⭐ **这条没拿全**,以及为什么 —— 空 = 拿全了。
   *
   * ── 用户 2026-09-22 点破 ──
   * > 「不管长文短文,如果折叠起来就应该 show all,然后获取完整的内容,
   * >   就像人一样,但是现在却是分的零碎,却无法获取完整的内容。」
   *
   * ⚠️ 此前采集是「**载荷给什么存什么**」:X 给了 note_tweet 就有全文,
   * 没给就把**截断的 `legacy.full_text` 当成全文存下来,而且毫不知情**。
   * 于是「没拿全」和「本来就这么短」在库里长得一模一样。
   *
   * ⭐ 这个字段只做一件事:**把缺口说出来**。
   * 采不采得回来是下一步的事,但**不知道自己少了**是最坏的状态。
   */
  incomplete?: 'text-truncated' | 'article-no-body';
  metrics: {
    likes?: number; retweets?: number; replies?: number;
    quotes?: number; bookmarks?: number; views?: number;
  };
  /** 登录用户自己对这条推的状态 —— 登录态 webview 独有,零额外请求 */
  self: { favorited?: boolean; retweeted?: boolean; bookmarked?: boolean };

  /**
   * ── ⭐ DOM 路独有的字段(载荷里没有)──
   *
   * 用户 2026-09-18 实机验证时发现右侧缺这几项。它们**只有 DOM 拿得到**:
   * 载荷里作者名要另查 user 结构、头像 url 与 media 的实际 url 都是渲染后才定的。
   * 而「取并集」的要求是 —— **一路独有的也不能丢**。
   *
   * ⚠️ 载荷路解出来的对象**不会有**这几项(保持 undefined),
   * 面板上会标 ⚠️。那是诚实的:这条推来自载荷,本来就没这几项 ——
   * 不是「漏采」,是「这一路拿不到」。两者必须看得出区别。
   */
  /**
   * ⭐ 蓝V —— 用户 2026-09-18 实机验证时指出缺这项。
   *
   * ⚠️ 载荷里**有两个位置**都可能放它(画像那条路 `x-author-profile.ts:93`
   * 实测过):`result.is_blue_verified` 与 `result.verification.is_blue_verified`。
   * 只读一个会漏 —— 那正是 x_author 里蓝V只有 2% 的成因之一。
   */
  /**
   * ⭐ 我与这个人的关系 —— 用户 2026-09-18 问「following 能直接拿到吗」。
   *
   * ⚠️ **时间线载荷里带不带,要看真实载荷**(面板上「原始载荷」可以翻)。
   * 悬浮卡上那些(Following 按钮/Follows you/粉丝数)来自**悬停时另发的
   * UserByScreenName 请求**,时间线载荷未必有。
   *
   * 带了就有值,没带就是 undefined —— **不猜、不兜底**:
   * 「没关注」与「不知道关注没」是两件事,混起来会让追踪名单判错人。
   *
   * ⚠️ 与画像路同口径,**两个位置都看**(x-author-profile.ts:95):
   * `relationship_perspectives.following` 与 `legacy.following`。
   */
  iFollow?: boolean;
  followsMe?: boolean;
  /**
   * ⭐ 作者 bio —— 用户 2026-09-18 问「bio 采集到了吗」,答案曾是**没有**:
   * 类型里没有、解析器没解、而 `authorsWithBio` 却一直报 0 ——
   * 那是个**说谎的字段**(看着像「没采到」,其实是「根本没采」)。
   *
   * ⚠️ 与蓝V/关系同样是**两个位置**(x-author-profile.ts:89 实测):
   * `profile_bio.description`(新形态)与 `legacy.description`(旧形态)。
   *
   * ⭐ 这一项的价值:盘点实测 bio 覆盖率仅 155/8021 = 2%,
   * 因为此前只有「导航到那人主页 + 等 12 秒」这一条路。
   * 时间线载荷里本来就带,等于白拿。
   */
  authorBio?: string;
  /** ⭐ iFollow 是靠哪个 testid 判出来的(如 `123-unfollow`)—— 判错要查得到 */
  followEvidence?: string;
  isBlueVerified?: boolean;
  /** ⭐ 蓝V是靠哪一条判出来的 —— 判错了要查得到,不是只给 true/false */
  verifiedEvidence?: string;
  authorName?: string;
  authorAvatar?: string;
  tweetUrl?: string;
  media?: Array<{ type: string; url: string; thumbUrl?: string }>;

  /**
   * true = 从 DOM 兜底抓的(字段较少:没有会话根/自身互动状态/长推全文)。
   * 用于监视页区分数据来源 —— 载荷是首选,DOM 只补 CDP 没覆盖到的部分。
   */
  fromDom?: boolean;
}

export interface RoundTrace {
  round: number;
  scrollY: number;
  docHeight: number;
  domArticles: number;
  cumulative: number;
  newThisRound: number;
  stuck: number;
}

export interface HarvestReport {
  url: string;
  /**
   * ⭐⭐ **解不出推文的载荷样本** —— 给「量结构」用。
   *
   * ── 用户 2026-09-18 要做「采人」──
   *
   * 关注者/关注中页面的载荷是 `Followers`/`Following`(人的列表),
   * 而 `extractTweetsFrom` 只认推文对象,会整个跳过 → 报 0 条。
   * 要写「采人」的解析器,得**先看真实结构** —— 与量蓝V那次同理:
   * **量出来再写,不猜**。
   *
   * ⚠️ 只在「这个载荷一条推都没解出来」时才留,且只留前几条、每条截断:
   * 正常采集时不该把几百 KB 的时间线载荷搬来搬去。
   */
  unparsedSamples: Array<{ op: string; bytes: number; body: string }>;
  /**
   * ⭐ 见过的**全部** GraphQL 操作名 + 大小 —— 样本只留 3 条,但你得知道
   * 「那个带数据的请求到底发没发生」。
   *
   * ⚠️ 用户 2026-09-18 实测:截到 18 个载荷,留下的 3 个样本全是 0KB 杂项
   * (DataSaverMode / ViewerBadgeCounts),看不出 `Followers` 有没有出现。
   * 只报样本不报全景,就答不了「是没发请求,还是发了但我没留下来」。
   */
  /**
   * 本次见过的 GraphQL 操作。
   *
   * ⭐⭐ `articles` / `articlesWithBody` = **这个接口给的长文深不深**。
   * 2026-09-22 血的教训:`UserArticlesTweets`(`/articles` 标签页)只给
   * `title` + `preview_text`,而**普通时间线接口给的同一篇长文带正文**
   * (@0xEgorAI 那两条 16081/6812 字就是时间线采到的)。
   * 此前报告只汇总「几篇长文、几篇有正文」,**不分接口** → 于是
   * 「哪个入口给得浅」看不出来,被反推成「只有详情页才有正文」,
   * 白立了一个项。**按接口分开记,差异才看得见。**
   */
  seenOps: Array<{ op: string; bytes: number; articles?: number; articlesWithBody?: number }>;
  /**
   * ⭐⭐ 采到的**人** —— 关注者/关注中/验证关注者页面的产出。
   *
   * 用户 2026-09-18 实测:那几页的载荷是 `BlueVerifiedFollowers`
   * (12 个 × 40KB),`extractTweetsFrom` 只认推文对象会整个跳过。
   * 所以同一次采集**两种都解**:是推就进 tweets,是人就进 people。
   */
  people: HarvestedPerson[];
  /**
   * ⭐⭐ 分页游标 —— 回答「**采完了没有**」,不靠猜。
   *
   * 此前判「到底了」靠 scrollY 连续 8 轮不变,那是猜;
   * 而 X 在载荷里**明说**还有没有(TimelineTimelineCursor / cursorType=Bottom)。
   *
   * · `hasMore=false` → 真的采完了
   * · `hasMore=true` + 停在轮次上限 → **还没采完**,加轮数还能拿到更多
   * · `bottom` 的值 → 跨次增量的**断点**(下次从这里接着采)
   */
  paging: { bottom?: string; top?: string; hasMore: boolean };
  /** 游标翻页的页数;0 = 没翻(不是采人页,或抄不到请求) */
  pagedRounds: number;
  /**
   * ⭐⭐ **解析率** —— 「X 给的我都接住了吗」。
   *
   * ⚠️ 它与游标回答的是**两个不同的问题**,缺一不可:
   * · 游标(paging.hasMore)= **X 那边还有没有**
   * · 解析率(这里)        = **我这边接没接住**
   *
   * 两者都过才叫「完整」:X 说没有更多了(采到头)且解析率 100%(没漏)。
   * ⭐ 对 notifications/search/home 这些**没有外部分母**的页面,
   * 这是唯一自给自足的完整性判据。
   */
  parseRate: {
    /** X 在载荷里给了多少条目(游标条目不算) */
    entries: number;
    /** 我解出了多少(推 + 人) */
    parsed: number;
    /** parsed / entries;entries=0 时为 undefined(不编数) */
    rate?: number;
  };
  /**
   * ⭐⭐ 快速增量的**闭环回读** —— 「追上了没有」由数据回答,不由页数猜。
   *
   * ⚠️ `caughtUp=false` 而又停了,意味着**没追上就停了**(撞上页数闸门/
   * 请求失败)—— 那时新人可能还没翻完,报告**必须说出来**,
   * 不能让人以为「就这几个新人」。
   */
  fastIncremental?: {
    /** 已知名单有多大(0 = 没有基线,退回全量) */
    knownBaseline: number;
    /** 这次翻到的人里,有多少是已知的 */
    knownSeen: number;
    /** 连续见到已知人的最长串 —— 触发停止的那个数 */
    knownRun: number;
    /** ⭐ 真追上了吗 —— 这是「能不能相信这次结果」的判据 */
    caughtUp: boolean;
  };
  /** ⭐ 没翻的话,是四个入口条件里哪一条不成立 —— 四种断法必须分得开 */
  pagingSkipped?: string;
  /**
   * ⭐ 这一趟点开了几个「Show more」(折叠的推)。
   * ⚠️ 0 有两义:本来就没折叠的,或**按钮没找到**(X 改了结构)——
   * 与 incomplete 一起看才判得出是哪种。
   */
  domExpanded?: number;
  /** ⭐ 翻页失败时发出去的 URL(诊断用) */
  failedUrl?: string;
  /**
   * ⭐ 翻页失败的判据 —— status / content-type / 实际 method / 响应体开头。
   * ⚠️ 与 failedUrl 一起看才分得出三种成因(见失败分支的注释)。
   */
  failedProbe?: { status?: number; ctype?: string; method?: string; bodyHead?: string };
  /**
   * ⭐ 翻页是不是**靠改 POST 形状才成功的**(GET 被 404-未路由挡下)。
   * ⚠️ **成功路径的判据**:不记的话「X 的 GET 已不认」这个外部事实
   * 会随这一跑消失,下次又要从 404 从头查一遍。
   */
  shapeSwitched?: boolean;
  /**
   * ⭐ 最后一个 GraphQL 请求(URL + 头)—— 游标翻页**重发它**,不自己拼。
   * X 的 queryId/features 会随版本变,复刻必然过期;复用刚发过的那条不会。
   */
  lastRequest?: { url: string; headers: Record<string, string>; method?: string };
  ok: boolean;
  /** 不通过的校验项 —— 空数组才算过关 */
  problems: string[];
  rounds: number;
  payloads: number;
  tweets: HarvestedTweet[];
  /**
   * 抓到的日期跨度与空洞。
   * ⚠️⚠️ `oldest`/`newest` 是**按天聚合**的(`YYYY-MM-DD`),给人看跨度用 ——
   * **不要拿它当时间戳**。2026-09-27 实测踩到:搜索水位复用了它,
   * 于是「最新一条 20:38:55」被存成了「00:00:00」,
   * 下次算增量窗口会平白多退一整天(现象是「每次都重采一大段」)。
   * ⭐ 要精确时间用下面的 `newestAt`。
   */
  dateSpan: { oldest?: string; newest?: string; days: number; gaps: string[] };
  /**
   * ⭐⭐ 这一趟采到的**最新一条推的精确发布时间**(ISO)。
   * 搜索水位用它 —— 与 `dateSpan.newest`(按天)**刻意分开**:
   * 一个给人看跨度,一个给程序算窗口,语义不同不该复用同一个字段。
   */
  newestAt?: string;
  stopReason: string;
  trace: RoundTrace[];
}

/**
 * 递归抽取所有推文对象 —— 只认 legacy 里的权威字段,不做 DOM 推断。
 * 导出给 x-capture-monitor 复用:**同一份抽取逻辑**,避免两处实现漂移
 * (滚动逻辑散成三份、同一 bug 修三遍的教训就在眼前)。
 */
/**
 * ⭐⭐ **这条推拿全了吗** —— 拿不全就说出来,别让它和「本来就这么短」长一样。
 *
 * ── 为什么需要它(用户 2026-09-22)──
 * > 「如果折叠起来就应该 show all,然后获取完整的内容,就像人一样,
 * >   但是现在却是分的零碎,却无法获取完整的内容。」
 *
 * 采集一直是「载荷给什么存什么」:
 *  · 长推:全文在 `note_tweet`,X 不给时 `legacy.full_text` 是**截断**的
 *  · 长文:正文在 `article_results.result.content_state`,**列表页不给**
 * 两种情况下我们都存了个残缺版,**而且不知道**。
 *
 * ── 判据 ──
 * ① `article-no-body`:载荷里有 article 结构却没解出正文 —— 确定没拿全
 * ② `text-truncated` :没有 note_tweet,而 full_text 带**截断特征**
 *
 * ⚠️ 截断特征必须**保守**:宁可漏报也不能错报。
 * 错报会让人去补一条本来就完整的推(白跑一趟详情页,还看不出错);
 * 漏报只是维持现状。所以只认 X 自己留下的确定标记:
 *  · 结尾是 `…` / `...`(X 截断时加的省略号)
 *  · 结尾是 `… https://t.co/xxx`(截断 + 自链)
 * ⚠️ **不**用「长度接近 280」当判据 —— 正好写满 280 字的推是完整的,
 *    那样会把一大批完整短推错报成截断。
 */
/**
 * ⭐⭐ **把 DOM 读到的推合并进累计表** —— 载荷与 DOM 互补,不是二选一。
 *
 * ── 两边各有对方没有的东西(2026-09-22 实测)──
 * · 载荷独有:`conversation_id` / `in_reply_to_status_id` / 长文 `content_state`
 * · **DOM 独有**:页面已加载时载荷根本不发(实测同一 URL 采到 0 条),
 *   以及**展开后的全文**(折叠时正文压根没进载荷也没进 DOM)
 *
 * ── 合并规则 ──
 * ① `text` **只许变长** —— 与写库那层同一条底线(2026-09-22 的数据损坏就是它防住的)。
 *    展开后的 DOM 全文会顶掉载荷的截断版;反过来载荷的长文正文也不会被 DOM 摘要顶掉。
 * ② 其余字段**空值不许覆盖非空**。
 * ③ ⚠️ 新条目标 `fromDom`,已有条目**不改这个标记**:
 *    它是「这条的 has_media 可不可信」的依据(DOM 分不清用户上传的图与外链预览卡),
 *    被 DOM 补过字段不等于整条都来自 DOM。
 */
/**
 * ⚠️⚠️ **DOM 上这条推「读到东西了」吗** —— 2026-09-23 实测揪出的空壳行。
 *
 * ── 现象 ──
 * 采 @KA594594 主页,20 条里 **19 条 `text` 是空的**(0 字),
 * 而 `tweet_url` / `created_at` / `metrics` 都有 —— 看着像采到了,其实正文全空。
 *
 * ── 真因 ──
 * 抽取器只认 `[data-testid="tweetText"]`,而**长文(Article)卡片没有这个 testid**
 * (它显示的是封面图 + 标题),于是 `querySelector` 返回 null,
 * `text` 和 `lang` 双双留空 —— 而其余字段照常取到,所以**不像坏了**。
 *
 * ── 为什么要拦在入库之前 ──
 * ⭐ 长文的正文本来就**只能从详情页取**(列表页 X 根本不给),
 * 所以这里入一条空壳行**没有任何价值**,只会:
 *  · 让「采到 20 条」这个数字虚高(实际只有 1 条有内容)
 *  · 在库里留下和「本来就这么短」分不清的垃圾行
 * ⚠️ 而且它**挡不住**后续补正文 —— 补正文的候选来自这一趟采到的
 *   `isArticle` 标记,不来自库。
 *
 * ⭐ 判据:**正文为空就不算采到**。宁可报「这一页 DOM 只读到 1 条」,
 * 也不要报「采到 20 条」而其中 19 条是空的 —— 后者正是本仓最忌的
 * 「看着成功实际没有」。
 */
function domItemHasContent(it: Record<string, unknown>): boolean {
  return typeof it.text === 'string' && it.text.trim().length > 0;
}

export function mergeDomTweets(
  items: ReadonlyArray<Record<string, unknown>>,
  out: Map<string, HarvestedTweet>,
): void {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  for (const it of items) {
    const id = str(it.tweetId);
    if (!id) continue;
    /**
     * ⚠️⚠️ **空正文不入库** —— 长文卡片没有 `tweetText`,读出来是空字符串。
     * 已有条目照样跳过:空值本来就不该覆盖非空(下面的合并规则也会挡,
     * 但在这里挡掉更早、更省事,而且「采到几条」的计数才是诚实的)。
     */
    /**
     * ⚠️⚠️ **空正文只拦「新建行」** —— 2026-09-23 守卫抓到我下手太重:
     * 第一版对**已有行**也整条跳过,于是「这次 DOM 没读到正文」会连带
     * 放弃补它的 tweet_url / created_at 等字段 —— 那些本来是补得上的。
     * ⭐ 空壳的害处在于**凭空造出一条没内容的行**;
     *   给已有行补字段不会造成空壳,照常做。
     */
    if (!domItemHasContent(it) && !out.has(id)) {
      /**
       * ⭐⭐ **长文是例外:没正文也要留下标记**。
       * 长文卡片天然没有 `tweetText`(正文只在详情页),
       * 但**必须让它进表并标 `isArticle`** —— 否则紧接着的「补正文」
       * 拿不到候选,这篇就永远补不上了(而现象是「这篇没采到」)。
       * ⚠️ 只补标记,`text` 留空由详情页填。
       */
      if (it.isArticle === true) {
        const cur = out.get(id);
        if (cur) cur.isArticle = true;
        else {
          out.set(id, {
            tweetId: id,
            authorHandle: str(it.authorHandle),
            authorName: str(it.authorName) || undefined,
            tweetUrl: str(it.tweetUrl) || undefined,
            createdAt: str(it.createdAt) || undefined,
            text: '',
            metrics: (it.metrics ?? {}) as HarvestedTweet['metrics'],
            self: {},
            hasMedia: it.hasMedia === true,
            fromDom: true,
            isLongText: false,
            isArticle: true,
          } as HarvestedTweet);
        }
      }
      continue;
    }
    const prev = out.get(id);
    if (!prev) {
      out.set(id, {
        tweetId: id,
        authorHandle: str(it.authorHandle),
        authorName: str(it.authorName) || undefined,
        authorAvatar: str(it.authorAvatar) || undefined,
        text: str(it.text),
        createdAt: str(it.createdAt) || undefined,
        lang: str(it.lang) || undefined,
        tweetUrl: str(it.tweetUrl) || undefined,
        inReplyToScreenName: str(it.inReplyToScreenName) || undefined,
        metrics: (it.metrics ?? {}) as HarvestedTweet['metrics'],
        self: {},
        hasMedia: it.hasMedia === true,
        /** ⚠️ 纯 DOM 来源 —— has_media 不可信,下游据此不发奖励 */
        fromDom: true,
        isLongText: false,
        isArticle: false,
      } as HarvestedTweet);
      continue;
    }
    /**
     * ⚠️⚠️ **text 只许变长** —— 展开后的全文可以顶掉截断版,
     * 但**绝不许**用 DOM 的摘要盖掉载荷里的长文正文(16081 → 267 那次事故的形态)。
     */
    const t = str(it.text);
    if (t.length > (prev.text ?? '').length) prev.text = t;
    /**
     * ⭐ 长文标记**只补不抹**:DOM 认出是长文就标上,
     * 但 DOM 没认出来**不代表它不是**(载荷可能已经标过了)。
     */
    if (it.isArticle === true) prev.isArticle = true;
    /** 其余字段只补空,不覆盖 */
    if (!prev.tweetUrl && str(it.tweetUrl)) prev.tweetUrl = str(it.tweetUrl);
    if (!prev.authorAvatar && str(it.authorAvatar)) prev.authorAvatar = str(it.authorAvatar);
    if (!prev.authorName && str(it.authorName)) prev.authorName = str(it.authorName);
    if (!prev.createdAt && str(it.createdAt)) prev.createdAt = str(it.createdAt);
    if (!prev.lang && str(it.lang)) prev.lang = str(it.lang);
    if (!prev.inReplyToScreenName && str(it.inReplyToScreenName)) {
      prev.inReplyToScreenName = str(it.inReplyToScreenName);
    }
  }
}

export function detectIncomplete(o: {
  articleBody: string;
  noteText?: string;
  fullText?: string;
  isArticle: boolean;
}): 'text-truncated' | 'article-no-body' | undefined {
  // ① 长文没正文 —— 这个最确定:有 article 结构,却一个字正文都没解出来
  if (o.isArticle && !o.articleBody) return 'article-no-body';
  // ② 长推被截断 —— 有 note_tweet 就说明拿到全文了,不用判
  if (o.noteText) return undefined;
  const t = (o.fullText ?? '').trimEnd();
  if (!t) return undefined;
  /**
   * ⚠️ 只认**确定**的截断标记:省略号收尾(可能后面跟着自链)。
   * X 截断长推时就是这个形态;完整推不会以省略号结尾。
   */
  if (/(…|\.\.\.)(\s+https:\/\/t\.co\/\w+)?$/.test(t)) return 'text-truncated';
  return undefined;
}

export function extractTweetsFrom(node: unknown, out: Map<string, HarvestedTweet>): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const it of node) extractTweetsFrom(it, out);
    return;
  }
  const o = node as Record<string, unknown>;
  const lg = o.legacy as Record<string, unknown> | undefined;

  if (lg && typeof lg === 'object' && typeof lg.id_str === 'string') {
    const s = (k: string): string | undefined =>
      typeof lg[k] === 'string' && lg[k] ? (lg[k] as string) : undefined;
    const n = (k: string): number | undefined =>
      typeof lg[k] === 'number' ? (lg[k] as number) : undefined;

    // 作者:core.user_results.result.core.screen_name
    const core = o.core as Record<string, unknown> | undefined;
    const urr = (core?.user_results as Record<string, unknown> | undefined)
      ?.result as Record<string, unknown> | undefined;
    const ucore = urr?.core as Record<string, unknown> | undefined;

    // ⚠️ 长推 legacy.full_text **会被截断**,真全文在 note_tweet
    const note = o.note_tweet as Record<string, unknown> | undefined;
    const nres = (note?.note_tweet_results as Record<string, unknown> | undefined)
      ?.result as Record<string, unknown> | undefined;
    const noteText = nres && typeof nres.text === 'string' ? nres.text : undefined;

    /**
     * ⭐⭐ **长文(Article)正文** —— 与长推是**两回事**,别混。
     *
     * ── 用户 2026-09-21 实测发现 ──
     *
     * 同一次采集、同一页,长推取到 957 字,两篇**长文各只存进 23 字**:
     * `text = 'https://t.co/e5H5321Vh9'` —— 标题和几千字正文全丢。
     *
     * 真因:长文的 `legacy.full_text` **就只有一个 t.co 短链**,
     * 正文在 `article.article_results.result.content_state` 里(DraftJS 格式),
     * 而这里原本只走 `note_tweet ?? full_text` 两条路,`article` 零处理。
     *
     * ⚠️ 报告里「长推(Show more) ✓ 全文已取回」量的是 note_tweet,
     * **不量长文** —— 又一次「不量的字段永远是 100%」。
     *
     * ── 结构(实测载荷)──
     *
     * `content_state.blocks[]`,每块 `{ text, type }`:
     *  · `unstyled`    正文段
     *  · `header-two`  小标题
     *  · `atomic`      媒体占位 —— ⚠️ text 是**单个空格**,拼进去会留孤立空行
     *
     * ⭐ 只取纯文本:`inlineStyleRanges`(粗体等)按偏移量描述,
     * 要还原样式得再引一层格式模型 —— 采集层的职责是**不丢字**,
     * 富文本还原是消费侧的事(与既有「采集层无条件全收、不做判断」一致)。
     */
    /** ⚠️ 真正的**正文**(不含标题/摘要)—— 只有它才算「长文全文取回」 */
    let articleBody = '';
    const articleText = ((): string | undefined => {
      const art = o.article as Record<string, unknown> | undefined;
      const ares = (art?.article_results as Record<string, unknown> | undefined)
        ?.result as Record<string, unknown> | undefined;
      if (!ares) return undefined;
      const cs = ares.content_state as Record<string, unknown> | undefined;
      const blocks = Array.isArray(cs?.blocks) ? cs!.blocks as Array<Record<string, unknown>> : [];
      const body = blocks
        .map((b) => (typeof b.text === 'string' ? b.text : ''))
        // ⚠️ atomic 的单空格要滤掉,否则正文里全是孤立空行
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
        .join('\n\n');
      /**
       * ⭐ 标题拼在正文前 —— 它**不在 blocks 里**。
       *
       * ⚠️ 诊断日志截断在 4000 字,**没看到 title 到底挂哪一层**。
       * 与其猜一处写死(猜错就是静默丢标题,而正文在、没人会发现),
       * 不如**按已知的几处依次找**,并且找不到也不失败(正文仍然保住)。
       * ⭐ 真实结构确认后可以收窄成一处。
       */
      const pick = (v: unknown): string => (typeof v === 'string' && v.trim() ? v.trim() : '');
      const meta = ares.metadata as Record<string, unknown> | undefined;
      const title = pick(ares.title)
        || pick((ares.title as Record<string, unknown> | undefined)?.text)
        || pick(meta?.title)
        || pick((meta?.title as Record<string, unknown> | undefined)?.text)
        || pick(cs?.title);
      /**
       * ⭐⭐ **列表页只有标题 + 摘要,没有正文** —— 2026-09-21 实测量过 72 条。
       *
       * `UserArticlesTweets` 载荷里 `article_results.result` 的键**恒定**是:
       * `cover_media / id / lifecycle_state / metadata / preview_text / rest_id / title`
       * —— **没有 `content_state`**(72/72 条 `hasContentState:false`)。
       *
       * ⭐ 正文只在**单篇页**(`TweetDetail`)的载荷里才有 —— 同一个 `article`
       * 字段,两个页面给的深度不同。所以「列表页取不到正文」**不是 bug**,
       * 想要正文得逐篇进详情页(另一个立项)。
       *
       * ⚠️ 但 `preview_text` **就在载荷里,不取就是白丢** ——
       * 卡片上显示的那段摘要正是它。只存标题的话,库里就是
       * 「乡村文化人记忆」这样 7 个字,检索和判断都用不上。
       *
       * ⚠️ 摘要**不是正文**,不能假装是:所以 `isLongText` 不因它为真
       * (见下面 `!!articleBody`),否则报告会把 7 字标题算成「全文已取回」。
       */
      articleBody = body;
      const preview = pick(ares.preview_text);
      const parts = [title, body || preview].filter((x) => x.length > 0);
      return parts.length ? parts.join('\n\n') : undefined;
    })();

    // ⚠️ views.count 是**字符串**,且 state=Enabled 时没有数字
    const views = o.views as Record<string, unknown> | undefined;
    const viewCount = views && typeof views.count === 'string'
      ? Number(views.count) : undefined;

    // x_uid:rest_id 挂在 user_results.result 上(不是 core 里)
    const authorRestId = urr && typeof urr.rest_id === 'string'
      ? urr.rest_id : undefined;

    // has_media:**只认自己的** extended_entities.media(见类型注释的三个「不算」)
    const extEnt = lg.extended_entities as Record<string, unknown> | undefined;
    const mediaArr = Array.isArray(extEnt?.media) ? extEnt!.media as Array<Record<string, unknown>> : [];
    const mediaTypes = mediaArr
      .map((m) => (typeof m.type === 'string' ? m.type : undefined))
      .filter((t): t is string => !!t);

    const id = lg.id_str as string;
    /**
     * ⭐⭐ **显示名 / 头像 / 推文 URL** —— 2026-09-21 用户提出「先看单条完整性」时
     * 实测暴露:这三个字段**载荷路径从来没赋过值**,只有 DOM 路径产出。
     *
     * 后果:库里 400 条抽样中 `tweet_url` 77% 空、`author_avatar` 80% 空、
     * `author_name_at_post` 78% 空 —— 而 `coverage` **不量这三项**,
     * 所以报告一直显示「15/16 项 100%」。
     *
     * ⚠️ 这正是记忆里那条的复发:x-capture-monitor 因「载荷首选、DOM 兜底」
     * 把 DOM 独有字段(authorName/avatar/tweetUrl)全丢了。**同一个坑,另一条路径。**
     *
     * ⭐ 数据其实**就在载荷里**(实测 2026-09-02 真实载荷):
     * · 显示名 `core.name`(新)/ `legacy.name`(旧)
     * · 头像   `avatar.image_url`(新)/ `legacy.profile_image_url_https`(旧)
     * 只有 URL 载荷不直接给 —— 但 handle + id 拼得出,那是**确定的规则**不是猜。
     */
    const uavatar = urr?.avatar as Record<string, unknown> | undefined;
    const ulegacy = urr?.legacy as Record<string, unknown> | undefined;
    const handle = ucore && typeof ucore.screen_name === 'string'
      ? ucore.screen_name
      : (ulegacy && typeof ulegacy.screen_name === 'string' ? ulegacy.screen_name : undefined);
    const authorName = (() => {
      const v = ucore?.name ?? ulegacy?.name;
      return typeof v === 'string' && v.trim() ? v : undefined;
    })();
    const authorAvatar = (() => {
      const v = uavatar?.image_url ?? ulegacy?.profile_image_url_https;
      return typeof v === 'string' && v.trim() ? v : undefined;
    })();
    /** ⚠️ 没有 handle 就**不拼** —— 拼出 `x.com/undefined/status/…` 比没有更糟 */
    const tweetUrl = handle ? `https://x.com/${handle}/status/${id}` : undefined;

    if (!out.has(id)) {
      out.set(id, {
        tweetId: id,
        authorHandle: handle,
        authorName,
        authorAvatar,
        tweetUrl,
        authorRestId,
        // ⭐ bio:两个位置都看(与 x-author-profile.ts:89 同口径)
        authorBio: (() => {
          if (!urr) return undefined;
          const pb = urr.profile_bio as Record<string, unknown> | undefined;
          const ulg2 = urr.legacy as Record<string, unknown> | undefined;
          const v = pb?.description ?? ulg2?.description;
          return typeof v === 'string' && v.trim() ? v : undefined;
        })(),
        // ⭐ 关系:两个位置都看(与 x-author-profile.ts:95 同口径)
        //    ⚠️ 只在**明确为 true/false** 时给值;字段不在就 undefined ——
        //    「没关注」与「载荷里没这个字段」必须分得开
        ...(() => {
          const persp = urr?.relationship_perspectives as Record<string, unknown> | undefined;
          const ulg = urr?.legacy as Record<string, unknown> | undefined;
          const pick = (a: unknown, b: unknown): boolean | undefined =>
            a === true || b === true ? true
              : a === false || b === false ? false : undefined;
          return {
            iFollow: pick(persp?.following, ulg?.following),
            followsMe: pick(persp?.followed_by, ulg?.followed_by),
          };
        })(),
        // ⭐ 蓝V:两个位置都看(与 x-author-profile.ts:93 同口径,少看一个就会漏)
        isBlueVerified: (() => {
          if (!urr) return undefined;
          if (urr.is_blue_verified === true) return true;
          const v = urr.verification as Record<string, unknown> | undefined;
          if (v?.is_blue_verified === true) return true;
          // ⚠️ 明确的 false 也是事实(「查过了,不是蓝V」),与「没查到」不同
          if (urr.is_blue_verified === false || v?.is_blue_verified === false) return false;
          return undefined;
        })(),
        hasMedia: mediaArr.length > 0,
        mediaTypes: mediaTypes.length ? mediaTypes : undefined,
        text: articleText ?? noteText ?? s('full_text') ?? '',
        createdAt: s('created_at'),
        lang: s('lang'),
        inReplyToStatusId: s('in_reply_to_status_id_str'),
        inReplyToScreenName: s('in_reply_to_screen_name'),
        conversationId: s('conversation_id_str'),
        quotedStatusId: s('quoted_status_id_str'),
        isLongText: !!noteText || !!articleBody,
        /**
         * ⭐⭐ **没拿全的两种形态**,如实标注(判定逻辑见 detectIncomplete)。
         * ⚠️ 只标注、不修改 text —— 采集层的职责是不丢字 + 不谎报,
         *    「怎么补回来」是编排层的事。
         */
        incomplete: detectIncomplete({
          articleBody,
          noteText,
          fullText: s('full_text'),
          isArticle: !!(o.article as Record<string, unknown> | undefined)?.article_results,
        }),
        // ⚠️ 用「载荷里有没有 article 结构」判定,不用「有没有正文」——
        //    列表页没正文的那 72 条也是长文,漏掉它们统计就又不诚实了
        isArticle: !!(o.article as Record<string, unknown> | undefined)
          ?.article_results,
        metrics: {
          likes: n('favorite_count'), retweets: n('retweet_count'),
          replies: n('reply_count'), quotes: n('quote_count'),
          bookmarks: n('bookmark_count'),
          views: Number.isFinite(viewCount) ? viewCount : undefined,
        },
        self: {
          favorited: typeof lg.favorited === 'boolean' ? lg.favorited : undefined,
          retweeted: typeof lg.retweeted === 'boolean' ? lg.retweeted : undefined,
          bookmarked: typeof lg.bookmarked === 'boolean' ? lg.bookmarked : undefined,
        },
      });
    }
  }

  for (const v of Object.values(o)) extractTweetsFrom(v, out);
}

/** 算日期跨度与空洞 —— 空洞是漏采的直接信号 */
function analyseDates(tweets: HarvestedTweet[]): HarvestReport['dateSpan'] {
  const days = [...new Set(
    tweets.map((t) => t.createdAt).filter(Boolean)
      .map((d) => new Date(d as string).toISOString().slice(0, 10)),
  )].sort();
  if (!days.length) return { days: 0, gaps: [] };

  const gaps: string[] = [];
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1]).getTime();
    const cur = new Date(days[i]).getTime();
    const gapDays = Math.round((cur - prev) / 86_400_000);
    // 只报 >2 天的洞:单天空档可能真的没发推
    if (gapDays > 2) gaps.push(`${days[i - 1]} → ${days[i]}(${gapDays}天)`);
  }
  return {
    oldest: days[0],
    newest: days[days.length - 1],
    days: days.length,
    gaps,
  };
}

/**
 * 采集一个 X 页面上的全部推文。
 *
 * @param url        目标页(个人主页 / with_replies / 搜索结果 / 通知…都行)
 * @param targetWcId X webContents
 * @param maxRounds  安全阀;正常情况靠「真的滚不动」自然结束。
 *   ⚠️ 全量回补一个上千条的账号需要**很多轮** —— 实测每轮平均只产出 1.5 条、
 *   每 7.6 轮才触发一个 GraphQL 响应(X 越往深加载越慢)。
 *   1200 轮 ≈ 40 分钟,对应约 1200~1800 条的覆盖能力。
 *   设小了会**静默截断**(此前 300 轮就是这么把 2-7 月整段丢掉的)。
 */
export async function harvestTimeline(
  url: string,
  targetWcId?: number,
  /**
   * ⭐ **安全网,不是目标** —— 正常情况下永远走不到它,
   * 停止由「连续 N 轮零新增」判据决定(见 NO_GAIN_LIMIT)。
   * ⚠️ 2026-09-19 之前这个数是**目标值**:填 30 就只采 250 人,
   * 填多少人就得自己估算多少轮 —— 那是把机器该做的判断推给人。
   */
  maxRounds = 5000,
  opts: {
    /**
     * 时间预算(毫秒)。到点就返回已抓到的部分,stopReason 标 budget。
     * 契约 §3.1:campaign-tasks 最多等 8s,超时按未命中处理 ——
     * 所以宁可返回不完整,也不能干等。
     */
    budgetMs?: number;
    /**
     * ⭐ 游标翻页的页数上限(默认 40)。一页 50-100 人,
     * 40 页 ≈ 2000-4000 人 —— 够覆盖大多数账号的关注者。
     * ⚠️ 这是**闸门不是目标**:X 说没有更多了就会提前停。
     */
    pageBudget?: number;
    /**
     * 提前结束判据。契约 §3.1:「翻到这个人的留言就不用把整个评论区抓完」。
     * 返回 true 即停,stopReason 标 hint。
     */
    stopWhen?: (t: HarvestedTweet) => boolean;
    /**
     * ⭐⭐ **快速增量**:上次全量采到的人。给了它就「翻到已知的人就停」。
     *
     * ── 为什么这是安全的(2026-09-19 实测才敢做)──
     *
     * 本文件此前**明令禁止**这种早停,理由是「X 按什么排序没有证据」。
     * 现在有证据了 —— 见 `knownHandlesOfLastRun` 的注释:
     * 2770 人实测**相邻逆序对 0**、新人全在 seq 0..10、老人整体平移。
     * **严格按关注时间倒序**,所以新人只会在最前面。
     *
     * ⚠️ 它**看不见取关**(取关者从名单中间消失),必须靠周期性全量兜底。
     * ⚠️ 给了它就**不该写快照** —— 只采了前几十人,存进去会让下次差集
     *    把没翻到的 2700 人全报成「取关」。这条由调用方(x-auto-collect)把守。
     */
    knownHandles?: Set<string>;
    /**
     * ⭐ 哪个 workspace 在采 —— **暂停键按 ws 分**。
     * ⚠️ 全局一个布尔会让「停 A」把 B 也停掉,现象是「B 莫名其妙不采了」。
     */
    wsId?: string;
  } = {},
): Promise<HarvestReport | { error: string }> {
  const resolved = resolveXWebContents(targetWcId);
  if ('error' in resolved) return { error: resolved.error };
  const wc = resolved.wc;

  const startedAt = Date.now();
  const tweets = new Map<string, HarvestedTweet>();
  const trace: RoundTrace[] = [];
  /**
   * ⭐ 解不出推文的载荷样本 —— 给「量结构」用(见 HarvestReport.unparsedSamples)。
   * ⚠️ 只留前 3 条、每条截 8000 字:够看清结构,又不至于把几百 KB 搬进 IPC。
   */
  const unparsedSamples: Array<{ op: string; bytes: number; body: string }> = [];
  /**
   * ⭐⭐ **解析率的分母** —— X 在载荷里给了多少条目。
   *
   * 用户 2026-09-20:「每个页面都能够正确、完整的提取数据」。
   * 有四个页面(notifications/search/home/articles)**没有外部分母**,
   * 对它们「完整」只能问:**X 给的我都接住了吗**。
   * 这个判据自给自足 —— 分母就在载荷里。
   */
  let entriesSeen = 0;
  /** ⭐ 采到的人 —— 与推文并行解,同一次采集两种都要 */
  const people = new Map<string, HarvestedPerson>();
  /** ⭐ 最后一次见到的分页游标 —— 「还有没有」由 X 说了算 */
  let paging: { bottom?: string; top?: string; hasMore: boolean } = { hasMore: false };
  /** ⭐ 最后一个「人的列表」请求 —— 游标翻页靠重发它(不自己拼) */
  let lastPeopleReq: {
    url: string; headers: Record<string, string>; method?: string;
  } | null = null;
  /** 见过的全部操作名 —— 回答「那个请求到底发没发生」 */
  const seenOps: Array<{ op: string; bytes: number; articles?: number; articlesWithBody?: number }> = [];
  let payloads = 0;

  /**
   * ⭐⭐ **一条载荷进来** —— 迁到 `web.net` 之后的入口(2026-09-27)。
   *
   * ── 为什么迁(真机实测)──
   * 原来这里自己 `debugger.attach → on(message) → detach`。
   * 而 `x-author-profile`(抓 bio)已经迁到 `web.net`,**只订阅没有 detach**。
   * 编排的顺序是**先采集、后备料** —— 采集结束时那句 `detach()`
   * 把备料的订阅**一起掐掉**,于是 bio 采集 192 人里 **159 次**
   * 报「期间一条 GraphQL 载荷都没看见」。
   *
   * ⚠️ 这不是新 bug:`47582b72` 那次迁移就预言了
   * 「A 先 → B 共用,A 走时真的 detach,B 静默失聪」,
   * 只是它**只迁了 2 个模块就叫停**,采集正是没迁的那 5 个之一。
   * ⭐ 编排把那个「难复现」的场景变成了**每次必现**。
   *
   * ⭐ 迁完之后本模块**没有 detach 这个动作**(接口上就没有),
   * 「谁先谁后」不再是变量 —— bug 在结构上消失,而不是被小心避开。
   */
  const onXPayload = (payload: XPayload): void => {
    const reqUrl = payload.url;
    /**
     * ⭐⭐ 把**完整请求**留下来 —— 游标翻页要用它重发。
     *
     * ⚠️ 不自己拼请求:X 的 GraphQL 要 queryId / features 参数(会随版本变)。
     * 复用 X 刚发过的那一条就不用知道它们是什么 —— 只把 URL 里的 cursor 换掉。
     * ⚠️ 请求头(authorization / x-csrf-token)同样原样带走,不复刻鉴权。
     *
     * ⚠️⚠️ **留第一条,不是最后一条**(用户 2026-09-18 实测):
     * 滚动中 X 自己也在翻页,后面那些请求**本身就带 cursor** ——
     * 拿一条已经翻到深处的当模板,重放时游标早已过期 → **HTTP 404**。
     * 第一条必然是页面刚加载时的「第一页」形状,最干净。
     *
     * ⚠️⚠️ 判据是「**主数据接口**」不是「人的列表」(2026-09-22 用户追出来):
     * 原来写 `isPeopleOp(op)`,于是 `UserArticlesTweets` 不在名单里 →
     * 请求从没抄下来 → 翻页永远不启动 → 长文页停在 4 篇而 X 明说还有。
     *
     * ⚠️ 迁移后 `requestHeaders` 来自 `onSendHeaders`(见 webrequest-side),
     * **可能为空** —— 空就别抄,抄了个空头去重放会报 404,把人带去查错方向。
     */
    const op = reqUrl.match(/\/graphql\/[^/]+\/(\w+)/)?.[1] ?? '';
    if (payload.requestHeaders && isPageDataOp(op, reqUrl) && !lastPeopleReq) {
      lastPeopleReq = {
        url: reqUrl,
        headers: payload.requestHeaders as Record<string, string>,
        method: payload.method ?? 'GET',
      };
    }

    payloads++;
    const before = tweets.size;
    const peopleBefore = people.size;
    /**
     * ⚠️ 先占位、后面回填 `articles` —— 深度要**按这一个载荷**量,
     * 不能拿累计 `tweets` 算(累计里混着别的接口的长文,
     * 每个接口都会显示同一个总数,差异就被抹平了)。
     */
    const opEntry: { op: string; bytes: number; articles?: number; articlesWithBody?: number } = {
      op: reqUrl.match(/\/graphql\/[^/]+\/(\w+)/)?.[1] ?? '(未知操作)',
      bytes: payload.body.length,
    };
    seenOps.push(opEntry);
    try {
      const parsed = JSON.parse(payload.body);
      /**
       * ⭐ **这一个载荷**里的长文有多少、其中几篇带正文。
       * 单独解到一个临时 Map,避免与累计结果互相污染。
       */
      const solo = new Map<string, HarvestedTweet>();
      extractTweetsFrom(parsed, solo);
      const soloArticles = [...solo.values()].filter((t) => t.isArticle);
      if (soloArticles.length > 0) {
        opEntry.articles = soloArticles.length;
        // isLongText 对长文 = 真拿到了正文(摘要不算,见 articleBody)
        opEntry.articlesWithBody = soloArticles.filter((t) => t.isLongText).length;
      }
      // ⭐ 先数 X 给了多少条目(解析率的分母),再解析
      entriesSeen += countTimelineEntries(parsed);
      extractTweetsFrom(parsed, tweets);
      // ⭐ **人也解一遍** —— 同一个载荷可能既有推也有人
      //    (如时间线里的推荐关注模块);两种都要,不二选一
      extractPeopleFrom(parsed, people);
      // ⭐ 游标以**最后一个载荷**为准 —— 它反映当前翻到哪儿了
      const cur = findPagingCursor(parsed);
      if (cur.bottom || cur.top) paging = cur;
    } catch { /* 非 JSON */ }
    /**
     * ⭐ 这个载荷**一条推都没解出来** → 留个样本给「量结构」用。
     * ⚠️ 推**和**人都没解出来才算「没解出来」——
     *    否则关注者页会被误报成「解析失败」,而它其实采到人了
     * ⚠️ **优先留大的**(用户 2026-09-18 实测):只留前 3 条时拿到的全是
     *    `DataSaverMode` 这类 0KB 杂项(发生得最早,把名额占满了),
     *    而真正带人的载荷反而没留下。大小是最好的筛子。
     */
    if (tweets.size === before && people.size === peopleBefore) {
      unparsedSamples.push({
        op: reqUrl.match(/\/graphql\/[^/]+\/(\w+)/)?.[1] ?? '(未知操作)',
        bytes: payload.body.length,
        body: payload.body.slice(0, 8000),
      });
      unparsedSamples.sort((a, b) => b.bytes - a.bytes);
      if (unparsedSamples.length > 3) unparsedSamples.length = 3;
    }
  };

  /**
   * ⭐⭐ **只订阅,没有 detach** —— 通道由底座独占(`web.net`)。
   * ⚠️ 本模块从此**碰不到 debugger**,也就掐不断任何别的订阅者。
   */
  let channelFault: string | null = null;
  const unsubscribe = captureXPayloads(wc, {
    urlIncludes: ['/i/api/graphql/'],
    onPayload: onXPayload,
    /**
     * ⚠️ 通道坏了要**看得见** —— 旧实现 attach 失败只 catch 一下就继续,
     * 订阅者安静等一个永不来的载荷,现象是「采集突然变 0」。
     */
    onChannelFault: (reason: string) => { channelFault ??= reason; },
  });

  /**
   * ⭐⭐ 「确保在目标页」是**一个步骤**,不是两个流程。
   *
   * ── 用户 2026-09-18 纠正 ──
   *
   * > 「这是通用的子流程,如果输入一个用户名,点击采集,
   * >   也是要先跳转到这个人的主页,对吗?」
   *
   * 对。「输入 handle 采集」与「采当前页」**只是到达方式不同**,
   * 后面的滚动/抓载荷/入库完全一样。我起初做成两个按钮,
   * 是把**到达方式**当成了**不同流程**。
   *
   * ⭐ 所以判断放在这里,不让人选:
   *  · 已经在目标页 → 不跳(省掉重新加载、不冲掉滚动位置、不白等 4.5s)
   *  · 不在 → 跳过去
   *  · 没给 url → 就采当前页
   */
  const already = (() => {
    if (!url) return true;                       // 没给目标 = 采当前页
    try {
      const nowUrl = wc.getURL();
      // ⚠️ 只比 path,不比 query/hash —— X 会往 URL 上挂 ?src= 之类,
      //    比全等会让「明明已经在这页」误判成「不在」,白跳一次
      /**
       * ⚠️ **要忽略大小写** —— X 的 handle 大小写不敏感:
       * 面板填 `0xegorai`,而页面 URL 是 `/0xEgorAI`。
       * 区分大小写会把「已经在这页」误判成「不在」→ 白跳一次、冲掉滚动位置。
       * ⭐ 下面的落地校验本来就 `.toLowerCase()` 了,两处判据必须一致,
       * 否则「判不在 → 跳 → 落地判在」这种自相矛盾很难查。
       */
      const a = new URL(url).pathname.replace(/\/$/, '').toLowerCase();
      const b = new URL(nowUrl).pathname.replace(/\/$/, '').toLowerCase();
      return a === b;
    } catch { return false; }
  })();

  if (already) {
    // 仍给一点时间让 CDP 监听就位 —— 刚 attach 就滚,头几个响应会漏在监听之前
    await new Promise((r) => setTimeout(r, 300));
  } else {
    wc.loadURL(url);
    await new Promise((r) => setTimeout(r, 4500));

    /**
     * ⭐⭐ **落地校验** —— 导航完必须确认真的到了,否则在错的页面上照采不误。
     *
     * ── 用户 2026-09-18 实测踩到 ──
     *
     * 选了 x.profile 但 handle 用的是默认值 `fang_danie121`(一个**不存在的账号**,
     * 那是当天早些时候测「账号不存在」留下的)。X 对不存在的用户**弹回首页**,
     * 于是采集在首页上跑完、报告一切正常 —— 用户看到的是「点采集后弹回自己主页」。
     *
     * ⚠️ 这正是 2026-09-07 那个教训的复发:
     * 「被弹回首页时『页面上有推文』照样成立,于是把首页时间线当成搜索结果整批入库」。
     * `goto` 为此加了带 handle 的 arrival 判据,而 `harvestTimeline` 这条路
     * **一直没有任何落地校验** —— 它只管滚和抓。
     *
     * ⭐ 这里只比 path:到没到**那一页**是事实,页面上有没有推是另一回事。
     */
    const landed = wc.getURL();
    const same = (() => {
      try {
        const want = new URL(url).pathname.replace(/\/$/, '').toLowerCase();
        const got = new URL(landed).pathname.replace(/\/$/, '').toLowerCase();
        return got === want || got.startsWith(want + '/');
      } catch { return false; }
    })();
    if (!same) {
      return {
        error: `导航后没落在目标页:想去 ${url},实际在 ${landed} —— `
          + '常见成因:账号不存在/被封/改名(X 会弹回首页)。'
          + '⚠️ 已中止采集,否则会把**错误页面**的内容当成目标数据整批入库。',
      };
    }
  }

  let lastY = -1;
  /** ⭐ 位置指纹 = window 位置 + 内层容器位置 —— 任一变化都算「动了」 */
  let lastPosKey = '';
  let stuck = 0;
  /**
   * ⭐ 连续多少轮没有新数据 —— **停止的主判据**(PDCA 的「再判断」)。
   * ⚠️ 阈值必须远大于「一页的轮间隔」(实测 6-7 轮),否则正常间隔会被误判。
   */
  let noGainRounds = 0;
  let lastPeopleCount = -1;
  let rounds = 0;
  let stopReason = `达到轮次上限 ${maxRounds}`;
  let emptyPages = 0;
  /**
   * ⭐⭐ 快速增量的三个计数 —— 「追上了没有」全靠它们回答。
   * ⚠️ `knownRun` 记的是**连续**串(见到新人就清零),不是累计:
   * 一页里夹几个已知的很正常,连续几十个才说明翻进老区了。
   */
  const known = opts.knownHandles;
  const fastMode = !!known && known.size > 0;
  let knownSeen = 0;
  let knownRun = 0;
  let caughtUp = false;
  /** ⭐ 翻页没启动的原因 —— 空表示启动了 */
  let pagingSkipped: string | undefined;
  /**
   * ⭐ 这一趟点开了几个「Show more」—— 进报告,让「有没有真的展开」看得见。
   * ⚠️ 0 有两种含义:这一页本来就没有折叠的,或者**按钮没找到**(X 改了结构)。
   * 两者要靠「有没有 incomplete」区分,所以两个数都要报。
   */
  let domExpanded = 0;
  /** ⭐ 翻页失败时真正发出去的那条 URL —— 不给它就只能猜 */
  let failedUrl: string | undefined;
  /**
   * ⭐⭐ 翻页失败的**判据**:status / content-type / 实际 method / 响应体开头。
   * ⚠️ 只有 URL 还不够 —— 「抄错请求 / 游标换坏 / queryId 过期」三种成因
   * 要靠 content-type 与 body 才分得开(实测:404+非JSON = 没进 handler)。
   */
  let failedProbe: {
    status?: number; ctype?: string; method?: string; bodyHead?: string;
  } | undefined;
  /**
   * ⭐ 这一趟翻页是不是**靠改 POST 形状才成功的**。
   *
   * ⚠️ 这是**成功路径的判据**:不记的话现象只是「翻页好了」,
   * 而「GET 现在不行了」这个事实会随着这一跑一起消失 ——
   * 下次 X 再动接口,又得从 404 从头查一遍。
   */
  let shapeSwitched = false;

  for (let i = 1; i <= maxRounds; i++) {
    /**
     * ⚠️⚠️ **人按了停** —— 用户 2026-09-22:「是否有一个暂停操作键?」
     * ⭐ 停 = 「到此为止,把已有的收好」:已采到的照常入库、照常落留痕,
     *    但 stopReason 必须写明**是人停的**,不能和「采完了」长得一样。
     */
    if (isAborted(opts.wsId)) {
      stopReason = `⏸ 人工停止(滚了 ${rounds} 轮,已采 ${tweets.size} 条 / ${people.size} 人)`
        + ' —— **不是采完了**';
      break;
    }
    rounds = i;
    const before = tweets.size;
    const peopleBeforeRound = people.size;

    // 同步滚动(**不用 smooth**:它是异步的,会让紧接着的回读全是旧值)
    const step = 0.55 + Math.random() * 0.3;
    await wc.executeJavaScript(`(function () {
      var y = window.scrollY;
      window.scrollBy(0, window.innerHeight * ${step.toFixed(3)});
      if (window.scrollY === y) {
        var all = document.querySelectorAll('div');
        for (var i = 0; i < all.length; i++) {
          var el = all[i];
          if (el.scrollHeight > el.clientHeight + 400) {
            el.scrollTop = el.scrollTop + el.clientHeight * ${step.toFixed(3)};
            break;
          }
        }
      }
    })()`).catch(() => {});

    // 随机停顿:匀速请求是风控最容易识别的特征
    await new Promise((r) => setTimeout(r, 1800 + Math.random() * 1500));

    /**
     * ⭐⭐⭐ **像人一样把这一屏读完** —— 用户 2026-09-22 定的原则:
     *
     * > 「不管长文短文,如果折叠起来就应该 show all,然后获取完整的内容,就像人一样,
     * >   但是现在却是分的零碎,却无法获取完整的内容。」
     *
     * ── 为什么非有这一步不可(两个实测) ──
     *
     * ① **折叠的推只渲染开头**:`[data-testid="tweetText"]` 里剩下的正文
     *    **压根没进 DOM**,不点开就永远只拿到截断版。
     * ② **页面已加载就没有载荷可截**:2026-09-22 实测同一个 URL 采到 **0 条** ——
     *    前两趟有 10 个载荷(新导航触发),这趟只有 2 个杂项载荷,
     *    而页面上 4 篇长文卡片**明明就摆在那儿**。
     *    ⚠️ 只截网络请求 = 只看得见「这一刻飞过什么」,看不见「页面上有什么」。
     *
     * ⭐ 所以:**先点开折叠,再从 DOM 读**。载荷仍然照收(它有 DOM 拿不到的字段:
     * conversation_id / in_reply_to 等),两边合并 —— 谁字段多谁留下。
     *
     * ⚠️ DOM 读出来的标 `fromDom`,下游据此知道「has_media 之类不可信」
     * (见 x-article-replies 的 toContractItems)。
     */
    const domRead = await wc.executeJavaScript(`(function () {
      ${TWEET_SCRAPE_FN_BODY}
      var out = [];
      var expanded = 0;
      var arts = document.querySelectorAll('article[data-testid="tweet"]');
      for (var i = 0; i < arts.length; i++) {
        var art = arts[i];
        // ⭐ 先展开再读 —— 顺序反了就还是读到截断版
        try { expanded += expandTweetText(art); } catch (e) {}
        var t = art.querySelector('time');
        var a = t && t.closest('a[href*="/status/"]');
        if (!a) continue;
        var m = (a.getAttribute('href') || '').match(/status\\/(\\d+)/);
        if (!m) continue;
        var d = {};
        try { d = scrapeTweetArticle(art) || {}; } catch (e) { continue; }
        out.push({
          tweetId: m[1],
          authorHandle: d.authorHandle || '',
          authorName: d.authorName || '',
          authorAvatar: d.authorAvatar || '',
          /** ⚠️ **不截断** —— 展开之后 textContent 就是全文 */
          text: d.text || '',
          createdAt: d.createdAt || (t ? (t.getAttribute('datetime') || '') : ''),
          lang: d.lang || '',
          tweetUrl: d.tweetUrl || '',
          inReplyToScreenName: d.inReplyToUser || '',
          metrics: d.metrics || {},
          hasMedia: !!(d.media && d.media.length),
          /**
           * ⭐⭐ **这张卡片是长文(Article)吗** —— 2026-09-23 加。
           *
           * ⚠️ 长文卡片**没有 tweetText 这个 testid**(显示的是封面图 + 标题),
           * 所以正文必然读不到 —— 但**必须认出它是长文**,
           * 否则补正文那一步拿不到候选,这篇就永远补不上了。
           *
           * ⭐ 判据用 X 自己的结构:长文卡片里有指向 /i/article/ 的链接。
           * **不认标题文字**(会随语言变)。
           * ⚠️ 本注释在**模板字面量内部**,绝不能出现反引号 —— 它会提前终止字符串
           * (2026-09-22 在 tweet-inbox-repo 栽过同一个坑)。
           */
          isArticle: !!(art.querySelector('a[href*="/i/article/"]')
            || art.querySelector('[data-testid="card.layoutLarge.media"] + div a[href*="/status/"][role="link"] span'))
        });
      }
      return { items: out, expanded: expanded };
    })()`).catch(() => ({ items: [], expanded: 0 }));

    /**
     * ⚠️ 展开会触发 X 重新渲染/发请求,给它一点时间落地 ——
     * 不等的话这一轮读到的仍是旧内容(下一轮才对,等于白展开一轮)。
     */
    if (domRead?.expanded > 0) {
      domExpanded += domRead.expanded;
      await new Promise((r) => setTimeout(r, 700));
    }
    mergeDomTweets(domRead?.items ?? [], tweets);

    // **滚动之后**回读 —— 这才是真实状态
    /**
     * ⭐⭐ **回读要看对元素** —— 2026-09-19 用户指出的开环缺陷。
     *
     * 原来只数 `article[data-testid="tweet"]`(推文卡片),
     * 而**采人页用的是 `UserCell`** → 采关注者时这个数**恒为 0**,
     * 等于「执行了但没在看结果」。
     *
     * ⭐ 用户原话:「要把函数做的健壮,就必须是正反馈的 ——
     * 执行没有?执行结果是什么?能够执行下一步了吗?」
     * 两种都数,哪种有就用哪种。
     */
    const st = await wc.executeJavaScript(`(function () {
      var cells = document.querySelectorAll('[data-testid="UserCell"]').length;
      var arts = document.querySelectorAll('article[data-testid="tweet"]').length;
      return { y: window.scrollY,
        docH: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
        arts: arts, cells: cells,
        /** ⭐ 滚动容器的实际位置 —— X 有时滚的不是 window 而是内层 div */
        inner: (function () {
          var all = document.querySelectorAll('div');
          for (var i = 0; i < all.length; i++) {
            var el = all[i];
            if (el.scrollHeight > el.clientHeight + 400) {
              return { top: el.scrollTop, h: el.scrollHeight };
            }
          }
          return null;
        })(),
      };
    })()`).catch(() => null) as {
      y: number; docH: number; arts: number; cells: number;
      inner: { top: number; h: number } | null;
    } | null;

    /**
     * ⭐ 「滚动了没有」的判据:**window 或内层容器,任一前进即算前进**。
     * ⚠️ 只看 window.scrollY 时,X 用内层 div 滚动的页面会被误判成「卡住」。
     */
    const y = st?.y ?? -1;
    const innerTop = st?.inner?.top ?? -1;
    const posKey = `${y}|${innerTop}`;
    if (posKey === lastPosKey) stuck++; else stuck = 0;
    lastPosKey = posKey;
    lastY = y;

    const peopleNow = people.size;
    trace.push({
      round: i, scrollY: y, docHeight: st?.docH ?? -1, domArticles: st?.arts ?? -1,
      cumulative: tweets.size, newThisRound: tweets.size - before, stuck,
    });
    /**
     * ⭐⭐ **每轮落盘** —— 用户 2026-09-19 指出:
     * 「究竟滚动没有、滚动多少次你都不知道,这不是一个缺陷吗?」
     *
     * trace 只回到面板给人看,排查时查不到 → 我今天为此猜了五次全错。
     * 落一行到文件,「滚没滚、滚了几轮、每轮有没有收获」变成**可查的事实**。
     */
    try {
      const { appendFileSync: afs } = await import('node:fs');
      afs('/tmp/x-scroll.log', JSON.stringify({
        t: new Date().toISOString().slice(11, 19),
        轮: i, y, 内层: innerTop, 卡住: stuck,
        DOM卡片: st?.cells ?? -1, DOM推文: st?.arts ?? -1,
        累计人: peopleNow, 本轮新增人: peopleNow - peopleBeforeRound,
        累计推: tweets.size,
      }) + '\n', 'utf8');
    } catch { /* 诊断不影响主流程 */ }

    /**
     * ⭐⭐ **快速增量:滚到够用就走** —— 不再滚到底。
     *
     * ── 滚动在快速模式里的唯一职责 ──
     *
     * 让 X **自己发一次 Followers 请求**,好让我们抄到 URL + 请求头
     * (queryId/features 会随版本变,复刻必然过期 —— 见 withCursor 注释)。
     * 抄到了,滚动就没用了:后面全靠游标翻页,一页 50-100 人,比滚快几十倍。
     *
     * ⚠️ 全量模式**一轮都不能少**(它要靠滚动把整个列表拉出来),
     * 所以这条只在 `fastMode` 下成立。
     *
     * ⭐ 判据是**抄到请求了吗**(数据),不是「滚够 N 轮了吗」(猜)——
     * 抄不到就继续滚,而不是到点硬走。
     */
    if (fastMode && lastPeopleReq && people.size > 0) {
      stopReason = `快速增量:已抄到请求模板(滚了 ${i} 轮,${people.size} 人),转游标翻页`;
      break;
    }

    // 全量回补可能跑 40 分钟 —— 没有进度反馈的长任务等于黑箱,
    // 用户无从判断「还在跑」与「卡死了」。每 5 轮播报一次。
    if (i % 5 === 0 || stuck > 0) {
      const times = [...tweets.values()].map((t) => t.createdAt).filter(Boolean) as string[];
      const oldest = times.length
        ? times.reduce((a, b) => (new Date(a) < new Date(b) ? a : b)) : undefined;
      const progress = {
        url, round: i, maxRounds, captured: tweets.size,
        payloads, scrollY: y, stuck,
        oldest: oldest ? oldest.slice(0, 24) : undefined,
      };
      for (const w of allWebContents.getAllWebContents()) {
        if (w.isDestroyed()) continue;
        try { w.send(IPC_CHANNELS.X_HARVEST_PROGRESS, progress); } catch { /* 已销毁 */ }
      }
      if (i % 25 === 0) {
        console.log(`[harvest] 轮${i}/${maxRounds} y=${y} 累计=${tweets.size} `
          + `响应=${payloads} 最旧=${oldest ?? '?'}`);
      }
    }

    // **只有真的滚不动才算到底**(连续 3 轮位置没变)。
    // 「没有新数据」不作数 —— 时间线里夹着别人的推很正常。
    // ⚠️ 深处加载明显变慢(X 的懒加载在几百轮后经常要等好几秒),
    //    3 轮不变就判定到底会**提前截断**。放宽到 8 轮,并在中途多等一会儿,
    //    给懒加载留出补货时间 —— 宁可多花几十秒,不可漏掉整段历史。
    if (stuck > 0 && stuck % 3 === 0) {
      await new Promise((r) => setTimeout(r, 3000));   // 卡住时额外等待,催一催懒加载
    }
    /**
     * ⭐⭐ **滚不动就换个位置**,不是干等到 8 轮然后放弃。
     *
     * ── 用户 2026-09-19 ──
     * > 「如果校验发现没有滚动就往下一个位置去采集数据。
     * >   这样才对吧,而不是盲目采集直到出问题都不懂」
     *
     * ⚠️ X 的列表是**虚拟列表**:滚过去的 DOM 会被删掉,
     * 「滚不动」常常不是到底了,而是**新内容还没渲染**。
     * 原来只会 stuck++ 数到 8 就退出 —— 那正是采到 250 就停的形态。
     *
     * ⭐ 换位置用 `scrollIntoView` 跳到**最后一个卡片**:
     * 这会强制虚拟列表渲染它后面的内容,比盲目 scrollBy 可靠。
     */
    if (stuck >= 2) {
      await wc.executeJavaScript(`(function () {
        var cells = document.querySelectorAll('[data-testid="UserCell"]');
        var last = cells[cells.length - 1];
        if (last && last.scrollIntoView) {
          last.scrollIntoView({ block: 'end' });
          return true;
        }
        var el = document.scrollingElement || document.documentElement;
        el.scrollTop = el.scrollHeight;
        return false;
      })()`).catch(() => null);
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (stuck >= 8) { stopReason = `滚到底(连续 ${stuck} 轮 scrollY=${y} 未变)`; break; }

    /**
     * ⭐⭐ **采到底就停 —— 由数据说了算,不由人预先猜轮数**。
     *
     * ── 用户 2026-09-19 定的原则 ──
     * > 「这种不智能、没有正反馈、没有验证的方法是不可取的,
     * >   我们在爬取数据时必须有判断--执行--再判断--再执行这样的 PDCA 环。」
     *
     * ── 为什么非改不可(实测)──
     * · 30 轮 → 250 人;400 轮 → 2462 人;600 轮 → 2484 人
     * · 600 轮那跑:轮 341 拿到最后 42 人,之后 **259 轮零新增**
     *   —— **43% 的时间在空转**,而程序毫不知情,傻跑到轮数上限。
     * · 更糟的是「该填多少轮」要人去查表估算,换个账号/网速就不准。
     *
     * ── 判据 ──
     * X 每页给 50 人,约 6-7 轮触发一次。所以「连续 N 轮零新增」中
     * **N 必须远大于 7**,否则会在两页之间的正常间隔里误停。
     * 取 40:约等于 6 个正常页间隔,实测尾部空转 259 轮,不会误判。
     *
     * ⚠️ 这条**和 stuck(滚不动)是两回事**:
     * · stuck    = 位置不动了(页面层面到底)
     * · 零新增   = 位置在动但 X 不再给数据(数据层面到底)
     * 实测 600 轮那跑 stuck 一直是 0/1,**只有零新增能发现到底**。
     */
    if (peopleNow > 0 && peopleNow === lastPeopleCount) {
      noGainRounds++;
      if (noGainRounds >= NO_GAIN_LIMIT) {
        stopReason = `采到底(连续 ${noGainRounds} 轮没有新数据,共 ${peopleNow} 人,`
          + `滚了 ${i} 轮)—— X 不再给新内容`;
        break;
      }
    } else {
      noGainRounds = 0;
      lastPeopleCount = peopleNow;
    }

    // 时间预算到点:返回已抓到的部分(契约要求宁可 partial 也不干等)
    if (opts.budgetMs && Date.now() - startedAt >= opts.budgetMs) {
      stopReason = `budget 用尽(${opts.budgetMs}ms,已抓 ${tweets.size} 条)`;
      break;
    }
    // hint 命中:不必把整个评论区抓完
    if (opts.stopWhen) {
      const hit = [...tweets.values()].find(opts.stopWhen);
      if (hit) { stopReason = `hint 命中(${hit.tweetId}),提前结束`; break; }
    }
  }

  /**
   * ⭐⭐ **游标翻页** —— 滚动之后接着用,直到 X 说没有了。
   *
   * ── 用户 2026-09-18 拍板 ──
   *
   * > 「① 用游标直接翻页 —— 不滚动,直接重放 GraphQL 请求带 cursor。
   * >   快几十倍。可以使用这个方法」
   *
   * 实测滚动 30 轮 / 76 秒只拿到 **201/2604 = 7.7%**,且只触发 4 个载荷 ——
   * 时间全花在滚动动画和虚拟列表渲染上。而 X 的分页本来就是游标式的,
   * 一次请求给 50-100 人。
   *
   * ⭐ **滚动仍然要跑**,它不是被替换掉了 —— 它的作用变成
   * 「让 X 自己发一次请求,好让我们抄到 URL 和请求头」。
   * 没有这一步就得复刻 queryId/features(`x-article-replies.ts:285` 的教训),
   * 那正是我们要绕开的。
   *
   * ⚠️ 只在**采人的页面**上翻(paging.bottom 有值 && 采到过人)。
   * 推文页的游标语义不同,没验证过,不顺手捎带。
   */
  let pagedRounds = 0;
  /**
   * ⭐⭐ **进不去也要说清是哪一条不成立**。
   *
   * ── 用户 2026-09-18 实测 ──
   *
   * 翻页上线后实采 314 人 / 2604 基准 = 12%,只比滚动多 113 人 ——
   * 「快几十倍」没有发生。而四个入口条件写成一个 `if`,
   * 不成立时**静默跳过**,报告里只剩「采了 314 人然后停了」,
   * 四种断法长得一模一样,根本无从查起。
   *
   * ⚠️ 这正是本仓反复踩的「看着成功实际没有」:
   * 没翻页和翻完了,在报告里是同一个样子。
   */
  /**
   * ⚠️ **先钉住**这条请求 —— `lastPeopleReq` 是闭包里被监听器改写的变量,
   * 循环中途可能被别的请求覆盖,那样翻页会跑到另一个列表上去
   * (而人照样入库,看不出来)。
   */
  /**
   * ⚠️ 经函数读取 —— 直接读 `lastPeopleReq`,TS 的控制流分析会认定它
   * 「至今仍是 null」(唯一的赋值在监听器回调里,TS 排不出先后)而收窄成
   * `never`。这不是类型体操,是**它确实无法证明**回调已经跑过。
   */
  const baseReq = ((): {
    url: string; headers: Record<string, string>; method?: string;
  } | null => lastPeopleReq)();

  /**
   * ⭐⭐ **快速增量的「再判断」** —— 每拿到一批人就回读:追上了没有?
   *
   * ⚠️ 必须按**列表顺序**逐个看,不能只统计「这批里已知的占比」——
   * 「连续 30 个已知」与「50 个里散着 30 个已知」含义完全不同:
   * 前者说明翻进老区了,后者说明还在新旧交界处。
   *
   * @param batch 这一批新解出来的人,**按载荷里的出现顺序**
   * @returns 追上了吗
   */
  const measureKnown = (batch: HarvestedPerson[]): boolean => {
    if (!known) return false;
    for (const p of batch) {
      if (known.has(p.handle)) {
        knownSeen++;
        knownRun++;
        if (knownRun >= KNOWN_RUN_LIMIT) { caughtUp = true; return true; }
      } else {
        // ⭐ 见到新人就**清零** —— 记的是连续串,不是累计
        knownRun = 0;
      }
    }
    return false;
  };

  /**
   * ⭐ 滚动阶段拿到的第一批人也要过判据 —— 小号(新人少于一页)
   * 可能**滚动阶段就已经追上**,那时一页都不用翻。
   */
  if (fastMode && people.size > 0) {
    if (measureKnown([...people.values()])) {
      stopReason = `快速增量:滚动阶段就追上了(连续 ${knownRun} 个已知的人,`
        + `共 ${people.size} 人)—— 一页都不用翻`;
    }
  }
  /**
   * ⚠️⚠️ **判据是「这页采到数据」,不是「这页采到人」** —— 2026-09-22 同一刀的第二处。
   *
   * 原来写 `people.size > 0`,那是「只在采人的页面翻页」留下的假设。
   * 长文页那趟**碰巧**成立(采到 1 个人 = 作者本人),纯推文页就会卡死 ——
   * 而且卡得毫无道理:明明采到了 50 条推,却因为「没采到人」不给翻页。
   * ⭐ 翻页要的是「这一页确实有数据、值得往下翻」,人和推都算数。
   */
  const gotData = people.size > 0 || tweets.size > 0;
  const gate = {
    抄到请求: !!baseReq,
    X说还有下一页: paging.hasMore,
    有游标: !!paging.bottom,
    这页采到数据: gotData,
  };
  const blocked = Object.entries(gate).filter(([, ok]) => !ok).map(([k]) => k);
  if (blocked.length > 0) {
    /** ⭐ 如实记下**为什么没翻**,不是不提 */
    pagingSkipped = `游标翻页没启动 —— ${blocked.join('、')}(不成立)`;
  }
  if (baseReq && paging.hasMore && paging.bottom && gotData && !caughtUp) {
    const budget = opts.pageBudget ?? 40;
    const seenCursors = new Set<string>();
    while (pagedRounds < budget && paging.hasMore && paging.bottom && !caughtUp) {
      /** ⚠️ 翻页同样要能停 —— 一页 50-100 条,翻满 40 页也是好几分钟 */
      if (isAborted(opts.wsId)) {
        stopReason = `⏸ 人工停止(翻了 ${pagedRounds} 页,已采 ${tweets.size} 条 / `
          + `${people.size} 人)—— **不是采完了**`;
        break;
      }
      const cursor = paging.bottom;
      /**
       * ⚠️ **游标没变就停**。
       *
       * 这是本实现最危险的失败形态:`variables` 换错了、或者 X 忽略了我们的
       * 游标,响应会是**第 1 页**,于是解析出的还是那批人(Map 去重后 size 不变),
       * 循环却会一直跑下去 —— 看上去在工作,实际原地打转 40 轮。
       * 游标重复 = 没翻动,立刻停并**如实记下**。
       */
      if (seenCursors.has(cursor)) {
        stopReason = `游标翻页:游标重复(${cursor.slice(0, 24)}…)—— 没有真的翻动,已停`;
        break;
      }
      seenCursors.add(cursor);

      const nextUrl = withCursor(baseReq.url, cursor);
      if (!nextUrl) {
        stopReason = '游标翻页:URL 里的 variables 解不开 —— 没有猜着改,已停';
        break;
      }

      let body: string;
      try {
        const res = await wc.executeJavaScript(
          buildRefetchScript(nextUrl, baseReq.headers, baseReq.method), true,
        ) as {
          __body?: string; __err?: string;
          __status?: number; __ctype?: string; __bodyHead?: string; __method?: string;
          /** ⭐ GET 被 404-未路由挡下、改 POST 形状救回来了 */
          __shapeSwitched?: boolean;
        };
        /**
         * ⭐⭐ **「换了形状才成功」要留痕** —— 成功路径也要留痕(铁律,
         * 见记忆 feedback-maintainability-over-feature-completion)。
         *
         * ⚠️ 不留的话现象是「翻页好了」,而**为什么好的没人知道**:
         * 下次 X 再改回去,又要从头查一遍 404。
         */
        if (res?.__shapeSwitched && !shapeSwitched) {
          shapeSwitched = true;
          console.info('[x-timeline-harvester] 游标翻页:GET 被 404 挡下,改 POST 形状成功');
        }
        if (res?.__err) {
          /**
           * ⭐⭐ 404 时**把真正发出去的 URL 交出来**。
           *
           * ⚠️ 用户 2026-09-18 连着两跑都是 404,而我两次都在**猜**是哪一环 ——
           * 因为报告里只有「请求失败(404)」,没有那条 URL。
           * 抄错了请求、游标换坏了、queryId 过期,三种成因在这句话里
           * 长得一模一样,**不给 URL 就查不下去**(别猜、看真实数据)。
           */
          failedUrl = nextUrl;
          /**
           * ⭐⭐ **把三种成因的判据写进停止原因** —— 2026-09-25 补。
           *
           * ⚠️ 只说「请求失败(404)」时,「抄错请求 / 游标换坏 / queryId 过期」
           * 三种成因**长得一模一样**(下面那段注释早就写着),查不下去。
           * ⭐ 判据(实测出来的,见 project-x-cursor-paging):
           *  · **404 + 非 JSON + 空 body** = 请求根本没进 GraphQL handler
           *    → 多半是 **method 不对**(followers 那次真因就是必须用 POST)
           *  · 404 + JSON(带 errors[]) = 进了 handler,是业务错误(游标/queryId)
           */
          failedProbe = {
            status: res.__status, ctype: res.__ctype,
            method: res.__method, bodyHead: res.__bodyHead,
          };
          const looksUnrouted = !!res.__ctype && !/json/i.test(res.__ctype);
          stopReason = `游标翻页:请求失败(${res.__err}`
            + `,method=${res.__method ?? '?'},content-type=${res.__ctype ?? '?'}`
            + (looksUnrouted
              ? ' —— **非 JSON,请求多半没进 GraphQL handler(先查 method)**'
              : '')
            + ')';
          break;
        }
        if (!res?.__body) { stopReason = '游标翻页:响应是空的'; break; }
        body = res.__body;
      } catch (e) {
        stopReason = `游标翻页:注入失败(${String(e)})`;
        break;
      }

      pagedRounds++;
      payloads++;
      const peopleBefore = people.size;
      /**
       * ⚠️⚠️ **推文数也要记** —— 2026-09-22 同一刀的第三处。
       * 下面的「连续 3 页没收获就停」原来**只数人**,那是「只给采人页翻页」
       * 留下的假设。长文/推文页每页的作者是同一个人,人数根本不会涨 →
       * **翻 3 页必停**,而推文其实一直在增加。
       */
      const tweetsBefore = tweets.size;
      try {
        const parsed = JSON.parse(body);
        /**
         * ⭐⭐ **这一页单独解一份** —— 快速增量的判据要按「这页的顺序」看。
         *
         * ⚠️ 不能拿累计的 `people` 算:它是 Map,已见过的人**不会再出现**,
         * 于是「这页有几个已知的」永远是 0 —— 判据恒不成立,
         * 快速增量会一路翻到闸门为止(现象:比全量还慢,而且看不出原因)。
         * 这正是本仓「回读看错元素」那类开环缺陷(采人页数 tweet 恒为 0)。
         */
        entriesSeen += countTimelineEntries(parsed);
        const pagePeople = new Map<string, HarvestedPerson>();
        extractPeopleFrom(parsed, pagePeople);
        if (fastMode && measureKnown([...pagePeople.values()])) {
          stopReason = `快速增量:追上了(连续 ${knownRun} 个已知的人,`
            + `翻了 ${pagedRounds} 页,共 ${people.size + pagePeople.size} 人)`;
        }
        // ⭐ 再并进累计表(沿用「谁字段多谁留下」的去重规则)
        extractPeopleFrom(parsed, people);
        extractTweetsFrom(parsed, tweets);
        const cur = findPagingCursor(parsed);
        // ⚠️ 拿不到新游标就当**到底了**,不拿旧的再试一次(那必然是原地打转)
        paging = (cur.bottom || cur.top) ? cur : { hasMore: false };
      } catch {
        stopReason = '游标翻页:响应不是 JSON';
        break;
      }
      seenOps.push({ op: `翻页#${pagedRounds}`, bytes: body.length });

      /**
       * ⚠️ 翻了一页但**一个人都没多** —— 可能是这一页全是已见过的人
       * (正常),也可能是响应根本没人(不正常)。不臆断,继续翻,
       * 但连着 3 页都没新人就停:再翻也是白费。
       */
      if (people.size === peopleBefore && tweets.size === tweetsBefore) {
        emptyPages++;
        if (emptyPages >= 3) {
          /**
           * ⚠️ 快速增量下**同一个现象含义相反**:整页都是已知的人时
           * 累计表确实一个都不多,但那是「追上了」(好事),
           * 不是「X 不给数据了」(坏事)。两者停的理由必须分开写,
           * 否则报告会把成功说成失败 —— 而人是照着停止原因判断要不要重跑的。
           */
          stopReason = fastMode
            ? `快速增量:连续 3 页全是已知的人(连续 ${knownRun} 个)—— 已在老区,停`
            : `游标翻页:连续 3 页没有新数据(已 ${people.size} 人 / ${tweets.size} 条推)`;
          if (fastMode) caughtUp = true;
          break;
        }
      } else emptyPages = 0;

      if (!paging.hasMore) {
        stopReason = `游标翻页:X 说没有更多了(共翻 ${pagedRounds} 页,`
          + `${people.size} 人 / ${tweets.size} 条推)`;
      }
    }
    if (paging.hasMore && pagedRounds >= (opts.pageBudget ?? 40)) {
      stopReason = `游标翻页:达到翻页上限 ${opts.pageBudget ?? 40} 页(`
        + `${people.size} 人 / ${tweets.size} 条推,还有更多)`;
    }
  }

  /** ⭐ 只退订 —— **绝不 detach**,别的模块(如抓 bio)还在用同一条通道 */
  unsubscribe();
  const list = [...tweets.values()];
  const dateSpan = analyseDates(list);

  // ── 校验:任何一条不过都记进 problems,不粉饰 ──────────────────
  /**
   * ⭐⭐ `problems` 只报**采集链路自身坏了**,不报「数据质量」。
   *
   * ── 用户 2026-09-18 定的边界 ──
   *
   * > 「我觉得我们应该忠实于页面能够获取的信息,分析数据是另外一个主题了。」
   *
   * ⚠️ 此前这里混进了两条**判断**,而且有一条判错了:
   *
   *  · 「日期有 N 处空洞(**可能漏采**)」—— 实测 x.home 报出
   *    `2024-09-18 → 2026-08-03(684天)`。那不是漏采:**首页是算法混排**,
   *    会把两年前的热门推塞进来。空洞检测建立在「时间连续」假设上,
   *    而首页根本不满足这个假设 → 对首页恒为噪音,还会掩盖真问题。
   *
   *  · 「达到轮次上限仍未滚到底 —— **结果不完整**」—— 「不完整」是判断。
   *    事实只是「滚了 30 轮,停在轮次上限」,那本来就在 `stopReason` 里。
   *
   * ⭐ 采集层的职责:**页面上有什么,忠实地拿下来,并如实说明拿的过程**。
   * 「够不够、有没有漏」是分析层拿着 `dateSpan`/`stopReason`/`rounds` 自己判断的事。
   */
  const problems: string[] = [];
  /**
   * ⚠️ **通道故障要进 problems** —— 它与「这页真没数据」是两回事。
   * 旧实现 attach 失败只 catch 一下就继续,订阅者安静等一个永不来的载荷,
   * 现象是「采集突然变 0」而**不报错**。
   */
  if (channelFault) problems.push(`CDP 通道故障:${channelFault} —— 采到的数据可能不全`);
  const maxY = Math.max(...trace.map((t) => t.scrollY), 0);
  // 以下三条都是**采集链路真的坏了**,不是数据质量判断
  /**
   * ⭐⭐ **没追上就停了 = 采集链路没干完活**,必须报 problems。
   *
   * ── 为什么这条必须响 ──
   *
   * 快速增量停下来有两种:「追上了」(新人翻完了,结果可信)和
   * 「撞上闸门/请求失败」(新人可能还没翻完)。两者在报告里
   * **长得一模一样** —— 都是「采到 N 人」。
   * 而人会照着这个数字下结论「这段时间就来了 3 个新粉」。
   *
   * ⚠️ 这正是本仓反复踩的「看着成功实际没有」形态(邮件模块 5 个 bug
   * 同一形态、导入空白却谎报成功)。铁律一:失败要响。
   */
  if (fastMode && !caughtUp) {
    problems.push(
      `快速增量**没追上上次的名单**(连续已知最多 ${knownRun}/${KNOWN_RUN_LIMIT},`
      + `翻了 ${pagedRounds} 页)—— 新人可能还没翻完,`
      + `这个数字**不能当成「这段时间的全部新增」**。停止原因:${stopReason}`,
    );
  }
  if (maxY <= 0) problems.push('页面从未滚动(scrollY 始终为 0)—— 滚动没生效');
  if (payloads === 0) problems.push('没捕获到任何 GraphQL 响应 —— CDP 可能没挂上');
  if (list.length === 0) problems.push('一条推文都没解析出来');

  /**
   * ⭐⭐ 最新一条的**精确时间** —— 搜索水位用。
   * ⚠️ 不能用 `dateSpan.newest`,那个是按天聚合的(实测踩过:
   * 20:38:55 被存成 00:00:00,下次窗口平白多退一整天)。
   */
  const newestAt = list
    .map((t) => t.createdAt).filter(Boolean)
    .reduce<string | undefined>(
      (max, d) => (!max || String(d) > max ? String(d) : max), undefined,
    );

  return {
    url, ok: problems.length === 0, problems,
    rounds, payloads, tweets: list, dateSpan, newestAt, stopReason, trace,
    unparsedSamples, seenOps,
    people: [...people.values()],
    paging,
    /** ⭐ 游标翻了几页 —— 0 表示只靠滚动 */
    pagedRounds,
    /**
     * ⭐⭐ 解析率 —— 分子是**去重后**的推 + 人。
     *
     * ⚠️ 去重后的数**可能小于条目数**,而那是正常的:
     * 同一个人/同一条推在多个载荷里重复出现(滚动时 X 会重发前面的内容)。
     * 所以 rate < 1 **不一定是漏**,要结合 stopReason 一起看 ——
     * 这条在报告的判词里说清楚,不让人误读成「漏了 N 条」。
     */
    /**
     * ⭐⭐ 解析率 —— **分子分母必须同口径**。
     *
     * ⚠️⚠️ 2026-09-20 实测暴露:原来分子写 `tweets.size + people.size`,
     * 而分母数的是「条目」—— 一条推的 entry 里,**推算一次、它的作者又算一次**,
     * 于是详情页报出 **200%**。比例超过 100% 本身就荒谬,
     * 说明这个指标当时**设计就是错的**,不是数值偏差。
     *
     * ⭐ 改法:分子取**两者的较大值**,不是相加 ——
     * 一个条目产出「一条推」或「一个人」,推文页的作者是那条推的附属,
     * 不该再算一个条目。
     * · 人的列表页:people 大 → 分子 = 人数
     * · 推文页    :tweets 大 → 分子 = 推数(作者不重复计)
     *
     * ⚠️ 仍可能 >100%(同一条目里嵌了多个对象,如引用推),
     * 但那是少数;而原来的相加是**系统性**翻倍。
     */
    parseRate: {
      entries: entriesSeen,
      parsed: Math.max(tweets.size, people.size),
      rate: entriesSeen > 0
        ? Math.max(tweets.size, people.size) / entriesSeen : undefined,
    },
    /** ⭐ 快速增量的闭环回读 —— 「追上了没有」由数据回答 */
    fastIncremental: fastMode
      ? { knownBaseline: known?.size ?? 0, knownSeen, knownRun, caughtUp }
      : undefined,
    pagingSkipped,
    domExpanded,
    failedUrl,
    failedProbe,
    /** ⭐ 成功路径的判据:翻页是不是靠改 POST 形状才成的 */
    shapeSwitched,
    /** ⭐ 供游标翻页重发用 —— 复用 X 刚发过的请求,不自己拼 */
    lastRequest: lastPeopleReq ?? undefined,
  };
}
