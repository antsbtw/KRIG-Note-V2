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

export interface TimelineFilterConfig {
  keywordBlacklist: string[];
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
  fetched_at: string;            // ISO datetime
  expires_at: string;            // fetched_at + 7 天
  source: 'timeline' | 'search';
  search_recipe?: string;        // recipe.id
  task_id?: string;              // 处理任务维度，阶段B恒 'judge-value'，阶段C 起为工单 task
  ws_id?: string;                // workspace id（Phase 2 多窗口隔离）
  filter_score: number;          // 0-1，暂存 1.0
  filter_reason?: string;        // filtered_out 原因
  ai_verdict?: AIVerdict;
  translation?: string;          // 非中文推文的中文翻译（Gemma AI 判断时顺带输出）
  status: TweetInboxStatus;
  replied_at?: string;
  reply_draft?: string;
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
  model: 'gemma4:31b-it-qat',
  ollamaEndpoint: 'http://localhost:11434',
  batchSize: 10,
  maxWaitMinutes: 15,
  concurrency: 1,
  timeoutMs: 30_000,
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
