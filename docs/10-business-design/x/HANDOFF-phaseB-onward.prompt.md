# 交接 Prompt — X 剩余开发(B / B' / C 期)

> 生成于 2026-09-01。**交给新对话执行。**
>
> 上一轮完成了 **0 期(数据独立化)+ A/A' 期(采纳即永久)**,已合并 main
> (merge commit `951410de`)。本 prompt 自包含,但**必读文档**列在 §1。

---

## 0. 任务

按方案 §7 分期表推进剩余三期:

| 期 | 内容 | 状态 |
|---|---|---|
| ~~0~~ | 存储底座 · `krig_x` 独立库 | ✅ 已完成并验收 |
| ~~A~~ | 采纳即永久 + 去重并入 | ✅ 已完成并验收 |
| ~~A'~~ | `created_at` / `in_reply_to` 落库 | ✅ 已完成 |
| **B** | 屏蔽名单接数据源 + UI | ← **从这里开始** |
| **B'** | 追踪名单(watchlist) | ⚠️ 必须先实机 spike |
| **C** | 画像聚合 | 用户明确「形态单独再议」,只保证素材齐备 |

---

## 1. 必读文档(按顺序)

| 文档 | 为什么必读 |
|---|---|
| [`docs/00-architecture/data-model-charter.md`](../../00-architecture/data-model-charter.md) | **数据模型总纲**。建表/加字段必须逐条对照。原则冲突时实体独立性优先 |
| [`docs/10-business-design/x/persistent-tracking-and-profiling.md`](persistent-tracking-and-profiling.md) | **方案书**。⚠️ §4.3 是**已作废旧稿**,以 **§4.1(4)** 表结构为准 |
| [`HANDOFF-phase0-data-isolation.prompt.md`](HANDOFF-phase0-data-isolation.prompt.md) | 上一轮的交接,§4.1「坑已探明」对 B/B' 仍然有效 |

**记忆条目**(自动加载,明确提醒):`project-data-model-charter`、
`project-x-persistent-tracking`、`project-surreal-none-vs-null`、
`project-surreal-flexible-parse-error`、`project-surreal-id-field-readonly`、
`project-x-timeline-intelligence`、`feedback-fail-loud-no-fallback`、
`feedback-dont-guess-look-at-real-data`、`feedback-verify-guard-can-fail`

---

## 2. 当前实际状态(实测,非推断)

### 2.1 数据

| 表 | 行数 | 说明 |
|---|---|---|
| `krig_x.x_tweet` | **743** | 回填 644 + 新采集;617 条 `expires_at=NONE`(永久) |
| `krig_x.tweet_feedback` | **7034** | 人工标注真源,不可再生 |
| `krig_x.x_author` | **0** | 表已建,**B 期才启用** |
| `krig_x.search_recipes` | 2 | VPN求助 中/英,30 分钟间隔 |
| `krig_note_v2` | — | X 表已全部删除,零残留 |

### 2.2 已落地的基础设施

- **多库连接**:`getDB()`(笔记库,语义不变)/ `getXDB()`(X 库)。
  各自独立 `connect()`,**不能用 `use()` 切库**(重连后鉴权不重放)
- **X 库独立 migration**:`src/storage/migrations/x-runner.ts`,
  自己的 `schema_version`,当前 **1.0.0**。加表/字段从 1.0.1 起
- **sidecar 自愈**:意外退出自动重启 + 重连两条连接(限 3 次,失败大声报错)
- **启动自愈**:卡在 `ai_judging` 的推文退回 `pending`

### 2.3 `x_author` 表已就绪(B/B' 直接用)

```
handle UNIQUE / display_name / avatar
blocked bool / blocked_at / blocked_reason          ← B 期用
watched bool / watched_at / watch_source / watch_depth  ← B' 期用
is_self bool / note
```
索引:`idx_author_handle`(UNIQUE)、`idx_author_blocked`、`idx_author_watched`

---

## 3. B 期:屏蔽名单

### 3.1 这是**接线**,不是新建逻辑

判断早就在,只差数据源:

```ts
// src/platform/main/x/x-timeline-scan.ts:69
if (config.accountBlacklist.includes(tweet.authorHandle ?? '')) { ... }
```

而 `accountBlacklist` 的值来自 [`x-timeline-types.ts:100`](../../../src/shared/types/x-timeline-types.ts#L100)
的 `DEFAULT_FILTER_CONFIG`,**硬编码空数组**。

### 3.2 要做的

1. **repo 层**:`x-author-repo.ts`(新建)—— `blockAuthor` / `unblockAuthor` /
   `listBlocked` / `isBlocked`。走 `getXDB()`
2. **接线**:采集前从 `x_author WHERE blocked = true` 取 handle 列表,
   填进 `filterConfig.accountBlacklist`
3. **UI**:X 收件箱加「屏蔽此人」操作 + 一个屏蔽名单管理入口

### 3.3 已拍板(不要再问用户)

- **Q2 屏蔽后的历史数据**:**留着**。「不再爬」约束未来,不抹除过去
- 屏蔽是**人工意志**,存在 `x_author`,不可重算(总纲原则 1)

---

## 4. B' 期:追踪名单(watchlist)

### 4.1 ⚠️ 必须先实机 spike,不要照文档假设

X 的搜索语法**易变**,`include:replies` / `filter:replies` / `to:` 几种写法
行为不同且会变。**先用真实账号在 X 上试**,确认哪种能抓到「某人的推文 + 回复」,
再写代码。方案里写的语法**不可信**。

### 4.2 术语红线

界面和代码一律用「**追踪** / watchlist」,**禁用「关注」**——
那是 X 的 follow,会造成误解。追踪名单是本 app 内部的采集清单,
不调 follow API、被追踪者无感知。

### 4.3 关键约束

- **watchlist 推文不进 AI 判断队列**:标 `source='watchlist'` 且**不置 pending**,
  否则刷爆 Gemma 队列、污染待处理收件箱
- 复用 `intervalMinutes`,只抓增量不回溯历史(Q5 已拍板)
- `watched` 与 `blocked` **互斥**

---

## 5. C 期:画像

用户明确:**画像具体形态单独再议**。本期只保证素材齐备,不要自行设计画像 UI。

方案 §4.1(5) 已定:**先不建任何边表**。n 层关系用 `x_tweet.in_reply_to`
直接 `GROUP BY` 算,当前量级(万级)SQL 完全够用。真慢了再物化派生表。

---

## 6. 上一轮踩过的坑(省得再踩一遍)

| 坑 | 教训 |
|---|---|
| `connect({database})` **不会建库** | X 库 DDL 首条必须 `DEFINE DATABASE IF NOT EXISTS` |
| HTTP `/sql` 读出的 datetime 是**字符串** | 写回 `TYPE datetime` 要用 `d'...'` 字面量 |
| 回填行保留 Gemma 原判 | 617 条历史采纳冒充「待表态建议」涌进收件箱。UI 的 suggested 视图筛 `status='worth'` 且 `ai_verdict.reason` 不以 `human:` 开头([XInboxView.tsx:22](../../../src/views/x-inbox/XInboxView.tsx#L22)) |
| 单条 DDL parse error → **整段拒收** | migration 跑完必须 curl 问库 `INFO FOR TABLE` 逐字段核对,**不能以「启动没报错」当验证** |
| X webview 只认**真实 viewport 变化** | 合成 `dispatchEvent(new Event('resize'))` 无效。改 webview 元素宽度 1px 再复原 |

---

## 7. 工作方式要求

- **不要重新设计** —— 方案已定稿。发现问题**先说明再改**,不要默默偏离
- **每期独立验收** —— 做完给实测证据(查库数字/日志),用户确认后再进下一期
- **fail loud** —— 迁移/写入失败必须报错(`feedback-fail-loud-no-fallback`)
- **别猜,看真实数据** —— 库就在跑,直接 curl 查(`feedback-dont-guess-look-at-real-data`):
  ```bash
  curl -s -X POST http://127.0.0.1:8533/sql \
    -u "root:$(python3 -c "import json;print(json.load(open('$HOME/Library/Application Support/KRIG Note V2/.db-credentials'))['password'])")" \
    -H "Accept: application/json" -H "surreal-ns: krig" -H "surreal-db: krig_x" \
    -d "SELECT count() FROM x_tweet GROUP ALL;"
  ```
- **守卫要验证能真的失败** —— 写完测试故意注入违规看它变红
  (`feedback-verify-guard-can-fail`)
- **分支**:当前 main 已含 0/A/A'。**开新分支做 B**(如 `feature/x-phase-b`)

### 7.1 上一轮的方法论教训(值得读)

排查「X 侧栏不适配」时连错五次,每次都是**拿有缺陷的测量当证据**:
DOM 数字冒充显示证据、像素读数饱和了没查分布、把真证据当噪音忽略。
最后靠用户一句「更底层的 web 页布局时侧栏是没有变量的吗」才转向 ——
从「外部量宽度」改成「问页面自己用什么变量」,一次定性。

**教训**:仪器给出读数前,先确认它测的是不是你以为的那个量。

---

## 8. 起手第一句

建议新对话这样开场:

> 读 `docs/10-business-design/x/HANDOFF-phaseB-onward.prompt.md`,
> 按它执行 B 期(屏蔽名单)。先给我实施计划,不要直接写代码。
