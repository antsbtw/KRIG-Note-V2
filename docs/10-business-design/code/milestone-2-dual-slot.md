# 里程碑 2 — Right Slot + Divider + 消息双工

:::callout[NOTE]
**目标**：双栏布局 + 可拖拽 Divider + View 间 JSON 消息双工通信。
验证 Slot 系统完备性和 View 通信机制。
:::

---

:::toggle-heading[## 一、新增能力总览]

| 能力 | 说明 | 状态 |
|------|------|------|
| Right Slot | 用户操作动态打开/关闭右侧 View | ✅ |
| Divider 拖拽 | 独立 WebContentsView，拖拽调整左右比例 | ✅ |
| 消息双工 | Left ↔ Right 通过 main 路由 JSON 消息 | ✅ |
| toggle 行为 | 再次点击同一按钮关闭 Right Slot | ✅ |
| Workspace 隔离 | Right Slot 状态随 Workspace 切换保留/恢复 | ✅ |

:::

:::toggle-heading[## 二、双栏布局]

### 触发方式

Right Slot 不由 WorkMode 预设，而是用户操作动态触发：

- **打开**：NavSide Action Bar 按钮（如 "📕 右侧"）
- **关闭**：Action Bar "✕ 关闭" 按钮，或再次点击同一打开按钮（toggle）

### 数据流

```
用户点击"📕 右侧"
  → navSideAPI.openRightSlot('demo-b')
  → IPC: slot:open-right
  → main handler: openRightSlot(workModeId)
    1. 如果已有相同 Right View → 关闭（toggle）
    2. 懒创建 Right View（当前 Workspace 的 View 池）
    3. 创建/显示 Divider
    4. updateLayout()（hasRightSlot = true）
    5. 广播状态
```

### 布局变化

```
单栏：
┌─ Toggle ─┬─ WorkspaceBar ────────────────────────────┐
├─ NavSide ─┤─ Left Slot ─────────────────────────────┤

双栏：
┌─ Toggle ─┬─ WorkspaceBar ────────────────────────────┐
├─ NavSide ─┤─ Left Slot ──┤Div├── Right Slot ────────┤
```

:::

:::toggle-heading[## 三、Divider 实现]

### 架构

Divider 是独立的 WebContentsView（inline HTML），与 mirro-desktop 的方案一致：

```
dividerView（inline HTML）
  ├── mousedown → IPC: divider:drag-start(screenX)
  ├── mousemove → IPC: divider:drag-move(screenX)
  └── mouseup   → IPC: divider:drag-end(screenX)
```

main 进程的 `DividerController` 接收拖拽事件：

```
DividerController (main/slot/divider.ts)
  ├── drag-start: 记录起始位置
  ├── drag-move: 计算 deltaX → 更新 dividerRatio → updateLayout()
  └── drag-end: 停止拖拽
```

### dividerRatio 存储

存在 `WorkspaceState.dividerRatio` 中（Workspace 级别）：
- 同一 Workspace 内所有 View 组合共享比例
- 切换 Workspace 时各自恢复
- 限制范围：0.2 ~ 0.8（防止某侧太窄）
- 当前不持久化到磁盘（后续里程碑实现）

### Divider 宽度

6px（`DIVIDER_WIDTH`），比里程碑 1 的 1px 宽，方便拖拽。暗色背景 + hover 高亮。

:::

:::toggle-heading[## 四、View 间消息双工]

### 消息格式

```typescript
interface ViewMessage {
  protocol: string;   // 协议 id（如 'demo', 'anchor', 'page-sync'）
  action: string;     // 操作名（如 'ping', 'scrollTo'）
  payload: unknown;   // 任意 JSON，框架不解析
}
```

框架只看 `protocol` 和 `action` 做路由，不理解 `payload` 内容。View 自己编解码。

### 通信机制

```
Left View                    main 进程                    Right View
    │                            │                            │
    ├── sendToOtherSlot(msg) ──→ │                            │
    │   IPC: view:message-send   │                            │
    │                            ├── 路由：找到对面的 View ──→ │
    │                            │   IPC: view:message-receive │
    │                            │                            │
    │                            │ ←── sendToOtherSlot(msg) ──┤
    │ ←── view:message-receive ──┤                            │
    │                            │                            │
```

### 路由逻辑（main/ipc/handlers.ts）

```typescript
ipcMain.on(IPC.VIEW_MESSAGE_SEND, (event, message) => {
  const { leftId, rightId } = getActiveViewWebContentsIds();
  const senderId = event.sender.id;

  // 发送者是 Left → 路由到 Right；发送者是 Right → 路由到 Left
  let targetId = (senderId === leftId) ? rightId : leftId;

  // 在 child views 中找到目标并发送
  for (const child of mainWindow.contentView.children) {
    if (child.webContents.id === targetId) {
      child.webContents.send(IPC.VIEW_MESSAGE_RECEIVE, message);
    }
  }
});
```

### View 端 API（preload/view.ts）

```typescript
viewAPI.sendToOtherSlot(message)     // 发送给对面 Slot
viewAPI.onMessage(callback)           // 接收对面 Slot 的消息
```

View 不需要知道对面是谁，也不需要知道自己在 Left 还是 Right。

:::

:::toggle-heading[## 五、Workspace View 池结构更新]

里程碑 1 的 View 池只有 Left Views。里程碑 2 扩展为：

```typescript
interface WorkspaceViewPool {
  leftViews: Map<string, WebContentsView>;  // workModeId → Left View
  rightView: WebContentsView | null;         // Right Slot View
  rightWorkModeId: string | null;            // Right View 的 workModeId
  activeLeftId: string | null;               // 当前 Left Slot 的 workModeId
}
```

- Left Views 按 workModeId 缓存（懒创建，切换时 show/hide）
- Right View 每次打开新建，关闭时销毁（因为 Right Slot 的 View 类型可能每次不同）
- Workspace 切换时：隐藏旧 Workspace 所有 View + Divider，显示新 Workspace 的

:::

:::toggle-heading[## 六、新增/修改的文件]

| 文件 | 变更 |
|------|------|
| `shared/types.ts` | 新增 `ViewMessage` 接口 + Divider/消息 IPC 通道 |
| `main/slot/divider.ts` | **新增**：DividerController + Divider inline HTML |
| `main/slot/layout.ts` | Divider 宽度从 1px 改为 6px |
| `main/window/shell.ts` | 新增 `openRightSlot` / `closeRightSlot` / `dividerView` 管理 |
| `main/ipc/handlers.ts` | 新增 `slot:open-right` / `slot:close-right` / 消息路由 |
| `main/preload/divider.ts` | **新增**：Divider 拖拽 API |
| `main/preload/view.ts` | 新增 `sendToOtherSlot` / `onMessage` / `openRightSlot` / `closeRightSlot` |
| `main/preload/navside.ts` | 新增 `openRightSlot` / `closeRightSlot` |
| `main/app.ts` | 新增 `setupDividerController` 调用 |
| `forge.config.ts` | 新增 divider preload 入口 |
| `renderer/navside/NavSide.tsx` | Action Bar 按钮改为打开/关闭 Right Slot |
| `plugins/demo/renderer.tsx` | 新增 Ping 按钮 + Message Log（验证双工通信） |

:::

:::toggle-heading[## 七、设计原则验证]

| 原则 | 验证结果 |
|------|---------|
| **Slot 是纯布局位置**（view.md §九.4） | ✅ Slot 不知道 View 类型，只计算 bounds |
| **View 不知道对面**（view.md §九.5） | ✅ sendToOtherSlot 不指定目标，main 自动路由 |
| **通信经过路由**（视图层级定义.md §六.7） | ✅ View 间消息全部经过 main 进程 |
| **框架不理解消息内容**（view-protocol.md §一.4） | ✅ 框架只看 sender ID 做路由，不解析 payload |
| **Workspace 隔离**（workspace.md §七.3） | ✅ Right Slot 状态随 Workspace 保留/恢复 |
| **WorkMode 不决定 Right Slot**（workmode.md §三.1） | ✅ Right Slot 由用户操作触发，不由 WorkMode 预设 |

:::

:::toggle-heading[## 八、当前状态和下一步]

### 里程碑 1 + 2 累计已验证

- ✅ BaseWindow + WebContentsView 多进程架构
- ✅ Toggle / WorkspaceBar / NavSide 布局
- ✅ WorkMode 注册制 + 切换联动
- ✅ Workspace 创建/切换/关闭 + View 池隔离
- ✅ View 懒创建 + show/hide 生命周期
- ✅ **双栏布局**（Left + Divider + Right）
- ✅ **Divider 拖拽**（实时更新 dividerRatio）
- ✅ **View 间消息双工**（JSON 格式，框架路由）

### 下一步方向

- 协同协议注册表 + 匹配引擎（完善 view-protocol.md 的实现）
- 持久化 + 恢复（Session 保存到磁盘，重启恢复布局）
- Application Menu 注册机制
- 第一个真实 View 插件（NoteView）

:::
