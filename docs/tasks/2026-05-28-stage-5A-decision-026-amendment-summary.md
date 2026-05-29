# 阶段 5A：Decision 026 修订 + table 数据模型拍板汇总

> 阶段日期：2026-05-28 · main HEAD：2ac073bc
> 输入文档：[`2026-05-28-stage-5A-decision-026-amendment-prompt.md`](2026-05-28-stage-5A-decision-026-amendment-prompt.md) · [`2026-05-28-import-system-survey.md`](2026-05-28-import-system-survey.md) · [`decision 026`](../RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md) · [`PDF-Note-Atom契约 v2`](../10-business-design/ebook/PDF-Note-Atom数据契约-v2.md) · `src/drivers/text-editing-driver/blocks/table/spec.ts`
> 产出：决议 026 修订 + 本汇总文档；不改 src/、不 commit、不连 DB

---

## 1. 总指挥拍板的核心

| 拍板项 | 字面 | 字面理由 |
|---|---|---|
| **table 自身是 atom**（选项 A） | table 走 atom；`attrs.id = ULID` | 与生产 PDF-Note-Atom 契约 §4.7 顶层 `table` atom 一致；§6.1 跳层规则字面成立；未来支持"单独拖动整表 / 跨表引用 / 编辑表格属性"需要稳定锚点 |
| **tableRow 不是 atom** | 维持 STRUCTURAL；不生成 atom 节点 | row 没独立语义（用户从不单独引用一行）；row 信息可由 cell 自身承载 |
| **row 信息走 `cell.attrs.rowIndex` + `cell.attrs.colIndex`** | 0-based 整数；tableHeader 同款（rowIndex=0 字面对应表头行） | assemble 端按 rowIndex 分组重建 tableRow；用户标注"第 3 行第 5 列"直接命中 cell |
| **DB 老数据**（裸顶层 tableCell） | 本期不实施 migration | 用户已 `rm krig-data`；未来若再遇老数据走独立 sub-phase（详 §13.10） |

---

## 2. Decision 026 修订点逐条

> 修订纪律：保留原章节结构 / 编号 / 历史链路；只字面改写 + 加 "(2026-05-28 修订)" 追溯标注；§13 补登 2 条新编号。

### 2.1 §3.1.1 "table" 上移到叶子级容器清单（修订点 1 配套）

- **位置**：决议 026 行 137-145
- **旧字面**：§3.1.1 表格不含 `table`；§3.1.2 写 "table | 表格根容器 | 不拆"
- **新字面**：§3.1.1 新增一行 "**table** *(2026-05-28 修订：从 §3.1.2 上移)* | 叶子级容器（表格根）| 用户可单独引用整表..."；tableCell 行字面补 "rowIndex / colIndex 走 attrs"
- **理由**：与生产契约 §4.7 顶层 atom 一致 + §6.1 跳层规则字面成立

### 2.2 §3.1.2 "table 不拆" 字面撤销（修订点 1 主）

- **位置**：决议 026 行 147-163
- **旧字面**：表头列 6 项 = `table / tableRow / bulletList / orderedList / taskList / columnList`；首行 "table | 表格根容器 | 用户从不单独引用整表 | 不拆"
- **新字面**：节首加 "(2026-05-28 修订) — 原'table 不拆'字面已撤销 — table 上移到 §3.1.1"；表头列降为 5 项 = `tableRow / bulletList / orderedList / taskList / columnList`；tableRow 行字面补 "row 边界信息由 tableCell.attrs.rowIndex / colIndex 承载"；新增"修订附记"段：实施层 STRUCTURAL_CONTAINER_TYPES **必须降为 5 项**，仓库内**三处必须同步**（`assemble-pm-doc.ts:381` / `build-auto-block-id-plugin.ts:54` / `atoms-to-pm.ts:557`）
- **理由**：决策拍板 table 是 atom；三处同步契约为后续 5B 集中化预留语义底盘
- **附记**：注 1 关于 tableHeader 字面也改 — 从 "Stage 1 复 grep verify" 改为 "Stage 1 仅做 grep verify（已无歧义）"

### 2.3 §3.1.4 容量估算"不拆"措辞删除 + 补 row 信息表达（修订点 2）

- **位置**：决议 026 行 167-181
- **旧字面**：
  > 1 table atom（根容器，**不拆**）→ table.content = []
  > 0 tableRow atom（不拆）
  > 100×10 = 1000 tableCell atom
  > **合计：1001 atom + ~1000 childOf 边**
- **新字面**：节标题加 "(2026-05-28 修订：决策拍板 table 是 atom，'不拆'措辞已删)"；明示 "1 table atom（根容器，**拆为 atom**，attrs.id=ULID，PM JSON `content=[]`）" + tableCell 字面 `attrs.id=ULID + attrs.rowIndex 0-99 + attrs.colIndex 0-9`；合计行扩展为 "1001 atom + 1 belongsToNote(table→note) + 1000 childOf(cell→table) + 1000 belongsToNote(cell→note) + ~3000 nextSibling"
- **理由**：决策已字面拍板；保留事实"1 table atom"，去歧义"不拆"

### 2.4 §3.4 例 3 加注 + PM schema 一致性注（修订点 3）

- **位置**：决议 026 行 234-258
- **旧字面**：例 3 PM payload `{ type:'table', attrs:{id:'<ULID>'}, content:[] }` + 注释 "tableRow 通过 childOf 边关联"
- **新字面**：例 3 注释改为 "table / tableCell / cell 内 paragraph 都是独立 atom；tableRow 不是 atom"；加 "(2026-05-28 修订注：本例字面与 §3.1.4 容量估算 1 table atom 字面 1:1 一致 — 决策已拍板 table 是 atom)"；段末新增 "**(2026-05-28 修订注 — PM schema 一致性)**" 字面登记当前 `tableNodeSpec` 无 attrs，5B 需补 `attrs: { id: { default: null } }`
- **理由**：例 3 已暗示 table 有 atom + 有 id；5B 必须同步 schema

### 2.5 §6.1 跳层规则保留 + 新增 rowIndex/colIndex 表达（修订点 4）

- **位置**：决议 026 行 411-453
- **保留字面**：表内 "tableCell.childOf → table atom（跳过 tableRow）" + "tableHeader.childOf → table atom" — **本决议让此规则字面成立**（table 现在是 atom，childOf 有目标可指）；表内字面追加 "*(2026-05-28 修订：决策拍板 table 是 atom — 此规则字面成立，childOf 有目标可指)*"
- **新增段**：跳层规则表后新增 "(2026-05-28 新增 — tableRow 边界信息表达)"：
  - `tableCell.attrs.rowIndex`: number(0-based 整数)
  - `tableCell.attrs.colIndex`: number(0-based 整数)
  - `tableHeader.attrs.rowIndex / colIndex`: 同款字面（rowIndex=0 对应表头行）
  - **assemble 端拼装算法**（5 步）：拉 childOf 边 → 按 rowIndex 升序分组 → 组内按 colIndex 升序排序重建 tableRow → tableRow 按 rowIndex 升序 push 到 table atom 的 PM content → table atom 仍是 PM node + 参与顶层 nextSibling 链
  - **字面理由**：rowIndex/colIndex 是 cell 自带语义；assemble 不依赖 nextSibling 启发式；与生产契约对齐；此规则从 Open Question 升格为已拍板契约
- **理由**：tableRow 不是 atom 的必然推论 — row 信息必须由 cell 承载

### 2.6 §13 补登 2 条（修订点 5）

- **位置**：决议 026 行 909-952（§13.8 之后）

#### §13.9 tableCell 跨 row 拼装实施 — **已拍板，非 Open Question**

字面承接：调研报告 §6.9 字面指出 `assemble-pm-doc.ts:128` 代码自陈"字面登记到 decision 026 §13 待补充"但 §13 实际未登记。本节字面补登拍板结论 + 5B 实施位置清单（含 `table/spec.ts:76-85` 补 attrs / 3 处 STRUCTURAL 集合降 5 项 / wrapTableCells 算法改 / dissect 注入 rowIndex / atoms-to-pm 适配 tiptapContent 扁平化）。

#### §13.10 DB 历史数据 migration — **真正 Open Question，留独立 sub-phase**

字面承接：本 5A 不实施（用户 `rm krig-data`）；未来若再遇老数据走独立 sub-phase；migration 启发式策略：扫顶层裸 tableCell → 按 nextSibling 链推断 row 边界 → 新建 table atom + cell.attrs.rowIndex/colIndex + childOf 边 → 删原裸 belongsToNote → 日志保留原 nextSibling 链允许手工修正。

### 2.7 §3.1.2 修订附记 = 修订点 6（集合内容契约）

- **位置**：与 §3.1.2 同段（行 161-163）
- **字面契约**：5 项集合 `{tableRow, bulletList, orderedList, taskList, columnList}` **三处同步**（`assemble-pm-doc.ts` / `build-auto-block-id-plugin.ts` / `atoms-to-pm.ts`）；集中化怎么实施留 §13.8 + sub-phase 5B 决定；**集合内容字面一致是本决议硬契约**

---

## 3. 6 个必答题的最终答案

> 来源：调研报告 §7.2.1 / §7.2.2 / §7.2.3 / §7.6.1 / §7.6.2 / §7.6.3

### §7.2.1 — table 自身是否应该是 atom？

**答案：是 atom（选项 A）。**

代价接受：每张表多 1 atom + 1 belongsToNote 边 + N 条 tableCell.childOf → table 边；schema 必须给 table.attrs 加 `id: { default: null }` 字段（5B 实施在 `src/drivers/text-editing-driver/blocks/table/spec.ts:76-85` 补）。

收益：(a) 与生产 PDF-Note-Atom 契约 §4.7 一致 — 避免 V2 内部模型与生产契约对不上；(b) §6.1 跳层规则 `tableCell.childOf → table atom` 字面成立 — 否则 childOf 边无目标可指；(c) 未来"用户单独拖动整表 / 跨表引用 / 编辑表格属性"需要稳定锚点；(d) atoms→PM / md→atoms / PM→dissect 三套实现共用同一份契约。

### §7.2.2 — tableRow 是否需要重新评估？

**答案：tableRow 维持"不是 atom"。** 

理由：(a) 用户语义上从不单独引用一行；(b) row 信息可由 cell 自身的 `attrs.rowIndex / colIndex` 承载，比"row 也拆 atom"更节省（一张 100×10 表少 100 个 atom + 100 条 belongsToNote + 100 条 childOf）；(c) tableHeader 与 tableCell 同模式拆 atom（注 1 拍板，rowIndex=0 对应表头行 — §13.7 不再有歧义）。

代价：assemble 端必须按 rowIndex 分组重建 tableRow PM wrapper（算法见 §6.1 新增段）；dissect 端必须给 cell 注入 rowIndex/colIndex（由 cell 在 PM tree 内的位置推导）。

### §7.2.3 — 现有 DB 里已存在的"裸顶层 tableCell"数据如何处理？

**答案：本 sub-phase 不实施 migration（用户已 `rm krig-data`），但决议层登记"未来若再遇老数据走独立 migration sub-phase"。**

字面登记位置：§13.10（新增条目）。未来 migration 启发式策略：扫所有 belongsToNote 边的顶层 tableCell/tableHeader（无 childOf）→ 按 nextSibling 链推断 row 边界 → 新建 table atom + cell.attrs.rowIndex/colIndex + childOf 边 → 删原裸 belongsToNote → 日志保留原 nextSibling 链允许手工修正（启发式可能拼错 row 边界）。

依赖：本 5A 拍板字面落地 + 5B 实施完成。

### §7.6.1 — 决议 026 §3.1.2 / §3.1.4 / §6.1 的字面冲突应该如何先解决？

**答案：本 5A 修订已字面解决。**

解决方式（详 §2）：
- §3.1.2 撤回 "table 不拆" → table 上移到 §3.1.1 叶子级容器
- §3.1.4 删 "不拆" 措辞 → 改为 "1 table atom（根容器，**拆为 atom**）"
- §6.1 保留 "tableCell.childOf → table atom" 字面 → 加 "(决策拍板 table 是 atom — 此规则字面成立)" 修订注

修订后内部不再有"table 是不是 atom"的字面矛盾。

### §7.6.2 — §13 Open Questions 漏登的"tableCell 跨 row 拼装信息丢失"是否应该先补登？

**答案：已补登，且字面升格为已拍板规则。**

补登条目：§13.9 "tableCell 跨 row 拼装实施"。字面状态：**不再是 Open Question，是已拍板契约**。

承接 `assemble-pm-doc.ts:128` 代码自陈的"字面登记到 decision 026 §13 待补充"。后续维护者可从决议表上直接读到拍板结论 + 5B 实施位置清单。

### §7.6.3 — §3.1.4 容量估算"1 table atom"是否需要修正为符合实际实施"0 table atom"？

**答案：反向修正 — 把实际实施改为符合决议"1 table atom"，而不是把决议改为"0 table atom"。**

理由：(a) §6.1 跳层规则、§3.4 例 3、§3.1.4 容量估算都字面要求 table 是 atom；只有 §3.1.2 字面写"不拆"，且这是矛盾的少数派；(b) 生产契约 §4.7 顶层 atom 字面要求；(c) 节 5 bug（重启后 tableCell 顶层渲染塌陷）的设计层根因就是"实施按少数派字面落地"。

修订动作：§3.1.4 字面 "1 table atom" 保留并加强（标 "拆为 atom"）；5B 实施补齐 schema + STRUCTURAL 集合 + dissect/assemble 算法。

---

## 4. tableCell.attrs schema 增量

| 字段 | 状态 | 类型 | 默认 | 字面说明 |
|---|---|---|---|---|
| `id` | **现有**（spec.ts:126） | string \| null | null | block atom 稳定 ULID（decision 026 §3.1.1 / §4） |
| `colspan` | 现有 | number | 1 | PM table 原生 |
| `rowspan` | 现有 | number | 1 | PM table 原生 |
| `colwidth` | 现有 | number[] \| null | null | prosemirror-tables columnResizing 写入 |
| `align` | 现有 | 'left'\|'center'\|'right'\|'justify'\|null | null | 单元格水平对齐 |
| `bookAnchor` | 现有 | string \| null | null | ebook 标注定位（sub-phase 022） |
| **`rowIndex`** | **新增（5B 实施）** | number | 0 | **0-based**；cell 所属 row 在 table 内的位置 |
| **`colIndex`** | **新增（5B 实施）** | number | 0 | **0-based**；cell 所属 col 在 row 内的位置 |

**tableHeader** 同款：现有 `id / colspan / rowspan / colwidth / align`（spec.ts:165-172）+ 新增 `rowIndex / colIndex`（rowIndex=0 字面对应表头行）。

**table NodeSpec**（spec.ts:76-85 当前**完全无 attrs**）：5B 实施时补 `attrs: { id: { default: null } }`，与 tableCell / tableHeader 同模式（详决议 §3.4 修订注）。

---

## 5. assemble 端 wrapTableCells 算法

### 5.1 伪代码（5B 才实施真 TypeScript）

```
function wrapTableCells(tableAtomNode, childCellsAtoms):
  # 1. 按 rowIndex 升序分组
  rowMap = new Map<number, AtomNode[]>
  for cell in childCellsAtoms:
    rowIdx = cell.attrs.rowIndex ?? 0    # 默认 0 兜底（防 v1 老数据无字段）
    rowMap.get(rowIdx).push(cell)

  # 2. 各 row 组内按 colIndex 升序排序
  for [rowIdx, cells] in rowMap:
    cells.sort((a, b) => a.attrs.colIndex - b.attrs.colIndex)

  # 3. 按 rowIndex 升序遍历组，重建 tableRow PM node
  sortedRowIdxs = [...rowMap.keys()].sort((a, b) => a - b)
  tableRowNodes = []
  for rowIdx in sortedRowIdxs:
    cells = rowMap.get(rowIdx)
    tableRowNodes.push({ type: 'tableRow', content: cells })

  # 4. 把 tableRow 数组写回 table atom 的 PM content
  tableAtomNode.content = tableRowNodes
  return tableAtomNode
```

### 5.2 边界场景字面登记

- **rowIndex 字段缺失**（v1 老数据 / 字面未注入）→ fallback 走 ` ?? 0`；所有 cells 字面塞到单 row（等同当前 v1 实施行为，至少不丢内容）
- **rowIndex 重复**（同 rowIndex 多 cells，colIndex 也撞）→ 按 atom.id ULID 字典序兜底排序（保稳定性）
- **rowIndex 不连续**（如 0/2/5 跳号）→ 字面按 sortedRowIdxs 顺序重建，跳号字面被压平（PM schema 允许 tableRow 直接连续，rowIndex 仅作排序键）
- **colIndex 不连续**（如 0/3/7 跳号）→ 字面按 colIndex 顺序重建，但 PM 不补空 cell（因 tableRow content='(tableCell|tableHeader)+'，跳号会导致用户视觉上某些列缺失 — 启发式 fallback：补空 paragraph cell 占位，留 5B 决定）

### 5.3 dissect 端反向算法（注入 rowIndex）

PM tree 走到 tableRow 时：
1. 记录该 tableRow 在 table 内的位置 `pmRowIdx`
2. 遍历该 tableRow 的 cells，记录每 cell 在 tableRow 内的位置 `pmColIdx`
3. 字面注入 `cell.attrs.rowIndex = pmRowIdx`，`cell.attrs.colIndex = pmColIdx`
4. 注入 tr 字面 `addToHistory: false`（沿 [`feedback_pm_internal_attr_write_must_mark_no_history`](../../.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/feedback_pm_internal_attr_write_must_mark_no_history.md)）

字面位置：留 5B 在 `src/platform/main/note/dissect-pm-doc.ts` 处理 tableRow 路径时实施。

---

## 6. 给 5B / 5C 阶段的输入清单

### 6.1 5B（决议落地实施）必改文件清单

| 文件 | 改动 | 字面理由 |
|---|---|---|
| `src/drivers/text-editing-driver/blocks/table/spec.ts:76-85` | tableNodeSpec 加 `attrs: { id: { default: null } }` | §3.4 例 3 字面要求 `attrs.id`；当前无 attrs |
| `src/drivers/text-editing-driver/blocks/table/spec.ts:122-137` | tableCellSpec.attrs 加 `rowIndex: { default: 0 }, colIndex: { default: 0 }` | §6.1 新增段拍板 |
| `src/drivers/text-editing-driver/blocks/table/spec.ts:165-172` | tableHeaderSpec.attrs 同款加 rowIndex / colIndex | §3.1.2 注 1 拍板 |
| `src/platform/main/note/assemble-pm-doc.ts:381` | STRUCTURAL_CONTAINER_TYPES 删 `'table'`（6 项 → 5 项） | §3.1.2 修订附记 |
| `src/drivers/text-editing-driver/plugins/build-auto-block-id-plugin.ts:54` | STRUCTURAL_CONTAINER_TYPES 删 `'table'`（同步） | §3.1.2 三处同步契约 |
| `src/capabilities/text-editing/converters/atoms-to-pm.ts:557` | STRUCTURAL_CONTAINER_TYPES 删 `'table'`（同步） | §3.1.2 三处同步契约 |
| `src/platform/main/note/assemble-pm-doc.ts` wrapTableCells | 按 rowIndex 分组算法（详 §5.1 伪代码） | §6.1 新增段算法 |
| `src/platform/main/note/dissect-pm-doc.ts` tableRow 路径 | 注入 cell.attrs.rowIndex / colIndex | §5.3 反向算法 |
| `src/capabilities/text-editing/converters/atoms-to-pm.ts` table case | 适配契约 `table.content.tiptapContent` → 扁平 cell + rowIndex 注入 | 与生产契约对齐 |

### 6.2 5C paste id 共享 bug 与本拍板的关系

**独立 — 不依赖本拍板，但共享"capability 层 inject 与 PM plugin 双轨"根因（调研报告 §6.4 / §6.7）。**

- 本 5A 拍板**只解 table 数据模型矛盾**，不动 inject/plugin 双轨
- paste id 共享 bug（pasteNote 走 capability 不过 PM plugin → 源 doc id 字面被新 note 继承 → cross-note id 共享 → 违反决议 §5.2）由独立 sub-phase 5C 处理
- **共依赖点**：5C 实施时若要"inject 层统一规则集合"，必须读本 5A 修订后的 STRUCTURAL 集合 5 项字面（三处同步契约）；本 5A 字面给 5C 提供了集合内容定义

### 6.3 5B 测试场景清单（5A 修订后必跑）

| 场景 | 期望行为 |
|---|---|
| 1. 新建 note → 插入 GFM markdown 表格 (3 行 3 列) → 保存 → 重启 → 打开 | 表格完整还原，3 行 3 列 cells 顺序正确 |
| 2. 编辑 cell 内容（B2 改字） → 保存 → 重启 → 打开 | 内容保留，rowIndex/colIndex 字面不变 |
| 3. 表格内删除一行 → 保存 → 重启 | 该行 cells 字面消失，下方行 rowIndex 字面前移 |
| 4. 表格内插入新行（位置 2，原有 4 行） → 保存 → 重启 | 新行字面 rowIndex=2，原 row 2/3 字面 rowIndex 后移到 3/4 |
| 5. 拖动整张表（未来 feature） | table atom 单元拖动；cells 字面跟随 |
| 6. import KRIG_IMPORT JSON（含 table.tiptapContent） → atoms-to-pm → createNote → dissect | 字面落地 1 table atom + N cell atoms + childOf 边 + rowIndex/colIndex |
| 7. import markdown（含 GFM 表格） → md-to-pm → createNote → dissect | 同上 |

---

## 7. 留给后续 sub-phase 的 open question

### 7.1 老 DB 数据 migration（不在本期 — §13.10 新增）

详决议 §13.10。本期不实施；未来若再遇老数据走独立 migration sub-phase。

### 7.2 STRUCTURAL_CONTAINER_TYPES 三处集中化（5B 子任务 — §13.8 既有）

- 5A 拍板"集合内容字面一致"作为硬契约（§3.1.2 修订附记）
- "怎么集中"留 §13.8 + sub-phase 5B 决定（可选方案：semantic 层 @semantic/types 共享；ts 编译期 invariant；或保持 import 单点）

### 7.3 修订过程中新发现的 open question

#### Q1：契约 §4.7 `table.content.tiptapContent` 与 V2 内部模型的适配层归属

调研发现：生产 PDF-Note-Atom 契约 §4.7 字面 `table.content.tiptapContent = [tableRow, ...]`（嵌套子树形态），与 V2 内部 "table 拆 atom + cell.attrs.rowIndex" 扁平形态**不字面一致**。适配层（atoms-to-pm 的 table case）需要：
- 解构 tiptapContent 子树 → 提取 tableRow / cell 的位置 → 字面注入 cell.attrs.rowIndex/colIndex → 输出扁平 PMNode[]
- 反向（PM → atom 写回契约形态用于跨设备同步 / 外部交换 — 若未来需要）需要 wrapTableCells 算法逆向写 tiptapContent

**留 5B 实施时拍板**：atoms-to-pm 的 table case 算法签名 + 是否需要反向 pm-to-tiptap 桥。

#### Q2：tableCell.attrs.rowIndex 在 PM editor 内的实时维护

用户在 PM editor 内动态编辑表格（删除/插入行）时，PM tree 结构变化，cell.attrs.rowIndex 是否需要 plugin 实时同步？

- 选项 A：plugin appendTransaction 拦截每次 tr，扫表格内 cell 字面重写 rowIndex/colIndex（与 buildAutoBlockIdPlugin 同模式）
- 选项 B：rowIndex 仅在 dissect 期注入（PM tree 内字面不维护，等下次保存才同步） — 编辑期间 rowIndex 字面陈旧但 PM tree 仍正确，下次 dissect 写回 storage 时刷新
- 选项 C：rowIndex 仅在用户编辑表格结构（添加/删除行 / 移动行）时由 PM tables plugin command 字面同步

**留 5B 实施时拍板**：选项偏好（推荐 B — 与 V2 "dissect 是写回边界" 哲学一致；plugin 不污染编辑期 attr 写入）。

#### Q3：table NodeSpec 加 attrs.id 后对 prosemirror-tables 第三方 plugin 的影响

prosemirror-tables `tableEditing()` / `columnResizing()` 字面假设 table NodeSpec 的 attrs 形态（colwidth 等字面要求）。本 5A 拍板加 `attrs.id` 是否会触发 prosemirror-tables 内部 attr-equality 判断异常（如 isolating 计算 / 行列拷贝时不复制 id）？

**留 5B 实施时验证**：5B Stage 1 加完 attrs.id 后，跑 testing scenario 6（行删除 / 列插入 / 表格内拷贝）；若第三方 plugin 行为异常，字面登记新 open question。

#### Q4：tableHeader 单独的 rowIndex 字面规则

§3.1.1 表格字面拍板 "tableHeader 与 tableCell 同模式"，rowIndex=0 字面对应表头行。但**若用户表格有多行表头**（PM schema 允许 `tableRow > (tableCell|tableHeader)+`，理论上可以多 tableRow 全是 tableHeader）？

- 选项 A：所有 tableHeader 字面 rowIndex 走 0/1/2/...（与 tableCell 同空间）
- 选项 B：tableHeader 字面单独 namespace（rowIndex 在 header 内独立计数）

**留 5B 实施时拍板**：推荐选项 A（简化模型；多行表头是边缘场景）。

---

*Stage 5A · 2026-05-28 · Decision 026 修订（行 137-258 + 411-453 + 909-952）+ 本汇总文档 · 不改 src/ · 不 commit · 不连 DB*
