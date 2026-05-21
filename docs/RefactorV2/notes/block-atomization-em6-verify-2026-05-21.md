# Stage 6 EM6 验收报告 — 字面 N/A(用户拍板跳过)

> **日期**:2026-05-21
> **分支**:`feature/L7-block-atomization`
> **状态**:⏭ **N/A**(用户字面拍板跳过 Stage 6;字面登记 D-11 + D-13)

---

## 字面跳过理由(用户拍板 2026-05-21)

### 字面背景

Stage 6 决议字面拍板"一次性 migration script"(decision 026 §11.2 / 实施计划 §7):
- 字面把已有 V2 整篇 1 atom 数据字面拆为 block atom + 边集合
- 字面 thought NoteLocator 字面 pmPos → blockId 数据迁移
- 字面备份 round-trip 测试硬门槛

### 字面跳过依据

**D-11 字面用户拍板**(2026-05-21 Stage 2 起步,详 [block-atomization-deviations-2026-05-21.md#d-11](./block-atomization-deviations-2026-05-21.md#d-11)):

> "完全可以清空本地旧数据"

字面后果:
- 开发期 V2 字面**已清** SurrealDB(用户字面验证过,`rm -rf ~/Library/Application Support/KRIG Note V2/krig-data/surreal`)
- Stage 2 EM2.4 字面用户字面"清旧 dup-id note 重建" 验证通过
- 字面 V2 当前状态:**全是字面 Stage 2 之后**字面创建的 block atom 形态数据

**字面无 migration 消费者**:
- 开发期数据字面已是新格式(D-11)
- 字面没有"旧整篇 1 atom 形态"的 V2 数据需要 migrate

### 字面用户决策(2026-05-21)

字面 AskUserQuestion 三选一:
- ✅ **选 B:字面跳过(开发期已清数据,EM6 字面 marked N/A)**
- ❌ 选 A:字面实施完整版(带备份 round-trip)— 字面无消费者,字面工程冗余
- ❌ 选 C:字面仅写代码不验数据 — 字面"半成品"违反 [no-fallback-bandaid-fixes] 字面纪律

---

## D-13 字面登记(本 Stage 跳过)

字面**新增 D-13** 到偏离日志(下条 commit 字面追加):

> Stage 6 字面跳过 — 字面"一次性 migration script" 在 future 生产部署字面才需要,
> 字面留独立 sub-phase / future commit 字面兑现。当前开发期 V2 字面数据已是字面新形态,
> migration 字面无消费者。

字面影响:
- future 生产部署字面**必须**先实施 migration script 才能字面跑当前 L7 代码
- 字面 README / Release Note 字面需明示"生产部署字面需 migration"
- 字面登记 Stage 9 反向更新决议 026 §7.3 / §11 + 实施计划 §7

---

## 字面剩余 Stage(7/8/9)

字面 Stage 6 跳过 → 字面直接推进:

| Stage | 内容 | 备注 |
|---|---|---|
| **Stage 7** | 8 个典型场景手动测试(create/edit/split/merge/copy-paste/undo/callout/thought)| 字面用户验证模式,沿 EM2 / EM3 / EM4 / EM5 字面"留 Stage 7 兑现"汇总到此 |
| **Stage 8** | 性能压测(1000 block note read/write/cache)| 字面可选,字面 D-11 数据量字面无规模数据 → 字面可能字面 marked partial |
| **Stage 9** | 验收 + 文档反向更新 | 字面汇总 D-09/10/11/12/13 + Stage 1-8 反向更新决议字面 |

---

*EM6 verify(N/A) · 2026-05-21*
