# Table Block 测试清单(L5-B3.7 / L5-B3.7.1,对标 Notion)

> **实施阶段**:
> - L5-B3.7(M1,B+ 路径)— 完成报告 [stages/L5B3.7-table-blocks-completion.md](../stages/L5B3.7-table-blocks-completion.md)
> - L5-B3.7.1(M2,Notion-style hover handle 菜单)— 完成报告 [stages/L5B3.7.1-table-row-col-handles-completion.md](../stages/L5B3.7.1-table-row-col-handles-completion.md)
>
> **本文档定位**:V2 当前 table 能力 vs Notion table 全集的对标清单 + 可执行验证步骤
> **撰写日期**:2026-05-16(初稿)/ 2026-05-16(M2 补 §J)
>
> 状态标记:✅ 已实现 / ❌ 未实现(待 sub-stage) / ⚠️ 部分实现 / ⏳ 已实现待测 / 🚫 KRIG 范围外
>
> 测试约定:每条做完把 ⏳ 改 ✅ / ❌(附现象)。**B+ 阶段砍掉的 V1 UX 用 ❌ 标记 + 注明留哪个 sub-stage**,不算回归。

---

## 0. V2 当前能力总览

| 维度 | V2 实现 | 来源 |
|---|---|---|
| schema | table / tableRow / tableHeader / tableCell 4 节点 | [spec.ts:74-190](../../../src/drivers/text-editing-driver/blocks/table/spec.ts#L74-L190) |
| cell attrs | colspan / rowspan / colwidth / align / bookAnchor | [spec.ts:122-149](../../../src/drivers/text-editing-driver/blocks/table/spec.ts#L122-L149) |
| 插件 | tableEditing + columnResizing + tableKeymapPlugin | [spec.ts:96](../../../src/drivers/text-editing-driver/blocks/table/spec.ts#L96) |
| 业务命令 | insertTable / duplicateRow / duplicateColumn / duplicateSelectedCells / setCellAlign | [commands.ts](../../../src/drivers/text-editing-driver/blocks/table/commands.ts) |
| 库 re-export | addColumn{Before,After} / deleteColumn / addRow{Before,After} / deleteRow / mergeCells / splitCell / deleteTable / goToNextCell | [index.ts:25-36](../../../src/drivers/text-editing-driver/blocks/table/index.ts#L25-L36) |
| NodeView UX | 列 / 行 hover handle bar + CellSelection ⋯ handle + scroll wrapper + colgroup(M2)| [node-view.ts](../../../src/drivers/text-editing-driver/blocks/table/node-view.ts) |
| 菜单 popup | TableMenuPanel(列 / 行 / cellSelection 三态,挂 `text-editing.popup.table-menu`)| [TableMenuPanel.tsx](../../../src/drivers/text-editing-driver/blocks/table/TableMenuPanel.tsx) |
| 入口 | slash `/table`(`table` / `grid` / `表格`)→ insert 3×3 第一行 header | [slash-menu-content.ts:58](../../../src/views/note/slash-menu-content.ts#L58) |
| **未接 UI** | 无 — 所有命令(addColumn{Before,After} / deleteColumn / addRow{Before,After} / deleteRow / deleteTable / mergeCells / splitCell / setCellAlign / duplicateRow / duplicateColumn / duplicateSelectedCells)全部接到 hover handle 菜单(M2)| 见 §J |

---

## A. 基础结构(完成判据 2-3)

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| A1 | npm start → 打开已有笔记 | 不破坏既有内容(NoteEditor 加载 OK) | ⏳ |
| A2 | 行首输 `/table` Enter | 当前 block 替换为 **3×3 表格**,**第一行加粗/底色为 header**,光标落在 header 第一个 cell | ⏳ |
| A3 | 输 `/grid` / `/表格` Enter | 同 A2(slash keywords) | ⏳ |
| A4 | F12 看 DOM | `<div.krig-table-block><div.krig-table-block__scroll><table.krig-pm-table><colgroup><tbody><tr><th>...</tr><tr><td>...</tr></tbody></table>` | ⏳ |
| A5 | 切到别的笔记 → 切回 | table 完整加载,内容/列宽不丢(走 atom→PM 持久化) | ⏳ |
| A6 | Cmd+Q 退出 Electron → npm start 重启 → 打开同一笔记 | table 仍在 | ⏳ |

---

## B. 编辑 + Tab 导航(完成判据 4)

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| B1 | 第一个 cell 输文字 | 文字进 cell,光标在 cell 内 | ⏳ |
| B2 | 按 **Tab** | 光标跳到下一 cell(同行右侧) | ⏳ |
| B3 | 末 cell(右下角)按 **Tab** | **自动加新行**,光标进新行第一 cell([keymap.ts:26-29](../../../src/drivers/text-editing-driver/blocks/table/keymap.ts#L26-L29)) | ⏳ |
| B4 | 按 **Shift-Tab** | 上一 cell | ⏳ |
| B5 | cell 内输 `## 标题` | cell 内变 H2(`content:'block+'` 允许任意 block) | ⏳ |
| B6 | cell 内输 `- ` 触发 bullet list | bullet 在 cell 内正常工作 | ⏳ |
| B7 | cell 内 Cmd+B / Cmd+I / Cmd+U | mark 生效 | ⏳ |
| B8 | cell 内选择文字 → 用 floating-toolbar 上色 / 加 link | 应该都工作(共用 mark / link 系统) | ⏳ |
| B9 | cell 内嵌套 callout / toggle / image | block 都能嵌入(content='block+') | ⏳ |
| B10 | 方向键 ↑↓←→ 在 cell 间移动 | 正常移动,边界处跨 cell | ⏳ |

---

## C. ~~+col / +row 按钮~~ → M2 移除,改 hover handle(见 §J)

> M1 的 +col / +row 末尾插入按钮在 M2 移除;增删行 / 列统一走列顶 / 行左 hover handle(§J)。
> "末尾加一列 / 一行"现走 hover handle → 选末列 → "在右侧插入列"(或末行 → "在下方插入行"),多一步但能力更全。
>
> §C 单段保留作历史记录,**测试已废**;C5 的"横向滚动"测试迁到 §J.5。

---

## D. 列宽 resize(完成判据 6,**关键**)

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| D1 | 鼠标移到第 1/2 列之间 cell 边界 | 鼠标变 ↔ 双向箭头(prosemirror-tables columnResizing) | ⏳ |
| D2 | 拖动列边界向右 | 列宽实时变,松开后 colwidth 写入 cell.attrs | ⏳ |
| D3 | 拖动后 F12 看 td 标签 | 有 `data-colwidth="200"` + `style="width:200px"` | ⏳ |
| D4 | 切别的笔记 → 切回 | **列宽保留** | ⏳ |
| D5 | 重启 Electron → 打开同一笔记 | **列宽仍保留**(写入 atom 持久化) | ⏳ |
| D6 | 同列多个 cell | 拖任意一个,**整列宽度统一**(同步到该列所有 cell) | ⏳ |

---

## E. 删除整张 table(完成判据 7)

> **难点**:`isolating: true` 让 PM 默认无法跨表外选区,需要"先选到 table 外"才能整体删。这条判据 V1 实际就是个 corner case,Notion 也没"选整张表删"的直觉操作 → 实际使用都靠菜单"Delete table"。

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| E1 | table 上方空段 + Shift+Click table 下方空段 | 选区包住整张 table | ⏳ |
| E2 | E1 状态下按 Delete | **整张 table 一次性删除** | ⏳ |
| E3 | 光标在 cell 内 → 控台跑 `editorView.dispatch(deleteTable(editorView.state, editorView.dispatch))` | 整张 table 删除(命令已 export,UI 未接) | ⏳ |

---

## F. md-to-pm markdown 粘贴(完成判据 8,**反向驱动证明**)

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| F1 | 浏览器复制 markdown:`\| a \| b \|\n\|---\|---\|\n\| 1 \| 2 \|` 粘贴 | 解析成 2×2 table(从 unknown 占位升级) | ⏳ |
| F2 | 复制 markdown 3 列 5 行表格 | 完整解析 + 渲染 | ⏳ |
| F3 | 复制 HTML `<table>...</table>` | parseDOM 接收(spec.ts parseDOM tag:'table') | ⏳ |

---

## G. M2 实施进度 / 不接的 UI 入口

### G.1 列/行 hover 指示器 + 菜单 ✅(M2 实施)

| # | V1 / Notion 行为 | V2 状态 |
|---|---|---|
| G1.1 | hover table 顶部出"列指示器条" | ✅ M2 `.krig-table-block__col-bar` + per-cell dot |
| G1.2 | hover table 左侧出"行指示器条" | ✅ M2 `.krig-table-block__row-bar` + per-row dot |
| G1.3 | 点列 dot → 弹列菜单(Add before/after / Duplicate / Delete / Align) | ✅ M2 TableMenuPanel(scope='column')|
| G1.4 | 点行 dot → 弹行菜单(Add before/after / Duplicate / Delete) | ✅ M2 TableMenuPanel(scope='row')|

### G.2 CellSelection 操作入口 ✅(M2 实施,但走 cell 上方 ⋯ handle 而非 floating-toolbar registry)

> 注:M2 不接 V2 floating-toolbar registry — node-view 内部维护一个 ⋯ handle DOM,
> 仅在本 table CellSelection 时显示。M3 视需要再迁到 floating-toolbar registry。

| # | V1 / Notion 行为 | V2 状态 |
|---|---|---|
| G2.1 | 拖选多 cell(CellSelection)弹操作入口 | ✅ M2 选区上方浮 ⋯ 按钮 |
| G2.2 | merge cells | ✅ M2 ⋯ 菜单 → "合并单元格" |
| G2.3 | split cell | ✅ M2 ⋯ 菜单 → "拆分单元格" |
| G2.4 | 对齐(left/center/right)| ✅ M2 ⋯ 菜单 → "对齐 ▸ 左/中/右"(整选区作用)|
| G2.5 | 复制选区为新行 | ✅ M2 ⋯ 菜单 → "复制选区为新行" |

### G.3 右键菜单接 table 🚫(不做,M2 选定 handle-only 入口)

> M2 决策:cell 内右键保留 V2 通用 context-menu(Cut/Copy/Paste/SelectAll/...)
> table 专属操作全走 hover handle,**右键不重复接入**。理由:发现性更强、跟 Notion 一致、
> 不污染 context-menu registry。如未来用户反馈"右键也想能用"再加,命令池已就绪。

| # | 操作 | V2 状态 |
|---|---|---|
| G3.1 | cell 内右键 → context-menu 显示 table 专项 | 🚫 不接(M2 决策)— 通用菜单照常显示 |
| G3.2 | 同上但显示 align 选项 | 🚫 不接 |

### G.4 handle 菜单接 table

| # | 操作 | V2 状态 |
|---|---|---|
| G4.1 | block ⋮⋮ handle → table 整体上下挪 | ⏳ 待测——handle 可能识别 table 为 block,但 cascadeBoundary 影响下未测过 |
| G4.2 | block ⋮⋮ handle → Turn into | ❌ table 不在 Turn Into 列表(也不该在,table 不能 round-trip 回 paragraph) |

---

## H. Notion 对标 — KRIG 范围内 / 范围外

### H.1 Notion 有 V2 未做(可补) ⚠️

| # | Notion 能力 | V2 状态 | 优先级建议 |
|---|---|---|---|
| H1.1 | 拖列头横向重排列 | ❌ | 中(L5-B3.7.1 之后) |
| H1.2 | 拖行头纵向重排行 | ❌ | 中 |
| H1.3 | 列宽**双击**自适应内容宽度 | ❌ | 低 |
| H1.4 | row hover 时左侧出 ⋮⋮ 行 handle | ✅ M2 行 dot(`.krig-table-block__row-dot`)|
| H1.5 | col hover 时顶部出 ⋮⋮ 列 handle | ✅ M2 列 dot(`.krig-table-block__col-dot`)|
| H1.6 | header 切换:任意行/列可切换是否 header | ⚠️ schema 支持(td/th),无 UI | L5-B3.7.1 |
| H1.7 | cell 背景色(类似 highlight 但作用在 cell) | ❌ 无 cell.attrs.background | 低 |
| H1.8 | 行/列内容**类型约束**(Notion database 才有,普通 table 无) | 🚫 范围外 | — |
| H1.9 | 表格"标题"(table caption / title) | ❌ | 低 |
| H1.10 | 表格切到 database/board/calendar view | 🚫 KRIG 是 KR Graph 不是 DB | 范围外 |

### H.2 Notion 没做但 V2 已有 ✨

| # | V2 能力 | Notion 对应 |
|---|---|---|
| H2.1 | cell 内嵌任意 block(callout / toggle / image / nested table) | Notion table cell 只允许 inline 文字,**V2 更强** |
| H2.2 | cell 内 marks(color / highlight / link / code) | Notion 部分支持 |
| H2.3 | colwidth 持久化到 atom 层 | Notion 走 DB 字段,V2 走 PM doc — 等价 |

### H.3 KRIG 不做(明确范围外) 🚫

| # | 项 | 原因 |
|---|---|---|
| H3.1 | Database 字段类型(text/number/date/select/...) | KRIG 是 KR Graph,关系数据走 graph view 不走 table |
| H3.2 | Formula 字段 | 同上 |
| H3.3 | Filter / Sort / Group | 同上,table 是富文本嵌入不是数据视图 |
| H3.4 | Linked database / Relation | KRIG 用 note-link + graph 表达 |

---

## I. 不回归

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| I1 | typecheck + lint | 全过 | ⏳ |
| I2 | 加 table 后做 undo/redo | history 正常(insert/delete/row/col 各操作可逆) | ⏳ |
| I3 | 多个 table 同文档 | 互不干扰 | ⏳ |
| I4 | table 上方/下方加段落 / list / callout | 正常 | ⏳ |
| I5 | 把 table 复制粘贴到同笔记另一处 | 完整复制(含 colwidth) | ⏳ |
| I6 | 把 table 复制到别的笔记 | 完整粘贴 | ⏳ |
| I7 | 把 table 复制到浏览器 | 浏览器接收 HTML `<table>` | ⏳ |

---

## 测试完成后

1. 把本文 ⏳ 全部改 ✅ / ❌(附现象)
2. 同步更新 [stages/L5B3.7-table-blocks-completion.md](../stages/L5B3.7-table-blocks-completion.md) § 2 的 7 个 ⏳ 完成判据
3. 主表 [test-checklist.md](../test-checklist.md) 加 §5.7 table 占位条目(暂时只引本文件,避免主表膨胀)
4. **G/H 段的 ❌ 整理成 L5-B3.7.1 sub-stage 需求清单**(列菜单 + 行菜单 + CellSelection toolbar + 拖排 + cell 背景色等)

---

## J. M2 hover handle 验收(L5-B3.7.1)

> **测试前提**:笔记内 `/table` 插入一个 3×3 表格。
> handle 行为约定:**鼠标进入 table 区域**(包括 padding)时 handle bar 显;离开时隐。
> handle bar 半透明灰底,hover 单 dot 时变蓝。点击 dot 弹菜单。

### J.1 列 handle

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| J1.1 | 鼠标进入 table | table 上沿出 N 个细灰 dot(N = 列数),每个 dot 横跨对应列宽 | ⏳ |
| J1.2 | hover 第 2 列的 dot | dot 变蓝;鼠标离开变回灰 | ⏳ |
| J1.3 | 点击第 2 列 dot | 弹菜单,内含:在左侧插入列 / 在右侧插入列 / 复制此列 / 对齐(左中右)/ 删除此列 / 删除整张表 | ⏳ |
| J1.4 | 选"在左侧插入列" | 第 2 列前多 1 列,新列各 cell 空(含 header)| ⏳ |
| J1.5 | 选"在右侧插入列" | 第 2 列后多 1 列 | ⏳ |
| J1.6 | 选"复制此列" | 第 2 列右侧新增一列内容跟第 2 列完全一致 | ⏳ |
| J1.7 | cell 内输文字 → 列菜单"对齐 → 居中" | **整列**文字 center 对齐(td/th 的 `style="text-align: center"`)| ⏳ |
| J1.8 | 列菜单"删除此列" | 第 2 列消失,其他列宽不变 | ⏳ |
| J1.9 | 列菜单"删除整张表" | table 整体删除,光标落在 table 原位上方/下方段落 | ⏳ |

### J.2 行 handle

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| J2.1 | 鼠标进入 table | table 左沿出 N 个细灰 dot(N = 行数),每个 dot 纵跨对应行高 | ⏳ |
| J2.2 | hover 第 2 行 dot | dot 变蓝 | ⏳ |
| J2.3 | 点击第 2 行 dot | 弹菜单:在上方插入行 / 在下方插入行 / 复制此行 / 删除此行 / 删除整张表 | ⏳ |
| J2.4 | "在上方插入行" | 第 2 行前多 1 行,各 cell 空 paragraph | ⏳ |
| J2.5 | "在下方插入行" | 第 2 行后多 1 行 | ⏳ |
| J2.6 | "复制此行" | 第 2 行下方新增完全一样的行 | ⏳ |
| J2.7 | "删除此行" | 第 2 行消失,其他行不变 | ⏳ |
| J2.8 | header 行(第 1 行)的 dot 点 → "删除此行" | header 行删除,**第 2 行变 header**(prosemirror-tables 自动维持表头)| ⏳ |

### J.3 CellSelection ⋯ handle

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| J3.1 | cell A1 按下鼠标拖到 B2 释放 | 4 个 cell 选中(底色蓝),**选区上方居中**浮出 `⋯` 按钮 | ⏳ |
| J3.2 | 点击 ⋯ | 弹菜单:合并单元格 / 拆分单元格 / 复制选区为新行 / 对齐 / 删除整张表 | ⏳ |
| J3.3 | "合并单元格" | 4 cell 合 1 cell(colspan=2, rowspan=2)| ⏳ |
| J3.4 | 合并后 cell 选中 → 点击 ⋯ → "拆分单元格" | 还原为 4 个独立 cell | ⏳ |
| J3.5 | 多 cell 选区 → "复制选区为新行" | 选区下方新增 N 行(N=选区行数),内容复制 | ⏳ |
| J3.6 | 多 cell 选区 → "对齐 → 右对齐" | 选区内每 cell 文字右对齐 | ⏳ |
| J3.7 | 点 ⋯ 外 / Esc | 菜单关闭;再次拖选时 ⋯ 重新显示 | ⏳ |
| J3.8 | 选区跨越多行多列 → ⋯ 位置 | ⋯ 居中于选区上沿(取所有 .selectedCell 并集 bounding rect)| ⏳ |

### J.4 状态 / 焦点 / popup 通用行为

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| J4.1 | popup 打开时点 popup 外(table 外) | popup 关闭,菜单 context clear | ⏳ |
| J4.2 | popup 打开时按 Esc | popup 关闭 | ⏳ |
| J4.3 | 同笔记多个 table,在 A table 打开 popup 后点 B table | A 的 popup 关闭 | ⏳ |
| J4.4 | 操作完成后 | view 重新聚焦(`view.focus()`),光标可继续输入 | ⏳ |
| J4.5 | undo 一次 | 上次结构操作可回退 | ⏳ |

### J.5 不回归 / 兼容

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| J5.1 | 切走笔记 → 切回 | hover handle 还能正常出现 | ⏳ |
| J5.2 | 重启 Electron → 打开 | hover handle 还能正常出现 | ⏳ |
| J5.3 | 拖动 cell 边界 resize 列宽 | 列宽变化后 dot 位置随之更新(rAF 重算)| ⏳ |
| J5.4 | 表格超宽 → 横向滚动 | scroll wrapper 滚动时 dot 也跟着平移(在 table 坐标系内)| ⏳ |
| J5.5 | F12 看 DOM | `.krig-table-block__col-bar` / `__row-bar` / `__col-dot` / `__row-dot` / `__cs-handle` 5 类 class 都在 | ⏳ |
| J5.6 | typecheck + lint | 全过(lint 允许 main 已存在 warning)| ⏳ |

---

## 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-05-16 | v0.1 | 初稿。9 段 60+ 条:A 基础结构 / B Tab 导航 / C +col/+row / D 列宽 / E 删整表 / F md 粘贴 / G 砍掉的 V1 UX / H Notion 对标 / I 不回归 |
| 2026-05-16 | v0.2 | M2 实施(L5-B3.7.1):§C 标 deprecated;§G.1/G.2 标 ✅;§G.3 标 🚫(M2 决策不接右键);§H.1.4/H.1.5 标 ✅;**新增 §J**(36 条 M2 验收测试,5 个子段)|
