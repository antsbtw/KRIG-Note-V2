# Stage 8 EM8 验收报告 — N/A(用户拍板跳过)

> **日期**:2026-05-21
> **分支**:`feature/L7-block-atomization`
> **状态**:⏭ **N/A**(用户拍板跳过 Stage 8;登记 D-15)

---

## 跳过理由(用户拍板 2026-05-21)

Stage 5/6 完成后 AskUserQuestion 拍板:

> "跳过 Stage 7 手动测,直推进 Stage 8/9 + 合 main"

用户拍板"跳过 Stage 7" implicitly 也跳过 Stage 8(性能压测需用户提供 1000 block 测试数据)。

**D-11 加成**:V2 开发期数据已清,无规模数据可压测;也无 V1 备份导入。

---

## 未兑现的 5 性能指标

以下指标**无 benchmark**:

| 指标 | 决议期望 | 残余风险 |
|---|---|---|
| 1000-block note `getNote` cold(无 cache)| P95 < 200ms | 理论上 listAtoms + listEdges + 拼装 O(N),N=1000 应 OK |
| 1000-block note `getNote` warm(cache hit)| P95 < 5ms | Map.get O(1) cover |
| 1000-block note `updateNote`(single char edit)| P95 < 50ms | diff 算法 O(N) deepEqual cover,stableStringify O(N²) ⚠ |
| 1000-block note `updateNote`(整篇替换)| P95 < 1s | N putAtom + N putEdge 可能慢 ⚠ |
| `listNotes`(100 notes)| 不退化 | listNotes **新加 N getNote → assemblePmDoc** 串行 → 100 notes × O(N) **性能退化** ⚠⚠ |

**已知高风险项**(⚠⚠ 标记):

`listNotes` **退化** — 原 V2 是 3 query 一次性 listAtoms + listEdges cover;Stage 2 改为**每 note 调 assemblePmDoc**(再各自 listEdges 3 query):

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

100 notes × 3 query each = **300 query / listNotes 调用**(Promise.all 并发 cover 部分,但对 SurrealDB connection pool 压力大)。

**缓解**:
- pmDocCache 命中后 1 query / note(cold-start 后 cache 命中)
- listNotes **用户感知最高**(NavSide 频繁刷)→ cold start 可能卡顿

**留 future commit / sub-phase 优化**:
1. `listNotes` 只返**轻量 NoteInfo**(title 从 container atom.payload 派生,doc 不拼)— 需 title 也持久化在 container atom 新字段
2. 或 listNotes 用 cache only(无 cache fallback 空 doc),cold start **异步** populate

---

## D-15 登记(本 Stage 跳过 + listNotes 性能退化警报)

**新增 D-15** 到偏离日志(下条 commit 追加)。

---

*EM8 verify(N/A) · 2026-05-21*
