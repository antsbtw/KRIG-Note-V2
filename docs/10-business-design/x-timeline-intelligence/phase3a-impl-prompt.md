# X Timeline Intelligence — Phase 3a 实施 prompt

## 背景

项目：KRIG-Note-V2（Electron + React + SurrealDB + Vite）
分支：feat/multi-window-step2（当前开发主干）

已完成：
- Phase 1：tweet_inbox + search_recipes 表、关键词漏斗采集、Gemma AI 初判
- Phase 2：多窗口隔离、Review Queue 面板（`src/views/x-inbox/XInboxView.tsx`）
- Phase 3a（本次）：人工反馈 ✓/✗ 标注 + tweet_feedback 表

目标：在 XInboxView 的推文卡片上加「✓ 采纳」「✗ 不采纳」按钮，
把人工判断写入 tweet_feedback 表，为后续 Phase 3b Gemma few-shot 注入打基础。

---

## 设计约束（必须遵守）

- **Fail loud / no silent fallback**：IPC handler 出错必须返回 `{ success: false, error: string }`，前端必须提示用户。
- **SCHEMAFULL SurrealDB**：option<object> 传 JS `undefined`（→ NONE），不传 `null`（→ NULL）。object 子字段必须 FLEXIBLE。
- **写方向红线**：绝对不程序化点击 X 的发布按钮。本 Phase 无涉及。
- **不新建能复用的抽象**：XInboxView 是纯 React 组件，在 host renderer 中运行，有完整 `window.electronAPI`。

---

## 任务清单

### T1 — 新增 `TweetFeedback` 类型（`src/shared/types/x-timeline-types.ts`）

在文件末尾追加：

```typescript
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
}
```

---

### T2 — DB Schema migration 1.8.3（`src/storage/surreal/schema.ts`）

在 `migration_1_8_2` 函数之后追加：

```typescript
const SCHEMA_VERSION_1_8_3 = `
DEFINE TABLE IF NOT EXISTS tweet_feedback SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS tweet_id       ON tweet_feedback TYPE string ASSERT $value != NONE;
DEFINE FIELD IF NOT EXISTS text           ON tweet_feedback TYPE string;
DEFINE FIELD IF NOT EXISTS lang           ON tweet_feedback TYPE option<string>;
DEFINE FIELD IF NOT EXISTS author_handle  ON tweet_feedback TYPE string;
DEFINE FIELD IF NOT EXISTS verdict        ON tweet_feedback TYPE string ASSERT $value INSIDE ['accept', 'reject'];
DEFINE FIELD IF NOT EXISTS reason_tag     ON tweet_feedback TYPE option<string>;
DEFINE FIELD IF NOT EXISTS source_recipe  ON tweet_feedback TYPE option<string>;
DEFINE FIELD IF NOT EXISTS created_at     ON tweet_feedback TYPE datetime;
DEFINE INDEX IF NOT EXISTS idx_fb_tweet_id ON tweet_feedback FIELDS tweet_id;
DEFINE INDEX IF NOT EXISTS idx_fb_verdict  ON tweet_feedback FIELDS verdict;
DEFINE INDEX IF NOT EXISTS idx_fb_lang     ON tweet_feedback FIELDS lang;
`;

export async function migration_1_8_3(db: Surreal): Promise<void> {
  await db.query(SCHEMA_VERSION_1_8_3);
  const now = Date.now();
  await db.query(
    `UPSERT $rid SET version = '1.8.3', appliedAt = $now,
     description = 'Add tweet_feedback table for human verdict training data'`,
    { rid: new RecordId('schema_version', '1.8.3'), now },
  );
}
```

---

### T3 — 注册 migration（`src/storage/migrations/runner.ts`）

1. import 追加 `migration_1_8_3`
2. MIGRATIONS 数组末尾追加：
```typescript
{
  version: '1.8.3',
  description: 'Add tweet_feedback table for human verdict training data',
  up: migration_1_8_3,
},
```

---

### T4 — Repo 函数（`src/platform/main/db/tweet-inbox-repo.ts`）

在文件末尾追加：

```typescript
/** 写入人工反馈（accept / reject），允许同一 tweet_id 多次投票 */
export async function insertFeedback(fb: TweetFeedback): Promise<void> {
  const db = getDB();
  await db.query(
    `INSERT INTO tweet_feedback {
      tweet_id:      $tweet_id,
      text:          $text,
      lang:          $lang,
      author_handle: $author_handle,
      verdict:       $verdict,
      reason_tag:    $reason_tag,
      source_recipe: $source_recipe,
      created_at:    $created_at
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
    },
  );
}

/** 查询 feedback 样本（Phase 3b few-shot 用） */
export async function queryFeedbackSamples(opts: {
  verdict: FeedbackVerdict;
  lang?: string;
  limit?: number;
}): Promise<TweetFeedback[]> {
  const db = getDB();
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
```

同时在文件顶部的 import 里补上 `TweetFeedback, FeedbackVerdict`：
```typescript
import type { TweetInboxRecord, AIVerdict, TweetInboxStatus, TweetFeedback, FeedbackVerdict } from '@shared/types/x-timeline-types';
```

---

### T5 — IPC channel（`src/shared/ipc/channel-names.ts`）

在 X 相关频道块（X_GET_ACTIVE_WC 之后）追加：
```typescript
X_SUBMIT_FEEDBACK: 'x:submit-feedback',  // renderer → main invoke：写入人工 verdict
X_QUERY_FEEDBACK:  'x:query-feedback',   // renderer → main invoke：查询 feedback 样本（Phase 3b 用）
```

---

### T6 — IPC handler（`src/platform/main/x/x-timeline-handlers.ts`）

1. import 追加 `insertFeedback, queryFeedbackSamples` 和类型 `TweetFeedback, FeedbackVerdict`
2. 在 `registerXTimelineHandlers()` 末尾追加两个 handler：

```typescript
// X_SUBMIT_FEEDBACK — 人工反馈 accept/reject
ipcMain.handle(IPC_CHANNELS.X_SUBMIT_FEEDBACK, async (_e, payload: unknown) => {
  const p = payload as Partial<TweetFeedback> | null;
  if (!p?.tweet_id || !p?.verdict || !['accept', 'reject'].includes(p.verdict)) {
    return { success: false, error: 'invalid payload: tweet_id and verdict required' };
  }
  try {
    await insertFeedback({
      tweet_id:      p.tweet_id,
      text:          p.text ?? '',
      lang:          p.lang,
      author_handle: p.author_handle ?? '',
      verdict:       p.verdict as FeedbackVerdict,
      reason_tag:    p.reason_tag,
      source_recipe: p.source_recipe,
      created_at:    new Date().toISOString(),
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

// X_QUERY_FEEDBACK — 查询 feedback 样本（Phase 3b 预留）
ipcMain.handle(IPC_CHANNELS.X_QUERY_FEEDBACK, async (_e, payload: unknown) => {
  const p = payload as { verdict?: string; lang?: string; limit?: number } | null;
  if (!p?.verdict || !['accept', 'reject'].includes(p.verdict)) {
    return { success: false, error: 'verdict required', samples: [] };
  }
  try {
    const samples = await queryFeedbackSamples({
      verdict: p.verdict as FeedbackVerdict,
      lang: p.lang,
      limit: p.limit,
    });
    return { success: true, samples };
  } catch (err) {
    return { success: false, error: String(err), samples: [] };
  }
});
```

---

### T7 — Preload 暴露（`src/platform/main/preload/main-window-preload.ts`）

在 `xTimeline` 对象里追加两个方法（与已有的 `runRecipe`、`queryInbox` 等同级）：

```typescript
submitFeedback: (payload: unknown) =>
  ipcRenderer.invoke(IPC_CHANNELS.X_SUBMIT_FEEDBACK, payload),
queryFeedback: (payload: unknown) =>
  ipcRenderer.invoke(IPC_CHANNELS.X_QUERY_FEEDBACK, payload),
```

> 注意：preload 里的 xTimeline 对象用 `unknown` 入参是现有惯例，保持一致。

---

### T8 — XInboxView UI（`src/views/x-inbox/XInboxView.tsx`）

#### 8-1 新增 state

```typescript
// tweet_id → 'accept' | 'reject'（本地乐观更新，避免重复点击）
const [feedbackMap, setFeedbackMap] = useState<Record<string, FeedbackVerdict>>({});
```

#### 8-2 submitFeedback 函数

```typescript
const submitFeedback = async (tweet: TweetInboxRecord, verdict: FeedbackVerdict) => {
  // 乐观更新
  setFeedbackMap((prev) => ({ ...prev, [tweet.tweet_id]: verdict }));
  const r = await api()?.submitFeedback({
    tweet_id:      tweet.tweet_id,
    text:          tweet.text,
    lang:          tweet.lang,
    author_handle: tweet.author_handle,
    verdict,
    source_recipe: tweet.search_recipe,
  });
  if (!r?.success) {
    // 回滚
    setFeedbackMap((prev) => {
      const next = { ...prev };
      delete next[tweet.tweet_id];
      return next;
    });
    setScanStatus(`反馈写入失败：${r?.error}`);
  }
};
```

#### 8-3 切状态时清空 feedbackMap

在切状态的 `useEffect` 里追加：
```typescript
setFeedbackMap({});
```

#### 8-4 卡片底部加按钮

在现有的「查看原推」「送入回复」按钮之后追加：

```tsx
{(() => {
  const fb = feedbackMap[t.tweet_id];
  return (
    <>
      <Btn
        sm
        primary={fb === 'accept'}
        onClick={() => submitFeedback(t, 'accept')}
        style={fb === 'accept' ? { background: '#16a34a', borderColor: '#16a34a' } : {}}
      >
        {fb === 'accept' ? '✓ 已采纳' : '✓ 采纳'}
      </Btn>
      <Btn
        sm
        onClick={() => submitFeedback(t, 'reject')}
        style={fb === 'reject' ? { background: '#7f1d1d', borderColor: '#7f1d1d', color: '#fca5a5' } : {}}
      >
        {fb === 'reject' ? '✗ 已拒绝' : '✗ 不采纳'}
      </Btn>
    </>
  );
})()}
```

同时在文件顶部 import 里补上 `FeedbackVerdict`：
```typescript
import type { SearchRecipe, TweetInboxRecord, TweetInboxStatus, FeedbackVerdict } from '@shared/types/x-timeline-types';
```

---

## 验收标准

1. TypeScript `npx tsc --noEmit --skipLibCheck` 零报错
2. 点「✓ 采纳」后按钮立刻变绿色「✓ 已采纳」
3. 点「✗ 不采纳」后按钮立刻变暗红「✗ 已拒绝」
4. DevTools Console 执行：
   ```javascript
   window.electronAPI.xTimeline.queryFeedback({ verdict: 'accept', limit: 10 })
     .then(r => console.log(r))
   ```
   返回 `{ success: true, samples: [...] }`，samples 里能看到刚标注的推文
5. 重启应用后 feedbackMap 为空（ephemeral），但 DB 里的 tweet_feedback 记录仍然存在

---

## 不做（Phase 3b 留存）

- 从 tweet_feedback 读取样本注入 Gemma prompt（few-shot）
- 按 lang 分组展示 feedback 统计
- 标注时弹出 reason_tag 快速选择菜单

---

## 文件清单（需改动）

| 文件 | 操作 |
|------|------|
| `src/shared/types/x-timeline-types.ts` | 追加 `TweetFeedback`, `FeedbackVerdict` 类型 |
| `src/storage/surreal/schema.ts` | 追加 `migration_1_8_3` |
| `src/storage/migrations/runner.ts` | 注册 1.8.3 |
| `src/platform/main/db/tweet-inbox-repo.ts` | 追加 `insertFeedback`, `queryFeedbackSamples` |
| `src/shared/ipc/channel-names.ts` | 追加 `X_SUBMIT_FEEDBACK`, `X_QUERY_FEEDBACK` |
| `src/platform/main/x/x-timeline-handlers.ts` | 追加两个 IPC handler |
| `src/platform/main/preload/main-window-preload.ts` | 暴露 `submitFeedback`, `queryFeedback` |
| `src/views/x-inbox/XInboxView.tsx` | 加 state + 函数 + UI 按钮 |
