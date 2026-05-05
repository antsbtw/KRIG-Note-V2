# Workspace Bus 实施设计 v0.1

> 协议:见 [PROTOCOL.md](./PROTOCOL.md)(本文档实现协议,不重述协议本身)
> 阶段:L3.5
> 设计日期:2026-05-05

---

## 1. 模块文件结构

```
src/slot/workspace-bus/
├── PROTOCOL.md              # 协议规程(已写)
├── DESIGN.md                # 本文件
├── README.md                # 模块说明 + 用法示例
├── workspace-bus.ts         # WorkspaceBus 类(单 Workspace 一实例)
├── bus-types.ts             # Result / Channel / Request 类型
├── channel.ts               # Channel 子模块(订阅 + lastValue)
├── request.ts               # Request 子模块(handler + result)
├── slot-control.ts          # Slot Control 子模块(三个内置 API)
├── manifest-collector.ts    # 收集 view/capability 的 channels.ts
├── use-workspace-bus.ts     # React hook(useWorkspaceBus / useChannel / useRequest)
└── __dev__/
    └── payload-typecheck.ts  # dev mode 浅层 typeof 校验
```

加上接入点:
- `src/workspace/workspace-state/workspace-manager.ts` — 加 `getBus(id)`
- `src/workspace/workspace-instance/WorkspaceInstance.tsx` — 经 React Context 提供 bus
- `src/workspace/workspace-instance/slot-area/SlotArea.tsx` — 配合 right→left 升级时不重建 view

---

## 2. 数据结构

### Result(统一错误处理)
```ts
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; detail?: unknown };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = (reason: string, detail?: unknown): Result<never> =>
  ({ ok: false, reason, detail });
```

### Channel 注册表(每 bus 实例一份)
```ts
class ChannelHub {
  private listeners = new Map<string, Set<(payload: unknown) => void>>();
  private lastValues = new Map<string, unknown>();  // 铁律:lastValue 只内存
  emit(channel: string, payload: unknown): void;
  subscribe(channel: string, handler: (payload: unknown) => void): () => void;
  getLastValue(channel: string): unknown | undefined;
  // 私有:
  private notifyDepth = 0;  // 检测同步循环
}
```

### Request 注册表(每 bus 实例一份)
```ts
class RequestHub {
  private handlers = new Map<string, (input: unknown) => unknown | Promise<unknown>>();
  registerHandler(name: string, handler: (input: unknown) => unknown | Promise<unknown>): Result<void>;
  unregisterHandler(name: string): void;
  request(name: string, input: unknown): Promise<Result<unknown>>;
}
```
**注册时校验**:`name.startsWith('slot.')` 直接 `fail('reserved-prefix')`(铁律 6)。
**重复注册同名**:`fail('handler-already-exists', { existing: handlerName })` — view 卸载需先 unregister。

### Slot Control(每 bus 实例一份)
```ts
class SlotControl {
  constructor(private wsId: string, private workspaceManager: WorkspaceManager) {}
  openRight(viewId: string, payload?: unknown): Result<void>;
  closeRight(): Result<void>;
  closeLeft(): Result<void>;
}
```
内部直接调 `workspaceManager.update(wsId, { slotBinding: {...} })`,不发任何 channel。

### WorkspaceBus(组合)
```ts
export class WorkspaceBus {
  readonly channels: ChannelHub;
  readonly requests: RequestHub;
  readonly slot: SlotControl;
  constructor(wsId: string, manager: WorkspaceManager);
}
```

---

## 3. API 形态

### 3.1 通用引用
```ts
// React 树内任何位置:
const bus = useWorkspaceBus();  // 拿当前 Workspace 的 bus 实例
```

实现:`WorkspaceBusContext.Provider value={bus}` 包在 `WorkspaceInstance` 外层,bus 由 `workspaceManager.getBus(state.id)` 获得(manager 内部 Map 缓存,每 Workspace 一实例)。

### 3.2 Channel API
```ts
// 发送
bus.channels.emit('note.selection.changed', { from, to, text });

// 订阅(useEffect 内)
useEffect(() => {
  const unsub = bus.channels.subscribe('note.selection.changed', (payload) => {
    setSelection(payload);
  });
  return unsub;
}, [bus]);

// React hook(自动用 lastValue 初始化)
const selection = useChannel<NoteSelectionPayload>('note.selection.changed');
```

`useChannel` 实现:
```ts
function useChannel<T>(channel: string): T | undefined {
  const bus = useWorkspaceBus();
  return useSyncExternalStore(
    (cb) => bus.channels.subscribe(channel, cb),
    () => bus.channels.getLastValue(channel) as T | undefined,
  );
}
```
按 L4 经验:`getLastValue` 返回 Map.get 稳定引用,无 useSyncExternalStore 死循环。

### 3.3 Request API
```ts
// 注册 handler(通常在 capability mount 时)
useEffect(() => {
  const result = bus.requests.registerHandler('ai.summarize', async ({ text }) => {
    const summary = await callAIModel(text);
    return { summary, tokens: 42 };
  });
  if (!result.ok) console.warn('register fail:', result.reason);
  return () => bus.requests.unregisterHandler('ai.summarize');
}, [bus]);

// 调用
const result = await bus.requests.request('ai.summarize', { text: '...' });
if (result.ok) {
  console.log(result.value.summary);
} else {
  // result.reason: 'no-handler' / 'handler-threw' / 等
}
```

### 3.4 Slot Control API
```ts
const result = bus.slot.openRight('ai-result', { summary: '...' });
if (!result.ok) toast(result.reason);

bus.slot.closeRight();

const result = bus.slot.closeLeft();
if (!result.ok && result.reason === 'last-view-cannot-close') {
  // UI 已经 disabled 按钮,这里基本不会触发,防御性
}
```

---

## 4. 关键流程

### 4.1 right→left 升级(铁律 7)

```
触发:bus.slot.closeLeft()

step 1:取当前 slotBinding(left='note', right='graph')
step 2:if right === null → return fail('last-view-cannot-close')
step 3:slotBinding 升级为 { left: 'graph', right: null }
step 4:workspaceManager.update(wsId, { slotBinding: 升级后 })
step 5:WorkspaceState.slotBinding 变化触发 React 重渲
step 6:SlotArea 看新 slotBinding,**view 实例 key 不变**(按 viewId 缓存),只切 left/right 字段值
       → GraphView 实例继续存在,只是从 right 容器移到 left 容器
       → 状态完整保留(滚动位置 / 选区 / 内部 state)
step 7:bus.slot 内部触发清场:right view 已经升级走了,nothing to clean
```

### 4.2 NavSide 切主 view(铁律 9)

```
触发:用户点 ViewSwitcher 的 BookView tab(当前 left=Note, right=Graph)

step 1:ViewSwitcherFrame 调 workspaceManager.update(wsId, {
         slotBinding: { ...prev, left: 'book' }
       })
step 2:WorkspaceManager 通知 bus.slot 自动关 right(契约 9)
       — 实施:bus.slot 监听 workspaceManager 的 slotBinding 变化,
         发现 left 由用户 NavSide 切换 → 自动调 closeRight()
step 3:slotBinding = { left: 'book', right: null }
```
**实施细节**:为区分"NavSide 切左" vs "bus.openRight 切右",`workspaceManager.update` 加可选参数 `{ source: 'navside' | 'bus' | 'frame' }`,bus.slot 订阅时按 source 决定是否触发自动 closeRight。

### 4.3 Channel emit 链(铁律 — 禁区 3)

```ts
class ChannelHub {
  emit(channel: string, payload: unknown): void {
    this.notifyDepth++;
    if (this.notifyDepth > 5 && process.env.NODE_ENV === 'development') {
      console.warn(`[bus] emit chain depth ${this.notifyDepth} on '${channel}', possible loop`);
    }
    this.lastValues.set(channel, payload);
    const listeners = this.listeners.get(channel);
    if (listeners) {
      // 错误隔离:一个 listener 抛错不影响其他
      listeners.forEach((l) => {
        try { l(payload); } catch (e) { console.error('[bus] listener error:', e); }
      });
    }
    this.notifyDepth--;
  }
}
```

### 4.4 dev mode payload 校验(铁律 3)

```ts
// __dev__/payload-typecheck.ts
export function shallowTypeCheck(channel: string, payload: unknown, expected: Record<string, string>): void {
  if (typeof payload !== 'object' || payload === null) {
    console.warn(`[bus][dev] '${channel}' payload not object`);
    return;
  }
  for (const [key, type] of Object.entries(expected)) {
    if (typeof (payload as Record<string, unknown>)[key] !== type) {
      console.warn(`[bus][dev] '${channel}' field '${key}' should be ${type}, got ${typeof (payload as Record<string, unknown>)[key]}`);
    }
  }
}
```
expected schema 来自 manifest 收集器(view 的 channels.ts 导出 schema 字典)。

---

## 5. Manifest 收集机制(铁律 4)

view/capability 自己写 `channels.ts`:
```ts
// src/views/note/channels.ts
export const noteChannels = {
  'note.selection.changed': {
    from: 'number',
    to: 'number',
    text: 'string',
  },
  'note.scroll.changed': {
    top: 'number',
    blockId: 'string',  // 注:typeof null === 'object',这里为简化只支持基础类型 + 'object'
  },
} as const;
```

view 注册到 viewTypeRegistry 时把 manifest 一起带上(L5 接入):
```ts
registerView({
  id: 'note',
  install: ['text-editing', ...],
  channels: noteChannels,         // ← 新增字段
  requestHandlers: noteRequests,  // ← 新增字段(可选)
});
```

bus 启动时:
- viewTypeRegistry.register 内部调 `busManifest.collect(def.channels, def.requestHandlers)`
- bus 拿到全集 schema,emit 时根据 channel 名查 schema 做 typecheck

**v1 不实现完整 manifest collect**(view 数=0 时没意义),先把 hook 留好接口,L5 第一个 view 真用时落地。

---

## 6. 与现有架构的接入点

### 6.1 WorkspaceManager
```ts
// 加方法
class WorkspaceManager {
  private buses = new Map<string, WorkspaceBus>();

  getBus(id: string): WorkspaceBus | undefined {
    if (!this.workspaces.has(id)) return undefined;
    if (!this.buses.has(id)) {
      this.buses.set(id, new WorkspaceBus(id, this));
    }
    return this.buses.get(id);
  }

  // close 时清理 bus
  close(id: string): string | null {
    this.buses.delete(id);
    // ... 原 close 逻辑
  }
}
```

### 6.2 WorkspaceInstance
```tsx
import { WorkspaceBusContext } from '@slot/workspace-bus/use-workspace-bus';

export function WorkspaceInstance({ state, isActive }: Props) {
  const bus = workspaceManager.getBus(state.id);
  return (
    <WorkspaceBusContext.Provider value={bus}>
      {/* 原有内容 */}
    </WorkspaceBusContext.Provider>
  );
}
```

### 6.3 SlotArea(配合铁律 7)
当前 SlotArea 按 slotBinding.left / .right 直接渲染对应 view —— 改成**按 viewId 缓存 view 实例**,切换时只调 visibility,不重建。

实施:
- SlotArea 内部 `viewInstances: Map<viewId, ReactNode>`(用 useMemo 缓存)
- 渲染时按当前 slotBinding 决定哪个实例可见
- right→left 升级时,viewId 没变,实例继承,状态保留

### 6.4 ViewSwitcherFrame(配合铁律 9)
当前点击 tab 调 `workspaceManager.update`。改成:
```tsx
const handleSwitch = (viewId: string) => {
  workspaceManager.update(workspaceId, {
    slotBinding: { ...ws.slotBinding, left: viewId },
  }, { source: 'navside' });  // ← 标记来源
};
```
bus.slot 监听 update 事件,source==='navside' 时自动 closeRight(铁律 9)。

### 6.5 left slot 关闭按钮(铁律 8 UI)
SlotArea 顶部 left 容器加 [×] 按钮:
```tsx
const canClose = ws.slotBinding.right !== null;  // 有 right 才能关 left(可升级)
<button
  className="krig-slot-close"
  disabled={!canClose}
  onClick={() => bus.slot.closeLeft()}
>×</button>
```
right=null 时按钮 disabled + 灰显(铁律 8)。

right slot 顶部也加 [×] 按钮:`onClick={() => bus.slot.closeRight()}`(无 disabled 条件)。

---

## 7. 完成判据

| # | 判据 | 验证 |
|---|---|---|
| 1 | bus 实例每 Workspace 一个,跨 Workspace 不通 | 单元/手测:WS A emit 'foo',WS B 订阅 'foo' 不收到 |
| 2 | Channel emit/subscribe 跑通,lastValue 工作 | 后订阅者立即拿到上一次 emit 值 |
| 3 | Request 注册 / 调用 / Result 返回 | 注册 'echo' handler → request 'echo' → 拿到 ok+value |
| 4 | `slot.*` 前缀注册被拒绝 | view 试注册 `slot.foo` → fail+reason='reserved-prefix' |
| 5 | bus.slot.openRight 装载 right slot,view 拿到 payload | right=null → openRight('graph', { x: 1 }) → right=graph,GraphView mount 时拿到 { x: 1 } |
| 6 | bus.slot.closeLeft + right→left 升级 | left=Note right=Graph → closeLeft() → left=Graph right=null,GraphView 实例不重建 |
| 7 | last-view-cannot-close | left=Note right=null → closeLeft() → fail+reason='last-view-cannot-close' |
| 8 | NavSide 切左自动关右 | left=Note right=Graph → ViewSwitcher 切 Book → left=Book right=null |
| 9 | dev mode 类型不匹配 console.warn | emit 'note.selection.changed' 但传错类型 → dev console warn |
| 10 | typecheck + lint 全过 | `npm run typecheck` / `npm run lint` |
| 11 | console `[L3.5] alive | bus instances: N` | renderer 启动后输出 |
| 12 | 健康检查 IPC `health.L3.5` 返回 alive | DevTools 验证 |

判据 5、6、7、8 在 L3.5 阶段无法**用真 view 验证**(没注册过 view),用一对**临时 stub view** 自测(测试代码不入正式包)。

---

## 8. 实施顺序

1. 铁律类型定义(`bus-types.ts`)— Result / Channel / Request 类型
2. ChannelHub(`channel.ts`)
3. RequestHub(`request.ts`)
4. SlotControl(`slot-control.ts`)
5. WorkspaceBus 组合(`workspace-bus.ts`)
6. WorkspaceManager.getBus + 生命周期
7. React Context + useWorkspaceBus / useChannel hook
8. SlotArea 改造为按 viewId 缓存(配合铁律 7)
9. SlotArea 加左右关闭按钮(配合铁律 8)
10. ViewSwitcherFrame 加 source 标记 + bus 监听自动 closeRight(配合铁律 9)
11. dev typecheck + manifest collect 接口(留 L5 落地)
12. L3.5-alive 诊断 + IPC HEALTH_L3_5
13. 临时 stub 测试 / 手测判据 → 写完成报告

---

## 9. 不做的事(L3.5 范围严格)

- ❌ 任何 view 实现(L5)
- ❌ 任何 capability 实现(L5)
- ❌ 完整 manifest collect 链路(view 数=0 时没意义,留 L5)
- ❌ 持久化(铁律 — 内存即可)
- ❌ 跨 Workspace 通信(用 IPC,不在范围)
- ❌ 业务 npm 依赖(charter § 1.3)
- ❌ 权限校验(用户 Q1=A 决定缓做)

---

## 10. 风险与缓解

| 风险 | 缓解 |
|---|---|
| useSyncExternalStore 又遇到死循环 | useChannel 只订阅 Map.get 稳定引用,L4 已建经验 |
| right→left 升级时 view 实例丢状态 | SlotArea 按 viewId 缓存,React key 不变,实例不重建 |
| bus 实例与 Workspace 生命周期不同步 | manager.close(id) 同时 buses.delete(id);WorkspaceInstance unmount 时不需要清(WS 还在) |
| 监听器内同步 emit 引发循环 | notifyDepth 检测 > 5 dev warn(不强拦,信任代码) |
| right view payload 在升级后访问 | 当前 v1:右 slot view 在 mount 时收到 payload,升级到 left 后 React 实例不重建,payload 是闭包变量自然保留 |
| L5 view 真用时发现协议漏洞 | PROTOCOL.md 加修订记录,版本号递增,不破坏 v0.1 接口 |

---

## 11. 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-05-05 | v0.1 | 初稿;实施计划 + 数据结构 + API + 完成判据 + 13 步顺序 |
