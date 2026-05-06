# V1 笔记功能 → V2 Capability 映射研究

> **研究目的**:把 V1 笔记模块已实现的全部用户能力,按"操作作用域"重新组织,然后映射到 V2 capability 实施层,为后续 PROTOCOL.md / DESIGN.md 提供素材。
>
> **不是**:V1 代码搬迁清单 / 实施步骤 / API 规范。
>
> **是**:**抽象推演** —— 双轴坐标(作用域 × capability)让"V2 怎么重构"和"用户怎么用"都清楚,后人补功能时按作用域定位行、按 capability 定位列,哪格空了补哪格。
>
> **方法论决定**:本文档骨架按**操作作用域**(用户视角)而非**动作类型**(工程视角),理由见 § 0.2。
>
> 文档版本:v0.2
> 编写日期:2026-05-05
> 上下文:L5-A 阶段,在 NoteView / capability 实施前先定边界

---

## 0. 研究方法

### 0.1 我读了 V1 哪些代码

深读(行级别理解):

| 文件 | 看的是什么 |
|---|---|
| `src/plugins/note/components/NoteView.tsx` | view 层职责 / viewAPI 调用面 / 状态散落点 / 跨 view 通信 |
| `src/plugins/note/components/NoteEditor.tsx` | PM 装配 / plugin 顺序 / handle 接口 / converter 调用 |
| `src/plugins/note/plugins/block-selection.ts` | 块级选择(与 PM 字符级选区并行的第二种模式) |
| `src/plugins/note/commands/selection-cache.ts` | 选区临时方案 — V1 没把 selection 当 capability 的症状 |
| `src/plugins/note/commands/selection-to-markdown.ts` | doc + 选区 → markdown,30+ 节点 case 全 hardcode |
| `src/plugins/note/paste/smart-paste-plugin.ts` | dispatcher 模式 / 多 source handler |
| `src/plugins/note/paste/internal-clipboard.ts` | 内部剪贴板通道 / HTML 嵌入 marker / 多 envelope |
| `src/plugins/note/plugins/link-click.ts` | 笔记内导航(history 栈)+ 跨 view 路由 |
| `src/plugins/note/plugins/slash-command.ts` | 触发机制(扫描 / 字符,IME 友好) |
| `src/plugins/note/plugins/block-handle.ts` | 拖动手柄 / 拖放语义 / 跨容器移动 |
| `src/plugins/note/ai-workflow/sync-note-receiver.ts` | 业务流 capability 雏形(AI → 节点工厂 + 插入) |
| `src/plugins/note/navside/NotePanel.tsx` | NavSide 文件夹树 / 拖放 |
| `src/plugins/graph/canvas/edit/GraphEditor.ts` | **关键对照** — graph 也用 PM,共享 80% plugin |

走马观花:`blocks/`(30+ 块定义)/ `converters/`(双向 atom ↔ PM 节点)/ `commands/*`。

未读(明确不在范围):graph 大部分 / `web/` / `ebook/` / `ai/` —— 留 L6+ 真接 capability 时再深入。

### 0.2 为什么按"作用域"分类(而不是按"动作类型")

最初草稿(v0.1)按 "selection / clipboard / undo / dnd / insertion" 五大动作分类,**这是工程视角**。用户提出更好的方案:**按操作作用域(节点内 / 容器内 / 多 block / 跨文档)分类**。

两种分类对比:

| 维度 | 动作类型(工程视角) | 作用域层次(用户视角) |
|---|---|---|
| 出发点 | "用户在干什么动作" | "操作发生在什么作用域" |
| 一个功能在哪 | 横切型 — 跨多个章节(如多块拷贝在 selection 章 + clipboard 章各一条) | 纵切型 — 一个章节一条 |
| 补充新功能 | 要判断"是新动作还是已有动作"(可能漏判) | 直接定位作用域,加到那章 |
| 抽象稳定性 | 动作类型可能后期发现需要拆 | 作用域是结构性的,稳定不变 |
| 与 PM 数据模型对齐 | 不对齐 | **天然对齐 PM inline / block / container 三层结构** |
| 与 V2 atom / basic block 对齐 | 不对齐 | **天然对齐** |

更深的洞察:作用域分类是**问题域的拓扑**(节点 → 容器 → 多 block → 跨文档),动作分类是**解决方案的功能模块**。前者随用户感知稳定,后者随实现演化。

但**两者不是对立的**——作用域是用户视角,动作类型(capability)是工程实施视角,它们是**正交的两轴**。本文 § 4 用一张矩阵把两轴显式连起来:行 = 作用域,列 = capability,每格一个具体功能。这样:
- 用户视角:按行读,看"这个作用域有哪些能力"
- 工程视角:按列读,看"这个 capability 在各作用域提供什么"
- 后人补功能:先定位行,再决定列,哪格空补哪格

### 0.3 关键概念定义

为本文一致性,先定义边界:

**节点(node)**:PM inline node,即一段文字内的最小元素 — text / mathInline / hardBreak / link mark 包裹的内容。1.a "节点内"指的是这一层。

**basic block / 容器**:V2 的 basic block ≈ PM block node,即 textBlock / image / codeBlock / mathBlock / 等"作为整体存在的块"。1.b "容器内"指的是这一层 — 用户感知是"一个段落"、"一个图片"、"一张表格"作为整体的所有动作。

**多 block**:跨多个 block 的操作(无论这些 block 同容器还是跨容器,1.c 不细分)。

**文档(document)**:**一个 view 实例所操作的内容单元**。
- NoteView 当前打开的某条笔记 = 一个文档
- 切到另一条笔记 = 切文档(同 view 类型不同 document)
- 切到 GraphView = 切到另一 view 类型 + 另一文档

§ 1 / § 2 边界 = view 实例边界 = L3.5 workspace-bus 边界(bus 就是为跨 view 实例通信而生)。

**capability**:V2 的能力模块,分两层(charter § 1.4 + 用户拍板):
- **通用交互 capability**:任何 view 都用(selection / clipboard / undo-redo / drag-and-drop / insertion)
- **内容特定 capability**:对应一种内容形态(text-editing / graph-editing / file-management / ...)

---

## 1. 文档内(view 实例内部交互)

按节点内 / 容器内 / 多 block 三层组织。

### 1.a 节点内(inline 层)

发生在 PM inline node 层 — 一段文字内的所有用户动作。

| 用户能力 | V1 实现位置 | 关键观察 |
|---|---|---|
| 字符级光标移动 | PM 内置 + `prosemirror-commands` baseKeymap | 标准 PM,无特殊 |
| 字符级选定(鼠标拖选 / 键盘 shift+方向键)| PM 内置 + `selection-cache.ts:startMouseSelectionTracker` | 鼠标拖选不经 dispatchTransaction,V1 单独监听 mouseup |
| 输入文字 | PM 内置 | — |
| Backspace / Delete 删字符 | PM 内置 + baseKeymap | — |
| 拷贝(选中文字)| `paste/internal-clipboard.ts:writeKrigDataToTransfer` | 多 envelope:PM JSON / HTML / 纯文本 |
| 粘贴(到光标) | `paste/smart-paste-plugin.ts` | dispatcher + handler 注册 |
| 剪切 | PM 内置 → 复用 copy + delete | — |
| inline 格式化(粗体 / 斜体 / 下划线 / 删除线 / inline code)| `NoteEditor.tsx` markKeymap(`Mod-b/i/u/Mod-Shift-s/Mod-e`)+ `prosemirror-commands.toggleMark` | mark 应用到选区 |
| 链接(添加 / 编辑 / 删除)| `components/LinkPanel.tsx` + link mark | 弹层 UI + 应用 link mark |
| 颜色 | `components/ColorPicker.tsx` + textStyle mark | — |
| 高亮 | highlight mark | — |
| inline 数学公式 | `blocks/math-inline.ts`(inline atom node)| 把 latex 包装成 inline atom |
| inline 笔记内链 noteLink | `blocks/note-link.ts` + `plugins/note-link-command.ts`(`[[` 触发) | inline atom node + 触发面板 |
| hardBreak(`Shift+Enter`)| markKeymap | inline 节点,不换段 |
| 撤销 / 重做(节点内编辑)| `prosemirror-history` + `Mod-z/Mod-Shift-z` | PM history plugin |
| 选区缓存(右键菜单折叠选区时)| `commands/selection-cache.ts` | **V1 病例 —— V2 不要**(L3.5 channel lastValue 替代) |
| input-rules(自动转换)| `plugins/input-rules.ts` | 如 `**foo**` 自动转 bold mark |

### 1.b 容器内(block 层 — basic block)

发生在 PM block node 层 — 一个 block 作为整体的动作。

| 用户能力 | V1 实现位置 | 关键观察 |
|---|---|---|
| 选中整块(ESC 进入块选模式)| `plugins/block-selection.ts` | **V2 selection 必须支持的多模态**(字符 / 块) |
| 整块拷贝 | 与 1.a 共用 `internal-clipboard.ts`,但选区是块级 | 同一通道,不同选区源 |
| 整块粘贴(粘到光标位置)| 与 1.a 共用 | — |
| 整块删除(块选中后 Delete)| `commands/editor-commands.ts:deleteBlocks` | 块选中模式下 Delete 删整块 |
| 整块拖动手柄 | `plugins/block-handle.ts` | 鼠标 hover 显手柄,可拖动 |
| 整块拖动重排(同容器内)| 同上 | KRIG_SOURCE_POS_MIME 标记原位置 |
| 块格式化:切标题级别(`Mod-Alt-0/1/2/3`)| `commands/set-text-block-level.ts` | 把 textBlock 的 level attr 改 1/2/3/null |
| 块格式化:首行缩进(`Shift+Mod-i`)| `commands/editor-commands.ts:toggleTextIndent` | textBlock 的 textIndent attr |
| 块创建(Enter 在末尾换段)| `containerKeyboardPlugin` + baseKeymap | 创建空 textBlock |
| 块合并(Backspace 在块首)| `containerKeyboardPlugin` + baseKeymap | 与上一块合并 |
| 块折叠(标题折叠)| `plugins/heading-collapse.ts` | UI 状态 — 折叠不影响数据 |
| 块折叠(列折叠)| `plugins/column-collapse.ts` | 同上 |
| 块折叠(toggle list)| `blocks/toggle-list.ts` | open attr |
| 各种特殊 block 类型创建 | `plugins/slash-command.ts` + SlashMenu | `/` 触发菜单选 block 类型 |
| input-rules 自动建块 | `plugins/input-rules.ts` | 如行首 `# ` → heading,`- ` → list |
| 30+ block 节点定义 | `blocks/*.ts` | textBlock / heading / list / table / image / video / audio / file / code / math / callout / blockquote / column-list / toggle / frame / external-ref / page-anchor / tweet / horizontal-rule / hard-break / mermaid / html-block / file-link / etc. |
| block 渲染(NodeView)| 各 `blocks/*.ts` 自带 nodeView 工厂 | block 自定义 DOM 渲染 |
| 块拖动到容器内(callout / list / table cell) | `plugins/block-handle.ts` + `dropPoint` | 跨嵌套层级落点解析 |

### 1.c 多 block(跨多个 block)

涉及多个 block 的操作 —— 无论同容器兄弟还是跨容器(同一处理)。

| 用户能力 | V1 实现位置 | 关键观察 |
|---|---|---|
| 多块选择(Shift+↑/↓ 扩展选区)| `plugins/block-selection.ts` | anchorPos + selectedPositions[] |
| 多块拷贝 | `internal-clipboard.ts:computeSliceForClipboard` 走 block-selection 范围 | 输出 PM Slice + 多 envelope |
| 多块粘贴 | `smart-paste-plugin.ts` 处理 Slice | maxOpen 计算开放深度防止破坏目标祖先 |
| 多块删除 | `commands/editor-commands.ts:deleteBlocks` | 批量删除 |
| 多块拖动 | block-handle 携多 source 信息 | (V1 实际场景较少) |
| 多块格式化(批量加 mark / 改 level)| 通过 markKeymap 在 block-selection 模式下作用 | 批量 toggleMark |
| 多块缩进(`Tab` / `Shift+Tab` 移动列表层级)| `plugins/indent.ts` | 批量改 list 层级 |
| 选区 → Markdown 序列化 | `commands/selection-to-markdown.ts`(30+ 节点 case)| 给 AI / 跨工具 |
| 选区缓存(块选模式)| `commands/selection-cache.ts` 也覆盖块选 | V1 病例延伸 |
| 撤销 / 重做(批量操作)| `prosemirror-history` 自动 | history 自然支持批量 |
| 跨容器移动 | block-handle drop 到跨容器位置 | 落点解析处理嵌套 |

**关键观察 1.c**:V1 的 1.c 操作大多复用 1.b 的机制,只是"selection 范围"从单块扩展到多块。V2 应该让 selection capability **统一支持单块 / 多块 / 字符级选区**(channel discriminated union by `kind`),其他操作(clipboard / drag / undo)对接同一 selection。

---

## 2. 跨文档(view 实例之间通信)

走 L3.5 workspace-bus(channel / request / slot control)。

### 2.a 笔记 ↔ 笔记(同 view 类型,不同 document)

| 用户能力 | V1 实现 | V2 路径 |
|---|---|---|
| 行内笔记链点击(`📄 标题`)| `plugins/link-click.ts` + `viewAPI.noteOpenInEditor` | bus.openRight('note', { noteId })(主 view 不偷换) |
| 行内笔记链动态显示标题 | `blocks/note-link.ts:noteLinkNodeView` 异步加载 | bus channel `note.title.changed` 订阅 |
| 笔记内 block 锚点跳转(`krig://block`)| `link-click.ts:scrollToBlockAnchor` + `flushPendingAnchor` | 同 view 内滚动 — 不需要 bus |
| 笔记导航 history(back/forward)| `link-click.ts` 模块全局变量(**V1 病例**)| view 内状态(挂 NoteView 实例 / pluginStates) |
| 在右 slot 打开笔记 | `viewAPI.noteOpenInRightSlot` IPC | bus.openRight('note', { noteId, payload }) |
| 创建笔记后切到主 view | `viewAPI.noteCreate + noteOpenInEditor` | 命令 + bus.slot.openLeft 不允许 → 直接更新 slotBinding.left(由 NavSide ViewSwitcher 路径) |

### 2.b 跨 view 类型(笔记 ↔ 图谱 / eBook / AI / Web / ...)

| 用户能力 | V1 实现 | V2 路径 |
|---|---|---|
| 笔记 ↔ eBook 锚定同步(PDF 页码)| `NoteView.tsx` 内 anchor-sync(`viewAPI.sendToOtherSlot` / `onMessage`,**协议字段字符串路由**)| bus channel `anchor.changed { source: 'ebook' \| 'note', pageOrPos }` |
| 笔记 ↔ thought 派生 | `plugins/thought-plugin.ts` + `commands/thought-commands.ts` | bus request `thought.create { fromSelection, anchor }` |
| 笔记选区 → AI 总结 / 翻译 | `commands/ask-ai-command.ts` + `selection-to-markdown.ts` | bus request `ai.summarize / ai.translate { markdown, images }` → AI capability |
| AI 抓取追加到笔记 | `ai-workflow/sync-note-receiver.ts`(`as:append-turn`)| bus request `note.appendTurn { turn, source }` 或 channel + 监听 |
| Web 抓取 → 笔记 | 同上(AI 工作流上游) | 同上 |
| 笔记拖到图谱当节点(L6+)| (V1 未实现) | bus + drag-and-drop capability 跨 view dropTarget |

### 2.c slot 通信(双 slot 协作)

| 用户能力 | V1 实现 | V2 路径 |
|---|---|---|
| 主从 slot 关系 | `viewAPI.getMyRole`('primary' \| 'companion')| L3.5 SlotControl(铁律 5 - 主 view 不偷换)+ slotBinding 字段 |
| 双 slot 广播 | `viewAPI.sendToOtherSlot + onMessage`(**单管道协议字符串路由**)| 多个独立 channel(L3.5 channel 设计目标)|
| 双 slot 探测对方在线 | `as:probe` / `as:note-status` 协议 | bus channel `view.lifecycle { open, viewId }`(L5+ 加)|
| Slot 位置锁(单/双 slot 模式切换)| `viewAPI.getSlotLock / setSlotLock + onSlotLockChanged` | L3.5 SlotControl + Workspace state |
| 双 slot 滚动联动 / 解联 | `NoteView.tsx` anchor-sync handleScroll + slotLockedRef | bus channel + view 内根据自己角色决定是否发射 |
| Slot 切换 / 关闭 | `viewAPI.closeSelf` | bus.slot.closeRight / closeLeft(L3.5 已建) |

### 2.d 跨进程 / 跨外部边界

| 用户能力 | V1 实现 | V2 路径 |
|---|---|---|
| 持久化(笔记 / 书签 / 阅读位置 / 文件夹树)| `viewAPI.noteSave / noteSaveBookmarks / noteSaveLastView / etc.` IPC → 主进程 SurrealDB | L3 pluginStates + L3 PersistenceAPI(localStorage / 未来切 SurrealDB) |
| AI 调用(主进程)| `viewAPI.aiParseMarkdown` IPC | L6+ AI capability + IPC |
| Web 抓取(主进程)| 各 paste source handler | L6+ Web capability + IPC |
| 文件系统访问 | `viewAPI` 包装 IPC | L6+ FileSystem capability + IPC |
| 主进程命令(quit / minimize / reload)| L4 framework menu commandRegistry | (已建) |

---

## 3. V1 病例反向警示(7 条)

按新分类重新归位。

### 3.1 selection 散落(影响 1.a / 1.b / 1.c 全层)

**症状**:`block-selection.ts`(块级)+ `selection-cache.ts`(快照)+ `selection-to-markdown.ts`(序列化)各管一摊。

**作用域归属**:跨 1.a / 1.b / 1.c 三层(选定动作贯穿三层)。

**反面警示**:V2 必须把 selection 提成通用 capability,**channel 用 discriminated union by `kind`** 同时支持字符级 / 块级 / 多块,UI 层订阅一条 channel 不需要管底下哪种模式。lastValue 替代 selection-cache trick。

### 3.2 clipboard 散落(影响 1.a / 1.b / 1.c / 2 全层)

**症状**:`smart-paste-plugin`(粘贴 dispatcher)+ `internal-clipboard`(KRIG 内部通道)+ `paste/sources/*`(多 handler)+ `paste-media`(图片)各处不一。

**作用域归属**:**全部作用域**(内部复制粘贴 + 跨文档复制粘贴 + 跨外部应用)。

**反面警示**:V2 clipboard capability 把这一切收编 — **多 envelope copy**(原生 PM JSON / Markdown / HTML / 纯文本同时写)+ **dispatcher + handler 注册制**(任何 capability 注册自己的 PasteHandler)+ **DataTransfer 抽象**(给 drag-and-drop 复用)。

### 3.3 undo/redo 双份重复(影响 1.a / 1.b / 1.c)

**症状**:`history()` plugin 在 NoteEditor 装一份,GraphEditor 又装一份。两栈互不感知。

**作用域归属**:1 全部(节点内 / 容器内 / 多 block 都要 undo)。

**反面警示**:V2 undo-redo capability 提供**全局接口**,具体实现 per-view 栈;text-editing 通过 capability 注册"我的 undo 实现",未来 graph-editing 同。

### 3.4 viewAPI 全局窗口接口(影响 2 全层)

**症状**:`(window as any).viewAPI` 散布每个 plugin / component。所有跨边界通信靠它。

**作用域归属**:跨文档(2)+ 跨进程(2.d)的所有路径。

**反面警示**:V2 严禁 window 全局后门。**跨 view → bus**(L3.5 已建);**跨进程 → preload + electronAPI**(L0 已建);**框架命令 → commandRegistry**(L4 已建)。

### 3.5 sendToOtherSlot 协议混用(影响 2.c)

**症状**:`viewAPI.sendToOtherSlot(payload)` 用 `payload.protocol` 字符串字段区分(`ai-sync` / `anchor-sync` / `note-thought` 共用一个广播总线)。NoteView 一个 onMessage 监听器同时处理多种协议。

**作用域归属**:2.c slot 通信全部。

**反面警示**:L3.5 workspace-bus channel 设计就是为了根治 — **每个跨 view 主题一条独立 channel**,payload 类型化,无字符串路由。

### 3.6 link-click 导航栈 module-global state(影响 2.a)

**症状**:`plugins/link-click.ts` 顶部 `const history: NoteHistory = {...}` 是 module 级全局,跨 NoteView 实例共享。Workspace A 后退栈污染 Workspace B。

**作用域归属**:2.a 笔记 ↔ 笔记(导航 history 跟踪)。

**反面警示**:V2 任何"view 范围状态"挂 view 实例 / pluginStates / WorkspaceState,绝不放 module 全局。

### 3.7 active-state 三处镜像(影响 1 全部 + 2.c)

**症状**:笔记 active 状态同时存于 `activeNoteIdRef` + `activeNoteIdState` + `navside/store/active-state-store.ts` + 主进程 workspace.json。四处靠 IPC 对齐,大量竞态保护代码。memory `project_active_resource_id_arch_debt` 已记。

**作用域归属**:1 文档内(view 自管 active)+ 2.c slot 通信(双 slot 各自 active)。

**反面警示**:V2 单一来源 — view 直接读 pluginStates,改写 pluginStates,manager 自动持久化 + 通知。**禁止把同一状态镜像到 ref / state / store**。

---

## 4. 双轴映射矩阵 — 作用域 × Capability(关键章节)

把 § 1 / § 2 的"用户视角作用域"翻译成"V2 工程视角 capability 实施层"。**这张矩阵是 § 1 和 § 5 之间的桥梁**。

读法:
- 行 = 作用域(1.a 节点内 / 1.b 容器内 / 1.c 多 block / 2.a-d 跨文档子类)
- 列 = capability(5 通用 + 1 内容特定 + view 业务)
- 单元格 = 该作用域 × 该 capability 提供什么具体能力

```
                        通用交互 capability ────────────────────────────────┐    内容特定        │  view/业务
                        selection │ clipboard │ undo-redo │ drag-drop │ insertion │ text-editing │  (NoteView 等)
─────────────────────── ───────────│──────────│───────────│──────────│───────── │ ────────────│ ──────────────
1.a 节点内              字符 sel   │ 文字粘贴 │ 文字 undo │   —      │ 文字插入 │ inline schema │   —
                        (kind=text)│ 多 envelope│             │          │          │ + marks +     │
                                   │           │             │          │          │ inline atoms  │
─────────────────────── ───────────│──────────│───────────│──────────│───────── │ ────────────│ ──────────────
1.b 容器内              块 sel     │ 整块拷贝 │ 块创建    │ 块拖动   │ 块插入   │ block schema  │   —
                        (kind=block)│           │ undo        │ 单容器内 │          │ + nodeView    │
                                   │           │             │          │          │ + commands    │
─────────────────────── ───────────│──────────│───────────│──────────│───────── │ ────────────│ ──────────────
1.c 多 block            多块 sel   │ 跨块拷贝 │ 批量 undo │ 多块拖动 │ 批量插入 │ (节点工厂)    │   —
                        (kind=     │ Slice 处理│             │ 跨容器   │ 安全守卫 │               │
                         multi-blk)│           │             │          │ pasteIsSafe│            │
─────────────────────── ───────────│──────────│───────────│──────────│───────── │ ────────────│ ──────────────
2.a 笔记↔笔记            (走 bus    │ (走 bus + │   —      │   —      │ (走 bus + │   —          │ openInRight
                        channel    │ envelope)  │             │          │ insertion │               │ noteLink 业务
                        + 跨 view  │            │             │          │ for       │               │ navigation
                        target)    │            │             │          │ openLeft  │               │ history
                                   │            │             │          │  禁用)    │               │
─────────────────────── ───────────│──────────│───────────│──────────│───────── │ ────────────│ ──────────────
2.b 跨 view 类型         同上       │ 跨形态    │   —      │ 跨 view   │   —      │   —          │ AI 业务流
                                   │ 降级链     │             │ dropTarget│          │               │ anchor-sync
─────────────────────── ───────────│──────────│───────────│──────────│───────── │ ────────────│ ──────────────
2.c slot 通信            (走 bus)   │   —      │   —      │   —      │   —      │   —          │ slot 位置锁
                                   │           │             │          │          │               │ 双 slot 协作
─────────────────────── ───────────│──────────│───────────│──────────│───────── │ ────────────│ ──────────────
2.d 跨进程               —         │   —      │   —      │   —      │   —      │   —          │ IPC + 持久化
                                                                                                  + 主进程命令
```

### 4.1 怎么读这张矩阵

**举例 1:用户在笔记里选中一段文字加粗**

- 作用域:1.a 节点内
- 涉及 capability:**selection**(读当前选区)+ **text-editing**(toggleMark bold)
- 跨多列说明这是"组合操作":selection capability 提供选区,text-editing capability 提供 mark 操作

**举例 2:用户多块选中拷贝粘到另一笔记**

- 作用域:1.c 多 block(选中)+ 跨文档(粘贴目标)
- 涉及 capability:**selection**(多块选区)+ **clipboard**(拷贝走 internal envelope)+ 跨 view(bus.openRight 打开笔记 B)+ **clipboard.paste**(粘贴 dispatcher)+ **insertion**(safeInsert 守卫)+ **text-editing**(节点工厂还原)
- 这正是 V1 实现里"selectionToMarkdown / internal-clipboard / smart-paste / pasteIsSafe / converter" 五个文件共同协作的链路 — V2 把每个责任清晰归到 capability

**举例 3:NavSide 拖笔记到文件夹**

- 作用域:NavSide(view 自身的子 UI,不是文档内 / 跨文档,是 view 业务)
- 涉及 capability:**drag-and-drop**(拖动生命周期 + 落点)+ NoteView 业务(实际改文件夹引用)
- 矩阵中这个不在表格里 —— 因为它不属于"内容操作"而属于 view UI,§ 0.3 已说明

### 4.2 矩阵补全规则(给后人补功能时用)

新功能加进来,先问两个问题:

1. **作用域是哪个?**(1.a / 1.b / 1.c / 2.a / 2.b / 2.c / 2.d)
2. **涉及哪些 capability?**(列上选)

然后填到对应单元格。如果某格空了,就是个未实现的能力,下一版可以补。

如果发现某功能**跨作用域 + 跨 capability**(常见),意味着它是**组合操作**,实施时让各 capability 协作 — 这正是 capability 抽象的价值。

### 4.3 矩阵中的"—"是什么意思

"—"表示该 (作用域, capability) 单元格没有有意义的能力,通常因为:
- capability 不关心这个作用域(如 drag-drop 不关心 1.a 字符级,因为 PM 内部已处理)
- 或这个能力在另一格已表达(避免重复)

---

## 5. Capability 边界白皮书

基于 § 4 矩阵,反推每个 capability 的责任边界。

### 5.1 selection capability(通用)

**这层做什么**:统一"用户选中了什么"的概念,提供单一 channel 让任何 UI / 动作订阅当前选区。覆盖 1.a 字符级 / 1.b 块级 / 1.c 多块 / 未来 2 跨 view 的统一选择(L7+)。

**这层不做什么**:
- 不持有具体内容(选区只是"位置 / 范围"概念)
- 不序列化(走 clipboard)
- 不响应键盘(由内容特定 capability 自己捕获并 emit)

**协议雏形**:
```ts
// channel - discriminated union by kind
'selection.changed': {
  source: string;  // 'note' / 'graph' / 'ebook' 等
  isEmpty: boolean;
  kind: 'text' | 'block' | 'multi-block' | 'graph-nodes' | 'tree-nodes' | 'empty';
  // text 模式
  from?: number; to?: number; anchor?: number; head?: number;
  // block / multi-block 模式
  positions?: number[];
  // graph-nodes 模式(L6+)
  nodeIds?: string[];
}

// helper API
selection.getText(): string | null;        // 把当前选区取成字符串
selection.isMultiBlock(): boolean;         // 是不是多块模式
```

**实施深度**:
- L5-A:text-editing 包装 PM 字符级选区 emit channel
- L5-B:加块级(blockSelection 包装)+ 多块
- L5-C:加 inline atom 节点选中(noteLink 选中)
- L6:GraphView emit graph-nodes 选区,验证 UI 跨内容形态统一订阅

### 5.2 clipboard capability(通用)

**这层做什么**:
- 多 envelope copy(原生 PM JSON / Markdown / HTML / 纯文本同时写)
- paste dispatcher + handler 注册
- DataTransfer 读写底层接口(给 drag-and-drop 复用)

**这层不做什么**:
- 不知道"选了什么"(走 selection)
- 不知道"怎么序列化"(各内容特定 capability 注册 serializer)
- 不知道"怎么理解粘贴源"(各 view / 业务 capability 注册 PasteHandler)

**协议雏形**:
```ts
// request
'clipboard.copy': { format?: 'auto' | 'pm-json' | 'markdown' | 'html' | 'plain' };
'clipboard.paste': { dataTransfer?: DataTransfer };

// API
clipboard.registerSerializer({ contentType, format, serialize });
clipboard.registerPasteHandler({ id, detect, parse, priority });
```

**实施深度**:
- L5-A:最小 — text-editing 注册 'pm-json' / 'markdown' / 'plain' serializer;走 PM 默认 paste(暂不 dispatcher)
- L5-B:加 dispatcher,迁移 V1 smart-paste 的 source handler
- L5-C:支持跨 view 复制粘贴(笔记选区粘到 thought)
- L6:GraphView 注册自己的 serializer

### 5.3 undo-redo capability(通用)

**这层做什么**:
- 提供 undo / redo 标准 request
- 维护 per-view 栈
- emit 状态 channel(canUndo / canRedo)

**这层不做什么**:
- 不知道具体怎么 undo(各内容特定 capability 注册自己的 undo 实现)
- 不强求全局栈跨 view(per-view 即可,见 § 7 开放问题)

**协议雏形**:
```ts
// request
'undo-redo.undo': { scope?: string };
'undo-redo.redo': { scope?: string };

// channel
'history.changed': { scope: string; canUndo: boolean; canRedo: boolean };

// API
undoRedo.register({ scope, undoCommand, redoCommand });
```

**实施深度**:
- L5-A:text-editing 注册 PM history 包装,Cmd+Z / Cmd+Shift+Z 调 capability
- L5-B/C:稳定运行
- L6:GraphView 注册自己的 undo 实现

### 5.4 drag-and-drop capability(通用)

**这层做什么**:
- 拖动生命周期(start / over / drop)
- 落点解析框架
- DataTransfer 协议(复用 clipboard envelope)

**这层不做什么**:
- 不知道"接什么类型 drop"(各内容特定 capability 注册 dropTarget)
- 不知道"具体落地动作"(注册时给 onDrop 回调)

**协议雏形**:
```ts
// request
'dnd.startDrag': { source: { type, data } };
'dnd.drop': { target: ...; dataTransfer: DataTransfer };

// channel
'dnd.over': { mouseX, mouseY, candidateTarget };
'dnd.completed': { mode: 'move' | 'copy'; success: boolean };

// API
dnd.registerDropTarget({ id, accepts, onDrop, computeDropPoint });
```

**实施深度**:
- L5-A:不实施(单 NoteView 没拖动需求)
- L5-B:NavSide 文件夹树拖放笔记
- L5-C:笔记内块拖动重排(迁移 V1 block-handle)
- L6+:跨 view 拖放(笔记块拖到 GraphView 当节点)

### 5.5 insertion capability(通用)

**这层做什么**:
- 框架级"安全插入"协议(光标祖先守卫 / position 解析 / 批量原子操作)
- 提供 `safeInsert(target, content)` 通用接口

**这层不做什么**:
- 不知道"插什么"(内容特定 capability 提供节点工厂)
- 不知道"插哪里"(由调用方提供,或从 selection 拿光标)

**协议雏形**:
```ts
// request
'insertion.insert': { target: InsertTarget; content: unknown; safeMode?: boolean };

// API
insertion.registerSafeguard({ id, check });
```

**实施深度**:
- L5-A:不实施(单 view 不需要框架级守卫)
- L5-B:迁移 V1 pasteIsSafe 守卫
- L5-C:slash 命令 + AI Sync 走同一接口
- L6+:跨 view 插入

### 5.6 text-editing capability(内容特定)

**责任**:
- ProseMirror 容器 mount / unmount
- 文本 schema(三层节点 — inline / block / container,通过扩展点开放)
- 文本特有命令(粗体 / 标题 / 列表 / 缩进 / hardBreak / 等)
- input-rules(自动转换语法 → 节点)
- converter(atom ↔ PM doc 双向转换)
- schema 扩展点(view / 业务注册自己的节点 — 如 noteLink)

**不责任**:
- selection / clipboard / undo / drag / insertion → 走通用层(text-editing 把 PM 内置机制包装为通用 capability 接口)
- 笔记 / 思考 / 图谱 / 文件夹的具体业务 → view 自管 / 业务 capability

**L5-A 实施深度**:
- 最小 schema(doc / paragraph / text)
- ProseMirrorHost 组件(受控,docJson + onChange + readOnly + schemaExtensions 接口位)
- 基础 keymap(Enter / Backspace / 光标移动)
- prosemirror-history 注册到 undo-redo capability

**L5-B**:加 heading / list / mark / 完整 keymap / input-rules

**L5-C**:schema 扩展点开放 + noteLink 节点(由 NoteView 注入 spec + NodeView)+ paste handler 注册

**L6+**:表格 / 数学 / 图片 / 代码块 / Mermaid / 拖动手柄(注册 drag-and-drop)/ 等富节点

### 5.7 特殊 block 接口规约(独立深入文档)

> **承接用户洞察**:本研究 § 4 矩阵的"列(capability)"那一轴本身有层次 — text-editing 内部还分**基础 block 操作**(textBlock / paragraph)和**特殊 block 操作**(数学块 / 代码块 / 列表 / 表格 / 图片 / ...)。后者是基础之上的延伸约定,不抽象出来 V2 会重蹈 V1 的覆辙。
>
> **V1 教训**:V1 的不稳定症状大量集中在 block 操作的不一致 — **嵌套容器 + 节点位置计算**是返工重灾区。每种特殊 block 都有自己的"光标进入怎么办 / 选区怎么算 / 粘贴接受什么 / Enter 怎么响应 / 序列化怎么做",V1 散落在 30+ 块定义里没有统一接口。
>
> **V2 思路**:把每个特殊 block 视为"小 capability"— 实现一组标准接口(BlockSpec),由 text-editing capability 通过 `registerBlock` 装配。这样每加一个特殊 block 是注册行为,不是改 text-editing 内部代码。

**接口点(初步 8 个)**:
1. schema spec(nodeSpec)
2. NodeView 渲染
3. keymap(块内特殊键盘)
4. 选区行为(TextSelection / NodeSelection / 自定义)
5. 粘贴守卫(块内只接受什么)
6. 序列化(toMarkdown / toHTML / toAtom)
7. input-rules(自动转换语法 → 节点)
8. 容器规则(containerRule / cascadeBoundary)

**示例 block(覆盖 5 种典型模式)**:textBlock(基础)/ mathBlock(leaf 内嵌编辑器)/ codeBlock(textarea-like)/ table(嵌套容器)/ bulletList(同族列表)。

**详细研究**:见独立文档 [`V1-block-operations.md`](./V1-block-operations.md)(单独立项,因为细节量大且 V1 病例多;研究新文档不阻塞 § 4 矩阵的使用)。

### 5.8 留位(L6+ 内容特定 capability)

- `graph-editing` — V1 部分实现(GraphEditor.ts),关键观察:graph 文字编辑共享 80% PM plugin → GraphView 也 install text-editing,只在 graph-editing 加图谱专属(连线 / 节点形状 / 布局)
- `file-management` / `web-rendering` / `ebook-rendering` / `media-rendering` / `ai-augment` 等

---

## 6. 业务 / view / capability 判别准则

给后续设计 capability 时一个清单。

| 现象 | 归属 |
|---|---|
| 用户**动作**(选中 / 复制 / 粘贴 / 移动 / 撤销 / 插入)| **通用交互 capability** |
| **内容形态特有**命令(粗体 / 标题 / 节点连线 / 图谱布局)| **内容特定 capability** |
| **跨 view 共享状态**(当前选区 / 剪贴板)| **bus channel + 通用 capability** |
| **view 私有状态**(笔记列表 / 文件夹树 / 导航 history)| **view 自管 / pluginStates** |
| **跨 view 协议**(锚定同步 / AI 推送 / openRight)| **bus request + 协议文档** |
| **业务流程**(AI 总结 / 翻译 / 文件夹组织)| **独立业务 capability** |
| **框架级保留**(slot 切换 / Workspace CRUD)| **L3 / L3.5 框架内置** |
| **持久化 / 跨进程**(笔记存盘 / 文件读写)| **L0 IPC + L3 PersistenceAPI + 业务 capability** |

---

## 7. 接下来要写的 PROTOCOL 清单

研究产出 → 下一阶段实施起点。

| 文档 | 范围 | 时机 |
|---|---|---|
| `src/capabilities/COMMON-PROTOCOL.md` | 5 通用 capability 协议(channel / request / API + 注册机制 + 铁律) | **L5-A 实施前必写**,对齐 workspace-bus PROTOCOL.md 形式 |
| `src/capabilities/text-editing/DESIGN.md` | text-editing L5-A 范围(最小 schema + ProseMirrorHost + 注册到 undo-redo / selection / clipboard) | L5-A 实施前 |
| `src/views/note/DESIGN.md` | NoteView L5-A 范围 — 重写(替代当前已写的 v0.1) | L5-A 实施前 |
| `src/capabilities/clipboard/PROTOCOL.md` | clipboard 子协议(envelope 格式约定 / handler 注册接口) | L5-B 加 dispatcher 时 |
| `src/capabilities/drag-and-drop/PROTOCOL.md` | dnd 协议(MIME / DataTransfer / dropTarget 注册) | L5-B 加文件夹拖放时 |

---

## 8. 风险与开放问题(每个给推荐答案)

### 8.1 bookmarks 应该是 capability 还是 view 业务?

V1 把书签放在 NoteView 内 + help-panel/bookmarks。

**推荐**:**view 业务**(L5-A/B 阶段)。书签是"特定 view 类型的特定功能",eBookView 也有书签但语义不同(章节锚定),GraphView 没书签。强抽 capability 过早抽象。L7+ 如果发现多 view 共享需求再抽。

### 8.2 selection 跨内容形态时,payload 形状如何统一?

text 是 from/to,graph 是 nodeIds,差异极大。

**推荐**:**discriminated union by `kind`**(已在 § 5.1 协议雏形)。订阅者按 kind 决定怎么读。常见动作(`isEmpty` / `getText`)由 capability 提供 helper。

### 8.3 clipboard 跨内容形态粘贴时的"语义降级"规则?

笔记选区(含 image / math / table)粘到代码块,图谱节点粘到笔记,该怎么办?

**推荐**:**多 envelope copy + paste 端按目标内容类型选最高格式**。降级链是 capability 提供的 metadata(`clipboard.formatRanking`),paste 端按目标支持的最高格式取。

### 8.4 drag-and-drop 是不是要更细分?

块拖动 / 选区拖动 / 跨 view 拖动。

**推荐**:**同一 capability**,通过 `source.type / target.type` 区分。它们共享生命周期 + 协议(DataTransfer)。差异只在"接什么源 / 接什么目标",这是注册数据,不是 capability 边界。

### 8.5 V1 sendToOtherSlot + 对面 slot 模式,V2 走 bus 后"对面是哪个"如何表达?

**推荐**:**走 slotBinding 取目标 view ID**。view 想"通知对面" → 读自己当前 workspace 的 slotBinding,确定对面 view ID,emit channel 时 payload 加 `target: viewId`。订阅方按自己的 viewId 过滤。广播则不带 target。

### 8.6 undo/redo 跨 capability 时栈如何统一?

**推荐**:**per-view 栈,不强求全局**。V2 v1 走这条;若 L7+ 出现"跨 view 全局 undo" 需求再合并。

### 8.7 thoughtPlugin / titleGuard / vocabHighlight 这种 NoteView 特有 PM plugin 算 view 内还是 capability?

V1 当 plugin 装到 NoteEditor。

**推荐**:**view 内的 plugin 注册**。这些是 NoteView 调 text-editing capability 时通过 `schemaExtensions` 注入的扩展。它们不是独立 capability(其他 view 不用),也不是通用层。形态:NoteView 自己 `note-extensions/` 子目录放,通过 ProseMirrorHost 的 `schemaExtensions` props 传给 text-editing。

### 8.8 V1 的 selection-cache 在 V2 还需要吗?

**推荐**:**不需要**。V2 selection capability channel 自带 lastValue(L3.5 ChannelHub 已实现),任何动作随时取 lastValue 就是最近选区。L3.5 已经把这条架构债防掉。

---

## 9. 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-05-05 | v0.1 | 初稿;按"动作类型"分类(selection/clipboard/undo/dnd/insertion 五大动作);7 条 V1 病例;5 通用 capability 边界 |
| 2026-05-05 | v0.2 | **重写** — 用户提出按"作用域层次"(1.a 节点内 / 1.b 容器内 / 1.c 多 block / 2 跨文档)分类更稳。新增 § 4 双轴矩阵把作用域 × capability 显式连接,§ 1 / § 2 重组,§ 3 病例按新分类归位。capability 协议雏形(§ 5)和开放问题(§ 8)沿用 v0.1。 |
