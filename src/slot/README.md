# src/slot — Slot 层(L4 Registry 基础设施)

> **纵向类目**:能力层(Registry 基础)
> **横向 L 层**:L4 Slot
> **当前状态**:⏸️ 待启用,L4 阶段实施时填充

---

## 该层做什么

5 大 Registry 基础设施:
- ViewType Registry(视图类型注册)
- Capability Registry(能力注册)
- Command Registry(命令实现注册)
- 五大交互 Registry(ContextMenu / Toolbar / Slash / Handle / FloatingToolbar)

详细说明见 [docs/00-architecture/charter.md § 1.2 注册原则 + § 2.2 L4 Slot](../../docs/00-architecture/charter.md)。

---

## 屏障约束

- ❌ 0 处业务 npm 包 import(prosemirror / three / pdfjs / 等)
- ❌ 0 处 `import 'electron'`
- ✅ 允许 import:`@semantic/` / `@shared/`(纯类型)

详细见 [docs/00-architecture/directory-structure.md § 4](../../docs/00-architecture/directory-structure.md)。

---

## 子目录划分

待 L4 阶段实施时设计。预期结构:

```
src/slot/
├── view-type-registry/         (ViewType 注册 + registerView API)
├── capability-registry/        (Capability 注册 + registerCapability API)
├── command-registry/           (CommandRegistry — 命令字符串引用实现)
└── interaction-registries/     (五大交互各自 Registry)
```

---

## V1 学习参考

V1 已有部分 Registry 雏形:
- `src/main/menu/registry.ts`(菜单 Registry)
- `src/main/workmode/registry.ts`(WorkMode Registry)
- `src/main/navside/registry.ts`(NavSide Registry)
- `src/main/protocol/registry.ts`(Protocol Registry)
- `src/renderer/ui-primitives/command-registry.ts`(V1 二次重构期建,空)

V1 教训:
- Registry 散落在 main 各业务子目录 — V2 应统一到 src/slot/
- Command Registry 在 V1 是空的(02b 阶段建 runtime 但无人 register)— V2 应在 L5 视图实施时立即用起来

V2 改进:
- 5 大 Registry 集中在 src/slot/
- 各 view / capability 通过 src/slot/ 提供的 register*() API 注册
- 通过 src/slot/ 暴露的 lookup API 被其他层查询

---

## 下一步

L4 阶段:
1. 写 `src/slot/DESIGN.md`
2. 实施 5 大 Registry + register/lookup API
3. 验证 dummy view 注册 + 在 Slot 内挂载成功
