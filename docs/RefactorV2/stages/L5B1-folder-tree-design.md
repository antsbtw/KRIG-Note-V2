# L5-B1 文件夹树 + 完整 NavSide 实施设计 v0.1

> **范围**:NoteView NavSide 升级到 V1 NotePanel 同款体验 — 文件夹树 + 嵌套展开 + 拖拽 + 双击重命名 + 多选批删 + 剪贴板 + 完整右键菜单 + 键盘快捷键。
> **不在范围**:driver marks(留 L5-B2) / undo-redo 真实现(留 L5-B2) / dnd block-handle(留 L5-B3) / multi-envelope clipboard(留 L5-B3) / 笔记搜索过滤。
>
> **协议依据**:
> - L4 NavSideRegistry / 五大交互 Registry 协议
> - L5-A 全局 noteStore + per-workspace activeNoteId 架构
>
> 文档版本:v0.1
> 编写日期:2026-05-05
> 上下文:L5-B1 实施前的最终设计稿(用户拍板 Q1-Q7 7 项决策)

---

## 0. 上下文

### 0.1 V1 实际功能盘点(已调研)

V1 NavSide 树状面板由 4 段构成,共 ~570 行:
- `src/renderer/navside/components/FolderTree/` — 框架层通用树组件(FolderTree.tsx + ContextMenu.tsx + styles.ts + types.ts)
- `src/plugins/note/navside/NotePanel.tsx` — 装配组件
- `src/plugins/note/navside/useNoteOperations.ts` — 业务 hook(树构建 / CRUD / 拖拽 / 排序 / 重命名 / 剪贴板 / 键盘)
- `src/plugins/note/navside/useNoteSync.ts` — 数据订阅

L5-B1 全套对标 V1(用户要求 "UI 式样 1:1 复刻")。

### 0.2 与 L5-A 的差异

| 维度 | L5-A(已有) | L5-B1 |
|---|---|---|
| 数据模型 | 单层 notes 列表 | folders + notes 双实体 + 嵌套树 |
| 列表组件 | 简单 ul/li | FolderTree 通用树组件 |
| 持久化 | localStorage `krig.notes` | + localStorage `krig.folders`(新增) |
| 选中态 | 单选(activeNoteId) | 多选(selectedIds Set) + activeNoteId 单一只读 |
| 展开态 | 无 | per-workspace `expandedFolders: Set<id>` |
| 重命名 | 无显式 UI(标题自动从首段派生) | 双击 / F2 → inline input |
| 排序 | 固定按 updatedAt desc | 每文件夹独立(标题/日期 升降) |
| 拖拽 | 无 | 笔记进文件夹 / 文件夹换 parent |
| 剪贴板 | 无 | 右键复制 / 粘贴 |
| 右键菜单 | 仅 confirm() 删除 | 完整菜单(空白处 / item / folder 三套) |
| 键盘 | 无 | Delete / F2 / Enter / 方向键 |

### 0.3 用户拍板的 7 项决策(已锁定)

| Q | 决策 | 含义 |
|---|---|---|
| Q1 | A | FolderTree 提到框架层(`src/slot/shared-ui/FolderTree/`),为未来其他 view 复用 |
| Q2 | A | 独立 `folderStore`(localStorage `krig.folders`),跟 noteStore 平级 |
| Q3 | A | `expandedFolders` per-workspace(挂在 WorkspaceState) |
| Q4 | B | 不引入 V1 的 `sort_order` 字段(死字段);只按 title / updatedAt 排序 |
| Q5 | B | view 直接 import store,不抽 navSideAPI 抽象层(YAGNI) |
| Q6 | A | 沿用 L5-A 的 actions 绑 command,不引入 V1 的 `navside:action` event |
| Q7 | 方案 2 | `folderTreeContextMenuRegistry` 注册制 + 共用 `ContextMenuPopover` 浮层组件 |

---

## 1. 模块物理布局

### 1.1 框架层新增(`src/slot/`)

```
src/slot/shared-ui/                                     ← 新建顶级目录
├── README.md
├── FolderTree/                                         ← 通用树组件(框架层 — Q1=A)
│   ├── FolderTree.tsx
│   ├── types.ts
│   ├── styles.ts                                       ← V1 styles 1:1 搬过来
│   └── index.ts
└── ContextMenuPopover/                                 ← 通用右键菜单浮层(Q7=方案 2 共用)
    ├── ContextMenuPopover.tsx
    ├── types.ts
    └── index.ts

src/slot/nav-side-registry/                             ← 已有,新增子模块
├── (已有文件)
└── folder-tree-context-menu-registry.ts                ← 新增(Q7=方案 2 注册制)
```

### 1.2 view 层升级(`src/views/note/`)

```
src/views/note/
├── (L5-A 已有)
├── note-store.ts                                       ← 已有
├── folder-store.ts                                     ← 新增(Q2=A 独立 store)
├── data-model.ts                                       ← 升级(per-workspace 加 expandedFolders / selectedIds)
├── nav-side-content.tsx                                ← 升级(用 FolderTree 替代 NoteList)
├── note-list.tsx                                       ← 删除(被 FolderTree 替代)
├── tree-builder.ts                                     ← 新增(notes + folders + sort + expanded → TreeNode[])
├── tree-operations.ts                                  ← 新增(拖拽业务 / 多选 / 剪贴板;V1 useNoteOperations 同款职责)
├── note-commands.ts                                    ← 升级(加 folder.* 命令 + view 命名空间命令)
├── context-menu-registrations.ts                       ← 新增(向 folderTreeContextMenuRegistry 注册菜单项)
└── note.css                                            ← 已有
```

预估总文件数变化:+10 文件(框架 6 + view 4),-1 文件(note-list.tsx 删)。

---

## 2. 核心数据契约

### 2.1 Folder 类型(views/note/folder-store.ts)

```ts
export interface Folder {
  id: string;                          // 'folder-1' / 'folder-2'(全局递增 counter)
  title: string;
  parentId: string | null;             // null = 根级
  createdAt: number;
  updatedAt: number;                   // 重命名 / 子项变更时更新
}

interface FolderStoreData {
  folders: Record<string, Folder>;
  counter: number;
}
```

### 2.2 Note 升级(views/note/note-store.ts)

```ts
export interface Note {
  id: string;
  title: string;
  doc: DriverSerialized;
  folderId: string | null;             // ← 新增,null = 根级(L5-A 笔记 migration 时填 null)
  createdAt: number;
  updatedAt: number;
}
```

### 2.3 NoteWsState 升级(views/note/data-model.ts)

```ts
export interface NoteWsState {
  activeNoteId: string | null;         // L5-A 已有
  expandedFolders: Set<string>;        // ← 新增(Q3=A per-workspace)
  selectedIds: Set<string>;            // ← 新增(per-workspace 多选;含 'n:xxx' / 'f:xxx' 前缀编码)
  folderSortMap: Record<string, SortState>;  // ← 新增(每文件夹独立排序;'__root__' 作为根 key)
  clipboard: { type: 'note' | 'folder'; id: string } | null;  // ← 新增(右键复制/粘贴)
}

type SortState = 'title-asc' | 'title-desc' | 'date-asc' | 'date-desc' | null;
```

**注意**:Set 类型不能直接 JSON.stringify — `expandedFolders` / `selectedIds` 持久化时序列化为 `string[]`,反序列化时还原成 Set。L3 持久化机制需要支持 — 在 data-model 内做编码/解码,workspaceManager 不感知。

### 2.4 TreeNode id 编码

跟 V1 一致:
- folder: `'f:<folderId>'`
- note: `'n:<noteId>'`

decode helper 在 `tree-builder.ts` 内。

---

## 3. 框架层组件设计

### 3.1 FolderTree(`src/slot/shared-ui/FolderTree/`)

**1:1 搬迁 V1**(`src/renderer/navside/components/FolderTree/`),修改点:
- types.ts `ContextMenuItem` 删掉 `onClick` 字段(走 registry),保留 `command` 字段(命令字符串)
- types.ts `FolderTreeProps` 加 `contextMenuScope?: string`(view-id,默认无 scope 时不显菜单)
- FolderTree.tsx 内部不再调 props.contextMenu callback;改成查 `folderTreeContextMenuRegistry.getItems(scope, target, ctx)`
- 菜单浮层从内置 ContextMenu.tsx 改为 import `ContextMenuPopover`

**API**(完整 props):
```ts
interface FolderTreeProps {
  nodes: TreeNode[];
  selectedIds: Set<string>;
  onSelectChange: (ids: Set<string>) => void;
  onFolderToggle: (folderId: string, expanded: boolean) => void;
  itemMeta: (item: ItemNode) => ItemMeta;
  onItemClick?: (item: ItemNode, e: React.MouseEvent) => void;
  onItemDoubleClick?: (item: ItemNode) => void;
  draggable?: boolean;
  onDrop?: (draggedIds: string[], targetFolderId: string | null) => void;
  onKeyAction?: (action: KeyAction, target: TreeNode) => void;
  /** 重命名受控 */
  renamingId?: string | null;
  renamingValue?: string;
  onRenamingChange?: (value: string) => void;
  onRenameCommit?: (id: string) => void;
  onRenameCancel?: () => void;
  /** 右键菜单 scope(走 registry,Q7) */
  contextMenuScope?: string;
  /** 业务向 registry 提供的额外 ctx(用于 enabledWhen 判断) */
  contextMenuCtx?: () => FolderTreeContextInfo;
  emptyText?: string;
}
```

视觉常量(styles.ts)1:1 搬 V1:
```
TREE_ROW_HEIGHT = 28
TREE_INDENT_PX = 16
row.color = '#ccc' / row.fontSize = 13 / row.height = 28
rowHover.background = 'rgba(255,255,255,0.05)'
rowSelected.background = 'rgba(74, 144, 226, 0.25)' / color = '#fff'
rowDropTarget.background = 'rgba(74, 144, 226, 0.18)' / outline dashed
caret.fontSize = 10 / icon.fontSize = 14 / rightHint.fontSize = 10
contextMenu.background = 'rgba(30,30,30,0.98)' / minWidth = 140
```

### 3.2 ContextMenuPopover(`src/slot/shared-ui/ContextMenuPopover/`)

通用浮层 — 接收一个菜单项数组 + 锚点位置,渲染。1:1 搬迁 V1 ContextMenu.tsx:
- 边界翻转(useLayoutEffect 测量 + 翻转)
- mousedown 外部 / Esc 关闭
- separator / disabled / icon / hover 视觉

**API**:
```ts
interface ContextMenuPopoverProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

interface ContextMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  separator?: boolean;
  disabled?: boolean;
  /** 命令字符串(优先) */
  command?: string;
  commandArg?: unknown;
  /** 或本地 onClick(适合一次性闭包,如剪贴板的 target id) */
  onClick?: () => void;
}
```

### 3.3 folderTreeContextMenuRegistry(`src/slot/nav-side-registry/`)

```ts
export interface FolderTreeContextInfo {
  scope: string;                       // view-id(注册时筛选)
  target: 'item' | 'folder' | 'blank';
  targetId: string | null;             // 'n:xxx' / 'f:xxx' / null(blank)
  isMulti: boolean;
  selectedCount: number;
  hasClipboard: boolean;
  // 业务可在 contextMenuCtx 里挂额外字段(folderSortMap 等),但 type 不 narrow
  extra?: Record<string, unknown>;
}

export interface FolderTreeMenuRegistration {
  id: string;                                        // 'note-view.folder-tree.rename' 等
  scope: string;                                     // view-id('note-view')
  appliesTo: ('item' | 'folder' | 'blank')[];        // 多选
  label: string | ((ctx: FolderTreeContextInfo) => string);   // 函数形式支持动态 label(如 "删除 3 项")
  icon?: string;
  separator?: boolean;
  disabled?: boolean | ((ctx: FolderTreeContextInfo) => boolean);
  enabledWhen?: (ctx: FolderTreeContextInfo) => boolean;       // 不满足则不显示
  /** 命令字符串(优先;能跟 commandRegistry 解耦) */
  command?: string;
  commandArg?: unknown | ((ctx: FolderTreeContextInfo) => unknown);
  /** 或 onSelect(回调持有 ctx,适合 clipboard / 多选删除等动态业务) */
  onSelect?: (ctx: FolderTreeContextInfo) => void;
  /** 排序 */
  order?: number;
}

class FolderTreeContextMenuRegistry {
  register(reg: FolderTreeMenuRegistration): void;
  unregister(id: string): void;
  getItems(scope: string, ctx: FolderTreeContextInfo): ContextMenuItem[];
  // 内部按 appliesTo 过滤,enabledWhen 过滤,按 order 排序,
  // 解析 label/disabled/commandArg(函数形式 → 调用),
  // 转成 ContextMenuItem[] 给浮层组件
}
```

**注册时机**:view 在 `index.ts` self-register 时调 `registerContextMenuItems()`(同 registerNoteCommands / registerNavSide 模式)。

---

## 4. view 层实施

### 4.1 folder-store.ts(全局 folder store)

跟 note-store.ts 同款模式:
- `Object.freeze` DEFAULT_STATE
- 持久化键 `krig.folders`
- localStorage load/save
- subscribe / getAll / get / create / update / delete API
- L5-A 笔记的 migration:首次启动若 localStorage 没 `krig.folders`,初始化空 store(L5-A 已有的笔记 folderId=null 自然落根)

新增 API:
```ts
folderStore.create(title: string, parentId: string | null): string;
folderStore.update(id, patch: Partial<Folder>): void;
folderStore.delete(id): void;          // ⚠️ 级联:子文件夹一并删,所属笔记 folderId → null(不删笔记)
folderStore.move(id, newParentId): void;  // 重 parent;防环已在 tree-operations 校验
folderStore.getDescendants(id): string[];  // 递归子文件夹 id(级联用)
```

**级联删除策略**(V1 同款):
- 删 folder X → X 的所有子 folder 递归删除
- X 及子文件夹下的所有 note → folderId 重置为 null(笔记不删,落根级)

### 4.2 data-model.ts 升级

```ts
const DEFAULT_WS_STATE: NoteWsState = Object.freeze({
  activeNoteId: null,
  expandedFolders: new Set<string>(),       // ⚠️ Set 不能 freeze 内部
  selectedIds: new Set<string>(),
  folderSortMap: Object.freeze({}),
  clipboard: null,
}) as NoteWsState;
```

**Set 持久化解决方案**:
- workspaceManager.update 时,data-model 内 helper 把 Set 转成 string[] 写入 pluginStates:
  ```
  pluginStates['note'] = {
    activeNoteId,
    expandedFoldersArr: Array.from(expandedFolders),
    selectedIdsArr: Array.from(selectedIds),
    folderSortMap,
    clipboard,
  }
  ```
- getNoteWsState 读取时 hydrate(string[] → Set)
- helper 函数:`encodeWsState(state) / decodeWsState(raw)`(在 data-model.ts 内,view 业务无感)

### 4.3 tree-builder.ts(纯函数,不持有 state)

输入 noteList + folderList + expandedFolders + folderSortMap → 输出 TreeNode[]。

```ts
export function buildTreeNodes(args: {
  notes: Note[];
  folders: Folder[];
  expandedFolders: Set<string>;
  folderSortMap: Record<string, SortState>;
}): TreeNode[] {
  const buildChildren = (parentId: string | null): TreeNode[] => {
    const sortedFolders = sortFolders(folders.filter(f => f.parentId === parentId), folderSortMap[parentId ?? '__root__']);
    const sortedNotes = sortNotes(notes.filter(n => n.folderId === parentId), folderSortMap[parentId ?? '__root__']);
    return [
      ...sortedFolders.map(f => ({
        kind: 'folder',
        id: `f:${f.id}`,
        parentId: parentId ? `f:${parentId}` : null,
        title: f.title,
        expanded: expandedFolders.has(f.id),
        children: buildChildren(f.id),
      })),
      ...sortedNotes.map(n => ({
        kind: 'item',
        id: `n:${n.id}`,
        parentId: parentId ? `f:${parentId}` : null,
        payload: n,
      })),
    ];
  };
  return buildChildren(null);
}

export function decodeTreeId(id: string): { type: 'note' | 'folder'; id: string };
export function encodeFolderId(id: string): string;
export function encodeNoteId(id: string): string;
```

排序逻辑(V1 同款):
- title-asc/desc:localeCompare 'zh-CN'
- date-asc/desc:updatedAt(note)/ createdAt(folder)
- 默认 fallback:folder 按 title-asc / note 按 updatedAt-desc

### 4.4 tree-operations.ts(业务操作 hook,V1 useNoteOperations 对应)

不再以 hook 形式存在;改为**纯函数集合**,因为大部分业务能通过 commandRegistry 调用 + per-ws state 修改完成。仅 hook 化的部分(rename inline state)留 NavSide 组件内部 useState。

```ts
// 拖拽业务
export function handleDrop(wsId: string, draggedIds: string[], targetFolderId: string | null): void;
export function isDescendantFolder(parentId: string, candidateChildId: string): boolean;

// 多选 / 选中态
export function setSelectedIds(wsId: string, ids: Set<string>): void;
export function getSelectedIds(wsId: string): Set<string>;

// 展开
export function setFolderExpanded(wsId: string, folderId: string, expanded: boolean): void;

// 排序
export function setFolderSort(wsId: string, folderKey: string, sort: SortState): void;
export function cycleSortByTitle(wsId: string, folderKey: string): void;
export function cycleSortByDate(wsId: string, folderKey: string): void;

// 剪贴板
export function setClipboard(wsId: string, type: 'note' | 'folder', id: string): void;
export function pasteClipboard(wsId: string, targetFolderId: string | null): void;
// note 粘贴:复制 doc + 标题前缀 "副本"
// folder 粘贴:复制 folder 树 + 内含笔记一律复制(深拷贝)
// 防环:粘贴 folder 到自己子树时拒绝

// 批量删除
export function deleteSelected(wsId: string): void;
```

### 4.5 note-commands.ts 升级

L5-A 已有 3 命令;L5-B1 加 view 命名空间命令:

```ts
// view 命名空间(可被菜单 command 字段引用)
'note-view.create-note'           // L5-A 已有(参数 folderId 加可选)
'note-view.create-folder'         // 新增(参数 parentId)
'note-view.rename-active'         // 新增(对当前 selectedIds 单一项触发重命名)
'note-view.delete-active'         // L5-A 已有(改:支持多选)
'note-view.set-active'            // L5-A 已有
'note-view.copy'                  // 新增(右键复制 — 拿 selectedIds 单一项写 clipboard)
'note-view.paste'                 // 新增(粘贴 — 当前文件夹或 selected folder 内)
'note-view.toggle-expand-active'  // 新增(F2 同款触发?暂定 ←/→ 键直接 onKeyAction)
'note-view.sort-cycle-title'      // 新增(空白菜单"按标题排序"循环)
'note-view.sort-cycle-date'       // 新增(空白菜单"按日期排序"循环)
```

实施时部分命令需要 commandArg(folderId / parentId 等),由菜单 commandArg 函数提供。

### 4.6 context-menu-registrations.ts(注册菜单项)

按 V1 useNoteOperations.buildContextMenu 同款菜单项,注册到 `folderTreeContextMenuRegistry`,scope='note-view'。

#### 空白处右键(appliesTo: ['blank'])

```ts
register({ id: 'note-view.fl-blank.new-note', scope: 'note-view', appliesTo: ['blank'],
  label: '新建笔记', icon: '📄', command: 'note-view.create-note', order: 10 });
register({ id: 'note-view.fl-blank.new-folder', scope: 'note-view', appliesTo: ['blank'],
  label: '新建文件夹', icon: '📁', command: 'note-view.create-folder', order: 20 });
register({ id: 'note-view.fl-blank.sep1', scope: 'note-view', appliesTo: ['blank'],
  separator: true, label: '', order: 30 });
register({ id: 'note-view.fl-blank.sort-title', scope: 'note-view', appliesTo: ['blank'],
  label: (ctx) => formatSortLabel('按标题排序', ctx.extra?.sortMap, '__root__', 'title'),
  command: 'note-view.sort-cycle-title', commandArg: () => '__root__', order: 40 });
register({ id: 'note-view.fl-blank.sort-date', scope: 'note-view', appliesTo: ['blank'],
  label: (ctx) => formatSortLabel('按日期排序', ctx.extra?.sortMap, '__root__', 'date'),
  command: 'note-view.sort-cycle-date', commandArg: () => '__root__', order: 50 });
```

#### folder 右键(appliesTo: ['folder'])

```ts
register({ id: 'note-view.fl-folder.new-note-in', scope: 'note-view', appliesTo: ['folder'],
  label: '在此新建笔记', icon: '📄',
  command: 'note-view.create-note',
  commandArg: (ctx) => decodeTreeId(ctx.targetId!).id, order: 10 });
register({ id: 'note-view.fl-folder.new-folder-in', ...);  // 同理
register({ id: 'note-view.fl-folder.sep1', appliesTo:['folder'], separator: true, ...);
// 下面 rename / copy / paste / delete 在 ['item','folder'] 都注册
```

#### item / folder 通用(appliesTo: ['item', 'folder'])

```ts
register({ id: 'note-view.fl.rename', scope: 'note-view', appliesTo: ['item', 'folder'],
  label: '重命名', icon: '✎',
  disabled: (ctx) => ctx.isMulti,
  onSelect: (ctx) => triggerRenameInline(ctx.targetId!),  // 跟 NavSide 局部 state 联动
  order: 100 });
register({ id: 'note-view.fl.copy', scope: 'note-view', appliesTo: ['item', 'folder'],
  label: '复制', icon: '📋', disabled: (ctx) => ctx.isMulti,
  onSelect: (ctx) => copySelected(ctx), order: 110 });
register({ id: 'note-view.fl.paste', scope: 'note-view', appliesTo: ['folder'],
  label: '粘贴', icon: '📌',
  enabledWhen: (ctx) => ctx.hasClipboard,
  command: 'note-view.paste',
  commandArg: (ctx) => decodeTreeId(ctx.targetId!).id, order: 120 });
register({ id: 'note-view.fl.sep2', appliesTo:['item','folder'], separator: true, order:200 });
register({ id: 'note-view.fl.delete', scope: 'note-view', appliesTo: ['item', 'folder'],
  label: (ctx) => ctx.isMulti ? `删除 ${ctx.selectedCount} 项` : '删除', icon: '🗑',
  command: 'note-view.delete-active', order: 210 });
```

`triggerRenameInline` 和 NavSide 局部 state 之间的耦合:NavSide 组件持有 renameTarget setState,通过 module 级 `currentRenameSetter` 引用(参考 L5-A driver instance-registry 同款模式)。

### 4.7 nav-side-content.tsx 重写

L5-A 用 `<NoteList>`;L5-B1 改用 `<FolderTreePanel>`(view 内的装配组件):

```tsx
import { FolderTree } from '@slot/shared-ui/FolderTree';
import { folderTreeContextMenuRegistry } from '@slot/nav-side-registry/folder-tree-context-menu-registry';

function FolderTreePanel() {
  const wsId = useActiveWorkspaceId();
  const ws = useWorkspace(wsId);
  const wsState = ws ? getNoteWsState(ws) : null;
  const allNotes = useSyncExternalStore(noteStore.subscribe, noteStore.getAll);
  const allFolders = useSyncExternalStore(folderStore.subscribe, folderStore.getAll);

  // 重命名局部 state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  if (!wsId || !ws || !wsState) return null;

  const nodes = buildTreeNodes({
    notes: Object.values(allNotes),
    folders: Object.values(allFolders),
    expandedFolders: wsState.expandedFolders,
    folderSortMap: wsState.folderSortMap,
  });

  return (
    <FolderTree
      nodes={nodes}
      selectedIds={wsState.selectedIds}
      onSelectChange={(ids) => setSelectedIds(wsId, ids)}
      onFolderToggle={(fid, exp) => setFolderExpanded(wsId, decodeTreeId(fid).id, exp)}
      itemMeta={(item) => ({
        icon: '📄',
        title: (item.payload as Note).title || '未命名',
        rightHint: relativeTime((item.payload as Note).updatedAt),
      })}
      onItemClick={(item) => {
        const noteId = decodeTreeId(item.id).id;
        commandRegistry.execute('note-view.set-active', noteId);
      }}
      onItemDoubleClick={(item) => { setRenamingId(item.id); setRenameValue((item.payload as Note).title); }}
      draggable
      onDrop={(ids, targetFid) => handleDrop(wsId, ids, targetFid ? decodeTreeId(targetFid).id : null)}
      onKeyAction={(action, target) => handleKeyAction(wsId, action, target, setRenamingId, setRenameValue)}
      renamingId={renamingId}
      renamingValue={renameValue}
      onRenamingChange={setRenameValue}
      onRenameCommit={(id) => commitRename(id, renameValue, () => setRenamingId(null))}
      onRenameCancel={() => setRenamingId(null)}
      contextMenuScope="note-view"
      contextMenuCtx={() => ({
        scope: 'note-view',
        target: ..., targetId: ..., isMulti: wsState.selectedIds.size > 1,
        selectedCount: wsState.selectedIds.size,
        hasClipboard: !!wsState.clipboard,
        extra: { sortMap: wsState.folderSortMap },
      })}
      emptyText="暂无笔记 — 右键创建"
    />
  );
}

export function registerNavSide() {
  navSideRegistry.register({
    view: 'note-view',
    title: '笔记目录',
    actions: [
      { id: 'create-note', label: '+ 笔记', command: 'note-view.create-note' },
      { id: 'create-folder', label: '+ 文件夹', command: 'note-view.create-folder' },
    ],
    searchPlaceholder: '搜索笔记...',
    onSearch: () => {/* 留 L5-B+ */},
    contentRenderer: () => <FolderTreePanel />,
  });
}
```

`triggerRenameInline` 通过 module 级 setter 引用桥接 onSelect → NavSide 局部 setState。

---

## 5. 完成判据(15 条)

| # | 判据 | 验证方式 |
|---|---|---|
| 1 | npm run typecheck + lint 全过 | 命令验证 |
| 2 | NavSide "+ 文件夹" 按钮创建空文件夹,出现在树根 | 视觉 |
| 3 | 双击文件夹 / item 进入 inline rename;Enter 提交,Esc 取消,blur 提交 | 视觉 + 键盘 |
| 4 | 单击 folder row 切换展开/折叠;箭头单击同效果 | 视觉 |
| 5 | folder 内 "+ 笔记" 右键项创建笔记到 folder,自动展开 | 视觉 |
| 6 | 拖一笔记进 folder → folderId 改;视觉 row 进入 folder 子层 | 视觉 + DevTools 检查 noteStore |
| 7 | 拖 folderA 进 folderB → parentId 改;**拖到自己子树时被拒** | 视觉 |
| 8 | 多选(Cmd 单点 toggle / Shift 范围选)→ Delete 批量删 | 视觉 |
| 9 | 右键复制 note → 右键 folder 选粘贴 → 笔记复制(标题"副本"前缀) | 视觉 |
| 10 | 空白处右键"按标题排序"循环 asc/desc;同样"按日期排序"独立 | 视觉 |
| 11 | 每文件夹独立排序(folder A 按标题排,folder B 按日期排,互不影响) | 视觉 |
| 12 | 键盘:↑↓ 移焦点,←/→ 折/展 folder,Enter 打开 note,F2 重命名,Delete 删 | 键盘 |
| 13 | 多 Workspace 切换:笔记/文件夹数据共享(全局),展开/选中态独立(per-ws) | 视觉 |
| 14 | 删除 folder → 子 folder 级联删,内含笔记 folderId → null 落根 | 视觉 + DevTools |
| 15 | 重启 app 后笔记/文件夹/展开态/排序均恢复(localStorage 持久化) | 重启验证 |

---

## 6. 实施顺序(估算)

| Step | 内容 | 估算 |
|---|---|---|
| 1 | 框架层:`src/slot/shared-ui/FolderTree/` + `ContextMenuPopover/`(1:1 搬 V1 + Q7 改造) | ~280 行 |
| 2 | `folderTreeContextMenuRegistry` + 测试单注册路径 | ~80 行 |
| 3 | view 层:folder-store.ts | ~120 行 |
| 4 | data-model.ts 升级(Set 编码/解码 + 默认值)| ~80 行 |
| 5 | tree-builder.ts | ~60 行 |
| 6 | tree-operations.ts(拖拽 / 选中 / 排序 / 剪贴板) | ~180 行 |
| 7 | note-commands.ts 升级(8 个新命令)| ~120 行 |
| 8 | context-menu-registrations.ts(注册菜单项)| ~120 行 |
| 9 | nav-side-content.tsx 重写 + FolderTreePanel | ~120 行 |
| 10 | note.css 微调 / 删 note-list.tsx | ~10 行 |

**合计 ~1170 行新增**(L5-B1 单子阶段量级,跟 L5-A 体量相当)。

---

## 7. 风险 + 开放问题

### 7.1 Set 序列化策略(已定:hydrate 在 data-model.ts 内做)

L3 pluginStates 持久化是泛型 — 不知道 Set。data-model.ts 内 encodeWsState / decodeWsState 在 workspace 级别托底,view 业务拿到的 state 直接是带 Set 的合法对象。

### 7.2 重命名 state 跨注册边界(triggerRenameInline)

菜单 onSelect 回调要触发 NavSide 局部 useState — 通过 module 级 setter 引用桥接(参考 L5-A driver instance-registry)。如果未来多 NavSide 实例(不太可能 — view 单例),需要按 wsId scope 化。

### 7.3 拖拽防环 — 是否在 FolderTree 还是 tree-operations?

V1 是在业务层(useNoteOperations.handleDrop 内 isDescendantFolder)。V2 沿用:`handleDrop(wsId, ...)` 内调 `isDescendantFolder`,FolderTree 不感知业务。

### 7.4 selectedIds 持久化必要性

V1 selectedIds 是 transient state(关闭 app 重启后清空)。V2:**默认持久化**(对齐"per-workspace 工作状态"原则,用户重启后回到上次选中);如果实测体验糟(重启后选中态干扰新操作),改为 transient(只存内存)。L5-B1 实施时实测决定。

### 7.5 排序 fallback

V1 默认 folder 按 sort_order asc / note 按 title asc。V2 没 sort_order:
- folder 默认按 title-asc
- note 默认按 updatedAt-desc(L5-A 保持)

### 7.6 命令 commandArg 函数化

用户拍板的 Q5=B 之外没明确;但 menu 项 command 的 arg 经常依赖 ctx(targetId / folderId 等),`commandArg: (ctx) => any` 函数形式必要。registry 内统一处理。

### 7.7 emptyText 在有文件夹但无笔记时显不出

FolderTree 的 emptyText 只在 visibleRows.length === 0 时显;有 folder 没 note 时不空。V1 同款,符合预期。

### 7.8 重命名时正在拖拽?

V1 不互斥(理论上能同时);实测 V1 也没踩坑(拖拽 mousedown 在 row,rename input 在 row 内独立 handler)。沿用 V1。

---

## 8. L5-B2 / B3 增量预告(本阶段不实施)

### 8.1 L5-B2(driver marks + undo-redo)

- driver 加 marks(bold/italic/strike/code)+ marks keymap
- view 命名空间 `note-view.toggle-bold` / `set-heading-level` / `toggle-list` 等命令
- driver 加 prosemirror-history 真 undo-redo
- 加 input-rules

### 8.2 L5-B3(dnd block-handle + multi-envelope clipboard)

- driver 加 block-handle 拖动手柄
- multi-envelope clipboard + paste dispatcher(L4 capability 协议真用)

---

## 9. 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-05-05 | v0.1 | 初稿;7 项决策(Q1-Q7)拍板锁定;实施清单 ~1170 行;15 条完成判据 |
