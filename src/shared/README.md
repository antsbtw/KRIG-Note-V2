# src/shared — 跨进程共享(IPC 契约 + 共享类型)

> **纵向类目**:跨纵向(共享)
> **横向 L 层**:跨 L0~L5
> **当前状态**:⏸️ 待启用,L0 阶段实施时启用(IPC channel 名 + 共享类型)

---

## 该层做什么

main / renderer 进程共享的纯类型 + IPC 契约 + 常量。

详细说明见 [docs/00-architecture/charter.md § 2.2 横向 L0~L5 / shared](../../docs/00-architecture/charter.md)。

---

## 屏障约束

- ❌ 0 处 npm 业务包 import
- ❌ ESLint 强制:`src/shared/**` 不允许 import 任何 npm 包(只允许 import 同层内部模块)
- ✅ 纯类型 + 纯常量,不持有运行时状态
- ✅ 任何进程任何层都能 import

详细见 [docs/00-architecture/directory-structure.md § 4](../../docs/00-architecture/directory-structure.md)。

---

## 子目录划分

L0 阶段实施时立即建(因为 platform 需要 IPC 契约):

```
src/shared/
├── ipc/             (IPC channel 名常量 + 消息类型契约)
├── types/           (跨进程共享类型)
└── constants/       (应用级常量)
```

---

## 与 src/semantic 的区别

| | `src/shared/` | `src/semantic/` |
|---|---|---|
| 内容 | IPC channel 名 / 跨进程消息类型 / 应用常量 | Atom / block / IntentEvent / 各类 ID 类型 |
| 用途 | 让 main / renderer 在 IPC 通信时共享类型 | 内容本体的语义定义 |
| 性质 | 进程间契约 | 业务领域概念 |

---

## V1 学习参考

V1 `src/shared/` 含:
- `types.ts`(IPC + 通用类型混合)
- `types/`(各 atom-types / schema-interop / graph-types 等)
- `intents.ts`(V1 二次重构期建,空)
- `ui-primitives.ts`(V1 二次重构期建,Capability/ViewDefinition 类型)

V2 拆分:
- IPC + 通用类型 → `src/shared/`(本目录)
- atom-types / block-types / intent 类型 → `src/semantic/`
- ui-primitives 类型(Capability / ViewDefinition / 五大交互)→ `src/slot/`(因为 Registry 基础设施需要这些类型)

---

## 下一步

L0 阶段:
1. 写 `src/shared/DESIGN.md`
2. 实施 `src/shared/ipc/channel-names.ts`(健康检查 channel 等)
3. 实施 `src/shared/ipc/message-types.ts`(IPC 消息类型契约)
4. 实施 `src/shared/types/common-types.ts`(跨进程共享类型)
