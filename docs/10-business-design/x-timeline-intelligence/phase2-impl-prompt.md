# X 时间线智能筛选 Phase 2 实施 Prompt

> 总指挥：验收方（另一个对话）
> 执行方：本对话
> 依赖：Phase 1 已交付并通过验收

---

## 你的任务

本次交付两部分：

**Part A（必须先做）：修复 Phase 1 的多窗口 bug**
Phase 1 存在三处全局单例问题，在多窗口场景下会导致行为错乱，必须先修复再做 UI。

**Part B：Review Queue Web 面板**
用户在应用内置浏览器里访问 `x-inbox://index.html?wsId=xxx`，
查看已采集推文、触发扫描/判断、将推文送入回复流程。

**不需要**实现 Phase 3（Web AI 深度分析）。
**不需要**实现搜索配方配置 UI（Phase 4）。

---

## 多窗口架构背景（必读）

- **Window : Workspace = 1:1**，每个 `wsId` 对应一个独立 `BrowserWindow`
- **X webview partition per-ws 隔离**：`persist:webview-${wsId}`，不同 ws 的 X 登录态完全独立
- **X Host registry**：`Map<wsId, wcId>`（renderer 层），`x.getXHostWcId(wsId)` 取当前 ws 的 wcId
- **调度器必须同时服务所有 ws**，不能只记住最后一个操作的 ws

---

## Part A：多窗口 Bug 修复

### Fix 1：`x-search-scheduler.ts` — `activeXWcId` 改为 Map

**问题**：`let activeXWcId: number | null = null` 是全局单例。
ws-2 触发扫描会覆盖 ws-1 的 wcId，定时调度器永远只服务最后操作的那个 ws。

**修复**：

```typescript
// 改为 per-ws Map
const activeXWcMap = new Map<string, number>();

export function setActiveXWcId(wsId: string, wcId: number | null): void {
  if (wcId === null) activeXWcMap.delete(wsId);
  else activeXWcMap.set(wsId, wcId);
}

// 调度器轮询时对每个活跃 ws 分别执行
async function runEnabledRecipes(): Promise<void> {
  if (activeXWcMap.size === 0) {
    console.log('[x-search-scheduler] no active X webContents, skip');
    return;
  }

  let recipes;
  try {
    recipes = await listEnabledRecipes();
  } catch (err) {
    console.error('[x-search-scheduler] failed to list recipes:', err);
    return;
  }

  const now = Date.now();
  for (const recipe of recipes) {
    if (recipe.lastRunAt) {
      const lastRun = new Date(recipe.lastRunAt).getTime();
      if (now - lastRun < recipe.intervalMinutes * 60_000) continue;
    }

    // 对每个活跃 ws 分别执行同一配方
    for (const [wsId, wcId] of activeXWcMap.entries()) {
      console.log(`[x-search-scheduler] running recipe "${recipe.name}" for ws=${wsId}`);
      try {
        await scanRecipe(
          recipe,
          wsId,        // ← 传 wsId 用于 abort 定向
          wcId,
          filterConfig,
          (saved) => {
            pendingAccumulated += saved;
            if (pendingAccumulated >= judgeConfig.batchSize) {
              pendingAccumulated = 0;
              runJudgeBatch(judgeConfig).catch((err) => {
                console.error('[x-search-scheduler] judge batch failed:', err);
              });
            }
          },
        );
      } catch (err) {
        console.error(`[x-search-scheduler] recipe "${recipe.name}" ws=${wsId} failed:`, err);
      }
    }
    await updateLastRunAt(recipe.id, new Date().toISOString());
  }

  if (pendingAccumulated > 0) {
    pendingAccumulated = 0;
    runJudgeBatch(judgeConfig).catch((err) => {
      console.error('[x-search-scheduler] judge batch (timeout trigger) failed:', err);
    });
  }
}
```

同时删除原来的 `let activeXWcId: number | null = null` 和旧的 `setActiveXWcId`。

### Fix 2：`x-timeline-scan.ts` — `scanAbortFlag` 改为 per-ws Map

**问题**：`let scanAbortFlag = false` 是全局单例。
ws-2 点「停止」会意外终止 ws-1 正在进行的扫描。

**修复**：

```typescript
// 改为 per-ws Map
const scanAbortMap = new Map<string, boolean>();

export function abortScan(wsId: string): void {
  scanAbortMap.set(wsId, true);
}

// scanRecipe 签名新增 wsId 参数
export async function scanRecipe(
  recipe: SearchRecipe,
  wsId: string,          // ← 新增
  targetWcId: number,
  filterConfig: TimelineFilterConfig,
  onPendingReady?: (pendingCount: number) => void,
  maxScrollRounds = 5,
): Promise<ScanResult> {
  scanAbortMap.set(wsId, false);   // 重置本 ws 的 abort 标志

  // ... 循环内检查改为：
  if (scanAbortMap.get(wsId)) {
    console.log(`[x-timeline-scan] aborted by user (ws=${wsId})`);
    break;
  }
  // ...
}
```

同时删除原来的 `let scanAbortFlag = false` 和旧的 `abortCurrentScan()`。

### Fix 3：`x-timeline-handlers.ts` — 同步更新 handler 签名

**X_RUN_RECIPE handler**：payload 新增 `wsId`，传给 `setActiveXWcId` 和 `scanRecipe`：

```typescript
ipcMain.handle(IPC_CHANNELS.X_RUN_RECIPE, async (_e, payload: unknown) => {
  const p = payload as { recipeId?: unknown; wsId?: unknown; targetWcId?: unknown } | null;
  if (!p || typeof p.recipeId !== 'string') {
    return { success: false, error: 'invalid payload: recipeId required' };
  }
  if (typeof p.wsId !== 'string') {
    return { success: false, error: 'invalid payload: wsId required' };
  }
  const targetWcId = typeof p.targetWcId === 'number' ? p.targetWcId : null;
  if (targetWcId === null) {
    return { success: false, error: 'invalid payload: targetWcId required' };
  }

  const recipe = await getRecipeById(p.recipeId).catch(() => null);
  if (!recipe) return { success: false, error: `recipe ${p.recipeId} not found` };

  setActiveXWcId(p.wsId, targetWcId);   // ← 新签名

  try {
    const result = await scanRecipe(recipe, p.wsId, targetWcId, DEFAULT_FILTER_CONFIG);
    if (result.saved > 0) {
      runJudgeBatch(DEFAULT_JUDGE_CONFIG).catch((err) => {
        console.error('[x-timeline-handlers] judge batch failed:', err);
      });
    }
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});
```

**X_SCAN_PAUSE handler**：从 fire-and-forget 改为带 wsId 的 invoke：

```typescript
// channel-names.ts 中 X_SCAN_PAUSE 改为 invoke（原来是 send）
// 调用方式：ipcRenderer.invoke(X_SCAN_PAUSE, { wsId })

ipcMain.handle(IPC_CHANNELS.X_SCAN_PAUSE, (_e, payload: unknown) => {
  const p = payload as { wsId?: string } | null;
  if (p?.wsId) {
    abortScan(p.wsId);
    console.log(`[x-timeline-handlers] scan paused for ws=${p.wsId}`);
  }
});
```

### Fix 4：`tweet_inbox` / `search_recipes` 表加 `ws_id` 字段

在 `src/storage/surreal/schema.ts` 新增 **migration_1_8_1**：

```typescript
const SCHEMA_VERSION_1_8_1 = `
DEFINE FIELD IF NOT EXISTS ws_id ON tweet_inbox TYPE option<string>;
DEFINE FIELD IF NOT EXISTS ws_id ON search_recipes TYPE option<string>;
`;

export async function migration_1_8_1(db: Surreal): Promise<void> {
  await db.query(SCHEMA_VERSION_1_8_1);
  const now = Date.now();
  await db.query(
    `UPSERT $rid SET version = '1.8.1', appliedAt = $now,
     description = 'Add ws_id field to tweet_inbox and search_recipes'`,
    { rid: new RecordId('schema_version', '1.8.1'), now },
  );
}
```

在 `runner.ts` 的 MIGRATIONS 数组末尾追加 `{ version: '1.8.1', ... up: migration_1_8_1 }`。

在 `TweetInboxRecord` 类型里追加 `ws_id?: string`。
`upsertTweet` / `insertFilteredOut` 写库时把 `ws_id` 带进去（可为 null）。
`queryInbox` 支持按 `ws_id` 过滤（可选参数）。

---

## Part B：Review Queue Web 面板

### 技术选型：Electron 自定义协议

**不要**起 `http.createServer`。用 **Electron `protocol.handle`** 注册 `x-inbox://` 协议。

好处：零端口冲突、天然沙箱、在内置浏览器直接 `loadURL('x-inbox://index.html?wsId=ws-1')` 打开。

### 需要新增/修改的文件

```
新建：
src/platform/main/x-inbox-protocol/
  index.ts          ← 注册 x-inbox:// 协议
  assets/
    index.html      ← Review Queue 单页面（内联 CSS + JS，无构建步骤）

修改：
src/platform/main/index.ts
  ← app.whenReady() 后调用 registerXInboxProtocol()

src/platform/main/preload/（先 grep 找真实路径）
  ← 追加 xTimeline 命名空间

src/shared/ipc/channel-names.ts
  ← 追加新通道

src/platform/main/x/x-timeline-handlers.ts
  ← 追加新 handler

src/platform/main/db/search-recipe-repo.ts
  ← 追加 listAllRecipes()

src/platform/main/db/tweet-inbox-repo.ts
  ← queryInbox 支持 ws_id 过滤
```

### x-inbox:// 协议实现

```typescript
// src/platform/main/x-inbox-protocol/index.ts
import { protocol } from 'electron';
import path from 'path';
import fs from 'fs';

export function registerXInboxProtocol(): void {
  protocol.handle('x-inbox', (request) => {
    const url = new URL(request.url);
    const assetsDir = path.join(__dirname, 'assets');
    // x-inbox://index.html → assets/index.html
    const filename = url.hostname === 'index.html' ? 'index.html' : url.pathname.slice(1);
    const filePath = path.join(assetsDir, filename);
    try {
      const content = fs.readFileSync(filePath);
      const ext = path.extname(filePath);
      const mime =
        ext === '.html' ? 'text/html' :
        ext === '.js'   ? 'application/javascript' :
        ext === '.css'  ? 'text/css' : 'text/plain';
      return new Response(content, { headers: { 'Content-Type': `${mime}; charset=utf-8` } });
    } catch {
      return new Response('Not Found', { status: 404 });
    }
  });
}
```

### 新增 IPC 通道

在 `channel-names.ts` 追加：
```typescript
X_LIST_RECIPES  = 'x:list-recipes'   // invoke → { success, recipes }
X_REPLY_TWEET   = 'x:reply-tweet'    // invoke：{ tweetUrl, tweetId, wsId } → { success }
X_GET_ACTIVE_WC = 'x:get-active-wc'  // invoke：{ wsId } → { wcId: number | null }
```

注意：`X_SCAN_PAUSE` 在 Fix 3 里已改为 invoke（带 wsId），preload 同步更新。

### preload 追加（window.electronAPI.xTimeline）

先执行 `grep -rn "contextBridge.exposeInMainWorld" src/platform/main/` 找到真实 preload 文件，
按现有模式在 `electronAPI` 对象里追加 `xTimeline` 命名空间：

```typescript
xTimeline: {
  // 查询 tweet_inbox（支持 ws_id 过滤）
  queryInbox: (opts: { status?: string; wsId?: string; limit?: number; offset?: number }) =>
    ipcRenderer.invoke(IPC_CHANNELS.X_INBOX_QUERY, opts),

  // 手动触发配方扫描
  runRecipe: (recipeId: string, wsId: string, targetWcId: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.X_RUN_RECIPE, { recipeId, wsId, targetWcId }),

  // 暂停指定 ws 的扫描（Fix 3：改为 invoke + wsId）
  pauseScan: (wsId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.X_SCAN_PAUSE, { wsId }),

  // 手动触发 AI 批判断
  judgeNow: () =>
    ipcRenderer.invoke(IPC_CHANNELS.X_AI_JUDGE_BATCH),

  // 查询所有配方
  listRecipes: () =>
    ipcRenderer.invoke(IPC_CHANNELS.X_LIST_RECIPES),

  // 取指定 ws 当前活跃的 X wcId（面板用于拼 runRecipe 参数）
  getActiveWcId: (wsId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.X_GET_ACTIVE_WC, { wsId }),

  // 导航 X webview 到目标推文（准备回复，不填内容，写方向红线）
  replyToTweet: (tweetUrl: string, tweetId: string, wsId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.X_REPLY_TWEET, { tweetUrl, tweetId, wsId }),
},
```

### x-timeline-handlers.ts 追加的 handlers

```typescript
// X_LIST_RECIPES
ipcMain.handle(IPC_CHANNELS.X_LIST_RECIPES, async () => {
  try {
    const recipes = await listAllRecipes();
    return { success: true, recipes };
  } catch (err) {
    return { success: false, error: String(err), recipes: [] };
  }
});

// X_GET_ACTIVE_WC — 面板加载时拿到自己 ws 的 wcId
ipcMain.handle(IPC_CHANNELS.X_GET_ACTIVE_WC, (_e, payload: unknown) => {
  const p = payload as { wsId?: string } | null;
  if (!p?.wsId) return { wcId: null };
  const wcId = activeXWcMap.get(p.wsId) ?? null;
  return { wcId };
});

// X_REPLY_TWEET — 导航 X webview 到目标推文（不填内容，写方向红线）
ipcMain.handle(IPC_CHANNELS.X_REPLY_TWEET, async (_e, payload: unknown) => {
  const p = payload as { tweetUrl?: string; tweetId?: string; wsId?: string } | null;
  if (!p?.tweetUrl) return { success: false, error: 'tweetUrl required' };
  try {
    // 用 wsId 定向找正确的 X webContents，不用全局 active
    const wcId = p.wsId ? activeXWcMap.get(p.wsId) : undefined;
    if (!wcId) return { success: false, error: 'no active X webview for this workspace' };
    const { webContents } = await import('electron');
    const wc = webContents.fromId(wcId);
    if (!wc || wc.isDestroyed()) return { success: false, error: 'X webview not available' };
    wc.loadURL(p.tweetUrl);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});
```

### search-recipe-repo.ts 追加

```typescript
export async function listAllRecipes(): Promise<SearchRecipe[]> {
  const db = getDB();
  const res = await db.query<[SearchRecipe[]]>(
    `SELECT * FROM search_recipes ORDER BY name ASC`,
  );
  return res[0] ?? [];
}
```

### tweet-inbox-repo.ts 更新 queryInbox

`queryInbox` 新增可选 `wsId` 参数：

```typescript
export async function queryInbox(opts: {
  status?: TweetInboxStatus;
  wsId?: string;
  limit?: number;
  offset?: number;
}): Promise<TweetInboxRecord[]> {
  const db = getDB();
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const conditions: string[] = [];
  if (opts.status) conditions.push('status = $status');
  if (opts.wsId)   conditions.push('ws_id = $wsId');
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const res = await db.query<[TweetInboxRecord[]]>(
    `SELECT * FROM tweet_inbox ${where} ORDER BY fetched_at DESC LIMIT $limit START $offset`,
    { status: opts.status, wsId: opts.wsId ?? null, limit, offset },
  );
  return res[0] ?? [];
}
```

---

## Review Queue 面板 UI（index.html）

单页面，内联所有 CSS 和 JS，无构建步骤。
**关键**：页面加载时从 URL 参数读取 `wsId`（`new URLSearchParams(location.search).get('wsId')`），
所有 IPC 调用都带上这个 `wsId`，实现 per-ws 隔离。

### 布局

```
┌─────────────────────────────────────────────────────┐
│  📥 X Inbox  [ws-1]               [刷新] [AI判断]   │
├──────────────────┬──────────────────────────────────┤
│ 状态过滤         │  推文卡片列表                     │
│ ○ 全部           │  ┌─────────────────────────────┐ │
│ ● worth (12)     │  │ @handle · 2h ago · ❤ 0      │ │
│ ○ pending (5)    │  │ 求助！VPN连不上，有推荐吗...  │ │
│ ○ skip (30)      │  │ 🏷 VPN求助  潜在用户          │ │
│ ○ filtered (88)  │  │ ✦ 用户明确求助找翻墙工具      │ │
│                  │  │ [查看原推] [送入回复] [跳过]   │ │
│ ────────────    │  └─────────────────────────────┘ │
│ 触发采集         │  ┌─────────────────────────────┐ │
│ [配方下拉 ▾]     │  │ ...                          │ │
│ [开始扫描] [停]  │  └─────────────────────────────┘ │
│                  │  [加载更多]                       │
│ Ollama: ✅ 就绪  │                                   │
└──────────────────┴──────────────────────────────────┘
```

### 核心 JS 逻辑（伪代码，实现时补全）

```javascript
// 1. 页面初始化
const wsId = new URLSearchParams(location.search).get('wsId') ?? 'unknown';
document.title = `X Inbox [${wsId}]`;

// 2. 取当前 ws 的 wcId（用于触发扫描）
let cachedWcId = null;
async function getWcId() {
  if (cachedWcId) return cachedWcId;
  const r = await window.electronAPI.xTimeline.getActiveWcId(wsId);
  cachedWcId = r.wcId;
  return cachedWcId;
}

// 3. 加载配方下拉
async function loadRecipes() {
  const r = await window.electronAPI.xTimeline.listRecipes();
  // 填充 <select id="recipeSelect">
}

// 4. 加载推文列表
let currentStatus = 'worth';
let offset = 0;
async function loadTweets(append = false) {
  const r = await window.electronAPI.xTimeline.queryInbox({
    status: currentStatus === 'all' ? undefined : currentStatus,
    wsId,
    limit: 20,
    offset: append ? offset : 0,
  });
  if (!append) offset = 0;
  offset += r.records.length;
  renderCards(r.records, append);
}

// 5. 触发扫描
async function startScan() {
  const recipeId = document.getElementById('recipeSelect').value;
  const wcId = await getWcId();
  if (!wcId) { alert('请先在 X 视图登录（当前 workspace 无活跃 X webview）'); return; }
  setScanStatus('扫描中...');
  const r = await window.electronAPI.xTimeline.runRecipe(recipeId, wsId, wcId);
  setScanStatus(r.success ? `完成：采集 ${r.saved} 条` : `失败：${r.error}`);
  loadTweets();
}

// 6. 送入回复
async function sendToReply(tweet) {
  const msg = `即将在 X 中打开 @${tweet.author_handle} 的推文准备回复。\n\n${tweet.text.slice(0, 120)}`;
  if (window.confirm(msg)) {
    const r = await window.electronAPI.xTimeline.replyToTweet(tweet.tweet_url, tweet.tweet_id, wsId);
    if (!r.success) alert(`导航失败：${r.error}`);
  }
}

// 7. Ollama 状态检测
async function checkOllama() {
  try {
    const r = await fetch('http://localhost:11434/api/tags');
    document.getElementById('ollamaStatus').textContent = r.ok ? '✅ 就绪' : '❌ 不可用';
  } catch {
    document.getElementById('ollamaStatus').textContent = '❌ 不可用';
  }
}
```

### 卡片样式要求
- `worth` 状态：左边框 3px solid #22c55e（绿色）
- `pending` 状态：左边框 3px solid #f59e0b（黄色）
- `skip` 状态：opacity 0.5
- tags：小圆角彩色标签（`#3b82f6` 蓝底白字）
- AI reason：`#6b7280` 灰色斜体，前缀「✦ 」
- 推文文本超过 3 行折叠，点击展开

---

## 如何打开面板

用户在内置浏览器地址栏输入：
```
x-inbox://index.html?wsId=ws-1
```

`wsId` 由用户从应用界面获取（当前 workspace 的 id 显示在标题栏或可从 URL 中读取）。
Phase 2 先手动输入，后续可在 X navSide 加快捷入口。

---

## 验收清单（总指挥用）

**V-Fix1：多窗口 abort 隔离**
打开两个窗口（ws-1、ws-2），ws-1 开始扫描，ws-2 点「停止」→
ws-1 的扫描继续运行，不受影响。

**V-Fix2：多窗口 wcId 隔离**
ws-1 的面板触发扫描 → 只操作 ws-1 的 X webview，不影响 ws-2。

**V1：协议注册**
内置浏览器输入 `x-inbox://index.html?wsId=ws-1`，页面正常加载，无 `ERR_UNKNOWN_URL_SCHEME`。

**V2：wsId 显示**
页面标题和顶部显示 `[ws-1]`，确认 wsId 参数正确读取。

**V3：状态过滤**
点「worth」→ 只显示绿色左边框的推文；点「全部」→ 显示所有状态。

**V4：触发采集**
选配方 → 「开始扫描」→ 状态显示「扫描中...」→ 完成后显示采集数量，pending 数增加。

**V5：AI 判断**
点「AI 判断」→ 等约 30 秒 → worth 数量增加，卡片出现 AI reason 和 tags。

**V6：Ollama 状态**
Ollama 运行时显示「✅ 就绪」；`brew services stop ollama` 后刷新显示「❌ 不可用」。

**V7：送入回复**
点「送入回复」→ confirm 弹窗显示推文内容 → 确认后 X webview 导航到目标推文 URL。

**V8：TypeScript 编译**
```bash
npx tsc --noEmit
# 期望：零错误
```

---

## 不需要做的事

- ❌ 不起 HTTP Server，只用 Electron protocol
- ❌ 不实现 Web AI 深度分析（Phase 3）
- ❌ 不实现搜索配方编辑 UI（Phase 4）
- ❌ 不实现「跳过」状态持久化（Phase 3 补充）
- ❌ 不自动填写回复内容（写方向红线，只导航到推文）

---

## 参考文件

- Phase 1 类型：`src/shared/types/x-timeline-types.ts`
- Phase 1 handlers：`src/platform/main/x/x-timeline-handlers.ts`
- Phase 1 调度器：`src/platform/main/x/x-search-scheduler.ts`
- Phase 1 扫描：`src/platform/main/x/x-timeline-scan.ts`
- Phase 1 repo：`src/platform/main/db/tweet-inbox-repo.ts` / `search-recipe-repo.ts`
- IPC 通道：`src/shared/ipc/channel-names.ts`
- schema：`src/storage/surreal/schema.ts`
- migration runner：`src/storage/migrations/runner.ts`
- 现有 preload：`grep -rn "contextBridge" src/platform/main/`
- 技术方案全文：`docs/10-business-design/x-timeline-intelligence/tech-spec.md`
