# src/workspace — Workspace 层(L3 WorkMode 状态)

> **纵向类目**:能力层(状态管理部分)
> **横向 L 层**:L3 Workspace
> **当前状态**:⏸️ 待启用,L3 阶段实施时填充

---

## 该层做什么

WorkMode 实例管理 + Workspace 状态(activeViewId / activeResource / pluginStates 字典 + 持久化)。

详细说明见 [docs/00-architecture/charter.md § 2.2 横向 L0~L5 / L3 Workspace](../../docs/00-architecture/charter.md)。

---

## 屏障约束

- ❌ 0 处业务 npm 包 import
- ❌ 不允许直接 import SurrealDB SDK(通过 IPC 调存储层)
- ✅ 允许调用 `@storage/`(通过 IPC)
- ✅ 允许 import:`@semantic/` / `@shared/` / `@slot/`

详细见 [docs/00-architecture/directory-structure.md § 4](../../docs/00-architecture/directory-structure.md)。

---

## 子目录划分

待 L3 阶段实施时设计。预期结构:

```
src/workspace/
├── workmode-registry/    (WorkMode 实例管理)
└── state/                (Workspace 状态 + pluginStates + 持久化协议)
```

---

## V1 学习参考

V1 Workspace 在 `src/main/workspace/manager.ts` + `workmode/registry.ts`。功能:
- WorkMode 注册(demo-a Note / demo-b EBook / demo-c Web)
- Workspace 实例创建 / 销毁 / 切换
- Workspace 状态(activeNoteId / rightActiveNoteId / activeBookId 等业务字段散落 — V1 教训)
- Session 持久化

V1 教训(详见 V1 memory `project_active_resource_id_arch_debt`):
- activeNoteId / rightActiveNoteId / activeBookId 散落管理 — V2 应抽 ActiveResourceManager 层
- WorkspaceState 业务字段过多 — V2 应改用 pluginStates 字典(charter § 6 已定原则)

V2 改进:
- 业务字段全走 pluginStates(由各 view / capability 自管理)
- WorkspaceState 只有最小核心字段(id / label / activeViewId / pluginStates)

---

## 下一步

L3 阶段:
1. 写 `src/workspace/DESIGN.md`
2. 实施 WorkMode 注册 + Workspace 状态 + 持久化
3. 验证 workspace 切换 + 重启状态恢复
