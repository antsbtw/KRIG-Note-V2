# X 时间线智能筛选 Phase 1 实施 Prompt

> 总指挥：当前对话（验收方）
> 执行方：新对话（实现代码）
> 验收标准：见本文档末尾「验收清单」

---

## 你的任务

为 KRIG-Note-V2（Electron + React + SurrealDB）实现 **X 时间线智能筛选 Phase 1**，
包括：搜索配方驱动的推文批量采集、本地漏斗过滤、SurrealDB 持久化、Gemma 4 本地 AI 判断。

**不需要**实现 UI 面板（Review Queue 是 Phase 2 的事）。
**不需要**实现 Web AI 深度分析（Phase 3）。
Phase 1 的终态是：后台采集 → 漏斗过滤 → 存库 → AI 判断，全链路数据流跑通，结果可在 SurrealDB 里查询到。

---

## 项目背景

**产品**：KRIG-Note，Electron 桌面应用，personal knowledge management + AI 工具集成。

**已有的 X 集成基础**（不要重新造轮子，直接复用）：
- `src/platform/main/x/` — X 主进程模块，含 IPC handlers、webview 注入、内容提取
- `src/platform/main/tweet-fetcher/extract-script.ts` — 推文 DOM 提取脚本（`TWEET_SCRAPE_FN_BODY`），已验证可用
- `src/platform/main/web-service-base/` — webview 操作原语（registry/focus/注入），AI 和 X 共用
- `src/capabilities/x-extraction/` — X capability，含 `Host.tsx`（per-ws webview）、`types.ts`（`XTweetData` 定义）
- `src/shared/ipc/channel-names.ts` — IPC 通道常量，新增通道在此追加
- `src/shared/types/x-service-types.ts` — X selector 配置，`X_PROFILE.selectors.tweetElement = 'article[data-testid="tweet"]'`

**XTweetData 已有定义**（`src/capabilities/x-extraction/types.ts`）：
```typescript
interface XTweetData {
  authorName?: string;
  authorHandle?: string;
  authorAvatar?: string;
  text?: string;
  createdAt?: string;
  lang?: string;
  media?: Array<{ type: 'image' | 'video'; url: string; thumbUrl?: string }>;
  metrics?: { replies?: number; retweets?: number; likes?: number; views?: number };
  quotedTweet?: string;
  inReplyTo?: string;
  tweetUrl?: string;
  tweetId?: string;
}
```

**铁律（必须遵守）**：
1. 所有 webview 注入操作复用 `web-service-base`，不自己写 executeJavaScript 封装
2. X 不扩展 AIServiceProfile，新类型独立在 x-service-types 或新文件
3. 注入/采集失败 → fail loud（throw），不静默吞掉
4. 写方向红线：本 Phase 无写推文操作，不涉及
5. IPC 通道名统一在 `channel-names.ts` 定义，不散落在代码里

---

## 本机环境（已验证）

- **Ollama**：0.32.1，已通过 `brew services start ollama` 自启，端点 `http://localhost:11434`
- **Gemma 4 模型**（均已拉取）：
  - `gemma4:31b-it-qat`（18GB，主力）
  - `gemma4:26b-a4b-it-qat`（15GB，MoE 备用）
- **JSON 结构化输出已验证**：`response_format: { type: 'json_object' }` 稳定可用
- **关键已知问题**：Gemma 4 默认价值观会把 VPN 求助帖判为 skip（合规顾虑）。
  必须在 system prompt 里注入产品背景，才能让判断符合业务目标。

---

## 需要新增的文件

```
src/platform/main/x/
  x-timeline-scan.ts        ← 搜索配方驱动的批量推文采集
  x-search-scheduler.ts     ← 定时调度器，按 recipe.intervalMinutes 触发采集
  x-ai-judge.ts             ← Gemma 4 推文判断，调用 Ollama OpenAI 兼容接口

src/platform/main/local-llm/
  ollama-client.ts          ← 通用 Ollama 客户端（与 X 无关，未来 Agent 模块共用）

src/platform/main/db/
  tweet-inbox-repo.ts       ← tweet_inbox 表 CRUD
  search-recipe-repo.ts     ← search_recipes 表 CRUD

src/shared/types/
  x-timeline-types.ts       ← SearchRecipe / TimelineFilterConfig / JudgeConfig / AIVerdict 类型

src/shared/ipc/channel-names.ts
  ← 追加：X_SCAN_TIMELINE / X_RUN_RECIPE / X_AI_JUDGE_BATCH
```

---

## 数据模型

### SearchRecipe
```typescript
type RecipeTemplate = 'trending' | 'vip-tracking' | 'help-wanted' | 'custom';

interface SearchRecipe {
  id: string;                   // ULID
  name: string;
  enabled: boolean;
  template: RecipeTemplate;
  keywords?: string[];          // OR 关系
  fromAccounts?: string[];      // from:xxx
  helpSignals?: string[];       // 求助信号词（help-wanted 模板）
  minLikes?: number;
  minRetweets?: number;
  lang?: string;                // 'en' | 'zh' 等
  sinceHours?: number;          // 默认 24
  resultType: 'latest' | 'top';
  intervalMinutes: number;
  lastRunAt?: string;
}
```

### TimelineFilterConfig
```typescript
interface TimelineFilterConfig {
  keywordBlacklist: string[];
  accountBlacklist: string[];
  minLikes: number;
  minRetweets: number;
  allowedLangs: string[];       // 空 = 不过滤
  dedupeWindowHours: number;    // 默认 48
}
```

### JudgeConfig
```typescript
interface JudgeConfig {
  model: string;                // 默认 'gemma4:31b-it-qat'
  ollamaEndpoint: string;       // 默认 'http://localhost:11434'
  batchSize: number;            // 积累多少条 pending 触发一次批判断，默认 10
  maxWaitMinutes: number;       // 未满 batchSize 但超时也触发，默认 15
  concurrency: number;          // 默认 1（本机串行更稳）
  timeoutMs: number;            // 单次推理超时，默认 30000
}
```

### AIVerdict
```typescript
interface AIVerdict {
  worth: boolean;
  confidence: number;           // 0.0 – 1.0
  reason: string;               // 一句话
  tags: string[];
  suggestReply: boolean;
}
```

### TweetInboxRecord（落库结构，对应 tweet_inbox 表）
```typescript
interface TweetInboxRecord {
  tweet_id: string;
  text: string;
  author_name: string;
  author_handle: string;
  author_avatar?: string;
  tweet_url?: string;
  lang?: string;
  metrics: { likes?: number; retweets?: number; replies?: number; views?: number };
  fetched_at: string;           // ISO datetime
  expires_at: string;           // fetched_at + 7 天
  source: 'timeline' | 'search';
  search_recipe?: string;       // recipe.id
  filter_score: number;         // 0-1，暂存 1.0
  filter_reason?: string;       // filtered_out 原因
  ai_verdict?: AIVerdict;
  status: 'pending' | 'filtered_out' | 'ai_judging' | 'worth' | 'skip' | 'replied';
  replied_at?: string;
  reply_draft?: string;
}
```

---

## SurrealDB 建表 DDL

在项目启动时（主进程 db 初始化阶段）执行以下语句（参考现有 db 初始化的写法）：

```sql
-- tweet_inbox
DEFINE TABLE IF NOT EXISTS tweet_inbox SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS tweet_id        ON tweet_inbox TYPE string;
DEFINE FIELD IF NOT EXISTS text            ON tweet_inbox TYPE string;
DEFINE FIELD IF NOT EXISTS author_name     ON tweet_inbox TYPE string;
DEFINE FIELD IF NOT EXISTS author_handle   ON tweet_inbox TYPE string;
DEFINE FIELD IF NOT EXISTS author_avatar   ON tweet_inbox TYPE option<string>;
DEFINE FIELD IF NOT EXISTS tweet_url       ON tweet_inbox TYPE option<string>;
DEFINE FIELD IF NOT EXISTS lang            ON tweet_inbox TYPE option<string>;
DEFINE FIELD IF NOT EXISTS metrics         ON tweet_inbox TYPE object;
DEFINE FIELD IF NOT EXISTS fetched_at      ON tweet_inbox TYPE datetime;
DEFINE FIELD IF NOT EXISTS expires_at      ON tweet_inbox TYPE datetime;
DEFINE FIELD IF NOT EXISTS source          ON tweet_inbox TYPE string;
DEFINE FIELD IF NOT EXISTS search_recipe   ON tweet_inbox TYPE option<string>;
DEFINE FIELD IF NOT EXISTS filter_score    ON tweet_inbox TYPE float;
DEFINE FIELD IF NOT EXISTS filter_reason   ON tweet_inbox TYPE option<string>;
DEFINE FIELD IF NOT EXISTS ai_verdict      ON tweet_inbox TYPE option<object>;
DEFINE FIELD IF NOT EXISTS status          ON tweet_inbox TYPE string;
DEFINE FIELD IF NOT EXISTS replied_at      ON tweet_inbox TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS reply_draft     ON tweet_inbox TYPE option<string>;
DEFINE INDEX IF NOT EXISTS idx_tweet_id    ON tweet_inbox FIELDS tweet_id UNIQUE;
DEFINE INDEX IF NOT EXISTS idx_status      ON tweet_inbox FIELDS status;
DEFINE INDEX IF NOT EXISTS idx_expires     ON tweet_inbox FIELDS expires_at;

-- search_recipes
DEFINE TABLE IF NOT EXISTS search_recipes SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS recipe_id         ON search_recipes TYPE string;
DEFINE FIELD IF NOT EXISTS name              ON search_recipes TYPE string;
DEFINE FIELD IF NOT EXISTS enabled           ON search_recipes TYPE bool;
DEFINE FIELD IF NOT EXISTS template          ON search_recipes TYPE string;
DEFINE FIELD IF NOT EXISTS keywords          ON search_recipes TYPE array<string>;
DEFINE FIELD IF NOT EXISTS from_accounts     ON search_recipes TYPE array<string>;
DEFINE FIELD IF NOT EXISTS help_signals      ON search_recipes TYPE array<string>;
DEFINE FIELD IF NOT EXISTS min_likes         ON search_recipes TYPE int;
DEFINE FIELD IF NOT EXISTS min_retweets      ON search_recipes TYPE int;
DEFINE FIELD IF NOT EXISTS lang              ON search_recipes TYPE option<string>;
DEFINE FIELD IF NOT EXISTS since_hours       ON search_recipes TYPE int;
DEFINE FIELD IF NOT EXISTS result_type       ON search_recipes TYPE string;
DEFINE FIELD IF NOT EXISTS interval_minutes  ON search_recipes TYPE int;
DEFINE FIELD IF NOT EXISTS last_run_at       ON search_recipes TYPE option<datetime>;
DEFINE INDEX IF NOT EXISTS idx_recipe_id     ON search_recipes FIELDS recipe_id UNIQUE;
```

---

## Gemma 4 System Prompt（关键，必须注入业务背景）

```
你是 OTun VPN 产品的推文筛选助手。OTun 是一款面向中国大陆用户的 VPN 工具，
帮助用户突破网络封锁，访问 X、Google、YouTube 等服务。

你的任务是判断推文是否值得 OTun 团队回复。以下类型的推文 worth=true：
- 用户寻求 VPN/翻墙工具的推荐或求助
- 用户抱怨现有 VPN 不好用、连不上、速度慢
- 用户询问如何在中国大陆访问被封锁的网站或服务
- 用户提到 clash/v2ray/shadowsocks/梯子等翻墙相关工具出现问题

以下类型 worth=false：
- 纯政治讨论（无产品切入点）
- 广告/营销推文
- 与翻墙/VPN 无关的内容

每次输入是一个推文 JSON 数组，每条推文包含 tweetId 和 text。
输出必须是 JSON 数组，每条对应一个判断结果，格式：
[
  {
    "tweetId": "...",
    "worth": true,
    "confidence": 0.9,
    "reason": "用户明确求助找翻墙工具",
    "tags": ["VPN求助", "潜在用户"],
    "suggestReply": true
  }
]
```

---

## URL 拼装规则（x-timeline-scan.ts 核心逻辑）

根据 SearchRecipe 拼装 X 搜索 URL：

```typescript
function buildSearchUrl(recipe: SearchRecipe): string {
  const parts: string[] = [];

  // 关键词（OR 关系）
  if (recipe.keywords?.length) {
    parts.push(`(${recipe.keywords.map(k => `"${k}"`).join(' OR ')})`);
  }

  // 账号定向
  if (recipe.fromAccounts?.length) {
    parts.push(`(${recipe.fromAccounts.map(a => `from:${a}`).join(' OR ')})`);
  }

  // 求助信号词（help-wanted 模板）
  if (recipe.template === 'help-wanted' && recipe.helpSignals?.length) {
    parts.push(`(${recipe.helpSignals.map(s => `"${s}"`).join(' OR ')})`);
  }

  // 互动阈值
  if (recipe.minLikes) parts.push(`min_faves:${recipe.minLikes}`);
  if (recipe.minRetweets) parts.push(`min_retweets:${recipe.minRetweets}`);

  // 语言
  if (recipe.lang) parts.push(`lang:${recipe.lang}`);

  // 时间窗（since: 用 YYYY-MM-DD 格式）
  const sinceHours = recipe.sinceHours ?? 24;
  const sinceDate = new Date(Date.now() - sinceHours * 3600 * 1000);
  const sinceStr = sinceDate.toISOString().split('T')[0];
  parts.push(`since:${sinceStr}`);

  const q = encodeURIComponent(parts.join(' '));
  const f = recipe.resultType === 'top' ? 'top' : 'live';
  return `https://x.com/search?q=${q}&f=${f}`;
}
```

---

## 采集流程（x-timeline-scan.ts）

```
scanRecipe(recipe, xWebContents, filterConfig):
  1. 拼装搜索 URL → 驱动 xWebContents 导航
  2. 等待 DOM 稳定（poll article[data-testid="tweet"] 出现，最多 10s）
  3. 执行 TWEET_SCRAPE_FN_BODY 批量提取当前页推文（复用 extract-script.ts）
  4. 本地漏斗过滤（L1-L4，见下）
  5. 去重（查 tweet_inbox 已有 tweet_id）
  6. 写库（status=pending）
  7. 滚动加载更多（window.scrollBy(0, 1500)），重复 3-6，直到用户暂停或无新内容
  8. 触发 AI 判断（若 pending 条数 >= judgeConfig.batchSize）
```

**用户暂停机制**：IPC channel `X_SCAN_PAUSE` 收到信号后设置 scanAbortFlag，下次循环检查退出。

---

## 本地漏斗（L1-L4）

```typescript
function applyFilter(tweet: XTweetData, config: TimelineFilterConfig, seenIds: Set<string>): 
  { pass: boolean; reason?: string } {

  // L1 黑名单
  if (config.keywordBlacklist.some(kw => tweet.text?.includes(kw)))
    return { pass: false, reason: 'keyword_blacklist' };
  if (config.accountBlacklist.includes(tweet.authorHandle ?? ''))
    return { pass: false, reason: 'account_blacklist' };

  // L2 语言
  if (config.allowedLangs.length && tweet.lang && !config.allowedLangs.includes(tweet.lang))
    return { pass: false, reason: 'lang_filter' };

  // L3 互动阈值
  if ((tweet.metrics?.likes ?? 0) < config.minLikes)
    return { pass: false, reason: 'min_likes' };
  if ((tweet.metrics?.retweets ?? 0) < config.minRetweets)
    return { pass: false, reason: 'min_retweets' };

  // L4 去重
  if (!tweet.tweetId || seenIds.has(tweet.tweetId))
    return { pass: false, reason: 'duplicate' };

  return { pass: true };
}
```

---

## 初始搜索配方（写入 search_recipes 表的种子数据）

```typescript
const INITIAL_RECIPES: SearchRecipe[] = [
  {
    id: ulid(),
    name: 'VPN求助-英文',
    enabled: true,
    template: 'help-wanted',
    keywords: ['VPN', 'proxy', 'bypass GFW', 'censorship', 'blocked', 'shadowsocks', 'clash', 'v2ray', 'xray'],
    helpSignals: ["help", "how to", "can't connect", "not working", "anyone know", "recommend", "looking for", "need a"],
    minLikes: 0,
    minRetweets: 0,
    lang: 'en',
    sinceHours: 24,
    resultType: 'latest',
    intervalMinutes: 30,
  },
  {
    id: ulid(),
    name: 'VPN求助-中文',
    enabled: true,
    template: 'help-wanted',
    keywords: ['VPN', '翻墙', '科学上网', '梯子', 'clash', 'v2ray', 'shadowsocks', '连不上', '不能用'],
    helpSignals: ['求助', '请问', '怎么', '如何', '有没有', '推荐', '帮帮', '求推荐'],
    minLikes: 0,
    minRetweets: 0,
    lang: 'zh',
    sinceHours: 24,
    resultType: 'latest',
    intervalMinutes: 30,
  },
];
```

---

## IPC 接口（新增通道）

在 `channel-names.ts` 追加：
```typescript
X_RUN_RECIPE    = 'x:run-recipe'      // renderer → main：手动触发指定配方
X_SCAN_PAUSE    = 'x:scan-pause'      // renderer → main：暂停当前扫描
X_AI_JUDGE_BATCH = 'x:ai-judge-batch' // main 内部触发，也可 renderer 手动触发
X_INBOX_QUERY   = 'x:inbox-query'     // renderer → main：查询 tweet_inbox（Review Queue 用）
```

---

## 验收清单（总指挥用）

实现完成后，执行以下验收步骤：

**V1：建表验证**
```sql
-- 在 SurrealDB 里查询，两张表都应该存在且有字段定义
INFO FOR TABLE tweet_inbox;
INFO FOR TABLE search_recipes;
```

**V2：初始配方写入**
```sql
SELECT * FROM search_recipes;
-- 应返回 2 条记录（VPN求助-英文 / VPN求助-中文）
```

**V3：手动触发一次采集**
- 确保 X webview 已登录
- 通过 IPC 发送 `X_RUN_RECIPE`，传入配方 id
- 等待约 30 秒
- 查询 `SELECT * FROM tweet_inbox LIMIT 10;`，应有推文数据

**V4：漏斗验证**
```sql
SELECT status, count() FROM tweet_inbox GROUP BY status;
-- 应能看到 pending / filtered_out 两种状态分布
```

**V5：AI 判断验证**
- 手动触发 `X_AI_JUDGE_BATCH`
- 查询 `SELECT * FROM tweet_inbox WHERE status = 'worth' LIMIT 5;`
- 检查 ai_verdict 字段是否有完整的 AIVerdict 结构

**V6：TTL 字段验证**
```sql
SELECT tweet_id, fetched_at, expires_at FROM tweet_inbox LIMIT 3;
-- expires_at 应等于 fetched_at + 7 天
```

---

## 不需要做的事（边界）

- ❌ 不需要实现 Review Queue UI（Phase 2）
- ❌ 不需要实现 Web AI 深度分析（Phase 3）
- ❌ 不需要实现 Home Timeline 滚动扫描（方案 A，Phase 3 补充）
- ❌ 不需要实现搜索配方配置 UI（Phase 4）
- ❌ 不需要修改现有的 X 写方向（发推/回复）代码

---

## 参考文件

- 技术方案全文：`docs/10-business-design/x-timeline-intelligence/tech-spec.md`
- Agent 模块设计（Gemma 4 定位）：`docs/10-business-design/agent/Module5-Agent-设计.md`
- 现有推文提取脚本：`src/platform/main/tweet-fetcher/extract-script.ts`
- 现有 X handlers：`src/platform/main/x/handlers.ts`
- XTweetData 类型：`src/capabilities/x-extraction/types.ts`
