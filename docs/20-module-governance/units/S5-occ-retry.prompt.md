# S5 执行 Prompt — OCC 指数退避重试

## 背景

这是多窗口架构治理 step2 独立单元（S5）。

**目标**：在 `src/storage/surreal/storage.ts` 的事务写路径 `transaction()` 方法上，加一层**指数退避重试**，把 SurrealDB 乐观锁冲突（`Transaction conflict: Resource busy`）从「直接失败丢弃」变成「自动重试直到成功」。

**背景数据（多窗口并发写探针，2026-07-20 实测）**：
- 无重试：2 writer 并发写 ×200 次，95.5% 成功，**18 次冲突（4.5% 丢弃）**
- 指数退避重试：**100% 成功**，最大重试深度仅 1 次，耗时几乎不增（48ms → 91ms）

多窗口下并发写会更频繁，加重试是必要的安全网。

---

## 现状

**文件**：`src/storage/surreal/storage.ts`，第 529-559 行：

```typescript
async transaction<T>(fn: (tx: StorageTransaction) => Promise<T>): Promise<T> {
  // OCC 冲突 (Transaction conflict) 不在本 sub-phase 处理 (decision 020 §9.4)。
  const db = getDB();
  const surrealTx = await db.beginTransaction();
  try {
    const tx: StorageTransaction = { ... };
    const result = await fn(tx);
    await surrealTx.commit();
    return result;
  } catch (err) {
    try {
      await surrealTx.cancel();
    } catch (cancelErr) {
      console.error('[storage.transaction] cancel failed after fn error', cancelErr);
    }
    throw err;   // ← 直接 throw，无重试
  }
}
```

---

## 改动要求

### 在 `transaction()` 方法上包一层指数退避重试

```typescript
// 重试参数（常量，放方法外或类顶部）
const OCC_MAX_RETRIES = 5;
const OCC_BASE_DELAY_MS = 20;

async transaction<T>(fn: (tx: StorageTransaction) => Promise<T>): Promise<T> {
  let attempt = 0;
  while (true) {
    const db = getDB();
    const surrealTx = await db.beginTransaction();
    try {
      const tx: StorageTransaction = {
        getAtom: (id) => getAtomViaTx(surrealTx, id),
        putAtom: (input, options) => putAtomViaTx(surrealTx, input, options),
        batchPutAtoms: (inputs, options) => batchPutAtomsViaTx(surrealTx, inputs, options),
        deleteAtom: (id) => deleteAtomViaTx(surrealTx, id),
        getEdge: (id) => getEdgeViaTx(surrealTx, id),
        putEdge: (input, options) => putEdgeViaTx(surrealTx, input, options),
        batchPutEdges: (inputs, options) => batchPutEdgesViaTx(surrealTx, inputs, options),
        deleteEdge: (id) => deleteEdgeViaTx(surrealTx, id),
        bulkDeleteAtomsAndEdges: (ids) => bulkDeleteAtomsAndEdgesViaTx(surrealTx, ids),
      };
      const result = await fn(tx);
      await surrealTx.commit();
      return result;
    } catch (err) {
      // cancel 当前事务（不遮盖原错误）
      try {
        await surrealTx.cancel();
      } catch (cancelErr) {
        console.error('[storage.transaction] cancel failed after fn error', cancelErr);
      }

      // 判断是否 OCC 冲突且还有重试次数
      if (isOccConflict(err) && attempt < OCC_MAX_RETRIES) {
        const delay = OCC_BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(
          `[storage.transaction] OCC conflict, retry ${attempt + 1}/${OCC_MAX_RETRIES} in ${delay}ms`,
        );
        await sleep(delay);
        attempt++;
        continue;
      }

      throw err;
    }
  }
}
```

### 辅助函数（加在文件顶部 / 类外）

```typescript
/** 判断错误是否为 SurrealDB OCC 冲突（Transaction conflict: Resource busy）*/
function isOccConflict(err: unknown): boolean {
  if (err instanceof Error) {
    return err.message.includes('Transaction conflict') ||
           err.message.includes('Resource busy');
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

---

## 验收标准

```bash
# 1. 重试逻辑已加入（while loop 存在）
grep -n "OCC_MAX_RETRIES\|isOccConflict\|OCC conflict" src/storage/surreal/storage.ts
# 期望：≥3 行

# 2. 原注释已更新（删掉「不在本 sub-phase 处理」说明，或改成说明已处理）
grep -n "不在本 sub-phase 处理" src/storage/surreal/storage.ts
# 期望：0 行

# 3. tsc 编译通过
npx tsc --noEmit
```

---

## 注意事项

1. `fn` 是纯函数（无外部副作用），每次重试都传同一个 `fn`，可安全重放。
2. `OCC_MAX_RETRIES = 5` 和 `OCC_BASE_DELAY_MS = 20` 可根据实测调整，但不要设得过大（探针显示最大重试深度只有 1 次）。
3. **只改 `transaction()` 方法**，不改 `getAtom`、`putAtom` 等直接调用路径（它们不走事务，OCC 冲突在直接写路径上不会触发这里的重试，那是另一个问题）。
4. 删掉注释 `// OCC 冲突 (Transaction conflict) 不在本 sub-phase 处理 (decision 020 §9.4).`，改成简短说明（如 `// OCC 冲突：指数退避重试，最多 OCC_MAX_RETRIES 次。`）。
5. commit 消息末尾加：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
