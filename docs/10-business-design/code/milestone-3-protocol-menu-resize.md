# 里程碑 3 — 协同协议 + Application Menu + NavSide 拖拽

:::callout[NOTE]
**目标**：完善框架层能力——协同协议匹配引擎、全局稳定的 Application Menu、NavSide 宽度可拖拽。
同时引入 APP_CONFIG 配置化和应用品牌定制。
:::

---

:::toggle-heading[## 一、协同协议注册表 + 匹配引擎]

### 解决什么问题

里程碑 2 的消息路由是无条件转发的——只要 Left 和 Right 都有 View，消息就能发。但按架构设计（view-protocol.md），应该只有注册了协议的 View 组合才允许通信。

### 宽松模式

框架只管"这两个 View 之间**是否允许通信**"，不检查消息内容：

- 有协议 → 所有 message 都转发（不看 protocol/action/payload）
- 无协议 → 所有 message 都丢弃

**为什么选宽松模式**：框架要坚持 View 驱动模式。message 的内容决定了 Right Slot 的显示和行为，这是 View 自己的事，框架不应该检查。

### 核心代码（main/protocol/registry.ts）

```typescript
class ProtocolRegistry {
  private protocols: ProtocolRegistration[] = [];

  register(registration: ProtocolRegistration): void;

  // 匹配：(Left.type+variant, Right.type+variant) → 协议 id 或 null
  match(left: ViewIdentity, right: ViewIdentity): string | null;
}
```

### 消息路由变化（main/ipc/handlers.ts）

```typescript
ipcMain.on(IPC.VIEW_MESSAGE_SEND, (event, message) => {
  // 协议匹配检查
  const activeProtocol = getActiveProtocol();
  if (activeProtocol === null) return; // 未匹配 = 不转发

  // ... 路由到对面 View
});
```

### Demo 验证

```typescript
// app.ts 中注册
protocolRegistry.register({
  id: 'demo-sync',
  match: { left: { type: 'note' }, right: { type: 'pdf' } },
});
// note + web 不注册 → 消息被丢弃
```

- Demo A (note) + Demo B (pdf)：Ping 消息**能**通信 ✅
- Demo A (note) + Demo C (web)：Ping 消息**不能**通信 ✅

### 设计原则关联

- **默认 none**（view-protocol.md §六.1）：未注册的组合一律无协同
- **框架不理解消息内容**（view-protocol.md §一.4）：只看是否有协议，不看 payload
- **注册制**（view-protocol.md §六.5）：协议通过注册声明

:::

:::toggle-heading[## 二、Application Menu 注册机制]

### 解决什么问题

实现 macOS 菜单栏的注册机制，所有 Menu 和 MenuItem 通过注册注入，零硬编码。

### 关键设计决策：全局稳定

最初设计是按 WorkMode 动态显示/隐藏菜单。经过讨论后改为**全局稳定**：

**为什么不动态**：
- 多 Workspace Tab 时，菜单跟着哪个？——混乱
- 双栏时，Left 是 Note 右是 PDF，菜单显示哪个？——更混乱
- 用户期望菜单栏告诉"这个应用能做什么"，不是"当前面板能做什么"

**改后方案**：所有菜单始终显示，菜单项通过 `enabled` 动态启用/禁用。

### 接口（shared/menu-types.ts）

```typescript
interface MenuRegistration {
  id: string;
  label: string;         // 菜单标题
  order: number;          // 排列顺序
  items: MenuItemRegistration[];
}

interface MenuItemRegistration {
  id: string;
  label: string;
  accelerator?: string;   // 快捷键（如 'CmdOrCtrl+S'）
  separator?: boolean;
  enabled?: boolean;
  handler: () => void;
}
```

不再有 `category` 和 `workModeId`。

### 注册表（main/menu/registry.ts）

```typescript
class MenuRegistry {
  register(registration: MenuRegistration): void;
  rebuild(): void;  // 构建 Electron Menu 并应用
}
```

`rebuild()` 只在应用启动时调用一次（全局稳定，不需要重建）。

### 当前注册的菜单

| 菜单 | 内容 | 快捷键 |
|------|------|--------|
| Edit | Undo/Redo/Cut/Copy/Paste/Select All | 标准 |
| View | Toggle NavSide, Developer Tools | Cmd+\, Cmd+Alt+I |
| Note | New Note, Save, Export Markdown | Cmd+N, Cmd+S |
| PDF | Open PDF, Add Bookmark | Cmd+O, Cmd+D |
| Web | Back, Forward, Extract Page | Cmd+[, Cmd+] |
| Window | Minimize, Close Window | Cmd+M, Cmd+W |
| Help | About, Keyboard Shortcuts | — |

### 跨平台

- macOS：顶部菜单栏（系统级）
- Windows：窗口内菜单栏
- 快捷键用 `CmdOrCtrl+X` 格式，Electron 自动映射

:::

:::toggle-heading[## 三、NavSide 宽度拖动]

### 解决什么问题

NavSide 宽度从硬编码 240px 改为用户可拖拽调整（180~400px）。

### 实现方案

和 Divider 相同的模式：**独立 WebContentsView** 作为 resize handle。

**为什么不在 NavSide 内部实现**：NavSide 是 WebContentsView，Electron 会裁剪到 bounds 范围内。在 NavSide 内部用 `position: absolute` 的 resize handle 会被裁剪，下半部分无法拖拽（首次尝试验证了这个问题）。

### 架构

```
navResizeView（独立 WebContentsView，4px 宽，紧贴 NavSide 右边缘）
  ├── mousedown → IPC: navside:resize-start(screenX)
  ├── mousemove → IPC: navside:resize-move(screenX)
  └── mouseup   → IPC: navside:resize-end
```

main 进程的 IPC handler 接收拖拽事件：

```
resize-move
  → deltaX = screenX - lastX
  → setNavSideWidth(currentWidth + deltaX)  // 限制 180~400px
  → updateLayout()
```

### NavSide 宽度存储

存在 `layout.ts` 的模块级变量中（`navSideWidth`）。不是 Workspace 级别——所有 Workspace 共享同一个 NavSide 宽度。后续持久化里程碑中写入磁盘。

### 关键函数（main/slot/layout.ts）

```typescript
let navSideWidth = NAVSIDE_DEFAULT_WIDTH;  // 240px

export function getNavSideWidth(): number;
export function setNavSideWidth(width: number): void;  // 限制 180~400px

export function calculateLayout(...): LayoutResult;  // 使用动态 navSideWidth
```

:::

:::toggle-heading[## 四、APP_CONFIG 配置化]

### 解决什么问题

应用名、图标路径、窗口大小、布局常量等不散落在代码中，集中管理。

### 配置文件（shared/app-config.ts）

```typescript
export const APP_CONFIG = {
  name: 'KRIG Note',
  shortName: 'KRIG',

  icon: {
    icns: 'build/icon.icns',
    logo: 'public/logo.jpg',
  },

  window: { width: 1200, height: 800, minWidth: 800, minHeight: 600 },

  layout: {
    navSideWidth: 240,
    topBarHeight: 36,
    toggleWidth: 40,
    dividerWidth: 6,
  },

  workspace: {
    defaultDividerRatio: 0.5,
    dividerRatioMin: 0.2,
    dividerRatioMax: 0.8,
  },
} as const;
```

### 使用方

- `layout.ts`：从 APP_CONFIG 读取布局常量
- `divider.ts`：从 APP_CONFIG 读取 dividerRatio 限制
- `shell.ts`：窗口尺寸（待接入）

:::

:::toggle-heading[## 五、应用品牌定制]

### 问题

开发模式下 macOS 菜单栏和 Dock 显示 "Electron" 而非 "KRIG Note"。

### 原因

macOS 菜单栏读的是 `Info.plist` 中的 `CFBundleName`，开发模式下用的是 Electron 二进制自带的 plist。`app.setName()` 无法改变菜单栏显示。

### 解决方案

`scripts/patch-electron-dev.sh`：修改 Electron dev 二进制的 plist 和图标。

```bash
# 修改应用名
PlistBuddy -c "Set CFBundleName 'KRIG Note'" Info.plist
PlistBuddy -c "Set CFBundleDisplayName 'KRIG Note'" Info.plist

# 替换图标
cp build/icon.icns Electron.app/Contents/Resources/electron.icns
```

通过 `package.json` 的 `postinstall` 脚本自动执行，`npm install` 后自动设置。

### 图标生成

KRIG-logo.JPG → PNG → macOS iconset → icon.icns（sips + iconutil）

:::

:::toggle-heading[## 六、新增/修改的文件]

| 文件 | 变更 |
|------|------|
| `shared/types.ts` | 新增 NavSide resize IPC 通道 |
| `shared/menu-types.ts` | **新增**：Menu 注册接口（简化版，无 category） |
| `shared/app-config.ts` | **新增**：集中配置（应用名、布局常量、限制值） |
| `main/protocol/registry.ts` | **新增**：协同协议注册表 + 匹配引擎 |
| `main/menu/registry.ts` | **新增**：Application Menu 注册表 |
| `main/slot/layout.ts` | 动态 NavSide 宽度 + 从 APP_CONFIG 读常量 |
| `main/slot/divider.ts` | 从 APP_CONFIG 读限制值 + 动态 NavSide 宽度 |
| `main/window/shell.ts` | 新增 navResizeView + NAV_RESIZE_HTML |
| `main/ipc/handlers.ts` | 协议匹配检查 + NavSide resize 拖拽处理 |
| `main/preload/navside.ts` | 新增 resizeStart/Move/End API |
| `main/app.ts` | 注册协议 + 注册菜单 + rebuild |
| `forge.config.ts` | 新增 icon/executableName |
| `scripts/patch-electron-dev.sh` | **新增**：开发模式 plist 修补 |
| `build/icon.icns` | **新增**：macOS 应用图标 |

:::

:::toggle-heading[## 七、累计已验证能力]

### 里程碑 1（框架骨架）
- ✅ BaseWindow + WebContentsView 多进程架构
- ✅ Toggle / WorkspaceBar / NavSide 布局
- ✅ WorkMode 注册制 + 切换联动
- ✅ Workspace 创建/切换/关闭 + View 池隔离
- ✅ View 懒创建 + show/hide 生命周期

### 里程碑 2（双栏 + 通信）
- ✅ 双栏布局（Left + Divider + Right）
- ✅ Divider 拖拽
- ✅ View 间 JSON 消息双工

### 里程碑 3（本次）
- ✅ **协同协议注册表**（宽松模式匹配引擎）
- ✅ **Application Menu**（全局稳定，注册制）
- ✅ **NavSide 宽度拖动**（独立 WebContentsView resize handle）
- ✅ **APP_CONFIG 配置化**
- ✅ **应用品牌定制**（名称 + 图标）

### 下一步方向
- 持久化 + 恢复（Session 保存到磁盘）
- NavSide 右键菜单
- 第一个真实 View 插件（NoteView）

:::
