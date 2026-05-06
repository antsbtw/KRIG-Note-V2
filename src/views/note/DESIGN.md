# NoteView L5-A 实施设计 v0.2

> **本文档是 v0.1 的整体重写**(driver 架构落地后)。v0.1 按"动作类型 capability"思路写,v0.2 按 v0.5 设计(driver + capability 分层 + block 自治)重写。
>
> **范围**:L5-A — 完整笔记 CRUD + 单层列表 + textBlock 编辑 + pluginStates 持久化。
>
> **协议依据**:
> - [drivers/COMMON-DRIVER-PROTOCOL.md](../../drivers/COMMON-DRIVER-PROTOCOL.md) v0.2(driver 协议)
> - [drivers/text-editing-driver/DESIGN.md](../../drivers/text-editing-driver/DESIGN.md) v0.1(driver 实施设计)
> - [drivers/text-editing-driver/BLOCK-SPEC.md](../../drivers/text-editing-driver/BLOCK-SPEC.md) v0.1(block 子协议)
> - [capabilities/COMMON-PROTOCOL.md](../../capabilities/COMMON-PROTOCOL.md) v0.3(5 capability 协议)
>
> 文档版本:v0.2
> 编写日期:2026-05-05
> 上下文:L5-A 实施前的最终 view 设计

---

## 0. 上下文 + 范围

### 0.1 NoteView 在 V2 架构中的位置

按 charter § 1.4:**view 是能力组合声明,不是实体**。NoteView:
- **声明**:install 一组 capability + 装配一个 driver(text-editing-driver)
- **管理**:笔记业务(CRUD / 列表 / 标题派生 / 持久化)
- **不管理**:PM 装配(driver 的事)/ 5 capability 内部协作(它们自己跑协议)

### 0.2 L5-A 完整范围(用户拍板 Q-N4=A)

- ✅ NoteView 注册到 viewTypeRegistry(install 6 项 — 5 capability + 1 driver)
- ✅ 笔记数据模型(`pluginStates['note']` per-workspace 隔离)
- ✅ 笔记 CRUD(创建 / 删除 / 切换活跃笔记)
- ✅ NavSide 单层笔记列表(无文件夹树)
- ✅ "+笔记"按钮 + 命令注册
- ✅ ContextMenu "新建笔记"项
- ✅ 标题自动派生(从 PM doc 第一段提取,Q13=B)
- ✅ pluginStates 持久化(L3 接口)
- ✅ NoteView 渲染编辑器(用 textEditingDriver.Host)

### 0.3 不实施(L5-A 严格)

- ❌ 文件夹树(L5-B)
- ❌ 笔记搜索过滤(L5-A 占位 onSearch,不实施过滤逻辑)
- ❌ 行内链接 noteLink(L5-C)
- ❌ Toolbar 内容(L4 占位,L5-B+ 加格式化按钮)
- ❌ 笔记重命名 UI(L5-A 标题自动派生,不需要显式 UI)
- ❌ 多选 / 拖动笔记到文件夹(L5-B)
- ❌ AI / Web 抓取 / 等业务(L6+)

### 0.4 V1 NoteView 学习参考

V1 `src/plugins/note/components/NoteView.tsx`(975 行)做的事比 L5-A 多很多:
- Toolbar(后退/前进/保存/书签)— L5-A 不实施(留 L5-B+)
- AI Sync / 锚定同步 / 双 slot 通信 — 留 L6+
- 阅读位置恢复 / 书签持久化 — 留 L5-B+
- 'noteOpenInRightSlot' / 'sendToOtherSlot' / 等业务 — 用 L3.5 bus 替代,留 L5-C

L5-A 学习 V1 的:**笔记 CRUD 模式 / pluginStates 持久化 / NavSide 列表**。**不学习** V1 的复杂业务和散落状态。

---

## 1. NoteView 装配形态

### 1.1 view 注册(viewTypeRegistry)

```ts
// src/views/note/index.ts(self-register on import)
import { registerView } from '@slot/view-type-registry';
import { NoteView } from './NoteView';
import { registerNoteCommands } from './note-commands';
import { registerNavSide } from './nav-side-content';

registerView({
  id: 'note-view',
  install: [
    // 5 通用 capability
    'selection',
    'clipboard',
    'undo-redo',
    'drag-and-drop',
    'insertion',
    // driver(Q-N1=B 决策:driver 也写进 install 列表,声明性完整)
    'text-editing-driver',
  ],
  component: NoteView,
  navSideTab: { label: 'Note', icon: '📝', order: 1 },
  contextMenu: [
    {
      id: 'note-view.create-note',
      label: '新建笔记',
      command: 'note-view.create-note',
      enabledWhen: () => true,
    },
  ],
});

registerNoteCommands();
registerNavSide();
```

### 1.2 install 列表的语义(铁律澄清)

按 driver 协议铁律 + Q-N1=B 决策:**install 列表声明 view 用了哪些 capability + driver,完整可见**。

| 项 | 性质 | view 怎么用 |
|---|---|---|
| `selection` | capability | 通过 channel 订阅 + api 纯读 |
| `clipboard` | capability | 通过 channel 订阅 + api 纯读 |
| `undo-redo` | capability | 通过 channel 订阅 + api 纯读 |
| `drag-and-drop` | capability | 通过 channel 订阅 + api 纯读 |
| `insertion` | capability | 通过 channel 订阅 + api 纯读 |
| `text-editing-driver` | driver | 通过 React 组件(`textEditingDriver.Host`)装配 |

**两类 install 在协议层平等(都是依赖声明),但运行时使用方式不同**。

---

## 2. NoteView 模块结构

### 2.1 物理目录(L5-A)

```
src/views/note/
├── DESIGN.md                  ← 本文件
├── README.md                  ← view 总览(L5-A 实施时写)
├── index.ts                   ← self-register 入口(import 触发副作用)
├── NoteView.tsx               ← view 主组件(渲染 driver Host)
├── data-model.ts              ← Note 类型 + pluginStates helper
├── note-commands.ts           ← commandRegistry 命令注册
├── nav-side-content.tsx       ← NavSide 内容(列表 + 创建按钮)
├── note-list.tsx              ← 笔记列表 React 子组件
└── note.css                   ← view 样式
```

L5-A 文件总数 ~8-9 个,跟 driver(~10 文件)对称。

### 2.2 渲染 / 注册入口

`src/platform/renderer/index.tsx` 加一行:
```ts
import '@views/note';   // ← self-register 触发副作用
```

---

## 3. 数据模型

### 3.1 Note 类型(Q-N2=A,用 DriverSerialized 信封)

```ts
// src/views/note/data-model.ts
import type { DriverSerialized } from '@drivers/text-editing-driver/types';

export interface Note {
  /** 'note-1' / 'note-2' 等(per-workspace counter)*/
  id: string;

  /** 标题:从 doc 第一段文字自动派生(Q13=B 决策)*/
  title: string;

  /** PM doc(用 driver 协议的 DriverSerialized 信封)
   *  format: 'pm-doc-json' / version: '0.1' / payload: PM doc JSON */
  doc: DriverSerialized;

  createdAt: number;
  updatedAt: number;
}
```

**信封语义**(driver 协议 § 3.1.1):
- format = `'pm-doc-json'`(text-editing-driver 唯一 format)
- version = `'0.1'`(driver 内部 schema 版本)
- payload = PM doc JSON(具体内容)

view **不接触 PM 内部对象**,只持有 `DriverSerialized` 信封。所有 PM 操作走 driver 的 Host 组件。

### 3.2 NotePluginState(per-workspace 隔离)

```ts
export interface NotePluginState {
  /** 笔记池:id → Note */
  notes: Record<string, Note>;
  /** 当前活跃笔记 id */
  activeNoteId: string | null;
  /** ID 递增计数器 */
  counter: number;
}

// 存 WorkspaceState.pluginStates['note'] = NotePluginState
```

**Workspace 隔离**(Q12=A,旧 v0.1 决策延续):每个 Workspace 有独立 `pluginStates['note']`。L5-A 不做跨 Workspace 笔记共享(L5-B+ 真有需求时重构数据模型)。

### 3.3 默认值 + helper

```ts
function defaultState(): NotePluginState {
  return { notes: {}, activeNoteId: null, counter: 0 };
}

export function getNotePluginState(ws: WorkspaceState): NotePluginState {
  return (ws.pluginStates['note'] as NotePluginState | undefined) ?? defaultState();
}

export function createNote(workspaceId: string): string {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return '';
  const state = getNotePluginState(ws);
  const newCounter = state.counter + 1;
  const id = `note-${newCounter}`;

  const newNote: Note = {
    id,
    title: '未命名',
    doc: {
      format: 'pm-doc-json',
      version: '0.1',
      payload: { type: 'doc', content: [{ type: 'text-block', content: [] }] },
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  workspaceManager.update(workspaceId, {
    pluginStates: {
      ...ws.pluginStates,
      note: {
        ...state,
        notes: { ...state.notes, [id]: newNote },
        counter: newCounter,
        activeNoteId: id,
      },
    },
  });
  return id;
}

export function updateNote(workspaceId: string, noteId: string, patch: Partial<Note>): void { ... }
export function deleteNote(workspaceId: string, noteId: string): void { ... }
export function setActiveNote(workspaceId: string, noteId: string | null): void { ... }
export function deriveTitle(doc: DriverSerialized): string { ... }   // 从 doc.payload 第一段提取
```

L3 pluginStates 持久化机制(`workspaceManager.update` 触发 notify + auto-save)直接受益。

### 3.4 标题派生(Q13=B)

```ts
export function deriveTitle(doc: DriverSerialized): string {
  if (doc.format !== 'pm-doc-json') return '未命名';
  const pmDoc = doc.payload as { content?: Array<{ content?: Array<{ text?: string }> }> };
  const firstBlockText = pmDoc.content?.[0]?.content?.[0]?.text?.trim() ?? '';
  return firstBlockText || '未命名';
}
```

每次 onChange 触发时调,写回 `note.title`。

---

## 4. NoteView React 组件

### 4.1 主组件(NoteView.tsx)

```tsx
// src/views/note/NoteView.tsx
import { textEditingDriver } from '@drivers/text-editing-driver';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { getNotePluginState, updateNote, deriveTitle } from './data-model';

export function NoteView({ workspaceId }: ViewComponentProps) {
  const ws = useWorkspace(workspaceId);
  const noteState = getNotePluginState(ws);
  const activeNote = noteState.activeNoteId ? noteState.notes[noteState.activeNoteId] : null;

  if (!activeNote) {
    return <div className="krig-note-empty">未选择笔记 — 从左侧列表点选,或新建笔记</div>;
  }

  const handleDocChange = (newDoc: DriverSerialized) => {
    const newTitle = deriveTitle(newDoc);
    updateNote(workspaceId, activeNote.id, {
      doc: newDoc,
      title: newTitle,
      updatedAt: Date.now(),
    });
  };

  return (
    <div className="krig-note-view">
      <textEditingDriver.Host
        config={{
          undoScope: 'note-view.pm',  // 铁律 6b:view-id.purpose
        }}
        doc={activeNote.doc}
        onChange={handleDocChange}
      />
    </div>
  );
}
```

**关键观察**:
- view 只装一个 driver Host 组件,所有 PM 细节封在 driver 内
- view 拿到的 doc 是 DriverSerialized 信封(不是 PM doc 对象)
- onChange 收到新信封后写回 pluginStates,触发 L3 自动持久化
- view 不直接接触 PM 任何 API

### 4.2 useWorkspace hook

L3.5 已建(`src/workspace/workspace-instance/use-workspace.ts`),NoteView 直接用。

---

## 5. NavSide 内容

### 5.1 注册(nav-side-content.tsx)

```tsx
import { navSideRegistry } from '@slot/nav-side-registry';

export function registerNavSide() {
  navSideRegistry.register({
    view: 'note-view',
    title: '笔记目录',
    actions: [
      { id: 'create', label: '+ 笔记', command: 'note-view.create-note' },
    ],
    searchPlaceholder: '搜索笔记...',
    onSearch: () => { /* L5-A 不实施过滤 */ },
    contentRenderer: () => <NoteList />,
  });
}
```

### 5.2 NoteList 子组件(note-list.tsx)

```tsx
import { useActiveWorkspaceId, useWorkspace } from '@workspace/workspace-instance/use-workspace';
import { getNotePluginState, setActiveNote, deleteNote } from './data-model';

export function NoteList() {
  const wsId = useActiveWorkspaceId();
  const ws = useWorkspace(wsId);
  if (!ws) return null;

  const state = getNotePluginState(ws);
  const sortedNotes = Object.values(state.notes).sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <ul className="krig-note-list">
      {sortedNotes.length === 0 && (
        <li className="krig-note-list-empty">还没有笔记 — 点 [+ 笔记] 创建</li>
      )}
      {sortedNotes.map((note) => (
        <li
          key={note.id}
          className={note.id === state.activeNoteId ? 'active' : ''}
          onClick={() => setActiveNote(wsId, note.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            // L5-A:右键当前项,提供"删除"
            if (confirm(`删除"${note.title}"?`)) deleteNote(wsId, note.id);
          }}
        >
          <span className="krig-note-list-title">{note.title}</span>
          <span className="krig-note-list-time">{formatTime(note.updatedAt)}</span>
        </li>
      ))}
    </ul>
  );
}
```

L5-A 删除用原生 `confirm` — 简陋但够用。L5-B+ 加自定义对话框。

---

## 6. commandRegistry 命令注册

按 driver 协议铁律 7 + Q-N3=A:NoteView 注册 view 命名空间(`note-view.*`)的特有命令。

```ts
// src/views/note/note-commands.ts
import { commandRegistry } from '@slot/command-registry';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { createNote, deleteNote, setActiveNote } from './data-model';

export function registerNoteCommands() {
  // view 特有命令(L5-A 必需)
  commandRegistry.register('note-view.create-note', () => {
    const wsId = workspaceManager.getActiveId();
    if (wsId) createNote(wsId);
  });

  commandRegistry.register('note-view.delete-active', () => {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const ws = workspaceManager.get(wsId);
    if (!ws) return;
    const state = getNotePluginState(ws);
    if (state.activeNoteId) deleteNote(wsId, state.activeNoteId);
  });

  commandRegistry.register('note-view.set-active', (noteId: string) => {
    const wsId = workspaceManager.getActiveId();
    if (wsId) setActiveNote(wsId, noteId);
  });

  // L5-B+ 加 view 命名空间命令(driver 已注册 capability 命名空间命令的 handler):
  // commandRegistry.register('note-view.toggle-bold', ...);   // L5-B
  // commandRegistry.register('note-view.set-heading-level', (level) => ...); // L5-B
  // commandRegistry.register('note-view.toggle-list', (kind) => ...); // L5-B
}
```

**capability 命名空间命令(`clipboard.copy` / `undo-redo.undo` 等)的 handler 由 driver 注册,view 不重复注册**(铁律 7)。

---

## 7. ContextMenu 项

通过 ViewDefinition.contextMenu 字段(L4 view-type-registry 已有,但 L5-A 这层只有"新建笔记"基本项):

```ts
// 已在 § 1.1 viewTypeRegistry.register 里:
contextMenu: [
  {
    id: 'note-view.create-note',
    label: '新建笔记',
    command: 'note-view.create-note',
    enabledWhen: () => true,
  },
],
```

L4 自动把这条项分发到 contextMenuRegistry,绑定到 'note-view' view。Workspace 内任意位置右键时,只要在 NoteView 区域就显这个项。

L5-B+ 加更多 contextMenu 项(粘贴 / 选区粘到新笔记 / 等)。

---

## 8. L5-A 完成判据

| # | 判据 | 验证方式 |
|---|---|---|
| 1 | npm run typecheck + lint 全过 | `npm run typecheck` / `npm run lint` |
| 2 | NoteView 出现在 ViewSwitcher(L4 navSideTab 显示) | 视觉确认:Note tab 出现 |
| 3 | 点 ViewSwitcher Note → SlotArea 装载 NoteView | 视觉:左 slot 显笔记界面 |
| 4 | 空白 NoteView 显"未选择笔记"占位 | 视觉确认 |
| 5 | NavSide "+ 笔记" 按钮触发创建 | 列表多一项 + SlotArea 显示 PM 编辑器 |
| 6 | 用户能输入文字 + 回车换段(textBlock 编辑) | 视觉 + 输入测试 |
| 7 | 标题自动从首段派生,列表实时更新 | 输入"hello"列表立即显 hello |
| 8 | 列表点选笔记切换 SlotArea 内容 | 视觉 |
| 9 | 右键笔记列表项删除(原生 confirm) | 删除后列表少一项 |
| 10 | 右键 SlotArea → 显 V2 自定义菜单"新建笔记"项 | L4 真菜单首次实测 |
| 11 | 刷新 npm start 后笔记和内容仍在(pluginStates 持久化) | 关闭 app 重启 |
| 12 | 多 Workspace 切换 — 笔记互不可见(隔离) | 切 Workspace 后列表/内容独立 |
| 13 | DriverSerialized 信封正确(format/version/payload 格式)| DevTools `__krig.workspace.<id>.pluginStates.note` 检查 |
| 14 | console `[L5] alive | view: note-view, blocks: 1, capabilities: 5+driver` | renderer 启动确认 |
| 15 | 健康检查 `health.L5` 返回 alive | DevTools `await window.electronAPI.health('L5')` |

L5-A 不验证(留 L5-B+):
- undo/redo 实际功能(driver 已占位 noop)
- 跨 view 复制粘贴(clipboard 多 envelope 留 L5-B)
- 笔记互链点击(L5-C noteLink)
- 边界碰撞检测(L4 已建,L5 真菜单首次跑通)

---

## 9. 实施清单

| 文件 | 行数估算 |
|---|---|
| `index.ts` | ~15 |
| `NoteView.tsx` | ~50 |
| `data-model.ts` | ~120 |
| `note-commands.ts` | ~40 |
| `nav-side-content.tsx` | ~40 |
| `note-list.tsx` | ~60 |
| `note.css` | ~50 |
| `README.md` | ~30 |

合计 ~405 行(view 业务比 driver 简单,符合 Q-N5=B 精简版预期)。

加 driver 内部 ~570 行 + L5-A IPC / 诊断 ~50 行,L5-A 总实施 **~1025 行代码**。

---

## 10. L5-B/C 增量预告

### 10.1 L5-B(文件夹树 + marks + undo/redo)

NoteView 升级:
- NavSide 改成 FolderTree 组件(承袭 V1 NotePanel 模式)
- 加文件夹 CRUD + 移动笔记到文件夹(改引用)
- 加 view 命名空间命令:`note-view.toggle-bold` / `note-view.set-heading-level` / `note-view.toggle-list`
- 笔记数据模型:加文件夹结构(扁平 list + 树指针)

driver 升级:
- 加 marks(bold / italic / strike / code)+ marks keymap
- 加 prosemirror-history(undo-redo capability 实施 scope)
- 加 dnd block-handle 拖动手柄 + dropTarget 注册(NavSide 拖笔记到文件夹也走这条)
- 加 input-rules
- 加 multi-envelope clipboard + paste dispatcher

### 10.2 L5-C(行内链接)

NoteView 加业务:
- noteLink 点击 → bus.openRight('note-view', { noteId })(L3.5 真用)
- noteLink 标题同步 channel(`note.title.changed`)

driver 加 block:
- noteLink inline atom node + node-view(NodeView 异步加载 title)
- `[[` 触发面板(slash 同款机制,但触发字符不同)

---

## 11. 风险 + 开放问题

### 11.1 view 主键盘事件捕获放哪?

按驱动协议铁律 7,view 在最外层捕获键盘 → commandRegistry 分发。但 NoteView 是 React 组件,捕获在哪一层?

**推荐**:NoteView 顶层 `<div>` 加 onKeyDown,委托 PM 编辑区域的键盘给 PM 处理(handled 不阻止),其他键(Cmd+S / Cmd+N 等 view 级)走 commandRegistry。

L5-A 简化:**先不做 view 级键盘**(Cmd+N 创建笔记等留 L5-B 加),NoteView 顶层不挂 onKeyDown。

### 11.2 view 切笔记时 driver Host 实例怎么办?

切笔记 = `setActiveNote` → `activeNoteId` 变 → NoteView 重渲 → driver Host 接到新 doc。

`<textEditingDriver.Host>` 内部应该:
- 检测 doc props 变化
- 不重建 EditorView,而是用 PM `state.tr.replaceWith` 替换 doc

driver Host 的 React key 不变(都在 NoteView 树里同一位置)→ React 实例不重建 → EditorView 不重建 → 切笔记时光标 / scroll 等丢失(因为 doc 全换)— 这是合理的(用户切笔记本来就期望从头开始)。

### 11.3 setActiveNote 跟 SlotArea 的关系?

NoteView 是 SlotArea 的 view。setActiveNote 改 pluginStates,触发 NoteView 重渲。这跟 SlotArea 无关 — SlotArea 一直显示 NoteView,只是 NoteView 内容变了。

不需要走 `bus.slot.openLeft / openRight`(那是切 view type 用)。

### 11.4 笔记数 N 大时性能?

L5-A 假设笔记 < 100 条,直接 sort + render。L5-B+ 笔记多时(用户实际可能上千条):
- 列表虚拟滚动
- 索引分片加载
- pluginStates 不直接存所有笔记内容(只存元数据,内容懒加载)

L5-A 不预设这些优化。

### 11.5 删除当前活跃笔记时怎么办?

`deleteNote` 中:
- 删除笔记
- 如果删的是 activeNoteId,要切到列表第一条(或 null)

```ts
if (state.activeNoteId === noteId) {
  const remaining = Object.keys(state.notes).filter(id => id !== noteId);
  state.activeNoteId = remaining[0] ?? null;
}
```

L5-A 实施时注意。

### 11.6 driver 注销时 pluginStates 还在,刷新后怎么办?

NoteView unmount(切到其他 view)→ NoteView component unmount → driver Host unmount → driver 的 capability 注册全部清理。但 pluginStates 还在(笔记数据)。

下次切回 NoteView → 重新 mount → driver 重新装配 → 笔记数据从 pluginStates 加载。

L5-A 验证:切到 BookView 再切回 NoteView,笔记列表 + 当前笔记内容仍在。

### 11.7 健康检查 health.L5 怎么报?

L5 alive 应该报 view 数 + 已 install 的 capability/driver 数:

```ts
reportL5Alive({
  views: viewTypeRegistry.count,           // 1(只 note-view)
  blocksInDriver: textEditingDriver.blockCount,  // 1(只 textBlock)
  installedCapabilities: ['selection', 'clipboard', ...],
});
```

L5-A 实施时建 `src/views/L5-alive.ts`(类似 L4-alive.ts 模式)。

---

## 12. 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-05-05 | v0.1 | 初稿;按"动作类型 capability"思路设计;后被 v0.5 driver 架构调整推翻。 |
| 2026-05-05 | v0.2 | **整体重写**(driver 架构落地后):view 装 5 capability + driver(install 列表显式)/ data-model 用 DriverSerialized 信封 / commandRegistry 用 view 命名空间(note-view.*)/ NoteView 完整 CRUD + NavSide 列表 + 切换(Q-N4=A)/ 实施清单 ~405 行 / 完成判据 15 条。Q-N1~5 用户拍板固化。 |
