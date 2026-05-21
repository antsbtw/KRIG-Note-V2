# Stage 3 EM3 验收报告

> **日期**:2026-05-21
> **分支**:`feature/L7-block-atomization`
> **commits**:`15eab6e8` 3 predicate 字面登记 + L2 cardinality 检查
> **验收依据**:实施计划 §4.3 EM3 2 条
> **状态**:✅ PASS(静态检查通过,L2 健康检查启动期字面跑 — 用户启动 V2 可看 log)

---

## 静态检查(claude 自验,PASS)

### EM3.1 ✅ relations/spec.md §10 字面有 3 行

```bash
$ grep -n "user:krig:\(belongsToNote\|nextSibling\|childOf\)" docs/RefactorV2/data-model/relations/spec.md
404:| `user:krig:belongsToNote` | pm(block atom)| pm(note / reading-thought container atom)| 一对一(每 block 字面 1 条 outgoing)| L7 block atomization ✅ Stage 2 实施 | [decision 026 §6.3]... |
405:| `user:krig:nextSibling` | pm(block atom)| pm(block atom)| 0..1 outgoing + 0..1 incoming... |
406:| `user:krig:childOf` | pm(嵌套 block atom)| pm(最近非结构性祖先...)| 0..1 outgoing... |
```

**字面增 §10.2 节"block atomization 三条边语义"**:解释跨结构性容器跳层 + 拼装规则。

### EM3.2 ✅ cardinality 检查代码字面接入 runCardinalityCheck

字面 3 条新 cardinality 加入 `src/storage/health/cardinality-check.ts`:

| Predicate | cardinality | 实施路径 |
|---|---|---|
| `user:krig:belongsToNote` | 1:1 | `CARDINALITY_SCAN_PREDICATES` (扫+告警,不自愈) |
| `user:krig:childOf` | 0..1 | 同上 |
| `user:krig:nextSibling` | 0..1 outgoing + 0..1 incoming(双向) | 新 helper `scanNextSiblingCardinality`(既有 `scanCardinality` 不覆盖 incoming) |

### EM3.3 ✅ typecheck + lint(0 新增 warning)

```
$ npm run typecheck  → 全绿
$ npm run lint       → 3 个 main 起点遗留 warning(D-05),本 Stage 0 新增
```

---

## 字面策略(沿 decision 022 §4.3.1-L2)

**仅扫描 + 告警,不自愈**(对比 inCanvas / hasContent 字面 keep-latest 自愈):
- 字面理由:L7 数据完整性问题(如 nextSibling 双 incoming 链)若自动 cleanup 可能丢用户编辑;留管理员决断
- 字面违反 → `console.warn` `[storage/cardinality-check] CARDINALITY_VIOLATION_*`

**启动期字面跑**:`runCardinalityCheck` 字面在 `initStorage` 收尾调,每次启动 app 主进程终端字面看到:

```
[storage/cardinality-check] user:krig:belongsToNote (1:1): scanned N edges, found 0 multi-edge violations
[storage/cardinality-check] user:krig:childOf (0..1): scanned N edges, found 0 multi-edge violations
[storage/cardinality-check] user:krig:nextSibling: scanned N edges, outgoing violations=0, incoming violations=0
```

(N = 实际边数;Stage 2 EM2 通过后字面非 0)

---

## 手动验证(用户可选,EM3 字面已 PASS 不强制)

启动 V2 字面看主进程终端 `[storage/cardinality-check]` 行:
- belongsToNote / childOf / nextSibling 字面 0 violations = 数据健康
- 任一 > 0 violations = bug / 历史数据残留,字面**复制 log 给我**调查

---

## 后续步骤

✅ EM3 字面 PASS,推进 Stage 4(NoteLocator 升级 + thought view 适配)。

---

*EM3 verify · 2026-05-21*
