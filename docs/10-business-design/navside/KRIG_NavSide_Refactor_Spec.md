# KRIG · NavSide 重构 Spec

> Refactor Spec · 2026-04-26
>
> 对应背景：v1.3 实施完成报告 § 6.1 已记录"PerfPanel 太专业"等用户反馈；
> 同时 NavSide 三层债务（Note 硬编码进框架 / EBook/Graph Panel 物理位置错位 /
> 跨插件 store 访问）在 v1.4 启动前必须先收。
>
> 实施分支：`refactor/navside-modular`（跨模块改动，按 CLAUDE.md 规范）

---

## 0. 文档定位

本规范处于 **NavSide 框架层** 的架构重构层级。它定义：

- 框架层与插件层的边界（什么住在 `src/renderer/navside/`，什么住在 `src/plugins/*/navside/`）
- 通用组件 `FolderTree` 的接口契约（**严格无业务知识**）
- 各插件面板的统一形态（folder + item + 元数据渲染）
- 数据层适配（folder 表归属、graph 加 folder_id）

它**不**改动业务逻辑（Note CRUD、EBook 导入、Graph 渲染等），只搬代码到合理位置 + 抽通用组件。

---

## 1. 当前现状（病历）

### 1.1 物理位置错位

```
src/renderer/navside/             ← 框架层
  ├── NavSide.tsx (555 行)        框架本身 + Note 硬编码 ❌
  ├── GraphPanel.tsx (174 行)     ← graph 插件面板，住错地方
  ├── EBookPanel.tsx (812 行)     ← ebook 插件面板，住错地方
  ├── panel-registry.ts           注册表（架构正确）
  ├── navside-styles.ts           通用样式
  ├── renderer.tsx                入口（直接 import 各 plugin Panel ❌）
  └── hooks/
      ├── useDragAndDrop.ts       Note 拖拽专用
      └── useNoteOperations.ts    Note 业务

src/plugins/note/navside/         ← 应该有但是空
src/plugins/ebook/navside/        ← 应该有但是空
src/plugins/graph/navside/        ← 应该有但是空
src/plugins/web/navside/          ← 唯一住对位置的（有 WebPanel + AIServicesPanel）
```

### 1.2 Note 硬编码进框架

`NavSide.tsx` 内部约 250 行专门处理 `contentType === 'note-list'` 分支：

- folder/note 树渲染（`buildTree`）
- 拖拽（`useDragAndDrop`）
- 右键菜单
- 排序
- 搜索结果扁平展示

而 EBook/Web/Graph 走"插件面板分发"路径（`getNavPanel(contentType)`）—— **同一个框架文件里两套机制并存**。

### 1.3 v1.4 即将到来的压力

v1.4 路线包含 KnowledgeEngine + 多变种（思维导图、BPMN 等）。如果 Graph 面板继续住框架层 + 不抽通用组件：

- GraphPanel 要塞"目录树 + 变种过滤 + 变种新建下拉"，体量逼近 Note 树
- 每个插件重复造轮子（拖拽、右键菜单、键盘）
- 跨插件硬编码持续增长

**结论**：NavSide 重构是 v1.4 启动前的必要前置工作。

---

## 2. 目标与原则

### 2.1 目标

- **框架层只做框架的事**：壳、注册分发、通用部件
- **插件自治**：每个插件的 NavSide 面板物理位置在 `src/plugins/<plugin>/navside/`
- **统一抽象**：folder + item + 元数据渲染 → `FolderTree` 通用组件
- **零侵入扩展**：未来新插件 / Graph 新变种不修改框架代码

### 2.2 设计原则

| 原则 | 说明 |
|------|------|
| **分层严格** | 下层（框架 / FolderTree）不必知道上层（业务）。上层依赖下层接口而非实现 |
| **插件自治** | 每个插件 navside 目录内文件齐备：Panel + register + 业务 hooks |
| **接口稳定** | FolderTree props / NavPanel props 一旦定稳，插件不感知框架内部演进 |
| **数据自管** | 插件管自己的 folder 表 + 业务表（FolderTree 不直接 fetch 数据） |
| **复用通用部件** | 拖拽 / 右键菜单 / 键盘 / 排序的逻辑可被抽取的部分进 FolderTree，不可抽的部分由插件实现 |

---

## 3. 新架构（三层）

### 3.1 全局结构

```
┌──────────────────────────────────────────────────────────────────┐
│  L1：框架层 src/renderer/navside/                                  │
│  ──────────────────────────────────────────                      │
│  NavSide.tsx    ~150 行：壳（BrandBar/ModeBar/ActionBar/Search） │
│                          + 注册表分发（getNavPanel）             │
│  panel-registry.ts                                              │
│  components/                                                    │
│    ├── BrandBar.tsx                                             │
│    ├── ModeBar.tsx                                              │
│    ├── ActionBar.tsx                                            │
│    ├── SearchBar.tsx                                            │
│    └── FolderTree/             ★ 核心通用组件 ★                 │
│        ├── FolderTree.tsx      渲染树 + 处理交互                │
│        ├── types.ts            TreeNode / TreeItem 接口         │
│        ├── DragDrop.ts         通用拖拽（不耦合 Note）          │
│        ├── ContextMenu.ts      通用右键菜单                     │
│        └── styles.ts                                            │
│  shared/                                                        │
│    ├── useDbReady.ts           （从原 Note hook 抽出来）        │
│    └── PanelHeader.tsx                                          │
│  navside.html / renderer.tsx                                    │
└──────────────────────────────────────────────────────────────────┘
                ↑ contentType 分发（panel-registry）
┌──────────────────────────────────────────────────────────────────┐
│  L2：插件面板 src/plugins/<plugin>/navside/                        │
│  ──────────────────────────────────────────                      │
│  src/plugins/note/navside/                                       │
│    ├── NotePanel.tsx           入口（消费 FolderTree + itemMeta）│
│    ├── useNoteOperations.ts    业务 hooks（CRUD / 拖拽路由）       │
│    ├── ContextMenuItems.ts     Note 右键菜单条目                  │
│    └── register.ts             registerNavPanel('note-list', NotePanel) │
│                                                                  │
│  src/plugins/graph/navside/                                      │
│    ├── GraphPanel.tsx                                            │
│    ├── useGraphOperations.ts                                     │
│    ├── VariantPicker.tsx       新建图时选变种的下拉菜单           │
│    └── register.ts                                               │
│                                                                  │
│  src/plugins/ebook/navside/                                      │
│    ├── EBookPanel.tsx                                            │
│    ├── useEBookOperations.ts                                     │
│    └── register.ts                                               │
│                                                                  │
│  src/plugins/web/navside/                                        │
│    └── ... (已就位，仅需轻度调整为 FolderTree 消费者)              │
└──────────────────────────────────────────────────────────────────┘
                ↑ 数据接口（IPC / store）
┌──────────────────────────────────────────────────────────────────┐
│  L3：数据层（每插件独立 folder 表 + 业务表）                        │
│  ──────────────────────────────────────────                      │
│  note_folder + note                                              │
│  ebook_folder + ebook                                            │
│  graph_folder + graph（v1.4 新增 graph_folder + graph.folder_id）│
│  web_bookmark_folder + web_bookmark（按需）                       │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 模块边界

| 层 | 职责 | 不应做 |
|----|------|-------|
| L1 框架 | 壳布局、模式切换、注册分发、通用 UI 部件 | 不知道任何插件的业务概念（"note" / "ebook" / "variant" 等不出现在框架代码） |
| L2 插件面板 | 业务 CRUD、用户交互、决定 item 怎么渲染 | 不直接 import 别的插件代码（跨插件调用走 IPC / 共享 store） |
| L3 数据层 | folder + item 持久化 | 不感知 UI |

---

## 4. FolderTree 通用组件接口（核心契约）

### 4.1 接口定义

```typescript
// src/renderer/navside/components/FolderTree/types.ts

/** 树节点：可以是 folder（含子节点）或 item（叶子） */
export type TreeNode = FolderNode | ItemNode;

export interface FolderNode {
  kind: 'folder';
  id: string;
  parentId: string | null;
  title: string;
  /** 是否展开（受控） */
  expanded: boolean;
  /** 子节点（已排序） */
  children: TreeNode[];
}

export interface ItemNode {
  kind: 'item';
  id: string;
  parentId: string | null;
  /** 业务自定义 payload，FolderTree 不解析；itemMeta 收到原样 */
  payload: unknown;
  /** 排序键（FolderTree 已用此排序） */
  sortKey?: number | string;
}

/**
 * Item 视觉元数据（强制统一布局）。
 *
 * 视觉规则（FolderTree 内置渲染）：
 *   [icon][title][spacer][rightHint]
 *
 * 插件不能自定义 item 行整体布局，只能填充三个字段。
 * 主 icon 由插件决定（包括同插件不同子类型的不同图标，如 Graph 各 variant），
 * 但布局结构由框架强制。
 *
 * 这是"分层严格 + 视觉一致"原则的实施：
 * - 插件控制：用什么 icon、用什么 title、显示什么 hint
 * - 框架控制：行高、缩进、间距、hover 反馈、选中态
 */
export interface ItemMeta {
  /** 主图标 = 类型标记。可用 emoji（'📄' / '⚛'）或自定义 ReactNode */
  icon: string | ReactNode;
  /** 主标题 */
  title: string;
  /** 右侧 hint（通常是相对时间，可选） */
  rightHint?: string;
}

export interface FolderTreeProps {
  /** 树数据（根节点列表，已构建好层级） */
  nodes: TreeNode[];

  /** 当前选中的节点 id 集合（受控） */
  selectedIds: Set<string>;
  onSelectChange: (ids: Set<string>) => void;

  /** 展开/折叠（受控） */
  onFolderToggle: (folderId: string, expanded: boolean) => void;

  /**
   * Item 视觉元数据提取（必填，强制统一布局）。
   * FolderTree 用 itemMeta 返回的字段渲染统一的 [icon][title][rightHint] 布局。
   * 插件不能自定义整行结构。
   */
  itemMeta: (item: ItemNode) => ItemMeta;

  /** 单击 item 行（高亮 + 业务回调） */
  onItemClick?: (item: ItemNode, e: React.MouseEvent) => void;
  /** 双击 item 行 */
  onItemDoubleClick?: (item: ItemNode) => void;

  /** 右键菜单：返回菜单项数组；返回空数组则不显示菜单 */
  contextMenu?: (target: TreeNode | null, e: React.MouseEvent) => ContextMenuItem[];

  /** 拖拽是否启用 */
  draggable?: boolean;
  /** 拖放完成时回调（业务决定怎么 reparent / 重排） */
  onDrop?: (draggedIds: string[], targetFolderId: string | null) => void;

  /** 键盘：Delete / Enter / 方向键，业务决定动作 */
  onKeyAction?: (action: 'delete' | 'rename' | 'enter', target: TreeNode) => void;
}

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  separator?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}
```

### 4.2 业务零知识检验

`FolderTreeProps` 内**不出现任何业务概念**：

- 没有 "note" / "graph" / "ebook" / "variant"
- 没有 renderItem / renderFolder 这种允许插件接管视觉的逃生口
- 没有数据 fetch（业务传入构建好的 `nodes`）
- 没有"创建" / "重命名"等业务动作（业务在 contextMenu / onKeyAction 里实现）

`ItemNode.payload: unknown` 是业务数据容器，插件通过 `itemMeta(item)` 把
payload 解析为标准 ItemMeta 后交给框架渲染。

### 4.3 由 FolderTree 负责的通用能力

- 树结构遍历 + 缩进渲染
- **强制统一的 item 视觉布局**：`[icon][title][rightHint]`
- **强制统一的 folder 视觉**：`[📁][title][展开/折叠箭头]`
- 选中状态管理（单选 / Cmd+多选 / Shift+范围选）
- 展开/折叠状态视觉反馈
- 拖拽 DOM 事件（HTML5 Drag/Drop API），结果调 onDrop
- 右键菜单显示与定位
- 键盘聚焦与基本快捷键（方向键 / Enter / Delete）
- 滚动容器、空态占位

### 4.4 由插件实现的部分

- itemMeta 函数：声明每个 item 的 icon / title / rightHint
- 数据加载（业务自己 fetch + 持有 state，传 `nodes` 给 FolderTree）
- 业务动作（onItemClick → 打开 Note / Graph / 等）
- contextMenu 内容（业务自定义条目）
- 创建/删除/重命名的具体实现（业务 hooks 调 IPC 修改数据后重算 nodes）

### 4.5 视觉统一原则（v1.4 决策）

**原则**：主 icon 即类型标记。同插件内不同子类型用不同 icon，让用户扫一眼
即识别。**folder icon 跨插件统一为 📁**（FolderTree 内置，不允许覆盖）。

各插件的 item icon 约定（v1.4 起）：

| 类型 | icon | 来源 |
|------|------|------|
| Note | 📄 | NotePanel.itemMeta |
| Graph - 知识图谱（knowledge） | ⚛ | GraphPanel.itemMeta（按 variant） |
| Graph - 思维导图（mindmap） | ☘ | 同上（v1.5 启用） |
| Graph - 流程图 BPMN | ⊳ | 同上（v1.5 启用） |
| Graph - 时间轴（timeline） | ⏱ | 同上 |
| Graph - 自由画布（canvas） | ◫ | 同上 |
| Graph - Basic | ○ | 同上（验证用） |
| EBook - PDF | 📕 | EBookPanel.itemMeta |
| EBook - EPUB | 📗 | 同上 |
| EBook - 其他格式 | 📘 | 同上 |
| Web 书签 | 🌐 | WebPanel.itemMeta（按需） |
| Folder | 📁 | FolderTree 内置（不可覆盖） |

新增 icon 时更新本表。同插件内 icon 选择写在该插件的 `itemMeta` 函数里。

---

## 5. 插件面板的统一形态

### 5.1 NavPanel 标准结构

每个插件的 navside 目录至少含 3 个文件：

| 文件 | 职责 |
|------|------|
| `<Plugin>Panel.tsx` | 入口组件，组装 FolderTree + 业务 hooks + itemMeta |
| `use<Plugin>Operations.ts` | 业务 hooks：CRUD / 拖拽路由 / 重命名 / 删除 / 排序 |
| `register.ts` | 调 `registerNavPanel(contentType, Panel)` |

可选文件：
- `ContextMenuItems.ts`：右键菜单条目工厂
- `<Plugin>VariantPicker.tsx`：仅多变种插件需要（如 Graph）

**不再需要 `<Plugin>Item.tsx`**（v1.4 决策）：FolderTree 内置统一 item 布局，
插件只需提供 itemMeta 函数，不再需要单独的 Item 组件。

### 5.2 NotePanel 重构示例

```typescript
// src/plugins/note/navside/NotePanel.tsx
import { FolderTree } from '../../../renderer/navside/components/FolderTree';
import { useNoteOperations } from './useNoteOperations';

export function NotePanel(props: NavPanelProps) {
  const ops = useNoteOperations(props);
  const nodes = ops.buildTreeNodes();  // 把 folderList + noteList 转成 TreeNode[]

  return (
    <FolderTree
      nodes={nodes}
      selectedIds={ops.selectedIds}
      onSelectChange={ops.setSelectedIds}
      onFolderToggle={ops.toggleFolder}
      itemMeta={(item) => {
        const note = item.payload as Note;
        return {
          icon: '📄',
          title: note.title,
          rightHint: relativeTime(note.updated_at),
        };
      }}
      onItemClick={(item) => ops.openNote(item.id)}
      contextMenu={(target, e) => ops.buildContextMenu(target, e)}
      draggable
      onDrop={ops.handleDrop}
      onKeyAction={ops.handleKey}
    />
  );
}
```

NotePanel 自身约 30 行——**所有数据逻辑在 hook，渲染由 FolderTree 内置统一布局，所有交互在 contextMenu/onDrop**。

### 5.3 GraphPanel 重构示例（含 variant）

```typescript
// src/plugins/graph/navside/GraphPanel.tsx
const VARIANT_ICONS: Record<GraphVariant, string> = {
  knowledge: '⚛',
  mindmap: '☘',
  bpmn: '⊳',
  timeline: '⏱',
  canvas: '◫',
  basic: '○',
};

export function GraphPanel(props: NavPanelProps) {
  const ops = useGraphOperations(props);
  const nodes = ops.buildTreeNodes();

  return (
    <FolderTree
      nodes={nodes}
      selectedIds={ops.selectedIds}
      onSelectChange={ops.setSelectedIds}
      onFolderToggle={ops.toggleFolder}
      itemMeta={(item) => {
        const g = item.payload as Graph;
        return {
          icon: VARIANT_ICONS[g.variant] ?? '○',
          title: g.title,
          rightHint: relativeTime(g.updated_at),
        };
      }}
      onItemClick={(item) => ops.openGraph(item.id)}
      contextMenu={(target) => ops.buildContextMenu(target)}
      draggable
      onDrop={ops.handleDrop}
    />
  );
}
```

**新建图时的 variant 选择**：通过 ActionBar 的 `+ 新建` 按钮触发 `VariantPicker` 浮层，选中后调 `graphViewStore.create(title, null, variant)`。这部分不是 FolderTree 的事。

### 5.4 EBookPanel itemMeta 示例（按格式分图标）

```typescript
itemMeta={(item) => {
  const book = item.payload as EBook;
  const icon = book.format === 'pdf' ? '📕'
             : book.format === 'epub' ? '📗'
             : '📘';
  return { icon, title: book.title, rightHint: relativeTime(book.updated_at) };
}}
```

同插件内不同子类型用不同 icon，是**主图标即类型标记**原则的体现。

---

## 6. 数据层调整

### 6.1 graph 表新增 folder_id

```sql
-- 当前 schema:
graph: { id, title, variant, host_note_id, created_at, updated_at, meta }

-- v1.4 后:
graph: { id, title, variant, host_note_id, folder_id?: string, ... }
```

字段为可选（已有图归到根目录 = `folder_id = null`）。

### 6.2 新增 graph_folder 表

```typescript
interface GraphFolder {
  id: string;
  parent_id: string | null;  // 支持嵌套
  title: string;
  created_at: number;
  updated_at: number;
  sort_key?: number;
}
```

接口与 `note_folder` 镜像（参考实施时复用同样 IPC handler 模板）。

### 6.3 数据迁移

启动时检测 `graph` 表是否含 `folder_id` 列，无则添加（SurrealDB schemaless，实际只需 ensure schema 步骤）。已有图自动 `folder_id = null` 即归根。

### 6.4 IPC handler 增量

新增 IPC：

- `IPC.GRAPH_FOLDER_LIST` / `CREATE` / `RENAME` / `DELETE` / `MOVE`
- `IPC.GRAPH_MOVE_TO_FOLDER`（已有 graph 改 folder_id）

镜像 note 的 folder IPC（`IPC.NOTE_FOLDER_*` 已存在，参考即可）。

---

## 7. 重构步骤（实施路径）

按依赖关系分 6 个里程碑，每步独立可验证可 commit。

### M1. FolderTree 通用组件（1-2 天）

不动现有代码，**新建** `src/renderer/navside/components/FolderTree/` 完整实现 + 单元测试（最小集 mock 数据驱动）。

验收：FolderTree.tsx 在 storybook 风格的 demo 页能渲染嵌套树、拖拽、右键菜单。

### M2. NotePanel 迁移 + NavSide 精简（1-2 天）

- 新建 `src/plugins/note/navside/`：
  - `NotePanel.tsx`（消费 FolderTree）
  - `NoteItem.tsx` / `useNoteOperations.ts`（从原 hooks 拆分）
  - `register.ts`
- 改 `src/renderer/navside/renderer.tsx`：去掉 `import { NotePanel } from '...'`，改 import 注册副作用
- 改 `src/renderer/navside/NavSide.tsx`：删除 ~250 行 `contentType === 'note-list'` 硬编码，全走 `getNavPanel`
- 删除 `src/renderer/navside/hooks/useNoteOperations.ts` 和 `useDragAndDrop.ts`（已迁移）

验收：Note 工作模式下，NavSide 体验与重构前完全等价（CRUD / 拖拽 / 右键 / 排序 / 搜索）。

### M3. GraphPanel 迁移 + variant 元数据（1-2 天）

- 新建 `src/plugins/graph/navside/`：4 个标准文件
- 数据层：graph 表加 `folder_id` + 新建 `graph_folder` 表 + IPC handlers
- 删除 `src/renderer/navside/GraphPanel.tsx`
- VariantPicker：ActionBar `+ 新建` 改成下拉选变种（暂只有 `knowledge` 和 `basic`，其他变种 v1.5 加）

验收：Graph 工作模式下，可创建 / 删除 folder + graph、拖拽 graph 进 folder、按 variant 显示图标。

### M4. EBookPanel 迁移（2-3 天）

EBookPanel 812 行最大。拆分时注意：
- ebook 已有 folder 表（参考其结构是否可复用 FolderTree）
- 导入书的逻辑（DOM CustomEvent 相关）保留在 EBookPanel 内或抽 hook

验收：EBook 工作模式下，体验等价。

### M5. Web bookmarks 面板检查（半天-1 天）

`src/plugins/web/navside/` 已有 `WebPanel` / `AIServicesPanel`，但可能没用 FolderTree。决定：
- 如果有 folder 概念 → 改造为 FolderTree 消费者
- 如果是平面列表 → 不动（保持原样，FolderTree 是可选）

### M6. 验收 + 文档收尾 + push + merge main

- 跑过 4 个工作模式：Note / EBook / Graph / Web
- 确认 hooks/ 目录已清空（除通用部件）
- 写 NavSide 重构完成报告
- merge `refactor/navside-modular` → main

---

## 8. 已知风险与 fallback

### 8.1 风险

| 风险 | 影响 | 应对 |
|------|------|-----|
| FolderTree 抽象没考虑到某个插件的特殊需求（如 Note 的多选拖拽） | 实施时发现 props 不够 | 接口扩展时**只加不删**；不够的特殊能力插件自己实现，不要硬塞进 FolderTree |
| Note 重构破坏现有体验（用户每天用） | UX 回归 | M2 完成后必须人工跑过完整 CRUD 流程才能进 M3 |
| EBook 导入逻辑复杂迁移困难 | M4 卡住 | 接受 EBookPanel 内部留 200-300 行业务逻辑，FolderTree 只接管树渲染 |
| graph_folder 数据迁移失败 | 已有图无法访问 | folder_id null 兼容老数据；M3 实施前用 PoC 数据库验证迁移逻辑 |

### 8.2 fallback：分期完成

如果 6-9 天预算超支，可拆为两期：
- **v1.4**：M1 + M2 + M3 + M5（核心：FolderTree + Note/Graph 迁移 + Web 检查）
- **v1.5**：M4（EBook 单独迁移，812 行最大）

但**不允许只做 M1 而不动 M2** —— 那样 FolderTree 是死代码。

---

## 9. 与现有规范的关系

| 规范 | 关系 |
|------|------|
| `KRIG-Three-Layer-Architecture.md` | NavSide 重构是可视化层下"工作空间导航"的事，不影响三层架构原则 |
| `KRIG_GraphView_Spec_v1.3.md` | Graph variant 字段已存在；本规范增加 folder_id |
| `Graph-3D-Rendering-Impl-Report.md` § 6.1 | "已知架构债" 之 NavSide 部分由本 spec 收尾 |

memory 里的 `project_navside_arch_debt.md` 完成本 spec 后可以更新或删除。

---

## 10. 决策日志

| 日期 | 决议 | 备注 |
|------|------|------|
| 2026-04-26 | NavSide 重构作为 v1.4 第一件事（先于 KnowledgeEngine） | 用户判断"先做规划再加变种" |
| 2026-04-26 | FolderTree 设计选 B：渲染自治型，不管数据来源 | 严格分层原则 |
| 2026-04-26 | folder 表每插件独立（不统一） | 业务自治；schema 简单 |
| 2026-04-26 | graph 表加 folder_id（已有图归根） | 数据迁移成本最低 |
| 2026-04-26 | Web 面板按需迁移（不强制走 FolderTree） | 平面列表场景保留 |
| 2026-04-26 | 实施路径分 6 个里程碑（M1-M6） | 每步独立可验证 |
| 2026-04-26 | **强制统一 item 视觉布局**：移除 renderItem 逃生口，插件只提供 itemMeta | 用户反馈"统一 icon 用户一看就知道类型"——分层严格的更彻底落实 |
| 2026-04-26 | folder icon 跨插件统一 📁，插件不可覆盖 | 同上 |
| 2026-04-26 | item icon = 类型标记：同插件不同子类型用不同 icon | 用户视觉直觉 = 看图识类型 |

---

## 附录 A：命名约定

| 名字 | 用途 |
|------|------|
| `FolderTree` | 通用树组件，框架层 |
| `TreeNode` / `FolderNode` / `ItemNode` | FolderTree 数据契约 |
| `ItemMeta` | item 视觉元数据契约（icon / title / rightHint） |
| `<Plugin>Panel` | 插件面板入口（如 NotePanel / GraphPanel） |
| `use<Plugin>Operations` | 插件业务 hook |
| `itemMeta` | 插件 prop 函数：`(ItemNode) => ItemMeta` |

---

**Spec 完。待用户评审通过后启动 M1。**
