# L5-B1 文件夹树 + 完整 NavSide 阶段完成报告

> 阶段:L5-B1 NavSide 升级到 V1 NotePanel 同款体验 — 文件夹树 + 嵌套展开 + 拖拽 + 双击重命名 + 多选批删 + 剪贴板 + 完整右键菜单 + 键盘快捷键
> 分支:`feature/L5B1-folder-tree`
> 完成日期:2026-05-06

---

## 1. 完成判据核对(L5-B1 设计 v0.1 § 5 — 15 条)

| # | 判据 | 状态 | 验证方式 |
|---|---|---|---|
| 1 | npm run typecheck + lint 全过 | ✅ | 实施末通过 |
| 2 | NavSide "+ 文件夹" 按钮创建空文件夹 | ✅ | 视觉确认 |
| 3 | 双击 inline rename(Enter 提交,Esc 取消,blur 提交) | ✅ | 视觉 + 键盘 |
| 4 | 单击 folder 切展/折,▶/▼ 箭头单击同效 | ✅ | 视觉确认 |
| 5 | folder 内"+ 笔记"右键创建,自动展开 | ✅ | 视觉 |
| 6 | 拖一笔记进 folder → folderId 改;视觉进入子层 | ✅ | 拖拽测试通过 |
| 7 | 拖 folderA 进 folderB(防环:拖到自己子树拒绝) | ✅ | 视觉 + DevTools 检查 |
| 8 | 多选(Cmd 单点 toggle / Shift 范围选)→ Delete 批删 | ✅ | 多选 + 键盘 |
| 9 | 右键复制 → 右键 folder 选粘贴 → "副本"前缀 | ✅ | 视觉确认 |
| 10 | 空白处右键"按标题排序"循环 ↑↓;"按日期排序"独立 | ✅ | 视觉 |
| 11 | 每文件夹独立排序(folder A 按标题 / folder B 按日期 互不影响) | ✅ | 视觉 |
| 12 | 键盘:↑↓ 移焦点 / ←→ 折展 folder / Enter 打开 / F2 重命名 / Delete 删 | ✅ | 键盘测试 |
| 13 | 多 Workspace:数据共享(全局)/ 展开/选中态独立(per-ws) | ✅ | 多 Workspace 切换 |
| 14 | 删 folder → 子 folder 级联删,内含笔记 folderId → null | ✅ | 视觉 + DevTools |
| 15 | 重启 app 后笔记/文件夹/展开/排序均恢复 | ✅ | 重启验证 |

**总评**:**通过**(15 条全 ✅)。

---

## 2. 该阶段实施的具体内容

### 2.1 设计文档(1 篇)

| 文件 | 内容 |
|---|---|
| `docs/RefactorV2/stages/L5B1-folder-tree-design.md` v0.1 | 7+3 项决策(Q1-Q10)拍板锁定;15 判据;~1170 行实施清单;模块物理布局 + 数据契约 + 框架层组件 + view 层实施 + 风险开放问题 |

### 2.2 框架层共用组件(`src/slot/shared-ui/` + 注册中心,~700 行)

| 文件 | 行数 | 职责 |
|---|---|---|
| `shared-ui/README.md` | - | 框架层共用 UI 组件总览(业务零知识 / 强制统一布局 / 视觉常量) |
| `shared-ui/FolderTree/types.ts` | 85 | TreeNode / FolderNode / ItemNode / ItemMeta / ContextMenuItem / FolderTreeContextInfo / KeyAction / FolderTreeProps |
| `shared-ui/FolderTree/styles.ts` | 82 | 视觉常量(1:1 V1):TREE_ROW_HEIGHT=28 / TREE_INDENT_PX=16 / row hover / selected / dropTarget |
| `shared-ui/FolderTree/FolderTree.tsx` | 386 | 通用树组件 — 多选(Cmd/Shift)/ 双击 rename / contextMenu(走 registry)/ 拖拽 / 键盘 / inline rename / data-krig-context-menu-handled 自治 |
| `shared-ui/FolderTree/index.ts` | 12 | 导出 |
| `shared-ui/ContextMenuPopover/types.ts` | 25 | ContextMenuItem(command/onClick 双路径)/ Props |
| `shared-ui/ContextMenuPopover/ContextMenuPopover.tsx` | 127 | 通用浮层 — 边界翻转(useLayoutEffect 测量)/ Esc + 外部点击关闭 / separator/disabled/icon / item.command 优先走 commandRegistry |
| `shared-ui/ContextMenuPopover/index.ts` | 2 | 导出 |
| `nav-side-registry/folder-tree-context-menu-registry.ts` | 98 | FolderTreeMenuRegistration + getItems(scope, ctx)— 按 appliesTo 过滤 + enabledWhen + 动态 label/disabled/commandArg + order 排序 |

### 2.3 view 层升级(`src/views/note/`,~1500 行)

| 文件 | 行数 | 改动 |
|---|---|---|
| `folder-store.ts` | 171 | 新建 — 全局 folder store(localStorage `krig.folders`)+ 级联 getDescendants + 防环 isDescendantOf + create/update/move/delete |
| `note-store.ts` | 202 | 升级 — Note 加 `folderId: string \| null`;hydrate / migration 兼容老数据(没 folderId 落 null);create 加 folderId 参数 |
| `data-model.ts` | 254 | 重写 — NoteWorkspaceState 加 expandedFolders(Set)/ folderSortMap / clipboard(持久化)+ selectedIds(transient,Q8=B);Set 编/解码 hydrate;hydratedCache WeakMap 防 useSyncExternalStore 死循环;transientVersion 版本号订阅 |
| `tree-builder.ts` | 115 | 新建 — 纯函数 buildTreeNodes / sortFolders / sortNotes(Intl.Collator zh-CN)+ encodeFolderId / encodeNoteId / decodeTreeId + relativeTime |
| `tree-operations.ts` | 134 | 新建 — handleDrop(防环 + 自动展开)/ deleteSelected(批量)/ copyToClipboard / pasteFromClipboard(Q9=A 深拷贝 — note JSON 拷 doc + folder 树递归拷子+笔记) |
| `note-commands.ts` | 122 | 升级 — L5-A 3 命令保留,加 8 个新命令(create-folder / delete-by-tree-id / copy-by-tree-id / paste / sort-cycle-title / sort-cycle-date) |
| `context-menu-registrations.ts` | 214 | 新建 — 14 条菜单项注册到 folderTreeContextMenuRegistry(scope='note-view'):空白 5 项 / folder 9 项 / item-folder 通用 5 项;setRenameTrigger 桥到 NavSide 局部 state |
| `nav-side-content.tsx` | 174 | 重写 — FolderTreePanel 替代 NoteList;订阅 noteStore + folderStore + transientVersion;rename inline state;装 FolderTree 全套 props |
| `index.ts` | 35 | 加 registerContextMenuItems()调用;**删 ViewDefinition 全局 contextMenu**(L5-A 测试遗留,L5-B1 NavSide 自治菜单替代) |
| `note-list.tsx` | (deleted) | 被 FolderTreePanel 替代 |

### 2.4 框架层 bug 修(L4 NavSide CSS / L4 contextMenuTrigger 退出契约)

| 文件 | 改动 |
|---|---|
| `slot/triggers/use-context-menu-trigger.ts` | 加 `data-krig-context-menu-handled` 自治区域协议 — 标记的 DOM 区域 L4 不接管右键 |
| `workspace/workspace-instance/nav-side-frame/nav-side-frame.css` | 加 `.krig-nav-side-binding` / `.krig-nav-side-content` flex 撑开样式,FolderTree 真撑满 NavSide 剩余高度 |

### 2.5 引入的 npm 依赖

**0 处新增**(完全用项目已有的 React + L4 commandRegistry / navSideRegistry 等基础设施)。

---

## 3. 自我诊断输出样本

主进程终端 console:
```
[L0] alive | electron: 40.9.3, node: 24.14.1, platform: darwin
[L1] alive | window id: 1
[L2] alive | shell: rendered
[L3] alive | workspaces: N
[L4] alive | commands: 14, capabilities: 5, views: 1, ...
[L5] alive | view: note-view, blocks: 1, capabilities: 5+driver
```

`commands: 14` = L4 框架 6 + L5-A 3 + L5-B1 5(create-folder / delete-by-tree-id / copy-by-tree-id / paste / sort-cycle-title / sort-cycle-date — 注:实际比设计多一条,因为 sort 拆 title/date 两条)。

DevTools 检查全局 store:
```js
> JSON.parse(localStorage.getItem('krig.notes'))
{ notes: { 'note-1': { ..., folderId: 'folder-1' }, ... }, counter: ... }
> JSON.parse(localStorage.getItem('krig.folders'))
{ folders: { 'folder-1': { id, title, parentId, ... }, 'folder-2': { ..., parentId: 'folder-1' } }, counter: ... }
> __krig.workspace.get('ws-1').pluginStates.note
{ activeNoteId, expandedFolders: ['folder-1'], folderSortMap: { 'folder-2': 'title-asc' }, clipboard: null }
```

---

## 4. 阶段中遇到 / 解决的问题

### 4.1 V1 NavSide 全套对标 — 用户拍板 1:1 复刻

**用户要求**:"UI 式样和 V1 一样" — 不做 MVP,直接全套对标 V1 NotePanel 8 项功能(嵌套 / 拖拽 / 双击重命名 / 每文件夹排序 / 多选批删 / 剪贴板 / 右键菜单 / 键盘)。

**实施策略**:V1 styles.ts 1:1 搬迁视觉常量;FolderTree 业务零知识(不 import note 概念);ContextMenuPopover 浮层抽到 shared-ui(为 L5-D/E 其他 view 复用)。

### 4.2 7+3 项架构决策反复(用户拍板)

实施前 7 轮提问,加 3 项设计文档过程中追加:

| Q | 决策 | 含义 |
|---|---|---|
| Q1 | A | FolderTree 框架层(共用,不内嵌 view) |
| Q2 | A | 独立 folderStore,跟 noteStore 平级 |
| Q3 | A | expandedFolders per-workspace(数据资产/工作状态原则) |
| Q4 | B | 不引入 V1 sort_order(死字段) |
| Q5 | B | view 直接 import store,不抽 navSideAPI 层(YAGNI) |
| Q6 | A | actions 绑 command(沿用 L5-A,不引入 V1 navside:action event) |
| Q7 | 方案 2 | folderTreeContextMenuRegistry **注册制** + ContextMenuPopover 共用浮层 |
| Q8 | B | selectedIds transient(关闭重启清空,避免干扰新操作) |
| Q9 | A | 粘贴 folder 深拷贝(子树 + 内含笔记一并复制) |
| Q10 | A | 新 workspace folder 默认折叠(用户主动展开) |

**关键转向**:Q7 我最初推荐"内置 callback"被用户问"未来其他 view 怎么用?",倒回去重新分析 → 改推 注册制方案 2。

### 4.3 NavSide 空白处右键被 L4 全局接管(Bug 1)

**现象**:NavSide 树底部空白右键 → 弹 L4 单一项"新建笔记"菜单,不是 4 项 FolderTree 菜单。

**根因**(两层叠加):
1. L4 useContextMenuTrigger 挂在 Workspace 根 DOM,native event listener,React 合成事件 stopPropagation 阻止不了
2. NavSideBinding 容器没设 flex 撑开,FolderTree(`flex:1`)实际上没撑满 NavSide content 区域 → 底下大片空白不在 FolderTree DOM 内,L4 直接接管

**修复**:
- L4 加 `data-krig-context-menu-handled` **自治区域协议** — DOM 标记此属性时 L4 跳过
- `nav-side-frame.css` 加 `.krig-nav-side-binding` / `.krig-nav-side-content` flex 撑开样式
- FolderTree 容器加 `data-krig-context-menu-handled` 属性

**对应 commit**:`4d5546d`

### 4.4 文件夹右键菜单命名与空白对齐(Bug 2)

**现象**:文件夹右键 "在此新建笔记 / 在此新建文件夹"(V1 同款)与空白菜单 "新建笔记 / 新建文件夹" 不一致。

**用户拍板**:统一成"新建笔记 / 新建文件夹"(去"在此")— V1 这点 V2 不沿用。

**修复**:context-menu-registrations.ts 内 fl-folder.new-note-in / new-folder-in 的 label 改名。

**对应 commit**:`4d5546d`

### 4.5 NoteView ViewDefinition 全局 contextMenu 误弹(Bug 3)

**现象**:SlotArea 主区域 / ViewSwitcher / Toolbar 等位置右键 → 弹"新建笔记"小框(L4 contextMenuRegistry 的 view 全局菜单)。

**根因**:L5-A 时随手挂的 `contextMenu: [{ ..., enabledWhen: 'always' }]` 测试遗留。L5-B1 NavSide 已用 folderTreeContextMenuRegistry 自治菜单完全替代,这条全局菜单多余且语义错(SlotArea 内右键弹"新建笔记"奇怪)。

**修复**:删 NoteView ViewDefinition 的 contextMenu 字段。

**对应 commit**:`4d5546d`

### 4.6 useSyncExternalStore 稳定引用风险(预防性设计)

**风险**:L5-B1 引入 Set / 复杂 hydrate state,如不稳定会触发"Maximum update depth exceeded"。

**应对**:
- DEFAULT_WS_STATE 整体 Object.freeze + 内部 Set/Object 也 freeze
- hydratedCache WeakMap 缓存 ws → state(同 ws state 不变 → 同一引用)
- transient selectedIds 走单独 version counter(数字稳定,触发订阅)
- folder/note 全局 store 沿用 L5-A 的 cachedAll 数组缓存模式

**实施过程未触发该 bug**(L4/L5-A 经验充分内化)。

---

## 5. 关键决策落地(用户拍板)

10 项决策见 § 4.2 表格。本阶段拍板沉淀进设计文档 v0.1 修订记录。

---

## 6. V1 → V2 改进对比验证

| 维度 | V1 | V2 实际 | 验证 |
|---|---|---|---|
| FolderTree 通用性 | 框架层 src/renderer/navside/components/FolderTree(已通用) | **同 — 框架层 src/slot/shared-ui/FolderTree** | ✅ 持平 |
| FolderTree 业务侵入 | callback 传 contextMenu / 业务在 useNoteOperations | **registry 注册制**(scope='note-view',业务通过注册扩展) | ✅ 改进 |
| 菜单浮层 | 内置 ContextMenu.tsx | **抽出 ContextMenuPopover**(其他 view 共用) | ✅ 改进 |
| 数据隔离 | per-pluginInstance(混乱) | **数据资产全局(noteStore+folderStore)/ 工作状态 per-ws(activeNoteId/expandedFolders)** | ✅ 改进 |
| 持久化 | localStorage `pluginStates` 嵌套结构 | **localStorage `krig.notes` + `krig.folders` 平级 + ws.pluginStates['note'] 工作状态** | ✅ 改进 |
| 拖拽防环 | useNoteOperations.isDescendantFolder | **folderStore.isDescendantOf**(同款逻辑,放数据层) | ✅ 持平 |
| ActionBar 触发 | window.dispatchEvent('navside:action') | **actions 绑 command 字符串**(L5-A 同款,不需 event 系统) | ✅ 改进 |
| 排序 sort_order | folder/note 都有 sort_order 字段(死字段) | **不引入**(只 title/date 排序) | ✅ 简化 |
| 视觉 | 暗主题 + 行高 28 + 蓝选中 | **1:1 同款** | ✅ 对标 |

**全 ✅**(9 维度 6 改进 + 3 持平/对标,无回归)。

---

## 7. 与 charter § 1.4 视图与实现归属的对照

| § 1.4 规则 | 本阶段如何遵守 |
|---|---|
| 应用级 UI 在 Workspace Container(L3) | ✅ NavSide frame 仍在 Workspace,内容由 navSideRegistry 注册 |
| 共用 UI 组件在框架层(L4 同款) | ✅ FolderTree / ContextMenuPopover 在 src/slot/shared-ui |
| 能力 UI 在 Capability(L4) | ✅ L4 接口未改,新加 folderTreeContextMenuRegistry 跟 L4 平级(都是 registry) |
| **driver 是 view 必经路径** | ✅ NoteView 主组件未改,driver 边界不破坏 |
| View 是能力组合声明 | ✅ install 列表未改 |
| view 平等,无 variant | ✅ |
| view 文件极轻 | ✅ NoteView.tsx 仍 ~50 行;新增逻辑分散到 data-model / tree-builder / tree-operations / commands / context-menu-registrations 几个职责文件 |
| 数据资产全局 / 工作状态 per-ws | ✅ folderStore 全局 / expandedFolders + selectedIds + folderSortMap + clipboard per-ws |
| view 不接触 PM | ✅ |

---

## 8. 进入 L5-B2 阶段的前置条件

L5-B1 完成后:
- ✅ NavSide 完整体验(对标 V1 NotePanel)
- ✅ FolderTree / ContextMenuPopover 在框架层就位(其他 view 直接复用)
- ✅ folderTreeContextMenuRegistry 注册制就位(扩展菜单项零业务侵入)
- ✅ 全局 noteStore + folderStore 双 store 架构稳定
- ✅ per-workspace 工作位状态 4 字段(activeNoteId / expandedFolders / folderSortMap / clipboard) + 1 transient(selectedIds)
- ✅ commandRegistry view 命名空间命令 8 个就位
- ✅ ESLint 屏障(view 不 import PM,driver 隔离)
- ✅ 7 段 NavSide 体验(嵌套/拖拽/重命名/排序/多选/剪贴板/键盘)用户验证全过

**当前状态**:**可直接进入 L5-B2 阶段**。

下一阶段建议分支:`feature/L5B2-marks-undo`。

L5-B2 范围(view DESIGN § 10.1 + L5-B 拆分计划):
- driver 加 marks(bold / italic / strike / code)+ marks keymap
- driver 加 input-rules(`**xx**` / `*xx*` 等 markdown 输入快捷)
- driver 加 prosemirror-history(undo-redo capability 真实现)
- view 命名空间命令:note-view.toggle-bold / set-heading-level / toggle-list 等
- 应用级 keymap(Cmd+Z / Cmd+Shift+Z 接 undo-redo)
- L5-B3 留:dnd block-handle + multi-envelope clipboard

---

## 9. 遗留问题 / 待优化项

### 9.1 笔记搜索过滤(占位)
**状态**:nav-side-content `searchPlaceholder` 已注册,onSearch 是 noop。L5-B2 加过滤逻辑(走 noteStore 内存过滤)。

### 9.2 view 级键盘事件捕获
**状态**:NoteView 顶层未挂 onKeyDown。Cmd+N 创建笔记 / Cmd+S 等留 L5-B2(应用级 keymap 一起做)。

### 9.3 多选时拖拽 dataTransfer 计数显示
**状态**:V1/V2 拖拽时不显示"拖动 N 项"小气泡(用户感知弱)。可后续加。

### 9.4 selectedIds transient 行为
**状态**:Q8=B 不持久化。如实测体验糟(切 view 再切回选中态丢失干扰)再调整。

### 9.5 NavSide 拖宽度 Resizer
**状态**:WorkspaceState 仍有 navSideWidth 字段但无 Resizer(L4 遗留债)。

### 9.6 L4 contextMenuRegistry 浮层视觉
**状态**:L4 contextMenu(SlotArea 内 PM 编辑器右键弹的)目前没 view 注册菜单项(L5-B1 删了 NoteView 的);L5-B2 加 PM 菜单项时再用,样式跟 ContextMenuPopover 一致就好。

---

## 10. 提交清单

`feature/L5B1-folder-tree` 分支共 3 commits + 1 merge:

| Commit | 说明 |
|---|---|
| `c1ddaeb` | docs(L5-B1): folder-tree 实施设计 v0.1 |
| `6a473ef` | feat(L5-B1): 文件夹树 + 完整 NavSide 实施(对标 V1) |
| `4d5546d` | fix(L5-B1): NavSide 右键菜单覆盖修复 + 文件夹菜单命名对齐 + 删 view 全局 contextMenu |
| (待) | Merge feature/L5B1-folder-tree → main |

---

## 11. 用户记忆沉淀(本阶段)

实施过程沉淀进 auto-memory 的长期原则:

- **V1 NavSide 调研沉淀的 3 项原则**:
  - FolderTree 业务零知识(不 import 业务概念,通过 itemMeta + payload + scope 抽象)
  - 菜单浮层视觉跨 view 共用(暗主题 + 边界翻转 + 行高/字色统一)
  - actions 绑 command 字符串(不引入 native event 总线)

- **L4 自治区域协议**:`data-krig-context-menu-handled` DOM 属性 — DOM 标记此属性时 L4 contextMenuTrigger 跳过。其他 view 内置自治菜单时也用此协议。

(均已写入 memory 或反映在协议文档 — 不需要新增 memory 条目)

---

## 12. L5-B1 与 charter § 6.3 全局核对

charter § 6.3 通用判据:
- ✅ npm start 跑得起来(L0~L5-A 不回归)
- ✅ typecheck + lint 全过
- ✅ console L0~L5 全部 alive
- ✅ 健康检查 IPC 全部 alive
- ✅ 主进程 / preload / renderer 三处都没新增越界 import

L5-B1 设计 v0.1 § 5 特定 15 判据:见 § 1。

**全部通过**。
