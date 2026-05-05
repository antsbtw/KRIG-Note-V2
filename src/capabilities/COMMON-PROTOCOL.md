# 通用 Capability 协议规程 v0.2

> **本文是 V2 通用交互 capability 的根协议**。
>
> v0.2 是对 v0.1 的根本性重写 — 用户在 4 轮讨论中(动作类型 / block-operations / 5 基础动作 / block 自由演化)逐步揭示出 V2 capability 模型的真正形态:**5 个动作 capability 是协议地基,每个 block 是独立自治模块,可自由演化**。
>
> v0.1 把通用 capability 当成"统一动作执行者"是错的(会撞车 — 满足 B block 就坏 A block)。v0.2 让 capability 退到协议层,把动作执行权下放给每个 block 自治模块。
>
> **位置**:`src/capabilities/COMMON-PROTOCOL.md` — 与 `src/slot/workspace-bus/PROTOCOL.md` 平级。
>
> **相关研究**:[V1-function-mapping.md](../../docs/RefactorV2/research/V1-function-mapping.md)(双轴矩阵)+ [V1-block-operations.md](../../docs/RefactorV2/research/V1-block-operations.md)(BlockSpec 接口设计)。
>
> 文档版本:v0.2(整体重写)
> 编写日期:2026-05-05
> 上下文:L5-A 阶段,5 通用 capability + text-editing 实施前必须先定本协议

---

## 0. 设计哲学

### 0.1 V2 立项的差异化承诺(charter § 1.4)

view 是能力组合声明,capability 是横切复用。

**但** capability 不是"统一动作执行者" — 它是**协议**(让具体动作在统一形态下可观察、可订阅、可注册)。

### 0.2 v0.1 的错误反思

v0.1 把通用 capability 设计成"统一动作 API + BlockSpec 字段上交":
- selection capability 提供 `selectAll() / selectBlock()` 之类动作 API
- BlockSpec 字段(selectionBehavior 等)上交给 selection,由 selection 内部综合执行
- 隐含假设:**统一抽象能正确处理所有 block**

这个假设在 V1 验证下站不住:

> **场景**:用户按 Cmd+A
> - textBlock:选段落内 inline → TextSelection
> - codeBlock:走 CodeMirror 内部全选 → 不能进 PM 选区
> - mathBlock:NodeSelection(无内部内容)
> - table:cell 全选?整表全选?语义本身分歧
> - toggleList 折叠态:整体选(内部不可见)
>
> **没有任何统一抽象能同时正确处理这 5 种** — 满足 textBlock 必坏 codeBlock,反之亦然。

### 0.3 v0.2 的根本调整

```
错误形态:
  capability = 动作执行者
  block = 注册接口的实现者(BlockSpec 字段填空)
  
正确形态:
  capability = 协议地基(channel + 注册 + 纯读 API,没有 set/do)
  block = 自治模块(完整自己定义所有行为,可自由演化)
```

**block 是 V2 capability 模型的核心** — 用户体验的细节都在 block 上。每种 block 必须能独立演化(codeBlock 接 Monaco / mathBlock 接 AI / table 加嵌套等),互不影响。

### 0.4 4 轮讨论的最终结论(用户拍板)

| 轮次 | 用户洞察 | 最终设计 |
|---|---|---|
| 1 | "block 操作不一致时怎么办?满足 B 改坏 A 怎么办?" | capability 不再"统一执行动作" |
| 2 | "block 内编辑必须有根据体验不断迭代优化的能力" | 每个 block 是独立 src 目录,自由演化 |
| 3 | "5 个基本操作 → block 编辑 → 多块操作 → view 编辑" | 没有"多块协调器"作为预设结构,多块行为由具体 block 协议性涌现 |
| 4 | Q-Y1~5 拍板 | 5 capability 协议化(Q-Y1=A)/ block 独立目录(Q-Y2=C 自适应)/ block UI 混合(Q-Y3=C)/ 纯读 API 不含动作(Q-Y4=A)/ view 在最外层捕获键盘分发(Q-Y5=B) |

---

## 1. V2 Capability 架构

### 1.1 整体架构图

```
┌─────────────────────────────────────────────────────────┐
│ 第 0 层:5 个动作 capability(地基,纯协议)              │
│   selection / clipboard / undo-redo / dnd / insertion    │
│                                                          │
│   每个 capability 只暴露:                                │
│   - channel(让任何人 emit / 订阅)                       │
│   - 协议(payload 形态,discriminated union)             │
│   - 注册接口(让 block 注册自己怎么参与)                  │
│   - 纯读 API(getCurrent / isEmpty / getText 等)         │
│                                                          │
│   ❌ 没有任何 set/do API(没有 selectAll / copy 之类调用) │
│   ❌ 不知道任何 block 的存在,只知道协议                  │
│   ❌ 不"统一执行"任何动作                                │
└─────────────────────────────────────────────────────────┘
              ↑
              │ 注册 + emit + 订阅
              │
┌─────────────────────────────────────────────────────────┐
│ 第 1 层:block 自治模块(每个 block 一个独立 src 目录)  │
│                                                          │
│   src/capabilities/text-editing/blocks/                  │
│   ├── text-block/                                        │
│   │   ├── spec.ts            (PM nodeSpec,必需)         │
│   │   ├── node-view.ts       (NodeView,可选)            │
│   │   ├── selection.ts       (selection 行为,可选)       │
│   │   ├── clipboard.ts       (copy/paste/serialize,可选) │
│   │   ├── ...                                            │
│   │   └── README.md          (设计 + 演化记录)            │
│   │                                                      │
│   ├── math-block/(独立目录,独立演化)                   │
│   ├── code-block/(独立目录,独立演化)                   │
│   ├── table/(独立目录,独立演化)                        │
│   └── ...                                                │
│                                                          │
│   每个 block 模块:                                      │
│   - 完整定义自己的所有行为(没有"BlockSpec 统一接口"约束) │
│   - 自由演化(改一个 block 不影响其他)                  │
│   - 自适应文件数(简单 block 1-2 个文件,复杂 block 多文件)│
│   - 通过协议向 5 capability 注册自己的参与方式            │
│   - 通过 text-editing 容器注册 nodeSpec(PM schema 拼装)  │
└─────────────────────────────────────────────────────────┘
              ↑
              │ block 自我注册 (import side-effect 或 init 调用)
              │
┌─────────────────────────────────────────────────────────┐
│ 第 2 层:text-editing capability(轻量组装容器)         │
│                                                          │
│   - 加载所有 block 模块(import side-effect 触发自注册)   │
│   - 拼装 PM Schema(收集所有 block 的 nodeSpec)          │
│   - 装配 PM EditorView(收集所有 block 的 plugin)        │
│   - 提供 ProseMirrorHost React 组件                      │
│                                                          │
│   ❌ 不知道任何具体 block 的细节                         │
│   ❌ 不实现任何"统一动作"                                │
│   ❌ 不内置"多块协调器"                                  │
│                                                          │
│   text-editing 是"组装工具",不是"层级系统"              │
└─────────────────────────────────────────────────────────┘
              ↑
              │ install
              │
┌─────────────────────────────────────────────────────────┐
│ 第 3 层:NoteView                                        │
│                                                          │
│   - install: ['text-editing', 'selection', 'clipboard',  │
│               'undo-redo', 'dnd', 'insertion']           │
│   - 通过 ProseMirrorHost 渲染编辑器                      │
│   - 通过 capability channel 订阅状态                     │
│   - 在 view 最外层捕获键盘 → 通过 commandRegistry 分发到 │
│     当前焦点 block 的 command 实现                       │
│   - view 业务(笔记列表 / 持久化 / Toolbar)              │
└─────────────────────────────────────────────────────────┘
```

### 1.2 跟 v0.1 的根本差异

| 维度 | v0.1 (错) | v0.2 (对) |
|---|---|---|
| capability 角色 | 动作执行者 + 协议总线 | **纯协议**(channel + register + 纯读 API)|
| block 形态 | BlockSpec 统一接口字段 | **独立 src 目录 + 自由演化** |
| 多块协调 | text-editing 内置协调器 | **协议性涌现**,具体 block 自己处理 |
| 改一个 block 的影响 | 改 BlockSpec → 影响所有 block | **完全隔离**(改一个目录不影响其他)|
| 演化空间 | 受 BlockSpec 字段限制 | **完全自由** |
| 键盘事件 | block 各自监听 | view 最外层捕获 → commandRegistry 分发 |

### 1.3 核心反模式警示

> ⚠️ **不要让 capability "统一执行动作"**
>
> 错误模式:`selection.api.selectAll()` / `clipboard.api.copy()` / `dnd.api.startDrag()` 等"调用就动作"的 API。
>
> **为什么错**:不同 block 对同一动作有不同语义(Cmd+A 例),统一执行必撞车。
>
> **正确**:capability 只提供 channel + 注册 + 纯读 API。**动作由 block 自己执行**,执行后 emit channel 让旁观者知道。

> ⚠️ **不要把"多块协调"作为预设结构**
>
> 错误模式:text-editing 内置"多块协调器"(`MultiBlockCoordinator`),封装"多块选区扩展 / 跨块拷贝 / 跨容器拖动"等通用逻辑。
>
> **为什么错**:多块协调的具体规则因 block 类型组合而异。table+textBlock 的多选 vs callout+codeBlock 的多选,语义不同;预设协调器必然漏 case。
>
> **正确**:多块行为是**协议层规定的形态**(selection.changed kind=multi-block / clipboard envelope 等),具体执行由参与的 block 各自处理。

> ⚠️ **不要把 capability registry 当 service locator**(承袭 v0.1)
>
> capability 之间零代码 import。共享逻辑下沉 `src/shared/`。

> ⚠️ **不要把共享 utility 误抽成 capability**(承袭 v0.1)
>
> DataTransfer 抽象 / 位置计算 helper 等浏览器 API 封装放 `src/shared/`,不是 capability。

---

## 2. 协议铁律

### 2.1 8 条 capability 特有铁律

#### 铁律 1:capability 是协议,不是动作执行者

capability 暴露 channel / register / 纯读 API 三类接口。**没有任何 set/do API**。所有动作由 block / view 自己执行,执行完 emit channel。

例:
- ✅ `selection.api.getCurrent()` — 纯读
- ✅ `selection.channel.emit('changed', payload)` — block 主动 emit
- ❌ `selection.api.selectAll()` — 这是动作,不该在 capability

#### 铁律 2:每个 block 是独立自治模块

block 不通过统一字段接口注册,而是通过**独立 src 目录**实现完整行为。block 之间不互相依赖。

物理形态(Q-Y2=C 自适应):
- 简单 block(textBlock):`spec.ts + README.md`
- 中等 block(image / blockquote):`spec.ts + node-view.ts + selection.ts + README.md`
- 复杂 block(mathBlock / codeBlock / table):`spec.ts + node-view.ts + popover-editor.tsx + selection.ts + clipboard.ts + ... + README.md`

block 目录唯一约束:**`spec.ts` 必须存在**(导出 PM nodeSpec)。其他文件按需开,缺失则走"default 行为"(见 § 5)。

#### 铁律 3:5 个 capability 是地基,block 是消费者 + 提供者

block 既消费 capability(订阅 channel / 调纯读 API),又提供 capability(emit / register)。

view 主要消费 capability(订阅 + 纯读),不直接执行动作 — 通过 commandRegistry 分发到 block。

text-editing capability 是**轻量容器**,不消费也不提供 — 只组装 block 模块。

#### 铁律 4:没有"多块协调器"作为预设结构

多块行为是**协议形态规定** + **具体 block 协议性涌现**:
- selection 协议规定 `kind: 'multi-block'` 形态,具体多块选区由 block 协作 emit
- clipboard 协议规定 envelope 多格式,具体多块如何序列化由各 block 独立提供 serializer
- 跨 block 拖动由 dnd 协议(MIME / DataTransfer)规定,具体 source / target 由 block 注册

text-editing **不内置**统一的"多块协调器"。

#### 铁律 5:capability 之间零代码 import

跨 capability 通信:
1. **下沉到 `src/shared/`**(共享 utility)
2. **bus channel / request**(workspace-bus L3.5)

违反此铁律的常见诱惑:
- service locator(`capabilityRegistry.get('clipboard').api.xxx`)
- 抽出"中间 capability"作为共享层
- 直接 `import { something } from '@capabilities/clipboard'`

#### 铁律 6:命名空间保留前缀

capability 注册的 channel / register spec 必须以 capability ID 为前缀。

保留前缀(view / block 不可用):
- `selection.*` / `clipboard.*` / `undo-redo.*` / `history.*` / `dnd.*` / `insertion.*`
- `slot.*`(workspace-bus 保留)

#### 铁律 7:键盘事件由 view 在最外层捕获 → commandRegistry 分发

block 不直接监听全局键盘事件。所有键盘动作走:
1. view 最外层捕获 keydown(在 ProseMirrorHost 之外的 React 层)
2. 根据当前焦点(view 知道当前 view,通过 selection capability 知道当前 block)分发
3. 调 commandRegistry 找对应 command,执行

例:Cmd+C 在笔记中
- view captures Cmd+C
- view 调 commandRegistry.execute('clipboard.copy')
- 'clipboard.copy' command 找当前焦点 block,调 block 自己的 copy 实现
- block 执行 copy + emit `clipboard.changed`

PM 内部的键盘行为(如 Enter 在段落 splitBlock,Tab 在列表缩进)**仍然走 PM keymap plugin** — 因为它们是"块内编辑"细节,不是 view 级动作。view 级捕获 Cmd+C / Cmd+V / Cmd+Z 等"对 block 整体的动作"。

#### 铁律 8:演化能力优先

新需求来时,首选**加新 block 模块或扩展某 block 内部**,不要改协议。

只有以下情况才改本协议:
- 新增整个 capability(罕见,本协议覆盖的 5 个已经够)
- 协议形态发现错误(channel payload 形状漏 case 等)
- 添加跨 capability 的新协作模式

绝大多数迭代(改 codeBlock 行为 / 改 mathBlock 渲染 / 加新 block / 等)都是 block 模块内部的事,**不动协议**。

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
- 注册接口(供 block 注册自己的参与)
- 纯读 API(从 channel lastValue / 内部状态读取)

注意:**没有 set/do API**(铁律 1)。

### 3.1 selection capability

**这层做什么**:
- 提供"当前选区"的统一概念(channel + lastValue)
- 跨 block 协议性观察(任何 block 都可 emit)
- 纯读 API 让旁观者(FloatingToolbar / ContextMenu / AskAIPanel)取当前选区

**这层不做什么**:
- 不"做"选中(每个 block 自己实现 select 动作)
- 不持有具体内容(选区只是位置 / 范围)
- 不响应键盘

#### channel

```ts
// 'selection.changed'
type SelectionPayload = {
  source: string;       // 'text-editing.text-block' / 'text-editing.math-block' / 'graph-editing.node' / etc.
  isEmpty: boolean;
  kind: 'text' | 'block' | 'multi-block' | 'graph-nodes' | 'tree-nodes' | 'empty';
  // kind 决定后续字段
  // text: from / to / anchor / head
  // block / multi-block: positions
  // graph-nodes: nodeIds
  // tree-nodes: treeNodeIds
  from?: number; to?: number; anchor?: number; head?: number;
  positions?: number[];
  nodeIds?: string[];
  treeNodeIds?: string[];
};
```

lastValue 自动开启(L3.5 ChannelHub 已支持)。

#### 注册接口

```ts
// block 注册自己怎么"成为选区源"
interface SelectionSourceRegistration {
  source: string;       // 'text-editing.text-block'
  // block 在 init 时调,告诉 selection capability "我可能 emit 这个 source 的选区"
  // 实际 emit 在 block 内部完成(通过下面 emit API)
}

selection.registerSource(reg): Result<void>;
selection.unregisterSource(source: string): void;
selection.emit(payload: SelectionPayload): void;  // block 主动调
```

#### 纯读 API

```ts
selection.api: {
  getCurrent(): SelectionPayload | null;
  isEmpty(): boolean;
  getText(): string | null;       // 跨形态时:text/block 类型可转字符串,其他返 null
}
```

### 3.2 clipboard capability

**这层做什么**:
- 提供"剪贴板内容"的统一形态(envelope 多格式)
- channel emit 复制 / 粘贴事件
- 注册接口让 block 提供自己的 serializer / paste handler

**这层不做什么**:
- 不"做"copy / paste(每个 block 自己的 copy / paste 实现)
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
  target: string;       // 落点 block source
  envelope: 'pm-json' | 'markdown' | 'html' | 'plain' | string;
  source: 'internal' | 'external';   // 内部 KRIG 通道还是外部应用
};
```

#### 注册接口

```ts
// block 注册"我能把自己的内容序列化成什么格式"
interface SerializerRegistration {
  contentType: string;            // 'text-editing.text-block.pm-fragment'
  format: 'markdown' | 'html' | 'plain' | string;
  serialize: (data: unknown) => string;
}

clipboard.registerSerializer(reg): Result<void>;

// view / 业务 capability 注册"我能识别什么粘贴源"
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
  // 当前剪贴板有哪些 envelope(从最近一次 emit 推断)
  getCurrentEnvelopes(): string[];
  // 检查是否有内部 KRIG envelope(供 block 决定走 PM JSON 还是 markdown)
  hasInternalEnvelope(): boolean;
}
```

### 3.3 undo-redo capability

**这层做什么**:
- 提供 per-view scope 的 undo / redo 注册
- channel emit 状态变化
- 纯读 API 查 canUndo / canRedo

**这层不做什么**:
- 不"做"undo / redo(具体执行由各 scope 注册的实现完成)
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
  // 调时返回是否成功(false = 没东西可 undo)
  undo: () => boolean;
  redo: () => boolean;
  // 状态查询(给 channel emit 用)
  canUndo: () => boolean;
  canRedo: () => boolean;
}

undoRedo.registerScope(reg): Result<void>;
undoRedo.unregisterScope(scope: string): void;

// scope 内部状态变化时,主动调
undoRedo.notifyChanged(scope: string): void;  // 触发 history.changed emit
```

#### 纯读 API

```ts
undoRedo.api: {
  getActiveScope(): string | null;     // 当前焦点 scope
  setActiveScope(scope: string | null): void;   // 给 view 切焦点用
  canUndo(scope?: string): boolean;
  canRedo(scope?: string): boolean;
  // 注:undo() / redo() 不在 api 里 —— 那是动作,通过 commandRegistry 调
}
```

注:`commandRegistry` 提供的命令(如 `'undo-redo.undo'`)调用时:
1. 找 active scope 的注册项
2. 调 `reg.undo()`
3. 成功后调 `notifyChanged(scope)` 触发 channel emit

但**这个分发逻辑在 commandRegistry 命令里,不在 capability 上**。

### 3.4 drag-and-drop capability

**这层做什么**:
- 拖动生命周期协议(start / over / drop)
- 注册接口让 block 提供自己的 dropTarget
- channel emit 候选目标 / 完成事件
- 纯读 API 查当前拖动状态

**这层不做什么**:
- 不"做"drag(每个 block 自己启动拖动 + 处理 drop)
- 不与 clipboard 互相 import — DataTransfer 抽象在 `src/shared/data-transfer.ts`

#### channel

```ts
// 'dnd.started'
type DndStartedPayload = {
  source: { type: string; data?: unknown };  // type = 'text-editing.block.text-block' 等
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
  // 接受什么 source.type(精确或前缀,如 'text-editing.block.*')
  accepts: string[];
  // 给定鼠标坐标,返回是否可作为目标
  computeDropPoint: (
    coords: { x: number; y: number },
    view: unknown
  ) => { pos: number; valid: boolean } | null;
  // 落地回调
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

**这层做什么**:
- 框架级"安全插入"协议(光标祖先守卫)
- 注册接口让 block 提供 safeguard
- 纯读 API 查目前注册的 safeguard

**这层不做什么**:
- 不"做"insert(各 block 自己执行,但走 insertion 的 safeInsert helper)
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
  // 直接调用,blocks 用它来"安全插入"
  // 注:这看起来像 set/do API,但本质是"调用 safeguard 链 + 委托到调用方提供的 do 函数"
  // capability 不知道具体如何插入,只调用注册的 safeguard 检查
  safeInsert<T>(input: {
    target: { pos: number; type: string };
    content: unknown;
    contentType: string;
    docContext: unknown;
    // 调用方提供"实际怎么插"的实现 — capability 不知道
    perform: () => Result<T>;
  }): Result<T>;
  
  listSafeguards(): SafeguardRegistration[];
}
```

**关键区别**:`safeInsert` 是个**协议守卫包装器**,不是"执行插入"。capability 调注册的所有 safeguard.check,全部通过才调用方提供的 `perform()`。这符合铁律 1 — capability 只跑协议(safeguard 检查链),具体动作由调用方实现。

---

## 4. block 自治模块的 default 行为

铁律 2 提到"缺失文件走 default 行为"。本节定义 default。

### 4.1 没提供 selection.ts → default

block 的 PM nodeSpec 决定 default:
- `atom: true`(leaf 节点)→ default 是 NodeSelection,emit `kind: 'block'`
- `inline: true`(inline 节点)→ default 不 emit selection(由父级 textBlock 管)
- 其他 block(`content: 'inline*'` 或 `'block+'`)→ default emit `kind: 'text'` 用 PM TextSelection

### 4.2 没提供 clipboard.ts → default

- copy:走 PM 默认 DOMSerializer(toDOM)生成 HTML
- toMarkdown:从 textContent 生成纯文本(降级)
- paste:走父级容器或 view 级 dispatcher 处理

### 4.3 没提供 undo.ts → default

走 text-editing capability 的 'note-pm' scope(prosemirror-history),不需要 block 显式注册。

### 4.4 没提供 dnd.ts → default

block **不可拖动**(不参与 dnd capability)。要拖动必须显式提供 dnd.ts。

### 4.5 没提供 insertion.ts → default

走 text-editing 的标准 safeguard(光标祖先链不破坏),不需要 block 显式注册。

### 4.6 没提供 keymap.ts → default

走 PM baseKeymap(标准 Enter / Backspace / 光标移动)。

### 4.7 没提供 input-rules.ts → default

无 input-rule(不参与自动语法转换)。

### 4.8 没提供 node-view.ts → default

走 PM 默认渲染(toDOM)。

---

## 5. 跨 capability 协作场景(2 个内容操作场景)

剔除"统一动作执行"的设想,看真实流程。

### 5.1 场景 A:多块拷贝粘贴

**用户视角**:笔记里 ESC 进块选模式,选中 3 个段落,Cmd+C,光标移动到另一处,Cmd+V → 3 段粘贴。

**capability 协作流**:

```
用户 ESC 进入块选模式(text-editing 内某 plugin 接管)
  ↓
text-block / blockquote / list 等参与块选模式的 block 都通过 selection.emit 发:
  selection.emit({
    source: 'text-editing.block-selection',
    kind: 'multi-block',
    positions: [12, 47, 89],
    isEmpty: false
  })
  ↓ 'selection.changed' channel + lastValue 缓存
  
旁观者 FloatingToolbar 订阅 selection.changed → 显示"3 块已选"

用户 Cmd+C
  ↓ view 最外层捕获(铁律 7)
  ↓ view.commandRegistry.execute('clipboard.copy')
  ↓ 该 command 实现:
    1. 调 selection.api.getCurrent() 拿 multi-block payload
    2. 找当前焦点 view 类型(NoteView)的 block 类型(text-editing)
    3. 调 text-editing 提供的 multi-block-copy 命令
    4. multi-block-copy 内部:
       a. 遍历每个 position 的 block
       b. 调每个 block 自己的 copy.ts 提供的 serialize 函数
       c. 拼接多块 PM JSON / Markdown / HTML
       d. 写多 envelope 到 navigator.clipboard
       e. emit 'clipboard.copied'
  
用户移动光标 → 当前 block 重新 emit selection.changed kind='text' empty position
  
用户 Cmd+V
  ↓ view 捕获 → commandRegistry.execute('clipboard.paste')
  ↓ command 实现:
    1. 读 navigator.clipboard
    2. 走 clipboard 注册的 PasteHandler dispatcher(按 priority)
    3. text-editing 注册的 PM JSON handler 命中(因有 KRIG marker)
    4. 反序列化得到 PM fragment
    5. 调 insertion.api.safeInsert({
         target: { pos: 当前光标, type: 'text-editing.text-block' },
         content: fragment,
         contentType: 'text-editing.pm-fragment',
         docContext: pmDoc,
         perform: () => { 
           view.dispatch(view.state.tr.replaceSelectionWith(fragment));
           return ok(undefined);
         }
       })
    6. insertion 调所有 safeguard,通过则调 perform
    7. emit 'insertion.inserted' + 'clipboard.pasted'
    8. PM history 自动记录(undo-redo capability 下次 query 知道 canUndo=true)
```

**关键观察**:
- 5 capability 协作完成,**每个只跑自己的协议**(emit channel / 调注册项)
- **真正"做事"的是 block 的代码 + view 的 command 实现**
- capability 既没有 `selection.selectAll`,也没有 `clipboard.copy`(指动作)— 它们只有 channel 和注册
- text-editing 的 multi-block-copy 命令是个**普通 command**,不是 capability API
- insertion.safeInsert 看起来像动作,本质是"协议守卫 + 委托" — capability 不知道怎么 insert,调用方提供 perform()

### 5.2 场景 B:用户在 mathBlock 上点击进入编辑

**用户视角**:笔记里点击数学公式 → 弹出 LaTeX 编辑面板 → 编辑 → 点击外部退出 → 重新渲染 KaTeX。

**capability 协作流**:

```
用户单击 mathBlock 的 DOM
  ↓ math-block 的 NodeView mousedown 监听:
    1. e.preventDefault()
    2. view.dispatch(setSelection(NodeSelection.create(doc, pos)))
    3. selection.emit({
         source: 'text-editing.math-block',
         kind: 'block',
         positions: [pos],
         isEmpty: false
       })
       
旁观者 FloatingToolbar 订阅 → 检测 kind=block + source=math-block,显示 mathBlock 专用 toolbar(LaTeX 模板等)

用户双击 mathBlock 进入编辑模式
  ↓ math-block 的 NodeView dblclick 监听:
    1. 内部 state editing=true
    2. 调 ../popover/help-panel.showMathPanel(...)  // 共享 UI 组件
    3. 注册全局 mousedown 监听(math-block 自己管,不用 capability)
    
用户在 popover 里编辑 LaTeX
  ↓ math-block 内部更新 attrs.latex(走 view.dispatch transaction)
  ↓ PM history 自动记录(undo-redo 可撤销)

用户点击外部
  ↓ math-block 全局 mousedown 监听检测点击在 popover 外
  ↓ math-block 内部退出编辑模式:
    1. state editing=false
    2. 调 ../popover.hideMathPanel()
    3. 重新渲染 KaTeX
```

**关键观察**:
- mathBlock 完全自己管"编辑模式生命周期"(全局监听 / popover / KaTeX 渲染)
- mathBlock 通过 selection.emit 通知 capability 形态变化(给 toolbar 看)
- mathBlock 不污染其他 block(textBlock / codeBlock 不知道 mathBlock 的存在)
- mathBlock 演化(将来加 AI 自动补全 / OCR 识别等)只改 math-block/ 目录,其他都不动 — 这正是铁律 8 的实现

---

## 6. 与 charter / workspace-bus 协议的对照

### 6.1 charter § 1.4 → 本协议如何遵守

| § 1.4 规则 | 本协议如何遵守 |
|---|---|
| 应用级 UI 在 Workspace Container(L3) | capability 不渲染 UI |
| 能力 UI 在 Capability(L4) | capability 暴露 channel + register + 纯读 API,view 装配 |
| View 是能力组合声明(L5) | view.install 列表显式声明依赖 |
| view 平等,无 variant | capability 协议无 variant 字段 |
| view 文件极轻 | view 通过 capability 注册扩展(实际逻辑在 block 模块) |

### 6.2 workspace-bus § 9 铁律 → 本协议状态

承袭(铁律 9-12 见 § 2.2)。本协议没有引入新管道形态,继续走 workspace-bus 的 channel/request/slot。

### 6.3 capability ≠ bus 的边界

| | workspace-bus | 通用 capability |
|---|---|---|
| 本质 | 跨 view 实例消息通道 | 协议 + 状态聚合 + 注册中心 |
| 形态 | channel + request + slot | channel + register + 纯读 API |
| 范围 | 跨 view 实例 | 内容操作(view 内或 view 之间) |
| 持有 | listener + lastValue | 注册项集合 + 协议状态 |
| 例 | "笔记被打开" 事件 | "选区"概念本身 |

capability 用 bus 来 emit channel,但 capability 本身**不是** bus 的一部分。

---

## 7. 留位:未来 capability(L6+)

本协议是通用 capability 的根协议。未来内容特定 capability 各自立 PROTOCOL.md / DESIGN.md,继承本协议的:
- 12 条铁律
- 注册形态
- 命名空间(自己 ID 作前缀)

候选:
- `text-editing`(L5-A 起)
- `graph-editing`(L6+,V1 部分实现)
- `file-management` / `web-rendering` / `ebook-rendering` / `media-rendering` / `ai-augment`

---

## 8. 风险 + 开放问题

### 8.1 selection 跨内容形态时,payload 形状如何统一?

**推荐**:discriminated union by `kind`(已在 § 3.1)。

### 8.2 clipboard envelope 跨内容形态降级?

**推荐**:多 envelope copy + paste 端按目标 block 接受度选最高格式。具体接受度由 PasteHandler.detect 决定。

### 8.3 dnd 与 clipboard 共享 DataTransfer?

**推荐**:`src/shared/data-transfer.ts` 底层 utility,两者都 import 它(铁律 5)。

### 8.4 undo-redo 跨 capability 操作时栈策略?

**推荐**:per-view 栈,焦点决定撤销目标。不强求全局栈。

### 8.5 insertion safeInsert 跨 target 形态接口?

**推荐**:target 用 `{ pos, type }` 形态,type 字段让 safeguard 区分。具体 target 类型扩展由 block 在 docContext 里自描述。

### 8.6 block 模块自注册时机?

**推荐**:启动时一次性 import 触发 side-effect 自注册。运行时不动态加载(L7+ 用户扩展插件再考虑)。

### 8.7 block 卸载 / 销毁?

**推荐**:v1 不支持运行时卸载(static block list)。L7+ 真有插件市场再设计。

### 8.8 block 之间的"数据流"如何处理?

例:noteLink 块需要查询其他笔记的 title。

**推荐**:**通过 view 业务路径,不在 capability 协议层**。noteLink block 通过 commandRegistry 发出 `note.queryTitle` command,NoteView 的 command handler 实现该查询。block 不直接拿 NoteView 的笔记数据。

### 8.9 capability registry 里的"capability 元信息"够用吗?

L4 capabilityRegistry(Q5=B 极简)只存 id/version 等。本协议要求 capability 暴露 channel/register/api,这些**对象引用**怎么存?

**推荐**:capability 模块 export singleton(`export const selection = ...`),view / block 直接 import singleton 用。capabilityRegistry 只用于"声明依赖关系 + 检查 install 完整性",不用作运行时查询。

这跟"capability 之间不互相 import"不冲突 — capability 之间不互相 import,view 和 block 可以 import capability。

### 8.10 协议演化(本文件 v0.3 / v0.4)?

**推荐**:每次重大调整加 v0.X,旧版本作为历史保留。本协议的演化主要在:
- 加新 capability(罕见)
- 协议形态修正(channel payload 形状漏 case)
- 跨 capability 协作模式新增

绝大多数 V2 迭代不动本协议(由 block 模块内部改 + view 业务改)。

---

## 9. 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-05-05 | v0.1 | 初稿(动作类型分类,统一接口) |
| 2026-05-05 | v0.2 | **整体重写** — 用户在 4 轮讨论中揭示真正形态:5 capability 是协议地基,每个 block 是独立自治模块,没有"多块协调器"作为预设结构。Q-Y1~5 用户拍板固化。架构图 / 铁律 / capability 协议 / 协作场景全部按"block 自治"重写。文档体量从 v0.1 的 858 行降到本版预计 600-700 行(因为去掉了"多块协调器"等预设结构)。 |
