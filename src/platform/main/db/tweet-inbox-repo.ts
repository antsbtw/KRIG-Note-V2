/**
 * x_tweet 表 CRUD（X 时间线智能筛选）
 *
 * 调用边界：仅 main 进程调用，直接 import @storage/surreal/client。
 * ⚠️ 走 **X 库(krig_x)**,不是笔记库 —— 用 getXDB() 而非 getDB()。
 *
 * A 期起真源表是 `x_tweet`(单表模型,方案 §4.1(4)):采纳与否是 item 的**属性**
 * 而不是分表依据。是否永久保留取决于 `expires_at`:
 *   - 有值   → 到期由 cleanExpired 删除(普通采集,7 天窗口)
 *   - NONE   → **永久保留**(人工采纳/回复过的)
 *
 * ⚠️ 这是 A 期止血的核心:旧 tweet_inbox 的 expires_at 是 TYPE datetime(非 option),
 * 「设 NONE 让 TTL 跳过」根本走不通 —— 于是采纳过的推文照样 7 天后被删,
 * 607 条历史采纳里 449 条(74%)正文就是这么丢的。x_tweet 建成 option<datetime> 修掉了根因。
 */

import { getXDB } from '@storage/surreal/client';
import { registerSeenAuthor } from './x-author-repo';
import type { TweetInboxRecord, AIVerdict, TweetInboxStatus, TweetFeedback, FeedbackVerdict } from '@shared/types/x-timeline-types';
import { DEFAULT_TASK_ID } from '@shared/types/x-timeline-types';

/** 写入或忽略（tweet_id 唯一索引冲突 = 重复，直接跳过） */
export async function upsertTweet(record: TweetInboxRecord): Promise<void> {
  const db = getXDB();
  // 「人」也要留档:此前采集只写推文,x_author 见过 3458 个作者却只有 36 行
  // (用户 2026-09-06 发现)。⚠️ 只登记标识,计数走 getAuthorStats 现算;
  //   失败不拦入库 —— 推文是主数据,人表是派生登记。
  await registerSeenAuthor(record.author_handle, {
    displayName: record.author_name,
    avatar: record.author_avatar,
  }).catch((e) => console.warn('[tweet-inbox-repo] 作者登记失败(不拦入库):', e));
  await db.query(
    /**
     * ⭐⭐⭐ **INSERT IGNORE + ON DUPLICATE** —— 2026-09-21 实测揪出的真 bug。
     *
     * ── 现象 ──
     * 函数名叫 `upsertTweet`,行为却是**纯 insert-ignore**:
     * `tweet_id` 已存在就整条跳过,**一个字段都不更新**,而且**不抛错**
     * → 调用方 `saved += 1` 照加 → 报告显示「入库 50 条」,库里纹丝不动。
     *
     * 实测坐实(直接对库跑):先 INSERT 一条 text='原始',
     * 再 INSERT IGNORE 同 id 且 text='改过了' + conversation_id='NEW'
     * → 读回来仍是 `text:'原始'`、`conversation_id:None`。
     *
     * ⚠️ 后果远不止这次:用户说「老数据等再次采集时补上」——
     * 按原实现**永远补不上**,重采多少次都跳过。
     * 全库 conversation_id 卡在 9%、tweet_url 卡在 75% 正是这么来的。
     *
     * ⭐ 但 IGNORE 原本**确实在保护**东西:`accepted` / `ai_verdict` /
     * `replied` / `translation` 这些是**业务后填的**,无脑覆盖会全部清掉。
     * 所以不能简单改成 UPSERT 全覆盖 ——
     * **已存在时只更新「采集该负责」的字段,业务字段一律不碰。**
     */
    `INSERT INTO x_tweet {
      tweet_id: $tweet_id,
      text: $text,
      author_name_at_post: $author_name_at_post,
      author_handle: $author_handle,
      author_avatar: $author_avatar,
      tweet_url: $tweet_url,
      lang: $lang,
      metrics: $metrics,
      fetched_at: $fetched_at,
      created_at: $created_at,
      in_reply_to: $in_reply_to,
      in_reply_to_user: $in_reply_to_user,
      conversation_id: $conversation_id,
      expires_at: $expires_at,
      source: $source,
      search_recipe: $search_recipe,
      task_id: $task_id,
      ws_id: $ws_id,
      filter_score: $filter_score,
      filter_reason: $filter_reason,
      ai_verdict: $ai_verdict,
      translation: $translation,
      status: $status,
      accepted: $accepted,
      accepted_at: $accepted_at,
      replied: $replied,
      replied_at: $replied_at,
      reply_draft: $reply_draft,
      backfilled: $backfilled
    }
    ON DUPLICATE KEY UPDATE
      /**
       * ⚠️⚠️ **text 只许变长,不许变短** —— 2026-09-22 实测的数据损坏。
       *
       * ── 现象 ──
       * 重采 @0xEgorAI 一次,两条长文的正文**被覆盖成标题+摘要**:
       *   2099916828529082572: 16081 字 → 267 字(断在句中)
       *   2102084427903860755:  6812 字 → 295 字
       * 同批的长推(957 字)和普通推(241 字)毫发无伤 —— 只有长文中招。
       *
       * ── 真因 ──
       * 主页时间线(「UserOriginalsTimeline「)给的长文**只有 title + preview_text**,
       * 而这里 「text = $text「 是**无条件覆盖** → **浅数据盖掉深数据**。
       *
       * ⭐⭐ 这是 2026-09-21 修 bug ④(「INSERT IGNORE「 → 「ON DUPLICATE「)
       * **换来的副作用**:那次只想到「补全(空→有)」,没想到「降级(深→浅)」。
       * ⚠️ 「INSERT IGNORE「 时代反而不会丢 —— 修一个 bug 开了另一个洞。
       *
       * ── 为什么判据是「长度」而不是「是不是长文」──
       * 采集侧分不清「这次拿到的是全文还是摘要」(同一个 「article「 字段,
       * 不同接口深度不同,见 x-collect-journal 的实测)。
       * **长度是唯一不依赖接口语义的判据**:更长 = 信息更多,永远不亏。
       *
       * ⚠️ 「?? ''「 不能省:老行 「text「 可能是 NONE,
       * 「string::len(NONE)「 会**抛错**(实测 "Expected string but found NONE"),
       * 整条 upsert 会失败。
       */
      text = IF string::len($text ?? '') > string::len(text ?? '') THEN $text ELSE text END,
      author_name_at_post = $author_name_at_post,
      author_handle = $author_handle,
      author_avatar = $author_avatar,
      tweet_url = $tweet_url,
      lang = $lang,
      metrics = $metrics,
      fetched_at = $fetched_at,
      created_at = $created_at,
      in_reply_to = $in_reply_to,
      in_reply_to_user = $in_reply_to_user,
      conversation_id = $conversation_id`,
    {
      tweet_id: record.tweet_id,
      text: record.text,
      // 发推当时的展示名快照(与 x_author.display_name 语义不同 —— 后者是当前名,会变)
      /** ⚠️ 两个来源都认:toRecord 走 author_name_at_post,别的路径走 author_name */
      author_name_at_post: record.author_name_at_post || record.author_name || undefined,
      author_handle: record.author_handle,
      author_avatar: record.author_avatar ?? undefined,
      tweet_url: record.tweet_url ?? undefined,
      lang: record.lang ?? undefined,
      metrics: record.metrics,
      fetched_at: new Date(record.fetched_at),
      // A':extract 早就提取了这两个字段,只是组装记录时没带上
      created_at: record.created_at ? new Date(record.created_at) : undefined,
      in_reply_to: record.in_reply_to ?? undefined,
      in_reply_to_user: record.in_reply_to_user ?? undefined,
      /**
       * ⭐⭐ **会话根** —— 2026-09-21 实测:这个字段在 schema(带索引)、
       * 解析器、TweetInboxRecord 类型、toRecord 里**都补齐了**,
       * 唯独**这条写库语句**(第四处)没跟上 → 库里仍然恒空。
       *
       * ⚠️ 现象极具迷惑性:同一批里 tweet_url / author_avatar 都写进去了,
       * 只有它是空的 —— 因为那两个在这张清单里,它不在。
       * ⭐ 「清单不会自己长」在这里是**第四刀**:一个字段要在四处都登记
       * (schema / 类型 / toRecord / 本语句),漏任何一处都**静默丢失**。
       */
      conversation_id: record.conversation_id ?? undefined,
      // ⚠️ undefined → NONE(永久保留);绝不写 null —— option<T> 只认 NONE,NULL 会被拒
      expires_at: record.expires_at ? new Date(record.expires_at) : undefined,
      source: record.source,
      search_recipe: record.search_recipe ?? undefined,
      task_id: record.task_id ?? DEFAULT_TASK_ID,
      ws_id: record.ws_id ?? undefined,
      filter_score: record.filter_score,
      filter_reason: record.filter_reason ?? undefined,
      ai_verdict: record.ai_verdict ?? undefined,
      translation: record.translation ?? undefined,
      status: record.status,
      accepted: record.accepted ?? undefined,
      accepted_at: record.accepted_at ? new Date(record.accepted_at) : undefined,
      replied: record.replied ?? false,
      replied_at: record.replied_at ? new Date(record.replied_at) : undefined,
      reply_draft: record.reply_draft ?? undefined,
      backfilled: record.backfilled ?? false,
    },
  );
}

/** 写入 filtered_out 推文（status=filtered_out，不触发 AI 判断） */
export async function insertFilteredOut(
  record: Omit<TweetInboxRecord, 'status' | 'filter_score' | 'ai_verdict'> & { filter_reason: string },
): Promise<void> {
  await upsertTweet({
    ...record,
    status: 'filtered_out',
    filter_score: 0,
    ai_verdict: undefined,
  });
}

/** 取已存在的 tweet_id 集合（去重用）
 *
 *  不限时间窗:人工拒绝(skip)过、采纳过的推文都永远不再重新抓入。
 *
 *  ⚠️ A 期修掉的重复爬根因:原签名收了 `_windowHours` 却**根本没用**
 *  (函数体直接全表扫),于是去重范围恒等于 inbox 存活的 7 天 —— 采纳的推文
 *  一旦过期就会被当成新推文重新抓回来。现在 x_tweet 里永久行不会消失,
 *  去重集合天然覆盖全部历史;那个从未生效的参数一并删掉,不留误导。
 */
export async function getTweetIdSet(): Promise<Set<string>> {
  const db = getXDB();
  const res = await db.query<[Array<{ tweet_id: string }>]>(
    `SELECT tweet_id FROM x_tweet`,
  );
  const rows = res[0] ?? [];
  return new Set(rows.map((r) => r.tweet_id));
}

/** 查询 pending 推文（AI 判断前批量拉取）
 *  - 传 wsId → 只取该 ws 的 pending（AI 判断 per-ws 隔离，防跨 ws 混批）
 *  - 不传 wsId → 保持原全局行为（向后兼容）
 */
export async function queryPending(limit = 50, wsId?: string): Promise<TweetInboxRecord[]> {
  const db = getXDB();
  const wsFilter = wsId ? 'AND ws_id = $wsId' : '';
  // ⭐ **人工处理过的一律不送 AI**(用户 2026-09-02:
  // 「如果我都手工研判过了,Gemma4 就不应该再处理,而是认可人工的处理结果」)。
  // 三种「已处理」都要排除:
  //  · accepted 非空  = 已人工采纳/拒绝
  //  · replied  = true = 我已经回复过(回过就是最强的表态)
  //  · ai_verdict.reason 以 human: 开头 = 人工判定的快照
  // 此前只筛 status='pending',这些行照样会被送去判 ——
  // 既浪费算力(队列已积压 842 条、要跑 4 小时),又可能让机器判定覆盖人工结论。
  const res = await db.query<[TweetInboxRecord[]]>(
    `SELECT * FROM x_tweet
     WHERE status = 'pending'
       AND accepted = NONE
       AND replied != true
       AND (ai_verdict = NONE OR !string::starts_with(ai_verdict.reason, 'human:'))
       ${wsFilter}
     ORDER BY fetched_at ASC LIMIT $limit`,
    { limit, wsId: wsId ?? null },
  );
  return res[0] ?? [];
}

/**
 * 数一下还有多少条待判 —— 与 queryPending **同一套排除条件**。
 *
 * 用途:调度器判断有无存量积压。两处判据必须一致,否则会出现
 * 「数出来有积压、捞的时候是空」的空转(或反过来漏掉真积压)。
 */
export async function countPending(wsId?: string): Promise<number> {
  const db = getXDB();
  const wsFilter = wsId ? 'AND ws_id = $wsId' : '';
  const res = await db.query<[Array<{ c: number }>]>(
    `SELECT count() AS c FROM x_tweet
     WHERE status = 'pending'
       AND accepted = NONE
       AND replied != true
       AND (ai_verdict = NONE OR !string::starts_with(ai_verdict.reason, 'human:'))
       ${wsFilter}
     GROUP ALL`,
    { wsId: wsId ?? null },
  );
  return res[0]?.[0]?.c ?? 0;
}

/** 将一批推文状态更新为 ai_judging */
export async function markAiJudging(tweetIds: string[]): Promise<void> {
  if (tweetIds.length === 0) return;
  const db = getXDB();
  await db.query(
    `UPDATE x_tweet SET status = 'ai_judging' WHERE tweet_id IN $ids`,
    { ids: tweetIds },
  );
}

/**
 * 启动自愈:把卡在 ai_judging 的推文退回 pending。
 *
 * `ai_judging` 是「AI 判断已领取、结果未写回」的中间态。正常路径下
 * updateVerdict 会把它推向 worth/skip,Ollama 调用失败也会显式退回 pending
 * (x-ai-judge.ts)。但**进程直接没了**就没人管了 —— app 退出、sidecar 崩溃、
 * 被 kill,这些行会永远停在 ai_judging:不会被重判(queryPending 只捞 pending),
 * 也不会出现在收件箱里(UI 视图筛的是 worth/skip),等于静默丢失。
 * 2026-09-01 实测有 10 条这样卡住。
 *
 * 为什么无条件退回、不设时间阈值:**启动那一刻不可能有正在跑的批次**
 * (判断任务不跨进程存活),所以不存在误伤正在处理的行。
 * 加 ai_judging_at 时间戳 + 阈值反而要多一条 migration,还多一个要调的参数,
 * 换不来额外的正确性。
 *
 * @returns 退回的行数(0 表示没有卡住的,属正常)
 */
export async function recoverStuckAiJudging(): Promise<number> {
  const db = getXDB();
  const res = await db.query<[Array<{ tweet_id: string }>]>(
    `UPDATE x_tweet SET status = 'pending' WHERE status = 'ai_judging' RETURN tweet_id`,
  );
  return (res[0] ?? []).length;
}

/** 写回 AI 判断结果（worth / skip）+ 可选翻译。
 *
 *  **仅供 Gemma 的机器判断使用** —— 它不改 expires_at,机器判 worth 的推文
 *  仍按 7 天窗口过期。人工表态请走 `applyHumanVerdict`(那条才置永久)。
 */
export async function updateVerdict(tweetId: string, verdict: AIVerdict): Promise<void> {
  const db = getXDB();
  const status: TweetInboxStatus = verdict.worth ? 'worth' : 'skip';
  await db.query(
    `UPDATE x_tweet SET ai_verdict = $verdict, status = $status, translation = $translation WHERE tweet_id = $tweet_id`,
    { verdict, status, translation: verdict.translation ?? undefined, tweet_id: tweetId },
  );
}

/**
 * 人工表态(采纳/拒绝)—— **A 期止血的落点**。
 *
 * 与 updateVerdict 分开是刻意的:两者写的是不同层次的东西。
 *   - updateVerdict     = Gemma 的机器判断,可被推翻,不影响留存
 *   - applyHumanVerdict = 我的最终态度,不可重算,且**采纳即永久**
 * 用「reason 以 human: 开头」来嗅探人工意图是脆的(字符串约定会漂),
 * 所以这里走独立函数、显式语义。
 *
 * accept → expires_at = NONE(永久保留,TTL 跳过)+ accepted = true
 * reject → 保持原有过期时间(拒绝的推文没有长期留存价值,但 tweet_feedback
 *          里的标注记录仍在 —— 那才是训练/评估的真源)
 */
export async function applyHumanVerdict(
  tweetId: string,
  verdict: FeedbackVerdict,
): Promise<void> {
  const db = getXDB();
  const accepted = verdict === 'accept';
  const status: TweetInboxStatus = accepted ? 'worth' : 'skip';
  const aiVerdict: AIVerdict = {
    worth: accepted,
    confidence: 1,
    reason: `human:${verdict}`,
    tags: [],
    suggestReply: accepted,
  };
  if (accepted) {
    await db.query(
      `UPDATE x_tweet SET ai_verdict = $aiVerdict, status = $status,
         accepted = true, accepted_at = time::now(), expires_at = NONE
       WHERE tweet_id = $tweet_id`,
      { aiVerdict, status, tweet_id: tweetId },
    );
  } else {
    await db.query(
      `UPDATE x_tweet SET ai_verdict = $aiVerdict, status = $status, accepted = false
       WHERE tweet_id = $tweet_id`,
      { aiVerdict, status, tweet_id: tweetId },
    );
  }
}

/** queryInbox / countInbox 的公共切片条件 */
export interface InboxFilter {
  status?: TweetInboxStatus;
  statuses?: TweetInboxStatus[];   // 多状态 IN 过滤（与 status 互斥，优先级更高）
  wsId?: string;
  lang?: string;
  searchRecipe?: string;           // 按配方切片
  taskId?: string;                 // 按处理任务维度切片（阶段B恒 'judge-value'）
  humanReviewed?: boolean;         // true=只要人工确认过的(ai_verdict.reason 为 human:*)；
                                   // false=只要 Gemma 原判未复核的；缺省=不过滤
  /** true(默认)=剔除已屏蔽作者/自己的推文。仅影响**显示**,历史数据一行不删。 */
  excludeHidden?: boolean;
  /** true=只看已回复过的;false=只看没回复的(排重复回复);缺省=不过滤 */
  replied?: boolean;
}

/**
 * 构造 WHERE 子句 + 绑定参数 —— **列表与计数唯一的条件来源**。
 *
 * ⚠️ 为什么必须共用而不是各写一份:徽章数字与列表内容一旦用两套条件,
 * 就会出现「徽章说有 12 条、点进去只有 8 条」这种对不上的账,
 * 而且不报错。countPending/queryPending 早就踩过同一个坑(见上方注释:
 * 「数出来有积压、捞的时候是空」),那里是靠注释约定,这里直接共用代码。
 */
function buildInboxWhere(opts: InboxFilter): {
  where: string;
  /** true = WHERE 里含 $hidden,调用方**必须**加 HIDDEN_PRELUDE 并把结果下标后移一位 */
  needsHidden: boolean;
  vars: Record<string, unknown>;
} {
  const conditions: string[] = [];
  if (opts.statuses?.length)       conditions.push('status IN $statuses');
  else if (opts.status)            conditions.push('status = $status');
  if (opts.wsId)                   conditions.push('ws_id = $wsId');
  if (opts.lang)                   conditions.push('lang = $lang');
  if (opts.searchRecipe)           conditions.push('search_recipe = $searchRecipe');
  if (opts.taskId)                 conditions.push('task_id = $taskId');
  if (opts.humanReviewed === true)
    conditions.push(`ai_verdict != NONE AND string::starts_with(ai_verdict.reason, 'human:')`);
  else if (opts.humanReviewed === false)
    conditions.push(`ai_verdict != NONE AND !string::starts_with(ai_verdict.reason, 'human:')`);

  // 屏蔽者 / 自己发的推:**只从面板隐藏,绝不删数据**。
  // 「不再爬」约束未来(B 期 accountBlacklist),「不再显示」约束呈现 —— 两件事。
  // 解除屏蔽后这些行会原样回到列表,是过滤不是删除。
  //
  // ⭐⭐ 这一条**必须配合 HIDDEN_PRELUDE 使用**,右侧只能是 $hidden 变量,
  // 绝不能把 (SELECT … FROM x_author …) 内联写在这里。
  //
  // 2026-09-14 实测(11684 行 x_tweet / 35 个屏蔽者):
  //   内联子查询  → 22.07s     ← 每行都把右侧子查询重算一遍
  //   LET 绑定后  → 0.027s     ← 只算一次,之后是常量比对
  // 差约 800 倍。这**不是**索引问题,也不是 NOT IN 本身慢:
  // 把右侧换成硬编码字面量数组同样是 26ms。真因就是「内联子查询按行重算」。
  //
  // ⚠️ 别再把 handle 包成 string::replace(string::lowercase(…)):
  // 实测两侧本来就都是归一化的(x_tweet 11739 行 0 条带 @、0 条含大写,
  // x_author 同样),包一层既无必要又让字段吃不到 idx_tweet_author。
  if (opts.excludeHidden !== false) {
    conditions.push('author_handle NOT IN $hidden');
  }

  // 已回复过滤:采纳与回复是两件事,一条推可能已采纳但没回、
  // 也可能回过却还挂在待判里 —— 用户要能把回过的挑出去,避免重复回复
  if (opts.replied === true) conditions.push('replied = true');
  else if (opts.replied === false) conditions.push('replied != true');

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return {
    where,
    needsHidden: opts.excludeHidden !== false,
    vars: {
      status: opts.status,
      statuses: opts.statuses ?? null,
      wsId: opts.wsId ?? null,
      lang: opts.lang ?? null,
      searchRecipe: opts.searchRecipe ?? null,
      taskId: opts.taskId ?? null,
    },
  };
}

/**
 * 隐藏名单的 LET 前缀 —— 把「屏蔽者/自己」这个集合**只算一次**。
 *
 * 必须与 `author_handle NOT IN $hidden` 成对出现:少了它,$hidden 未定义,
 * 条件会静默变成「NOT IN 空」从而**放行所有行**(屏蔽失效且不报错);
 * 把它换回内联子查询则退回 22s。两种坏法都不报错,所以由
 * tests/x/inbox-exclude-hidden.test.ts 钉死。
 */
const HIDDEN_PRELUDE =
  'LET $hidden = (SELECT VALUE handle FROM x_author WHERE blocked = true OR is_self = true);\n';

/** 查询 tweet_inbox（Review Queue 用，支持按 status / lang 过滤） */
export async function queryInbox(opts: InboxFilter & {
  orderBy?: 'fetched_at' | 'confidence';  // confidence=按 Gemma 置信度升序（漏判抽查视图用）
  limit?: number;
  offset?: number;
}): Promise<TweetInboxRecord[]> {
  const db = getXDB();
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const { where, vars, needsHidden } = buildInboxWhere(opts);
  const order = opts.orderBy === 'confidence' ? 'ai_verdict.confidence ASC' : 'fetched_at DESC';

  // LET 前缀必须和 $hidden 同时出现 —— 见 HIDDEN_PRELUDE 注释(22s → 0.03s)
  const prelude = needsHidden ? HIDDEN_PRELUDE : '';
  const res = await db.query<[TweetInboxRecord[]] | [unknown, TweetInboxRecord[]]>(
    `${prelude}SELECT * FROM x_tweet ${where} ORDER BY ${order} LIMIT $limit START $offset`,
    { ...vars, limit, offset },
  );
  // 有 LET 时结果数组第 0 位是 LET 自身的结果,真正的行在第 1 位
  const rows = (needsHidden ? res[1] : res[0]) as TweetInboxRecord[] | undefined;
  return rows ?? [];
}

/**
 * 数一批切片各有多少条 —— 侧栏徽章专用,**一次问完,不拉行**。
 *
 * ⚠️ 这是在修一个具体的性能坑:此前徽章数字是靠
 * `queryInbox({ limit: 5000 }).records.length` 算的 —— 为了显示一个整数,
 * 把最多 5000 行**完整推文**(含 text/ai_verdict/translation 全文)
 * 拉过 IPC、过一遍 JSON.parse(JSON.stringify()),到了 renderer 只读 .length
 * 然后整个数组立刻丢弃。四个视图并发跑,每次点侧栏都重来一遍。
 *
 * 附带修掉的第二个缺陷:`limit: 5000` 是个**静默的天花板** ——
 * 超过 5000 的切片会把数字截在 5000 且不报错(实测「漏判抽查」已到 4769,
 * 正在逼近)。count() 没有上限,这个假象不会再出现。
 *
 * 用 GROUP ALL 多语句一次往返;条件与 queryInbox 共用 buildInboxWhere,
 * 保证徽章数字与点进去看到的列表是同一套判据。
 *
 * ⭐ 五条语句共用**一个** LET $hidden:实测整批 33s → 0.07s。
 */
export async function countInbox(
  slices: Array<{ key: string; filter: InboxFilter }>,
): Promise<Record<string, number>> {
  if (slices.length === 0) return {};
  const db = getXDB();

  // 每个切片一条 count 语句;各自的绑定变量加 key 前缀,避免互相覆盖
  const stmts: string[] = [];
  const vars: Record<string, unknown> = {};
  let anyHidden = false;
  slices.forEach(({ filter }, i) => {
    const { where, vars: v, needsHidden } = buildInboxWhere(filter);
    if (needsHidden) anyHidden = true;
    // $status → $status_0,与该切片的语句一一对应。
    // ⚠️ $hidden 是 LET 定义的共享变量,**不能**加下标 —— 排除掉。
    const scoped = where.replace(/\$(\w+)/g, (_m, name) => (
      name === 'hidden' ? '$hidden' : `$${name}_${i}`
    ));
    for (const [k, val] of Object.entries(v)) vars[`${k}_${i}`] = val;
    stmts.push(`SELECT count() AS c FROM x_tweet ${scoped} GROUP ALL;`);
  });

  // LET 只发一次,五条 count 复用它
  const prelude = anyHidden ? HIDDEN_PRELUDE : '';
  const res = await db.query<Array<Array<{ c: number }>>>(prelude + stmts.join('\n'), vars);
  // 有 LET 时结果整体后移一位
  const base = anyHidden ? 1 : 0;
  const out: Record<string, number> = {};
  slices.forEach(({ key }, i) => { out[key] = res[base + i]?.[0]?.c ?? 0; });
  return out;
}

/** 标记推文已回复（已确认视图清场用）
 *
 *  **回复即永久**:同时把 expires_at 置 NONE,让 cleanExpired 跳过这行。
 *  回复过的推文是画像素材(我和谁互动过),丢了不可再生。
 */
export async function markReplied(tweetId: string): Promise<void> {
  const db = getXDB();
  await db.query(
    `UPDATE x_tweet SET status = 'replied', replied = true, replied_at = time::now(),
       expires_at = NONE
     WHERE tweet_id = $tweet_id`,
    { tweet_id: tweetId },
  );
}

export interface FeedbackStats {
  suggestedTotal: number;     // 近7天:带 Gemma worth 快照且被人工表态的条数
  suggestedAccepted: number;  // 其中人工 ✓ 的条数(精确率分子)
  rescuedFn: number;          // 近7天:Gemma 判 skip 但人工捞回 ✓ 的条数(漏判)
}

/** 近 7 天 Gemma 建议 vs 人工表态的统计（靠 tweet_feedback.ai_verdict 快照,migration 1.8.7 起有数据） */
export async function getFeedbackStats(): Promise<FeedbackStats> {
  const db = getXDB();
  const res = await db.query<[Array<{ c: number }>, Array<{ c: number }>, Array<{ c: number }>]>(
    `SELECT count() AS c FROM tweet_feedback WHERE created_at > time::now() - 7d AND ai_verdict != NONE AND ai_verdict.worth = true GROUP ALL;
     SELECT count() AS c FROM tweet_feedback WHERE created_at > time::now() - 7d AND ai_verdict != NONE AND ai_verdict.worth = true AND verdict = 'accept' GROUP ALL;
     SELECT count() AS c FROM tweet_feedback WHERE created_at > time::now() - 7d AND ai_verdict != NONE AND ai_verdict.worth = false AND verdict = 'accept' GROUP ALL;`,
  );
  return {
    suggestedTotal:    res[0]?.[0]?.c ?? 0,
    suggestedAccepted: res[1]?.[0]?.c ?? 0,
    rescuedFn:         res[2]?.[0]?.c ?? 0,
  };
}

/** TTL 清理：删除 expires_at 已过期的推文 */
/** TTL 清理。
 *
 *  `expires_at` 为 NONE 的行(采纳/回复过的永久行)**不满足** `expires_at < time::now()`,
 *  因此天然被跳过 —— 这正是 A 期止血依赖的机制。改这条语句前先想清楚这点。
 */
/**
 * TTL 清理 —— **已停用**(用户 2026-09-02 拍板:X 推文永久保存)。
 *
 * 为什么保留这个函数而不是删掉:调用点在调度器里(每 24h + 启动时各一次),
 * 保留成 no-op 比拆掉调用链更安全,也留下「这里曾经会删数据」的痕迹。
 * 将来真要做容量治理(用户:「等容量到了一定的程度,再考虑迁移新的架构」),
 * 应该是**迁移到冷存储**,而不是恢复这里的 DELETE。
 *
 * ⚠️ 绝不要简单地把 DELETE 加回来:
 *   A 期就因 TTL 丢过 449 条已采纳推文的正文(不可再生);
 *   而被 Gemma 判 skip / 被黑名单过滤的推,是竞品分析与语料素材,
 *   同样不可再生。删除是不可逆操作,恢复它需要明确的产品决策。
 */
export async function cleanExpired(): Promise<void> {
  // no-op:保留调用点,不再删除任何数据
  return;
}

/** 查询缺翻译的非中文推文（补填用） */
export async function queryMissingTranslation(limit = 100): Promise<Array<{ tweet_id: string; text: string; lang: string }>> {
  const db = getXDB();
  // lang 不是 zh/zh-Hans/zh-Hant，且 translation 缺失
  const res = await db.query<[Array<{ tweet_id: string; text: string; lang: string }>]>(
    `SELECT tweet_id, text, lang FROM x_tweet
     WHERE (lang IS NOT NONE AND lang != 'zh' AND lang != 'zh-Hans' AND lang != 'zh-Hant')
       AND (translation IS NONE OR translation = '')
     LIMIT $limit`,
    { limit },
  );
  return res[0] ?? [];
}

/** 写回单条翻译 */
export async function setTranslation(tweetId: string, translation: string): Promise<void> {
  const db = getXDB();
  await db.query(
    `UPDATE x_tweet SET translation = $translation WHERE tweet_id = $tweet_id`,
    { translation, tweet_id: tweetId },
  );
}

/** 写入人工反馈（accept / reject），允许同一 tweet_id 多次投票 */
export async function insertFeedback(fb: TweetFeedback): Promise<void> {
  const db = getXDB();
  await db.query(
    `INSERT INTO tweet_feedback {
      tweet_id:      $tweet_id,
      text:          $text,
      lang:          $lang,
      author_handle: $author_handle,
      verdict:       $verdict,
      reason_tag:    $reason_tag,
      source_recipe: $source_recipe,
      created_at:    $created_at,
      ai_verdict:    $ai_verdict
    }`,
    {
      tweet_id:      fb.tweet_id,
      text:          fb.text,
      lang:          fb.lang ?? undefined,
      author_handle: fb.author_handle,
      verdict:       fb.verdict,
      reason_tag:    fb.reason_tag ?? undefined,
      source_recipe: fb.source_recipe ?? undefined,
      created_at:    new Date(fb.created_at),
      ai_verdict:    fb.ai_verdict ?? undefined,
    },
  );
}

/**
 * 取 Gemma 对某推文的原始判断（准确率对账用）。
 * tweet_inbox.ai_verdict 会被人工标注覆盖成 reason='human:*'（见 X_SUBMIT_FEEDBACK），
 * 覆盖态不是 Gemma 的判断 → 返回 undefined；重复投票时上一次的覆盖态也因此不会被误抄。
 */
export async function getGenuineAiVerdict(tweetId: string): Promise<AIVerdict | undefined> {
  const db = getXDB();
  const res = await db.query<[Array<{ ai_verdict?: AIVerdict }>]>(
    `SELECT ai_verdict FROM x_tweet WHERE tweet_id = $tweet_id LIMIT 1`,
    { tweet_id: tweetId },
  );
  const verdict = res[0]?.[0]?.ai_verdict;
  if (!verdict || typeof verdict.reason !== 'string' || verdict.reason.startsWith('human:')) return undefined;
  return verdict;
}

/** 查询 feedback 样本（Phase 3b few-shot 用） */
export async function queryFeedbackSamples(opts: {
  verdict: FeedbackVerdict;
  lang?: string;
  limit?: number;
}): Promise<TweetFeedback[]> {
  const db = getXDB();
  const limit = opts.limit ?? 20;
  const conditions = ['verdict = $verdict'];
  if (opts.lang) conditions.push('lang = $lang');
  const where = `WHERE ${conditions.join(' AND ')}`;
  const res = await db.query<[TweetFeedback[]]>(
    `SELECT * FROM tweet_feedback ${where} ORDER BY created_at DESC LIMIT $limit`,
    { verdict: opts.verdict, lang: opts.lang ?? null, limit },
  );
  return res[0] ?? [];
}


/**
 * 存下这条推的**上文**(父推正文)。
 *
 * ⭐ 用户 2026-09-06:「每一个它建议的,都应该获取上下文。」
 * 上文是①闸门的输入。此前只在点开弹窗时现抓 —— 每条现等 10s;
 * 建议名单是可预知的,提前批量抓好、存起来,点开就有。
 *
 * ⚠️ 存的是**抓到那一刻的快照**:父推可能被删或改,快照保留我们当时判断的依据
 *    (与 author_name_at_post 同一思路)。
 */
export async function setParentContext(
  tweetId: string, parentText: string, parentHandle?: string,
): Promise<void> {
  if (!tweetId || !parentText?.trim()) return;   // 空上文没有存的价值
  // ⚠️ 只写 x_tweet。`tweet_inbox` 是**遗留表**:全仓所有读写(upsertTweet /
  //    queryInbox / countPending …)走的都是 x_tweet,那张表早已没人维护
  //    (2026-09-06 实测:x_tweet 有 ws-1 今天采的 112 条,tweet_inbox 里 0 条、
  //     最新数据停在 5 天前)。我第一版写了 tweet_inbox,等于写进一张死表 ——
  //    不报错、也永远读不到,正是最难查的那种。
  await getXDB().query(
    `UPDATE x_tweet SET parent_text = $t, parent_handle = $h,
       parent_fetched_at = time::now() WHERE tweet_id = $id`,
    { id: tweetId, t: parentText.trim().slice(0, 1000), h: parentHandle ?? undefined },
  );
}

/**
 * ⭐⭐ **回读刚写进去的推** —— 「成功要对账」(可靠性纲领铁律四)。
 *
 * ── 为什么需要它 ──
 *
 * 采集报告里的 `coverage` 量的是**解析出来的内存对象**,
 * 而入库要经过 `toRecord()` 转换 —— **解析对了不代表存对了**。
 *
 * 实测 2026-09-21:`conversation_id` 在 schema 里有列(还带索引)、
 * 解析器也解出了值,唯独 `TweetInboxRecord` 类型没声明 → 写不进去 →
 * 库里那一列**恒空**。三处各自看都正常,只有端到端回读才看得出来。
 *
 * ⚠️ 只按 tweet_id 取需要的列,不 `SELECT *`:
 * 回读是诊断,不该把几千条完整行搬进内存。
 */
export async function readBackTweets(
  tweetIds: string[],
): Promise<Array<Record<string, unknown>>> {
  if (tweetIds.length === 0) return [];
  const db = getXDB();
  const res = await db.query<[Array<Record<string, unknown>>]>(
    `SELECT tweet_id, text, author_handle, author_avatar, author_name_at_post,
            tweet_url, created_at, lang, metrics, conversation_id,
            in_reply_to, in_reply_to_user
       FROM x_tweet WHERE tweet_id IN $ids`,
    { ids: tweetIds },
  );
  return res[0] ?? [];
}
