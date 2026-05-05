# src/slot — 详细设计

> v0.1 · 2026-05-05 · 草稿,等用户审阅
>
> 配套:[charter.md v0.4 § 1.2 + § 1.4](../../docs/00-architecture/charter.md) + [view-hierarchy-v2.md v1.1](../../docs/RefactorV2/view-hierarchy-v2.md) + [src/workspace/DESIGN.md v0.1](../workspace/DESIGN.md)

---

## 1. 本层范围(L4 — Slot Registry 基础设施)

L4 是 V2 架构的**枢纽层**——按 charter § 1.2 注册原则,所有内容都通过 Registry 注册,L4 提供 Registry 基础设施 + 接入各 frame。

L4 阶段做 8 件事:

```
src/slot/
├── view-type-registry/         ← 视图类型注册(L5 view 通过 install 列表注册)
├── capability-registry/        ← 能力注册(L4 capabilities 注册)
├── command-registry/           ← 命令实现注册(字符串引用)
├── interaction-registries/     ← 5 大交互 Registry
│   ├── context-menu-registry/
│   ├── slash-registry/
│   ├── handle-registry/
│   ├── floating-toolbar-registry/
│   └── overlay-registry/        ← 通用浮层(帮助 / dialog 等)
├── nav-side-registry/          ← NavSide 内容注册
├── toolbar-registry/           ← Toolbar 内容注册
├── frame-bindings/             ← Registry 接入 Workspace 各 frame
├── triggers/                   ← 触发逻辑(右键 / Slash / hover / 选区)
└── diagnostics/                ← L4 自我诊断
```

**L4 阶段完成后用户能看到**:
- Application Menu 显示 V2 自己的菜单(取代 Electron 默认 File/Edit/View/Window)
- NavSide / Toolbar / 5 大交互浮层 frame 真正接入 Registry(注册内容时显示)
- 触发逻辑就位(右键检测 / Slash 输入检测 / 选区变化等)
- 但 Registry 默认空(等 L5 view 注册内容才有可见内容)
- console `[L4] alive`

---

## 2. V1 学习总结

### 2.1 V1 已有 Registry 盘点

| V1 文件 | 行数 | 用途 | V2 处理 |
|---|---|---|---|
| `src/main/menu/registry.ts` | 85 | Application Menu | 简化沿用,移到 `src/slot/menu-registry/` |
| `src/main/navside/registry.ts` | 45 | NavSide 内容(各 WorkMode 配置) | 沿用核心思路,改为按 view 注册(V2 取消 WorkMode) |
| `src/main/view/registry.ts` | 80+ | ViewType 注册 + WebContentsView 实例化 | 简化(去 WebContentsView,V2 单 BrowserWindow + React) |
| `src/main/workmode/registry.ts` | 37 | WorkMode | **取消**(charter § 1.4) |
| `src/main/protocol/registry.ts` | - | 自定义协议(media:// 等) | 留 L0 / 后续阶段(不在 L4 范围) |
| `src/plugins/note/registry.ts` | - | NoteView block registry | 业务领域,不在 L4 |
| 其他 plugin 内 registry | - | 业务领域 | 同上 |

### 2.2 V1 缺失的 Registry(V2 必须补)

V1 二次重构期**只定义了类型**(ui-primitives.ts)但**没有实现**:

| Registry | V1 状态 | V2 必做 |
|---|---|---|
| ContextMenuRegistry | 类型存在,无实现 | ✅ L4 实施 |
| SlashRegistry | 类型存在,无实现 | ✅ L4 实施 |
| HandleRegistry | 类型存在,无实现 | ✅ L4 实施 |
| FloatingToolbarRegistry | 类型存在,无实现 | ✅ L4 实施 |
| OverlayRegistry(通用浮层) | 完全没有 | ✅ L4 新增 |
| CommandRegistry | V1 commandRegistry.ts 38 行(空骨架) | ✅ L4 充实 |
| CapabilityRegistry | V1 二次重构期建了能力但无注册中心 | ✅ L4 新增 |
| ViewTypeRegistry(V2 风格) | V1 view/registry.ts 含 WebContentsView 实例化 | ✅ L4 简化(纯类型注册) |

### 2.3 V1 教训(必须避免)

#### 教训 1:Registry 散落各业务子目录

V1:menu/registry 在 main/,navside/registry 在 main/,plugin 内还有 N 个 registry,view/registry 又是 main/。

**问题**:加新插件时找不到该把 Registry 注册到哪。

**V2 改进**:**所有框架级 Registry 集中在 `src/slot/`**。L5 view 通过 install 列表 + 各 register* API 自动找到对应 Registry。

#### 教训 2:Registry 与 UI 渲染管线脱节

V1:menu/registry 接入了 macOS Application Menu(`Menu.setApplicationMenu`)。但 NavSide registry / 假想的 5 大交互 registry **没有接入到任何 React 组件**。

**问题**:即使 plugin 注册了 NavSide 内容,实际不会显示(除非 navside renderer.tsx 主动 import)。这是 V1 menuRegistry 工作但 navsideRegistry 半通电的根本原因。

**V2 改进**:`src/slot/frame-bindings/` 目录专门处理"Registry → Frame 渲染"的接入。每个 Registry 都有对应 frame binding,**保证注册即生效**。

#### 教训 3:缺乏统一触发机制

V1:右键菜单触发在 graph CanvasView 里 / Slash 触发在 NoteEditor 里 / hover 触发在 NoteEditor 里 — 各 view 各自实现。

**问题**:
- 加新 view 时要重新写一遍触发器(违反 view 极轻原则)
- 触发逻辑不一致(右键菜单在 GraphView 与 NoteView 行为略不同)

**V2 改进**:`src/slot/triggers/` 集中实现触发逻辑:
- `useContextMenuTrigger`:监听 Slot 内右键事件 → 查 ContextMenuRegistry → 显示 Frame
- `useSlashTrigger`:监听键盘输入 → 查 SlashRegistry → 显示 Frame
- 等等

view 通过 install 自动获得这些触发器,**view 不写触发逻辑**。

#### 教训 4:Application Menu 内容硬编码

V1 `app.ts` 内 60 行硬编码 menu 项(View 菜单 / DevTools 各 view 等)。

**问题**:加新 view 时改 app.ts(违反 charter § 1.2 注册原则)。

**V2 改进**:Application Menu 也走 menuRegistry,**view 注册自己的菜单项,app.ts 不知道**。

### 2.4 V1 可复用的部分

#### Registry 基础数据结构

V1 各 registry 都用 `Map<id, Registration>`,简单稳定。V2 沿用此模式。

#### menuRegistry 接 Application Menu 的方法

V1 `Menu.setApplicationMenu(Menu.buildFromTemplate(...))`,V2 沿用。

#### IPC 模式

V1 menu / navside 通过 IPC 暴露给 renderer。V2 也用 IPC(menuRegistry 在主进程,其他在 renderer)。

---

## 3. V2 slot 子目录设计

### 3.1 顶层结构

```
src/slot/
├── README.md
├── DESIGN.md(本文件)
├── view-type-registry/
│   ├── view-type-registry.ts        (ViewType 注册类)
│   ├── view-definition.ts           (ViewDefinition 类型)
│   ├── register-view.ts             (registerView API + 类型守卫)
│   └── README.md
├── capability-registry/
│   ├── capability-registry.ts       (Capability 注册类)
│   ├── capability-definition.ts     (Capability 类型 — 与 charter § 5.4 对齐)
│   ├── register-capability.ts       (registerCapability API)
│   └── README.md
├── command-registry/
│   ├── command-registry.ts          (CommandRegistry 类)
│   ├── command-handler.ts           (CommandHandler 类型)
│   └── README.md
├── interaction-registries/
│   ├── context-menu-registry/
│   │   ├── context-menu-registry.ts (类 + 注册 API)
│   │   ├── context-menu-types.ts    (ContextMenuItem 类型)
│   │   └── README.md
│   ├── slash-registry/(同结构)
│   ├── handle-registry/(同结构)
│   ├── floating-toolbar-registry/(同结构)
│   └── overlay-registry/(同结构,通用浮层)
├── nav-side-registry/
│   ├── nav-side-registry.ts
│   ├── nav-side-types.ts
│   └── README.md
├── toolbar-registry/
│   ├── toolbar-registry.ts
│   ├── toolbar-types.ts
│   └── README.md
├── menu-registry/                    ← Application Menu(macOS / Win/Linux)
│   ├── menu-registry.ts             (主进程,注册 + Menu.setApplicationMenu)
│   ├── menu-types.ts
│   └── README.md
├── frame-bindings/                   ← Registry → Frame 渲染接入
│   ├── nav-side-binding.tsx         (NavSideFrame 内消费 navSideRegistry)
│   ├── toolbar-binding.tsx          (ToolbarFrame 内消费 toolbarRegistry)
│   ├── context-menu-binding.tsx     (ContextMenuFrame 内消费 + 触发)
│   ├── slash-menu-binding.tsx
│   ├── handle-menu-binding.tsx
│   ├── floating-toolbar-binding.tsx
│   ├── overlay-binding.tsx
│   └── README.md
├── triggers/                         ← 集中触发逻辑(view 不写)
│   ├── use-context-menu-trigger.ts  (监听右键 → 显示 frame)
│   ├── use-slash-trigger.ts         (监听 / 输入 → 显示 frame)
│   ├── use-handle-trigger.ts        (监听 block hover)
│   ├── use-floating-toolbar-trigger.ts (监听选区变化)
│   └── README.md
└── diagnostics/
    └── L4-alive.ts                   (L4 自我诊断)
```

### 3.2 各子模块职责

#### `view-type-registry/`

```ts
// view-definition.ts
export interface ViewDefinition {
  /** view ID(命名反映能力组合,如 'note' / 'graph-canvas')*/
  id: string;
  /** install 的能力 ID 列表 */
  install: string[];
  /** 视图独有交互项(可选) — view 注册时拆分到对应 Registry */
  contextMenu?: ContextMenuItem[];
  toolbar?: ToolbarItem[];
  slash?: SlashItem[];
  handle?: HandleItem[];
  floatingToolbar?: FloatingToolbarItem[];
}

// view-type-registry.ts
class ViewTypeRegistry {
  private views: Map<string, ViewDefinition> = new Map();
  register(def: ViewDefinition): void { /* 拆分到对应 Registry */ }
  get(id: string): ViewDefinition | undefined;
  getAll(): ViewDefinition[];
}
```

注册时**自动拆分**:把 contextMenu / toolbar / 等子字段分发到对应 Registry,view 只调一次 `registerView({...})`。

#### `capability-registry/`

```ts
// capability-definition.ts
export interface CapabilityDefinition {
  id: string;
  /** 能力创建实例的工厂(L5 view 调用)*/
  createInstance?: (host: HTMLElement, options: unknown) => unknown;
  /** 能力暴露的命令(注册到 commandRegistry)*/
  commands?: Record<string, CommandHandler>;
  /** 能力的 schema 贡献 */
  schema?: unknown;
  /** 能力的转换器 */
  converters?: unknown;
}

// capability-registry.ts
class CapabilityRegistry {
  private capabilities: Map<string, CapabilityDefinition> = new Map();
  register(def: CapabilityDefinition): void;
  get(id: string): CapabilityDefinition | undefined;
  /** 给 view 创建实例(根据 install 列表)*/
  createInstancesForView(viewId: string): Map<string, unknown>;
}
```

#### `command-registry/`

```ts
// command-handler.ts
export type CommandHandler = (...args: unknown[]) => unknown;

// command-registry.ts
class CommandRegistry {
  private commands: Map<string, CommandHandler> = new Map();
  register(id: string, handler: CommandHandler): void;
  execute(id: string, ...args: unknown[]): unknown;  // 字符串引用执行
  has(id: string): boolean;
}
```

#### `interaction-registries/context-menu-registry/`

```ts
// context-menu-types.ts
export interface ContextMenuItem {
  id: string;
  label: string;
  command: string;          // 字符串引用 commandRegistry
  enabledWhen?: 'always' | 'has-selection' | 'is-editable';
  group?: string;
  order?: number;
  /** 关联的 view(只在该 view 内显示)*/
  view?: string;
}

// context-menu-registry.ts
class ContextMenuRegistry {
  private items: ContextMenuItem[] = [];
  register(items: ContextMenuItem[]): void;
  /** 按当前活跃 view + 选区状态过滤 */
  getItemsForContext(viewId: string, context: ContextInfo): ContextMenuItem[];
  subscribe(listener: () => void): () => void;
}
```

其他 4 大交互 Registry 同模式。

#### `nav-side-registry/`

```ts
// nav-side-types.ts
export interface NavSideContent {
  /** 关联 view(只在该 view active 时显示) */
  view: string;
  /** 标题 */
  title: string;
  /** action 按钮 */
  actions?: Array<{ id: string; label: string; command: string }>;
  /** 内容渲染器(React 组件)— 由能力提供 */
  contentRenderer: () => React.ReactElement;
}

class NavSideRegistry {
  register(content: NavSideContent): void;
  getContentForView(viewId: string): NavSideContent | undefined;
}
```

#### `toolbar-registry/` 同模式

#### `menu-registry/`(主进程)

```ts
// menu-types.ts
export interface MenuRegistration {
  id: string;
  label: string;
  order: number;
  items: MenuItem[];
}

export interface MenuItem {
  id: string;
  label: string;
  command?: string;             // 引用 commandRegistry
  accelerator?: string;
  separator?: boolean;
  submenu?: MenuItem[];
}

// menu-registry.ts(主进程)
class MenuRegistry {
  private menus: MenuRegistration[] = [];
  register(reg: MenuRegistration): void;
  rebuild(): void {
    // 按 order 排序 + Menu.setApplicationMenu(Menu.buildFromTemplate(...))
  }
}
```

#### `frame-bindings/`(关键 — V2 vs V1 改进)

每个 Registry 对应一个 binding,负责把 Registry 内容渲染到 Workspace 的对应 frame:

```tsx
// nav-side-binding.tsx
export function NavSideBinding({ viewId }: { viewId: string }) {
  const content = useNavSideContent(viewId);   // 订阅 navSideRegistry
  if (!content) return null;
  return (
    <div>
      <h3>{content.title}</h3>
      <div className="actions">
        {content.actions?.map((a) => (
          <button key={a.id} onClick={() => commandRegistry.execute(a.command)}>
            {a.label}
          </button>
        ))}
      </div>
      <content.contentRenderer />
    </div>
  );
}
```

**重要**:NavSideFrame 内 mount NavSideBinding,Registry 注册即生效。

#### `triggers/`(集中触发逻辑)

```ts
// use-context-menu-trigger.ts
export function useContextMenuTrigger(slotRef: RefObject<HTMLElement>, viewId: string) {
  useEffect(() => {
    const el = slotRef.current;
    if (!el) return;
    const handler = (e: MouseEvent) => {
      e.preventDefault();
      const items = contextMenuRegistry.getItemsForContext(viewId, getContextInfo(e));
      // 显示 ContextMenuFrame
      showContextMenu(items, { x: e.clientX, y: e.clientY });
    };
    el.addEventListener('contextmenu', handler);
    return () => el.removeEventListener('contextmenu', handler);
  }, [slotRef, viewId]);
}
```

view 自动获得这些触发器(由 Slot Area 在 mount view 时调用),**view 不写**。

#### `diagnostics/L4-alive.ts`

```ts
export function reportL4Alive(): void {
  window.electronAPI.reportAlive({
    layer: 'L4',
    details: {
      registries: 'menu,navside,toolbar,5大交互,viewType,capability,command',
      'frame-bindings': 'nav-side,toolbar,context-menu,slash,handle,floating-toolbar,overlay',
    },
  });
}
```

---

## 4. V1 → V2 改进对比表

| 维度 | V1 | V2 |
|---|---|---|
| Registry 集中度 | 散落 main/ + plugin/ + shared/ | **集中 src/slot/** |
| 5 大交互 Registry | 类型存在,无实现 | **L4 全部实施** |
| CommandRegistry | 空骨架 | **真实实施 + 字符串引用执行** |
| CapabilityRegistry | 无 | **L4 新增** |
| OverlayRegistry(通用浮层) | 无 | **L4 新增** |
| Application Menu | app.ts 硬编码 60+ 行 | **Registry 注册,app.ts 不知道菜单内容** |
| Registry → UI 接入 | 散落 / 半通电 | **frame-bindings 统一接入,注册即生效** |
| 触发逻辑 | 各 view 自己实现 | **slot/triggers 集中,view 自动获得** |
| 加新 view | 改 app.ts + 改各业务 registry | **view 一行 install 列表 + register 自动生效** |

---

## 5. 调用关系(纵向架构验证)

```
L5 view(声明)
    ↓ registerView({ install: [...], contextMenu: [...], toolbar: [...], ... })
L4 ViewTypeRegistry
    ↓ 自动拆分
├─ ContextMenuRegistry(注册子项)
├─ ToolbarRegistry
├─ ...
└─ install 列表 → CapabilityRegistry.createInstancesForView()

L4 frame-bindings(订阅 Registry)
    ↓ 渲染到
L3 Workspace 各 frame(NavSideFrame / ToolbarFrame / ContextMenuFrame / ...)

L4 triggers(集中触发器)
    ↓ Slot Area 内 view mount 时绑定
监听 DOM 事件(右键 / Slash / hover / 选区)
    ↓ 触发显示
L3 frame(渲染 Registry 内容)
```

---

## 6. L4 阶段实施目标

### 6.1 完成判据(charter § 6.3 + L4 特定)

- [ ] `npm start` 跑得起来(L0~L3 不回归)
- [ ] **Application Menu 显示 V2 自己的菜单**(取代 Electron 默认 File/Edit/View/Window)
  - 至少:File / Edit / View / Window / Help 5 个顶级菜单
  - View 菜单含 "Toggle NavSide"(快捷键 Cmd+\\)
- [ ] Registry 都就位(空但可注册)
- [ ] frame-bindings 都就位(订阅 Registry,无内容时显示空)
- [ ] triggers 都就位(右键 / Slash 等触发,Registry 空时不显示)
- [ ] 测试注册一个 contextMenu 项 → 在 Slot 内右键真的显示菜单
- [ ] console `[L4] alive | registries: ..., frame-bindings: ...`
- [ ] 健康检查 IPC `health.L4` 返回 alive

### 6.2 实施清单(预估 ~50 文件)

#### Registry 类(8 个 Registry × 平均 3 文件 = ~24 文件)
- view-type-registry/(3)
- capability-registry/(3)
- command-registry/(2)
- interaction-registries/(5 × 3 = 15)
- nav-side-registry/(2)
- toolbar-registry/(2)
- menu-registry/(2,主进程)

#### frame-bindings/(7 文件)
- nav-side-binding / toolbar-binding / 5 大交互 binding

#### triggers/(5 文件)
- 4 大交互触发器(Toolbar 不需要触发,常驻显示)+ README

#### diagnostics/(1 文件)
- L4-alive.ts

#### shared/ipc + 平台扩展
- 加 HEALTH_L4 channel
- 主进程 menu-registry 扩展 IPC handler

#### Workspace frame 接入(修改 7 个 frame)
- NavSideFrame mount NavSideBinding
- ToolbarFrame mount ToolbarBinding
- 5 个 OverlayFrame mount 对应 binding

#### app.ts 入口扩展
- 注册框架级 Application Menu(File / Edit / View / Window / Help)

### 6.3 不做的事(L4 范围严格)

- ❌ 任何 view 实现(L5)
- ❌ 任何 capability 实现(L5)
- ❌ 业务 npm 包

### 6.4 自我诊断输出预期

```
[L0] alive | electron: ...
[L1] alive | window id: 1, ...
[L2] alive | shell: rendered, ...
[L3] alive | workspaces: 1, active: 'ws-1'
[L4] alive | registries: 8, frame-bindings: 7
```

---

## 7. 与 charter 原则的对照

| charter 原则 | L4 如何遵守 |
|---|---|
| § 1.1 分层 | L4 仅做 Registry 基础设施,不超越 L3(Workspace)/ L5(view) |
| **§ 1.2 注册原则** | **L4 是注册原则的物理落地** — view 通过 register* API 注册,Registry 集中管理 |
| § 1.3 抽象原则(npm 屏障) | L4 不 import 业务 npm,只用 react / lucide-react / 等白名单 |
| **§ 1.4 视图与实现归属** | L4 实现 frame-bindings,让"应用级 UI 在 Workspace,内容由 Registry 注册"物理生效 |
| § 5 自我诊断 | `[L4] alive` IPC 上报 |
| § 6 节奏规则 | L4 一阶段做完(选项 A 严格)+ 不留技术债 |

---

## 8. 待拍板

### Q1:Registry 实现位置(主进程 vs renderer)

- **A**: 大部分 Registry 在 renderer(单页应用风格,与 L3 一致),只有 menu-registry 在主进程(因为 macOS Application Menu 是主进程 API)
- **B**: 全部 Registry 在主进程,renderer 通过 IPC 操作(V1 风格)

我推荐 **A**(渲染层 Registry 在 renderer,与 React useSyncExternalStore 自然衔接)。

### Q2:Application Menu 内容

L4 阶段填什么菜单项(框架级,各 view 注册自己的留 L5):

- **A**: 最小集 — File / Edit / View / Window / Help,只填能立即生效的(如 View → Toggle NavSide / DevTools)
- **B**: 完整集 — 含 V1 全部菜单(About / 重置数据库 / 文档导入 等)
- **C**: 跳过 Application Menu(暂留 Electron 默认),后续阶段加

我推荐 **A**(最小集,L5 view 注册时自己加自己的菜单项)。

### Q3:frame-bindings 是否在 L4 全部实施?

- **A**: 全部 7 个 binding 实施(Registry + binding 一起做,L5 view 注册立即生效)
- **B**: 只实施 NavSide / Toolbar binding(L5 NoteView 必需),5 大交互浮层 binding 留 L5
- **C**: 全部 binding 但都是空壳(L5 view 注册时再补)

我推荐 **A**(L4 一次做完不留技术债,L5 view 注册立即可见)。

### Q4:triggers 实施粒度

- **A**: 4 大交互触发器都实施(useContextMenuTrigger / useSlashTrigger / useHandleTrigger / useFloatingToolbarTrigger)
- **B**: 只实施 ContextMenu trigger(右键最普遍),其他留 L5
- **C**: 全部实施但都是占位(L5 view 真用时调试)

我推荐 **A**(charter § 1.4 view 极轻 — view 不应该写触发逻辑)。

### Q5:CapabilityRegistry 范围

- **A**: 完整实现(register / get / createInstancesForView 等所有 API)
- **B**: 最小集(register + get,createInstancesForView 留 L5 真用时实施)

我推荐 **B**(避免过度设计,view 实际 install 时再具体)。

### Q6:菜单触发位置

L5 NoteView install 'text-editing' 后,text-editing capability 想注册菜单项 → 注册到 ContextMenuRegistry?

按 charter § 1.2 + § 1.4,**capability 也可以注册菜单项**(命令实现 + 菜单项一起注册)。但**菜单项的 view 字段**指向哪?

- **A**: capability 注册时不指定 view(全局),frame-binding 渲染时按当前活跃 view 过滤
- **B**: capability 注册时**接收 view 参数**(view 通过 install 时把自己的 viewId 传给 capability)
- **C**: 不允许 capability 直接注册菜单项,view 在自己的 register 函数里处理

我推荐 **A**(capability 不知道 view,view 通过 install 自动获得菜单)。

---

## 9. 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-05-05 | v0.1 | 初稿;V1 学习(7 个已有 Registry + 8 个缺失 Registry)+ 4 条 V1 教训(Registry 散落 / UI 脱节 / 触发分散 / Menu 硬编码)+ V2 子目录设计(8 类 Registry + frame-bindings + triggers + diagnostics)+ 50 文件实施清单 + 6 个待拍板 |
