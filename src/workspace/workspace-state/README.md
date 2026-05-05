# workspace-state — Workspace 纯逻辑层

> 详细设计:[../DESIGN.md v0.1 § 3.2](../DESIGN.md)

---

## 文件清单

| 文件 | 职责 |
|---|---|
| `workspace-state.ts` | WorkspaceState 类型定义 + SlotBinding 类型 |
| `default-state.ts` | 默认 WorkspaceState 工厂 + 常量(NavSide 默认宽 / dividerRatio 范围) |
| `plugin-states.ts` | pluginStates 操作 helper(getPluginState / setPluginState) |
| `workspace-manager.ts` | WorkspaceManager 类(实例池 + 切换 + 持久化 + 订阅)|

---

## V2 vs V1 差异

- WorkspaceState 字段精简(去散落业务字段,加 navSideCollapsed)
- 加 subscribe(useSyncExternalStore 友好)
- 加 toggleNavSide 助手
- 持久化抽象成 PersistenceAPI(默认 localStorage,未来可换 SurrealDB)
- 取消 V1 WorkMode 概念(charter § 1.4 用 viewType)

---

## 当前状态

⏳ **L3 阶段实施中**(2026-05-05)。
