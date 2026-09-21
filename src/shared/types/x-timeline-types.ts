/**
 * X 时间线智能筛选 — 共享类型（Phase 1）
 *
 * 独立文件，不扩展 AIServiceProfile（铁律 2）。
 */

export type RecipeTemplate = 'trending' | 'vip-tracking' | 'help-wanted' | 'custom';

/** 默认处理任务维度：阶段 B 只有「判断价值」一个动作，恒填此值；阶段 C 起为工单 task_id */
export const DEFAULT_TASK_ID = 'judge-value';

export interface SearchRecipe {
  id: string;                    // ULID
  name: string;
  enabled: boolean;
  template: RecipeTemplate;
  keywords?: string[];           // OR 关系
  fromAccounts?: string[];       // from:xxx
  helpSignals?: string[];        // 求助信号词（help-wanted 模板）
  minLikes?: number;
  minRetweets?: number;
  lang?: string;                 // 'en' | 'zh' 等
  sinceHours?: number;           // 默认 24
  resultType: 'latest' | 'top';
  /**
   * 是否连回复一起抓(追踪名单需要:设计 §4.4⑤ 要「推文和回复」都追)。
   *
   * ✅ 语法已实机验证(2026-09-06):用 `filter:replies`。
   * `include:replies` **X 已不支持**,加上去结果会变 0 条(静默,不报错)。
   * 实测:from: 裸查 12 条/回复 11,+filter:replies 22 条/回复 22。
   */
  includeReplies?: boolean;
  intervalMinutes: number;
  lastRunAt?: string;            // ISO datetime
}

/**
 * handle 归一化:去 @ 前缀 + 转小写。
 *
 * ⚠️ 写 x_author 与 applyFilter 比对**必须共用本函数** ——
 * 两端各写一份归一化逻辑迟早漂移,而漂移的表现是
 * 「屏蔽点了没反应、且不报错」这种最难查的静默失效。
 *
 * 背景(实测 2026-09-01):x_tweet.author_handle 实际存的是
 * '@Miekko22' —— 带 @ 前缀、保留原始大小写。而 x_author.handle
 * 上有 idx_author_handle UNIQUE 索引,不归一化则 Foo/foo 会成两行,
 * 同一个人被屏蔽两次只生效一次。
 */
export function normalizeHandle(h: string): string {
  return h.trim().replace(/^@+/, '').toLowerCase();
}

export interface TimelineFilterConfig {
  /**
   * 正文必须命中其中之一才入库 —— **对 X 搜索结果的兜底校验**。
   *
   * ⚠️ 2026-09-07 实测:X 搜索返回的推里大量既不含关键词、也不含求助信号
   * (最新 30 条只有 3 条命中)。此前采集完全信任 X,「给什么存什么」——
   * 一旦落错页面或 X 放宽匹配,整批噪音进库并占用 Gemma 判断额度。
   * 留空 = 不校验(全量收集场景)。
   */
  requireKeywords?: string[];
  keywordBlacklist: string[];
  /** ⚠️ 契约:存**已归一化**的 handle(经 normalizeHandle),不带 @、全小写。
   *  塞原始串进来会导致比对恒不命中且不报错。数据源见 x-author-repo.getBlockedHandleSet() */
  accountBlacklist: string[];
  minLikes: number;
  minRetweets: number;
  allowedLangs: string[];        // 空 = 不过滤语言
  dedupeWindowHours: number;     // 默认 48
}

export interface JudgeConfig {
  model: string;                 // 默认 'gemma4:31b-it-qat'
  ollamaEndpoint: string;        // 默认 'http://localhost:11434'
  batchSize: number;             // 积累多少条 pending 触发一次批判断，默认 10
  maxWaitMinutes: number;        // 未满 batchSize 但超时也触发，默认 15
  concurrency: number;           // 默认 1（本机串行更稳）
  timeoutMs: number;             // 单次推理超时，默认 30000
}

export interface AIVerdict {
  worth: boolean;
  confidence: number;            // 0.0 – 1.0
  reason: string;                // 一句话
  tags: string[];
  suggestReply: boolean;
  translation?: string;          // 非中文推文的中文翻译（Gemma 顺带输出）
}

export type TweetInboxStatus =
  | 'pending'
  | 'filtered_out'
  | 'ai_judging'
  | 'worth'
  | 'skip'
  | 'replied'
  /**
   * ⭐ 已入库,但**本来就不该进 AI 判断队列**(2026-09-14,用户拍板「乙」)。
   *
   * 目前唯一来源:`source='watchlist'` 的盯人采集。schema 那条规则
   * (`x-schema.ts:97`)说的是「不置 pending,否则刷爆 Gemma 队列」——
   * 但它只说了**不该是什么**,没说该是什么,于是这个状态此前**不存在**。
   *
   * ⚠️ 为什么不复用现有的:
   *  · `filtered_out` **语义撒谎** —— 它不是被漏斗过滤掉的,是根本没送去判断;
   *    且会混进「过滤掉多少」的统计里
   *  · 沿用 `pending` 靠 source 排除 → 队列判据分散成两处,
   *    正是本仓踩过的「数出来有积压、捞的时候是空」
   *
   * ⚠️ `status` 在 schema 里是 `TYPE string` 不是枚举,**新增值不需要 migration**。
   *
   * ⭐ 它不是终态:被人工采纳 / 回复后照常流转(见 applyHumanVerdict、
   * reconcileRepliedFromOwnReplies)。
   */
  | 'collected';

export interface TweetInboxRecord {
  tweet_id: string;
  text: string;
  author_name: string;
  author_handle: string;
  author_avatar?: string;
  tweet_url?: string;
  lang?: string;
  metrics: { likes?: number; retweets?: number; replies?: number; views?: number };
  fetched_at: string;            // ISO datetime — 我们抓到的时刻
  created_at?: string;           // 推文自身发布时间(A':extract 已提供)
  in_reply_to?: string;          // 父推 id(载荷层填);⚠️历史上取自 socialContext 故长期为空
  /** 被回复者 handle —— DOM 上「Replying to @xxx」那一行。非空 = 这是一条回复 */
  in_reply_to_user?: string;
  /** 上文快照:父推正文。预抓时落库,回复时直接用,免得每条现等 10s */
  parent_text?: string;
  parent_handle?: string;
  parent_fetched_at?: string;
  /** 到期时间。**undefined = 永久保留**(采纳/回复过的推文) —— TTL 清理会跳过。 */
  expires_at?: string;
  /**
   * 这条推是怎么来的。
   *
   * ⚠️⚠️ **2026-09-14 实测更正:此前类型与现实三方不符** ——
   *
   * | 来源 | 当时写的 |
   * |---|---|
   * | 本类型 | `'timeline' \| 'search'` |
   * | schema 注释(`x-schema.ts:97`) | `'search' \| 'watchlist'` |
   * | **实际写进库的** | `search` / `self_post` / `self_reply` |
   *
   * · `'timeline'` **全仓零写入点**,只活在这行类型里(死值)
   * · `self_post` / `self_reply` **真在写**却不在类型里 ——
   *   `x-reply-relation-repo` 直接拼 SQL,绕过了这个类型,所以 tsc 一直没发现
   *
   * ⭐ 现在如实列出真实取值。⚠️ 加新值前先 grep 实际写入点,别再凭这行猜。
   */
  source:
    /** 关键词配方采集 */
    | 'search'
    /** ⭐ 盯人采集(追踪名单)。⚠️ 不进 AI 判断队列 —— 见 status 的 'collected' */
    | 'watchlist'
    /** 我自己发的推(反向对账用) */
    | 'self_post'
    /** 我自己发的回复 —— 「我回复了谁」的权威记录 */
    | 'self_reply';
  search_recipe?: string;        // recipe.id
  task_id?: string;              // 处理任务维度，阶段B恒 'judge-value'，阶段C 起为工单 task
  ws_id?: string;                // workspace id（Phase 2 多窗口隔离）
  filter_score: number;          // 0-1，暂存 1.0
  filter_reason?: string;        // filtered_out 原因
  ai_verdict?: AIVerdict;
  translation?: string;          // 非中文推文的中文翻译（Gemma AI 判断时顺带输出）
  status: TweetInboxStatus;
  /** 人工最终态度:true=采纳 / false=拒绝 / undefined=未表态。与 status(流转状态)语义不同 */
  accepted?: boolean;
  accepted_at?: string;
  replied?: boolean;
  replied_at?: string;
  reply_draft?: string;
  author_name_at_post?: string;  // 发推当时的展示名快照
  backfilled?: boolean;          // true = 存量回填,非实时采集
  /**
   * ⭐⭐ **会话根** —— 这条推属于哪个会话(= 哪篇文章下面的)。
   *
   * ⚠️ 2026-09-21 实测暴露:schema 里**早就有这一列**(还带索引
   * `idx_tweet_conversation`),解析器也解出来了(`HarvestedTweet.conversationId`),
   * 唯独**这个类型没声明** → `toRecord` 写不进去 → 库里这一列恒空。
   * 现象:想把回复归到根推上时,发现库里根本没法关联。
   *
   * ⭐ 「schema 有、解析有、类型没有」是最难发现的一种丢失:
   * 三处各自看都正常,只有端到端对照才看得出来。
   */
  conversation_id?: string;
}

/** 默认过滤配置（初期硬编码，后期可做 UI 配置） */
export const DEFAULT_FILTER_CONFIG: TimelineFilterConfig = {
  keywordBlacklist: [],
  accountBlacklist: [],
  minLikes: 0,
  minRetweets: 0,
  allowedLangs: [],
  dedupeWindowHours: 48,
};

/** 默认 AI 判断配置 */
export const DEFAULT_JUDGE_CONFIG: JudgeConfig = {
  // ⭐ 2026-09-03 换成 26b MoE:同一批 10 条真实推文实测
  //    gemma4:31b-it-qat     252.5s
  //    gemma4:26b-a4b-it-qat 117.8s   ← **2.1x 快**
  //    质量:此前离线评测一致率 97.6%,与 31b 打平(见 x-ai-judge 顶部注释)。
  //    换模型是为了让判断跟上采集 —— 积压 842 条时 31b 要跑 4 小时以上,
  //    而采集仍在继续,队列只会越堆越高。
  //    ⚠️ 两个模型返回的 JSON 外层 key 不同(results vs tweets),
  //       parseVerdicts 取「第一个 key 的值」,故都能解析 —— 已核对。
  model: 'gemma4:26b-a4b-it-qat',
  ollamaEndpoint: 'http://localhost:11434',
  // 批量 10 → 25:单批固定开销(模型加载/prompt 处理)被更多条摊薄。
  // 不设更大是因为 batch 越大,单条超时失败时一起重来的代价越高。
  batchSize: 25,
  maxWaitMinutes: 15,
  concurrency: 1,
  // 26b 判 10 条约 2 分钟,25 条按线性外推约 5 分钟,留一倍余量。
  // ⚠️ 曾设 30s 导致每批必超时、判断静默全灭(pending 积压 2222 条的根因)——
  //    宁可设宽,超时失败比慢更致命。
  timeoutMs: 600_000,
};

export type FeedbackVerdict = 'accept' | 'reject';

export interface TweetFeedback {
  tweet_id: string;
  text: string;
  lang?: string;
  author_handle: string;
  verdict: FeedbackVerdict;       // 'accept' | 'reject'
  reason_tag?: string;            // 可选：用户点击时带的快速标签
  source_recipe?: string;         // 来自哪个 search_recipe id
  created_at: string;             // ISO datetime
  ai_verdict?: AIVerdict;         // Gemma 原始判断快照（标注时从 tweet_inbox 抄录；
                                  // tweet_inbox.ai_verdict 会被人工标注覆盖且 7 天 TTL 删除，
                                  // 此快照是准确率对账的唯一持久来源）
}
