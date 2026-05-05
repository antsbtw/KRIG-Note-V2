# shell/workspace-container — Workspace 全屏容器(L2)

> 详细设计:[../DESIGN.md v0.3 § 1](../DESIGN.md)

---

## 该模块做什么

全屏容器,挂载当前活跃 Workspace 实例。

| 文件 | 职责 |
|---|---|
| `WorkspaceContainer.tsx` | 全屏容器(L2 占位,L3 mount Workspace 实例) |
| `workspace-container.css` | 样式 |

---

## 当前状态

⏳ **L2 阶段实施中**。

L2 阶段:**占位空容器**(等 L3 阶段从 WorkspaceManager 拿活跃 Workspace 实例 mount)。
