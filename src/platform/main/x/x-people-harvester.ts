/**
 * ⭐⭐ 「采人」—— 从载荷里抽**人的列表**(关注者 / 关注中 / 验证关注者)
 *
 * ── 用户 2026-09-18 ──
 *
 * 在 `x.com/otun_myvpn/verified_followers` 采集,实测截到 **12 个
 * `BlueVerifiedFollowers` 载荷、每个约 40KB** —— 那就是人的列表。
 * 而 `extractTweetsFrom` 只认带 `legacy.id_str` 的**推文**对象,
 * 会把这些整个跳过,于是报 0 条。
 *
 * ⭐ 「采人」与「采推」是两种采集:
 *
 * |        | 采推 | 采人 |
 * |---|---|---|
 * | 载荷   | HomeTimeline / UserTweets | Followers / BlueVerifiedFollowers / Following |
 * | 产出   | `x_tweet` 行 | **`x_author` 行** |
 * | 字段   | metrics / conversationId / … | **bio / 粉丝数 / 关系** |
 *
 * ⭐ 它正是盘点缺口的正解:bio 与关系覆盖率此前只有 **2%**,
 * 因为唯一的路是「导航到每个人主页 + 等 12 秒」。
 * 关注列表一次采全,覆盖率直接拉满。
 *
 * ── ⚠️ 不写死嵌套路径 ──
 *
 * 与 `x-author-profile.ts` 的 `findUserResult` 同一手法:**按特征递归找**。
 * 理由那边写着:「X 的响应外层结构变过好几次,写死路径会在改版后
 * **静默取不到**(返回 undefined 而不报错)」。
 * 所以这里也不认 `data.user.result.timeline.instructions[...]` 那种路径,
 * 只认「带 screen_name 的对象」。
 */

import { normalizeHandle } from '@shared/types/x-timeline-types';

/** 一个采到的人 —— 字段与 `AuthorCounts` 对齐,便于直接入库 */
export interface HarvestedPerson {
  handle: string;
  restId?: string;
  displayName?: string;
  bio?: string;
  avatar?: string;
  followersCount?: number;
  followingCount?: number;
  tweetCount?: number;
  isBlueVerified?: boolean;
  /** 我与此人的关系 —— 载荷自带,零额外请求 */
  iFollow?: boolean;
  followsMe?: boolean;
  /** X 上的真实拉黑(与本 app 的屏蔽意志不是一回事) */
  xBlocking?: boolean;
  accountCreatedAt?: string;
  location?: string;
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v : undefined;

/** 明确的 true/false 才给值;字段不在就 undefined(「没查」≠「查过是 false」) */
const bool = (...vs: unknown[]): boolean | undefined => {
  for (const v of vs) if (v === true) return true;
  for (const v of vs) if (v === false) return false;
  return undefined;
};

/**
 * 把一个「像 user 的对象」解析成人。
 *
 * ⚠️ 新旧两种形态都试(与 `x-author-profile.ts:82` 同口径):
 * 新形态在 `core` / `profile_bio` / `relationship_counts`,旧形态全在 `legacy`。
 * 只读一种会在 X 改版后**静默少字段**。
 */
export function parsePerson(o: Record<string, unknown>): HarvestedPerson | null {
  const core = (o.core ?? {}) as Record<string, unknown>;
  const legacy = (o.legacy ?? {}) as Record<string, unknown>;
  const bioObj = (o.profile_bio ?? {}) as Record<string, unknown>;
  const relCounts = (o.relationship_counts ?? {}) as Record<string, unknown>;
  const tweetCounts = (o.tweet_counts ?? {}) as Record<string, unknown>;
  const persp = (o.relationship_perspectives ?? {}) as Record<string, unknown>;
  const verification = (o.verification ?? {}) as Record<string, unknown>;
  const avatarObj = (o.avatar ?? {}) as Record<string, unknown>;

  const screenName = str(core.screen_name) ?? str(legacy.screen_name);
  if (!screenName) return null;

  const handle = normalizeHandle(screenName);
  if (!handle) return null;

  return {
    handle,
    restId: str(o.rest_id) ?? str(legacy.id_str),
    displayName: str(core.name) ?? str(legacy.name),
    bio: str(bioObj.description) ?? str(legacy.description),
    avatar: str(avatarObj.image_url) ?? str(legacy.profile_image_url_https),
    followersCount: num(relCounts.followers) ?? num(legacy.followers_count),
    followingCount: num(relCounts.following) ?? num(legacy.friends_count),
    tweetCount: num(tweetCounts.tweets) ?? num(legacy.statuses_count),
    isBlueVerified: bool(o.is_blue_verified, verification.is_blue_verified),
    // ⭐ 关系:两个位置都看(与 x-author-profile.ts:95 同口径)
    iFollow: bool(persp.following, legacy.following),
    followsMe: bool(persp.followed_by, legacy.followed_by),
    xBlocking: bool(persp.blocking, legacy.blocking),
    accountCreatedAt: str(core.created_at) ?? str(legacy.created_at),
    location: str((o.location as Record<string, unknown> | undefined)?.location)
      ?? str(legacy.location),
  };
}

/**
 * 一份画像「有多完整」—— 有值字段数。
 *
 * ⚠️ 用于**同一个人出现多次时选哪份**:空壳(只有 handle)会被完整版顶掉。
 * 先到先得会让精简结构挡住后面的 UserByScreenName 完整画像。
 */
function score(p: HarvestedPerson): number {
  return Object.values(p).filter((v) => v !== undefined && v !== '').length;
}

/**
 * 递归抽取载荷里所有的人。
 *
 * ⚠️ **不写死嵌套路径** —— 按特征找「带 screen_name 的对象」。
 * X 的响应外层结构变过好几次,写死路径会在改版后静默取不到。
 *
 * ⚠️ 按 handle 去重:同一个人可能在载荷里出现多次
 * (如列表项 + 推荐模块)—— **谁字段多谁留下**,不是先到先得。
 */
export function extractPeopleFrom(
  node: unknown,
  out: Map<string, HarvestedPerson>,
  depth = 0,
): void {
  /**
   * ⚠️ 深度上限 24,不是 12 —— 实测路径就有 13 层:
   * data → user → result → timeline → timeline → instructions → [0]
   *   → entries → [0] → content → itemContent → user_results → result
   * **数组也算一层**,12 会在最后一步之前停下 → 一个人都找不到,
   * 而且**不报错**(现象是「采到 0 人」,像解析器写错了)。
   *
   * ⭐ 上限仍要有:X 的响应里有环形引用的先例,没上限会栈溢出。
   */
  if (node === null || typeof node !== 'object' || depth > 24) return;
  if (Array.isArray(node)) {
    for (const it of node) extractPeopleFrom(it, out, depth + 1);
    return;
  }

  const o = node as Record<string, unknown>;
  const core = o.core as Record<string, unknown> | undefined;
  const legacy = o.legacy as Record<string, unknown> | undefined;
  const hasName = typeof core?.screen_name === 'string'
    || typeof legacy?.screen_name === 'string';

  /**
   * ⚠️ 只在**看起来是个完整 user 对象**时才解:要有 screen_name,
   * 并且带 rest_id / legacy / core 之一。
   * 光有 screen_name 的可能是引用片段(如「回复给 @xxx」),
   * 解出来会是个只有 handle 的空壳 —— 那会污染人表。
   */
  if (hasName && (o.rest_id || legacy || core)) {
    const p = parsePerson(o);
    if (p) {
      /**
       * ⭐⭐ **谁更完整谁留下**,不是「先到先得」。
       *
       * ⚠️ 原来写的是「已有就不覆盖」,理由是「第一次解到的通常最完整」——
       * 那个假设**不成立**:同一个人可能先在某个精简结构里出现
       * (只有 handle + 头像),后面才在 `UserByScreenName` 里给出完整画像。
       * 先到先得会让**空壳挡住真数据**。
       *
       * 用户实测 2026-09-18:采完自己主页后,再采 followers 仍显示「没有基准」——
       * 而 UserByScreenName 载荷确实带 relationship_counts(§2.4 实测记录)。
       * 这条覆盖规则正是嫌疑之一。
       *
       * ⭐ 判据用**有值字段数**:字段多的那份留下。
       */
      const prev = out.get(p.handle);
      if (!prev || score(p) > score(prev)) out.set(p.handle, p);
    }
    // ⭐ 不 return —— user 对象里可能嵌着别的 user(如「被谁关注」)
  }

  for (const v of Object.values(o)) extractPeopleFrom(v, out, depth + 1);
}

/**
 * 这个操作名是不是「人的列表」。
 *
 * ⚠️⚠️ **生产代码不用它,也不该用** —— 记在这里免得有人再写一遍。
 *
 * 解析**不按操作名分派**:每个载荷都试解人、也试解推
 * (`x-timeline-harvester` 里两个 extract 并排调)。理由:
 *  · 同一个载荷可能**既有推也有人**(时间线里的推荐关注模块)
 *  · 操作名会随 X 改版变(实测就有 `BlueVerifiedFollowers` 这种
 *    我们事先不知道的名字)—— 按名字分派等于把「认不认识这个名字」
 *    变成「采不采得到」,而那是**静默失败**
 *
 * ⭐ 所以三个 tab(Verified Followers / Followers / Following)
 * **都能采**,不取决于我们认不认识它的操作名。
 *
 * 保留它只为**诊断展示**(在报告里标注哪些载荷是人的列表)。
 * ⚠️ 若某天它被用来「决定要不要解析」,那就是退回按名字分派 —— 别这么做。
 */
export function isPeopleOp(op: string): boolean {
  return /Followers|Following|FollowersYouKnow|Subscriptions/i.test(op);
}

/**
 * ⭐⭐ **这条 GraphQL 请求是不是「这一页的主数据接口」** —— 翻页要重放的就是它。
 *
 * ── 为什么不能用 `isPeopleOp` 当这个判据(2026-09-22 用户实测追出来)──
 *
 * 抄请求那处原来写 `isPeopleOp(op)`,于是 `UserArticlesTweets`(长文页)
 * 不在名单里 → **请求从没被抄下来** → 游标翻页永远不启动 →
 * 长文页只能靠滚动,滚不动就停。
 * 现象:X 明说 `hasMore: true`,我们却只拿到 4 篇,而且「加大轮数」根本没用。
 *
 * ⚠️ 这正是 `isPeopleOp` 自己的注释警告过的形态:
 * 「按名字分派等于把『认不认识这个名字』变成『采不采得到』,而那是**静默失败**」。
 * 它本来只该用于诊断展示,却被拿来当了闸门。
 *
 * ── 那 `isPeopleOp` 当初是在挡什么 ──
 *
 * 挡的是**杂项接口**:`ViewerBadgeCounts` / `DataSaverMode` 这类 0KB 的,
 * 它们**发生得最晚**,会把真正的数据请求覆盖掉 →
 * 拿着数据接口的游标去请求 ViewerBadgeCounts → **HTTP 404**,一页就停。
 * ⭐ 所以真正要的判据是「**这条是不是主数据接口**」,
 * 而「是不是人的列表」只是它的一个**过窄的近似**。
 *
 * ── 判据 ──
 * ① 明确排除已知杂项(它们的名字很稳定,而且个个是 0KB 的旁路)
 * ② 请求里必须带 `variables` —— 翻页靠 `withCursor` 往 variables 塞游标,
 *    没有 variables 的请求**根本不可能翻页**,抄了也是白抄
 *
 * ⚠️ 用**黑名单 + 结构判据**而不是白名单:X 改版加了新的时间线接口时,
 * 白名单会把它挡在外面(静默失败),而黑名单最多是多抄一条、下一条覆盖掉。
 */
const JUNK_OPS = /^(ViewerBadgeCounts|DataSaverMode|CreatorStudioTabBarItemQuery|getAltTextPromptPreference|ProfileSpotlightsQuery|ProfileTeamRoster|ProfileSeasonSchedule|UserByScreenName|TopicToFollowSidebar|ExploreSidebar)$/i;

export function isPageDataOp(op: string, url: string): boolean {
  if (!op || JUNK_OPS.test(op)) return false;
  /**
   * ⚠️ 没有 `variables` 就翻不了页(withCursor 解不出来会返回 null)——
   * 抄它只会把真正能翻页的那条覆盖掉。
   */
  try {
    return !!new URL(url).searchParams.get('variables');
  } catch {
    return false;
  }
}


/**
 * ⭐⭐ 找**分页游标** —— 回答「还有没有」,不靠猜。
 *
 * ── 用户 2026-09-18 问全量/增量 ──
 *
 * 现在判「采完没有」靠的是 `scrollY` 连续 8 轮不变(滚不动了 ≈ 到底了)——
 * 那是**猜**。而 X **明确告诉了你**:载荷里带
 * `{ __typename: 'TimelineTimelineCursor', cursorType: 'Bottom', value: '…' }`。
 *
 * ⚠️ 同一个洞在 `x-article-replies.ts:34` 已经认识到了:
 * 「X 明确告诉了你『还有,拿这个 cursor 来取』,而原先的代码在数
 *   『连续 4 轮没新增』—— 真源就摆在载荷里,我们没读」。
 * 那边只找 `ShowMore`(折叠区),**列表分页用的是 `Bottom`** —— 这里补上。
 *
 * ── 游标怎么用 ──
 *
 * `hasMore=true`  → 还有下一页(继续滚/翻)
 * `hasMore=false` → **真的采完了**(不是「滚不动了」)
 * `bottom` 的值   → 跨次增量的**断点**:下次从这里接着采
 *
 * ⚠️ 空游标(`value` 为空串)等于没有 —— X 在列表末尾会给一个空游标,
 * 当成「还有」会让滚动永不停止。
 */
export function findPagingCursor(node: unknown): {
  bottom?: string;
  top?: string;
  /** 还有下一页吗 —— **X 说的,不是我们猜的** */
  hasMore: boolean;
  /** ⭐ X 明说「这个方向到此为止」(TimelineTerminateTimeline) */
  terminated?: boolean;
} {
  let bottom: string | undefined;
  let top: string | undefined;
  /**
   * ⭐⭐ **X 会明说「到底了」** —— 2026-09-19 读到真实响应体才发现。
   *
   * 翻到底后 X 返回的载荷只有 634 字节,第一条指令就是:
   *   {"direction":"Bottom","type":"TimelineTerminateTimeline"}
   * 意思是「Bottom 方向到此为止」。**它仍然附带一个 Bottom 游标**
   * (值形如 `0|2101249894198015158`,而且每次还倒着减 2),
   * 于是 hasMore 恒为 true,我们拿着空游标又翻了 50 页。
   *
   * ⚠️ 全仓**从没读过这条指令** —— 现象是「翻页从第一页起就没加过新人」,
   * 而我先后怪过:平台天花板、游标选错(试了两种改法,都把结果从 2691 弄成 250)。
   * 真相是 X 一直在明说,我们没听。
   *
   * ⭐ 本仓判据一直是「**还有没有由 X 说了算**」—— 这条指令正是 X 说的话。
   */
  let terminated = false;

  const walk = (o: unknown, depth: number): void => {
    if (o === null || typeof o !== 'object' || depth > 24) return;
    if (Array.isArray(o)) { for (const v of o) walk(v, depth + 1); return; }
    const r = o as Record<string, unknown>;
    /** ⭐ X 说「Bottom 方向到此为止」—— 那就是真到底了 */
    if (r.type === 'TimelineTerminateTimeline'
      && typeof r.direction === 'string'
      && /^bottom$/i.test(r.direction)) {
      terminated = true;
    }
    if (r.__typename === 'TimelineTimelineCursor'
      && typeof r.value === 'string' && r.value.trim()
      && typeof r.cursorType === 'string') {
      if (/^bottom$/i.test(r.cursorType)) bottom = r.value;
      else if (/^top$/i.test(r.cursorType)) top = r.value;
    }
    for (const v of Object.values(r)) walk(v, depth + 1);
  };
  walk(node, 0);

  /**
   * ⚠️ `terminated` **压过游标** —— X 到底时照样给游标(而且值在倒退),
   * 只看「有没有游标」会永远以为还有下一页。
   */
  return { bottom, top, hasMore: !!bottom && !terminated, terminated };
}

/**
 * ⭐⭐ **游标翻页** —— 不滚动,直接重发带新游标的请求。
 *
 * ── 用户 2026-09-18 实测的效率问题 ──
 *
 * 滚动 30 轮 / 76 秒只拿到 **201/2604 = 7.7%**,而且只触发了 **4 个载荷** ——
 * 时间全花在滚动动画和虚拟列表渲染上。按这速度采全要 ~390 轮、16 分钟。
 *
 * ⭐ 而 X 的分页本来就是游标式的:一次请求给 50-100 人。
 * 30 次请求就能拿 2000+ 人,比滚动快几十倍。
 *
 * ── ⚠️ 为什么不自己拼请求 ──
 *
 * `x-article-replies.ts:285` 记着教训:
 * 「重发要复刻 X 的 GraphQL **query id / features 参数(会随版本变)**」——
 * 那边为此放弃了重发,改成点按钮。
 *
 * ⭐ 本实现绕开了这一点:**复用 X 刚发过的那条请求**,
 * 只把 URL 里的 `cursor` 换掉,queryId/features/请求头**原样带走**。
 * 我们不需要知道它们是什么,也就不会因为它们变了而失效。
 *
 * ⚠️ 在**页面上下文**里 fetch:cookie 与鉴权头自动生效,不复刻登录态。
 */
export function withCursor(url: string, cursor: string): string | null {
  /**
   * ⚠️ 传进来的模板 URL **可能自带 cursor**(X 滚动时自己翻页发的请求就带),
   * 但这里无条件覆盖成我们要的那个,所以自带的会被换掉 —— 这是对的。
   * ⭐ 真正的风险在**别的分页参数**:若 X 哪天改用 `cursor2`/`after` 之类,
   * 旧的那个会留在 URL 里和新游标打架。目前只见过 `cursor` 一个。
   */
  try {
    const u = new URL(url);
    const raw = u.searchParams.get('variables');
    if (!raw) return null;
    const vars = JSON.parse(raw) as Record<string, unknown>;
    vars.cursor = cursor;
    u.searchParams.set('variables', JSON.stringify(vars));
    return u.toString();
  } catch {
    // ⚠️ 解不出 variables 就**返回 null**,不猜着改 URL ——
    //    改错会请求到别的数据,而那种错在数据里看不出来
    return null;
  }
}

/**
 * ⭐⭐ 把 GET 形状的 GraphQL URL 改写成 **POST 形状**。
 *
 * ── 为什么需要它(2026-09-25 查搜索翻页 404)──
 *
 * X 的 GraphQL 有两种调用形状:
 *  · GET  —— `?variables=…&features=…`(URL 里)
 *  · POST —— `{ variables, features, queryId }`(JSON body 里)
 *
 * ⚠️ **参数要搬家,不是只换 method** —— 社区(RSSHub #23359 / gallery-dl #9275 /
 * XActions #42)一致的结论是:X 对 SearchTimeline 这类接口的 GET **直接 404 +
 * 空 body**,而空 body 会让人误判成「queryId 过期」。
 * 光把 `method` 改成 POST 而参数仍留在 URL 里,X 同样不认。
 *
 * ⭐ `queryId` 在**路径里**(`/graphql/<queryId>/SearchTimeline`),
 * POST body 要求把它显式带上 —— 从路径里取,**不写死**(它随版本变)。
 *
 * @returns 改写不了就返回 null —— **不猜着拼**(拼错会请求到别的数据,
 *          而那种错在数据里看不出来)
 */
export function toPostShape(url: string): { url: string; body: string } | null {
  try {
    const u = new URL(url);
    const variables = u.searchParams.get('variables');
    if (!variables) return null;
    /** ⭐ queryId 来自路径 —— `/i/api/graphql/<queryId>/<OpName>` */
    const queryId = u.pathname.match(/\/graphql\/([^/]+)\//)?.[1];
    if (!queryId) return null;

    const payload: Record<string, unknown> = { queryId };
    payload.variables = JSON.parse(variables);
    const features = u.searchParams.get('features');
    if (features) payload.features = JSON.parse(features);
    const fieldToggles = u.searchParams.get('fieldToggles');
    if (fieldToggles) payload.fieldToggles = JSON.parse(fieldToggles);

    /** ⚠️ POST 时 URL 上**不留查询串** —— 两处都带会冲突 */
    u.search = '';
    return { url: u.toString(), body: JSON.stringify(payload) };
  } catch {
    return null;
  }
}

/**
 * 在页面上下文重发请求的脚本 —— 同源 fetch,鉴权自动带。
 *
 * ⭐⭐ **两种形状依次试** —— 抄到的那种先试,404-未路由就改 POST 重试。
 *
 * ⚠️ 为什么不直接写死 POST:**X 自己用的就是 GET 且成功**
 * (本次留痕:`SearchTimeline` count=3,277KB 全是 GET 拿回来的)。
 * 写死 POST 等于拿社区结论覆盖本机实测 —— 那是猜。
 * ⭐ 让它**自己试出来**,并把「哪种形状成功了」记进结果:
 * 下次就有实测依据,不必再从别人的 issue 里推断。
 */
export function buildRefetchScript(
  url: string, headers: Record<string, string>, method = 'GET',
): string {
  /**
   * ⚠️ 只带 X 自己发过的头,不自己加 —— 多余的头可能触发风控。
   * ⚠️ 排除 `content-length` 等由浏览器自动算的头(手动带会冲突)。
   */
  const safe: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (/^(content-length|host|connection|:.*)$/i.test(k)) continue;
    safe[k] = v;
  }
  const post = toPostShape(url);
  return `(async function () {
    /**
     * 发一次,把判据一起带回来。
     *
     * ⭐⭐ **失败时把判据一起交出来** —— 2026-09-25 查翻页 404 时发现缺的正是这些。
     *
     * ⚠️ 只报 'HTTP 404' 的话,三种成因**长得一模一样**
     * (注释在 x-timeline-harvester 的失败分支里早就写着):
     *  · 抄错了请求 / 游标换坏了 / queryId 过期
     *
     * ⭐ 判据(记忆 project-x-cursor-paging 实测出来的):
     *  · **content-type** —— 「404 + 空 body + 非 JSON」是指纹:
     *    请求**根本没进 GraphQL handler**(followers 那次真因是必须用 POST)
     *  · **响应体开头** —— X 真正的业务错误会返回 JSON 带 errors[]
     *  · **实际用的 method** —— 抄到的 method 会骗人,得看发出去的是什么
     */
    async function send(u, m, body, extraHeaders) {
      const h = Object.assign({}, ${JSON.stringify(safe)}, extraHeaders || {});
      const r = await fetch(u, {
        method: m,
        headers: h,
        credentials: 'include',
        body: body === null ? undefined : body,
      });
      if (!r.ok) {
        let head = '';
        try { head = (await r.text()).slice(0, 200); } catch (e) { head = '(读不出 body)'; }
        return {
          __err: 'HTTP ' + r.status,
          __status: r.status,
          __ctype: r.headers.get('content-type') || '(无)',
          __bodyHead: head,
          __method: m,
        };
      }
      return { __body: await r.text(), __method: m };
    }

    try {
      const first = await send(${JSON.stringify(url)}, ${JSON.stringify(method)}, null, null);
      if (first.__body !== undefined) return first;

      /**
       * ⭐ 只在「**404 + 非 JSON**」这个指纹上改形状重试。
       * ⚠️ 别无条件重试:业务错误(带 errors[] 的 JSON)重发一次还是错,
       * 白白多打一次接口、还会把真正的错误信息盖掉。
       */
      const unrouted = first.__status === 404
        && !/json/i.test(first.__ctype || '');
      ${post ? `
      if (unrouted) {
        const second = await send(
          ${JSON.stringify(post.url)}, 'POST', ${JSON.stringify(post.body)},
          { 'content-type': 'application/json' },
        );
        /** ⭐ 记下「换形状救回来了」—— 下次不必再从别人的 issue 里推断 */
        if (second.__body !== undefined) {
          return { __body: second.__body, __method: 'POST', __shapeSwitched: true };
        }
        /** ⚠️ 两种都失败:把**两份**判据都交出来,别只报后一种 */
        return {
          __err: first.__err + ' / POST 重试也失败:' + second.__err,
          __status: second.__status,
          __ctype: second.__ctype,
          __bodyHead: second.__bodyHead,
          __method: 'GET→POST 都试过',
        };
      }` : `
      /** ⚠️ 这条 URL 改写不成 POST 形状(没有 variables 或取不到 queryId)—— 如实说 */
      if (unrouted) {
        return Object.assign({}, first, {
          __err: first.__err + '(改不成 POST 形状:URL 里没有 variables 或 queryId)',
        });
      }`}
      return first;
    } catch (e) {
      return { __err: String(e) };
    }
  })()`;
}

/**
 * ⭐⭐ **数载荷里有多少个「条目」** —— 解析率的分母。
 *
 * ── 为什么每个页面都需要它(用户 2026-09-20:「每个页面都能够正确、
 *    完整的提取数据」)──
 *
 * 有四个页面**根本没有外部分母**:notifications / search / home / articles
 * —— X 不报「你收到过多少互动」「搜索结果共多少条」。
 * 对它们,「采全了没有」只能问另一个问题:
 *
 *   **这个载荷里 X 给了我 M 条,我解出了 N 条?**
 *
 * 这个判据**自给自足**:分母来自载荷本身,不依赖任何外部计数。
 * · N = M → 给什么解什么,解析器没漏
 * · N < M → **有条目被丢弃**,要么是判据太严,要么是结构没认出来
 *
 * ⚠️ 它回答的**不是**「X 给全了吗」(那要靠游标),
 * 而是「**X 给的我都接住了吗**」—— 两个问题都要答,缺一不可:
 * · 游标说「还有没有」  → X 那边还有没有
 * · 解析率说「漏没漏」  → 我这边接没接住
 *
 * ⭐ 实测(2026-09-06 真实通知载荷):39 个条目 → 解出 39,100%。
 *
 * ── 什么算一个「条目」──
 *
 * X 的时间线用 `entryId` 标识每一条(推文/通知/用户/游标/模块)。
 * ⚠️ **游标条目不算** —— 它是分页控制,不是数据。
 * ⚠️ **模块容器不重复计** —— 只数叶子条目。
 */
export function countTimelineEntries(node: unknown, depth = 0): number {
  if (node === null || typeof node !== 'object' || depth > 24) return 0;
  if (Array.isArray(node)) {
    let n = 0;
    for (const it of node) n += countTimelineEntries(it, depth + 1);
    return n;
  }
  const o = node as Record<string, unknown>;

  /**
   * ⚠️ 只数**带 entryId 的叶子**,且排除游标。
   * 游标的 entryId 形如 `cursor-bottom-…` / `cursor-top-…`,
   * 把它算进分母会让解析率永远差那么一两条 ——
   * 而「永远差一点」比「明显差很多」更难排查(看着像正常损耗)。
   */
  const eid = typeof o.entryId === 'string' ? o.entryId : undefined;
  if (eid) {
    if (/^cursor-/i.test(eid)) return 0;
    /**
     * ⭐ 模块条目(如「推荐关注」)里嵌着多个叶子,要数里面的。
     * 判据:content.items 存在 = 这是个容器。
     */
    const content = o.content as Record<string, unknown> | undefined;
    const items = content?.items;
    if (Array.isArray(items)) {
      let n = 0;
      for (const it of items) {
        const ie = (it as Record<string, unknown>)?.entryId;
        if (typeof ie === 'string' && /^cursor-/i.test(ie)) continue;
        n += 1;
      }
      return n;
    }
    return 1;
  }

  let n = 0;
  for (const v of Object.values(o)) n += countTimelineEntries(v, depth + 1);
  return n;
}
