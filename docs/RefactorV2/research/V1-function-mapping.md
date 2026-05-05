# V1 笔记功能 → V2 Capability 映射研究

> **研究目的**:把 V1 笔记模块已实现的全部功能,系统抽象到 V2 的两层 capability 模型(通用交互 / 内容特定),为后续 PROTOCOL.md / DESIGN.md 提供素材输入。
>
> **不是**:V1 代码搬迁清单 / 实施步骤 / API 规范。
>
> **是**:**抽象推演** — 每个功能的"本质属性 + 归属判定 + 反面教材",目的是让 V2 capability 边界**先于代码**就清楚,避免 V1 把"通用动作"埋在内容特定模块里的同款病。

> 文档版本:v0.1
> 编写日期:2026-05-05
> 上下文:L5-A 阶段,在 NoteView 实施前先做 capability 边界研究

---

## 0. 研究方法

### 0.1 为什么要分两层 capability

回到 charter § 1.4 + V2 立项的差异化承诺:**view 是能力组合声明,不是实体**。如果只立"text-editing / graph-editing"这种**领域大模块**,V2 跟 V1 的 `plugins/note/` 没本质区别。V2 必须把"selection / clipboard / undo-redo / drag-and-drop / insertion"这样**任何内容形态都用得上的用户基础动作**抽到独立 capability,这一层才是 V2 的灵魂。

抽象图(已在与用户对话中拍板):

```
view 层(NoteView / GraphView / FileExplorer)
    ↓ install
通用交互 capability(任何 view 都用 — selection / clipboard / undo-redo / drag-and-drop / insertion)
    ↓ install
内容特定 capability(text-editing / graph-editing / file-management / etc.)
    ↓ uses
浏览器 / OS 基础设施(Selection API / Clipboard API / HTML5 dnd / keyboard)
```

### 0.2 我读了 V1 哪些代码、用什么视角

深读(行级别理解):

| 文件 | 看的是什么 |
|---|---|
| `src/plugins/note/components/NoteView.tsx` | view 层职责 / viewAPI 调用面 / 状态散落点 / 跨 view 通信 |
| `src/plugins/note/components/NoteEditor.tsx` | PM 装配 / plugin 顺序 / handle 接口 / converter 调用 |
| `src/plugins/note/plugins/block-selection.ts` | "块级选择"语义 — 与 PM 字符级选区并行的第二种模式 |
| `src/plugins/note/commands/selection-cache.ts` | 选区临时方案 — "全局 cache" 是 V1 没把 selection 当 capability 的症状 |
| `src/plugins/note/commands/selection-to-markdown.ts` | 序列化:doc + 选区 → markdown,30+ 节点 case 全 hardcode |
| `src/plugins/note/paste/smart-paste-plugin.ts` | dispatcher 模式 / 多 source handler |
| `src/plugins/note/paste/internal-clipboard.ts` | 内部剪贴板通道 / HTML 嵌入 marker / 多 envelope |
| `src/plugins/note/plugins/link-click.ts` | 笔记内导航(history 栈)+ 跨 view 路由 |
| `src/plugins/note/plugins/slash-command.ts` | 触发机制(扫描 / 字符,IME 友好) |
| `src/plugins/note/plugins/block-handle.ts` | 拖动手柄 / 拖放语义 / 跨容器移动 |
| `src/plugins/note/ai-workflow/sync-note-receiver.ts` | 业务流 capability 的雏形(AI → 节点工厂 + 插入) |
| `src/plugins/note/navside/NotePanel.tsx` | NavSide 文件夹树 / 拖放 |
| `src/plugins/graph/canvas/edit/GraphEditor.ts` | **关键对照** — graph 也用 PM,共享 80% plugin,反证"这些 plugin 属于 text-editing capability" |

走马观花(看清单 + 关键文件名):
- `src/plugins/note/blocks/`(30+ 块定义)
- `src/plugins/note/converters/`(双向 atom ↔ PM 节点)
- `src/plugins/note/commands/*` 余下文件

未读(明确不在本次研究范围):
- `src/plugins/graph/canvas/` 大部分 — graph 重做留 L6+
- `src/plugins/web/` / `src/plugins/ebook/` — 内容形态不同,等真接 capability 时再深入
- `src/plugins/ai/` — 业务流,L6+

### 0.3 V1 病例的反向价值

研究中识别出的 7 条 V1 混淆模式(§ 2),给 V2 的反向警示价值大于 V1 代码本身的复用价值。这些模式都是"该抽 capability 没抽,该分层没分层,该走协议走全局变量"。

---

## 1. V1 笔记用户能力全景图

按 11 大类列(对应大纲的 1.1-1.11),每条只列**用户能干什么**+ V1 实现位置,不展开实现细节。

### 1.1 文本输入与编辑

- 打字、删除、字符级光标移动 — PM 内置 + `prosemirror-commands` baseKeymap
- 选区(字符级 / 块级 / 跨块)— `block-selection.ts`(块级)+ `selection-cache.ts`(快照)
- Enter 换段、Backspace、Tab/Shift+Tab 缩进 — `indent.ts` + baseKeymap
- 鼠标拖选 — PM 原生 + `selection-cache.ts:startMouseSelectionTracker`(因为 PM 鼠标拖选不经过 dispatchTransaction,需额外监听)

### 1.2 块结构操作

- 30+ 块类型(都在 `blocks/` 下注册到 blockRegistry)
- 段落(textBlock with level=null)、标题(textBlock with level=1/2/3,`heading-collapse.ts` 折叠)
- 列表(`bullet-list / ordered-list / task-list / toggle-list`)
- 引用、callout、code、math(block + inline)、horizontal-rule、hard-break
- 媒体(image / video / audio / file / external-ref / tweet / html)
- 表格(`table.ts` + `prosemirror-tables`)
- 列布局(`column-list.ts`)、frame(`frame-block.ts`)、page-anchor

### 1.3 内联格式与样式

- bold / italic / underline / strike / code(`Mod-b/i/u/Mod-Shift-s/Mod-e`,在 NoteEditor.tsx markKeymap)
- 链接 — `LinkPanel.tsx` 弹层
- noteLink(笔记内链)— `note-link.ts` + `note-link-command.ts`(`[[` 触发)+ `NoteLinkSearch.tsx`
- external-ref 外部引用、file-link 文件链接、page-anchor eBook 锚点
- 颜色(`ColorPicker.tsx`)、textStyle、highlight、thought mark

### 1.4 选区操作 + 命令

- 选区拷贝为 Markdown — `commands/selection-to-markdown.ts`(完整覆盖 30+ 节点 case)
- 选区缓存(快照)— `commands/selection-cache.ts`(右键菜单折叠选区时保留)
- block-selection 多块框选 — `plugins/block-selection.ts`(ESC 进入块选模式)
- undo/redo — `prosemirror-history` + `Mod-z/Mod-Shift-z` keymap

### 1.5 内容生成与转换

- SlashMenu(`/` 触发)— `plugins/slash-command.ts` + `components/SlashMenu.tsx`
- input-rules(自动转换语法 → 节点)— `plugins/input-rules.ts`(如 `# ` → heading)
- container-keyboard / code-block-keyboard(键盘语义,容器 / 代码块特殊行为)
- indent / heading-collapse(缩进 / 标题折叠)
- column-collapse(列折叠)

### 1.6 粘贴 / 剪贴板

- 智能粘贴 — `paste/smart-paste-plugin.ts`(dispatcher)
- 多 source handler — `paste/sources/`(chatgpt / claude / gemini / generic)
- HTML → Markdown — `paste/html-to-markdown.ts`
- 内部剪贴板通道 — `paste/internal-clipboard.ts`(HTML 嵌入 KRIG marker)
- 图片粘贴 — `plugins/paste-media.ts`
- 双向 atom ↔ PM 节点 — `converters/`

### 1.7 跨笔记 / 跨视图互动

- 笔记内链点击 — `plugins/link-click.ts`(同文档锚点跳转 / 跨笔记打开 / 导航 history 栈)
- openInRightSlot — `viewAPI.noteOpenInRightSlot`(IPC)
- sendToOtherSlot / onMessage(双 slot 通信)— `viewAPI.sendToOtherSlot` 协议字段(anchor-sync / ai-sync / note-thought)
- anchor-sync — `NoteView.tsx` 内 PDF 页码锚定同步(eBook ↔ Note)
- thought-plugin — `plugins/thought-plugin.ts`(选段派生 thought)
- ai-workflow/sync-note-receiver — Web 抓取 → 笔记追加

### 1.8 NavSide 笔记管理

- 文件夹树 + 笔记列表 — `navside/NotePanel.tsx`(消费 `FolderTree` + `useNoteOperations`)
- 创建 / 删除 / 重命名 — `useNoteOperations`
- 拖放移动 — `FolderTree.onDrop`
- 搜索 / 过滤 — `OpenFilePopup`(NoteView toolbar 内)
- 双击重命名、键盘操作(↑/↓/Enter/F2/Delete)

### 1.9 AI / 高阶动作

- AskAIPanel — `commands/ask-ai-command.ts` + `components/AskAIPanel.tsx`
- 选区转 Markdown 给 AI — `commands/selection-to-markdown.ts`
- thought-commands — 选段 → Thought 派生
- ai-workflow — Web 抓取 → 笔记追加(`sync-note-receiver.ts` + `blocks-to-pm-nodes.ts`)
- 帮助面板预览(LaTeX / Mermaid / 数学可视化)— `help-panel/`

### 1.10 视图层 UI(view 自身)

- Toolbar:后退 / 前进 / 标题 / 保存 / 书签 / + 新建 / Open / SlotLock / SlotToggle / × — `NoteView.tsx`
- Empty State — `NoteView.tsx`
- 标题栏(noteTitle 同步)— `NoteView.tsx` + `text-block.ts:noteTitleNodeView`
- 书签面板 — `help-panel/bookmarks/`(记录阅读位置)
- TOC indicator — `toc/toc-indicator.ts`
- Slot Lock(位置锁)— `viewAPI.getSlotLock / setSlotLock`
- 关闭 slot — `viewAPI.closeSelf()`

### 1.11 数据持久化

- flushSave / scheduleSave(1s 防抖)— `NoteView.tsx`
- Cmd+S 立即保存 — `NoteView.tsx` keydown
- lastViewBlockIndex(阅读位置恢复)— `viewAPI.noteSaveLastView`
- bookmarks 持久化 — `viewAPI.noteSaveBookmarks`
- workspace state 恢复 — `viewAPI.onRestoreWorkspaceState`

---

## 2. V1 实现的层次混淆病例(7 个反面教材)

每条简短分析,给 V2 的反向警示。

### 2.1 selection 散落(三处自管)

**症状**:`block-selection.ts`(块级)+ `selection-cache.ts`(快照)+ `selection-to-markdown.ts`(序列化)各管一摊,没有统一"选区"概念。`selection-cache` 出现的根因是右键菜单折叠 PM 选区,要靠全局变量补丁。

**反面警示**:V2 必须把 selection 提成 capability,**所有"动作 + 选区"协作走 channel 订阅 lastValue**,不需要任何 cache trick。

### 2.2 clipboard 散落

**症状**:`smart-paste-plugin`(粘贴 dispatcher)+ `internal-clipboard`(KRIG 内部通道)+ `paste/sources/*`(多 handler)+ `paste-media`(图片)各处不一。复制路径在 `internal-clipboard.writeKrigDataToTransfer`,粘贴路径在 `smart-paste-plugin`,两端协议是隐式约定。

**反面警示**:V2 clipboard capability 把这一切收编成**显式协议** — copy:多 envelope(原生 PM JSON / Markdown / HTML / 纯文本)同时写;paste:dispatcher + handler 注册制(任何 capability 注册自己的"理解此粘贴源"逻辑)。

### 2.3 undo/redo 内嵌 NoteEditor + GraphEditor 两份

**症状**:`history()` plugin 在 NoteEditor 装一份,GraphEditor 又装一份。两个独立栈互不感知。如果用户在 Note 改一段 + 在 Graph 改个节点,无法"全局 undo"回到上一个状态。

**反面警示**:V2 undo-redo capability 必须是**全局栈**(或 view 内统一栈),走 capability 注册 `undoCommand / redoCommand`,各内容特定 capability 把自己的"逆操作"注册进去。

### 2.4 viewAPI 全局窗口接口

**症状**:`(window as any).viewAPI` 散布在每个 plugin / component 里。NoteView 自己调 `viewAPI.noteSave / noteOpenInEditor`,note-link.ts 调 `viewAPI.noteList / noteOpenInEditor`,sync-note-receiver 调 `viewAPI.aiParseMarkdown`。这是个**绕过架构的全局后门**,所有跨 view / 跨进程通信都靠它。

**反面警示**:V2 已经有 L3.5 workspace-bus + L4 commandRegistry / capabilityRegistry,**所有跨边界通信走 bus / registry**,严禁 window 全局后门。

### 2.5 sendToOtherSlot 协议混用

**症状**:`viewAPI.sendToOtherSlot` 是个广播方法,payload 用 `{ protocol: 'ai-sync' | 'anchor-sync' | 'note-thought', action: '...', payload: {...} }` 这种**字符串协议字段**区分。NoteView 一个 `onMessage` 监听器同时处理 ai-sync 的 `as:append-turn / as:import-conversation / as:probe / as:note-status`,加上 anchor-sync 的 `anchor-sync`。一切类型保护都是 if-else + 字符串匹配。

**反面警示**:L3.5 workspace-bus 的 channel 设计就是为了根治这条 — 每个跨 view 通信主题一条独立 channel,payload 类型化,无字符串路由。

### 2.6 link-click 导航栈 module-global state

**症状**:`plugins/link-click.ts` 顶部 `const history: NoteHistory = { back: [], forward: [], current: null }` —— 这是 **module 级全局变量**,跨 NoteView 实例共享。Workspace A 的 NoteView 后退栈会影响 Workspace B(如果都打开 Note)。

**反面警示**:V2 任何"view 范围状态"都必须挂在 view 实例 / pluginStates / WorkspaceState,绝不放 module 全局。

### 2.7 active-state-store 散落三处

**症状**:笔记的 active 状态在 V1 同时存于:
- `activeNoteIdRef`(NoteView ref,同步读)
- `activeNoteIdState`(NoteView state,render 用)
- `navside/store/active-state-store.ts`(NavSide 自己的 store,IPC 同步)
- 主进程 workspace.json 持久化

四处状态之间靠 IPC 事件流回来对齐,产生大量竞态保护代码(`activeNoteIdRef.current` 在 `loadNote` 里被反复检查)。memory `project_active_resource_id_arch_debt` 已记。

**反面警示**:V2 的 pluginStates(L3 已建)+ Workspace bus channel(L3.5 已建)是单一来源 — view 直接读 pluginStates,改也写 pluginStates,manager 自动持久化 + 通知。**禁止把同一状态镜像到 ref / state / store**。

---

## 3. V1 功能 → V2 Capability 映射主表

按 capability 拆 6 张小表(对应 Q-O3=B 决定)。

### 3.1 selection capability

| V1 功能 | V1 实现位置 | 本质属性 | V2 协议雏形 |
|---|---|---|---|
| 字符级选区追踪 | PM 内置 selection | **状态** | channel `selection.changed { kind: 'text', from, to, anchor, head }` |
| 块级多选 | `plugins/block-selection.ts` | **状态(替代选择模式)** | 同一 channel,`kind: 'block', positions: number[]` |
| 鼠标拖选完成事件 | `selection-cache.ts:startMouseSelectionTracker` | **状态(异步同步)** | text-editing 内部包装,emit 同一 channel,view 不需关心异步 |
| 选区清空 | 各处手动 `clearSelectionCache` | **状态(空态)** | channel emit `kind: 'empty'`(lastValue 自动有"上次为空"信息) |
| 拓展(L6+):图谱节点选区 | (V1 graph 没实现) | — | 同一 channel,`kind: 'graph-nodes', nodeIds: string[]` |

**capability 责任**:统一"选区"概念,内容特定 capability 把自己的选区状态包装成 channel 消息;UI 层(FloatingToolbar / ContextMenu / AskAIPanel)只需订阅一条 channel,不知道底下是文本还是图谱。

**capability 不责任**:序列化选区内容(那是 clipboard 的事)。

### 3.2 clipboard capability

| V1 功能 | V1 实现位置 | 本质属性 | V2 协议雏形 |
|---|---|---|---|
| 选区 → Markdown | `commands/selection-to-markdown.ts` 30+ case hardcode | **动作 + 多格式序列化** | request `clipboard.copy { format: 'markdown' \| 'pm-json' \| 'html' \| 'plain' }`,内部按格式调"该内容形态注册的 serializer" |
| 内部剪贴板 PM JSON | `paste/internal-clipboard.ts` | **多 envelope copy** | bus 内置:copy 同时写多 envelope(PM JSON 进 marker / HTML / Markdown / 纯文本) |
| 智能粘贴 dispatcher | `paste/smart-paste-plugin.ts` | **动作 + 多 source 适配** | request `clipboard.paste`,内部按注册顺序调 PasteHandler 的 `detect / parse` |
| chatgpt / claude / gemini handler | `paste/sources/` | **业务 handler** | view / 业务 capability 通过 `clipboard.registerPasteHandler` 注册 |
| 图片粘贴 | `plugins/paste-media.ts` | **业务 handler** | 同上 |
| 拖放放下时的剪贴板传输 | `internal-clipboard.writeKrigDataToTransfer` | **协议(数据载体)** | clipboard capability 暴露 `writeToDataTransfer / readFromDataTransfer` 给 drag-and-drop capability 复用 |

**capability 责任**:多 envelope 抽象 + handler 注册 + DataTransfer 读写。

**capability 不责任**:具体内容如何序列化(让内容特定 capability 注册 serializer / parser);具体业务理解(让业务 capability 注册 handler)。

**关键观察**:V1 已有"dispatcher + handler"模式(smart-paste-plugin),V2 直接形式化为协议。

### 3.3 undo-redo capability

| V1 功能 | V1 实现位置 | 本质属性 | V2 协议雏形 |
|---|---|---|---|
| Cmd+Z / Cmd+Shift+Z | NoteEditor.tsx + GraphEditor.ts 各装一遍 | **动作** | request `undo / redo`(全局唯一接口,内部按当前焦点 view 路由) |
| undo 栈状态 | PM history plugin 内部 | **状态(可观测)** | channel `history.changed { canUndo, canRedo, scope: 'text' \| 'graph' }` |
| 跨 capability 联动栈 | (V1 没有,各管各的) | **协议** | undo-redo capability 维护"逆操作注册" — 各内容特定 capability `register({ undoCommand, redoCommand })`,统一栈 |

**capability 责任**:全局栈管理 + 逆操作注册接口。

**capability 不责任**:具体如何 undo(让 text-editing 调 PM history 的 undo,graph-editing 调自己的 undo)。

**待研究**(§ 8 开放问题):跨 view 的 undo 边界(Note 改一段 + Graph 改节点 后 undo,该 undo 哪个?)— 推荐 **per-view 栈**(每个 view 有自己的 undo 历史),不强求全局栈。

### 3.4 drag-and-drop capability

| V1 功能 | V1 实现位置 | 本质属性 | V2 协议雏形 |
|---|---|---|---|
| 块拖动重排(NoteEditor 内) | `plugins/block-handle.ts` | **动作 + 协议** | request `dnd.startDrag / dnd.drop`;channel `dnd.over` |
| 跨容器移动(块拖到 callout / table cell) | block-handle 内 dropPoint 计算 | **动作(目标解析)** | drag-and-drop capability 提供 `findDropTarget` 抽象,内容特定 capability 注册"我能接什么类型的 drop" |
| 笔记拖到文件夹(NavSide) | `navside/FolderTree.onDrop` | **动作(跨内容形态)** | 同一接口,FolderTree 调 `dnd.drop` 处理放下 |
| 拖动时源标记(KRIG_SOURCE_POS_MIME) | `internal-clipboard.ts` | **协议(数据载体)** | drag-and-drop capability 用 clipboard capability 的 `writeToDataTransfer` |
| 落地时删原位置 | block-handle 内 | **协议(move 语义)** | channel `dnd.completed { mode: 'move' \| 'copy' }` |

**capability 责任**:拖动生命周期 + 落点解析框架 + 协议(MIME / DataTransfer)。

**capability 不责任**:具体"哪些目标接哪些源"(让内容特定 capability 注册 dropTarget 规则)。

### 3.5 insertion capability

| V1 功能 | V1 实现位置 | 本质属性 | V2 协议雏形 |
|---|---|---|---|
| 粘贴安全守卫 | `smart-paste-plugin.ts:pasteIsSafe` | **协议(框架级守卫)** | insertion capability 内置 `safeInsert(target, content)` 检查祖先链不破坏 |
| Slash 命令插入 | `plugins/slash-command.ts` + SlashMenu | **触发 + 动作** | 触发归 text-editing(内容感知);插入动作走 insertion capability |
| AI Sync turn 插入 | `ai-workflow/sync-note-receiver.ts:insertTurnIntoNote` | **动作(批量节点插入)** | 业务 capability 调 insertion 的 `safeInsert` |
| 节点工厂(callout / toggle 等) | sync-note-receiver 内 hardcode `schema.nodes.callout.create({...})` | **业务 + 内容特定** | 业务层调 text-editing capability 的 schema 工厂(text-editing 提供 `createNode(type, attrs, children)`) |

**capability 责任**:框架级"安全插入"协议(光标祖先守卫 / position 解析 / 批量原子操作)。

**capability 不责任**:具体生成什么节点(内容特定 capability 提供节点工厂)。

**关键观察**:V1 的 pasteIsSafe 是**所有插入操作都该有的守卫**,V1 把它埋在 paste plugin 里。V2 提到 insertion capability 让所有路径(粘贴 / slash / AI / 拖放落点)都走同一守卫。

### 3.6 text-editing capability(内容特定)

| V1 功能 | V1 实现位置 | V2 归属 |
|---|---|---|
| ProseMirror 容器 mount | NoteEditor.tsx | text-editing(本层) |
| 文本 schema(doc / paragraph / text) | `blocks/text-block.ts` 等 | text-editing(本层) |
| 文本特有命令(粗体 / 标题 / 列表 / 缩进) | `commands/editor-commands.ts` + markKeymap | text-editing(本层) |
| 文本特有节点(table / image / math / callout 等 30+) | `blocks/*.ts` | text-editing(本层,通过 schema 扩展点)|
| input-rules(`# ` → heading) | `plugins/input-rules.ts` | text-editing(本层) |
| converter(atom ↔ PM doc) | `converters/` | text-editing(本层) |
| 块级选区 | `plugins/block-selection.ts` | **selection capability**(text-editing 包装为 channel) |
| smart-paste / internal-clipboard | `paste/` | **clipboard capability**(text-editing 注册 serializer / handler) |
| undo/redo(history plugin) | NoteEditor 装配 | **undo-redo capability**(text-editing 注册 PM history 包装) |
| 块拖动手柄 | `plugins/block-handle.ts` | **drag-and-drop capability**(text-editing 注册"我接什么 drop") |
| 粘贴守卫 | `smart-paste-plugin.ts:pasteIsSafe` | **insertion capability**(框架级共享) |
| Slash 触发(扫描 / 字符) | `plugins/slash-command.ts` | text-editing 提供触发感知器,渲染走 L4 slash-registry |
| 行内链接 noteLink 节点 | `blocks/note-link.ts` | text-editing 提供 schema 扩展点;**业务**(noteId 查询 / 点击 → bus.openRight)归 NoteView |
| 标题派生 / noteTitle 节点 | `blocks/text-block.ts:noteTitleNodeView` | NoteView 自管(text-editing 不知道"什么是笔记标题") |
| thoughtPlugin / titleGuard / vocabHighlight | `plugins/thought-plugin.ts` 等 | NoteView 自己的扩展(不属于 text-editing,因为 GraphEditor 不要)|

**capability 责任**:PM 容器 / 文本 schema / 文本特有命令 + 提供 schema 扩展点(让 view 注册自己的节点)。

**capability 不责任**:selection / clipboard / undo / drag / insertion(走通用层);任何业务逻辑(noteLink 查询、AI 解析、文件夹组织)。

### 3.7 view 业务 + 业务 capability

剩余 V1 功能不归通用 / 内容特定 capability,而是 NoteView view 业务 / 独立业务 capability。

| V1 功能 | V2 归属 |
|---|---|
| 笔记 CRUD / 文件夹树 / 列表 | NoteView 业务(L5-A 走 pluginStates) |
| 笔记搜索 | NoteView 业务,或 L6+ 抽 `text-search` capability |
| 笔记内导航 history(back/forward) | NoteView 自管(view-level state,非 module global) |
| 行内链接业务(noteId → title 查询、点击路由) | NoteView 业务 + bus.openRight |
| 书签(阅读位置)| NoteView 业务(也可独立 `bookmarks` capability,见 § 8 开放问题) |
| 跨 view 锚定同步(eBook ↔ Note PDF 页码) | bus channel(L3.5)+ 独立 `anchor-sync` capability(L6 接 eBook 时再立) |
| AI 总结 / 续写 / Web 抓取 | 业务 capability `ai-augment`(L6+) |
| Slot Lock | view 业务,或 Workspace 框架(讨论)|

---

## 4. 通用 Capability 边界白皮书

5 个通用 capability,每个 4 段式定义。

### 4.1 selection

**这层做什么**:统一"用户选中了什么内容"的概念,提供单一 channel 让任何 UI / 动作订阅当前选区,不需要知道底下是文本 / 图谱 / 文件列表。

**这层不做什么**:
- 不持有具体内容(选区只是"位置 / 范围"概念,不含数据)
- 不序列化(序列化是 clipboard 的事)
- 不响应键盘(鼠标 / 键盘选区交互由内容特定 capability 自己捕获并 emit)

**协议接口雏形**:
```ts
// channel
'selection.changed': {
  kind: 'text' | 'block' | 'graph-nodes' | 'graph-edges' | 'tree-nodes' | 'empty';
  source: string;  // 哪个 view / capability emit 的(如 'note' / 'graph')
  // text 模式专用
  from?: number;
  to?: number;
  anchor?: number;
  head?: number;
  // block 模式专用
  positions?: number[];
  // graph-nodes 模式专用
  nodeIds?: string[];
  // 通用元数据(让订阅者快速知道是否有可操作内容)
  isEmpty: boolean;
}
```

**实施深度**:
- L5-A:text-editing 内部包装 PM selection emit channel(字符级)
- L5-B:加 block-selection 包装(块级)
- L5-C:加 inline link 选中(noteLink 节点选中)
- L6:GraphView emit graph-nodes 选区,FloatingToolbar 验证"统一订阅" 跨内容形态正确

### 4.2 clipboard

**这层做什么**:
- 提供 copy / paste 标准接口,内部多 envelope 同时写
- 提供 paste handler 注册(dispatcher 模式)
- 暴露 DataTransfer 读写底层接口(给 drag-and-drop 复用)

**这层不做什么**:
- 不知道"选了什么要复制"(从 selection capability 拿)
- 不知道"具体怎么序列化"(每个内容特定 capability 注册 serializer)
- 不知道"具体怎么理解粘贴源"(每个 view / 业务 capability 注册 PasteHandler)

**协议接口雏形**:
```ts
// request
'clipboard.copy': { format?: 'auto' | 'pm-json' | 'markdown' | 'html' | 'plain' };
// 'auto' = 多 envelope 一起写(默认)
'clipboard.paste': { dataTransfer?: DataTransfer };

// channel
'clipboard.changed': { source: 'internal' | 'external'; envelope: string[] };

// API(直接调,不走 request)
clipboard.registerSerializer({ contentType, format, serialize });
clipboard.registerPasteHandler({ id, detect, parse });
```

**实施深度**:
- L5-A:最小 — text-editing 注册 'pm-json' / 'markdown' / 'plain' serializer;走 PM 默认 paste(暂不 dispatcher)
- L5-B:加 dispatcher,迁移 V1 smart-paste-plugin 的 source handler
- L5-C:支持跨 view 复制(从 NoteView 复制选区粘到 ThoughtView)
- L6:GraphView 注册自己的 serializer(图谱节点 → markdown 表示)

### 4.3 undo-redo

**这层做什么**:
- 提供 undo / redo 标准 request
- 维护 per-view 栈(每个 view 一个,scope='text-editing' / 'graph-editing' / 'mixed')
- emit 状态 channel(canUndo / canRedo)

**这层不做什么**:
- 不知道具体怎么 undo(text-editing 注册"调用 PM history.undo",graph-editing 注册自己的)
- 不强求全局栈(per-view 栈足够,跨 view 操作的 undo 暂不支持,见 § 8)

**协议接口雏形**:
```ts
// request
'undo-redo.undo': {};
'undo-redo.redo': {};

// channel
'history.changed': { scope: string; canUndo: boolean; canRedo: boolean };

// API
undoRedo.register({ scope, undoCommand, redoCommand });
```

**实施深度**:
- L5-A:text-editing 注册 PM history 包装,Cmd+Z / Cmd+Shift+Z keymap 调 capability
- L5-B/C:稳定运行
- L6:GraphView 注册自己的 undo,验证"per-view 栈"正确

### 4.4 drag-and-drop

**这层做什么**:
- 拖动生命周期(start / over / drop)
- 落点解析框架(给定鼠标位置,问每个注册的 drop target)
- 协议(MIME 约定,通过 clipboard 复用 DataTransfer)

**这层不做什么**:
- 不知道"具体能接什么"(内容特定 capability 注册 dropTarget 规则)
- 不知道"具体怎么落地"(注册时给 onDrop 回调)

**协议接口雏形**:
```ts
// request
'dnd.startDrag': { source: { type, data } };
'dnd.drop': { target: { type, ... }; dataTransfer: DataTransfer };

// channel
'dnd.over': { mouseX, mouseY, candidateTarget };
'dnd.completed': { mode: 'move' | 'copy'; success: boolean };

// API
dnd.registerDropTarget({ id, accepts, onDrop, computeDropPoint });
```

**实施深度**:
- L5-A:不实施(单 NoteView 没拖动需求)
- L5-B:NavSide 文件夹树拖放笔记(第一个真用例)
- L5-C:笔记内块拖动重排(迁移 V1 block-handle)
- L6:跨 view 拖放(笔记块拖到 GraphView 当节点)

### 4.5 insertion

**这层做什么**:
- 框架级"安全插入"协议(光标祖先守卫 / position 解析 / 批量原子操作)
- 提供 `safeInsert(target, content)` 通用接口

**这层不做什么**:
- 不知道"插什么"(内容特定 capability 提供节点 / 内容工厂)
- 不知道"插哪里"(由调用方提供 target / 由 selection capability 拿当前光标)

**协议接口雏形**:
```ts
// request
'insertion.insert': { target: InsertTarget; content: unknown; safeMode?: boolean };

// API
insertion.registerSafeguard({ id, check });  // 业务可加额外守卫
```

**实施深度**:
- L5-A:不实施(单 view 不需要框架级守卫)
- L5-B:迁移 V1 pasteIsSafe 守卫
- L5-C:slash 命令 + AI Sync 走同一接口
- L6:跨 view 插入(把 graph 节点 fragment 插到笔记)

---

## 5. 内容特定 Capability 边界白皮书

### 5.1 text-editing

**责任**:
- ProseMirror 容器 mount / unmount(EditorView 生命周期)
- 文本 schema(doc / paragraph / text + 各种 block / mark 节点,通过扩展点开放)
- 文本特有命令(粗体 / 标题 / 列表 / 缩进 / hardBreak / 等)
- input-rules(自动转换语法 → 节点)
- converter(atom ↔ PM doc 双向转换)
- 提供 schema 扩展点(view / 业务 capability 注册自己的节点 — 如 noteLink)

**不责任**:
- selection / clipboard / undo / drag / insertion → 走通用层(text-editing 把 PM 内置机制包装为通用 capability 接口)
- 笔记 / 思考 / 图谱 / 文件夹的具体业务 → view 自管 / 业务 capability

**L5-A 实施深度**:
- 最小 schema(doc / paragraph / text)
- ProseMirrorHost 组件(受控,docJson + onChange + readOnly + schemaExtensions 接口位)
- 基础 keymap(Enter / Backspace / 光标移动)
- prosemirror-history 包装为 undo-redo capability

**L5-B 实施深度**:
- schema 加 heading / list / code-block / blockquote
- mark 加 bold / italic / strike / code
- input-rules
- 完整 keymap
- 注册到 selection / clipboard 通用 capability

**L5-C 实施深度**:
- schema 扩展点开放
- noteLink 节点注册(由 NoteView 提供 schema spec + NodeView)
- paste handler 注册(迁移 V1 smart-paste 的核心 dispatcher,但具体 source handler 在各 view / 业务 capability)

**L6 / L6+**:
- 表格 / 数学 / 图片 / 代码块 / Mermaid / 各种富节点
- 拖动手柄 / 块拖放(注册到 drag-and-drop)

### 5.2 graph-editing(留位)

V1 已部分实现(`src/plugins/graph/canvas/edit/GraphEditor.ts`),L6+ 真做时填充。关键观察:**graph 文字编辑共享 80% PM plugin**,所以 GraphView 应该也 install text-editing capability(用于节点文字编辑),只在 graph-editing 加图谱专属(连线 / 节点形状 / 布局)。

### 5.3 留位(L6+)

- `file-management`(文件 CRUD / 重命名 / 移动)
- `web-rendering`(浏览器内嵌)
- `ebook-rendering`(PDF / EPUB)
- `ai-augment`(总结 / 续写 / 翻译,业务 capability 而非内容特定)
- `media-rendering`(图片 / 视频 / 音频通用渲染)

---

## 6. 业务层 vs view 层 vs capability 的判别准则

给后续设计 capability 时一个清单:

| 现象 | 归属 |
|---|---|
| 是用户**动作**(选中 / 复制 / 粘贴 / 移动 / 撤销 / 插入)| **通用交互 capability** |
| 是**内容形态特有**的命令(粗体 / 标题 / 节点连线 / 图谱布局)| **内容特定 capability** |
| 是**跨 view 共享的状态**(当前选区 / 剪贴板内容)| **bus channel + 通用 capability** |
| 是 **view 私有状态**(笔记列表 / 文件夹树 / 导航 history)| **view 自管 / pluginStates** |
| 是**跨 view 协议**(锚定同步 / AI 推送 / openRight)| **bus request + 协议文档** |
| 是**业务流程**(AI 总结 / 翻译 / 文件夹组织 / 跨内容工作流)| **独立业务 capability** |
| 是**框架级保留**(slot 切换 / Workspace CRUD)| **L3 / L3.5 框架内置** |

---

## 7. 协议先于实现:接下来要写的 PROTOCOL 清单

研究产出 → 下一阶段实施起点。

| 文档 | 范围 | 时机 |
|---|---|---|
| `src/capabilities/COMMON-PROTOCOL.md` | 5 通用 capability 协议(channel / request / API 接口签名 + 注册机制 + 5 大铁律) | **L5-A 实施前必写**,对齐 workspace-bus PROTOCOL.md 形式 |
| `src/capabilities/text-editing/DESIGN.md` | text-editing capability L5-A 范围(最小 schema + ProseMirrorHost + 注册到 undo-redo / selection / clipboard) | L5-A 实施前 |
| `src/views/note/DESIGN.md` | NoteView L5-A 范围(install 列表 + pluginStates + NavSide 简单列表 + 命令注册)— 重写 | L5-A 实施前(取代当前已写的 v0.1) |
| `src/capabilities/clipboard/PROTOCOL.md` | clipboard 子协议(envelope 格式约定 / handler 注册接口) | L5-B 加 dispatcher 时 |
| `src/capabilities/drag-and-drop/PROTOCOL.md` | dnd 协议(MIME / DataTransfer / dropTarget 注册) | L5-B 加文件夹拖放时 |

---

## 8. 风险与开放问题(每个给推荐答案)

### 8.1 bookmarks 应该是 capability 还是 view 业务?

V1 把书签(阅读位置)放在 NoteView 内 + help-panel/bookmarks。

**推荐**:**view 业务**(L5-A/B 阶段)。理由:书签是"特定 view 类型的特定功能",eBookView 也有书签但语义不同(章节锚定),GraphView 没书签。强抽 capability 会过早抽象。L7+ 如果发现多 view 共享需求再抽。

### 8.2 selection 跨内容形态时,payload 形状如何统一?

text 是 from/to 数字,graph 是 nodeIds 数组,差异极大。

**推荐**:**discriminated union by `kind`**(已在 § 4.1 协议雏形)。订阅者按 kind 决定怎么读 payload。常见动作(如"有选区"、"清空"、"获取文本"等)由 capability 提供 helper(`selection.getText() / selection.isEmpty()`)。

### 8.3 clipboard 跨内容形态粘贴时的"语义降级"规则?

笔记选区(含 image / math / table)粘到代码块该怎么办?图谱节点粘到笔记该怎么办?

**推荐**:**clipboard envelope 多格式同时写(copy 端)+ paste 端按目标内容类型选格式**。
- 笔记 copy:写 PM JSON + Markdown + HTML + 纯文本
- 代码块 paste:只接受纯文本(自动降级)
- 图谱节点 copy:写 graph-fragment + Markdown(节点文字)+ 纯文本
- 笔记 paste:不识别 graph-fragment → 退化到 Markdown

降级链是 capability 提供的 metadata(`clipboard.formatRanking`),paste 端按目标支持的最高格式取。

### 8.4 drag-and-drop 是不是要更细分?

块拖动 / 选区拖动 / 跨 view 拖动 — 是同一 capability 还是分多个?

**推荐**:**同一 capability**,通过 `source.type / target.type` 区分。理由:它们共享生命周期(start / over / drop / completed)+ 协议(DataTransfer)。差异只在"接什么源 / 接什么目标",这是注册数据,不是 capability 边界。

### 8.5 V1 sendToOtherSlot + 对面 slot 模式,V2 走 bus channel 后,"对面是哪个" 如何表达?

V1 假设 workspace 双 slot,直接调"对面 slot",bus 不能这样。

**推荐**:**走 slotBinding 取目标 view ID**。view 想"通知对面" → 读自己当前 workspace 的 slotBinding,确定对面是哪个 view,emit channel 时 payload 加 `target: viewId`。订阅方按自己的 viewId 过滤。如果是"任意 view 都该收"则不带 target,广播。

具体协议(anchor-sync 等)在 L6+ 接 eBook 时再立。

### 8.6 undo/redo 跨 capability 时栈如何统一?

用户在 Note 改一段 + 在 Graph 改个节点连线,Cmd+Z 回到哪步?

**推荐**:**per-view 栈,不强求全局**(已在 § 4.3)。每个 view 有自己的 undo 历史,焦点 view 决定 undo 的对象。V2 v1 走这条;若 L7+ 出现"用户预期跨 view 全局 undo" 需求再讨论合并栈,届时已有真实场景判断。

### 8.7 thoughtPlugin / titleGuard / vocabHighlight 这种 NoteView 特有的 PM plugin 算 view 内还是 capability?

V1 当 plugin 装到 NoteEditor。

**推荐**:**view 内的 plugin 注册**。理由:这些 plugin **PM 特有**,是 NoteView 调用 text-editing capability 时通过 `schemaExtensions` 注入的扩展。它们**不是独立 capability**(因为不被其他 view 复用),也**不是通用层**(只跟 PM 工作)。形态:NoteView 自己写一个 `note-extensions/` 子目录放这些扩展,通过 ProseMirrorHost 的 `schemaExtensions` props 传给 text-editing。

### 8.8 V1 的 selection-cache 在 V2 还需要吗?

V1 因为右键菜单折叠选区才引入。

**推荐**:**不需要**。V2 的 selection capability channel 自带 lastValue(L3.5 ChannelHub 已实现),任何动作随时取 lastValue 就是最近选区。L3.5 已经把这条架构债防掉。

---

## 9. 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-05-05 | v0.1 | 初稿;Phase 1-4 完整产出;V1 笔记 11 大类功能 → 5 通用 + 1 内容特定 + view/业务三层映射;7 条 V1 病例反向警示;6 张映射表;5 通用 capability 边界白皮书;8 个开放问题带推荐答案 |
