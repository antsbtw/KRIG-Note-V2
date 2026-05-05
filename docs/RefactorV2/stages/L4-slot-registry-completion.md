# L4 Slot Registry 阶段完成报告

> 阶段:L4 Slot Registry 基础设施(8 Registry + frame-bindings + framework Application Menu)
> 分支:`feature/L4-slot-registry`
> 完成日期:2026-05-05

---

## 1. 完成判据核对(charter § 6.3 + L4 特定)

| # | 判据 | 状态 | 验证方式 |
|---|---|---|---|
| 1 | `npm start` 跑得起来(L0~L3 不回归) | ✅ | electron-forge 启动通过,Workspace UI 仍正常 |
| 2 | **Application Menu 显示 V2 自己的菜单**(取代 Electron 默认) | ✅ | macOS top bar 显示 KRIG Note V2 / File / Edit / View / Window / Help |
| 3 | 8 类 Registry 都就位(空但可注册) | ✅ | command / capability / view-type / 5 interaction / nav-side / toolbar / menu |
| 4 | 7 个 frame-bindings 都就位(订阅 Registry,空时不渲染) | ✅ | NavSide / Toolbar / 5 OverlayBinding 全部挂在对应 frame |
| 5 | 4 大触发器到位(controller + 完整 hook 至少一条) | ✅ | 4 controller + use-context-menu-trigger 完整实现,其余 hook 等 capability 真用时再写 |
| 6 | console 输出 `[L4] alive | commands: N, capabilities: 0, views: 0, ...` | ✅ | 用户实测确认 |
| 7 | 健康检查 IPC `health.L4` 返回 alive | ✅ | preload 已暴露 L4 channel + 主进程聚合 |
| 8 | typecheck + lint 全过 | ✅ | `npm run typecheck` / `npm run lint` 皆通过 |

**总评**:**通过**(8 条全 ✅)。

---

## 2. 该阶段实施的具体内容

### 2.1 工程脚手架扩展(IPC + 类型)

| 文件 | 变更 |
|---|---|
| `src/shared/ipc/channel-names.ts` | 加 `HEALTH_L4` |
| `src/shared/ipc/electron-api.d.ts` | health 类型加 'L4' |
| `src/platform/main/ipc/health-check.ts` | 加 L4 + 平台聚合 L4 |
| `src/platform/main/preload/main-window-preload.ts` | health 加 L4 channel |

### 2.2 渲染进程 Registry(7 类,~24 文件)

| 模块 | 文件 | 职责 |
|---|---|---|
| `command-registry/` | command-registry.ts + command-handler.ts + README | 命令注册中心(register / execute / has / get) |
| `capability-registry/` | capability-registry.ts + capability-definition.ts + README | 能力注册(Q5=B 极简 — register / get / has,自动把命令挂到 commandRegistry) |
| `view-type-registry/` | view-type-registry.ts + view-definition.ts + register-view.ts + README | 视图类型注册;`registerView` 自动把 ViewDefinition 中的 contextMenu / toolbar / slash / handle / floatingToolbar 子字段(各加 `view: def.id`)分发到对应 Registry |
| `interaction-registries/context-menu-registry/` | registry + types + README | ContextInfo + enabledWhen 求值 |
| `interaction-registries/slash-registry/` | registry + types + README | query 过滤 |
| `interaction-registries/handle-registry/` | registry + types + README | blockType 过滤 |
| `interaction-registries/floating-toolbar-registry/` | registry + types + README | group 过滤 |
| `interaction-registries/overlay-registry/` | registry + types + README | show / hide active state |
| `nav-side-registry/` | registry + types + README | NavSide 内容(title / actions / contentRenderer) |
| `toolbar-registry/` | registry + types + README | view-scoped Toolbar items |

### 2.3 主进程 Registry(menu)

| 文件 | 职责 |
|---|---|
| `src/slot/menu-registry/menu-registry.ts` | 命令字符串引用 + `rebuild()` → `Menu.setApplicationMenu`;支持 `registerRoleMenu` 复用 Electron role |
| `src/slot/menu-registry/menu-types.ts` | MenuDefinition / MenuItem 类型 |
| `src/platform/main/menu/framework-menus.ts`(新建) | 框架级 Application Menu — 注册 `app.quit` / `window.minimize` / `window.close` / `view.devtools.toggle` / `view.reload` / `help.about` 6 个命令,组装 macOS App / File / Edit(role='editMenu')/ View / Window / Help |

### 2.4 frame-bindings(7 文件 + use-registry + CSS)

| 文件 | 职责 |
|---|---|
| `frame-bindings/use-registry.ts` | useSyncExternalStore hooks。**关键:只订阅稳定引用**(Map.get)**或版本计数器**(.count),避开 array snapshot 引发的 Maximum update depth 死循环(L3 教训) |
| `NavSideBinding.tsx` | 订阅 navSideRegistry,渲染 title + actions + contentRenderer |
| `ToolbarBinding.tsx` | 订阅 toolbarRegistry 版本号,渲染时 `getItemsForView` 过滤 |
| `ContextMenuBinding.tsx` | 订阅 contextMenuController,position 用 state.x/y |
| `SlashMenuBinding.tsx` / `HandleMenuBinding.tsx` / `FloatingToolbarBinding.tsx` | 同模式 — 订阅 controller + 渲染浮层 |
| `OverlayBinding.tsx` | 订阅 overlayRegistry active set,view-scoped 过滤 |
| `frame-bindings/overlay-bindings.css` | 5 类浮层统一样式(position / shadow / z-index 等) |
| `frame-bindings/README.md` | 模块说明 |

### 2.5 triggers(controller pattern,9 文件)

| 文件 | 类型 |
|---|---|
| `triggers/context-menu-controller.ts` | controller(show / hide / state) |
| `triggers/slash-menu-controller.ts` | controller |
| `triggers/handle-menu-controller.ts` | controller |
| `triggers/floating-toolbar-controller.ts` | controller |
| `triggers/use-context-menu-trigger.ts` | **完整 hook** — mousedown / keydown 监听,**有 Registry 命中时才 preventDefault** 默认 contextmenu |
| `triggers/use-slash-trigger.ts` / `use-handle-trigger.ts` / `use-floating-toolbar-trigger.ts` | 占位 controller 重新导出(完整逻辑等 capability 落地补) |
| `triggers/README.md` | 说明 |

**取舍**:Q4=A 4 条触发器都到位,但实际只把 ContextMenu 触发器写完;其他 3 条留 controller 接口,等 L5 capability 真用时一次成型,不强行写无内容的 wrapper。

### 2.6 diagnostics(1 文件)

`src/slot/diagnostics/L4-alive.ts`:IPC 上报到主进程 diagnostics-bus,details 含 10 个 Registry 计数。

### 2.7 Workspace 7 frame 接入 binding(9 文件修改)

| 文件 | 改造 |
|---|---|
| `WorkspaceInstance.tsx` | 计算 `activeViewId = state.slotBinding.left ?? state.slotBinding.right ?? null`,传给 NavSide / Toolbar / OverlayFrames |
| `nav-side-frame/NavSideFrame.tsx` | 接 viewId,内部 mount NavSideBinding |
| `toolbar-frame/ToolbarFrame.tsx` | 接 viewId,mount ToolbarBinding |
| `overlay-frames/index.tsx` | 接 viewId,转发给 GenericOverlayFrame |
| `overlay-frames/ContextMenuFrame.tsx` | mount ContextMenuBinding |
| `overlay-frames/SlashMenuFrame.tsx` | mount SlashMenuBinding |
| `overlay-frames/HandleMenuFrame.tsx` | mount HandleMenuBinding |
| `overlay-frames/FloatingToolbarFrame.tsx` | mount FloatingToolbarBinding |
| `overlay-frames/GenericOverlayFrame.tsx` | mount OverlayBinding(传 viewId) |

### 2.8 platform/main/index.ts(L4 启动)

- `app.whenReady` → `initIpcBus()` 之后调 `registerFrameworkMenus()`
- 替换 Electron 默认 Application Menu

### 2.9 platform/renderer/index.tsx(L4 启动)

- 加 `import { reportL4Alive } from '@slot/diagnostics/L4-alive'`
- 启动末尾加 `reportL4Alive()`

### 2.10 引入的 npm 依赖

**0 处新增 npm 依赖**(L4 完全用 react / electron 内置 Menu / 已有项目依赖)。

---

## 3. 自我诊断输出样本

主进程终端 console:
```
[L0] alive | electron: 40.9.3, node: 24.14.1, platform: darwin, ready: true
[L1] alive | window id: 1, size: 1200x800
[L2] alive | shell: rendered, components: workspace-bar + workspace-container
[L3] alive | workspaces: 1, active: ws-1
[L4] alive | commands: 6, capabilities: 0, views: 0, contextMenu: 0, slash: 0, handle: 0, floatingToolbar: 0, overlay: 0, navSide: 0, toolbar: 0
```

`commands: 6` = framework-menus 注册的 6 个框架命令(app.quit / window.minimize / window.close / view.devtools.toggle / view.reload / help.about)。
其他 9 个 Registry 全 0(L5 view 注册时才填)。

renderer DevTools console:
```
[Renderer] alive | renderer process started
```

健康检查 IPC(DevTools):
```js
> await window.electronAPI.health('L4')
{ alive: true, since: ..., errors: [], details: { commands: 6, capabilities: 0, ... } }
```

Application Menu(macOS top bar):
```
KRIG Note V2 | File | Edit | View | Window | Help
                              ^Reload (Cmd+R)
                              ^Toggle Developer Tools (Cmd+Alt+I)
```

---

## 4. 阶段中遇到 / 解决的问题

### 4.1 useSyncExternalStore 订阅 Registry 引发 Maximum update depth(预防性设计)

**背景**:L3 阶段 WorkspaceManager.getAll() 返回新数组导致死循环,加 cachedAll 缓存修复(commit `c54243a`)。

**L4 应对**:`frame-bindings/use-registry.ts` 注释中明确教训,设计上**只订阅稳定引用**:
- 订阅 Map.get(id) — 数据未变同一引用
- 订阅 .count — 版本计数器,数字稳定
- **不订阅 array snapshot**(每次返回新数组必死)

实施过程未再触发该 bug。

### 4.2 capability-registry 范围:Q5 = B 极简

按 Q5=B 拍板,capabilityRegistry 只实现 register / get / has / count / getAll,**不实现 createInstancesForView**。view 真用时(L5)再补,避免过度设计。

副作用:`registerCapability` 把 capability 的 commands 自动挂到 commandRegistry(教训:V1 命令实现散落各业务子目录,V2 强制走 commandRegistry)。

### 4.3 framework-menus 命令字符串引用(V1 vs V2 改进)

**V1 教训**(DESIGN § 2.3 教训 4):app.ts 60+ 行硬编码菜单,callback 直接写在 menu item 里,改菜单要改主进程代码。

**V2 实施**:
- menu item 用 `command: 'app.quit'` 字符串引用
- menuRegistry 内部查 commandRegistry 执行
- 菜单结构与命令实现解耦,L5 view 可独立加自己的命令 + 菜单项

### 4.4 触发器实施粒度的取舍

DESIGN Q4=A 拟定"4 大触发器都实施",实施时发现 Slash / Handle / FloatingToolbar 触发器**强依赖具体 capability 的输入捕获方式**(slash 触发要监听编辑器 input,handle 要算 block 边界,floating-toolbar 要听 selection change)— 没有 capability 落地时强行写 wrapper 反而限制 L5 设计。

**调整**:4 个 controller(show/hide/state)全到位,只把 use-context-menu-trigger 写完(右键最普遍,逻辑独立);其余 3 条 hook 留接口,L5 capability 真用时一次成型。

**取舍记录**:不算技术债 — 接口完整,只是延后实现细节。

---

## 5. 关键决策落地(charter § 1.4 + 用户拍板)

### 5.1 Q1 = A:Registry 实现位置

大部分 Registry 在 renderer(与 useSyncExternalStore 自然衔接),只有 menu-registry 在主进程(macOS Menu 是主进程 API)。

### 5.2 Q2 = A:Application Menu 最小集

File / Edit(role)/ View / Window / Help 5 顶级菜单,只填能立即生效的(View → Reload + Toggle DevTools)。各 view 留 L5 注册自己的菜单项。

### 5.3 Q3 = A:7 个 frame-bindings 全部实施

NavSide / Toolbar / 5 OverlayBinding 一次做完,L5 view 注册立即可见。

### 5.4 Q4 = A(部分):4 大触发器架构到位

4 controller + ContextMenu 完整 hook;其余 hook 占位,见 § 4.4。

### 5.5 Q5 = B:CapabilityRegistry 极简

只 register / get / has,createInstancesForView 等 L5 view 真用时再补。

### 5.6 Q6 = A:capability 注册菜单不带 view

capability 注册 contextMenu / slash 等不指定 view,frame-binding 渲染时按当前活跃 view 过滤(viewTypeRegistry.registerView 自动加 view 字段)。

---

## 6. V1 → V2 改进对比验证

按 [src/slot/DESIGN.md v0.1 § 4](../../../src/slot/DESIGN.md):

| 维度 | V1 | V2 实际 | 验证 |
|---|---|---|---|
| Registry 位置 | 散落各业务子目录(menuRegistry / blockRegistry / 等) | **集中在 src/slot/**(8 类 Registry 一处) | ✅ |
| Registry 与 UI 渲染管线 | 脱节(注册数据但 React 树不订阅) | **frame-bindings 强绑定**(useSyncExternalStore) | ✅ |
| Registry 类型完备性 | ContextMenu / Slash / Handle / FloatingToolbar / Overlay 都缺 | **5 大交互 Registry 全到位** | ✅ |
| 触发逻辑 | 散落 view 内部(每个 view 自己写 mousedown / keydown) | **集中 src/slot/triggers/**(controller pattern) | ✅ |
| Application Menu | 主进程 60+ 行硬编码 | **menu-registry 注册制**(命令字符串引用) | ✅ |
| 命令实现 | 散落业务模块 | **强制走 commandRegistry**(capability 注册自动挂上) | ✅ |
| view 注册子字段 | 无统一机制 | **registerView 自动分发**(contextMenu / toolbar / slash / handle / floatingToolbar 加 `view: def.id` 进对应 Registry) | ✅ |
| useSyncExternalStore 死循环风险 | N/A(V1 不用) | **设计层面规避**(只订阅稳定引用 / 计数器) | ✅ |

**全 ✅**(8 维度全改进达成)。

---

## 7. 与 charter § 1.4 视图与实现归属的对照

| § 1.4 规则 | 本阶段如何遵守 |
|---|---|
| 应用级 UI 在 Workspace Container(L3) | ✅ NavSide / Toolbar / 5 大交互浮层 frame **仍在 Workspace**(L4 只接 binding) |
| 能力 UI 在 Capability(L4) | ✅ L4 只做 Registry / binding,**不实现任何能力 UI** |
| View 是能力组合声明(L5) | ✅ L4 不实现任何 view |
| view 平等,无 variant | ✅ Registry 没有 variant 字段,frame-bindings 不读 variant |
| view 文件极轻 | ✅ registerView 自动分发子字段,**view 文件只声明,不写注册逻辑** |

L4 阶段严格遵守 § 1.4,**未越界**。

---

## 8. 下一层(L5)的衔接条件

L4 完成后,L5 阶段(NoteView 第一个真实 view)需要的前置条件:

- ✅ 8 类 Registry 都就位(L5 view 调 register* API 即可)
- ✅ 7 个 frame-bindings 都就位(注册即渲染)
- ✅ 4 controllers 就位(L5 capability 调 controller.show 即触发浮层)
- ✅ commandRegistry 就位(L5 capability 注册命令立即可被菜单引用)
- ✅ Application Menu 框架级菜单就位(L5 view 加自己菜单项)
- ✅ pluginStates 字典(L3 已就位,L5 view 状态自管)

**当前状态**:**可直接进入 L5 阶段**。

下一阶段建议分支:`feature/L5-note-view`(charter § 1.4 — view 是能力组合声明)。

L5 范围:
- NoteView 实例(install: text-editing / block-rendering / 等 capability 列表)
- 至少 1 个 capability 实现(text-editing 最小集)
- L5 alive 诊断:view 实例数 + 各 view 装的 capability 列表

---

## 9. 遗留问题 / 待优化项

### 9.1 Slash / Handle / FloatingToolbar trigger hook 完整实现
**状态**:controller 接口到位,完整 hook 等 L5 capability 真用时补。
**说明**:不算债,见 § 4.4 取舍说明。

### 9.2 应用图标显示 Electron 默认
**状态**:✅ 已修(`feature/L4-fix-menu-dock`,见 § 12 后续修复)。

### 9.3 窗口尺寸 / 位置持久化
**状态**:未做(留后续)。

### 9.4 dividerRatio 拖拽现 L4 仍测不到
**现象**:slotBinding.right 仍 null,看不到 Divider。
**处理**:留 L5 view 注册到 right slot 时验证。

### 9.5 NavSide 拖拽改宽度
**现象**:WorkspaceState 有 `navSideWidth` 字段但无 Resizer 组件。
**处理**:留 L5 NavSide 内容注册时一并加。

### 9.6 capabilityRegistry.createInstancesForView
**状态**:Q5=B 拍板未做。
**处理**:留 L5 view 真 install capability 时实施。

---

## 10. 提交清单

| Commit | 说明 |
|---|---|
| `4b9f2a7` | docs(slot): L4 设计文档 v0.1(预先) |
| `d5461f7` | feat(L4-slot-registry): L4 完整实施 — 8 Registry + frame-bindings + framework menu(70 文件:56 新建 + 9 修改 + 5 平台修改) |
| `9e7b64a` | Merge feature/L4-slot-registry → main |

---

## 11. 进入 L5 阶段的前置条件

L4 完成后:
- ✅ 8 类 Registry 全就位(view-type / capability / command / 5 interaction / nav-side / toolbar / menu)
- ✅ 7 frame-bindings 全就位(NavSide / Toolbar / 5 Overlay binding)
- ✅ 4 controllers 就位(context-menu / slash / handle / floating-toolbar)
- ✅ Framework Application Menu 就位(替换 Electron 默认)
- ✅ commandRegistry + 6 个框架命令(app.quit / window.* / view.* / help.*)
- ✅ HEALTH_L4 IPC + L4-alive 诊断
- ✅ ESLint 屏障(slot 不 import views / capability,继续守界)

**下一阶段实施分支建议**:`feature/L5-note-view`。

L5 范围(charter § 1.4 view 是能力组合声明):
- NoteView 第一个真实 view(install capability list)
- 至少 1 个 capability 完整实现(text-editing 最小集)
- 验证:view 注册后 NavSide / Toolbar / ContextMenu 真实出现内容
- L5 alive 诊断

---

## 12. 后续修复(L4 阶段后追加)

### 12.1 feature/L4-fix-navside(2026-05-05 合并)

合并 commit:`1f98db5`

**修复内容**:
- ViewSwitcher(Logo + view tab 条 + searchPlaceholder)— L4 设计漏掉的 NavSide 三段架构
- WorkspaceInstance 挂 ContextMenu trigger(选项 A — 4 大触发器统一在 Workspace 根 DOM)
- 4 大 menu 浮层 viewport 边界碰撞检测(`useCollisionPosition`,flip + clamp)

**对应 commit**:`8063e37` / `bc4c2f8` / `8c7d81d`

### 12.2 feature/L4-fix-menu-dock(2026-05-05 合并)

合并 commit:`fd90ac9`

**修复内容**:
- macOS 应用菜单首项 'Electron' → 'KRIG Note'(postinstall 钩子改 Electron.app 的 Info.plist `CFBundleName`,V1 同款 trick)
- Dock 图标 → KRIG logo(替换 Electron.app 的 `electron.icns`)
- About / Quit / 窗口标题 / `package.json` `productName` / `forge.config` `name` `executableName` `icon` 全部对齐 'KRIG Note'
- 资源:`docs/logo.png`(1024×1024)+ `build/icon.png`(dev dock)+ `build/icon.icns`(prod 包用)
- `scripts/patch-electron-dev.sh` + `package.json` `postinstall` 钩子(`npm install` 自动运行)

**关键学习**:macOS 应用菜单首项粗体名取自 `Info.plist` 的 `CFBundleName`,**`app.setName()` 改不了**。dev mode 必须直接 patch `node_modules/electron/dist/Electron.app/Contents/Info.plist`。

**对应 commit**:`40360b3` / `df9b669`

### 12.3 ViewDefinition 字段扩展(L3.5 顺手加)

L3.5 阶段为支持 SlotArea 按 viewId 缓存机制,`ViewDefinition` 加 `component?: ComponentType<ViewComponentProps>` 字段(L5 view 注册时填)。详见 [L3.5 完成报告](./L3.5-workspace-bus-completion.md) § 2.5。
