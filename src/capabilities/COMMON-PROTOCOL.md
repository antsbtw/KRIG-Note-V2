# 通用 Capability 协议规程 v0.3

> **本文是 V2 通用交互 capability 的根协议**。
>
> 5 个通用 capability:**selection / clipboard / undo-redo / drag-and-drop / insertion**。
>
> v0.3 将 text-editing 从本协议中**完全剥离** — 它不是 capability,是 driver layer(驱动层)。具体见 [src/drivers/COMMON-DRIVER-PROTOCOL.md](../drivers/COMMON-DRIVER-PROTOCOL.md)。
>
> **位置**:`src/capabilities/COMMON-PROTOCOL.md` — 与 `src/slot/workspace-bus/PROTOCOL.md` 平级。
>
> **相关研究**:[V1-function-mapping.md](../../docs/RefactorV2/research/V1-function-mapping.md)(双轴矩阵)+ [V1-block-operations.md](../../docs/RefactorV2/research/V1-block-operations.md)(BlockSpec 接口设计)。
>
> 文档版本:v0.3
> 编写日期:2026-05-05
> 上下文:L5-A 阶段,5 通用 capability + driver 层实施前必须先定本协议

---

## 0. 设计哲学

### 0.1 V2 立项的差异化承诺(charter § 1.4)

view 是能力组合声明,**capability 是横切复用** — view 可以装也可以不装的能力。

但 capability 不是"统一动作执行者" — 它是**协议**(让具体动作在统一形态下可观察、可订阅、可注册)。

### 0.2 这个协议覆盖什么、不覆盖什么

**覆盖**:5 个**横切动作 capability** — selection / clipboard / undo-redo / drag-and-drop / insertion。

**不覆盖**:
- driver layer(text-editing-driver / graph-editing-driver / etc.)→ [drivers/COMMON-DRIVER-PROTOCOL.md](../drivers/COMMON-DRIVER-PROTOCOL.md)
- 业务 capability(ai-augment / etc.) → 各自 PROTOCOL.md(L6+)
- view 业务 → 各 view DESIGN.md

### 0.3 capability vs driver 的根本差异

V2 经过反复推敲(用户拍板 Q-D1~D5)区分了两类完全不同的架构层:

| | **capability**(横切能力) | **driver**(驱动层) |
|---|---|---|
| 例 | selection / clipboard / undo-redo / dnd / insertion | text-editing-driver / graph-editing-driver(L6+) |
| view 跟它的关系 | view **可选装配**(install) | view **必经此驱动**(无法绕过) |
| 角色 | 横切能力(view 装它多一种能力) | 业务驱动(把底层工具/资源编织成 view 可用的运行态) |
| 目录 | `src/capabilities/` | `src/drivers/` |
| 协议规程 | 本文 | [drivers/COMMON-DRIVER-PROTOCOL.md](../drivers/COMMON-DRIVER-PROTOCOL.md) |
| 服务对象 | 多个 view 共用 | 一类 view 专用 |
| 性质 | 协议 + 状态聚合 + 注册中心 | 驱动 + 编织 + 封装下层 |

**类比**:
- capability ≈ 浏览器的"剪贴板 API / Selection API"(横切能力,网页选用)
- driver ≈ 浏览器的"Blink rendering engine"(驱动层,网页必经)

**如果分不清,问自己**:view 能否"不装它"还能跑?
- 能跑(只是少一种能力)→ 是 capability
- 不能跑(view 失去基础渲染/编辑) → 是 driver

### 0.4 用户在 4 轮讨论中揭示的真理

| 轮次 | 用户洞察 | 落实 |
|---|---|---|
| 1 | "block 操作不一致时怎么办?统一抽象必撞车" | capability 不再"统一执行动作",纯协议化(铁律 1) |
| 2 | "block 内编辑必须有根据体验不断迭代优化的能力" | 每个 block 是独立 src 目录,自由演化(driver 层定义) |
| 3 | "5 基础动作 → block 编辑 → 多块 → view 编辑" | 没有"多块协调器"作为预设结构(协议性涌现) |
| 4 | Q-Y1~5 + Q-D1~5 拍板 | 5 capability 协议化 / driver 独立成层 / 命名 + 目录 + 协议规程 |

---

## 1. 5 capability 架构

### 1.1 整体架构

```
┌──────────────────────────────────────────────────┐
│ view 层(NoteView / GraphView / EBookView)       │
│   - install: ['selection', 'clipboard',           │
│               'undo-redo', 'dnd', 'insertion']    │
│   - 通过 capability 的 channel 订阅状态           │
│   - 通过 capability 的 register API 让自己参与    │
│   - 通过 capability 的纯读 API 取信息             │
│                                                    │
│   注:view 还要 install 自己的 driver(必经)        │
│      → 见 drivers/COMMON-DRIVER-PROTOCOL.md       │
└──────────────────────────────────────────────────┘
              ↓ install
┌──────────────────────────────────────────────────┐
│ 5 个动作 capability(地基,纯协议)                │
│ selection / clipboard / undo-redo / dnd /         │
│ insertion                                         │
│                                                    │
│ 每个 capability 只暴露:                           │
│ - channel(让任何人 emit / 订阅)                  │
│ - 协议(payload 形态,discriminated union)        │
│ - 注册接口(让 driver / block / view 注册自己)    │
│ - 纯读 API(getCurrent / isEmpty / 等)            │
│                                                    │
│ ❌ 没有任何 set/do API                            │
│ ❌ 不"统一执行"任何动作                           │
│ ❌ 不知道任何具体内容形态                         │
└──────────────────────────────────────────────────┘
              ↑ register / emit / subscribe
              │
┌──────────────────────────────────────────────────┐
│ driver 层(text-editing-driver / 等)             │
│ → 见 drivers/COMMON-DRIVER-PROTOCOL.md            │
│                                                    │
│ driver 通过协议向 5 capability 注册自己的参与     │
│ driver 不"包装"capability,view 直接 install        │
│ capability                                         │
└──────────────────────────────────────────────────┘
```

**关键关系**:
- view 同时 install **5 capability** + **自己的 driver**(两条独立线)
- driver 通过协议跟 5 capability 协作(注册 + emit),不"代理"capability 给 view
- view 直接看 capability(channel + 纯读 API),不通过 driver 间接访问

### 1.2 反模式警示

> ⚠️ **不要让 capability 执行动作**
>
> 错误:`selection.api.selectAll()` / `clipboard.api.copy()` / `dnd.api.startDrag()`
>
> **为什么错**:不同内容形态对同一动作有不同语义,统一执行必撞车。
>
> **正确**:capability 只提供 channel + 注册 + 纯读 API。**动作由 driver / view 自己执行**,执行后 emit channel 让旁观者知道。

> ⚠️ **不要把 capability 跟 driver 混淆**
>
> 错误:把 text-editing 当成 capability 放在 capabilities/ 目录里。
>
> **为什么错**:capability 的语义是 "view 可选装配 + 横切能力",text-editing 是 "view 必经 + 业务驱动",两者分类性质不同。
>
> **正确**:capability 在 `src/capabilities/`,driver 在 `src/drivers/`,目录跟协议都分开。

> ⚠️ **不要把 capability registry 当 service locator**
>
> capability 之间零代码 import。共享逻辑下沉 `src/shared/`。

> ⚠️ **不要把共享 utility 误抽成 capability**
>
> DataTransfer 抽象 / 位置计算 helper 等浏览器 API 封装放 `src/shared/`,不是 capability。

---

## 2. 协议铁律

### 2.1 8 条 capability 特有铁律

#### 铁律 1:capability 是协议,不是动作执行者

capability 暴露 channel / register / 纯读 API 三类接口。**没有任何 set/do API**。

例:
- ✅ `selection.api.getCurrent()` — 纯读
- ✅ `selection.channel.emit('changed', payload)` — 调用方主动 emit
- ❌ `selection.api.selectAll()` — 这是动作,不该在 capability

#### 铁律 2:capability 只服务横切场景

capability 是"任何 view / driver 都可能用"的横切能力。**专属一个领域的能力不算 capability,算 driver**。

例:
- selection / clipboard / undo-redo / dnd / insertion → 跨内容形态通用 → 是 capability ✅
- "PM 编辑器装配 + block 集合管理"→ 专属文本编辑 → 不是 capability,是 text-editing-driver ❌

#### 铁律 3:capability 之间零代码 import

跨 capability 通信:
1. **下沉到 `src/shared/`**(共享 utility)
2. **bus channel / request**(workspace-bus L3.5)

违反此铁律的常见诱惑:
- service locator(`capabilityRegistry.get('clipboard').api.xxx`)
- 抽出"中间 capability"作为共享层
- 直接 `import { something } from '@capabilities/clipboard'`

#### 铁律 4:统一注册形态

每个 capability 暴露 `register*` API,driver / view / 业务 capability 通过此 API 注册自己的参与。

注册形态一致 → 学一个用一片。

例:
- driver 注册到 selection:`selection.registerSource(...)` — 声明"我可能 emit 这个 source 的选区"
- driver 注册到 clipboard:`clipboard.registerSerializer(...)` — 声明"我能把内容序列化成什么格式"
- driver 注册到 dnd:`dnd.registerDropTarget(...)` — 声明"我接什么 drop"

#### 铁律 5:命名空间保留前缀

capability 注册的 channel / register spec 必须以 capability ID 为前缀。

保留前缀(view / driver / block 不可用):
- `selection.*` / `clipboard.*` / `undo-redo.*` / `history.*` / `dnd.*` / `insertion.*`
- `slot.*`(workspace-bus 保留)

#### 铁律 6:键盘事件由 view 在最外层捕获 → commandRegistry 分发

block / driver 不直接监听全局键盘事件。所有键盘动作走:
1. view 最外层捕获 keydown
2. 根据当前焦点(view 知道当前 view,通过 selection capability 知道当前焦点 source)分发
3. 调 commandRegistry 找对应 command,执行

例:Cmd+C 在笔记中
- view captures Cmd+C
- view 调 commandRegistry.execute('clipboard.copy')
- 'clipboard.copy' command 找当前焦点 source,委托到该 source 的 copy 实现
- 该 source 执行 copy + emit `clipboard.copied`

PM 内部的键盘行为(如 Enter splitBlock,Tab 缩进列表)走 PM keymap plugin — 因为它们是"块内编辑"细节,在 driver 层。view 级捕获 Cmd+C / Cmd+V / Cmd+Z 等"对内容形态的整体动作"。

#### 铁律 7:演化能力优先

新需求来时,首选**加新 driver / 加新 block / 扩展某 driver**,不要改本协议。

只有以下情况才改本协议:
- 新增整个通用 capability(罕见,本协议覆盖的 5 个已经足够)
- 协议形态发现错误(channel payload 形状漏 case 等)
- 添加跨 capability 的新协作模式

绝大多数 V2 迭代不动本协议(由 driver 内部改 + view 业务改)。

#### 铁律 8:capability 不是 service locator

capability 不暴露"我去帮你调别人"的功能。
- 错误:`selection.api.copyCurrent()`(selection 替你调 clipboard)
- 正确:view / driver 自己调 selection.api.getCurrent() + clipboard 注册的 serializer 完成复制

### 2.2 4 条继承自 workspace-bus 的铁律

> workspace-bus PROTOCOL.md 已立,继承不重述。

- **铁律 9**:Workspace scope only(对齐 bus 铁律 2)
- **铁律 10**:dev mode typeof 校验(对齐 bus 铁律 3)
- **铁律 11**:Result<T> 不抛错(对齐 bus 风格)
- **铁律 12**:错误隔离(一个 listener / handler 抛错不影响其他)

---

## 3. 5 capability 协议接口

每个 capability 给出:
- 责任 / 不责任
- channel(emit 形态)
- 注册接口(供 driver / view 注册自己的参与)
- 纯读 API

注意:**没有 set/do API**(铁律 1)。

### 3.1 selection capability

**责任**:
- 提供"当前选区"的统一概念(channel + lastValue)
- 跨 source 协议性观察(任何 driver / view 都可 emit)
- 纯读 API 让旁观者(FloatingToolbar / ContextMenu / AskAIPanel)取当前选区

**不责任**:
- 不"做"选中(每个 source 自己实现 select 动作)
- 不持有具体内容(选区只是位置 / 范围)
- 不响应键盘

#### channel

```ts
// 'selection.changed'
type SelectionPayload = {
  source: string;       // 'text-editing-driver.text-block' / 'graph-editing-driver.node' / etc.
  isEmpty: boolean;
  kind: 'text' | 'block' | 'multi-block' | 'graph-nodes' | 'tree-nodes' | 'empty';
  // kind 决定后续字段
  from?: number; to?: number; anchor?: number; head?: number;
  positions?: number[];
  nodeIds?: string[];
  treeNodeIds?: string[];
};
```

lastValue 自动开启(L3.5 ChannelHub 已支持)。

#### 注册接口

```ts
interface SelectionSourceRegistration {
  source: string;       // 'text-editing-driver.text-block'
}

selection.registerSource(reg): Result<void>;
selection.unregisterSource(source: string): void;
selection.emit(payload: SelectionPayload): void;  // source 主动调
```

#### 纯读 API

```ts
selection.api: {
  getCurrent(): SelectionPayload | null;
  isEmpty(): boolean;
  getText(): string | null;       // text/block 类型可转字符串,其他返 null
}
```

### 3.2 clipboard capability

**责任**:
- 提供"剪贴板内容"的统一形态(envelope 多格式)
- channel emit 复制 / 粘贴事件
- 注册接口让 source 提供自己的 serializer / paste handler

**不责任**:
- 不"做"copy / paste(各 source 自己执行)
- 不知道具体怎么序列化
- 不知道具体怎么解析粘贴源

#### channel

```ts
// 'clipboard.copied'
type ClipboardCopiedPayload = {
  source: string;
  envelopes: ('pm-json' | 'markdown' | 'html' | 'plain' | string)[];
  selectionKind: SelectionPayload['kind'];
};

// 'clipboard.pasted'
type ClipboardPastedPayload = {
  target: string;
  envelope: 'pm-json' | 'markdown' | 'html' | 'plain' | string;
  source: 'internal' | 'external';
};
```

#### 注册接口

```ts
interface SerializerRegistration {
  contentType: string;            // 'text-editing-driver.text-block.pm-fragment'
  format: 'markdown' | 'html' | 'plain' | string;
  serialize: (data: unknown) => string;
}

clipboard.registerSerializer(reg): Result<void>;

interface PasteHandlerRegistration {
  id: string;
  detect: (dataTransfer: DataTransfer) => boolean;
  parse: (dataTransfer: DataTransfer) => Promise<unknown> | unknown;
  priority?: number;
}

clipboard.registerPasteHandler(reg): Result<void>;
```

#### 纯读 API

```ts
clipboard.api: {
  getCurrentEnvelopes(): string[];
  hasInternalEnvelope(): boolean;
}
```

### 3.3 undo-redo capability

**责任**:
- 提供 per-view scope 的 undo / redo 注册
- channel emit 状态变化
- 纯读 API 查 canUndo / canRedo

**不责任**:
- 不"做"undo / redo(各 scope 注册自己的实现)
- 不维护跨 view 全局栈

#### channel

```ts
// 'history.changed'
type HistoryChangedPayload = {
  scope: string;        // 'note-pm' / 'graph-canvas'
  canUndo: boolean;
  canRedo: boolean;
};
```

#### 注册接口

```ts
interface UndoScopeRegistration {
  scope: string;
  undo: () => boolean;       // 返回是否成功
  redo: () => boolean;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

undoRedo.registerScope(reg): Result<void>;
undoRedo.unregisterScope(scope: string): void;
undoRedo.notifyChanged(scope: string): void;  // 触发 history.changed emit
```

#### 纯读 API

```ts
undoRedo.api: {
  getActiveScope(): string | null;
  setActiveScope(scope: string | null): void;
  canUndo(scope?: string): boolean;
  canRedo(scope?: string): boolean;
}
```

注:`commandRegistry` 提供命令(如 `'undo-redo.undo'`)调用时:
1. 查 active scope 注册项 → 调 `reg.undo()`
2. 成功后调 `notifyChanged(scope)` 触发 channel emit

但**这个分发逻辑在 commandRegistry 命令里,不在 capability 上**。

### 3.4 drag-and-drop capability

**责任**:
- 拖动生命周期协议(start / over / drop)
- 注册接口让 source 提供 dropTarget
- channel emit 候选目标 / 完成事件
- 纯读 API 查当前拖动状态

**不责任**:
- 不"做"drag(各 source 自己启动 + 处理 drop)
- 不与 clipboard 互相 import — DataTransfer 抽象在 `src/shared/data-transfer.ts`

#### channel

```ts
// 'dnd.started'
type DndStartedPayload = {
  source: { type: string; data?: unknown };
};

// 'dnd.over'
type DndOverPayload = {
  mouseX: number;
  mouseY: number;
  candidateTargetId: string | null;
  valid: boolean;
};

// 'dnd.completed'
type DndCompletedPayload = {
  sourceType: string;
  targetId: string | null;
  mode: 'move' | 'copy';
  success: boolean;
};
```

#### 注册接口

```ts
interface DropTargetRegistration {
  id: string;
  accepts: string[];             // ['text-editing-driver.block.*', 'image/*']
  computeDropPoint: (
    coords: { x: number; y: number },
    view: unknown
  ) => { pos: number; valid: boolean } | null;
  onDrop: (input: { source: unknown; target: { pos: number }; dataTransfer: DataTransfer }) => void;
}

dnd.registerDropTarget(reg): Result<void>;
dnd.unregisterDropTarget(id: string): void;
```

#### 纯读 API

```ts
dnd.api: {
  getCurrentSource(): { type: string; data?: unknown } | null;
  isActive(): boolean;
}
```

### 3.5 insertion capability

**责任**:
- 框架级"安全插入"协议(光标祖先守卫)
- 注册接口让 driver 提供 safeguard
- 纯读 API 查目前注册的 safeguard
- 提供 safeInsert helper(协议守卫包装,不执行实际插入)

**不责任**:
- 不"做"insert(各 source 自己执行,但走 insertion 的 safeInsert helper)
- 不知道"插什么"或"插哪里"

#### channel

```ts
// 'insertion.inserted'
type InsertedPayload = {
  target: { type: string; pos: number };
  contentType: string;
  success: boolean;
};
```

#### 注册接口

```ts
interface SafeguardRegistration {
  id: string;
  check: (input: {
    target: { pos: number; type: string };
    content: unknown;
    contentType: string;
    docContext: unknown;
  }) => { safe: boolean; reason?: string };
}

insertion.registerSafeguard(reg): Result<void>;
```

#### 纯读 API + safeInsert helper

```ts
insertion.api: {
  // 协议守卫包装器:capability 调注册的所有 safeguard.check,全部通过才调用方提供的 perform()
  // 这看起来像 set/do API,但本质是"协议守卫 + 委托" — capability 不知道具体如何插入
  safeInsert<T>(input: {
    target: { pos: number; type: string };
    content: unknown;
    contentType: string;
    docContext: unknown;
    perform: () => Result<T>;     // 调用方提供"实际怎么插"的实现
  }): Result<T>;
  
  listSafeguards(): SafeguardRegistration[];
}
```

---

## 4. 跨 capability 协作场景

### 4.1 场景 A:多块拷贝粘贴

**用户视角**:笔记里 ESC 进块选模式,选中 3 个段落,Cmd+C,光标移动到另一处,Cmd+V → 3 段粘贴。

**capability 协作流**(driver 层细节由 driver 文档说明):

```
用户 ESC 进入块选模式(text-editing-driver 内某 plugin 接管)
  ↓
driver 通过 selection.emit 发:
  selection.emit({
    source: 'text-editing-driver.block-selection',
    kind: 'multi-block',
    positions: [12, 47, 89],
    isEmpty: false
  })
  ↓ 'selection.changed' channel + lastValue 缓存

用户 Cmd+C
  ↓ view 最外层捕获(铁律 6)
  ↓ view.commandRegistry.execute('clipboard.copy')
  ↓ 该 command 实现:
    1. 调 selection.api.getCurrent() 拿 multi-block payload
    2. 通过 source 标识找 text-editing-driver
    3. 调 driver 提供的 multi-block-copy 命令
    4. driver 内部:
       a. 遍历每个 position 的 block
       b. 调每个 block 的 serializer 生成多 envelope
       c. 写到 navigator.clipboard
       d. 通过 clipboard.emit 触发 'clipboard.copied'

用户 Cmd+V
  ↓ view 捕获 → commandRegistry.execute('clipboard.paste')
  ↓ command 实现:
    1. 读 navigator.clipboard
    2. 走 clipboard 注册的 PasteHandler dispatcher
    3. 命中的 handler 解析得到内容
    4. 调 insertion.api.safeInsert({ target, content, contentType, perform })
    5. insertion 调所有 safeguard,通过则调 perform
    6. driver 在 perform 里执行实际插入
```

**关键观察**:
- 5 capability 协作完成,**每个只跑自己的协议**
- 真正"做事"的是 driver 内部 + view 的 command 实现
- capability 既没有 `selection.selectAll`,也没有 `clipboard.copy`(指动作)— 它们只有 channel 和注册
- insertion.safeInsert 看似动作,本质是"协议守卫 + 委托"

### 4.2 场景 B:跨 view 块拖动(L6+)

**用户视角**:笔记里 hover 块手柄,拖动一个 block 到另一笔记的画布(GraphView),变成画布节点。

```
用户 mousedown 块手柄 → text-editing-driver 处理
  ↓ driver 调 dnd 注册一个 dropTarget(在自己的 ProseMirrorHost 内部)

用户开始拖动 → driver 调 bus.requests.request('dnd.startDrag', {
  source: { type: 'text-editing-driver.block.text-block', data: blockNode }
})

跨 view 拖到 GraphView
  ↓ GraphView 的 graph-editing-driver 注册的 dropTarget 检测命中
  ↓ accepts: ['text-editing-driver.block.*'] 匹配

放下 → graph-editing-driver 的 onDrop 处理:
  1. 反序列化 block 内容
  2. 转为图谱节点形态
  3. 通过 graph 自己的方式插入到画布
```

**关键观察**:
- 跨 view 拖放走 dnd capability 的协议,两端 driver 互不 import
- driver 自己负责"我自己内部怎么处理 drop",不通过 capability 间接做事

---

## 5. 与其他协议的对照

### 5.1 charter § 1.4 → 本协议如何遵守

| § 1.4 规则 | 本协议如何遵守 |
|---|---|
| 应用级 UI 在 Workspace Container(L3) | capability 不渲染 UI |
| 能力 UI 在 Capability(L4) | capability 暴露 channel + register + 纯读 API,view 装配 |
| View 是能力组合声明(L5) | view.install 列表显式声明依赖 |
| view 平等,无 variant | capability 协议无 variant 字段 |

### 5.2 与 driver 协议(drivers/COMMON-DRIVER-PROTOCOL.md)的边界

| 责任 | capability(本协议) | driver |
|---|---|---|
| 横切动作协议 | ✅ | ❌ |
| 业务驱动 / 编织底层 | ❌ | ✅ |
| view 是否必经 | ❌(可选 install) | ✅(必经) |
| 服务对象 | 多 view 共用 | 一类 view 专用 |
| 跟底层工具耦合 | ❌(只看协议) | ✅(driver 是工具的封装层) |

driver 是 capability 的**消费者 + 提供者**(向 capability 注册自己的参与,emit channel)。capability 不知道 driver 存在 — 只看协议。

### 5.3 workspace-bus § 9 铁律 → 本协议状态

承袭(铁律 9-12 见 § 2.2)。本协议没有引入新管道形态。

---

## 6. 风险 + 开放问题

### 6.1 selection 跨内容形态时,payload 形状如何统一?

**推荐**:discriminated union by `kind`(已在 § 3.1)。

### 6.2 clipboard envelope 跨内容形态降级?

**推荐**:多 envelope copy + paste 端按目标接受度选最高格式。具体接受度由 PasteHandler.detect 决定。

### 6.3 dnd 与 clipboard 共享 DataTransfer?

**推荐**:`src/shared/data-transfer.ts` 底层 utility,两者都 import 它(铁律 3)。

### 6.4 undo-redo 跨 capability 操作时栈策略?

**推荐**:per-view 栈,焦点决定撤销目标。不强求全局栈。

### 6.5 insertion safeInsert 跨 target 形态接口?

**推荐**:target 用 `{ pos, type }` 形态,type 字段让 safeguard 区分。具体 target 类型扩展由 driver 在 docContext 里自描述。

### 6.6 capability 有动态增减需求吗?

v1 不实施动态增减(5 个 capability 启动时全部 ready)。L7+ 真有插件市场需求时再考虑。

### 6.7 capability registry 怎么管?

L4 capabilityRegistry(Q5=B 极简)只存 id/version。本协议要求 capability 暴露 channel/register/api 这些**对象引用**怎么存?

**推荐**:capability 模块 export singleton(`export const selection = ...`),view / driver 直接 import singleton 用。capabilityRegistry 只用于"声明依赖关系 + 检查 install 完整性",不用作运行时查询。

这跟"capability 之间不互相 import"不冲突 — capability 之间不互相 import,view 和 driver 可以 import capability。

### 6.8 协议演化(未来版本升级)?

**推荐**:每次重大调整加 v0.X,旧版本作为历史保留。本协议的演化主要在:
- 加新 capability(罕见)
- 协议形态修正(channel payload 形状漏 case)
- 跨 capability 协作模式新增

绝大多数 V2 迭代不动本协议(由 driver 内部改 + view 业务改)。

---

## 7. 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-05-05 | v0.1 | 初稿(动作类型分类,统一接口) |
| 2026-05-05 | v0.2 | 整体重写(block 自治架构,5 capability 纯协议化) |
| 2026-05-05 | v0.3 | **再次重写** — 用户在反复追问中揭示 text-editing 不是 capability 而是 driver layer。本版完全剥离 text-editing,只覆盖 5 个真正横切的 capability。新增 § 0.3 capability vs driver 区分章节。Q-D1~5 用户拍板固化。文档体量从 v0.2 的 869 行降到本版预计 600-650 行(大量内容下沉到 driver 协议)。 |
