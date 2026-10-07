# docs/handoff —— 交接文档

> **这里只放「现在还算数」的文档。** 过时的进 `_archive/`，不删除 —— 它们记着
> 为什么当初那么做，而那恰恰是重做时最容易丢的东西。

---

## 一、现在算数的（6 份）

### ⭐ 先看这两份

| 文档 | 什么时候看 |
|---|---|
| [`x-module-boundary-principle.md`](x-module-boundary-principle.md) | **动 X 重建前必看** —— 用户拍板的第一性约束：「删一个目录 + 删一行注册」就卸载干净。九条连线各配守卫写法 |
| [`web-base-completion-summary.md`](web-base-completion-summary.md) | **理解底座现状** —— 2026-09/10 底座补课的总结：做了什么、**刻意不做什么及判据**、五条教训、我犯的六个错 |

### X 重建的三份

| 文档 | 内容 |
|---|---|
| [`x-module-rebuild.md`](x-module-rebuild.md) | 重建分支的起点：为什么推倒（三个实测证据）、地基是什么、要定哪几条线 |
| [`x-module-base-choice.md`](x-module-base-choice.md) | ⭐ X 继承谁 —— 更正「两个平行底座」的错误说法：它是**一套 L0–L6 分层模型**，两段代码各占不同的层 |
| [`x-testid-removed-tweet-fetcher-broken.md`](x-testid-removed-tweet-fetcher-broken.md) | ⚠️ 未结：X 去掉 `data-testid` 致 tweet-block 抓不到数据（**改之前就坏**，与收口无关） |

### 底座的一份

| 文档 | 内容 |
|---|---|
| [`web-dom-ipc-surface-design.md`](web-dom-ipc-surface-design.md) | `renderer → web.dom` IPC 面：必要性（不做会留下的四个缺陷）、提供哪些能力、⭐ **刻意不开 `runDynamic` 的理由**、收口完成对账 |

---

## 二、`_archive/` 里是什么

### `_archive/x-before-rebuild/`（10 份）

**2026-09-29 推倒前的 X 代码时期**。已核实：这些文档引用的源码文件
（`src/platform/main/x/*.ts` 等）**现在一个都不存在**。

⚠️ 别照着它们实施 —— 但**排查同类问题时值得读**，里面是真机实测结论：
翻页 404 要用 POST、关键词精确率、长文正文只在详情页、
写入策略（`INSERT IGNORE` 那次最贵的教训）……

⭐ 其中 `flow-panel-design` / `flow-acceptance-checklist` 另有一层意义：
`src/platform/main/flow/` 代码**还在但零消费者** —— 它是「建好了没接线」的活样本。

### `_archive/web-base-completion/`（5 份）

**底座补课的过程文档**，已被 `web-base-completion-summary.md` 取代。
留着是因为过程里有结论性的东西：

- `verify-on-regression-nj.md` —— ⭐ **六轮独立复核的完整记录**。
  想知道「验证角色独立出去」为什么值得，读这份
- `web-layer-status-before-x.md` —— L0–L6 各层的实测状态（哪层是 7 行空壳）
- `module-verticalization-assessment.md` —— 「要不要把全仓搬成 `modules/`」的实测否决
- `l2-step2b-translate-resolved.md` —— ⭐ 一次完整的排查：
  四轮静态证据定不了因，真因是**日志打在了人看不到的进程**
- `web-base-completion-plan.md` —— 原始计划（对照看执行时改了什么、为什么）

---

## 三、⭐ 这里的规矩

1. **过时就归档，不删除** —— 文档的价值常在「为什么当初那么做」，
   删掉之后重做的人会把同样的坑再踩一遍
2. **归档前先核实它是不是真过时** —— 本次是 grep 它引用的源码文件还在不在
3. **一份文档只讲一件事**，并在开头写清「什么时候看」
4. ⚠️ **结论性的东西要进代码注释或 memory，不要只留在交接文档里** ——
   文档会被归档，注释会跟着代码走
