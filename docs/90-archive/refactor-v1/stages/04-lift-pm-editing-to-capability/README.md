# 阶段 04 — 把 PM 编辑能力从 NoteView 上提到 text-editing capability

> 起因:2026-05-15 用户提出 "View 应该更侧重可视化和命令操作菜单的能力注册,
> 功能类的业务应该放 capability"。下面要构建 ThoughtView 这个 NoteView 变种,
> 如果不抽象,NoteView 就变成 ThoughtView 的事实驱动层。
>
> 分支:`feature/lift-pm-editing-to-capability`(memory feedback_branch_module_boundary —
> 模块边界单分支多 commit,里程碑后合 main)。

## 一、目标

把当前 `src/views/note/` 内属于 "PM 通用编辑能力" 的部分上提到
`src/capabilities/text-editing/`,让 NoteView / ThoughtView / canvas-text-node
作为平级消费者共享同一套能力 — 不是 V1 的 "ThoughtEditor = NoteEditor variant"
反向继承,而是平级 view 站在同一 capability 上。

## 二、4 条决议(D-A / D-B / D-C / D-D)

### D-A 命令 id 重命名:`note-view.*` → `text-editing.*`(PM 通用命令)

**理由**:命令是能力原子,不应绑某个 view。canvas-text-node 嵌入的 PM 实例
也能用 `text-editing.cycle-text-color`,语义正确。

**影响面**:见下文 §三命令归类表(46 个上提 / 22 个保留,共 68 个命令)。

### D-B 菜单 item 用工厂函数,不是预设数组

工厂函数收 `viewId` 参数返回 `Item[]`:

```ts
export function createMarkButtons(viewId: string): FloatingToolbarItem[] {
  return [
    { id: `${viewId}.ft.bold`, view: viewId, command: 'text-editing.toggle-bold', ... },
    // I / U / S / code
  ];
}
```

view 拼装时:

```ts
floatingToolbarRegistry.register([
  ...textEditing.ui.floatingToolbar.createMarkButtons('note-view'),
  ...textEditing.ui.floatingToolbar.createMathButton('note-view'),
  ...createNoteSpecificButtons('note-view'),  // view 自己的增量
]);
```

**理由**:① view 字段需要 viewId 注入(controller 按 viewId 过滤);
② item id 用 `${viewId}.ft.bold` 避免跨 view 冲突;
③ view 仍然是注册动作的发起者(对齐用户拍板 "注册什么菜单归 view")。

### D-C 删除 `scope: 'global'` 字段

V2 现有 `scope: 'global'` 是 "跨 view 通配" 逃生口,本意就是 "这条注册其实属于
capability"。上提后每个 view 自己注册自己的 viewId(thought-view 想用 bold 就调
`createMarkButtons('thought-view')`),通配机制不再需要。

**影响**:slash-types.ts / floating-toolbar-types.ts 删字段 + 2 个 registry
删 `scope === 'global'` 判断分支。

### D-D Driver 内 `viewId === 'note-view'` 硬编码 → toggles.titleGuard

`editor-view-builder.ts:78` `requiresTitleGuard = viewId === 'note-view'` 改:

```ts
const requiresTitleGuard = config.plugins?.titleGuard ?? (viewId === 'note-view');
```

兼容期保留 viewId fallback;view 显式声明后(NoteView config.plugins.titleGuard=true,
ThoughtView 不传)以 toggles 为准。

## 三、命令归类清单(grep 实证)

### 🔵 上提到 capability(46 个)

| 类别 | 数量 | 旧 id 模式 | 新 id 模式 |
|---|---|---|---|
| Mark toggle | 5 | `note-view.toggle-{bold,italic,underline,strike,code}` | `text-editing.toggle-*` |
| Heading | 1 | `note-view.set-heading-level` | `text-editing.set-heading-level` |
| Color | 2 | `note-view.cycle-{text-color,highlight}` | `text-editing.cycle-*` |
| History | 2 | `note-view.{undo,redo}` | `text-editing.{undo,redo}` |
| Slash turn | 12 | `note-view.slash-turn-{paragraph,h1..h3,bullet,ordered,task,quote,code,divider,callout,toggle}` | `text-editing.slash-turn-*` |
| Slash math 通用 | 2 | `note-view.{slash-insert-math-block,insert-math-inline}` | `text-editing.*` |
| Handle turn | 11 | `note-view.handle-turn-*`(11 项,不含 divider) | `text-editing.handle-turn-*` |
| Handle action | 3 | `note-view.handle-{duplicate-block,delete-block,copy-block}`(`copy-block-link` 留 view,不计) | `text-editing.handle-*` |
| Context menu PM 通用 | 7 | `note-view.cm-{cut,copy,paste,select-all,remove-marks,remove-link,delete-block}` | `text-editing.cm-*` |
| Popup trigger | 1 | `note-view.popup-link` | `text-editing.popup-link` |
| **合计** | **46** | | |

### 🟢 保留在 view/note(22 个)

| 类别 | 数量 | id |
|---|---|---|
| 笔记 CRUD | 4 | `create-note` / `set-active` / `set-active-in-right` / `delete-active` |
| 文件夹 CRUD | 4 | `create-folder` / `delete-by-tree-id` / `copy-by-tree-id` / `paste` |
| 文件夹排序 | 2 | `sort-cycle-title` / `sort-cycle-date` |
| Note 导航历史 | 2 | `go-back` / `go-forward` |
| 业务依赖 | 1 | `handle-copy-block-link`(依 noteId) |
| Learning 业务 | 2 | `cm-dictionary-lookup` / `cm-translate-text` |
| 业务插入 | 7 | `slash-insert-{image,table,audio,video,tweet,file-block,external-ref}` |
| **合计** | **22** | |

### 🟣 字符串常量同步迁

- `'note-view.pm'`(undoScope) → `'text-editing.pm'`
- `'note-view.popup.{link,color,note-link}'` → `'text-editing.popup.*'`
- `'note-view.help.dictionary'` 保留(dictionary 是 learning 业务,不上提)

## 四、目标 capability 结构

```
src/capabilities/text-editing/
├── DESIGN.md                       # 更新对外面孔说明
├── types.ts                        # 已有,加 LinkPanelOptions 等
├── index.ts                        # 已有,加 ui 子命名空间
├── commands/                       # 新建 — PM 通用命令实现
│   ├── register.ts                 # registerTextEditingCommands()
│   ├── mark-commands.ts
│   ├── heading-commands.ts
│   ├── color-commands.ts
│   ├── history-commands.ts
│   ├── slash-turn-commands.ts
│   ├── handle-commands.ts
│   ├── context-menu-commands.ts
│   └── popup-link-command.ts       # 含 fake-anchor 创建逻辑
└── ui/                              # 新建 — 菜单 item 工厂 + popup 组件
    ├── color-picker/                # 已有
    ├── floating-toolbar/
    │   ├── items.ts                 # createMarkButtons / createMathButton / ...
    │   └── register.ts              # 可选 helper
    ├── toolbar/
    │   └── items.ts                 # createHeadingDropdown / createMarkButtons / ...
    ├── slash-menu/
    │   └── items.ts                 # createTurnIntoItems / createMathBlockItem
    ├── handle-menu/
    │   └── items.ts                 # createTurnIntoSubmenu / createColorSubmenu /
    │                                #   createBlockActions
    ├── context-menu/
    │   └── items.ts                 # createClipboardGroup / createRemoveMarksGroup
    ├── link-panel/                  # 整目录从 views/note/ 搬过来
    │   ├── LinkPanel.tsx
    │   ├── FileTab.tsx
    │   └── register.ts              # registerLinkPopup(viewId, opts)
    └── note-link-search/            # 整目录从 views/note/ 搬过来
        ├── NoteLinkSearchPanel.tsx
        ├── integration.ts
        └── register.ts
```

## 四点五、注册原则 + 分层契约(实施前必读)

### 4.5.1 唯一注册源原则(N-1)

**任何一个 command id 在全部 src/ 内只允许一个 `commandRegistry.register('<id>', ...)` 调用点。**

理由:commandRegistry 内部是 Map.set 行为(后注册者 silent overwrite 先注册者),
多源注册会让"实际生效的 handler 是哪个"取决于 module 加载顺序,debug 极痛苦。

**适用约束(本阶段相关)**:

- C1 改 id 时,**保持 NoteView 单一注册源**(注册位置不动,只换 id 字符串)
- C7 把 PM 命令实现迁到 capability 时,**必须同步删除 NoteView 一侧的旧注册**
  (memory feedback_strict_compliance_workflow:同一动作的两个状态不能并存)
- 每个 commit 验证步骤含 `grep -rn "commandRegistry.register('text-editing\." src/`
  统计每个 id 只出现一次

### 4.5.2 capability 分层契约(N-2)

**搬到 src/capabilities/text-editing/ 的代码,允许的依赖:**

| 依赖类型 | 允许 | 例 |
|---|---|---|
| driver | ✓ | `@drivers/text-editing-driver`(本 capability 的 driver) |
| 同层其他 capability | ✓ | `requireCapabilityApi<NoteCapabilityApi>('note')` — 横向 capability API |
| slot 注册表 | ✓ | popupRegistry / slashRegistry / floatingToolbarRegistry 等(item 工厂注册路径) |
| `@workspace/*` | △ 有条件 | 只能调 `workspaceManager.getActiveId()` 等无业务语义 API;**禁止读 ws.pluginStates 业务数据** |

**禁止依赖**:

- `@views/*` — 任何 view 私有模块(包括 view 内的 hook / store / 业务 helper)
- `@capabilities/note` 等具体 capability 的 **内部模块**(只能走 requireCapabilityApi 间接路由)

**特别约束 — note-link-search(C6)分层澄清**:

该模块虽然命名带 "note",但语义是 **PM 内 `[[` 双链触发的通用搜索机制** —
canvas-text-node / thought 都可能用("在 thought 里 `[[` 链接到笔记" 合理)。

上提到 capability 后必须保证:

| 项 | 当前 (在 views/note/) | C6 后 (在 capabilities/text-editing/ui/note-link-search/) |
|---|---|---|
| 数据来源 | `useAllNotes()` hook(view 层) | `requireCapabilityApi<NoteCapabilityApi>('note').listNotes()` + `onListChanged` 自封订阅 |
| 业务模型依赖 | 无(仅 Note.id / Note.title 字段) | 同左,保持 |
| 输出 atom | `noteLink` PM atom(schema 内置) | 同左,保持 |

**契约**:note-link-search 只依赖 NoteCapabilityApi 的 listNotes / onListChanged
**两个签名**,**不依赖 view-layer hook**,**不依赖 note 业务模型**(no folderStore /
no per-ws state)。C6 实施时若发现需要额外依赖,**停下重新评估** —— 可能要拆成
通用搜索 + note adapter 两层。

### 4.5.3 已知薄弱点(沿用 noteview-feature-inventory)

- inventory §15 `workspaceManager.getActiveId()` 在 ColorPickerPanel handle submenu
  场景下的 "复合 instanceId" 问题:本阶段不动,仍走 fallback;canvas-text-node 接入
  PM 通用菜单时整套切换(controller state 加 instanceId 字段)

## 五、实施路线(9 个 commit:C0~C8)

| Commit | 内容 | 验证 |
|---|---|---|
| **C0** | 本设计文档 + 开分支 | git log 看分支建好 |
| **C1** | 46 个 PM 通用命令 id `note-view.*` → `text-editing.*` + 1 undoScope + 3 popup id(命令注册位置暂不动) | typecheck pass / 全 view 菜单功能不退化 / `grep -rn "commandRegistry.register('text-editing\." src/` 每 id 仅 1 行(N-1) |
| **C2** | floating-toolbar + toolbar 工厂函数化(items.ts) + NoteView 改调工厂 | 浮条 B/I/U/S/code/∑/🔗/A 全 work + toolbar dropdown work |
| **C3** | slash menu 12 PM 项工厂化 + NoteView 改调工厂(7 业务插入留 NoteView 自注册) | / 触发 SlashMenu 含全部 19 项 |
| **C4** | popup color + LinkPanel(opts) + handle menu PM 项工厂化 | Color popup work / Cmd+K LinkPanel work / handle ⋮⋮ 全菜单 work |
| **C5** | context menu PM 项工厂化 + NoteView 自注册查词/翻译 | 编辑区右键完整 |
| **C6** | note-link-search 完整目录搬到 capability(useAllNotes hook → 改 NoteCapabilityApi 直调) | `[[` 触发笔记搜索 work / `grep -rn "useAllNotes\|@views/note" src/capabilities/text-editing/` 0 命中(N-2) |
| **C7** | note-commands.ts 拆 PM commands → capability + 修 D-5 handle-copy 丢格式 bug + **同步删 NoteView 旧 register**(N-1) | 浮条命令 work + handle Copy 粘贴回来 mathBlock 保留格式 / `grep -rn "commandRegistry.register('text-editing\." src/` 每 id 仅 1 行 |
| **C8** | driver titleGuard 走 toggles(D-D);**D-C 暂缓** — 删 `scope:'global'` 需先让 graph-canvas-view 调工厂注册一份(否则 canvas-text-node popup 内 slash/floating-toolbar 失通用项),独立任务调研 | typecheck pass / NoteView noteTitle 保护仍生效 |

## 六、不动的边界(确认)

- **NoteView 留下的部分**:NoteView.tsx / data-model.ts / tree-builder.ts /
  tree-operations.ts / nav-side-content.tsx / use-notes-folders.ts /
  context-menu-registrations.ts(folderTree 右键) /
  note-cache.ts / note-navigation-history.ts / link-click-integration.ts(路由) /
  extraction-import.ts / use-extraction-import.ts / learning-integration.ts /
  dictionary-panel/
- **Driver 层不动**:除 D-D titleGuard 一处,driver 内部 schema / plugins / Host 都不动。
- **canvas-text-node 不动**(本阶段):工厂函数注册的菜单在 viewId='graph-canvas-view'
  时是否启用,留下一阶段独立判断 — 本阶段先把 NoteView 拼装层跑通。

## 七、风险 + 回滚

- 每个 commit 独立可回滚(`git revert <sha>`)
- C1 命令 id 大批量替换是高频改动点:每改一处 grep verify 引用全清(memory
  feedback_decision_grep_verify_complete_propagation)
- **N-1 双注册风险**(C1~C7 期间):C1 改 id 后 NoteView 注册的是 `text-editing.*`;
  C7 capability 加 `registerTextEditingCommands()` 时**必须同步删 NoteView 旧 register**,
  否则后注册者 silent overwrite。每个 commit 验证 `grep -rn "commandRegistry.register('text-editing\."`
  每个 id 仅 1 行
- **N-2 capability 分层退化风险**(主要 C6):note-link-search 搬到 capability 后
  禁止依赖 `@views/*` / view-layer hook;若需要额外依赖,**停下重新评估**,可能要拆通用 + adapter
- **C8 D-C 暂缓**(2026-05-15 实施过程发现):scope:'global' 当前真实作用是让
  canvas-text-node popup(viewId='graph-canvas-view')共享 NoteView 注册的 slash /
  floating-toolbar 通用项。删字段前必须让 graph-canvas-view 显式调一遍工厂注册
  view='graph-canvas-view' 条目,否则 canvas-text-node 内嵌编辑器立刻失去全部
  PM 通用菜单。归入独立任务调研 — 当前 C8 仅做 D-D。
- 不走 main 合并(memory feedback_merge_requires_explicit_ok),里程碑后用户显式确认才合
