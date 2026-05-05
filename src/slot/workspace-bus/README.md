# workspace-bus/

Workspace 内 view 与 view 之间的运行时通信通道(L3.5)。

## 核心文档

- [PROTOCOL.md](./PROTOCOL.md) — 协议规程(9 条铁律 + 三类管道 + 命名规约 + 5 大禁区)**先读**
- [DESIGN.md](./DESIGN.md) — 实施设计(数据结构 + API + 13 步实施)

## 三类管道速览

```ts
// 1. Channel(订阅式状态广播)
bus.channels.emit('note.selection.changed', { from, to, text });
bus.channels.subscribe('note.selection.changed', handler);
const last = bus.channels.getLastValue('note.selection.changed');

// 2. Capability Request(请求-响应式)
bus.requests.registerHandler('ai.summarize', async (input) => ({ summary: '...' }));
const result = await bus.requests.request('ai.summarize', { text: '...' });
if (result.ok) console.log(result.value);

// 3. Slot Control(框架级保留指令)
bus.slot.openRight('graph', { nodeId: 'n1' });   // 打开右 slot
bus.slot.closeRight();                            // 关闭右 slot
bus.slot.closeLeft();                             // 关闭左 slot(右升级或拒绝)
```

## React 接入

```tsx
// 拿当前 Workspace 的 bus
const bus = useWorkspaceBus();

// 订阅 channel,自动用 lastValue 初始化
const selection = useChannel<NoteSelectionPayload>('note.selection.changed');
```

## 关键约束(必读)

1. **Workspace scope only** — 跨 Workspace 不通,需要全局通信走 IPC
2. **slot.* 是保留前缀** — view 不能注册 `slot.*` 名字的 request handler
3. **left slot 不能远程改** — bus 只提供 closeLeft / openRight / closeRight,**不提供 openLeft**
4. **right→left 升级** — closeLeft 时 right view **实例不重建**(SlotArea 按 viewId grid-area 切换)
5. **最后一个 view 不可关** — closeLeft 在 right=null 时返回 `fail('last-view-cannot-close')`,UI 按钮 disabled
6. **NavSide 切左自动关右** — ViewSwitcher 切 left 时一并把 right 置 null

## 与现有架构的接入

- `WorkspaceManager.getBus(id)` — lazy 创建,每 Workspace 一实例
- `WorkspaceInstance` — 通过 `WorkspaceBusContext.Provider` 提供 bus
- `SlotArea` — Grid 布局,view 实例按 viewId 缓存
- `ViewSwitcherFrame` — 切 left 时调 `update(... { source: 'navside' })` 一并关 right

L3.5 阶段没有真 view,所有判据要等 L5 第一个 view 实测。
