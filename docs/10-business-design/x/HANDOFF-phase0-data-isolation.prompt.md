# 交接 Prompt — X 数据独立化(0 期)+ 按方案实施

> 生成于 2026-09-01。**交给新对话执行。**
>
> 上下文:上一轮对话完成了需求澄清与方案设计,未写任何 X 功能代码。
> 本 prompt 自包含,但**必读文档**列在 §1。

---

## 0. 任务

分两步,**顺序不可颠倒**:

1. **0 期:X 数据独立化** —— 把 X 的数据迁到独立 database `krig_x`,
   与笔记库 `krig_note_v2` 物理隔离
2. **按方案实施** —— 依
   [`docs/10-business-design/x/persistent-tracking-and-profiling.md`](persistent-tracking-and-profiling.md)
   完成 A / A' / B / B' 各期

**先做 0 期,验收通过后再进 1 步。** 用户已明确这个顺序。

---

## 1. 必读文档(按顺序)

| 文档 | 为什么必读 |
|---|---|
| [`docs/00-architecture/data-model-charter.md`](../../00-architecture/data-model-charter.md) | **数据模型总纲**。任何建表必须逐条对照。原则冲突时实体独立性优先 |
| [`docs/10-business-design/x/persistent-tracking-and-profiling.md`](persistent-tracking-and-profiling.md) | **本任务的方案书**。⚠️ 注意 §4.3 是**已作废的旧稿**(标注了),以 **§4.1(4)** 的表结构为准 |
| [`docs/00-architecture/storage-isolation-boundaries.md`](../../00-architecture/storage-isolation-boundaries.md) | 隔离边界的论证与实测约束(§7 是修订版,§0~§5 部分论证已被推翻) |

**记忆条目**(会自动加载,但明确提醒):`project-data-model-charter`、
`project-x-persistent-tracking`、`project-surreal-none-vs-null`、
`project-surreal-flexible-parse-error`、`project-surreal-id-field-readonly`、
`project-x-timeline-intelligence`

---

## 2. 已拍板的决定(不要再问用户)

| 项 | 决定 |
|---|---|
| 存储隔离档位 | **B:独立 database `krig_x`**(同 ns `krig`)。不上独立实例 |
| 现有 X 表 | **允许推倒重建** |
| `tweet_feedback` | ⚠️ **必须迁走,不可丢** —— 见 §3 |
| Q1 存量回填 | 回填,标 `backfilled: true` |
| Q2 屏蔽后历史 | **留着**。"不再爬"约束未来,不抹除过去 |
| Q5 追踪频率 | 复用 `intervalMinutes`,只抓增量不回溯历史 |
| Q6 author_name | 留 `author_name_at_post` 快照(与 `x_author.display_name` 语义不同) |
| Q7 单表/双表 | **单表 `x_tweet`** + `expires_at` option(NONE=永久)。采纳是属性不是分表依据 |

---

## 3. 0 期:数据独立化 — 具体要求

### 3.1 现状(实测 2026-09-01,已验证)

- 全 app **单例连接**:`getDB()` 返回唯一 `Surreal` 实例
  ([`src/storage/surreal/client.ts`](../../../src/storage/surreal/client.ts))
- ns/db **硬编码**:`NAMESPACE='krig'` / `DATABASE='krig_note_v2'`(client.ts:20-21)
- **63 处 `getDB()` 调用,但只有 8 个文件 import client**,其中 X 相关仅 3 个:
  - `src/platform/main/db/tweet-inbox-repo.ts`
  - `src/platform/main/db/search-recipe-repo.ts`
  - `src/platform/main/x/x-ai-judge.ts`
  → **改造面比想象小**
- migration:`src/storage/migrations/runner.ts` 按 `schema_version` 表逐次 up(),
  当前最新 1.9.0

### 3.2 必须遵守的实测约束

**(a) SurrealDB 不支持跨 database 单语句查询** —— 已实测:
```sql
SELECT * FROM other_db_table;      → ERR: table does not exist
SELECT * FROM krig:otherdb:table;  → Parse error
```
**但同一请求内 `USE DB` 切换、`LET` 变量跨切换存活**:
```sql
USE DB a; LET $v = (SELECT VALUE v FROM t); USE DB b; RETURN $v;  → 正确返回
```
→ 跨空间关联只能落应用层。**X 库本期不需要跨库关联**(X 与笔记零关联),
所以本期不必实现 SpaceRef 抽象。

**(b) 重连恢复必须逐连接生效** —— client.ts 注释记录了踩过的坑:
一次性 `signin()`/`use()` 在 SDK 自动重连后**不重放**,导致全部 RPC 报
`NotAllowed(Anonymous access not allowed)`。
**每条连接都要走 `connect({ namespace, database, authentication })`,
不能靠 `use()` 切换。**

**(c) 关闭要干净** —— `before-quit` 必须关掉**所有**连接
(记忆 `project-graceful-shutdown`:常驻资源必须有停止调用)。

### 3.3 交付内容

1. **client 支持多库**
   - 保持 `getDB()` 现语义不变(笔记库)—— **63 处调用点不改**
   - 新增 X 库连接获取方式(如 `getXDB()`),独立 `connect()`
   - `initSurrealDB()` 初始化两条连接;`shutdownSurrealDB*()` 关闭两条

2. **X 库 schema + 独立 migration 序列**
   - `krig_x` 库有**自己的 `schema_version`**,与笔记库的 1.9.x **完全独立编号**
   - 建 `x_author` / `x_tweet` 两表 —— 结构以方案 **§4.1(4)** 为准
   - ⚠️ SCHEMAFULL 表:**代码会写/会查的字段必须全部显式 DEFINE**,漏了就静默丢弃
   - ⚠️ **绝不 `DEFINE FIELD id`**(撞内建 record id → CREATE 后 UPSERT readonly 静默失败)
   - ⚠️ `option<T>` 写值传 `undefined` **不能传 `null`**(NONE ≠ NULL)
   - ⚠️ DDL 单条 parse error 会**导致整段被拒收**,不是只跳过那条 —— 分条验证

3. **`tweet_feedback` 迁移(关键,不可丢)**
   - 2026-09-01 实测 **约 6970~6990 行且仍在增长**(X 采集在跑,每次查数字都会变),
     40 天连续无断档的人工标注(accept/reject + 128 条 Gemma 原判快照)
   - **重新采集拿不回来**,是画像与 AI 准确率评估的唯一底子
   - 迁入 `krig_x`,字段可按新模型重整,**但数据必须完整带走**
   - **迁移后必须对账**:源行数 == 目标行数,否则 fail loud。
     ⚠️ 数字是活的 —— **迁移前后各查一次源表**,或迁移时先停采集,
     不要拿本文档里的数字当基准

4. **旧表处置**
   - `tweet_inbox`(约 4250 行,7 天 TTL,本就会过期)、`search_recipes`(2 条配方)
     可清空重来
   - ⚠️ **但删除笔记库里的旧 X 表要单独一步、单独确认**,不要和迁移混在一个动作里
     (先迁移 + 对账通过 → 再删旧表)

### 3.4 验收标准

- [ ] `INFO FOR NS` 能看到 `krig_x` 库
- [ ] `krig_x` 里 `x_author` / `x_tweet` / `tweet_feedback`(或其重整后的表)存在且字段完整
- [ ] `tweet_feedback` 行数与迁移前一致(**当场查源表取基准,给出前后数字对照**;
      注意采集在跑数字会变,必要时先停采集再迁)
- [ ] 笔记库功能零回归:能开笔记、能保存、能搜索
- [ ] app 重启后两条连接都能自动恢复(**断连重连后仍能读写,不报 NotAllowed**)
- [ ] Ctrl+C 能正常退出(不吊死在重连)
- [ ] `npx tsc --noEmit` 干净(注:`src/views/x-inbox/XInboxView.tsx:714` 有一条
      **既有的** `WebkitAppRegion` 报错,与本任务无关,不要试图修它)

---

## 4. 0 期之后:按方案实施

0 期验收通过后,依方案 §7 分期表推进:

| 期 | 内容 | 备注 |
|---|---|---|
| **A** | `x_tweet` 采纳即永久 + 去重并入 archive | **最急** —— 每天约 16 条采纳正文在过期丢失 |
| **A'** | `created_at` / `in_reply_to` 落库 | 抓取脚本已提取(extract-script.ts:75/147),只是组装记录时没带上 —— 改动很小 |
| **B** | 屏蔽名单接上数据源 + UI | `applyFilter` 里 `accountBlacklist` 判断**早就在**(x-timeline-scan.ts:69),只是值来自硬编码 `[]` 的 `DEFAULT_FILTER_CONFIG`。**是接线不是新建逻辑** |
| **B'** | 追踪名单 | ⚠️ **必须先实机 spike** `include:replies` 语法 —— X 搜索语法易变,有 `include:replies`/`filter:replies`/`to:` 几种写法,**不要照文档假设** |
| **C** | 画像 | **用户明确画像形态单独再议**,本期只保证素材齐备 |

### 4.1 实施时必须知道的几个"坑已探明"

- **重复爬取的根因**:`getTweetIdSet(_windowHours)` **收了参数却没用**
  ([tweet-inbox-repo.ts:80](../../../src/platform/main/db/tweet-inbox-repo.ts#L80)),
  函数体直接全表扫 inbox → 去重范围恒等于 inbox 存活的 7 天。
  修法:去重集合并入永久数据;**倾向删掉这个没用的参数**而不是实现窗口语义
- **`expires_at` 当前是 `TYPE datetime` 非 `option<>`** → 旧库里"设 NONE 让 TTL 跳过"
  走不通;新库直接建成 `option<datetime>` 即可
- **术语**:界面和代码一律用「**追踪**/watchlist」,**禁用「关注」** ——
  那是 X 的 follow,会造成误解(追踪名单是本 app 内部采集清单,
  不调 follow API、被追踪者无感知)
- **watchlist 推文不进 AI 判断队列**:标 `source='watchlist'` 且不置 pending,
  否则刷爆 Gemma 队列、污染待处理收件箱

---

## 5. 工作方式要求

- **不要重新设计** —— 方案已定稿。若发现方案有问题,**先说明再改**,不要默默偏离
- **每期独立验收** —— 做完一期给出实测证据(查库数字、截图或日志),用户确认后再进下一期
- **fail loud** —— 迁移/归档写失败必须报错,不能静默吞掉
  (记忆 `feedback-fail-loud-no-fallback`)
- **别猜,看真实数据** —— 库就在跑,可以直接 curl 查
  (记忆 `feedback-dont-guess-look-at-real-data`)。
  连接方式:
  ```bash
  curl -s -X POST http://127.0.0.1:8533/sql \
    -u "root:$(python3 -c "import json;print(json.load(open('$HOME/Library/Application Support/KRIG Note V2/.db-credentials'))['password'])")" \
    -H "Accept: application/json" -H "surreal-ns: krig" -H "surreal-db: krig_note_v2" \
    -d "SELECT count() FROM tweet_feedback GROUP ALL;"
  ```
- **分支**:当前在 `feature/mail-phase2`。**开新分支做 X**(如 `feature/x-data-isolation`)

---

## 6. 起手第一句

建议新对话这样开场:

> 读 `docs/10-business-design/x/HANDOFF-phase0-data-isolation.prompt.md`,
> 按它执行 0 期(X 数据独立化)。先给我 0 期的实施计划,不要直接写代码。
