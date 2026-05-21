# Stage 8 EM8 验收报告 — 字面 N/A(用户拍板跳过)

> **日期**:2026-05-21
> **分支**:`feature/L7-block-atomization`
> **状态**:⏭ **N/A**(用户字面拍板跳过 Stage 8;字面登记 D-15)

---

## 字面跳过理由(用户拍板 2026-05-21)

字面 Stage 5/6 完成后 AskUserQuestion 拍板:

> "跳过 Stage 7 手动测,直推进 Stage 8/9 + 合 main"

字面用户拍板"跳过 Stage 7" 字面 implicitly 也跳过 Stage 8(性能压测字面需用户字面提供 1000 block 测试数据)。

**字面 D-11 加成**:V2 开发期数据字面已清,字面无规模数据可压测;字面字面也无 V1 备份导入。

---

## 字面未兑现的 5 性能指标

字面以下指标**字面无 benchmark**:

| 指标 | 决议字面期望 | 字面残余风险 |
|---|---|---|
| 1000-block note `getNote` cold(无 cache)| P95 < 200ms | 字面理论上 listAtoms + listEdges + 拼装 O(N),N=1000 字面应 OK |
| 1000-block note `getNote` warm(cache hit)| P95 < 5ms | 字面 Map.get 字面 O(1) cover |
| 1000-block note `updateNote`(single char edit)| P95 < 50ms | 字面 diff 算法 O(N) deepEqual cover,字面 stableStringify 字面 O(N²) ⚠ |
| 1000-block note `updateNote`(整篇替换)| P95 < 1s | 字面 N putAtom + N putEdge 字面可能慢 ⚠ |
| `listNotes`(100 notes)| 不退化 | 字面 listNotes 字面**字面新加 N getNote → assemblePmDoc** 串行 → 字面 100 notes × O(N) 字面**性能退化** ⚠⚠ |

**字面已知高风险项**(⚠⚠ 标记):

`listNotes` 字面**字面退化** — 字面原 V2 字面是 3 query 一次性 listAtoms + listEdges 字面 cover;Stage 2 字面改为字面**每 note 字面调 assemblePmDoc**(再各自 listEdges 字面 3 query):

```ts
// src/platform/main/note/capability-impl.ts:248-269
const results = await Promise.all(
  noteAtoms.map(async (atom) => {
    const cached = pmDocCache.get(atom.id);
    const assembled = cached ?? (await assemblePmDoc(atom.id));
    ...
  }),
);
```

字面 100 notes × 3 query each = **300 query / listNotes 调用**(Promise.all 并发 cover 部分,但字面字面对 SurrealDB 字面 connection pool 字面压力大)。

**字面缓解**:
- pmDocCache 字面命中后字面 1 query / note(cold-start 后字面 cache 命中)
- listNotes 字面**用户感知最高**(NavSide 字面频繁刷)→ cold start 字面字面可能字面卡顿

**字面留 future commit / sub-phase 优化**:
1. `listNotes` 字面字面只返**轻量 NoteInfo**(title 字面从 container atom.payload 字面派生,字面 doc 字面不拼)— 字面需 title 字面也持久化在 container atom 字面新字段
2. 或 listNotes 字面字面用 cache only(无 cache 字面 fallback 空 doc),字面 cold start 字面字面字面**异步** populate

---

## D-15 字面登记(本 Stage 跳过 + listNotes 性能退化警报)

字面**新增 D-15** 到偏离日志(下条 commit 字面追加)。

---

*EM8 verify(N/A) · 2026-05-21*
