# X 时间线智能筛选 — 技术方案

> 状态：草案（待总指挥审阅拍板）
> 目标：从已登录的 X webview 中批量采集推文，经多级漏斗过滤，由 AI 判断价值，
>       并为值得回复的推文提供草稿。数据存活周期 ≤ 7 天，以"鲜活数据+及时回复"为核心。

---

## 一、整体数据流

```
[触发源]
  A: 定时滚动 Home Timeline（每 30 分钟）
  B: 搜索配方驱动（按关键词/账号/时间窗/互动阈值组合）
         ↓
  DOM 批量提取（x-timeline-scan.ts）
         ↓
  本地漏斗（L1-L4，毫秒级）
         ↓
  SurrealDB · tweet_inbox（status=pending → worth/skip）
         ↓
  AI 判断（Gemma 4，few-shot 偏好对齐）
         ↓
  Review Queue 面板（worth 推文展示）
         ↓
  用户选中 → Web AI 深度分析（Claude/Gemini 网页版）
         ↓
  回复草稿 → XSendConfirmPanel → x-write.ts（现有）
         ↓
  反馈记录（tweet_feedback，持续优化 few-shot 池）
```

---

## 二、采集层（Layer 1）

### 2.1 方案 A：Home Timeline 滚动扫描

**触发**：后台定时器，默认每 30 分钟；用户也可手动触发「刷新时间线」。

**流程**：
1. 定位当前活跃 ws 的 X Host webContents（复用 `requireXWebContents`）
2. 导航确保在 `x.com/home`（已在则不跳转）
3. 注入滚动脚本：
   - `querySelectorAll('article[data-testid="tweet"]')` 批量抓可见推文
   - 调用现有 `TWEET_SCRAPE_FN_BODY` 逐条提取字段
   - `window.scrollBy(0, 800)` 驱动懒加载
   - 重复 N 轮（默认 5 轮，约 50 条）
4. 增量去重（按 tweetId，对照 `tweet_inbox` 已有 ID）
5. 批量写入 `tweet_inbox`（status=pending）

**限制**：依赖 X webview 保持活跃，推荐后台静默扫描不打断用户操作。

### 2.2 方案 B：搜索配方驱动（优先实现）

**搜索配方（SearchRecipe）**是一组可编辑的查询参数，组合成 X 高级搜索 URL。
每条配方对应一种具体的信息获取意图，通过**预置模板**快速创建，也支持完全自定义。

#### 预置模板（RecipeTemplate）

系统内置三类场景模板，用户选模板 → 填参数 → 生成配方：

| 模板 | 意图 | 核心参数 | X 搜索语法要点 |
|------|------|----------|----------------|
| **热门流量** | 当天互动量最大的帖子 | 关键词 + 时间窗 + 互动下限 | `min_faves:N since:today` + `&f=top`（按热度排序）|
| **大V追踪** | 某账号的最新帖子 | 账号 handle 列表 | `(from:A OR from:B)` + `&f=live`（按时间排序）|
| **求助捕捉** | 某领域的求助类推文 | 关键词 + 求助信号词 | `(关键词) (help OR question OR how to OR 求助 OR 请问)` + `&f=live` |

```typescript
type RecipeTemplate = 'trending' | 'vip-tracking' | 'help-wanted' | 'custom';

interface SearchRecipe {
  id: string;                    // ULID
  name: string;                  // 用户可读名称，如「AI技术热帖」
  enabled: boolean;
  template: RecipeTemplate;      // 来源模板（custom = 完全自定义）

  // ── 查询维度（组合 AND 关系）──
  keywords?: string[];           // 关键词（OR 关系），如 ["AI agent", "LLM inference"]
  fromAccounts?: string[];       // 大V账号 handle 列表，如 ["Karpathy", "ylecun"]
  helpSignals?: string[];        // 求助信号词（template=help-wanted 时生效）
                                 // 默认：["help", "question", "how to", "求助", "请问", "怎么"]
  minLikes?: number;             // 最低点赞数
  minRetweets?: number;          // 最低转推数
  lang?: string;                 // 语言过滤，如 "en" | "zh"
  sinceHours?: number;           // 只取最近 N 小时内的推文，默认 24
  resultType: 'latest' | 'top';  // latest=按时间 / top=按热度；trending 模板默认 top

  // ── 调度 ──
  intervalMinutes: number;       // 执行间隔（分钟），默认 60
  lastRunAt?: string;            // ISO datetime，调度器维护
}
```

#### 各模板的 URL 拼装规则

**trending（热门流量）**：
```
关键词 + min_faves:500 + since:昨天 + &f=top（热度排序）
→ https://x.com/search?q=(AI+OR+LLM)+min_faves:500+since:2026-07-22&f=top
```

**vip-tracking（大V追踪）**：
```
from 账号列表 + since:N小时前 + &f=live（时间排序，追最新）
→ https://x.com/search?q=(from:Karpathy+OR+from:ylecun)+since:2026-07-22&f=live
```

**help-wanted（求助捕捉）**：
```
关键词 + 求助信号词 + since:N小时前 + &f=live
→ https://x.com/search?q=(AI+agent)+(help+OR+question+OR+求助)+since:2026-07-22&f=live
```

**流程**：
1. 调度器（主进程）按 `intervalMinutes` 轮询 enabled 配方
2. 驱动 X webview 导航到拼好的搜索 URL（不打开新页，在已有 X Host 内导航）
3. 等待 DOM 稳定（`did-finish-load` + 短 poll 确认推文元素出现）
4. 批量提取 + 持续翻页；用户可随时点「暂停」按钮终止当次扫描
5. 去重 + 写库

---

## 三、本地漏斗（Layer 2）

串行执行，每一关淘汰的推文直接写 `status=filtered_out`，不进入下一关。

```
L1 · 黑名单过滤        关键词/账号黑名单，字符串匹配，O(n)
L2 · 语言过滤          对照 recipe.lang；无 lang 字段用 franc 检测
L3 · 互动阈值          likes/RT/reply >= 配置下限（可为 0 = 不过滤）
L4 · 时间窗去重        内存 Set<tweetId>，滑动 48h 窗口（防重复入库）
```

#### FilterConfig 数据模型

```typescript
interface TimelineFilterConfig {
  keywordBlacklist: string[];      // 黑名单关键词（包含即淘汰）
  accountBlacklist: string[];      // 黑名单账号 handle
  minLikes: number;                // 默认 0
  minRetweets: number;             // 默认 0
  allowedLangs: string[];          // 空 = 不过滤语言
  dedupeWindowHours: number;       // 默认 48
}
```

初期：硬编码默认值，后期做 UI 配置面板。

---

## 四、数据存储（SurrealDB）

### 4.1 tweet_inbox 表

```sql
DEFINE TABLE tweet_inbox SCHEMAFULL;

-- 推文原始字段（与 XTweetData 对齐）
DEFINE FIELD tweet_id        ON tweet_inbox TYPE string;
DEFINE FIELD text            ON tweet_inbox TYPE string;
DEFINE FIELD author_name     ON tweet_inbox TYPE string;
DEFINE FIELD author_handle   ON tweet_inbox TYPE string;
DEFINE FIELD author_avatar   ON tweet_inbox TYPE option<string>;
DEFINE FIELD tweet_url       ON tweet_inbox TYPE option<string>;
DEFINE FIELD lang            ON tweet_inbox TYPE option<string>;
DEFINE FIELD metrics         ON tweet_inbox TYPE object;
  -- metrics.likes / metrics.retweets / metrics.replies / metrics.views

-- 采集元信息
DEFINE FIELD fetched_at      ON tweet_inbox TYPE datetime;
DEFINE FIELD expires_at      ON tweet_inbox TYPE datetime;   -- fetched_at + 7d，TTL 基准
DEFINE FIELD source          ON tweet_inbox TYPE string;     -- 'timeline' | 'search'
DEFINE FIELD search_recipe   ON tweet_inbox TYPE option<string>;  -- recipe.id

-- 漏斗 & AI 判断
DEFINE FIELD filter_score    ON tweet_inbox TYPE float;      -- 漏斗打分 0-1（预留，现阶段存 1.0）
DEFINE FIELD filter_reason   ON tweet_inbox TYPE option<string>;  -- filtered_out 原因
DEFINE FIELD ai_verdict      ON tweet_inbox TYPE option<object>;  -- AIVerdict（见下）
DEFINE FIELD status          ON tweet_inbox TYPE string;
  -- 'pending' | 'filtered_out' | 'ai_judging' | 'worth' | 'skip' | 'replied'

-- 回复追踪
DEFINE FIELD replied_at      ON tweet_inbox TYPE option<datetime>;
DEFINE FIELD reply_draft     ON tweet_inbox TYPE option<string>;  -- 最后一次草稿存档

-- 索引
DEFINE INDEX idx_tweet_id    ON tweet_inbox FIELDS tweet_id UNIQUE;
DEFINE INDEX idx_status      ON tweet_inbox FIELDS status;
DEFINE INDEX idx_expires     ON tweet_inbox FIELDS expires_at;
DEFINE INDEX idx_fetched_at  ON tweet_inbox FIELDS fetched_at;
```

### 4.2 tweet_feedback 表（偏好反馈，few-shot 训练池）

```sql
DEFINE TABLE tweet_feedback SCHEMAFULL;

DEFINE FIELD tweet_id        ON tweet_feedback TYPE string;
DEFINE FIELD text            ON tweet_feedback TYPE string;    -- 推文原文快照
DEFINE FIELD user_verdict    ON tweet_feedback TYPE string;   -- 'worth' | 'skip' | 'replied'
DEFINE FIELD ai_verdict      ON tweet_feedback TYPE option<string>;   -- Gemma 当时的判断
DEFINE FIELD reason          ON tweet_feedback TYPE option<string>;   -- 用户标注的原因
DEFINE FIELD tags            ON tweet_feedback TYPE array<string>;
DEFINE FIELD recorded_at     ON tweet_feedback TYPE datetime;

DEFINE INDEX idx_fb_tweet    ON tweet_feedback FIELDS tweet_id UNIQUE;
```

### 4.3 search_recipes 表（搜索配方持久化）

```sql
DEFINE TABLE search_recipes SCHEMAFULL;

DEFINE FIELD recipe_id        ON search_recipes TYPE string;
DEFINE FIELD name             ON search_recipes TYPE string;
DEFINE FIELD enabled          ON search_recipes TYPE bool;
DEFINE FIELD template         ON search_recipes TYPE string;   -- 'trending'|'vip-tracking'|'help-wanted'|'custom'
DEFINE FIELD keywords         ON search_recipes TYPE array<string>;
DEFINE FIELD from_accounts    ON search_recipes TYPE array<string>;
DEFINE FIELD help_signals     ON search_recipes TYPE array<string>;  -- 求助信号词（help-wanted 模板）
DEFINE FIELD min_likes        ON search_recipes TYPE int;
DEFINE FIELD min_retweets     ON search_recipes TYPE int;
DEFINE FIELD lang             ON search_recipes TYPE option<string>;
DEFINE FIELD since_hours      ON search_recipes TYPE int;
DEFINE FIELD result_type      ON search_recipes TYPE string;   -- 'latest' | 'top'
DEFINE FIELD interval_minutes ON search_recipes TYPE int;
DEFINE FIELD last_run_at      ON search_recipes TYPE option<datetime>;

DEFINE INDEX idx_recipe_id   ON search_recipes FIELDS recipe_id UNIQUE;
```

### 4.4 TTL 清理策略

每天触发一次（主进程启动后 + 每 24h）：

```sql
DELETE tweet_inbox WHERE expires_at < time::now();
```

不删 `tweet_feedback`（这是持久训练数据，不设 TTL）。

---

## 五、AI 判断层（Layer 3）

### 5.1 AIVerdict 数据模型

```typescript
interface AIVerdict {
  worth: boolean;
  confidence: number;          // 0.0 – 1.0
  reason: string;              // 一句话，显示在 Review Queue
  tags: string[];              // ['insight', 'thread', 'news', 'question', 'humor', ...]
  suggestReply: boolean;       // 是否建议回复
  replyDrafts?: ReplyDraft[];  // worth && suggestReply 时携带
}

interface ReplyDraft {
  tone: 'agree' | 'question' | 'add-on' | 'counter';
  text: string;
}
```

### 5.2 本地模型接入方式

**原则**：Gemma 4 是整个 app 的 Orchestrator 底座（见 `docs/10-business-design/agent/Module5-Agent-设计.md` §2.1），
通过 **Ollama** 在本地运行，零数据出境，无 API 费用。
X 时间线判断不另建推理通道，直接作为 Orchestrator 的一个 **Level 0 任务模板** 消费同一个 Ollama 实例。

**Ollama 调用规范**（与 Agent 模块统一）：

```typescript
// Ollama OpenAI 兼容接口，主进程直接 fetch，不经 webview
// 端点：http://localhost:11434/v1/chat/completions
// 模型：'gemma4'（当前），后续可切 'qwen3:32b'、'llama3.3' 等任意 Ollama 已拉取模型

const response = await fetch('http://localhost:11434/v1/chat/completions', {
  method: 'POST',
  body: JSON.stringify({
    model: 'gemma4',
    messages: [
      { role: 'system', content: systemPrompt },   // few-shot 偏好池 + 判断规范
      { role: 'user',   content: tweetBatch },     // 批量推文 JSON
    ],
    response_format: { type: 'json_object' },      // Gemma 4 原生支持结构化 JSON 输出
    temperature: 0.2,                              // 判断任务低随机性
  }),
});
```

**接入位置**：
- Ollama 客户端封装由 **Agent 模块统一提供**（`src/platform/main/agent/ollama-client.ts`，待建）
- `src/platform/main/x/x-ai-judge.ts` — 推文判断业务逻辑，调用 Agent 模块的 Ollama 客户端

**降级策略**（对齐 Agent 模块设计原则）：
Ollama 未启动 / Gemma 4 未拉取 → 判断步骤跳过，推文保持 `status=pending`，
Review Queue 面板提示「本地模型不可用，请启动 Ollama」，核心 X 功能不受影响。

对外暴露：`judgeTweet(tweet: XTweetData, fewShotPool: TweetFeedback[]): Promise<AIVerdict>`

### 5.3 Few-shot 偏好对齐

System Prompt 结构：
```
你是一个推文价值判断助手。判断标准来自用户的历史偏好。

【用户偏好示例（从 tweet_feedback 取最近 30 条 worth=true 和 10 条 skip）】
示例1: "..." → worth=true，原因：深度技术分析，有引用数据
示例2: "..." → skip，原因：纯营销内容
...

【当前任务】
判断下方推文是否值得关注，并给出回复方向建议。
输出格式：JSON，字段见 AIVerdict 定义。
```

初期：手动标注 30-50 条作为初始 few-shot 池，应用启动时从 `tweet_feedback` 加载。

### 5.4 批量判断策略

```typescript
interface JudgeConfig {
  batchSize: number;          // 积累多少条 pending 后触发一次批判断，默认 10
  maxWaitMinutes: number;     // 即使未满 batchSize，超时后也触发，默认 15
  concurrency: number;        // 同时运行的 judge 请求上限，默认 1（本机 Gemma 串行更稳）
}
```

- 漏斗后积累满 `batchSize` 条 pending → 触发一次批判断（合并为单次 Ollama 调用）
- 未满 `batchSize` 但超过 `maxWaitMinutes` → 也触发（防止求助帖因凑不够数而延迟）
- `concurrency` 默认 1：本机 Gemma 4 MoE 串行推理比并发更稳定，避免显存争抢

---

## 六、Review Queue 面板（UI）

**入口方式**：不做独立 View，直接用 **Web 地址**访问——在已有的内置浏览器里打开一个本地 Web 页面
（如 `http://localhost:{port}/x-inbox`），由主进程起一个轻量 HTTP 服务提供该页面。
零新增 View 注册，零 navSide 改动，用户在浏览器 tab 里就能用。

面板功能：

| 区域 | 内容 |
|------|------|
| 过滤栏 | 按 status / tag / recipe 过滤 |
| 推文卡片 | 原文 + 作者 + 互动数 + AI reason + tags |
| 操作按钮 | 「深度分析」「标记跳过」「查看原推」 |
| 回复草稿 | 展示 ReplyDraft 列表，点选 → 进 XSendConfirmPanel |

---

## 七、Web AI 深度分析（Layer 4）

**触发**：用户在 Review Queue 点击「深度分析」按钮。

**流程**：
1. 从 `tweet_inbox` 取该推文 + 回复链上下文（若有）
2. 拼装 prompt（见下）
3. 注入到已登录的 **ChatGPT webview**，复用现有 `webview-input.ts` + AI extraction 能力
4. ChatGPT 回复内容自动提取，解析出：
   - 核心论点分析
   - 回复建议（多个方向）
5. 呈现给用户；用户选择草稿 → `XSendConfirmPanel`

**Prompt 模板**：

```
请分析这条推文并建议是否值得回复：

原推文
作者：{authorHandle}（{metrics.likes} 点赞 / {metrics.retweets} 转推）
内容："{text}"

{如有回复链}
主要回复：
- {reply1.authorHandle}: "{reply1.text}"
- ...

请给出：
1. 这条推文的核心论点或价值（1-2句）
2. 是否值得回复？原因？
3. 如果回复，建议3个方向（赞同/提问/补充），每个给出具体草稿（≤280字）
```

---

## 八、模块边界与文件规划

```
src/platform/main/x/
  x-timeline-scan.ts       ← 新增：批量DOM扫描（A/B两路）
  x-search-scheduler.ts    ← 新增：搜索配方调度器（定时触发）
  x-ai-judge.ts            ← 新增：Gemma 4 判断层
  x-deep-analysis.ts       ← 新增：Web AI 深度分析 prompt 构建 + 注入

src/capabilities/x-extraction/
  types.ts                 ← 扩展：SearchRecipe / TimelineFilterConfig / AIVerdict

src/views/x-inbox/
  index.ts                 ← 新增：Review Queue 视图注册
  XInboxPanel.tsx          ← 新增：面板 UI 组件

src/platform/main/db/
  tweet-inbox-repo.ts      ← 新增：tweet_inbox CRUD（对齐现有 repo 模式）
  search-recipe-repo.ts    ← 新增：search_recipes CRUD

src/shared/ipc/channel-names.ts
  ← 扩展：X_SCAN_TIMELINE / X_RUN_RECIPE / X_AI_JUDGE / X_DEEP_ANALYSIS
```

**铁律遵守**：
- 所有新 webview 注入操作复用 `web-service-base`（铁律1）
- X 不扩展 AIServiceProfile，新类型独立在 x-service-types（铁律3）
- 漏斗/判断失败 → fail loud，不静默吞掉（铁律4）
- 写方向红线：回复草稿只填充，用户在 XSendConfirmPanel 手动确认发布

---

## 八-A、环境验证状态（2026-07-23）

| 项目 | 状态 | 备注 |
|------|------|------|
| Ollama 安装 | ✅ 0.32.1，brew services 自启 | `brew services start ollama` |
| gemma4:31b-it-qat | ✅ 已拉取，18GB | 主力判断模型 |
| gemma4:26b-a4b-it-qat | ✅ 已拉取，15GB | MoE 备用，推理更快 |
| 基础响应 | ✅ 中英文正常 | |
| JSON 结构化输出 | ✅ `response_format: json_object` 稳定 | 可直接 `JSON.parse()` |
| AIVerdict smoke test | ✅ 字段齐全，格式对齐 | |
| Few-shot 偏好对齐 | ⚠️ 待实施 | 默认判断会因"合规风险"误判 VPN 求助为 skip |

**关键发现**：Gemma 4 默认价值观会把 VPN 求助帖判为 `worth=false`（合规顾虑）。
System prompt 必须注入产品背景 + 偏好示例，才能让判断符合业务目标。

---

## 九、实施分阶段

### Phase 1（核心链路，1-2 周）
- [ ] SurrealDB 建表（tweet_inbox / search_recipes / tweet_feedback）
- [ ] `x-timeline-scan.ts`：方案 B 搜索配方驱动的批量提取
- [ ] 本地漏斗 L1-L4
- [ ] 基础 Review Queue 面板（只读，无 AI）

### Phase 2（AI 接入，1 周）
- [ ] `x-ai-judge.ts`：Gemma 4 接入 + few-shot 结构
- [ ] 手动标注初始 30 条样本作为 few-shot 池
- [ ] Review Queue 面板显示 AI 判断结果
- [ ] 反馈记录（worth/skip 操作写 tweet_feedback）

### Phase 3（深度分析，1 周）
- [ ] `x-deep-analysis.ts`：Web AI 深度分析 prompt 构建
- [ ] 回复草稿选择 → XSendConfirmPanel 集成
- [ ] 方案 A（Home Timeline 滚动扫描）补充实现

### Phase 4（配置化，按需）
- [ ] SearchRecipe 配置 UI 面板
- [ ] FilterConfig 配置 UI
- [ ] Few-shot 池管理界面

---

## 十、待总指挥拍板的决策点

| # | 问题 | 候选 | 影响 |
|---|------|------|------|
| ~~D1~~ | ~~本地推理后端~~ | **已拍板：Ollama**，与 Agent 模块统一，端点 `localhost:11434` | — |
| ~~D2~~ | ~~Review Queue 入口~~ | **已拍板：本地 Web 页面**（`localhost:{port}/x-inbox`），内置浏览器打开，零 View 改动 | — |
| ~~D3~~ | ~~初始 SearchRecipe~~ | **已拍板：VPN/翻墙求助配方**（见下方），help-wanted 模板，`minLikes:0` 捕捉新用户求助 | — |
| ~~D4~~ | ~~Web AI 目标~~ | **已拍板：ChatGPT**，复用现有 ChatGPT webview 实例 | — |
| ~~D5~~ | ~~批量判断时机~~ | **已拍板：积累 N 条 pending 触发**，N = `judgeConfig.batchSize`（默认 10，可配置） | — |

### 初始 SearchRecipe 配置

目标：捕捉正在遭遇 VPN/翻墙困境的用户，及时回复推广产品。
核心设计：**`minLikes: 0`**——不过滤互动数，求助帖往往是新用户发的，点赞极少但正是最需要及时回复的目标。

**配方一：VPN 求助（英文）**
```json
{
  "name": "VPN求助-英文",
  "template": "help-wanted",
  "keywords": ["VPN", "proxy", "bypass GFW", "censorship", "blocked", "shadowsocks", "clash", "v2ray", "xray"],
  "helpSignals": ["help", "how to", "can't connect", "not working", "anyone know", "recommend", "looking for", "need a"],
  "minLikes": 0,
  "lang": "en",
  "sinceHours": 24,
  "resultType": "latest",
  "intervalMinutes": 30
}
```

**配方二：VPN 求助（中文）**
```json
{
  "name": "VPN求助-中文",
  "template": "help-wanted",
  "keywords": ["VPN", "翻墙", "科学上网", "梯子", "clash", "v2ray", "shadowsocks", "连不上", "不能用"],
  "helpSignals": ["求助", "请问", "怎么", "如何", "有没有", "推荐", "帮帮", "求推荐"],
  "minLikes": 0,
  "lang": "zh",
  "sinceHours": 24,
  "resultType": "latest",
  "intervalMinutes": 30
}
