/**
 * ⭐⭐⭐ **用户列表载荷的解析** —— followers / following / verifiedFollowers
 *
 * ── ⚠️ 名字用 X 的词(用户 2026-10-05:「人,就是 x 的用户呀」)──
 * 载荷里的原词全是 **user**(`user_results` / `UserCell` / `screen_name`),
 * 我原先写 `Person` / `people` —— **又是自造的说法**,
 * 与 `iFollow`→`following` 同一个毛病(2026-10-04 刚被指出过)。
 *
 * ⭐⭐ 更要紧的是你这句点出的**实体归一**:
 * follower 和「推文作者」**是同一个东西** —— 一个 X 用户,两种发现途径:
 * 　· 从推文行推出来(发过推的)
 * 　· 从用户列表页采来(含从没发过推的)
 * 所以**不建新表**:`x_author` 那张表已经装着
 * `followers_count` / `location` / `watched` / `blocked` —— 它本来就是用户表,
 * 只是名字叫 author。按数据模型总纲(实体优先),一个实体一张表。
 * ⚠️ 表名暂不改(存量数据与一串引用),但**代码里一律叫 user**。
 *
 * ── 为什么要单独一个 ──
 * 这三页的条目是**人不是推**。此前它们被 `carriesTweets` 认成时间线,
 * 喂给推文解析器 → **0 条 + 报「一条推文都没解出来,可能结构变了」**。
 * ⚠️ 误导性告警**比报错还坏**:它把人指向「X 改版了」这个错方向。
 *
 * ── 交接文档(`docs/handoff/x-followers-collection.md`)记的实测事实 ──
 * ⚠️ 采人页回读要数 **`UserCell`**,数 `article[data-testid=tweet]` **恒为 0**
 * ⚠️ X 翻到底会发 `TimelineTerminateTimeline`,**但仍附带游标**(值还在倒退)
 * ⚠️ **空 handle 会让整批写入 0 条**(`FOR` 里一条 ASSERT 失败全灭)
 * ⚠️ `Followers` 端点**必须 POST**(GET 恒 404 + 空 body)—— 那是翻页的事
 *
 * ⭐ 与 `x-timeline-audit` 并列、不复用它的类型:
 * 「人」和「推」是两个实体,硬套一套字段会把两边都拧歪
 * (`project-data-model-charter` 原则一:实体优先)。
 */

/**
 * ⭐ 一个 **X 用户**的完整记录 —— 落库用,与 `TweetRecord` 并列。
 * ⚠️ 落到 `x_author` 表(它本来就是用户表,见文件头)。
 */
export type XUserRecord = {
  /** ⭐ handle 是业务主键 —— ⚠️ 空的要在**入库前**挡掉,见 `problems` */
  readonly handle: string;
  /** ⭐ X 的数字 id —— 改名不会变,比 handle 稳 */
  readonly restId: string;
  readonly name: string;
  readonly bio: string;
  readonly avatar: string;
  /** ⚠️ 载荷没带就是 undefined,**不兜底成 0** —— 「不知道」不是「零粉丝」 */
  readonly followersCount?: number;
  /** 他关注了多少人(X 原名 `friends_count`) */
  readonly followingCount?: number;
  readonly statusesCount?: number;
  /** ⭐ 发过多少条带媒体的推(`tweet_counts.media_tweets`,新结构才有) */
  readonly mediaCount?: number;
  /** ⚠️ 实测 16/50 有值 —— **零星缺失是正常的**,很多人不填 */
  readonly location: string;
  /** ⚠️ 实测 5/50 有值 —— 同上 */
  readonly website?: string;
  /** ⭐ 蓝V(买的) */
  readonly isBlueVerified?: boolean;
  /** ⚠️ 与蓝V**不是一回事**:`verification.verified` 是老的认证标 */
  readonly isVerified?: boolean;
  /** ⭐ 受保护的号采不到他的推 —— 业务要分得出来 */
  readonly isProtected?: boolean;
  /** ⭐ 用 X 的原词 —— 与 `TweetRecord` 一致 */
  readonly following?: boolean;
  readonly followedBy?: boolean;
  readonly createdAt?: string;
  /**
   * ⭐⭐ **在名单里的名次**(0 起)—— 增量采集的命根子。
   *
   * 交接文档实测:**X 的 followers 列表严格按关注时间倒序**,
   * 2770 人里新人全落在 seq 0-10、相对顺序零颠倒。
   * ⚠️ 判「是不是新人」别用「位移要小」—— 正确期望是
   * **位移 ≈ 净增人数**(整体平移)。那条判词写错过一次。
   */
  readonly seq: number;
};

export type XUserAudit = {
  /** ⭐ 这一页解出几个用户 */
  readonly users: number;
  readonly items: readonly XUserRecord[];
  /** ⭐ 翻页游标 —— 它回答「还能不能继续翻」 */
  readonly hasCursor: boolean;
  readonly cursor?: string;
  /**
   * ⚠️ X 翻到底会发 `TimelineTerminateTimeline`,**但仍附带游标** ——
   * 所以「有游标」不等于「还有人」,要同时看这个。
   */
  readonly terminated: boolean;
  readonly coverage: Readonly<Record<string, number>>;
  readonly problems: readonly string[];
};

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined =>
  (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** ⚠️ 防环:X 的载荷里有互相引用 */
function collectBy(
  node: unknown,
  pred: (o: Record<string, unknown>) => boolean,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    if (seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { for (const x of n) walk(x); return; }
    const o = n as Record<string, unknown>;
    if (pred(o)) out.push(o);
    for (const v of Object.values(o)) walk(v);
  };
  walk(node);
  return out;
}

/**
 * ⭐⭐⭐ 核对一个人流载荷。
 *
 * ⚠️ 解不出来**不抛** —— 回 `problems` 非空的结果:
 * 「这个载荷读不懂」与「这个载荷是空的」是两件事,混起来就查不动
 * (推文那边正是这么踩过)。
 */
export function auditUserPayload(text: string, seqFrom = 0): XUserAudit {
  const empty = (problems: string[]): XUserAudit => ({
    users: 0, items: [], hasCursor: false, terminated: false, coverage: {}, problems,
  });

  /** ⚠️ 空响应体单独说 —— 不是解析失败,是根本没拿到内容 */
  if (text.trim() === '') {
    return empty(['**响应体是空的** —— 不是解析失败，是这条响应根本没拿到内容'
      + '（多半是 CDP 读 body 失败，看 legs 里的 noBody）']);
  }

  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (e) {
    return empty([`不是合法 JSON(${e instanceof Error ? e.message : '未知'})—— `
      + '可能被截断了,或这根本不是人流载荷']);
  }

  /**
   * ⭐ 人的特征:`legacy.screen_name` 或 `core.screen_name`。
   * ⚠️ 两个位置都要看 —— X 正在把字段从 `legacy` 挪到 `core`,
   * 只认一个会在改版时**静默少一半**(推文那边的 `authorName` 就是这样)。
   */
  const nodes = collectBy(root, (o) => {
    /**
     * ⚠️⚠️ 判据是「**有没有 screen_name 这个键**」,不是「它有没有值」。
     *
     * 第一版写成「值非空」,后果:**空 handle 的人根本解不出来** ——
     * 而交接文档实测它会让**整批写入 0 条**(FOR 里一条 ASSERT 失败全灭)。
     * ⭐ 看不见就警告不了:解析器必须先把人收进来,才谈得上报「这人没 handle」。
     */
    const legacy = isObj(o.legacy) ? o.legacy : undefined;
    const core = isObj(o.core) ? o.core : undefined;
    const hasKey = (x: Record<string, unknown> | undefined): boolean =>
      x !== undefined && 'screen_name' in x;
    return hasKey(legacy) || hasKey(core);
  });

  const problems: string[] = [];
  const items: XUserRecord[] = nodes.map((node, i) => {
    const legacy = isObj(node.legacy) ? node.legacy : {};
    const core = isObj(node.core) ? node.core : {};
    const persp = isObj(node.relationship_perspectives) ? node.relationship_perspectives : undefined;
    const avatarObj = isObj(node.avatar) ? node.avatar : undefined;
    const bioObj = isObj(node.profile_bio) ? node.profile_bio : undefined;
    /** ⭐ 2026-10-05 真载荷里的新位置 —— 路径都是实测抄下来的,不是猜的 */
    const relCounts = isObj(node.relationship_counts) ? node.relationship_counts : undefined;
    const tweetCounts = isObj(node.tweet_counts) ? node.tweet_counts : undefined;
    const locObj = isObj(node.location) ? node.location : undefined;
    const siteObj = isObj(node.website) ? node.website : undefined;
    const verifyObj = isObj(node.verification) ? node.verification : undefined;
    const privacyObj = isObj(node.privacy) ? node.privacy : undefined;

    return {
      handle: str(core.screen_name) || str(legacy.screen_name),
      restId: str(node.rest_id),
      name: str(core.name) || str(legacy.name),
      bio: str(bioObj?.description) || str(legacy.description),
      avatar: str(avatarObj?.image_url) || str(legacy.profile_image_url_https),
      /**
       * ⭐⭐⭐ **新结构优先,`legacy` 兜底** —— 2026-10-05 拿真载荷定的。
       *
       * ⚠️⚠️ 真机 `Following` 载荷里**根本没有 `legacy` 这个键**:
       * X 已经把字段全搬进带类型的子对象。而这四个字段原先**只读 legacy**,
       * 于是整列空(粉丝数/关注数/地点/注册时间 0/221,采了三跑)。
       * ⭐ handle/name/bio/avatar 之所以一直有,正是因为它们**早就两条路都读**。
       *
       * ⚠️ `legacy` 仍保留作兜底:别的端点(推文里的作者)可能还是旧形状,
       * 删掉它等于拿「这一个端点的观察」去断言全站 ——
       * 而 `feedback-check-sample-contains-phenomenon` 说的就是这个。
       */
      followersCount: num(relCounts?.followers) ?? num(legacy.followers_count),
      followingCount: num(relCounts?.following) ?? num(legacy.friends_count),
      statusesCount: num(tweetCounts?.tweets) ?? num(legacy.statuses_count),
      /** ⭐ 实测 16/50 有 —— **零星缺失是正常的**(很多人不填地点) */
      location: str(locObj?.location) || str(legacy.location),
      /** ⭐ 实测 5/50 有 —— 同上,不是 bug */
      website: str(siteObj?.url),
      /** ⭐ 媒体推文数 —— 新结构才有,旧的没有对应字段 */
      mediaCount: num(tweetCounts?.media_tweets),
      /** ⚠️ `is_blue_verified`(蓝V,买的)与 `verification.verified`(认证)**不是一回事** */
      isBlueVerified: typeof node.is_blue_verified === 'boolean'
        ? node.is_blue_verified : undefined,
      isVerified: typeof verifyObj?.verified === 'boolean' ? verifyObj.verified : undefined,
      /** ⭐ 受保护的号:采不到他的推,业务要分得出来 */
      isProtected: typeof privacyObj?.protected === 'boolean' ? privacyObj.protected : undefined,
      following: typeof persp?.following === 'boolean'
        ? persp.following
        : (typeof legacy.following === 'boolean' ? legacy.following : undefined),
      followedBy: typeof persp?.followed_by === 'boolean'
        ? persp.followed_by
        : (typeof legacy.followed_by === 'boolean' ? legacy.followed_by : undefined),
      createdAt: str(core.created_at) || (typeof legacy.created_at === 'string'
        ? legacy.created_at : undefined) || undefined,
      /** ⭐ 名次接着上一页数 —— 跨页连续才能做差集 */
      seq: seqFrom + i,
    };
  });

  /** ⭐ 游标:`cursorType` 为 bottom 的那个 */
  const cursors = collectBy(root, (o) =>
    str(o.cursorType).toLowerCase() === 'bottom' && str(o.value) !== '');
  const cursor = cursors.length > 0 ? str(cursors[0].value) : '';

  /**
   * ⚠️⚠️ X 翻到底会发 `TimelineTerminateTimeline`,**但仍附带游标**
   * (值还在倒退)—— 光看游标会以为还能翻。
   */
  /**
   * ⚠️⚠️ 2026-10-19 真机:**只认 `direction: Bottom`**。我自己的 followers 第一页带着
   * `{type: TimelineTerminateTimeline, direction: Top}`(= 上面没有更新的了)+ 一个正常的 Bottom 游标,
   * 原先见 terminate 不看方向就判到头 → 约 5000 人的名单第一页 50 人就停。
   * 真到头的那页(别人号 71 人)是 Top、Bottom 两条都有。
   * 没带 direction 的保持原判(算到头),但记一条 problem —— 不认识的形状不静默。
   */
  const terminates = collectBy(root, (o) =>
    str(o.type) === 'TimelineTerminateTimeline'
    || str(o.entryType) === 'TimelineTerminateTimeline');
  const noDirection = terminates.filter((o) => str(o.direction) === '');
  const terminated = noDirection.length > 0
    || terminates.some((o) => str(o.direction).toLowerCase() === 'bottom');
  if (noDirection.length > 0) {
    problems.push('TimelineTerminateTimeline 没带 direction —— 按「到头了」算;若名单其实没完,看这条');
  }

  if (items.length === 0) {
    problems.push('这个载荷里**一个人都没解出来** —— 可能不是人流载荷,或结构变了');
  }
  /**
   * ⚠️⚠️ **空 handle 必须在这里喊** —— 交接文档实测:
   * 它会让**整批写入 0 条**(`FOR` 里一条 ASSERT 失败全灭)。
   * ⭐ 在解析这层报出来,比到写库时整批失败好查得多。
   */
  const noHandle = items.filter((p) => p.handle === '').length;
  if (noHandle > 0) {
    problems.push(`有 ${noHandle} 个人没有 handle —— **入库前必须挡掉**,`
      + '否则整批写入 0 条（一条 ASSERT 失败全灭）');
  }

  const pct = (f: (p: XUserRecord) => boolean): number =>
    (items.length === 0 ? 0 : Math.round((items.filter(f).length / items.length) * 100));

  /**
   * ⭐⭐⭐ **整列为 0 要喊出来** —— 2026-10-05,用户:
   * 「人有哪些数据?**要先观察清楚**,不要数据都采不齐呢。」
   *
   * ⚠️⚠️ 真机实测:`bio` 159/171 有,而**粉丝数/关注数/地点/注册时间
   * 全是 0/171**。覆盖率一直算着、也显示着,可**没有一句话说「这不正常」** ——
   * 于是四个字段整列空采了两跑没人发现。
   * ⭐ 「某些人没有」是正常的(有人就是不填地点);
   * **「一个人都没有」几乎一定是取错了路径**,这两件事必须分开报。
   * ⚠️ 这正是 `project-x-article-body-lost` 那条的反面:
   * 「不量的字段永远 100%」—— 而量了却不报警,一样等于没量。
   */
  const allMissing = (label: string, f: (p: XUserRecord) => boolean): void => {
    if (items.length > 0 && items.every((p) => !f(p))) {
      problems.push(`**${label} 一个都没解出来**(0/${items.length})—— `
        + '「有人没填」会是零星缺失,**整列空几乎一定是字段路径变了**');
    }
  };
  allMissing('粉丝数', (p) => p.followersCount !== undefined);
  allMissing('关注数', (p) => p.followingCount !== undefined);
  allMissing('地点', (p) => p.location !== '');
  allMissing('注册时间', (p) => p.createdAt !== undefined);

  return {
    users: items.length,
    items,
    hasCursor: cursor !== '',
    cursor: cursor === '' ? undefined : cursor,
    terminated,
    coverage: {
      handle: pct((p) => p.handle !== ''),
      用户id: pct((p) => p.restId !== ''),
      显示名: pct((p) => p.name !== ''),
      头像: pct((p) => p.avatar !== ''),
      简介: pct((p) => p.bio !== ''),
      /** ⭐ 这几项**本就不该 100%** —— 量它们是为了知道「X 到底给不给」 */
      粉丝数: pct((p) => p.followersCount !== undefined),
      关注数: pct((p) => p.followingCount !== undefined),
      推文数: pct((p) => p.statusesCount !== undefined),
      注册时间: pct((p) => p.createdAt !== undefined),
      /** ⚠️ 这两项**实测本就稀疏**(16/50、5/50)—— 低不代表坏 */
      位置: pct((p) => p.location !== ''),
      网站: pct((p) => p.website !== undefined && p.website !== ''),
      关系: pct((p) => p.following !== undefined || p.followedBy !== undefined),
    },
    problems,
  };
}
