# L5-A NoteView PM 骨架 阶段完成报告

> 阶段:L5-A NoteView 第一个真实 view + text-editing-driver + 5 通用 capability + 1 个 block(textBlock)
> 分支:`feature/L5A-note-pm-skeleton`
> 完成日期:2026-05-05

---

## 1. 完成判据核对(view DESIGN v0.2.2 § 8 — 15 条)

| # | 判据 | 状态 | 验证方式 |
|---|---|---|---|
| 1 | `npm run typecheck` + `npm run lint` 全过 | ✅ | 实施末通过 |
| 2 | NoteView 出现在 ViewSwitcher(L4 navSideTab 显示) | ✅ | 视觉:Note tab 出现 |
| 3 | 点 ViewSwitcher Note → SlotArea 装载 NoteView | ✅ | 视觉:左 slot 显笔记界面 |
| 4 | 空白 NoteView 显"未选择笔记"占位 | ✅ | 视觉确认 |
| 5 | NavSide "+ 笔记" 按钮触发创建 | ✅ | 列表多一项 + SlotArea 显 PM 编辑器 |
| 6 | 用户能输入文字 + 回车换段(textBlock 编辑) | ✅ | 输入测试通过 |
| 7 | 标题自动从首段派生,列表实时更新 | ✅ | 输入"hello"列表立即显 hello |
| 8 | 列表点选笔记切换 SlotArea 内容 | ✅ | 视觉确认 |
| 9 | 右键笔记列表项删除(原生 confirm) | ✅ | 删除后列表少一项 |
| 10 | 右键 SlotArea → 显 V2 自定义菜单"新建笔记"项 | ✅ | L4 真菜单首次实测通过 |
| 11 | 刷新 npm start 后笔记和内容仍在(持久化) | ✅ | 重启 app 后笔记仍在(改用全局 noteStore + localStorage `krig.notes`) |
| 12 | 多 Workspace 切换 — 笔记内容共享 / 活跃 id 隔离 | ✅ | 架构修正后:笔记数据全局共享,activeNoteId per-workspace |
| 13 | DriverSerialized 信封正确(format/version/payload 格式) | ✅ | DevTools `__krig.workspace.<id>.pluginStates.note` + `localStorage['krig.notes']` 检查 |
| 14 | console `[L5] alive | view: note-view, blocks: 1, capabilities: 5+driver` | ✅ | renderer 启动确认 |
| 15 | 健康检查 `health.L5` 返回 alive | ✅ | DevTools `await window.electronAPI.health('L5')` |

**总评**:**通过**(15 条全 ✅)。

判据 #12 在实施过程中根据用户拍板("一台电脑只有一个人使用,一个人有什么必要隔离自己的数据?")做了**架构修正** — 见 § 4.5。

---

## 2. 该阶段实施的具体内容

### 2.1 V1 调研输出(2 篇研究文档)

| 文件 | 内容 |
|---|---|
| `docs/RefactorV2/research/V1-function-mapping.md` v0.2 | V1 笔记功能 → V2 capability 双轴映射(作用域 × 功能类型);capability 边界讨论的输入材料 |
| `docs/RefactorV2/research/V1-block-operations.md` v0.2 | V1 block 操作汇总(20+ 种);BlockSpec 设计输入(containerRule / cascadeBoundary 两个布尔字段的来源) |

**背景**:capability 设计前 7 轮反复中,用户 3 次让我先回去读 V1 实际代码(避免凭空设计)。这两篇研究是 driver/capability 协议的事实依据。

### 2.2 协议文档(4 篇)

| 文件 | 内容 |
|---|---|
| `src/capabilities/COMMON-PROTOCOL.md` v0.3 | 5 通用 capability 根协议 — 纯协议形态(register / channel / pure-read api),**不含 set/do API**;block 自治架构(capability 不执行操作) |
| `src/drivers/COMMON-DRIVER-PROTOCOL.md` v0.2.2 | driver 层协议 — 9 条铁律;DriverSerialized 信封;driver 是 view 必经路径 |
| `src/drivers/text-editing-driver/DESIGN.md` v0.2.1 | text-editing-driver 实施设计 — Host props 协议、模块结构、capability 集成方式 |
| `src/drivers/text-editing-driver/BLOCK-SPEC.md` v0.1.1 | block 子协议 — `containerRule` / `cascadeBoundary` / `id` / `displayName` / `spec` 5 字段 + 自治目录约定 |

加 view 实施设计 `src/views/note/DESIGN.md` v0.2.2(本阶段同步重写)。

### 2.3 capability 层(5 个,纯协议无内部状态)

每个 capability 的 `src/capabilities/<name>/index.ts` 只导出注册表 + 类型,**不实现具体动作**(由 driver/block 通过注册接管):

| capability | 关键导出 |
|---|---|
| `selection/` | `SelectionPayload`(discriminated union by kind);`selectionRegistry`(source pattern `<driver-id>:<instanceId>` — P1.3 修复) |
| `clipboard/` | `SerializerRegistration` + `PasteHandlerRegistration`;envelope 列表协议 |
| `undo-redo/` | scope 协议(`view-id.purpose` 命名);`undoScopeRegistry` |
| `drag-and-drop/` | sourceRegistry + dropTargetRegistry(目标 ContainerNode 自报 contentRule) |
| `insertion/` | `safeInsert` 包装 + safeguard 链(driver 注册 safeguard 拦截非法 insert) |

5 个加起来 ~190 行(纯类型 + 注册中心,不含运行时逻辑)。

### 2.4 driver 层(text-editing-driver,~13 文件 ~570 行)

| 文件 | 职责 |
|---|---|
| `index.ts` | 导出 `textEditingDriver`(含 `Host` 组件 + `register` API + 默认 block 列表) |
| `types.ts` | `TextEditingHostProps` / `TextEditingConfig`(P1.1:doc/onChange 走 DriverSerialized 信封,不暴露 PMDoc) |
| `Host.tsx` | 主 React 组件 — 管理 EditorView 生命周期 + capability 注册的 mount/unmount |
| `editor-view-builder.ts` | EditorView 构建逻辑(state / view / dispatchTransaction → onChange(serialized)) |
| `schema-builder.ts` | 从 BlockSpec 列表构建 PM Schema(textBlock 单个 spec → 完整 doc/text 节点) |
| `instance-registry.ts` | 模块级 EditorView 实例注册表(P1.2:命令路由查 active 实例,跨 view 切换不互相破坏) |
| `blocks/text-block/spec.ts` | textBlock BlockSpec — content: 'inline*' / containerRule: 'inline-only' / cascadeBoundary: false |
| `capability-integrations/selection-source.ts` | 注册 selection source `text-editing-driver:<instanceId>`(P1.3) |
| `capability-integrations/clipboard-handlers.ts` | **模块级单例** `clipboard.copy` / `clipboard.cut` / `clipboard.paste` handler — focus-aware 路由(避免实例 unregister 破坏其他实例) |
| `capability-integrations/undo-scope.ts` | 注册 undo scope(L5-A 占位 noop;prosemirror-history 留 L5-B) |
| `capability-integrations/dnd-targets.ts` | 注册 ContainerNode dropTarget(L5-A 占位;真 dnd 留 L5-B) |
| `capability-integrations/insertion-safeguards.ts` | 注册 insertion safeguard(检查 containerRule 拒绝非法插入) |
| `pm-host.css` | PM 容器样式(`white-space: pre-wrap` 等 PM 推荐基础样式) |

驱动 ~13 文件落地 driver 协议 9 条铁律 — DriverSerialized 信封贯穿 view↔driver 边界,view 不接触 PM 内部对象。

### 2.5 view 层(views/note,~9 文件 ~370 行)

| 文件 | 职责 |
|---|---|
| `index.ts` | self-register 入口 — registerView({ id: 'note-view', install: 5 capability + driver, ...}) + registerNoteCommands() + registerNavSide() + 初始化 noteStore |
| `NoteView.tsx` | view 主组件 — 订阅 noteStore + workspaceManager(activeNoteId),装 `textEditingDriver.Host` |
| `data-model.ts` | per-workspace activeNoteId helpers(`getNoteWsState` / `setActiveNote`)+ `DEFAULT_WS_STATE` Object.freeze 常量(防 useSyncExternalStore 死循环) |
| `note-store.ts` | **全局** noteStore — 跨 Workspace 共享笔记数据;localStorage `krig.notes`;auto-migration 从旧 pluginStates 读取(用户修正后加) |
| `note-commands.ts` | view 命名空间命令 — `note-view.create-note` / `note-view.delete-active` / `note-view.set-active`;`ensureNoteViewActive` 辅助(命令触发时若 left slot 不是 note-view 自动切换) |
| `nav-side-content.tsx` | navSideRegistry 注册 — title '笔记目录' / actions [+ 笔记] / contentRenderer (NoteList) |
| `note-list.tsx` | 笔记列表组件 — 订阅全局 noteStore + per-ws activeNoteId,onClick 切活跃 / onContextMenu 删除 |
| `note.css` | view 样式 |

### 2.6 ESLint 规则扩展

`eslint.config.js` 加 `drivers/` 目录规则:driver 内允许 import `prosemirror-*` / `react`,但 `views/` 仍禁止 import PM(强制走 driver 边界)。

### 2.7 渲染进程接入

`src/platform/renderer/index.tsx` 加:
```ts
import '@views/note';   // self-register 触发副作用
reportL5Alive();        // 启动末尾报 L5
```

### 2.8 引入的 npm 依赖

`prosemirror-state` / `prosemirror-view` / `prosemirror-model` / `prosemirror-keymap` / `prosemirror-commands` — driver 内部基础设施,view/capability 不直接依赖。

---

## 3. 自我诊断输出样本

主进程终端 console:
```
[L0] alive | electron: 40.9.3, node: 24.14.1, platform: darwin, ready: true
[L1] alive | window id: 1, size: 1200x800
[L2] alive | shell: rendered
[L3] alive | workspaces: 1, active: ws-1
[L4] alive | commands: 9, capabilities: 5, views: 1, contextMenu: 1, ..., navSide: 1, toolbar: 0
[L5] alive | view: note-view, blocks: 1, capabilities: 5+driver
```

`commands: 9` = L4 的 6 框架命令 + L5 的 3 个 view 命名空间命令(`note-view.create-note` / `delete-active` / `set-active`)。

健康检查 IPC(DevTools):
```js
> await window.electronAPI.health('L5')
{ alive: true, since: ..., errors: [], details: { view: 'note-view', blocks: 1, ... } }
```

DevTools 检查全局 store + per-workspace 状态:
```js
> JSON.parse(localStorage.getItem('krig.notes'))
{ notes: { 'note-1': { id, title, doc: { format: 'pm-doc-json', ... }, ... } }, counter: 1 }
> __krig.workspace.get('ws-1').pluginStates.note
{ activeNoteId: 'note-1' }   // per-ws 工作状态(不含数据)
```

---

## 4. 阶段中遇到 / 解决的问题

### 4.1 capability 协议设计反复 7 轮(用户教学)

实施前协议设计经历多轮迭代,核心被用户推翻的认知:
1. capability 不能"执行操作"(block 操作差异巨大,statically 抽不出共同动作)
2. block 是独立自演化模块(capability/driver 不该假设 block 实现)
3. text-editing 是 driver 不是 capability(view 必经路径,有装配责任)
4. PM 是 npm infrastructure(垂直依赖,不在分层架构内)
5. 用户数据全局,工作状态 per-workspace(见 § 4.5)

**取舍记录**:协议反复非技术债 — 是设计前对齐 architectural primitive 的成本,落地实施一次成型。

### 4.2 useSyncExternalStore "Maximum update depth exceeded" 白屏

**现象**:`npm start` 启动白屏,DevTools console 报"The result of getSnapshot should be cached"。

**根因**:`getNotePluginState(ws)` 在 ws.pluginStates['note'] 为 undefined 时返回 `defaultState()` — **每次调用返回新对象**,触发 useSyncExternalStore 死循环。

**修复**:把 `defaultState()` 改成 `Object.freeze` 模块级常量:
```ts
const DEFAULT_STATE: NoteWsState = Object.freeze({ activeNoteId: null }) as NoteWsState;
```

**对应 commit**:`0ade989`

### 4.3 SlotArea 空白(创建笔记后看不到编辑器)

**现象**:点 + 笔记 — NavSide 列表多了一项,但 SlotArea 仍空。

**根因**(双 bug 叠加):
1. SlotArea frame 的 background `#252525` 不透明,覆盖了 view 内容
2. `note-view.create-note` 命令只 createNote,不切 slotBinding.left = 'note-view' — 用户从 NavSide 操作时左 slot 可能还是别的 view

**修复**:
- frame 背景改透明(view 自管背景)
- 加 `ensureNoteViewActive(wsId)` helper — 命令触发时若 left ≠ 'note-view' 自动切换

**对应 commit**:`402f5c7`

### 4.4 PM 警告:white-space

PM 报"editor styles should include `white-space: pre-wrap`"— 加到 `pm-host.css`。

**对应 commit**:`f801f97`

### 4.5 架构修正:笔记数据应全局共享,不是 per-workspace

**用户拍板**:
> "一台电脑只有一个人使用,一个人有什么必要隔离自己的数据?navSide 是全局共享就够了,workspace 应该严格隔离。"

**背景**:DESIGN v0.2 把 `notes: Record<id, Note>` 放在 `pluginStates['note']`(per-workspace);Workspace 1 创建的笔记 Workspace 2 完全看不到 → 用户尝试在另一 Workspace 找笔记时报告 bug。

**修复**(refactor commit `af5aac8`):
- 抽 `note-store.ts` — 全局 store(localStorage `krig.notes`)
- per-workspace 只留 `activeNoteId`(用户在不同 Workspace 可以盯不同笔记 — 这是合理隔离)
- auto-migration:首次启动时若 localStorage 没 `krig.notes`,扫所有 workspace 的旧 pluginStates['note'].notes 合并成全局 store

**架构原则归位**(已写入用户记忆):
- **数据资产**(笔记内容)= 全局共享
- **工作状态**(当前看哪条 / 当前 scroll 位置)= per-workspace 隔离
- **应用级 UI**(NavSide / Toolbar)= 全局共享(L4 既有定位)

### 4.6 新 Workspace NavSide / SlotArea 空白

**现象**:用户报告 "workspace3 看不到 workspace2 创建的笔记?" — 实际是新建 Workspace 3 时 NavSide 全空 + SlotArea 全空。

**根因**:新 Workspace `slotBinding = { left: null, right: null }` — L4 设计 `activeViewId = state.slotBinding.left ?? state.slotBinding.right ?? null` 自然得到 null → NavSide / Toolbar / Overlay 全过滤掉,SlotArea 也无 view 可装。

**修复**(`WorkspaceInstance.tsx`):
```ts
let activeViewId = state.slotBinding.left ?? state.slotBinding.right ?? null;
if (!activeViewId) {
  activeViewId = viewTypeRegistry.getAllForNavSide()[0]?.id ?? null;
}
const effectiveSlotBinding = state.slotBinding.left
  ? state.slotBinding
  : { ...state.slotBinding, left: activeViewId };
```

view-type-registry 顺手加 `getAllForNavSide()`(过滤有 navSideTab 字段的)+ 按 `order` 排序。

**取舍**:不改 WorkspaceState — slotBinding 真实状态保持 null(避免 L3 持久化语义改变);只在渲染时 fallback,首次用户 click 任何 NavSide tab 后真实 slotBinding 写入。

**对应 commit**:`76bb777`

### 4.7 AI 审计 P1/P2(共 6 个未闭环问题修)

实施前请 AI 审计 driver / view 设计文档,找出 6 个 P1/P2 漏洞:
- **P1.1**:driver DESIGN 例码 `onChange(newState.doc)` 暴露 PMDoc — 修成 `onChange(serialized)` 走 DriverSerialized 信封
- **P1.2**:capability 命令 handler 实例 unregister 破坏其他实例 — 改成模块级单例 + focus-aware 路由
- **P1.3**:selection source 没区分实例 — 加 `instanceId` 后缀(`text-editing-driver:<instanceId>`)
- **P2**:`note-pm.create-block` vs `note-view.*` 命名空间不一致 — 全部统一 `note-view.*`
- **P2**:DESIGN 引用 `driver/DESIGN.md v0.4` 但实际 v0.2 — 跨文档版本对齐
- **P2**:capability 协议 v0.2 残留 set/do 动作 — 整体重写 v0.3

**对应 commit**:`28aef02` / `404653b`

---

## 5. 关键决策落地(用户拍板)

### 5.1 Q-N1 = B:driver 写进 install 列表

view 注册 `install: ['selection', ..., 'text-editing-driver']` — capability + driver 在 install 列表平等,声明性完整。运行时使用方式不同(capability 通过 channel/api 用,driver 通过 React 组件装)。

### 5.2 Q-N2 = A:Note.doc 用 DriverSerialized 信封

view 不持有 PMDoc 对象,只持有 `{format: 'pm-doc-json', version: '0.1', payload}` 信封。所有 PM 操作走 driver Host 组件。

### 5.3 Q-N3 = A:view 命名空间 `note-view.*`

view 注册 view 命名空间命令(create-note / delete-active / set-active);capability 命名空间命令(`clipboard.copy` / `undo-redo.undo`)由 driver 注册 handler,view 不重复。

### 5.4 Q-N4 = A:L5-A 完整范围(不分阶段)

不拆 L5-A0 / L5-A1 / L5-A2 — 一次实施完整笔记 CRUD + 单层列表 + textBlock 编辑 + 持久化。

### 5.5 Q-N5 = B:精简版 driver / view

driver 只装 textBlock 一个 block;view 只 single-flat list(不要 folder tree)。Marks / undo-redo 真实现 / dnd 真拖动 / 都留 L5-B。

### 5.6 用户主动拍板:数据资产全局,工作状态 per-workspace

DESIGN v0.2 原 per-workspace 模型(Q12=A 历史决策)被用户推翻。新架构原则见 § 4.5。

---

## 6. V1 → V2 改进对比验证

| 维度 | V1 | V2 实际 | 验证 |
|---|---|---|---|
| 笔记编辑器实现 | NoteView 975 行单文件,业务+PM+UI 混杂 | view (~370) + driver (~570) + capability (~190) 分层 | ✅ |
| view 文件大小 | 975 行 | ~50 行 NoteView 主组件 | ✅ |
| PM Schema 来源 | hardcode 在 view 内 | block 自治目录 + schema-builder 自动组装 | ✅ |
| 命令实现 | 散落 view 各处 | 强制走 commandRegistry(view 命名空间 + capability 命名空间分离) | ✅ |
| 跨实例命令路由 | V1 单实例无此问题 | 模块级 handler + instance registry(P1.2) | ✅ |
| view↔编辑器边界 | 直接持 EditorView 对象 + 调 PM API | 只通过 DriverSerialized 信封 + onChange callback | ✅ |
| 笔记数据隔离 | per-pluginInstance(混乱) | 全局 store(数据资产)+ per-workspace 工作状态(activeNoteId) | ✅ |
| 持久化 | localStorage `pluginStates` 复杂结构 | localStorage `krig.notes`(数据)+ `krig.workspaces.pluginStates.note.activeNoteId`(工作状态) | ✅ |

---

## 7. 与 charter § 1.4 视图与实现归属的对照

| § 1.4 规则 | 本阶段如何遵守 |
|---|---|
| 应用级 UI 在 Workspace Container(L3) | ✅ NavSide / Toolbar / 5 大交互浮层 frame **仍在 Workspace** |
| 能力 UI 在 Capability(L4) | ✅ 5 capability 注册中心已就位 |
| **driver 是 view 必经路径** | ✅ NoteView 装 textEditingDriver.Host,view 不接触 PM |
| View 是能力组合声明(L5) | ✅ NoteView install 列表声明 6 项(5 capability + 1 driver) |
| view 平等,无 variant | ✅ ViewDefinition 无 variant 字段 |
| view 文件极轻 | ✅ NoteView.tsx ~50 行,registerView 自动分发子字段 |
| 数据资产全局 / 工作状态 per-workspace | ✅ noteStore 全局 / activeNoteId per-workspace |

L5-A 阶段严格遵守 § 1.4,**未越界**。

---

## 8. 进入 L5-B 阶段的前置条件

L5-A 完成后:
- ✅ 5 capability + 1 driver 全就位(协议形态完整)
- ✅ NoteView 第一个真实 view 跑通(navSide / SlotArea / overlay 真菜单首测通过)
- ✅ DriverSerialized 信封贯穿 view↔driver 边界
- ✅ 全局 noteStore + per-workspace activeNoteId 架构落地
- ✅ commandRegistry 命名空间隔离(view.* 与 capability.*)
- ✅ ESLint 屏障(view 不 import PM,driver 隔离 PM)
- ✅ HEALTH_L5 IPC + L5-alive 诊断

**当前状态**:**可直接进入 L5-B 阶段**。

下一阶段建议分支:`feature/L5B-folder-marks-undo`。

L5-B 范围(view DESIGN § 10.1):
- NavSide 升级到 FolderTree(承袭 V1 NotePanel 模式)+ 文件夹 CRUD + 移动笔记到文件夹
- driver 加 marks(bold / italic / strike / code)+ marks keymap + view 命名空间 `note-view.toggle-bold` 等命令
- driver 加 prosemirror-history(undo-redo capability 实施 scope)
- driver 加 dnd block-handle 拖动手柄
- driver 加 input-rules
- multi-envelope clipboard + paste dispatcher

---

## 9. 遗留问题 / 待优化项

### 9.1 undo/redo 占位 noop
**状态**:driver capability-integrations/undo-scope.ts 注册 scope 但内部是 noop(L5-B 加 prosemirror-history)。
**说明**:不算债 — 协议层就位,实现等 L5-B。

### 9.2 dnd 占位
**状态**:capability-integrations/dnd-targets.ts 占位,真实 dnd 留 L5-B(block-handle 拖动)。

### 9.3 笔记搜索过滤
**状态**:nav-side-content 注册 `searchPlaceholder` 但 onSearch 是 noop(L5-A 范围外)。

### 9.4 多 envelope clipboard
**状态**:clipboard handler 单 envelope(plain PM doc JSON),L5-B 加 multi-envelope + paste dispatcher 走 capability 协议。

### 9.5 view 级键盘事件捕获
**状态**:NoteView 顶层未挂 onKeyDown(view DESIGN § 11.1 风险列条);Cmd+N 创建笔记等 view 级快捷键留 L5-B。

### 9.6 笔记重命名 UI
**状态**:L5-A 标题自动派生(从 doc 第一段),无显式重命名 UI(L5-B+ 真有需求时加)。

### 9.7 NavSide 拖宽度 Resizer
**状态**:WorkspaceState 有 `navSideWidth` 字段但仍无 Resizer 组件(L4 留下来的债,L5-B 一并加)。

### 9.8 应用级 keymap(undo/redo 等)
**状态**:driver Host 内 PM keymap 已挂,但 view-scope 之外的 Cmd+Z 还没接(L5-B undo-redo 真实现时一起做)。

---

## 10. 提交清单

`feature/L5A-note-pm-skeleton` 分支共 18 commits + 1 merge,按阶段分类:

### 10.1 V1 调研

| Commit | 说明 |
|---|---|
| `b2ec996` | docs(refactor-v2): V1 笔记功能 → V2 capability 映射研究 v0.1 |
| `167da43` | docs(refactor-v2): V1 → V2 capability 映射研究 v0.2(按作用域重写) |
| `1c7f25e` | docs(refactor-v2): block 操作专题独立 — V1-block-operations.md 骨架(v0.1) |
| `cce2ae7` | docs(refactor-v2): V1-block-operations.md v0.2 填肉完成 |

### 10.2 协议文档(经历 7 轮反复后定稿)

| Commit | 说明 |
|---|---|
| `4357284` | docs(capabilities): COMMON-PROTOCOL.md v0.1 — 5 通用 capability 根协议 |
| `ce9be08` | docs(capabilities): COMMON-PROTOCOL.md v0.2 — 整体重写(block 自治架构) |
| `6f57369` | docs(architecture): COMMON-PROTOCOL.md v0.3 + 新增 drivers/COMMON-DRIVER-PROTOCOL.md v0.1 |
| `eeacb08` | docs(architecture): driver 协议 v0.1 → v0.2(协议闭环修订) |
| `452b50b` | docs(text-editing-driver): Step 2 + 2.5 — DESIGN.md v0.1 + BLOCK-SPEC.md v0.1 |
| `5ef331c` | docs(views/note): NoteView DESIGN.md v0.1 → v0.2 整体重写(driver 架构对齐) |
| `404653b` | docs: AI 审计 6 个 P1/P2 修复(driver 协议 + driver DESIGN + view DESIGN) |
| `28aef02` | docs: AI 复审 4 个未闭环问题修复(P1 双向契约 + P1 协议残留 + P2 文档冲突 + P2 跨文档版本) |

### 10.3 实施 + 修复

| Commit | 说明 |
|---|---|
| `59e4852` | feat(L5-A): NoteView + text-editing-driver + 5 capability 完整实施 |
| `0ade989` | fix(L5-A): NoteView 死循环 — defaultState 返回冻结常量引用 |
| `402f5c7` | fix(L5-A): SlotArea frame 不透明背景遮挡 view 内容 + 创建/切笔记自动激活 NoteView |
| `f801f97` | fix(L5-A): PM 推荐 white-space: pre-wrap |
| `af5aac8` | refactor(L5-A): 笔记数据从 per-workspace 提到全局 store(架构修正) |
| `76bb777` | fix(L5-A): 新 Workspace 默认 fallback 显示首个 view 的 NavSide + SlotArea |
| `270a3c6` | Merge feature/L5A-note-pm-skeleton — L5-A NoteView PM 骨架完整实施 |

---

## 11. 用户记忆沉淀(本阶段定下的长期原则)

实施过程中用户拍板沉淀进 auto-memory(供未来阶段参考):

- **数据资产全局,工作状态 per-workspace**:一台电脑一个人使用,一个人无必要隔离自己的数据;NavSide 全局共享够,Workspace 严格隔离的是工作状态(activeNoteId / 视图位置等),不是数据本身。
- **block 自治目录**:每个 block 独立 src 目录(spec / commands / view / styles 全在内),driver 不假设 block 实现细节。
- **driver 是 view 必经路径**:view 不直接持有 PM(或其他垂直引擎),只通过 driver Host 装配 + DriverSerialized 信封交互。
- **capability 不执行操作**:capability 是协议形态(register / channel / pure-read api),没有 set/do API;具体操作由 block 注册接管。
- **useSyncExternalStore 必须返回稳定引用**:fallback / default 用 Object.freeze 模块常量,不要每次 new 一个新对象。

---

## 12. L5-A 与 charter § 6.3 全局核对

charter § 6.3 通用判据:
- ✅ npm start 跑得起来(L0-L4 不回归)
- ✅ typecheck + lint 全过
- ✅ console L0/L1/L2/L3/L3.5/L4/L5 全部 alive
- ✅ 健康检查 IPC L0~L5 全部 alive
- ✅ 主进程 / preload / renderer 三处都没新增越界 import

view DESIGN § 8 特定判据:见 § 1。

**全部通过**。
