# 通用 Capability 协议规程 v0.1

> **本文是 V2 通用交互 capability 的根协议** — 5 大通用 capability(selection / clipboard / undo-redo / drag-and-drop / insertion)的接口、注册、协作规则,先于实现确立。
>
> **位置**:本文档放 `src/capabilities/COMMON-PROTOCOL.md` — 与 `src/slot/workspace-bus/PROTOCOL.md` 平级,都是 V2 基础设施层的协议规程。
>
> **相关研究**:[V1-function-mapping.md](../../docs/RefactorV2/research/V1-function-mapping.md) § 4 双轴矩阵 + § 5 边界白皮书 是本文的输入。
>
> 文档版本:v0.1
> 编写日期:2026-05-05
> 上下文:L5-A 阶段,5 通用 capability 实施前必须先定本协议

---

## 0. 为什么要协议规程

V2 立项的差异化承诺(charter § 1.4):**view 是能力组合声明,capability 是横切复用**。

如果 V2 只立"text-editing / graph-editing"这种领域大模块,capability 层就成了"V1 plugins/note plugins/graph 改个名字",V2 的设计目标失败。

**V2 的灵魂在通用 capability 这一层** — 把 selection / clipboard / undo-redo / drag-and-drop / insertion 这种**任何内容形态都用得上的用户基础动作**抽到独立 capability,让 NoteView / GraphView / FileExplorer / 等 view 都能复用同一套接口。这是 V2 不同于 V1 的根本。

V1 病例反向证明本协议必要([V1-function-mapping.md § 3](../../docs/RefactorV2/research/V1-function-mapping.md#3-v1-病例反向警示7-条)):

| V1 病例 | 反映的协议缺失 |
|---|---|
| selection 散落三处 | 没有统一 selection 概念 |
| clipboard 散落四处 | 没有 envelope 抽象 + handler 注册 |
| undo/redo 在 NoteEditor 和 GraphEditor 各装一份 | 没有 undo capability 统一接口 |
| viewAPI 全局窗口接口 | 没有 capability registry,跨边界靠 window 后门 |
| sendToOtherSlot 字符串协议路由 | (workspace-bus 已根治,本协议不重述) |

**协议先于实现是 V2 的范式**(workspace-bus PROTOCOL.md / L4 DESIGN.md 都是这条路径)。本协议落定后才能写 capability 实现代码 + view DESIGN。

---

## 1. 协议核心

### 1.1 两类 capability(charter § 1.4)

```
┌─────────────────────────────────────────────────────────┐
│  view 层(NoteView / GraphView / FileExplorer)            │
│  - 通过 install 列表声明依赖哪些 capability                 │
└─────────────────────────────────────────────────────────┘
            ↓ install
┌─────────────────────────────────────────────────────────┐
│  通用交互 capability(本协议覆盖)                           │
│  selection / clipboard / undo-redo / drag-and-drop /     │
│  insertion                                               │
└─────────────────────────────────────────────────────────┘
            ↓ install
┌─────────────────────────────────────────────────────────┐
│  内容特定 capability(各自 PROTOCOL.md / DESIGN.md)         │
│  text-editing / graph-editing / file-management /        │
│  web-rendering / ebook-rendering / ...                   │
└─────────────────────────────────────────────────────────┘
            ↓ uses
┌─────────────────────────────────────────────────────────┐
│  shared/(底层 utility,不是 capability)                    │
│  data-transfer 抽象 / position helpers / etc.            │
└─────────────────────────────────────────────────────────┘
            ↓ uses
┌─────────────────────────────────────────────────────────┐
│  浏览器 / OS API(Selection API / Clipboard API / dnd)    │
└─────────────────────────────────────────────────────────┘
```

### 1.2 5 通用 capability 的共同 API 形态

每个通用 capability 暴露一致的接口形态:

```ts
interface GenericCapability {
  // 元信息
  readonly id: string;
  readonly version: string;
  
  // 注册接口(让"提供者"注册自己的能力)
  registerSpec?(spec: ...): Result<void>;  // selection 注册 selection source
                                            // clipboard 注册 serializer/handler
                                            // dnd 注册 dropTarget
                                            // insertion 注册 safeguard
                                            // undo-redo 注册 undoCommand
  
  // 通信接口(让"消费者"订阅状态 / 调用动作)
  channel?: ChannelSpec[];   // emit 的 channel 列表
  request?: RequestSpec[];   // 接受的 request 列表
  
  // public API(直接调用,不走 bus)
  api?: { ... };  // 仅 view / 内容特定 capability 调用
}
```

**消费者(view + 内容特定 capability)**通过两条路径用 capability:
1. **bus channel / request**(动态状态 / 动作)
2. **registerSpec**(静态扩展点 — 注册自己的内容形态)

**capability 之间永远不互相 import 代码**(铁律 5)。

### 1.3 反模式警示(Q-D6 用户拍板)

> ⚠️ **不要把 capability registry 当 service locator**
> 
> 错误模式:dnd capability 通过 `capabilityRegistry.get('clipboard').api.writeToDataTransfer(...)` 调 clipboard 的 helper。
> 
> **为什么错**:
> - service locator 让依赖关系**隐式化**(代码里不显式说依赖,运行时却调)
> - capability 之间产生**逻辑耦合**,只是 import 路径绕了一圈
> - 测试时难以替换(mock 也要走 registry)
> - 长期会破坏 capability 边界
> 
> **正确做法**:
> - 共享逻辑下沉到 `src/shared/`(承认它**本来就不是 capability**)
> - 跨 capability 状态通信走 bus channel
> - 跨 capability 触发动作走 bus request
> - capability 之间**真零代码依赖**

> ⚠️ **不要把共享 utility 误抽成 capability**
> 
> 错误模式:发现 clipboard 和 drag-and-drop 都需要操作 DataTransfer,把 DataTransfer 抽象抽成 `data-transfer` capability,让两者依赖它。
> 
> **为什么错**:
> - capability 是用户感知的能力(动作 / 状态),不是实现细节
> - DataTransfer 抽象是浏览器 API 封装,用户不感知
> - 抽成 capability 会让 capability 数量爆炸,边界模糊
> 
> **正确做法**:
> - 共享 utility 放 `src/shared/data-transfer.ts`
> - clipboard 和 dnd 都 import 它(import shared/ 不违反铁律 5)
> - 同时在两个 capability 的 README 里说明用了同一个 shared utility(可读性)

---

## 2. 协议铁律

### 2.1 6 条 capability 特有铁律

> 这些铁律是 V2 capability 模型独有的,本协议立。

#### 铁律 1:协议先于实现
新 capability 落地前先写 PROTOCOL / DESIGN,通过用户审阅后才写代码。

实施铁律:
- 通用 capability 协议在本文 § 3-§ 7
- 内容特定 capability 各自 `src/capabilities/<id>/PROTOCOL.md`(可选)+ `DESIGN.md`(必需)

#### 铁律 2:capability 不持有"业务数据"
capability 只持有**协议状态**(注册表 / 当前选区 / 剪贴板 envelope 等运行时态),**不持有用户的业务数据**(笔记内容 / 笔记列表 / 文件夹树 / 等)。

业务数据归 view 自管,通过 `WorkspaceState.pluginStates`(L3 已建)持久化。

例:
- ✅ selection capability 持有"当前选区状态"(`{ from, to, kind }`)— 协议状态
- ❌ clipboard capability 持有"用户最近复制的笔记 doc fragment" — 业务数据,不持久化只在内存
- ✅ clipboard capability 内存里有最近一次复制的 envelope(为 paste 时取用)— 协议状态(刷新即丢)

#### 铁律 3:统一注册形态
每个 capability 暴露 `register*Spec` API,内容特定 capability / view 通过此 API 注册自己的能力到通用 capability。

例:
- text-editing 注册到 selection:`selection.registerSource(textEditingSelectionSource)`
- text-editing 注册到 clipboard:`clipboard.registerSerializer({ contentType: 'text-editing/pm-doc', format: 'markdown', serialize: ... })`
- text-editing 注册到 undo-redo:`undoRedo.registerScope({ scope: 'note-pm', undo: ..., redo: ... })`

注册形态一致 → 学一个用一片。

#### 铁律 4:内容特定 capability 通过通用 capability "上交能力"
当内容特定 capability 注册一个 BlockSpec(例:text-editing 的 mathBlock 注册时)时,**自动把 BlockSpec 中的相关字段上交给对应通用 capability**:

| BlockSpec 字段 | 上交给 |
|---|---|
| selectionBehavior + getSelectionState | selection capability |
| pasteGuard + parsers.fromX | clipboard capability(作为 PasteHandler 注册数据) |
| serializers.toX | clipboard capability(作为 Serializer 注册数据) |
| dropAccepts | drag-and-drop capability(作为 DropTarget 注册数据)|
| (undo 实现固定走 PM history) | undo-redo capability |

意义:**单一注册入口** → **多通用 capability 自动收编**,每加一个 block 不需要改通用 capability 内部代码。

#### 铁律 5:capability 之间零代码 import
**capability 之间不互相 import 代码,不调用对方 public API**。共享逻辑只能通过两条路径:
1. **下沉到 `src/shared/`**(承认是底层 utility)
2. **通过 bus channel / request 通信**(workspace-bus L3.5)

违反此铁律的最常见诱惑(避免):
- service locator(用 capability registry 拿对方 API)
- 抽出"中间 capability"作为共享层
- 在 capability A 直接 `import { something } from '@capabilities/B'`

#### 铁律 6:命名空间保留前缀
capability 注册的 channel / request / spec ID 必须以 capability ID 为命名空间前缀。

例:
- ✅ `selection.changed`(selection capability 的 channel)
- ✅ `clipboard.copy`(clipboard capability 的 request)
- ✅ `clipboard.text-editing-pm-doc`(clipboard 的 serializer ID,以 contentType 限定)
- ❌ `text-changed`(无前缀,可能与他人冲突)

保留前缀(view / capability 不可用):
- `selection.*` / `clipboard.*` / `undo-redo.*` / `dnd.*` / `insertion.*`(本协议各 capability 保留)
- `slot.*`(workspace-bus L3.5 保留)

### 2.2 4 条继承自 workspace-bus 的铁律

> 这些铁律 workspace-bus PROTOCOL.md 已立,capability 协议**继承不重述**。

#### 铁律 7:Workspace scope only(对齐 bus 铁律 2)
capability 实例**每个 Workspace 一个**,跨 Workspace 不通。bus 已经物理隔离 Workspace,capability 跟随。

跨 Workspace 通信(罕见)走主进程 IPC,不在本协议范围。

#### 铁律 8:dev mode typeof 校验(对齐 bus 铁律 3)
- TypeScript 类型 + 编译期校验
- dev mode 对 register* / channel emit 的 payload 顶层字段做 `typeof` 检查,不符 console.warn
- prod 0 开销
- **不引入** zod / valibot 等运行时校验库(charter § 1.3)

#### 铁律 9:Result<T> 不抛错(对齐 bus 风格)
所有 capability 操作返回 `Result<T>`,不抛错。调用方 if 判断,不写 try/catch。

```ts
type Result<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; detail?: unknown };
```

承袭自 [workspace-bus/bus-types.ts](../slot/workspace-bus/bus-types.ts)。

#### 铁律 10:错误隔离(对齐 bus channel 行为)
- 一个 listener / handler 抛错不影响其他
- 注册的 spec 抛错时 console.error + 跳过该 spec,不破坏整个 capability

---

## 3. capability 1:selection

### 3.1 责任 / 不责任

**这层做什么**:
- 统一"用户选中了什么"的概念,提供单一 channel 让 UI / 动作订阅
- 覆盖多种选择模式(字符 / 块 / 多块 / 跨内容形态)
- emit 选区变化事件,提供 helper API(getText / isEmpty / 等)

**这层不做什么**:
- 不持有具体内容(选区只是位置 / 范围概念,不含数据)
- 不序列化(走 clipboard)
- 不响应键盘(由内容特定 capability 自己捕获 + 包装 + emit)

### 3.2 协议接口

#### channel(emit 的事件)

```ts
// 'selection.changed'
// payload: discriminated union by `kind`
type SelectionPayload = {
  source: string;      // 'text-editing' / 'graph-editing' / 等
  isEmpty: boolean;
  kind: 'text' | 'block' | 'multi-block' | 'graph-nodes' | 'tree-nodes' | 'empty';
  // text 模式
  from?: number; to?: number; anchor?: number; head?: number;
  // block / multi-block 模式
  positions?: number[];
  // graph-nodes 模式(L6+)
  nodeIds?: string[];
  // tree-nodes 模式(NavSide 树等)
  treeNodeIds?: string[];
};
```

lastValue 自动开启(订阅者后挂载时立即拿到当前选区,L3.5 ChannelHub 已支持)。

#### registerSpec(让内容特定 capability 注册"selection source")

```ts
interface SelectionSourceSpec {
  // capability ID('text-editing' / 'graph-editing' / 等)
  source: string;
  // 当 selection source 自己的 selection 改变时,调用此函数转换为 SelectionPayload 并 emit
  // 由内容特定 capability 在 mount 时主动调,capability 不轮询
  emit: (payload: SelectionPayload) => void;
}

selection.registerSource(spec): Result<void>;
selection.unregisterSource(source: string): void;
```

#### public API(view / 内容特定 capability 调用)

```ts
selection.api: {
  // 取当前选区(从 lastValue,等价于读 channel.getLastValue)
  getCurrent(): SelectionPayload | null;
  
  // 取当前选区的"文本表示"(若 kind 支持,如 text/block 模式)
  // 跨内容形态返回 null(如 graph-nodes 不能转字符串)
  getText(): string | null;
  
  // 是否为空选区
  isEmpty(): boolean;
};
```

### 3.3 实施深度

| 阶段 | 范围 |
|---|---|
| L5-A | text-editing 注册一个 source,emit 字符级 selection.changed,测 channel 订阅 + lastValue + getCurrent / isEmpty |
| L5-B | text-editing 加块级 selection 模式(blockSelection plugin 包装)+ 多块模式 |
| L5-C | text-editing 加 inline atom 选中(noteLink 等)|
| L6 | graph-editing 注册自己的 source,emit graph-nodes selection,验证 UI 跨内容统一订阅 |

---

## 4. capability 2:clipboard

### 4.1 责任 / 不责任

**这层做什么**:
- 多 envelope copy(原生 PM JSON / Markdown / HTML / 纯文本同时写)
- paste dispatcher + handler 注册制
- 提供 DataTransfer 读写 helper(给 dnd capability 复用 — 但 dnd 是从 `src/shared/data-transfer.ts` import,不是从 clipboard import)

**这层不做什么**:
- 不知道"选了什么"(走 selection)
- 不知道"怎么序列化"(各内容特定 capability 注册 serializer)
- 不知道"怎么理解粘贴源"(各 view / 业务 capability 注册 PasteHandler)
- 不持有用户业务数据(铁律 2)

### 4.2 协议接口

#### request(请求-响应)

```ts
// 'clipboard.copy'
type ClipboardCopyInput = {
  format?: 'auto' | 'pm-json' | 'markdown' | 'html' | 'plain';
  // 默认 'auto' = 多 envelope 同时写
  selection?: SelectionPayload;
  // 若不传,从 selection capability 取 lastValue
};

// 'clipboard.paste'
type ClipboardPasteInput = {
  dataTransfer?: DataTransfer;
  target?: { pos: number; node?: PMNode };  // 落点(若不传从 selection 取光标)
};
```

#### registerSpec

```ts
// 序列化注册(各内容特定 capability 注册"我的内容怎么转 markdown / html")
interface SerializerSpec {
  contentType: string;           // 'text-editing/pm-doc' / 'graph-editing/fragment'
  format: 'markdown' | 'html' | 'plain';
  serialize: (data: unknown) => string;
}
clipboard.registerSerializer(spec): Result<void>;

// paste handler 注册(各 view / 业务 capability 注册"我能理解什么源")
interface PasteHandlerSpec {
  id: string;                    // 'note-paste-chatgpt' / 'note-paste-word'
  detect: (dataTransfer: DataTransfer) => boolean;
  parse: (dataTransfer: DataTransfer) => Promise<{ markdown?: string; pmDoc?: unknown }> | { markdown?: string; pmDoc?: unknown };
  priority?: number;             // 越大优先级越高
}
clipboard.registerPasteHandler(spec): Result<void>;
```

#### channel(状态广播)

```ts
'clipboard.changed': {
  source: 'internal' | 'external';
  envelopes: ('pm-json' | 'markdown' | 'html' | 'plain')[];
};
```

### 4.3 实施深度

| 阶段 | 范围 |
|---|---|
| L5-A | text-editing 注册 'pm-json' / 'markdown' / 'plain' serializer;走 PM 默认 paste(暂不 dispatcher) |
| L5-B | 加 dispatcher,迁移 V1 smart-paste source handler(chatgpt / claude / gemini / generic) |
| L5-C | 支持跨 view 复制粘贴(笔记选区粘到 thought) |
| L6 | graph-editing 注册自己的 serializer(图谱节点 → markdown 表示) |

---

## 5. capability 3:undo-redo

### 5.1 责任 / 不责任

**这层做什么**:
- 提供 undo / redo 标准 request
- 维护 per-view 栈(每个 view 一个 scope)
- emit 状态 channel(canUndo / canRedo)

**这层不做什么**:
- 不知道具体怎么 undo(各 scope 注册自己的 undo 实现)
- 不强求全局栈跨 view(per-view 即可,见 § 11 开放问题)
- 不持久化栈(刷新即丢)

### 5.2 协议接口

#### request

```ts
// 'undo-redo.undo'
type UndoInput = { scope?: string };  // 不传 = 当前焦点 scope

// 'undo-redo.redo'
type RedoInput = { scope?: string };
```

#### registerSpec

```ts
interface UndoScopeSpec {
  scope: string;                 // 'note-pm' / 'graph-canvas' / 等
  undo: () => boolean;           // 调用,返回是否成功(false = 没东西可 undo)
  redo: () => boolean;
  canUndo: () => boolean;        // 状态查询,emit 时调
  canRedo: () => boolean;
}
undoRedo.registerScope(spec): Result<void>;
undoRedo.unregisterScope(scope: string): void;
```

#### channel

```ts
'history.changed': {
  scope: string;
  canUndo: boolean;
  canRedo: boolean;
};
```

#### public API

```ts
undoRedo.api: {
  setActiveScope(scope: string | null): void;  // 焦点 scope,影响"不传 scope 时调谁"
  getActiveScope(): string | null;
};
```

### 5.3 实施深度

| 阶段 | 范围 |
|---|---|
| L5-A | text-editing 注册 'note-pm' scope(包装 prosemirror-history 的 undo/redo);Cmd+Z / Cmd+Shift+Z keymap 调 capability |
| L5-B/C | 稳定运行,跨 block / 跨 capability 操作的 undo 验证 |
| L6 | graph-editing 注册 'graph-canvas' scope(自己的 undo 栈)|

---

## 6. capability 4:drag-and-drop

### 6.1 责任 / 不责任

**这层做什么**:
- 拖动生命周期(start / over / drop)
- 落点解析框架(给定鼠标位置,问每个注册的 dropTarget)
- DataTransfer 协议(从 `src/shared/data-transfer.ts` import,不依赖 clipboard)

**这层不做什么**:
- 不知道"接什么 drop"(内容特定 capability 注册 dropTarget)
- 不知道"具体落地动作"(注册时给 onDrop 回调)
- 不与 clipboard 互相 import 代码(铁律 5)— 共享 DataTransfer 抽象在 shared/

### 6.2 协议接口

#### request

```ts
// 'dnd.startDrag'
type StartDragInput = {
  source: { type: string; data: unknown };
  // type 命名空间:'text-editing/block' / 'graph-editing/node' / 等
};

// 'dnd.drop'
type DropInput = {
  target: { type: string; pos?: number };
  dataTransfer: DataTransfer;
};
```

#### registerSpec

```ts
interface DropTargetSpec {
  id: string;
  // 接受什么 source.type(精确匹配或 namespace 前缀)
  accepts: string[];             // ['text-editing/block', 'image/*']
  // 给定鼠标坐标,返回是否可作为 drop 目标 + 具体目标位置
  computeDropPoint: (
    coords: { x: number; y: number },
    view: unknown,
  ) => { pos: number; valid: boolean } | null;
  // 落地回调
  onDrop: (input: { source: unknown; target: { pos: number }; dataTransfer: DataTransfer }) => void;
}
dnd.registerDropTarget(spec): Result<void>;
```

#### channel

```ts
'dnd.over': {
  mouseX: number;
  mouseY: number;
  candidateTargetId: string | null;
  valid: boolean;
};

'dnd.completed': {
  sourceType: string;
  targetId: string | null;
  mode: 'move' | 'copy';
  success: boolean;
};
```

### 6.3 实施深度

| 阶段 | 范围 |
|---|---|
| L5-A | 不实施(单 NoteView 没拖动需求) |
| L5-B | NavSide 文件夹树拖放笔记(view 业务用 dnd capability,但 NavSide UI 是 view 业务,见 § 1.3 反模式)|
| L5-C | 笔记内块拖动重排(迁移 V1 block-handle) |
| L6+ | 跨 view 拖放(笔记块拖到 GraphView 当节点) |

---

## 7. capability 5:insertion

### 7.1 责任 / 不责任

**这层做什么**:
- 框架级"安全插入"协议(光标祖先守卫 / position 解析 / 批量原子操作)
- 提供 `safeInsert(target, content)` 通用接口
- safeguard 注册(允许业务 capability 加额外守卫)

**这层不做什么**:
- 不知道"插什么"(内容特定 capability 提供节点 / 内容工厂)
- 不知道"插哪里"(由调用方提供 / 从 selection 拿光标)
- 不与 clipboard 重叠(insertion 处理"插入语义 + 守卫",clipboard 处理"内容来源 + 序列化")

### 7.2 协议接口

#### request

```ts
// 'insertion.insert'
type InsertInput = {
  target: { pos: number; mode?: 'replace' | 'before' | 'after' };
  content: unknown;
  contentType: string;           // 'text-editing/pm-fragment' 等
  safeMode?: boolean;            // 默认 true(走 safeguard)
};
```

#### registerSpec

```ts
interface SafeguardSpec {
  id: string;
  // 给定要插入的内容 + 目标 + 当前文档状态,判断是否安全
  check: (input: {
    target: { pos: number };
    content: unknown;
    contentType: string;
    docContext: unknown;         // PM doc / graph state / etc.
  }) => { safe: boolean; reason?: string };
}
insertion.registerSafeguard(spec): Result<void>;
```

#### public API

```ts
insertion.api: {
  // 直接调用,不走 request(给 capability 内部用)
  safeInsert(input: InsertInput): Result<void>;
};
```

### 7.3 实施深度

| 阶段 | 范围 |
|---|---|
| L5-A | 不实施(单 view 不需要框架级守卫) |
| L5-B | 迁移 V1 pasteIsSafe 守卫(text-editing 注册祖先链守卫) |
| L5-C | slash 命令 + AI Sync 走同一接口 |
| L6+ | 跨 view 插入(把 graph 节点 fragment 插到笔记) |

---

## 8. 跨 capability 协作场景(3 个内容操作场景)

把研究文档里典型的"组合操作"落地到 capability 协议层面。**全部聚焦内容操作,NavSide 等 view 业务不在本节**(Q-D5' 用户拍板)。

### 8.1 场景 A:多块选中 → 拷贝 → 同笔记内粘贴

**用户视角**:在笔记里多块选中 3 个段落 → Cmd+C → 光标移到另一处 → Cmd+V → 3 段落粘贴到光标处。

**capability 协作流**:

```
用户 ESC 进入块选模式(text-editing 内部)
  ↓
text-editing 调 selection.registerSource('text-editing').emit({
  source: 'text-editing', kind: 'multi-block', positions: [12, 47, 89], isEmpty: false
})
  ↓ channel 'selection.changed' 广播 + lastValue 缓存
  
用户 Cmd+C(text-editing keymap 触发,bus.requests.request('clipboard.copy', { format: 'auto' }))
  ↓
clipboard 内部:
  1. 从 selection.api.getCurrent() 拿 lastValue → SelectionPayload(multi-block)
  2. 找已注册 serializer 中匹配 contentType='text-editing/pm-doc' 的所有 format
  3. 调 serializer 把多块 selection → pm-json + markdown + html + plain
  4. 写多 envelope 到 navigator.clipboard
  5. emit 'clipboard.changed' { source: 'internal', envelopes: ['pm-json', 'markdown', 'html', 'plain'] }
  ↓ Result<void> ok=true 返回
  
用户移动光标 → text-editing 再次 emit selection.changed(kind='text', empty position)
  
用户 Cmd+V(text-editing keymap 触发,bus.requests.request('clipboard.paste'))
  ↓
clipboard 内部:
  1. 从 navigator.clipboard 读 dataTransfer
  2. 走 PasteHandler dispatcher(按 priority 试 detect/parse)
  3. text-editing 的 'pm-json' parser 命中(因为 envelope 含 pm-json marker)
  4. 反序列化得到 pm fragment
  5. 调 insertion.api.safeInsert({ target: 当前光标, content: fragment, contentType: 'text-editing/pm-fragment' })
  ↓
insertion 内部:
  1. 调所有注册的 safeguard.check
  2. text-editing 注册的"祖先链守卫"检查:粘贴后光标祖先链不破坏
  3. 全部通过 → 调 PM tr.replaceSelectionWith(fragment) → view.dispatch(tr)
  4. PM history 自动记录(undo-redo 不需要单独动作)
  ↓ Result<void> ok=true
  
用户视觉:3 段落粘贴到光标处
```

**关键观察**:
- selection / clipboard / insertion 三个 capability 协作完成,每个只管自己的责任
- text-editing 是"提供者"(注册 serializer / safeguard),不是"消费者"
- bus channel(selection.changed / clipboard.changed)让旁观者(如 FloatingToolbar)知道发生了什么,不参与协作

### 8.2 场景 B:笔记选段 → AI 总结 → 结果在 right slot 显示

**用户视角**:笔记里选一段 → 右键"问 AI 总结" → AI 在 right slot 弹一个总结结果 view。

**capability 协作流**:

```
用户选中文字(text-editing emit selection.changed kind='text')
  
用户右键 → V2 ContextMenu(L4)弹出,选"AI 总结"项
  ↓
该项的 command 处理函数(NoteView 注册到 commandRegistry):
  1. selection.api.getText() 拿当前选区文本
  2. selection.api.getCurrent() 拿选区元数据(用于回填位置)
  3. bus.requests.request('ai.summarize', { text, sourceNoteId })
     → AI capability(L6+,业务 capability)处理,返回 summary
  4. bus.slot.openRight('ai-summary-view', { summary, anchor: { noteId, range } })
     → workspace-bus L3.5 切右 slot 装载新 view
  
right slot 加载 ai-summary-view:
  - 读 payload.summary 渲染
  - 读 payload.anchor 用于"跳回笔记位置"按钮
  
用户 Cmd+S 笔记 → 不影响 right slot(各 view 独立)
```

**关键观察**:
- 跨 capability + 跨 § 1 § 2 边界(selection 是 § 1.a 文档内,bus.slot.openRight 是 § 2.b 跨文档)
- selection capability 提供"读当前选区",AI capability(L6+)提供"业务能力",workspace-bus 提供"跨 view 切换"
- 通用 capability 之间仍**零代码 import**(selection 不知道 AI 存在,AI 不知道 workspace-bus 存在,各自独立)
- view 是装配点 — NoteView 的 commandRegistry handler 拼起整条流程

### 8.3 场景 C:笔记内块拖动重排

**用户视角**:笔记里 hover 块手柄 → 拖动 → 落到另一段下方 → 块被移到新位置。

**capability 协作流**:

```
鼠标 hover 块手柄 → text-editing block-handle plugin 显示手柄
  
用户 mousedown 手柄拖动 → text-editing 调 bus.requests.request('dnd.startDrag', {
  source: { type: 'text-editing/block', data: { sourcePos, blockNode } }
})
  ↓
dnd 内部:
  1. 接管 dragstart 事件
  2. 把 source.data 写入 DataTransfer(走 src/shared/data-transfer.ts 抽象)
  3. emit 'dnd.over' channel(实时报告候选 dropTarget)

鼠标移动 → dnd 内部不断:
  1. 调每个注册的 DropTargetSpec.computeDropPoint(coords, view)
  2. 找到第一个 valid=true 的目标 → emit 'dnd.over' { candidateTargetId: 't1', valid: true }
  3. text-editing 的 dropTarget(注册时 accepts=['text-editing/block'])命中,返回 pos=87
  
鼠标 mouseup 落下 → dnd 调 DropTargetSpec.onDrop:
  1. text-editing 的 onDrop:
     a. 调 insertion.api.safeInsert({ target: { pos: 87 }, content: blockNode, contentType: 'text-editing/pm-block' })
     b. insertion safeguard 检查通过 → PM tr.insert(87, blockNode)
     c. text-editing 自己再删原位置(sourcePos 处),用 PM tr.delete(sourcePos, sourcePos + nodeSize)
     d. PM history 自动记录(可 undo)
  2. emit 'dnd.completed' { sourceType: 'text-editing/block', targetId: 't1', mode: 'move', success: true }
  ↓ Result<void> ok=true
  
用户视觉:块从原位置消失,出现在新位置
用户 Cmd+Z → undo-redo.api.api.undo({ scope: 'note-pm' }) → PM history 还原 doc
```

**关键观察**:
- dnd / insertion / undo-redo 三个 capability 协作 + text-editing 注册 source/target/safeguard
- DataTransfer 抽象是 `src/shared/data-transfer.ts` 提供的(铁律 5,dnd 不 import clipboard)
- "移动"语义 = "插入 + 删除"两步(text-editing 自己组合,不在 dnd 协议里)— 因为不同内容形态的"移动"语义可能不同(graph 移动节点不删除原 node,只改 position)
- undo 走 PM history scope(text-editing L5-A 注册的)

---

## 9. 与 charter / workspace-bus 协议的对照

### 9.1 charter § 1.4 的归属规则 → 本协议如何遵守

| § 1.4 规则 | 本协议如何遵守 |
|---|---|
| 应用级 UI 在 Workspace Container(L3) | capability 不渲染 UI(view 渲染,通过订阅 capability channel + 调 capability API)|
| 能力 UI 在 Capability(L4) | capability 暴露 API(selection.api / clipboard.api / 等),view 通过 install 拿到 |
| View 是能力组合声明(L5) | view.install: ['text-editing', 'selection', 'clipboard', ...] 显式声明依赖 |
| view 平等,无 variant | capability 协议没有 variant 字段,所有 view 平等使用 |
| view 文件极轻 | view 通过 capability 注册自己的扩展(不内置实现)|

### 9.2 workspace-bus § 9 铁律 → 本协议如何继承

| workspace-bus 铁律 | 本协议状态 |
|---|---|
| 1. 三类管道 | 本协议**不引入新管道**,继续走 workspace-bus 的 channel/request/slot |
| 2. Workspace scope only | 本协议铁律 7(继承)|
| 3. dev mode typeof 校验 | 本协议铁律 8(继承)|
| 4. Manifest 分散 | 本协议铁律 3 是更具体的形式(register*Spec 在各 view / 内容特定 capability) |
| 5. 主 view 锁 | 本协议不涉及(workspace-bus 自己管)|
| 6. Slot Control 框架级 | 本协议不涉及(workspace-bus 自己管)|
| 7-9. slot 升级 / last view / NavSide 切换 | 本协议不涉及(workspace-bus 自己管)|

### 9.3 边界明确:capability ≠ bus

容易混淆的两个概念:

| | workspace-bus | 通用 capability |
|---|---|---|
| 本质 | 消息通道 | 动作能力 |
| 形态 | channel + request + slot | register + emit + api |
| 范围 | 跨 view 实例 | 内容操作 |
| 持有 | listener 集合 + lastValue | 注册的 spec 集合 + 协议状态 |
| 持续 | 长生命周期(workspace 级) | 长生命周期(capability 级) |
| 例 | "笔记选区变化" 事件 | "选区"概念本身 |

bus 是 capability 之间通信的工具(铁律 5);capability 是 view 用的能力。两者不冲突 — capability 用 bus 来 emit channel / 接受 request,但 capability 本身**不是** bus 的一部分。

---

## 10. 留位:未来内容特定 capability(L6+)

本协议是通用 capability 的根协议。未来内容特定 capability 各自立 PROTOCOL.md,继承本协议的:
- 铁律(全部 10 条)
- 注册形态(铁律 3)
- 命名空间(铁律 6 — 各内容特定 capability 用自己的 ID 作前缀)

L6+ 候选内容特定 capability:
- `text-editing`(L5-A 起,见 [src/capabilities/text-editing/DESIGN.md](text-editing/DESIGN.md))
- `graph-editing`(L6+,V1 部分实现)
- `file-management`(L6+,文件 CRUD)
- `web-rendering`(L6+,浏览器内嵌)
- `ebook-rendering`(L6+,PDF / EPUB)
- `media-rendering`(L6+,图片 / 视频 / 音频通用)
- `ai-augment`(L6+,业务 capability,跨多 view)

---

## 11. 风险 + 开放问题

每个开放问题给推荐答案。

### 11.1 selection 跨内容形态时,payload 形状如何统一?

text 是 from/to 数字,graph 是 nodeIds 数组,差异极大。

**推荐**:**discriminated union by `kind`**(已在 § 3.2 协议)。订阅者按 kind 决定怎么读。常见动作(getText / isEmpty)由 capability 提供 helper。

### 11.2 clipboard 跨内容形态粘贴时的"语义降级"规则?

笔记选区(含 image / math / table)粘到代码块,图谱节点粘到笔记,该怎么办?

**推荐**:**多 envelope copy + paste 端按目标内容类型选最高格式**。降级链由 PasteHandler 的 priority 字段表达;clipboard dispatcher 按 priority 顺序试 detect/parse,目标 view 接受得了的最高格式胜出。

### 11.3 drag-drop 与 clipboard 的 DataTransfer 共享如何抽象?

V2 严格遵守"capability 间零 import"(铁律 5),但两者都需要 DataTransfer 操作。

**推荐**:**`src/shared/data-transfer.ts`** 作为底层 utility,提供 `writeMultiEnvelope / readEnvelope / etc.` API。clipboard 和 dnd 都 import 它(import shared/ 不违反铁律 5)。

### 11.4 undo-redo 跨 capability 操作时栈策略

用户在 NoteView 改一段(走 'note-pm' scope)+ 在 GraphView 改节点连线(走 'graph-canvas' scope),Cmd+Z 撤销哪步?

**推荐**:**per-view 栈,焦点决定撤销目标**(已在 § 5.2)。view 切换时调 `undoRedo.api.setActiveScope(scope)`,Cmd+Z 撤销当前焦点 scope 的栈顶。L7+ 出现"全局栈"需求时再讨论合并。

### 11.5 insertion safeInsert 在多种 target 形态下如何统一接口?

文本 target 是 pos:number,graph target 是 (x,y) 坐标,文件 target 是路径。

**推荐**:**target 用 discriminated union**:
```ts
type InsertTarget = 
  | { type: 'text'; pos: number; mode?: 'replace' | 'before' | 'after' }
  | { type: 'graph'; x: number; y: number }
  | { type: 'file-tree'; parentId: string; index: number };
```
safeguard 按 type 分别处理。L5-A/B 只有 text 类型;L6+ 加 graph 时补。

### 11.6 capability 命名空间的规约?

是 `selection.changed` 还是 `selection.event.changed` 还是 `capability.selection.changed`?

**推荐**:**`<capability-id>.<topic>.<verb>`**(2 段或 3 段)。bus channel 命名:`selection.changed` / `clipboard.changed` / `dnd.over` / `dnd.completed` / `insertion.inserted` / `history.changed`(undo-redo 的 channel 用 history. 因为 history 是更准确的概念)。bus request 命名:`<capability-id>.<verb>`(`clipboard.copy` / `clipboard.paste` / `undo-redo.undo`/ `undo-redo.redo` / `dnd.startDrag` / `dnd.drop` / `insertion.insert`)。

### 11.7 capability 自定义(用户扩展 / 第三方 plugin)

L7+ 真有用户/插件扩展 capability 时如何注册?

**推荐**:**v1 不实施,接口预留**。本协议不强制"capability 可被运行时注入"。L7+ 真有需求时(如插件市场),设计 capability 注册中心(类似 view-type-registry),但不在 v1 范围。

### 11.8 capability 卸载 / 销毁?

view 关闭时,该不该卸载 selection capability 中该 view 注册的 source?

**推荐**:**自动随 view 生命周期**。view register 时返回 unregister 函数,view unmount 时自动调用。具体实施:capability 内部维护 source/spec → view 关联,view 卸载时清理。

---

## 12. 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-05-05 | v0.1 | 初稿;6 capability 特有铁律 + 4 条继承自 workspace-bus 的铁律(总 10 条);5 通用 capability 协议(每个含责任 / 不责任 / channel/request/registerSpec/api/实施深度)+ 3 个跨 capability 协作场景 + 8 个开放问题带推荐答案;Q-D1=A / Q-D2'=A / Q-D3'=A / Q-D4=C / Q-D5'=A / Q-D6=A 用户拍板固化 |
