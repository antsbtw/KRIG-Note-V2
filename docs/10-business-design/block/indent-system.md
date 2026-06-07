# Indent System — 缩进系统设计契约

> **状态**：V2 现行设计（2026-06-07 重写，取代旧 P1–P5 sink 嵌套方案）
> **维护**：本文档是缩进行为的**单一事实来源**，持续迭代。改缩进逻辑前先改本文档。
> **涉及模块**：
> - `plugins/build-block-indent-keymap.ts` — Tab / Shift-Tab / Cmd+Shift+I 入口
> - `plugins/build-block-indent-plugin.ts` — indent attr → margin 装饰渲染（descendants 全树）
> - `plugins/build-list-keymap.ts` — 列表 Enter（**不含 Tab**）
> - `plugins/build-split-indent-keymap.ts` — Enter 拆块继承缩进
> - `blocks/list-item/spec.ts`、`blocks/task-list/spec.ts` + `node-view.ts` — listItem/taskItem 的 indent attr 渲染
> - `blocks/toggle-list/keymap.ts` — 收起 toggle Enter 继承缩进
> - `_shared/multiple-node-selection.ts` — 块选区类型

---

## 〇、核心原则（最高优先级，冲突时以此为准）

1. **块缩进以「选中块」为硬前提：不选中，不允许任何块的缩进操作。**
   纯文本光标永远不缩进块。要缩进块必须先有块选区（Esc 选块 / 拖选 / 选中容器）。
2. **块缩进统一走 `indent` attr（margin 右移），不做 sink 列表结构嵌套。**
   列表项、容器、普通段落同构：都是 `indent` attr 0–8，每级 24px。
3. **以选中为准决定缩进对象**：选谁缩谁，容器内选单块只缩那个块、不碰上一级容器。
4. **缩进随 dissect / assemble 原样持久化**（`indent` 在 block atom payload.attrs 内，无白名单过滤）。

---

## 一、Tab 缩进的三种行为（契约）

Tab 的行为由「当前选择状态」决定，三者互斥：

| # | 行为 | 触发条件 | 效果 | 机制 |
|---|------|---------|------|------|
| **1** | **整块缩进** | **存在块选区**（MNS / NodeSelection-on-block） | 对**选中的块**（单块/多块）indent ±1 | `indent` attr |
| **2** | **块内文字首行缩进** | 触发键是 **Cmd+Shift+I**（不是 Tab） | 切换块的首行缩进 | `textIndent` attr |
| **3** | **光标处段内缩进** | **纯文本光标**（无块选区）在 textblock 内 | 从光标处插入两个全角空格 `　　` | 插入文本 |

### 行为 1 —— 整块缩进（以选中为准）

**硬前提：必须有块选区。** 纯文本光标按 Tab 永远走行为 3，绝不缩进块。

选中决定缩进对象：

| 选中的是 | Tab 缩进对象 |
|---------|------------|
| 容器块（callout / blockquote / toggleList / columnList 本身） | 整个容器块 |
| 容器内嵌套的容器 | 那个嵌套容器 |
| 容器内的单个块（如 callout 内某段落） | **只这个块**，不碰上一级容器 |
| 多个同级块（MNS 跨块） | 每个选中块一起 ±1 |
| 列表项（单/多） | 选中的列表项 ±1（整项右移，**非** sink 嵌套；含列表首项也能右移） |

- Tab = `indent = min(indent+1, 8)`；Shift-Tab = `indent = max(indent-1, 0)`。
- 块选区下 Tab/Shift-Tab **始终吃掉键**，不回退到插字符 / 移焦。
- 实现：`indentBlockSelection` = `indentMultiBlock`(MNS) + `indentNodeSelection`(单块 NodeSelection)。MNS 用 `sel.parent.child(i)` 取选中块，天然只动选中块、不动父容器。

### 行为 2 —— 块内文字首行缩进

- 触发键：**Cmd+Shift+I**（`toggleTextIndentCmd`），**不是 Tab**。
- 作用：切换光标所在 textblock 的 `textIndent` attr（首行缩进）。
- 不固定 depth=1：toggle / 列表 / callout 内嵌套的 paragraph/heading 也能命中（向上找最近带 textIndent attr 的块）。

### 行为 3 —— 光标处段内缩进

- 触发：纯文本光标（`selection.empty && $from.parent.isTextblock`），任意 offset（含行首）。
- 作用：从光标处插入两个全角空格 `　　`（中文段内缩进习惯，对齐 V1）。
- 这是「不选中块」时 Tab 的唯一块无关行为。

---

## 二、indent attr 渲染

| 块类型 | indent 来源 | 渲染方式 |
|--------|------------|---------|
| 顶层 group='block' 节点 | schema-builder `injectFrameworkAttrs` 注入 | `build-block-indent-plugin` 的 Decoration（descendants 全树，含容器内块） |
| listItem | spec 显式加 `indent` attr | spec.toDOM 出 `margin-left`（自渲染，plugin 跳过避免叠加） |
| taskItem | spec 显式加 `indent` attr | node-view `syncDom` 设 `marginLeft`（有 nodeView，自渲染） |

- 每级 24px（`INDENT_STEP_PX`）。
- **关键**：block-indent-plugin 用 `descendants` 全树遍历，否则容器内块的 indent 不渲染。

---

## 三、回车（Enter）与缩进继承

原则：**在一个 indent>0 的块里「回车延续」新建的下一个同级块，继承该块的 indent。**

| 场景 | 处理 | 继承？ |
|------|------|--------|
| 顶层 / 容器内 textblock（段落、heading）回车延续 | `build-split-indent-keymap`：跑默认 splitBlock 后把新块 indent 补成源块 indent | ✅ |
| 收起 toggle（▶）回车新建下一个 toggle | `toggle-list/keymap.ts`：新 toggle attrs 带 `indent: inheritedIndent` | ✅ |
| 列表项回车分裂出新项 | `splitListItem`（PM 库 node.copy 保留 attrs） | ✅ |
| caption 跳出（图片/数学/代码块小标题回车） | 各自 keymap，新段是全新块 | ❌ 不继承 |
| slash 插入全新块、bottom-pad 末尾新段、粘贴媒体 caption | — | ❌ 不继承（非延续） |

> 注：PM 默认 splitBlock 在「光标在块尾按 Enter」时用 defaultBlockAt 产出全新 paragraph，**不带 attrs** → 这是必须用 split-indent-keymap 兜的根因。

---

## 四、持久化

`indent` attr 随标准存储链路持久化，无需特殊处理：

1. 编辑器 `serializeDoc`（PM `doc.toJSON()`）原样带上每个节点 attrs（含 indent）。
2. main 进程 `dissect-pm-doc` 拆 block atom：`payload.attrs = child.attrs` **原样保留，无白名单**。
3. `diffBlockTree`：indent 变化 → block payload stableStringify 变 → 判为 `modified` → 写库。
4. 读回 `assemble-pm-doc` + `PMNode.fromJSON` 原样还原。

> 验证：listItem indent 0→1 离线 dissect 产出 `modified:['<id>']`，重启保留。

---

## 五、与旧设计（V1 / 旧 P1–P5）的差异

| 维度 | 旧设计 | V2 现行 |
|------|--------|---------|
| 列表项 Tab | 结构缩进（sink 嵌套子列表） | indent attr 整项右移 |
| 单光标在块内 Tab | 缩进当前块 | **不缩块**（行为 3 插字符）；缩块必须先选中 |
| 容器内 Tab | 缩进当前块（但旧实现 bug：取 depth=1 缩了整个容器） | 以选中为准，选内部块只缩内部块 |
| Tab 语义判定 | 由「上下文」决定（列表/容器/普通各异） | 由「是否块选区」决定（统一） |

废弃：旧 `plugins/indent.ts` 的 `nestListItem`/`liftListItem` sink 路径、列表内光标自动缩进。

---

## 六、设计原则

1. **不选中不动块**：块缩进必须有块选区，杜绝误操作。
2. **统一 indent attr**：列表/容器/段落同构，不做结构 sink，简化心智 + 保证持久化。
3. **以选中为准**：选谁缩谁，容器内选单块不波及容器。
4. **回车延续继承缩进**：缩进块里回车，新同级块对齐。
5. **缩进是基类能力**：所有 group='block' 节点自动支持，不需各 block 单独实现。

---

## 七、待思考 / 迭代点

> 本节供持续优化时记录开放问题（用户主导）。

- 列表项「以选中为准缩进」与「视觉嵌套层级」的关系：indent attr 右移 vs 真·子列表，是否未来需要并存两种语义？
- Shift-Tab 对纯文本光标当前无行为（放行）；是否需要「outdent 段内全角空格」的对称行为？
- 容器深层嵌套时 indent 上限（8 级）是否够用。
