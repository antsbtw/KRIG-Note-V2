# Todo System — 任务管理系统

> **状态**：设计中
> **涉及模块**：编辑器（taskItem 节点）、SurrealDB（todo 表）、TodoView（独立视图）

---

## 一、系统概览

```
NoteView（编辑器内 Todo）        TodoView（独立视图）
┌──────────────────────┐       ┌──────────────────────────────┐
│ ☐ 完成第一章翻译      │       │ ▓▓▓▓▓▓░░░░  完成第一章翻译    │
│   创建: 04-05         │       │ ▓▓▓▓▓▓▓▓▓▓  修复渲染 bug     │
│ ☑ 修复渲染 bug        │ ───→  │ ░░░░░░░░░░  写单元测试       │
│   完成: 04-04         │  同步  │          ↑ 今天              │
│ ☐ 写单元测试          │       └──────────────────────────────┘
│   截止: 04-10         │       来自所有文档，甘特图 + 列表切换
└──────────────────────┘

KRIG 视图体系
├── NoteView      — 文档编辑（taskItem 轻量输入）
├── TodoView      — 任务管理（甘特图 + 列表视图）
├── GraphView     — 知识图谱（未来）
└── ...
```

**两层分工**：
- **编辑器层（NoteView）**：`taskItem` 节点，记录任务的生命周期（创建、完成、截止时间），轻量输入
- **视图层（TodoView）**：独立 View，与 NoteView 同级，从 SurrealDB 汇聚所有文档的 todo，甘特图 + 列表视图切换

---

## 二、编辑器层：taskItem 节点改造

### 2.1 Schema

```
taskList（content: 'taskItem+'）
  └── taskItem（content: 'block+'）
        attrs:
          atomId: string | null     — Atom ID（UUID，复用 Atom 架构，同时作为 SurrealDB 记录 ID）
          checked: boolean          — 是否完成
          createdAt: string | null  — 创建时间（ISO 8601）
          completedAt: string | null — 完成时间（打勾时自动填入）
          deadline: string | null   — 用户期望完成时间（可选）
```

**为什么引入 taskItem 中间层**：
- `checkedItems` attr 用 index 映射，插入/删除行会错位
- 时间属性属于每个任务，必须和任务节点绑定
- 与 mirro-desktop 架构一致

### 2.2 NodeView

```
div.task-item                         ← taskItem 外层（flexbox）
  ├── input[type=checkbox]            ← checkbox（contentEditable=false）
  ├── div.task-item__content          ← contentDOM（ProseMirror 管理子 Block）
  │     └── p / h1 / h2 / ...        ← 子 Block（继承基类能力）
  └── span.task-item__time            ← 时间标签（contentEditable=false，hover 显示）
```

### 2.3 时间行为

| 事件 | 行为 |
|------|------|
| **创建 taskItem** | `createdAt = new Date().toISOString()` |
| **打勾** | `checked = true, completedAt = new Date().toISOString()` |
| **取消勾选** | `checked = false, completedAt = null` |
| **设置截止时间** | 右键菜单 / 行内日期选择器 → `deadline = ...` |

### 2.4 时间显示

默认隐藏时间标签，hover taskItem 时显示：

```
☐ 完成第一章翻译                           04-05 创建 · 截止 04-10
☑ 修复渲染 bug                            04-04 完成
```

- 未完成 + 有 deadline：显示 `创建日期 · 截止 日期`
- 未完成 + 无 deadline：显示 `创建日期`
- 已完成：显示 `完成日期`
- 超期未完成：deadline 标红

### 2.5 与手柄的关系

手柄 left 已固定对齐编辑器左边缘，不受 taskItem 内部结构影响。taskItem 的 checkbox 在内容区域内部（padding-left），不与手柄重叠。

---

## 三、存储层：统一 Atom 架构

### 3.1 核心理念

**不建独立的 todo 表。** taskItem 和所有其他 Block 一样，是 Atom 表中的一条记录。TodoView 只是对 Atom 表的一个查询视图。

```
SurrealDB Atom 表
├── type=textBlock    → NoteView 渲染
├── type=mathBlock    → NoteView 渲染
├── type=taskItem     → NoteView 渲染 + TodoView 聚合查询
├── type=image        → NoteView 渲染 + 未来 GalleryView 聚合
└── ...                → 未来更多 View 按 type 筛选
```

每个 View 只是 Atom 表的不同查询条件：

```sql
-- TodoView：所有 taskItem
SELECT * FROM atom WHERE type = 'taskItem' ORDER BY createdAt DESC;

-- TodoView：未完成 + 超期
SELECT * FROM atom WHERE type = 'taskItem' AND checked = false AND deadline < time::now();

-- TodoView：某文档的 taskItem
SELECT * FROM atom WHERE type = 'taskItem' AND noteId = $noteId;
```

### 3.2 Atom 表中 taskItem 的字段

taskItem 的 attrs（checked、createdAt、completedAt、deadline）作为 Atom 记录的字段存储，与现有 Atom 架构完全一致：

```
Atom 记录 = { atomId, noteId, type: 'taskItem', attrs: { checked, createdAt, completedAt, deadline, ... }, content: [...] }
```

无需额外的索引表、映射表。Atom 架构天然支持跨文档查询。

### 3.3 同步策略

与所有 Block 相同——文档保存时，taskItem Atom 和其他 Atom 一起增量同步到 SurrealDB。不需要 taskItem 特殊的同步逻辑。

### 3.4 查询 API

```typescript
// TodoView 的查询全部基于 Atom 通用查询，按 type='taskItem' 筛选
async function queryAtoms(filter: { type?: string; noteId?: string; ... }): Promise<Atom[]>;

// 便捷封装（可选）
async function getActiveTodos(): Promise<Atom[]>;      // type=taskItem, checked=false
async function getOverdueTodos(): Promise<Atom[]>;      // type=taskItem, checked=false, deadline < now
async function getTodosByNote(noteId: string): Promise<Atom[]>;
```

---

## 四、TodoView — 独立视图

TodoView 与 NoteView 同级，是 KRIG 视图体系的一个独立 View。有自己的路由、数据查询、交互逻辑，不依赖编辑器。

### 4.1 视图模式

| 模式 | 说明 |
|------|------|
| **甘特图** | 时间轴横向展开，每个 todo 一条横条，显示创建→截止→完成 |
| **列表** | 表格形式，列：checkbox、内容、文档名、创建时间、截止时间、状态 |

可切换，默认甘特图。

### 4.2 甘特图设计

```
时间轴（按天/周/月缩放）
│  04-01  04-02  04-03  04-04  04-05  04-06  ...  04-10
│
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  完成第一章翻译          截止 04-10
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓✓       修复渲染 bug             完成 04-04
│            ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  写单元测试     截止 04-10
│
│ 颜色：
│   ▓ 蓝色 = 进行中
│   ✓ 绿色 = 已完成
│   ▓ 红色 = 超期未完成
```

### 4.3 交互

| 操作 | 行为 |
|------|------|
| 点击 todo 条 | 跳转到对应文档的 taskItem 位置 |
| 拖拽条的右边缘 | 调整 deadline |
| 勾选 checkbox | 标记完成，更新 SurrealDB + 文档内 taskItem |
| 筛选 | 按文档 / 状态（全部/未完成/已完成/超期）/ 时间范围 |
| 缩放 | 天视图 / 周视图 / 月视图 |

### 4.4 视图位置

TodoView 是独立 View，与 NoteView 同级。通过 Tab 或导航栏切换。后续实施时参照 KRIG 视图体系的注册机制。

---

## 五、完整数据流

```
用户输入 [] + 空格
  │
  ▼
创建 taskItem Atom（atomId = uuid, createdAt = now）
  │
  ▼
用户编辑任务文本 / 设置 deadline / 打勾完成
  │
  ▼
文档保存 → 所有 Atom（包括 taskItem）增量同步到 SurrealDB
  │
  ▼
TodoView 查询 SurrealDB（WHERE type = 'taskItem'）→ 渲染甘特图 / 列表
  │
  ▼
用户在 TodoView 点击任务 → 切换到 NoteView 并定位到对应 taskItem
```

---

## 六、实施顺序

| 阶段 | 内容 | 依赖 |
|------|------|------|
| **P1** | taskItem 节点改造（checked + createdAt + completedAt + atomId） | 无 |
| **P2** | SurrealDB todo 表 + 保存时同步 | P1 |
| **P3** | deadline 设置（日期选择器）+ 超期标红 | P1 |
| **P4** | TodoView — 列表视图（独立 View，注册到视图体系） | P2 |
| **P5** | TodoView — 甘特图视图 | P4 |
| **P6** | 甘特图拖拽调整 deadline + 双向同步 | P5 + P3 |

### P1 检查清单

- [ ] `task-list.ts` — 新增 taskItemBlock（content: 'block+', attrs: atomId/checked/createdAt/completedAt）
- [ ] `task-list.ts` — taskList content 改为 'taskItem+'
- [ ] `index.ts` — 注册 taskItemBlock
- [ ] `SlashMenu.tsx` — taskList 创建正确的 taskList > taskItem > textBlock
- [ ] `input-rules.ts` — `[]`/`[x]` 创建 taskList > taskItem > textBlock
- [ ] `test-content.ts` — 更新测试文档
- [ ] `note.css` — taskItem 样式（flexbox + checkbox + 时间标签）
- [ ] 验证：手柄对齐不受影响
- [ ] 验证：checkbox 点击切换 + 时间自动记录

---

## 七、与现有架构的对齐

### 7.1 三基类继承关系

```
Block（抽象基类）
  └── ContainerBlock
        ├── taskList     — content: 'taskItem+'
        └── taskItem     — content: 'block+'，attrs: checked/createdAt/completedAt/deadline
```

- **taskList** 是 ContainerBlock，和 bulletList/orderedList 同级
- **taskItem** 是 ContainerBlock（中间层），和 tableRow/tableCell/listItem 同类——是父容器的内部结构节点
- **taskItem 内部的子 Block** 继承基类全部能力（Handle、拖拽、Mark 等），不受 taskItem 影响

### 7.2 节点注册

遵循 BlockDef 注册机制（`blockRegistry.register()`）：

```typescript
// blocks/task-list.ts — 自包含模块
export const taskListBlock: BlockDef;   // taskList ContainerBlock
export const taskItemBlock: BlockDef;   // taskItem 中间层

// blocks/index.ts — 注册
blockRegistry.register(taskListBlock);
blockRegistry.register(taskItemBlock);
```

### 7.3 todoId 与 atomId 的关系

KRIG 的 Atom 架构为每个 Block 分配 `atomId`。taskItem 的 `todoId` **复用 `atomId`**，不另建 ID 体系：

- taskItem 创建时生成 `atomId`（UUID），同时作为 SurrealDB todo 表的记录 ID
- 这样文档内外映射通过 `atomId` 统一，不需要额外的 `todoId` 字段

### 7.4 存储同步的模块归属

同步逻辑**不在 taskItem 的 NodeView 中**。taskItem 和所有 Block 一样走统一的 Atom 同步管线：

```
taskItem NodeView     — 只管渲染和 checkbox 交互
      ↓ dispatch(tr)
ProseMirror 文档      — attrs 是权威数据源
      ↓ 文档保存时
Atom 同步模块         — 统一遍历文档所有节点，增量同步到 SurrealDB Atom 表
      ↓
SurrealDB Atom 表     — 统一存储，TodoView 按 type='taskItem' 查询
```

**taskItem 不需要专门的同步逻辑。** 它只是 Atom 的一种 type。

### 7.5 TodoView 的注册

TodoView 是独立 View，不是编辑器的插件或面板。它的注册机制待视图体系定义后明确。初步方向：

```
src/views/
  ├── note/       — NoteView（现有编辑器）
  ├── todo/       — TodoView（甘特图 + 列表）
  └── ...
```

TodoView 只依赖 SurrealDB 查询 API，不依赖 ProseMirror 或编辑器模块。跳转到文档时通过 IPC 通知 NoteView 打开对应文档并定位。

---

## 八、设计原则

1. **编辑器轻量，视图独立**：编辑器内只管输入和打勾，复杂的任务管理在独立 TodoView
2. **统一 Atom 架构**：taskItem 是 Atom 的一种 type，不建独立的 todo 表，TodoView 只是查询条件不同
3. **节点只管自己**：taskItem 的 NodeView 只管渲染和交互，同步走统一的 Atom 管线
4. **atomId 统一标识**：taskItem 复用 Atom 架构的 atomId，不另建 ID 体系
5. **View = Atom 查询视图**：TodoView 查询 `type='taskItem'`，未来 GalleryView 查询 `type='image'`，同一架构
6. **注册不修改框架**：taskItem 通过 `blockRegistry.register()` 注册，不修改三基类或 block-handle
7. **渐进实现**：P1 先让 taskItem 能用，Atom 同步已有基础，TodoView 按需实施
