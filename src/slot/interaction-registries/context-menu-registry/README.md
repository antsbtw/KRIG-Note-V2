# context-menu-registry — 右键菜单 Registry

按 charter § 1.4 + view-hierarchy-v2.md § 6:
- 所有 ContextMenu 都归 Workspace,无 scope 字段
- view 字段 undefined = 全局,指定 view ID = 仅该 view 显示
- 触发逻辑在 src/slot/triggers/use-context-menu-trigger.ts(集中)
- 渲染绑定在 src/slot/frame-bindings/context-menu-binding.tsx
