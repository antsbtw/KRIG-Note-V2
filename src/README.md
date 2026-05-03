# src/ — V2 源代码

按 [docs/00-architecture/directory-structure.md v0.3](../docs/00-architecture/directory-structure.md) 的 9 个第一层目录组织(冻结契约)。

---

## 第一层目录

```
src/
├── views/          ← 纵向:可视化层(L5 视图主体)
├── capabilities/   ← 纵向:能力层(npm 屏障)
├── semantic/       ← 纵向:语义层(纯类型)
├── storage/        ← 纵向:存储层(SurrealDB)
├── platform/       ← 横向:L0 应用层 + L1 窗口层(Electron 进程入口)
├── shell/          ← 横向:L2 Shell 层(三栏布局 + Slot 容器)
├── workspace/      ← 横向:L3 Workspace 层(WorkMode 状态)
├── slot/           ← 横向:L4 Slot 层(Registry 基础设施)
└── shared/         ← 跨进程共享(IPC 契约 + 共享类型)
```

每个目录有自己的 `README.md` 详细说明。

---

## 当前状态

| 目录 | 状态 |
|---|---|
| `views/` | ⏸️ 待启用(L5 阶段) |
| `capabilities/` | ⏸️ 待启用(L5 阶段需 text-editing 时) |
| `semantic/` | ⏸️ 待启用(需要语义类型时) |
| `storage/` | ⏸️ 待启用(需要持久化时) |
| `platform/` | ⏳ **L0 阶段实施中**(已有 DESIGN.md 草稿) |
| `shell/` | ⏸️ 待启用(L2 阶段) |
| `workspace/` | ⏸️ 待启用(L3 阶段) |
| `slot/` | ⏸️ 待启用(L4 阶段) |
| `shared/` | ⏳ L0 阶段启用(需要 IPC 契约) |

---

## 下一步

L0 阶段实施(详见 [src/platform/DESIGN.md](./platform/DESIGN.md)):
1. 工程脚手架(package.json / tsconfig / forge / vite / eslint)
2. `src/platform/main/` + `src/platform/renderer/` 实施
3. `src/shared/ipc/` 实施(IPC channel 名 + 消息类型)
4. 验证 npm start 看到主窗口 + console "L0+L1 alive"
