# Driver Layer 协议规程 v0.2

> **本文是 V2 driver 层(驱动层)的根协议**。
>
> driver 是 V2 在 capability 之外引入的第二种架构层 —— 它是 view 必经的业务驱动层,把底层工具(PM / Three.js / etc.)+ 内容形态(block / node)+ 5 capability 协议**编织成 view 可用的运行态**。
>
> v0.2 覆盖 1 个 driver:**text-editing-driver**(L5-A 必需)。
>
> 未来 driver(L6+):graph-editing-driver / web-rendering-driver / ebook-rendering-driver / etc.
>
> **位置**:`src/drivers/COMMON-DRIVER-PROTOCOL.md` — 与 [capabilities/COMMON-PROTOCOL.md](../capabilities/COMMON-PROTOCOL.md) 并列,都是 V2 基础设施层的协议规程。
>
> 文档版本:v0.2
> 编写日期:2026-05-05
> 上下文:L5-A 阶段,text-editing-driver 实施前必须先定本协议

---

## 0. 设计哲学

### 0.1 为什么需要 driver layer

V2 经过反复推敲(用户在 5 轮讨论中追问)区分出两类完全不同的架构层:

| | capability(横切能力) | driver(驱动层) |
|---|---|---|
| 例 | selection / clipboard / undo-redo / dnd / insertion | text-editing-driver / graph-editing-driver(L6+) |
| view 跟它的关系 | view **可选装配**(install) | view **必经此驱动**(无法绕过) |
| 角色 | 横切能力 | 业务驱动(编织底层) |
| 服务对象 | 多个 view 共用 | 一类 view 专用 |
| 性质 | 协议 + 状态聚合 + 注册中心 | 编织 + 封装下层 + 运行时实例 |

把这两种东西放在一起叫 "capability" 是分类混淆。**它们应该是不同的架构层**。

### 0.2 driver 的本质

**类比成熟项目**:
- 浏览器架构里:`Blink rendering engine` 是 driver(驱动 HTML/CSS/JS 渲染) — 浏览器必经,封装下层
- 操作系统:`File system driver` 是 driver(驱动文件操作) — 应用必经,封装磁盘 I/O
- 数据库:`Storage engine` 是 driver(驱动数据持久化) — DBMS 必经,封装存储

driver 都有 4 个共同特点:
1. **必经之路**:应用必须穿过它访问底层
2. **驱动具体业务流程**:不是横切能力,而是为某类业务服务
3. **封装下层复杂度**:应用不接触底层细节
4. **运行时实例**:driver 是有状态的运行时,不是无状态的协议

### 0.3 driver 跟 capability 的协作

driver 不"包装"capability — view 同时 install 5 capability + 自己的 driver(两条独立线):

```
view
   ├─ install 5 capability (selection / clipboard / undo-redo / dnd / insertion)
   └─ install driver (text-editing-driver / graph-editing-driver / ...)
   
driver 通过协议向 5 capability 注册自己的参与:
   - selection.registerSource(...)
   - clipboard.registerSerializer(...)
   - dnd.registerDropTarget(...)
   - insertion.registerSafeguard(...)
   - undoRedo.registerScope(...)
   
driver 不"代理"capability — view 直接看 capability(channel + 纯读 API),
不通过 driver 间接访问。
```

### 0.4 当前阶段(v0.1)覆盖范围

v0.1 覆盖**驱动层共同协议** + **第一个具体 driver(text-editing-driver)**。

后续 driver(L6+ graph-editing-driver / web-rendering-driver / etc.)实施时升级本协议到 v0.2 / v0.3。

---

## 1. driver 层架构

### 1.1 整体架构

```
┌──────────────────────────────────────────────────────┐
│ view 层(NoteView / GraphView / EBookView)           │
│   - install 5 capability + 自己的 driver               │
│   - 通过 driver 暴露的 React 组件渲染                  │
│   - 通过 driver 的工具函数处理 doc(序列化等)          │
│   - 通过 capability channel 订阅状态                   │
│   - 在 view 最外层捕获键盘 → commandRegistry 分发      │
└──────────────────────────────────────────────────────┘
              ↓ install
┌──────────────────────────────────────────────────────┐
│ driver 层(本协议)                                    │
│                                                        │
│ ┌────────────────────────────────────────────────┐    │
│ │ text-editing-driver (L5-A 起)                   │    │
│ │   - 加载 block 模块(import side-effect 自注册)  │    │
│ │   - 拼装 PM Schema(收集 block 的 nodeSpec)      │    │
│ │   - 装配 PM EditorView(收集 block 的 plugin)    │    │
│ │   - 提供 ProseMirrorHost React 组件             │    │
│ │   - 整体作为 source 注册到 5 capability         │    │
│ │   - 内部包含 blocks/(自治模块,自由演化)         │    │
│ │       text-block / math-block / code-block /   │    │
│ │       table / note-link / ...                   │    │
│ └────────────────────────────────────────────────┘    │
│                                                        │
│ ┌────────────────────────────────────────────────┐    │
│ │ graph-editing-driver (L6+,留位)                 │    │
│ │ web-rendering-driver (L6+,留位)                 │    │
│ │ ebook-rendering-driver (L6+,留位)               │    │
│ │ media-rendering-driver (L6+,留位)               │    │
│ └────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
              ↓ register / emit / subscribe
┌──────────────────────────────────────────────────────┐
│ 5 capability(协议地基)                               │
│ → 见 capabilities/COMMON-PROTOCOL.md                  │
└──────────────────────────────────────────────────────┘
              ↓ 直接 import / 使用
┌──────────────────────────────────────────────────────┐
│ 底层工具(driver 内部使用)                             │
│ - PM(prosemirror-state / view / model / etc.)        │
│ - Three.js(graph driver 用)                          │
│ - WebContentsView(web driver 用)                      │
│ - PDF.js / EPUB.js(ebook driver 用)                   │
└──────────────────────────────────────────────────────┘
              ↓ uses
┌──────────────────────────────────────────────────────┐
│ src/shared/(底层 utility)                             │
│ - data-transfer / position helpers / pm types / etc. │
└──────────────────────────────────────────────────────┘
```

### 1.2 driver 内部结构(以 text-editing-driver 为例)

```
src/drivers/text-editing-driver/
├── DESIGN.md                    (driver 实施设计)
├── BLOCK-SPEC.md                (block 注册规约)
├── README.md                    (driver 总览)
├── index.ts                     (driver 入口,export ProseMirrorHost 等)
├── prosemirror-host.tsx         (React 组件)
├── schema-builder.ts            (Schema 拼装逻辑)
├── editor-view-builder.ts       (EditorView 装配逻辑)
├── capability-integrations/     (driver 整体跟 5 capability 的协作)
│   ├── selection-source.ts      (整体作为 selection source)
│   ├── clipboard-handlers.ts    (整体注册 PasteHandler 等)
│   ├── undo-scope.ts            (整体注册 'note-pm' scope)
│   ├── dnd-targets.ts           (整体注册 dropTarget)
│   └── insertion-safeguards.ts  (整体注册 safeguard)
├── blocks/                      (block 自治模块,driver 内部)
│   ├── text-block/
│   │   ├── spec.ts              (PM nodeSpec,必需)
│   │   ├── node-view.ts         (NodeView,可选)
│   │   ├── selection.ts         (block 自己的 select 行为,可选)
│   │   ├── clipboard.ts         (copy/paste/serialize,可选)
│   │   ├── ...                  (Q-Y2=C 自适应文件数)
│   │   └── README.md            (block 设计 + 演化记录)
│   ├── math-block/
│   ├── code-block/
│   ├── table/
│   └── ...
└── plugins/                     (driver 自己的 PM plugins)
    ├── input-rules.ts
    ├── container-keyboard.ts
    └── ...
```

block 的"自适应文件结构"(Q-Y2=C):
- 简单 block(textBlock):`spec.ts + README.md`(2 文件)
- 中等 block(blockquote / image):`spec.ts + node-view.ts + README.md`(3 文件)
- 复杂 block(mathBlock / codeBlock / table):多个文件按需开

block 缺失某文件 → 走 default 行为。**详细 default 规则待 L5-A 实施时在 `src/drivers/text-editing-driver/BLOCK-SPEC.md` 中规定**(本协议不预设具体 default 行为,留 driver 自定义)。

---

## 2. 协议铁律

### 2.1 6 条 driver 特有铁律

#### 铁律 1:driver 是业务驱动层,不是横切能力

driver 服务**一类 view 专用业务**(text-editing-driver 服务文本编辑场景),不是"多 view 共用的横切能力"。

判断方法:
- view 能否"不装它"还能跑?能跑 → 是 capability;不能跑 → 是 driver
- 这个能力是横切多个内容形态的吗?是 → capability;不是,专属一种内容形态的 → driver

#### 铁律 2:driver 必经,view 不绕过

view 通过 driver 暴露的接口(React 组件 / 工具函数)访问底层。view 不直接 import PM / Three.js / etc.

driver 是"抽象屏障":
- view 看到的是抽象组件(`ProseMirrorHost` / `GraphCanvas` / 等),不接触底层 API
- driver 内部封装底层细节,view 业务变化不需要懂底层

#### 铁律 3:driver 是 capability 的消费者 + 提供者,不是包装者

driver 跟 5 capability 的关系:
- **消费者**:driver 订阅 capability 的 channel,调 capability 的纯读 API
- **提供者**:driver 通过 capability 的 register API 注册自己的参与
- **不是包装者**:driver 不"代理 capability 给 view" — view 直接 install capability,直接看 capability

错误模式:
- ❌ driver 包装 capability(`textEditingDriver.selection.getCurrent()`)
- ❌ view 通过 driver 访问 capability(`textEditingDriver.copy()` 内部调 clipboard)

正确模式:
- ✅ view 同时 install driver + capability,各自独立
- ✅ driver 跟 capability 通过协议(register / emit / subscribe)协作,不互相耦合

#### 铁律 4:driver 内部细节自由演化

driver 内部结构(blocks 文件组织 / plugin 装配 / Schema 拼装等)由 driver 自己设计,本协议不强加约束。

唯一约束:driver 必须暴露 view 用的接口(React 组件 + 工具函数 + 跟 capability 的整体集成)。

#### 铁律 5:driver 之间零代码 import

跟 capability 同(承袭 capability 协议铁律 3)。多 driver 共享逻辑下沉到:
1. `src/shared/`(底层 utility)
2. `src/shared/pm/`(PM 类型 / helper,如果多 driver 共用 PM)

例外:**block-spec 类型**可能共享(graph-editing-driver 也可能有"实体注册"机制) — 这种共享通过 `src/shared/spec-types.ts` 提供基础类型,各 driver 扩展自己的具体形态。

#### 铁律 6:命名空间规则按身份分

不同字段的命名空间归属不同,**按身份本质分,不一刀切**。

##### 规则 6a:driver 身份字段(以 driver ID 为前缀)

driver 注册到 capability 的"driver 自身身份字段",必须以 driver ID 为前缀:
- selection source(driver 整体作为选区源)
- clipboard contentType(driver 的内容序列化格式)
- dnd source.type(driver 拖动源类型)

例:
- ✅ `text-editing-driver.text-block`(selection source)
- ✅ `text-editing-driver.text-block.pm-fragment`(clipboard contentType)
- ✅ `text-editing-driver.block.text-block`(dnd source.type)
- ❌ `text-block`(无 driver 前缀,不知道哪个 driver 提供)

##### 规则 6b:view 业务边界字段(以 view ID 为前缀)

scope 类字段(undo-redo scope / 等)是 **view 业务边界**的标识,不是 driver 标识。命名规则:`<view-id>.<scope-purpose>`。

理由:undo 栈是按"用户在哪个 view 做事"分的 — NoteView / ThoughtView 都用 text-editing-driver,但它们的 undo 栈必须独立(用户在 ThoughtView Cmd+Z 不该撤销 NoteView 的动作)。scope 跟 driver 解耦,driver 只是"按 view 给的 scope 名注册"。

例:
- ✅ `note-view.pm`(NoteView 的 PM 编辑栈)
- ✅ `thought-view.pm`(ThoughtView 的 PM 编辑栈)
- ✅ `graph-view.canvas`(GraphView 的画布栈)
- ✅ `ebook-view.annotation`(EBookView 的批注栈)
- ❌ `note-pm`(view 边界不明,如果 NoteView 和 ThoughtView 共享会出 bug)
- ❌ `text-editing-driver.note-pm`(把 driver 信息塞进 scope 是错层 — driver 是技术,scope 是业务)

driver 的接口要求 view 通过 config 传 scope 名:
```tsx
<textEditingDriver.Host
  config={{ undoScope: 'note-view.pm', enabledBlocks: [...] }}
  doc={...}
  onChange={...}
/>
```

driver 内部用 view 给的 scope 调 `undoRedo.registerScope({ scope: config.undoScope, ... })`。

#### 铁律 7:capability 命名空间命令是协议,handler 由 driver 注册

**v0.2 新增,P1.1 修复**。

capability 命名空间的命令(`clipboard.copy` / `clipboard.paste` / `selection.select-all` / `undo-redo.undo` / `undo-redo.redo` / `dnd.start-drag` / `insertion.insert` 等)是**协议命令**:
- **命令名是协议**:view / 工具栏直接调它们(view 不需要知道是哪个 driver 实现)
- **handler 由 driver 注册**:driver 在 init 时调 `commandRegistry.register('clipboard.copy', handler)`,handler 内部 focus-aware(根据当前焦点 view 路由到对应 driver 实现)
- **capability 自己不实现**:capability 只定义协议名 + payload 形态,不提供 handler

driver 自己的命名空间(`note-view.*` / `graph-canvas.*`)只放 **driver 特有功能**(没有跨 driver 等价物的动作):
- ✅ `note-view.toggle-bold`(只 text-editing-driver 有粗体动作)
- ✅ `note-view.split-block`(只 PM 编辑器有 splitBlock)
- ✅ `graph-canvas.connect-nodes`(只 graph-editing-driver 有连线)
- ❌ `note-view.copy-current-block`(重名了 capability 的 `clipboard.copy`,应该统一调 `clipboard.copy`,driver 注册它的 handler)

**反模式警示**:
> driver **不要**重新注册跟 capability 命名空间重名的命令。
> 同一动作(如复制)在用户视角是一个,在协议层应该有且只有一个命令名(`clipboard.copy`),不同 driver 提供不同 handler。重名命令会导致 view 调用时混乱、handler 路由不清晰、协议碎片化。

### 2.2 4 条继承自 capability 协议

> capabilities/COMMON-PROTOCOL.md 已立,继承不重述。

- **铁律 8**:Workspace scope only(承袭)
- **铁律 9**:dev mode typeof 校验(承袭)
- **铁律 10**:Result<T> 不抛错(承袭)
- **铁律 11**:错误隔离(承袭)

---

## 3. driver 协议接口

### 3.1 driver 必须暴露的接口

#### 3.1.1 序列化最小契约(v0.2 新增,P2.4 修复)

driver 序列化产出统一信封形态,payload 自由:

```ts
interface DriverSerialized<TPayload = unknown> {
  /** 格式标识,driver 自定义(如 'pm-json' / 'graph-json' / 'pdf-state')*/
  format: string;
  /** driver 内部版本(向后兼容用,driver 升级 schema 时 bump)*/
  version: string;
  /** 具体内容,driver 自定义形态 */
  payload: TPayload;
}
```

**信封约束(format / version)统一,payload 自由**:
- 消费方(view 业务 / 持久化层 / 跨 driver 协作)能识别 format 是不是自己能处理的
- 不识别的 format → reject(deserialize 返 null,不抛错)
- 不识别的 version → 走 driver 内部 migration(v1 不强制实施,接口预留)

#### 3.1.2 Driver 主接口

每个 driver 必须提供:

```ts
interface Driver<Config, Doc> {
  // ── 元数据 ──
  readonly id: string;              // 'text-editing-driver' / 'graph-editing-driver'
  readonly version: string;
  
  // ── 主入口:React 组件(给 view 装到自己的 view 容器里)──
  Host: React.FC<HostProps<Config, Doc>>;
  
  // ── 工具函数(view 业务可能需要)──
  /** 序列化:doc → DriverSerialized 统一信封 */
  serialize?(doc: Doc): DriverSerialized;
  /** 反序列化:不识别 format / version 返 null(不抛错)*/
  deserialize?(data: DriverSerialized): Doc | null;
  
  // 元信息查询(view 装配 SlashMenu / Toolbar 等可能需要)
  // 注:具体 driver 自定义这些方法,本协议只声明"driver 可以暴露元信息查询"
  
  // ── 跟 capability 的整体集成 ──
  // driver 在 init 时主动调用,把自己整体注册到 capability:
  //   - selection.registerSource('text-editing-driver.<source>')
  //   - clipboard.registerSerializer / registerPasteHandler
  //   - undoRedo.registerScope(<view 通过 config 提供的 scope 名>)
  //   - dnd.registerDropTarget
  //   - insertion.registerSafeguard
  // 这些操作由 driver 内部完成,不暴露给 view
}

interface HostProps<Config, Doc> {
  // driver 配置(view 告诉 driver 用哪些 block / 启用哪些 plugin / 等)
  config: Config;
  
  // 受控:当前文档
  doc: Doc;
  onChange: (newDoc: Doc) => void;
  
  // 可选:其他 view 业务相关 props(readOnly / 自定义样式 / 等)
  readOnly?: boolean;
  className?: string;
}
```

### 3.2 driver 不暴露什么

driver **不**暴露:

- **底层 API 对象**:不暴露 EditorView / EditorState / Three.js scene 等(铁律 2)
- **set/do 动作 API**:driver 内部的动作(块创建 / 节点连线 / 等)不通过 API 暴露 — 通过 commandRegistry 提供命令(如 `'note-view.create-block'` 走 view 命名空间,符合铁律 6b),view 用 commandRegistry 调
- **跟 capability 重复的功能**:不暴露 `driver.copy()` / `driver.undo()` 等(view 直接调 capability 的 commandRegistry 命令)

### 3.3 driver 跟 view 的接口形态

view 用 driver 的方式:

```tsx
function NoteView() {
  const [doc, setDoc] = useState(initialDoc);
  
  return (
    <div>
      <Toolbar />
      <textEditingDriver.Host
        config={{
          enabledBlocks: ['text-block', 'math-block', 'code-block'],
          // ... 其他 driver 配置
        }}
        doc={doc}
        onChange={setDoc}
      />
    </div>
  );
}
```

view 不接触 PM / EditorView / Schema / 等底层概念。

---

## 4. driver 跟 capability 的协作模式

### 4.1 driver 主动注册到 capability

driver 在 init 时(模块 load 时 / 应用启动时)调用 capability 的 register API,声明自己的参与:

```ts
// src/drivers/text-editing-driver/capability-integrations/selection-source.ts
import { selection } from '@capabilities/selection';

selection.registerSource({
  source: 'text-editing-driver',
});

// 当 driver 内部 selection 变化时,driver 自己 emit:
function onSelectionChanged(view: EditorView) {
  const sel = view.state.selection;
  selection.emit({
    source: 'text-editing-driver',
    isEmpty: sel.empty,
    kind: 'text',
    from: sel.from,
    to: sel.to,
  });
}
```

driver **整体**注册一次("我是个 selection source"),具体每次 emit 携带 driver 内部更细的来源信息(如 `'text-editing-driver.block-selection'`)。

### 4.2 命令归属规则(v0.2 重写,P1.1 修复)

承袭铁律 7,命令名分两个命名空间,互不重叠:

#### 4.2.1 capability 命名空间命令(协议命令)

`clipboard.copy` / `clipboard.paste` / `selection.select-all` / `undo-redo.undo` / `undo-redo.redo` / `dnd.start-drag` / `insertion.insert` 等。

- **命令名是协议**(view 调它们,不需要知道是哪个 driver 实现)
- **handler 由 driver 注册**(focus-aware 路由)
- **同一动作只有一个命令名**(`clipboard.copy` 是唯一的"复制"命令,不同 driver 注册不同 handler)

driver 注册形态:

```ts
// src/drivers/text-editing-driver/capability-integrations/clipboard-handlers.ts
import { commandRegistry } from '@slot/command-registry';
import { selection } from '@capabilities/selection';

// driver 注册 'clipboard.copy' handler(focus-aware:只在当前焦点是本 driver 时执行)
commandRegistry.register('clipboard.copy', async () => {
  const current = selection.api.getCurrent();
  if (!current?.source.startsWith('text-editing-driver')) {
    return; // 焦点不在本 driver,让位
  }
  // 本 driver 执行复制:序列化 + 写 navigator.clipboard + clipboard.emit('clipboard.copied')
  // ...具体实现
});
```

view 调用形态:

```tsx
// view 直接调协议命令名,不需要知道哪个 driver 实现
function CopyButton() {
  return <button onClick={() => commandRegistry.execute('clipboard.copy')}>复制</button>;
}
```

注:focus-aware 路由的具体机制(多 driver 时多个 handler 都注册了 'clipboard.copy' 怎么办)由 commandRegistry 实现保证 — 路由策略可能是"按 selection.api.getCurrent() 的 source 找对应 driver"或"按当前焦点 view 的 install 列表找"。具体路由策略不在本协议范围,见 commandRegistry 自己的设计。

#### 4.2.2 driver 命名空间命令(driver 特有功能)

只放**没有跨 driver 等价物**的动作 — 这些动作在协议层没有统一命名:

```ts
// driver 注册自己特有的命令(命名空间用 view-id 前缀,符合铁律 6b)
commandRegistry.register('note-view.toggle-bold', () => { ... });        // 粗体只 PM 编辑器有
commandRegistry.register('note-view.split-block', () => { ... });        // splitBlock 是 PM 概念
commandRegistry.register('note-view.set-heading-level', () => { ... });  // heading 切换是文本特有
```

view 直接调:

```tsx
function BoldButton() {
  return <button onClick={() => commandRegistry.execute('note-view.toggle-bold')}>B</button>;
}
```

### 4.3 driver 不暴露 capability 的功能(v0.4 强化)

回顾 § 4.2 — driver 跟 capability 命令的关系是:**driver 注册 handler,不"包装" capability**。

错误模式(driver 把 capability 包装成自己的 API):

```ts
// ❌ driver 自己暴露 set/do API,内部调 capability
textEditingDriver.api.copy()  // 不要这样
textEditingDriver.api.undo()  // 不要这样

// ❌ driver 重新注册 capability 命名空间命令的 alias
commandRegistry.register('note-view.copy-current-block', ...);
// 这跟 'clipboard.copy' 重复语义,违反"同一动作一个命令名"

```

正确模式:

```ts
// ✅ view 直接调 capability 命名空间命令(driver 已注册 handler)
commandRegistry.execute('clipboard.copy')      // 复制 — 不管谁实现,view 视角统一
commandRegistry.execute('undo-redo.undo')      // 撤销 — 同上
commandRegistry.execute('insertion.insert')    // 插入 — 同上

// ✅ view 调 driver 特有命令(view 命名空间,符合铁律 6b)
commandRegistry.execute('note-view.toggle-bold')        // 粗体(只文本编辑器有)
commandRegistry.execute('note-view.split-block')        // splitBlock(PM 概念)
commandRegistry.execute('graph-view.connect-nodes')     // 连线(只图谱有)
```

**关键原则**:
- 命令名按身份归属(铁律 6 + 7)
- capability 命令是协议(driver 注册 handler)
- driver 命令是特有功能(没有跨 driver 等价物)
- 二者**不重叠** — 同一动作只有一个命令名

---

## 5. driver 实施分阶段

### 5.1 v0.1 阶段(L5-A)

实施 1 个 driver:**text-editing-driver**。

详细设计见 [`src/drivers/text-editing-driver/DESIGN.md`](text-editing-driver/DESIGN.md) v0.2 + [`text-editing-driver/BLOCK-SPEC.md`](text-editing-driver/BLOCK-SPEC.md) v0.1。

### 5.2 v0.2 阶段(L6+)

加 1-2 个 driver,根据需要升级本协议:

- `graph-editing-driver`(L6 GraphView 用,基于 Three.js)
- 或 `media-rendering-driver`(L6+ image / video / audio 共享渲染基础)

第二个 driver 出现时验证本协议是否完备,根据反馈升级 v0.2。

### 5.3 v0.3+ 阶段(L7+)

更多 driver:
- `web-rendering-driver`(WebView 嵌入)
- `ebook-rendering-driver`(PDF / EPUB)
- `ai-augment-driver`(AI 业务驱动 — 可能是 driver,也可能是业务 capability,届时讨论)

---

## 6. 风险 + 开放问题

### 6.1 driver 之间能否共享代码?

**推荐**:严格按铁律 5 — 不互相 import,共享下沉到 `src/shared/`。

特例:
- 如果 graph-editing-driver 跟 text-editing-driver 都用 PM(graph 节点也是 PM 编辑器)→ PM 共享类型放 `src/shared/pm/types.ts`,两个 driver 都 import 它
- 如果发现"两个 driver 共享 60% 逻辑" → 重新审视分类(可能不该分两个 driver,或共享部分该提到 src/shared/)

### 6.2 driver 跟 view 的"配置接口"如何稳定?

driver 暴露的 `Host` 组件接受 `config` props。这个 config 形态会演化(L6+ 加新功能时 config 加字段)。

**推荐**:
- v1 不预设完整 config(避免过度设计)
- 真有新需求时 config 加可选字段(向后兼容)
- 重大改动走 driver 版本号(driver v1 / driver v2 各 export 不同 Host)

### 6.3 driver 内部"block 自治模块"是否在所有 driver 都适用?

text-editing-driver 用 block 自治(因为 PM 内容是 block 树)。其他 driver 怎么办?

- graph-editing-driver:内容是节点 + 连线,可能用"node-spec / edge-spec 自治"
- web-rendering-driver:内容是网页,可能没有"自治模块"概念,driver 是单一整体
- ebook-rendering-driver:内容是页面,可能用"renderer-spec 自治"

**推荐**:**driver 内部自治模式由 driver 自己决定,本协议不规定**。本协议铁律 4 已明确"driver 内部细节自由演化"。

### 6.4 driver 怎么暴露元信息(让 view 装配 UI)?

view 装配 SlashMenu / Toolbar 时可能需要知道 driver 内部能做什么(如"有哪些 block 可创建")。

**推荐**:driver 提供**只读元信息查询**方法(如 `textEditingDriver.listAvailableBlocks()`)。具体方法名 + 形态由 driver 自定义,本协议不规定。

### 6.5 driver 卸载?

v1 不实施动态卸载(driver 启动时全部 ready)。L7+ 真有"按需加载 driver"需求(如 ebook driver 只在打开 ePub 时加载)再设计。

### 6.6 多个 driver 同时活跃时(view 能否 install 多 driver)?

view 通常 install 一个 driver(NoteView install text-editing-driver)。但**视觉浮层 / 工具条**等可能跨 driver 服务多种 view。

**推荐**:**v1 一 view 一 driver**(NoteView / GraphView 各一个)。L7+ 真有"一 view 多 driver"需求再讨论。

---

## 7. 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-05-05 | v0.1 | 初稿;driver layer 概念定义 + driver vs capability 区分 + 6 条 driver 特有铁律 + 4 条继承自 capability + driver 接口形态 + driver/capability 协作模式 + 实施分阶段 + 6 个开放问题。Q-D1~5 用户拍板固化。 |
| 2026-05-05 | v0.2 | **协议闭环修订**(基于 AI 评估的 4 个 P1/P2 问题): (P1.1 命令归属冲突) 重写铁律 6 拆成 6a/6b 按身份分,新增铁律 7 明确 capability 命名空间命令是协议(driver 注册 handler,focus-aware 路由),driver 不能注册重名命令;(P1.2 scope 命名规则) 删除"undo-redo scope 例外",改成 view-level scope 命名 `<view-id>.<purpose>`,driver 通过 view 给的 config 注册 scope;(P2.1 未存在文档强引用) 删除 BLOCK-SPEC.md / DESIGN.md 链接,改为"待 L5-A 实施"说明;(P2.2 序列化契约) 加 `DriverSerialized<TPayload> { format, version, payload }` 信封约束,payload 自由。Q-F1~F4 用户拍板固化(Q-F1=A / Q-F2=A 修正版 / Q-F3=A / Q-F4=A)。 |
| 2026-05-05 | v0.2.1 | **P2 文档漂移修复**(无协议变更): 全文 "v0.4 新增/重写" → "v0.2 新增/重写"(版本表述对齐头部);`note-pm.create-block` 残留示例 → `note-view.create-block`(对齐铁律 6b);更新"待 L5-A 实施时落入 DESIGN.md"过期语句 → 直接链接已存在的 DESIGN.md / BLOCK-SPEC.md。 |
