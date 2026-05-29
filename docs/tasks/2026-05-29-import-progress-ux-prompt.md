# Import 进度可视化 + 完成确认 sub-phase — 任务 Prompt

> 这份 prompt 给新会话执行。直接把整份文档作为 user message 发给新对话即可。
> Self-contained — 新对话没有 5B / Stage 1-9 上下文。

---

## 0. 你的身份 + 总目标

你是 KRIG-Note V2 的**实施工程师**。本次任务是把"文件导入"的**用户体验从"黑屏静默"改善为"进度可见 + 完成可见"**。

**当前用户体验问题**（用户字面反馈）：
- 用户点 import → **完全没视觉反馈** → 几秒后 NavSide 列表静默多出 N 篇 note → 用户不知道什么时候真正完成
- 失败时弹 `window.alert`，成功时**字面没任何 toast / 确认**
- 5B 设计 §7.5.2 字面拍板 `broadcastMode: 'progressive-throttle'` 字段，**但本期不实施 view 端 UI**（接口预留了，UI 字面缺）

**好消息**：V2 字面**已有完整的进度 overlay 基础设施**（[`src/shell/global-progress-overlay/GlobalProgressOverlay.tsx`](../../src/shell/global-progress-overlay/GlobalProgressOverlay.tsx) + IPC 通道 + `runWithProgress` 包装函数），原为 backup/restore 用，**完全可复用给 import**。本 sub-phase 字面**不需要新建 UI 体系**，只需把 import 链路接进去。

**Agent 类型**：`general-purpose`（不是 Plan — Plan 没 Write/Edit）

---

## 1. 必读上下文

### 1.1 项目根 + 分支

- 仓库根：`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`
- **实施分支**：`feature/import-progress-ux`（用户预先 checkout）
- 第一步：`cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && pwd && git remote -v | head -1 && git branch --show-current` 三联守门

### 1.2 既有 progress 基础设施字面位置

**main 端**：
- [`src/platform/main/window/run-with-progress.ts`](../../src/platform/main/window/run-with-progress.ts) — 字面提供 `runWithProgress<T>(title, task, options)` 包装函数：
  - 自动 fire `PROGRESS_START` / `PROGRESS_UPDATE` / `PROGRESS_DONE` 三事件
  - 提供 `reportProgress(message, current, total)` 回调给 task 函数
  - 自动捕获 task 抛错 → fire DONE event with `success: false`
- IPC 字面 `IPC_CHANNELS.PROGRESS_START / PROGRESS_UPDATE / PROGRESS_DONE`（[`src/shared/ipc/channel-names.ts:197-199`](../../src/shared/ipc/channel-names.ts)）
- 类型 `ProgressStartPayload / ProgressUpdatePayload / ProgressDonePayload`（[`src/shared/ipc/backup-types.ts`](../../src/shared/ipc/backup-types.ts) — 看一眼字面 schema）

**renderer 端**：
- [`src/shell/global-progress-overlay/GlobalProgressOverlay.tsx`](../../src/shell/global-progress-overlay/GlobalProgressOverlay.tsx) — fixed inset:0 全屏 overlay
  - 自动订阅 3 个 progress 事件
  - 字面**已挂载在 App renderer**（不需要你接 view）
  - 字面**阻塞 UI**（onClick stopPropagation；用户必须等任务完成）
  - 字面有 `indeterminate` / `current/total` 进度条 + `title` / `message` / `doneMessage`

**现有 backup 用法字面参考**：grep `runWithProgress` 看 backup / restore 怎么用的（main 端入口包装）。

### 1.3 当前 import 链路字面位置（不要改流程，只在合适位置加 reportProgress）

#### markdown / docx import 入口（renderer fire IPC，main 转发回 renderer 处理）

字面流程：
1. 用户菜单 `File → Import Markdown...` → main 端 `MARKDOWN_IMPORT_RUN` IPC broadcast 给 renderer（携带 `ScannedFile[]`）
2. renderer [`src/views/note/use-markdown-import.ts:33`](../../src/views/note/use-markdown-import.ts) 字面订阅 IPC → 调 `importMarkdownBatch(payload)`
3. [`src/views/note/markdown-import.ts:471`](../../src/views/note/markdown-import.ts) `importMarkdownBatch` 字面：
   - 循环每文件 → `markdownToAtoms(body, { titleHint })` 收集 batch items
   - 末尾 1 次 `noteCap().createNotesBatch({ items, broadcastMode: 'final' })`
   - 返回 `{ createdNoteIds, createdFolderIds, skipped, splitMode }`

**关键事实**：此链路字面**完全在 renderer 端跑**（除最后一步 `createNotesBatch` IPC 调 main 写库）。`runWithProgress` 字面是 main 端工具 — **renderer 调用方需要不同接入方式**（见 §2.3）。

#### KRIG_IMPORT (PDF extraction) 入口

字面流程：
1. main 端 [`src/platform/main/extraction/handlers.ts:120`](../../src/platform/main/extraction/handlers.ts) 字面接 webview 推送 → `EXTRACTION_NOTE_CREATE` broadcast
2. renderer [`src/views/note/extraction-import.ts`](../../src/views/note/extraction-import.ts) 字面订阅 → 调 `krigBatchToAtoms(batch)` → `createNotesBatch`

**同样**：renderer 端流程。

#### word import 入口

word-mammoth / word-pandoc 字面**在 main 进程跑**（docx 解析转 markdown）— 这里**可直接用 `runWithProgress`**。但**最终走的是 markdown 路径**（看 [`src/platform/main/word-import/index.ts`](../../src/platform/main/word-import/index.ts) 字面 grep），所以 word import progress 可分两段（main 解析阶段 + renderer markdown 路径阶段）。**本期范围不动 word**（见 §2.6）。

### 1.4 5B 设计字面 broadcastMode 预留接口

[`src/capabilities/note/types.ts:35-37`](../../src/capabilities/note/types.ts) 字面：

```ts
export interface CreateNoteBatchInput {
  items: CreateNoteBatchItem[];
  broadcastMode?: 'final' | 'progressive-throttle';
  throttleMs?: number;
}
```

[`src/platform/main/note/capability-impl.ts:535-536`](../../src/platform/main/note/capability-impl.ts) 字面注释：
> broadcastMode='progressive-throttle': 字面不实施 (本期接口保留).

→ 本期 sub-phase 字面**不实施 progressive-throttle broadcast**（那是 NOTE_LIST_CHANGED 的细粒度推送，跟 UI progress 是两件事 — 一个推存量，一个推进度）。**本期只接 PROGRESS_START/UPDATE/DONE 三事件**。

---

## 2. 任务（按 Step 1-6 顺序）

### 2.1 Step 1：main 端 createNotesBatch 字面加 progress 上报

文件：[`src/platform/main/note/capability-impl.ts`](../../src/platform/main/note/capability-impl.ts)

**字面只需 3 处增加**：

#### A. import runWithProgress + 进度类型

文件顶部 import 区字面加：

```ts
import { runWithProgress, type ProgressReporter } from '@platform/main/window/run-with-progress';
```

#### B. `createNotesBatch` 字面**包一层** runWithProgress

字面原签名不动（保留对外 API），内部把核心逻辑字面挪到一个 helper，runWithProgress 字面包装外层：

```ts
export async function createNotesBatch(
  input: CreateNoteBatchInput,
): Promise<CreateNoteBatchResult> {
  // 字面: < 5 篇时不显示 progress overlay (短任务不打扰); ≥5 篇走 runWithProgress
  if (input.items.length < 5) {
    return createNotesBatchInternal(input, null);
  }
  return runWithProgress(
    `正在导入 ${input.items.length} 篇笔记`,
    async (reportProgress) => createNotesBatchInternal(input, reportProgress),
    {
      doneMessage: (result) => ({
        success: result.failures.length === 0,
        message:
          result.failures.length === 0
            ? `已完成 ${result.notes.length} 篇`
            : `完成 ${result.notes.length} 篇,失败 ${result.failures.length} 篇 (详见控制台)`,
      }),
    },
  );
}
```

#### C. `createNotesBatchInternal` 字面接 reportProgress

把原 `createNotesBatch` body 字面挪到新 `createNotesBatchInternal(input, reportProgress)`，在 for 循环每 item 完成后字面上报：

```ts
async function createNotesBatchInternal(
  input: CreateNoteBatchInput,
  reportProgress: ProgressReporter | null,
): Promise<CreateNoteBatchResult> {
  const { items, broadcastMode = 'final' } = input;
  const notes: NoteInfo[] = [];
  const failures: CreateNoteBatchFailure[] = [];

  // ... 字面 chunk warn 不动 ...

  try {
    await storage.transaction(async (tx) => {
      for (let i = 0; i < items.length; i++) {
        try {
          const note = await createSingleNoteFromDrafts(tx, items[i]);
          notes.push(note);

          // 字面上报进度 (每 item 完成一次)
          reportProgress?.(
            `已导入 ${i + 1}/${items.length} 篇: ${note.title || '(无标题)'}`,
            i + 1,
            items.length,
          );
        } catch (err) {
          failures.push({ index: i, error: String(err), rolledBack: true });
          throw err;
        }
      }
    });
  } catch (err) {
    // ... 字面回滚处理不动 ...
  }

  if (broadcastMode === 'final' && notes.length > 0) {
    broadcastNoteListChanged();
  }
  return { notes, failures };
}
```

**关键字面**：
- `< 5 items` 字面**不走 progress overlay**（短任务不打扰用户；阈值字面可调）
- ≥ 5 items 字面走 runWithProgress 包装 → overlay 自动显示
- 每 item 完成字面上报一次（含 note title — 用户看得到字面进度）

#### D. 文件顶部 jsdoc 字面登记

在 `createNotesBatch` 函数注释字面加：

```
 * 2026-05-29 import UX sub-phase: ≥5 items 字面包装 runWithProgress 显示
 * 全屏 overlay (含进度条 + 标题 + 每篇 note title)。<5 items 短任务字面跳过
 * overlay 减少打扰。
 *
 * 5B §7.5.2 字面 broadcastMode='progressive-throttle' 字段仍不实施 (那是 list
 * refresh 频率,与 PROGRESS_UPDATE 是两件事;本 sub-phase 仅接后者).
```

### 2.2 Step 2：view 端清理冗余 alert / console.log

文件：[`src/views/note/use-markdown-import.ts`](../../src/views/note/use-markdown-import.ts)

字面**有以下冗余**（现在 progress overlay 已显示，不需要再 alert）：
- line 61-69 字面 `window.alert("Import completed with errors...")` — overlay 已显示 done 消息字面有 `(详见控制台)` 提示
- line 81-84 字面 `window.alert("Import failed catastrophically")` — runWithProgress 字面抛错时 overlay 已显示 `失败: ...`

**字面拍板**：
- **保留** oversized 决策 `window.confirm`（line 22 — 这是导入前问 split 模式，与 progress 无关）
- **保留** `result.skipped` 失败时的 `console.warn`（line 47-60 — 详细错误清单，开发者用）
- **删除** line 61-69 字面 `window.alert`（progress overlay 字面已显示 doneMessage）
- **删除** line 81-84 字面 `window.alert`（runWithProgress 字面已显示失败 overlay）

字面替换为简化版：

```ts
.then((result) => {
  const elapsedMs = Math.round(performance.now() - batchStart);
  console.log(
    `[markdown-import] done — notes=${result.createdNoteIds.length} folders=${result.createdFolderIds.length} skipped=${result.skipped.length} splitMode=${result.splitMode} elapsed=${elapsedMs}ms`,
  );

  // 失败强制可见(2026-05-27 反馈:长 docx Split All 部分 chunk 静默
  //   失败 → 重启 cache 清空后 NoteView 拼出半截。修法:不再吞 skipped)
  // 2026-05-29 import UX sub-phase: progress overlay 已显示 success/fail toast.
  // 字面仅保留 console.warn 详细失败清单 (开发者诊断用),删 window.alert (重复 UI).
  if (result.skipped.length > 0) {
    console.warn(
      `[markdown-import] SKIPPED ${result.skipped.length} item(s):\n${result.skipped
        .map((s) => `  - ${s.relPath}: ${s.reason}`)
        .join('\n')}`,
    );
  }

  // 导入完成后,把最后一个创建的 note 设为当前 NoteView 的 active
  const lastId = result.createdNoteIds.at(-1);
  if (lastId) {
    setActiveNote(workspaceId, lastId);
  }
})
.catch((err) => {
  // 2026-05-29 import UX sub-phase: progress overlay 字面已显示 catastrophic 失败.
  // 字面仅 console.error 留 stack trace (开发者诊断用), 删 window.alert.
  console.error('[markdown-import] BATCH FATAL:', err);
});
```

### 2.3 Step 3：renderer ↔ main 字面进度上报通道

#### 重要技术约束（必读）

`runWithProgress` 字面是 **main 端工具**（用 `getMainWindow().webContents.send` 推 IPC）。

`createNotesBatch` 字面被 `handlers.ts` 字面 `ipcMain.handle('note.create-batch', ...)` 调用 — **它就在 main 进程**。所以 Step 1 字面**字面可行**：runWithProgress 字面包在 createNotesBatch 内部，main → renderer 字面通畅。

但 [`src/views/note/markdown-import.ts`](../../src/views/note/markdown-import.ts) 字面**每文件解析（`markdownToAtoms`）在 renderer 跑**。Step 1 字面只上报"写库阶段"进度，**不上报"解析阶段"**。

#### 选项 A（推荐）：仅写库阶段进度，解析阶段静默

字面**接受** "解析阶段无 overlay"（因为：解析快、每文件 < 200ms）。overlay 字面在用户调 `createNotesBatch` 那刻才显示，title 字面 `正在导入 N 篇笔记`。

→ Step 1 字面**完整实现这个**。Step 3 字面**无额外工作**。

#### 选项 B：解析阶段也显示 overlay（不推荐，本期跳过）

需要 renderer 主动调 main 端字面 fire PROGRESS_START（新 IPC channel）— 字面复杂度高。**本 sub-phase 跳过**。

**拍板字面：选 A**。Step 3 字面**仅验证 Step 1 真的 fire 了 IPC 字面能被 renderer 收到**：跑一遍 npm start，import 10 个 markdown 文件，**字面看 overlay 是否字面显示 + 进度数字字面跳动 + 完成 toast 字面显示**。

### 2.4 Step 4：extraction-import 同步切

文件：[`src/views/note/extraction-import.ts`](../../src/views/note/extraction-import.ts)

字面**完全不动 view 端**。Step 1 字面包了 createNotesBatch — extraction 调 createNotesBatch 字面自动享受 overlay。

字面验证：跑 extraction（KRIG_IMPORT 推送），看 overlay 字面显示。

### 2.5 Step 5：测试 + 验收

#### V1：typecheck 0 错

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "src/main/ipc/handlers.ts\|src/renderer/shell/WorkspaceBar.tsx"
```

期望 0 行。

#### V2：现有测试 0 fail（5B Stage 9 vitest 字面有 5 单元测 + 5 场景测 + 1 bench）

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && npm run test
```

期望全 PASS。**特别注意**：`tests/capabilities/note/create-notes-batch.test.ts` 字面会被你的 Step 1 改动影响。如果测试字面调用 `createNotesBatch` 字面挂掉（因为 `runWithProgress` 字面调 `getMainWindow()` 在测试环境字面没有窗口），字面需要：

- **不改测试**（用户拍板 — 字面 5B Stage 9 测试是规范基线）
- 字面**修 Step 1 implementation**：`< 5 items` 字面跳过 runWithProgress（避免测试场景挂） — 这字面是 Step 1.B 字面已经写的逻辑
- 字面**确认** 5B Stage 9 测试用例字面**都用 < 5 items**（grep `createNotesBatch.*items` 字面确认）

#### V3：手动 npm start 验证

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && npm start
```

字面操作：
1. NavSide 右键 → import markdown → 选 5+ 个 markdown 文件目录
2. **字面观察**：overlay 字面显示 `正在导入 N 篇笔记` + 进度条字面从 0 走到 100%
3. **字面观察**：进度文字字面更新（"已导入 3/10 篇: My Note Title"）
4. **字面观察**：完成后 overlay 字面显示 `已完成 N 篇` + 自动消失（V2 GlobalProgressOverlay 字面 done 后字面有 auto-dismiss 逻辑 — grep 字面确认）

#### V4：失败场景手动验证

字面**临时构造一个失败 import**（例如 markdown 文件含字面非法字符触发 createSingleNoteFromDrafts 抛错），看 overlay 字面显示 `失败: ...` 字面消息。

如果字面没条件构造 — 字面跳过 V4，**在汇报里登记 "V4 未跑"**。

#### V5：< 5 篇短任务字面不显示 overlay

字面 import 1 / 2 / 4 个 markdown — overlay 字面**不显示**（短任务字面跳过 runWithProgress）。

### 2.6 本 sub-phase **不**做的

字面**禁止**改动以下：

- ❌ word import (`src/platform/main/word-import/`) — word 进度字面需要 main 端解析阶段 + renderer markdown 阶段双段进度，本 sub-phase 字面太复杂
- ❌ paste 跨 note import (`src/views/note/tree-operations.ts:183` 字面 createNote 单条) — 单条快，字面不需 overlay
- ❌ ebook 标注 (`updateNote` 路径) — 单 block 操作，字面不需
- ❌ 5B §7.5.2 字面 `progressive-throttle` broadcastMode — 那是 NOTE_LIST_CHANGED 推送频率，与 PROGRESS_UPDATE 字面是两件事，本期不动
- ❌ ImportSession.cancel() 取消 UI — 5B §7.5.3 字面留 view 层 sub-phase，本期不动
- ❌ 持久化 import history — 字面留独立 sub-phase
- ❌ 改 `GlobalProgressOverlay.tsx` 字面 UI — 现有形态字面够用

### 2.7 Step 6：Commit 纪律

**拆 2 commit**：
- **commit a**：main 端 — capability-impl.ts 字面 runWithProgress 接入（Step 1 全部）
- **commit b**：view 端 — use-markdown-import.ts 字面清理冗余 alert（Step 2 全部）

每段 commit 前 V1 typecheck 必须 0 错。如 sandbox 拦 tsc / git，**停下来汇报让总指挥介入**。

- **不要** push
- **不要** merge 到 main
- 不要 commit `docs/tasks/import-progress-ui-prompt.md` / `2026-05-29-stage-5B-impl-7-prompt.md` 等老 untracked
- **可以** commit 本 prompt 文档 `docs/tasks/2026-05-29-import-progress-ux-prompt.md`（与 commit a 同 commit）

---

## 3. 操作纪律（违反任意一条立刻停手报告）

### 3.1 cwd 漂移防御

V2 cwd 漂移已 15 次事故记录。每条 Bash 都必须 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`。Read/Edit/Write 一律绝对路径。

三联守门：

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && pwd && git remote -v | head -1 && git branch --show-current
```

V1 / V2 速判：
- V1 顶层有 `src/main/` / `src/renderer/` / `src/plugins/`
- V2 顶层有 `src/platform/main/` / `src/views/` / `src/capabilities/` / `src/drivers/` / `src/storage/` / `src/semantic/`
- V1 main hash `47015ed8` / V2.git URL 字面 `KRIG-Note-V2.git`

### 3.2 sandbox 限制（已知）

harness 可能拦 `tsc` / `git add` / `git commit` / `npm run test` / `npm start`。**遇拦截不走 `--dangerouslyDisableSandbox`**，停手汇报让总指挥介入。

### 3.3 严格不动 src/ 范围外

可以：改 `src/platform/main/note/capability-impl.ts` + `src/views/note/use-markdown-import.ts`，commit 本 prompt 文档。

**严禁**：
- ❌ 改 `GlobalProgressOverlay.tsx` 字面 UI
- ❌ 改 `runWithProgress.ts` 字面（这是稳定共用工具）
- ❌ 改 `tests/` 任何文件（5B Stage 9 测试基线）
- ❌ 改 word-import / paste / ebook 路径
- ❌ 切其它分支 / merge / push / docs/（除本 prompt 文档外）
- ❌ 操作数据库 / 跑 migration

### 3.4 完成标准

- 5 个 V1-V5 验收 PASS（V4 字面可标注 "未跑" 如条件不足）
- 2 个 commit 在 `feature/import-progress-ux` 分支
- 用户字面**看得到**进度 overlay + 完成 toast

完成后向调用方汇报：
- 2 个 commit hash + 改动文件清单（应字面只动 2 个 src 文件 + 1 prompt 文档）
- V1-V5 各项验收结果
- 实施过程中发现的 src/ bug（如有，**只登记不修**）
- 任何与 5B Stage 9 测试用例字面冲突的发现（特别是 vitest 跑 createNotesBatch 在 < 5 items 路径是否字面通畅）

---

## 4. Agent 配置建议（给调用方）

- **agent 类型**：`general-purpose`
- **后台运行**：可后台。完成时通知
- **预期工作时间**：1-2 小时（main 端 50 行改动 + view 端 30 行删除 + V1-V5 验收）

---

## 5. 已知风险

1. **runWithProgress 字面调 `getMainWindow()`**：测试环境字面没窗口，函数字面 return undefined → `sendToMain` 字面 early return — 字面**不抛错**（safe），测试字面不会因此挂。但**测试字面看不到 overlay** — 这是预期。

2. **GlobalProgressOverlay 字面 auto-dismiss 行为**：grep 字面确认 done event 后 overlay 是否字面自动消失。如果**不自动消失**，**字面不要改它** — 在汇报里登记 "用户点击 overlay 后字面消失" 或 "需要补 auto-dismiss"，留独立 sub-phase。

3. **`< 5 items` 阈值字面拍板**：用户拍板 5 — 字面在代码里**字面用 magic number 5**（写注释字面说明）。未来字面调阈值是另一个决策点。

4. **doneMessage 字面双语**：当前 backup 字面用中文 `失败: ...`，import 字面**保持中文一致**（不混英文）。

---

*Import 进度 UX sub-phase · 2026-05-29 · self-contained · 用户拍板：复用 GlobalProgressOverlay + < 5 items 阈值 + 删冗余 alert*
