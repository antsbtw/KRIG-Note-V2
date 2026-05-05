# Workspace Bus 协议规程 v0.1

> 阶段:L3.5 — 在 L3 Workspace 与 L5 view 之间补一层运行时通信通道
> 范围:同一 Workspace 内 view 与 view 之间的互动
> 拍板日期:2026-05-05

---

## 0. 为什么要协议规程

V1 用一个 EventEmitter 一把抓所有 view 间通信,导致两个症状(memory 已记):

1. **状态散落漂移** — `activeNoteId` / `rightActiveNoteId` / `activeBookId` 散落到各处,各 view 监听一堆事件去推自己的状态,推来推去就乱了
2. **协议不可见** — 谁能 emit 什么事件、谁监听了什么、payload 形状是什么,只能靠看代码猜;改一个事件名要全文搜

V2 不能再来一遍。先**白纸黑字立协议**,再写代码。本文档**先于实现**,实现必须遵守这里写的每一条铁律。

---

## 1. 协议核心:三类管道

V2 把 view 间通信拆成三类**形态不同**的管道,**不混用**。

| 管道 | 用途 | API 形态 | 例子 |
|---|---|---|---|
| **Channel** | view 状态广播(订阅式) | `emit / subscribe`,有 lastValue | NoteView 选区变 → GraphView 高亮节点 |
| **Capability Request** | 调用别 view 的能力(请求式) | `request → Promise<Result<T>>`,1 handler | NoteView → AIView "总结这段" |
| **Slot Control** | 改容器(框架内置) | `bus.openRight / closeRight / closeLeft` | NoteView 把 AI 结果推到 right slot |

### 为什么是三类不是两类

| 操作 | 为什么独立成一类? |
|---|---|
| Channel | 多订阅者、无返回值,**广播状态**(高频低成本) |
| Capability Request | 1 handler 有返回值,**调用能力**(语义=远程调函数) |
| Slot Control | **不影响 view 内部,影响容器布局** — 是框架级保留指令,不该让 view 注册 handler 来改写 |

V1 的教训:把"改容器布局"当成普通 event 发,导致谁都能远程切别人的 slot,主 view 偷偷被换。V2 把容器控制收回框架。

---

## 2. 九条铁律

> 实施代码必须严格遵守,任何违反需先改协议再改代码。

### 铁律 1:三类管道,各司其职
- 状态广播用 Channel,**不准**用 Capability Request 来"获取状态"(用 lastValue 即可)
- 调能力用 Capability Request,**不准**用 Channel 模拟 RPC(广播一个事件等响应)
- 改容器用 Slot Control 内置 API,**不准**用 Capability Request 注册 `slot.*` handler

### 铁律 2:Workspace scope only
- bus 实例**每个 Workspace 一个**,挂在 WorkspaceManager 上
- 跨 Workspace 不通(物理隔离 — A workspace 的事件绝不到 B)
- 跨 Workspace 通信(罕见)走主进程 IPC,不在本协议范围

### 铁律 3:dev mode typeof 校验
- TypeScript 类型 + 编译期校验
- dev mode `bus.emit` / `bus.request` 时对 payload 顶层字段做 `typeof` 检查,类型不符 console.warn
- prod 0 开销
- **不引入** zod / valibot 等运行时校验库(charter § 1.3)

### 铁律 4:Manifest 分散
- 每个 view / capability 自己导出 `channels.ts` 声明它**对外发什么** + **监听什么** + **注册什么 handler**
- bus 启动时扫描收集 manifest(或 view 注册时主动 declare)
- **不集中**写在 `src/slot/workspace-bus/all-channels.ts` — 避免"加一个 view 改总表"的耦合

### 铁律 5:主 view 锁
- bus **不提供**改 left slot 的 API(`openLeft` 不存在)
- view 注册 `slot.left.*` handler 时 bus 拒绝并 dev warn
- 唯一改 left 的入口:**NavSide ViewSwitcher 点击**(用户显式) + **right→left 升级**(框架内置)

### 铁律 6:Slot Control 是框架级保留指令
bus 内置三个 API,实现写死在 bus 里:
```ts
bus.openRight(viewId: string, payload?: unknown): Result<void>
bus.closeRight(): Result<void>
bus.closeLeft(): Result<void>  // 触发 right→left 升级
```
view 注册同名 handler 时 bus 拒绝。

### 铁律 7:left 关闭时 right→left 升级
`bus.closeLeft()` 行为:
```
if (right !== null) {
  // right 升级到 left,view 实例**不重建**(visibility 同款机制)
  slotBinding = { left: right, right: null };
} else {
  // 没 right 兜底 → 这是最后一个 view,拒绝
  return { ok: false, reason: 'last-view-cannot-close' };
}
```
**view 实例不销毁**:SlotArea 渲染策略按 viewId 缓存,只切 left/right 字段值,view 实例继续存在,状态保留。

### 铁律 8:最后一个 view 不可关
- Workspace **必有** left view(ensureMinimum 在 slot 层的对称)
- left 关闭按钮在 `right === null` 时 **disabled**(灰显 + `pointer-events:none`)
- `bus.closeLeft()` 在 last-view 状态下返回 `{ ok: false, reason: 'last-view-cannot-close' }`
- 用户想换主 view 走 NavSide ViewSwitcher(直接替换 left,不需要先关再开)

### 铁律 9:NavSide 切主 view 自动关 right
- 沿用 V1 已有契约(memory `navside_switch_closes_right_slot`)
- ViewSwitcher 点击切 left 时,bus 内部触发 `closeRight()`,right 自动清空
- **理由**:右 slot 是与主 view 共生的辅助/对照位,主 view 换了辅 view 不再有意义

---

## 3. 命名规约

### Channel 命名
格式:`<source>.<entity>.<event>`

- `<source>`:发起方 view ID 或 capability ID(`note` / `graph` / `ai`)
- `<entity>`:状态主体(`selection` / `cursor` / `node` / `block`)
- `<event>`:动词过去式或形容词(`changed` / `hovered` / `cleared`)

例:
```
note.selection.changed       — NoteView 选区变化
graph.node.hovered           — GraphView 节点悬停
ai.thinking.started          — AIView 开始思考
```

### Capability Request 命名
格式:`<scope>.<verb>` 或 `<verb>`

- `<scope>` 可选,单字"动词"够清晰时省略
- 动词用基础形式(`summarize` / `translate` / `create`)

例:
```
ai.summarize       — AIView 总结
ai.translate       — AIView 翻译
note.create        — 创建笔记
graph.focus        — GraphView 聚焦到节点
```

### Slot Control(保留前缀)
**`slot.*` 是 bus 保留命名空间**,view/capability 不能用作自己的 channel / request 名。
内置 API 只有三个:`openRight` / `closeRight` / `closeLeft`(不通过命名空间暴露,直接 bus 方法)。

---

## 4. 类型契约(payload Schema)

### Channel 类型契约
view/capability 在 `channels.ts` 里声明 channel 名 + payload 形状:

```ts
// src/views/note/channels.ts
export interface NoteChannels {
  'note.selection.changed': {
    from: number;       // 选区起点
    to: number;         // 选区终点
    text: string;       // 选中文本
    anchorId?: string;  // 关联资源(可选)
  };
  'note.scroll.changed': {
    top: number;
    blockId: string | null;
  };
}
```

bus 把所有 view 的 manifest 类型 union 起来,得到全局 `BusChannels` 类型,emit/subscribe 时 TS 强校验。

### Capability Request 类型契约
```ts
// src/capabilities/ai/channels.ts
export interface AIRequests {
  'ai.summarize': {
    input: { text: string; maxLength?: number };
    output: { summary: string; tokens: number };
  };
  'ai.translate': {
    input: { text: string; from: string; to: string };
    output: { translated: string };
  };
}
```

bus.request 调用时:
```ts
const result: Result<AIRequests['ai.summarize']['output']> =
  await bus.request('ai.summarize', { text: '...', maxLength: 200 });
```

### Result 类型(统一错误处理)
```ts
type Result<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; detail?: unknown };
```

**所有 bus 操作返回 Result,不抛错**。调用方 if 判断,不写 try/catch。

---

## 5. 边界与禁区

### 禁区 1:不要把 Channel 当 RPC
**反例**:
```ts
// 错误 — 用 channel 模拟 request
bus.emit('graph.get-selection', { requestId: '123' });
bus.subscribe('graph.get-selection.response', (data) => {
  if (data.requestId === '123') { /* 处理 */ }
});
```
**正解**:
```ts
const result = await bus.request('graph.getSelection', {});
```

### 禁区 2:不要把 Slot Control 包装成 Capability Request
**反例**:
```ts
// 错误 — view 注册 handler 改写 slot 控制
bus.registerRequestHandler('slot.openRight', (payload) => { ... });
```
bus 启动时检查 `slot.*` 前缀,拒绝注册 + dev warn。

### 禁区 3:不要在 channel handler 里同步调 emit
- 同步 emit 链可能引起循环(A 发 → B 听 → B 发 → A 听 → A 发...)
- bus 内部检测嵌套深度 > 5 时 dev warn(prod 不拦,信任代码)
- 必要时用 `queueMicrotask(() => bus.emit(...))` 打断同步链

### 禁区 4:不要持久化 channel 内容
- lastValue 仅内存,刷新即丢
- 需要持久化的状态走 `WorkspaceState.pluginStates`(L3 已建)
- bus 不参与持久化

### 禁区 5:不要跨 Workspace 通信
- bus 实例严格 workspace-scoped
- 想要全局通信用 IPC(主进程层)

---

## 6. 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-05-05 | v0.1 | 初稿;9 条铁律 + 三类管道 + 命名规约 + 5 大禁区 + Q1-Q20 拍板固化 |
