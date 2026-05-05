# shell/workspace-bar — 顶部 WorkspaceBar(L2)

> 详细设计:[../DESIGN.md v0.3 § 1](../DESIGN.md)

---

## 该模块做什么

渲染顶部 28px 栏,含 3 类控件:

```
┌─ WorkspaceBar(28px)──────────────────────────────────────────────┐
│ [≡] │ [WS-1] [WS-2] ... [+]                                       │
└────────────────────────────────────────────────────────────────────┘
  ↑       ↑                ↑
  │       └ Workspace Tabs └ [+] 新建
  └ NavSide Toggle
```

| 文件 | 职责 |
|---|---|
| `WorkspaceBar.tsx` | 28px 栏容器,布局 3 类控件 |
| `NavSideToggle.tsx` | 左端 ≡ 按钮(L2 占位,L3 接入 toggleNavSide) |
| `WorkspaceTab.tsx` | 单个 Tab(L2 阶段不渲染,L3 阶段从 WorkspaceManager 渲染列表) |
| `AddWorkspaceButton.tsx` | 右端 [+] 按钮(L2 占位,L3 接入 create) |
| `workspace-bar.css` | 样式(深色主题,28px 高度) |

---

## 当前状态

⏳ **L2 阶段实施中**(2026-05-05)。

L2 阶段:控件渲染但触发**不工作**(等 L3 接入 WorkspaceManager)。
