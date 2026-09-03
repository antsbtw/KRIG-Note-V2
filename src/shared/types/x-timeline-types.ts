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
  | 'replied';

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
  in_reply_to?: string;          // 非空 = 这是一条回复,含被回复者 handle(A')
  /** 到期时间。**undefined = 永久保留**(采纳/回复过的推文) —— TTL 清理会跳过。 */
  expires_at?: string;
  source: 'timeline' | 'search';
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
