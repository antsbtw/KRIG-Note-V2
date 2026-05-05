# frame-bindings — Registry → Frame 渲染接入

V1 教训:Registry 与 UI 渲染管线脱节(menu 接了,其他半通电)。
V2 改进:每个 Registry 对应一个 binding 组件,Workspace frame 内 mount,**注册即生效**。

## 文件清单

| Binding | Frame | Registry |
|---|---|---|
| NavSideBinding | NavSideFrame | navSideRegistry |
| ToolbarBinding | ToolbarFrame | toolbarRegistry |
| ContextMenuBinding | ContextMenuFrame | contextMenuRegistry + contextMenuController |
| SlashMenuBinding | SlashMenuFrame | slashRegistry + slashMenuController |
| HandleMenuBinding | HandleMenuFrame | handleRegistry + handleMenuController |
| FloatingToolbarBinding | FloatingToolbarFrame | floatingToolbarRegistry + floatingToolbarController |
| OverlayBinding | GenericOverlayFrame | overlayRegistry |

## use-registry.ts

通用 hook 集合,binding 通过 useSyncExternalStore 订阅 Registry 状态。

**重要**:hook 返回稳定引用(数据未变时同 ===),避免 Maximum update depth 无限循环 bug。

## Controller 模式(浮层 frame 用)

ContextMenu / Slash / Handle / FloatingToolbar 是事件驱动浮层(右键 / Slash 输入 / hover / 选区触发):
- triggers/ 监听 DOM 事件 → 调 controller.show()
- binding 订阅 controller → setState → 重渲

OverlayRegistry 自带 show/hide(因为 Overlay 是命令触发,不是 DOM 事件)。
