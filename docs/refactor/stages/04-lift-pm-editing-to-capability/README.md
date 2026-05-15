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

**影响面**:见下文 §三命令归类表(47 个上提 / 15 个保留)。

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

### 🔵 上提到 capability(47 个)

| 类别 | 数量 | 旧 id 模式 | 新 id 模式 |
|---|---|---|---|
| Mark toggle | 5 | `note-view.toggle-{bold,italic,underline,strike,code}` | `text-editing.toggle-*` |
| Heading | 1 | `note-view.set-heading-level` | `text-editing.set-heading-level` |
| Color | 2 | `note-view.cycle-{text-color,highlight}` | `text-editing.cycle-*` |
| History | 2 | `note-view.{undo,redo}` | `text-editing.{undo,redo}` |
| Slash turn | 12 | `note-view.slash-turn-{paragraph,h1..h3,bullet,ordered,task,quote,code,divider,callout,toggle}` | `text-editing.slash-turn-*` |
| Slash math 通用 | 2 | `note-view.{slash-insert-math-block,insert-math-inline}` | `text-editing.*` |
| Handle turn | 11 | `note-view.handle-turn-*`(11 项,不含 divider) | `text-editing.handle-turn-*` |
| Handle action | 4 | `note-view.handle-{duplicate-block,delete-block,copy-block}` + (`copy-block-link` 留 view) | `text-editing.handle-*` |
| Context menu PM 通用 | 7 | `note-view.cm-{cut,copy,paste,select-all,remove-marks,remove-link,delete-block}` | `text-editing.cm-*` |
| Popup trigger | 1 | `note-view.popup-link` | `text-editing.popup-link` |
| **合计** | **47** | | |

### 🟢 保留在 view/note(15 个)

| 类别 | id |
|---|---|
| 笔记 CRUD | `create-note` / `set-active` / `set-active-in-right` / `delete-active` |
| 文件夹 CRUD | `create-folder` / `delete-by-tree-id` / `copy-by-tree-id` / `paste` |
| 文件夹排序 | `sort-cycle-title` / `sort-cycle-date` |
| Note 导航历史 | `go-back` / `go-forward` |
| 业务依赖 | `handle-copy-block-link`(依 noteId) |
| Learning 业务 | `cm-dictionary-lookup` / `cm-translate-text` |
| 业务插入(7) | `slash-insert-{image,table,audio,video,tweet,file-block,external-ref}` |

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

## 五、实施路线(8 个 commit)

| Commit | 内容 | 验证 |
|---|---|---|
| **C0** | 本设计文档 + 开分支 | git log 看分支建好 |
| **C1** | 47 个 PM 通用命令 id `note-view.*` → `text-editing.*`(命令注册位置暂不动) | typecheck pass / 全 view 菜单功能不退化 |
| **C2** | floating-toolbar + toolbar 工厂函数化(items.ts) + NoteView 改调工厂 | 浮条 B/I/U/S/code/∑/🔗/A 全 work + toolbar dropdown work |
| **C3** | slash menu 12 PM 项工厂化 + NoteView 改调工厂(7 业务插入留 NoteView 自注册) | / 触发 SlashMenu 含全部 19 项 |
| **C4** | popup color + LinkPanel(opts) + handle menu PM 项工厂化 | Color popup work / Cmd+K LinkPanel work / handle ⋮⋮ 全菜单 work |
| **C5** | context menu PM 项工厂化 + NoteView 自注册查词/翻译 | 编辑区右键完整 |
| **C6** | note-link-search 完整目录搬到 capability | `[[` 触发笔记搜索 work |
| **C7** | note-commands.ts 拆 PM commands → capability + 修 D-5 handle-copy 丢格式 bug | 浮条命令 work + handle Copy 粘贴回来 mathBlock 保留格式 |
| **C8** | 删除 `scope:'global'` 字段(D-C) + driver titleGuard 走 toggles(D-D) | typecheck pass / NoteView noteTitle 保护仍生效 |

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
- C8 删 `scope:'global'` 是破坏性 schema 字段变更:必须在 C2~C7 把所有 item 都改成
  显式 `view: viewId` 之后才能做,否则 thought-view / canvas-text-node 跨 view 项会断
- 不走 main 合并(memory feedback_merge_requires_explicit_ok),里程碑后用户显式确认才合
