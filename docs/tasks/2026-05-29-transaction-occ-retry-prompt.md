# Fix: storage.transaction OCC 冲突 retry + cancel 容错

> 单机单用户场景 import 期间 `note.update` 并发触发 SurrealDB OCC `Transaction conflict: Resource busy` 反复抛错,decision 020 §9.4 字面 defer 到"sub-phase 5+ 协作场景",但用户**单用户单机**已稳定复现.本期补 retry + cancel 容错.

---

## 0. 角色 / 工作纪律

你是 PR D 实施 subagent. **strict mode**:

1. 只动本 prompt §3 / §4 列的文件,**不擅自重构**周边代码
2. **每条 Bash 必 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`**(V2 cwd 漂移已 16 次事故)
3. **memory 必读**:
   - `feedback_surrealdb_4x_no_type_thing` — 新 SQL 函数必 grep verify
   - `feedback_surrealdb_inside_not_in` — IN vs INSIDE
   - `feedback_filter_single_vs_batch_mutex` — filter 字段互斥纪律
   - `feedback_strict_compliance_workflow` — strict 4 条
   - `feedback_v2_is_workspace_v1_is_reference` — V2 工作 V1 只读
4. sandbox 拦截 `git commit/push`/`npm start` 等 → 停手汇报,**禁** `--dangerouslyDisableSandbox`
5. 发现非本 prompt 范围的 bug → **登记到汇报里**,不擅自修
6. **禁止**用 fallback / 兜底绕过未诊断根因(`feedback_no_fallback_bandaid_fixes`)

---

## 1. 背景:为什么现在做

### 1.1 现象

用户导入文档后终端日志反复刷:

```
Error occurred in handler for 'note.update':
  InternalError: Transaction conflict: Resource busy: . This transaction can be retried
[storage.transaction] cancel failed after fn error
  ValidationError: Transaction not found
```

**成对出现循环刷屏**.

### 1.2 一级根因:SurrealDB OCC

SurrealDB 4.x 走 OCC (Optimistic Concurrency Control) — 两个 transaction 并发写同一 record/table 时,后 commit 抛 `Transaction conflict: ... can be retried`.

decision 020 §3.5.ter 字面已 binary verify 这个语义,§9.4 拍板"**本 sub-phase 不内置 retry**"理由 = "单机单用户场景并发冲突概率极低,留 sub-phase 5+ 协作场景启动时单独决议".

**但用户实测在单机单用户场景已稳定复现**,假设证伪.

### 1.3 二级根因:cancel 容错缺失

[src/storage/surreal/storage.ts:501-509](src/storage/surreal/storage.ts#L501-L509):

```ts
} catch (err) {
  try {
    await surrealTx.cancel();
  } catch (cancelErr) {
    // cancel 失败不遮盖原 fn 错误 (decision 020 §4.1 / §9.5)
    console.error('[storage.transaction] cancel failed after fn error', cancelErr);
  }
  throw err;
}
```

OCC 冲突时 SurrealDB **已自动 rollback 事务**,再 cancel 报 `Transaction not found`.这不是 bug,是 SDK 行为.但 `console.error` 当成异常输出,日志噪音.

### 1.4 并发源头

`note.update` ipcMain.handle 一来就跑 `updateNote(id, doc)` — handler 间**无串行化**.导入期间并发触发点(已查证):

- import batch 自身**已串行**(`importMarkdownBatch` → 末尾 1 次 `createNotesBatch`),非导入直接撞
- **嫌疑源**:用户导入期间继续在 NoteView 编辑某 note → 用户输入触发 `note.update`;**同时**导入流程内 `createNotesBatch` / folder broadcast 在写库;两个 transaction 同时 commit 撞 OCC
- 也可能 AI sync / thought / 后台 push 走 `note.update` 路径

**本期不去 grep 抓"谁是并发源头"** — 修法是让 storage.transaction 透明 retry,跟源头无关.

---

## 2. 决议偏离登记(本期破 decision 020 §9.4)

decision 020 §9.4 字面拍板"不内置 retry,留 sub-phase 5+".本期 PR D **字面破** §9.4 拍板,理由:

| § | 原拍板 | 实测证伪 |
|---|---|---|
| 9.4 理由 1 | "单机单用户场景并发冲突概率极低" | 用户单机单用户导入文档稳定复现 |
| 9.4 理由 2 | "内置 retry 引入新设计点(超时 / 退避 / fn 副作用)超出本 sub-phase 范围" | 现已超出 sub-phase 3a-tx,本期 PR D 单独决议 |
| 9.4 理由 3 | "留 sub-phase 5+ 协作场景启动时单独决议" | 协作场景未到,但单机已破,提前到本期 |

**本期 PR D 完成后,必须更新 decision 020 §9.4** 拍板改为"内置 retry (本期 PR D 实施)" + 偏离登记到 §10 类型 C.

---

## 3. 实施范围

### 3.1 改 `src/storage/surreal/storage.ts:483-510` 的 `transaction()` 方法

加 3 个机制:

#### (a) OCC retry with exponential backoff

字面规格:

```
retry policy:
  - 检测错误:catch (err) 后判断 err.message includes
    'Transaction conflict' OR 'Resource busy' OR 'can be retried'
    (字面 grep SurrealDB 源 / 实测错误字符串,匹配宽松)
  - 最大重试:3 次 (默认,函数级 option 可覆盖)
  - 退避:50ms / 100ms / 200ms (指数 2× backoff)
  - 重试期 fn 副作用:fn 必须可重入(transaction 语义 = fn 内部 await 全
    走 tx,本身已隔离;non-tx 副作用如 console.log 重复执行可接受)
  - 用尽 retry 仍冲突:throw 原 err(透传给 caller,handler 层兜底返 null)
```

#### (b) Cancel 容错

cancel 时若错误 message includes `'Transaction not found'`,**静默吞掉**(降级到 debug log 或彻底吃).其它 cancel 错误继续 `console.error` (保留诊断能力).

#### (c) Diagnostic log 升级

retry 触发时 `console.log('[storage.transaction] OCC conflict, retry N/3 after Xms')` — 用户可见 retry 在工作,不只看到错误刷屏.

### 3.2 加 `transaction()` 第二参 options(可选)

```ts
interface TransactionOptions {
  /** OCC retry 最大次数,默认 3 */
  maxRetries?: number;
  /** 初始退避 ms,默认 50 */
  initialBackoffMs?: number;
}

async transaction<T>(
  fn: (tx: StorageTransaction) => Promise<T>,
  options?: TransactionOptions,
): Promise<T>
```

向后兼容 — 22+ 现有 caller 全不动(不传 options 用默认).

**API doc 注释字面写**:本方法已加 OCC retry,caller 不应自己 try-catch retry.OCC 冲突会被吞;其它 err 透传.

### 3.3 验收

- V1 typecheck 0 错
- V2 50/50 现有 tests PASS(行为不变,只加 retry)
- 新加 tests 至少 3 case(`tests/storage/transaction-retry.test.ts`):
  1. OCC 冲突 → 重试成功 (mock 第 1 次抛 conflict 第 2 次 PASS)
  2. 重试用尽 → throw 原 err
  3. 非 OCC err → 直接 throw 不重试
- npm start 冷启动 0 错
- **模拟导入 + 同时编辑**:用户复现 — 终端 log 应见 `[storage.transaction] OCC conflict, retry N/3` 但**无** `Error occurred in handler for 'note.update'` 刷屏

### 3.4 反对策:**禁止**

- ❌ **不要**全局加 mutex 把所有 transaction 串行化(性能灾难 + 改 decision 020 §3.5 拍板)
- ❌ **不要**改 IPC handler 加 queue(架构债 + 跟 transaction 层无关)
- ❌ **不要**用 fallback "失败时跳过" 当成 retry 替代品(`feedback_no_fallback_bandaid_fixes`)
- ❌ **不要**碰 caller 层(22+ 调用站点) — 本期只动 `storage.transaction` 实现

---

## 4. 文件清单

| 文件 | 改动 |
|---|---|
| `src/storage/surreal/storage.ts:483-510` | `transaction()` 加 retry + cancel 容错 + log |
| `src/storage/api.ts` | `transaction` 签名加 options 参 + 接口注释更新 |
| `tests/storage/transaction-retry.test.ts` | **新建** 3 case |
| `tests/mocks/storage-mock.ts` | mock transaction 加 options 第二参(若类型签名要求)|
| `docs/RefactorV2/data-model/persistence/decisions/020-sub-phase-3a-tx-true-atomicity.md` | §9.4 改"已 PR D 实施" + §10 加 C 类偏离登记 |

---

## 5. 实施步骤

1. `cd /V2 && git checkout -b fix/transaction-occ-retry main`(用户预先切,sandbox 拦你就报)
2. 读 [src/storage/surreal/storage.ts:483-510](src/storage/surreal/storage.ts#L483-L510) 完整上下文
3. 读 decision 020 §3.5.ter (line 402-440) 和 §9.4 (line 951-960) 字面拍板
4. 实施 §3 改动,commit:
   ```
   fix(storage): transaction OCC 冲突 retry + cancel 容错

   破 decision 020 §9.4 拍板:单机单用户场景已实测 OCC 冲突
   (导入期间 note.update 并发),提前到本期实施 retry.

   - retry policy: 最大 3 次, 50/100/200ms 指数退避
   - cancel 容错: Transaction not found 静默吞,其它保留 console.error
   - 加 TransactionOptions 第二参(可选),向后兼容 22+ caller
   - 加 diagnostic log: OCC retry N/3 after Xms

   Co-Authored-By: ...
   ```
5. 新加 3 个 test case → commit
6. 更新 decision 020 → commit
7. `npm run test`(V2 mock tests 含新加 3 case 全 PASS),sandbox 拦了报
8. **V5 实测**:用户跑 `npm start` 复现导入 + 编辑场景,贴日志给主对话

---

## 6. 风险 + 已知坑

### 6.1 retry policy 触发期 fn 副作用

storage.transaction 的 fn 内部 await 全走 `tx.query`,本身已隔离.但 fn 内可能有:

- `console.log` — 重复执行可接受(诊断噪音)
- 外部 state 修改(eg 业务对象 mutation)— **caller 责任保证 fn 可重入**,本期 API doc 字面注释提醒

### 6.2 OCC 错误字符串匹配宽松度

SurrealDB 4.x 错误 message 可能字面变化(SDK 升级).采宽松 OR 匹配:

```ts
function isOCCConflict(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('Transaction conflict') ||
    msg.includes('Resource busy') ||
    msg.includes('can be retried')
  );
}
```

未来 SDK 字面变更需更新 — 加单独函数便于 grep + 维护.

### 6.3 用户本地 fix 但 web 端 (KRIG Knowledge Platform @ 192.168.1.240) 没 fix

KRIG-Note V2 是 desktop,fix 仅落 V2 仓库.web 端如果用相同 storage 层有同 bug 需独立 fix(本 PR 不管).

### 6.4 与 PR C delete-batch 关系

deleteNote 单事务 6100 块串行卡死(`project_delete_note_batch_plan`)是独立 PR C.但**有共性** — 都是单事务大量写撞 OCC + 阻塞.PR C 实施时:

- transaction retry 已就位,delete-batch 不需自己 retry
- PR C 还需做"分批 + sweeper + pending flag" 解决"单事务 6100 块过大"本身

PR D 不阻塞 PR C,PR C 实施期可在本 PR retry 基础上加 batch 拆分.

---

## 7. 完成后汇报模板(向主对话)

```
PR D transaction OCC retry 完成汇报:

一、产出
- N commit(列 hash + 描述)
- 文件 (按 §4 清单)

二、3 项机制
- (a) retry policy: 字面规格
- (b) cancel 容错: 字面规格
- (c) diagnostic log: 实测样例

三、验收
- V1 typecheck: PASS / FAIL
- V2 现有 50/50: PASS / FAIL
- V3 新 3 case: PASS / FAIL
- V4 grep: isOCCConflict / TransactionOptions 命中位置
- V5 npm start 实测: 用户复现 import + edit, 日志变化样例

四、关键决策 + 教训
- 决策(列出本期偏离原决议/prompt 的拍板)
- 教训 memory(列建议新增/更新的 memory)

五、剩余债 + 下游 PR
- (PR C delete-batch + 其它)

六、等待指挥拍板
- 合 main: git merge fix/transaction-occ-retry --no-ff
- push: git push origin main
- decision 020 文档更新 commit 是否合本 PR 一起 push
```

---

## 8. Self-Contained Check

新会话 subagent 不必跑额外调研,本 prompt 已含:

- ✅ 根因(OCC + cancel + 并发源)
- ✅ 修法规格(retry policy / cancel 容错 / log)
- ✅ 改动范围(5 文件)
- ✅ 验收清单(V1-V5)
- ✅ 反对策(禁止的修法)
- ✅ 决议偏离登记规范
- ✅ 风险 + 已知坑
- ✅ 汇报模板

唯一外部依赖:

- `git checkout -b fix/transaction-occ-retry main` — 主对话或用户预切
- `npm start` 实测复现 — 用户跑(sandbox)

---

*Prompt 文档 · 2026-05-29 · fix/transaction-occ-retry · 字面破 decision 020 §9.4*
