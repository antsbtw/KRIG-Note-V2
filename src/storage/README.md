# src/storage — 存储层(SurrealDB)

> **纵向类目**:存储层
> **横向 L 层**:L0(主进程持久化)
> **当前状态**:⏸️ 待启用,实施持久化需求时填充

---

## 该层做什么

持久化,SurrealDB SDK 调用。通过 IPC 提供给能力层(主进程 / renderer 隔离)。

详细说明见 [docs/00-architecture/charter.md § 2.1 存储层](../../docs/00-architecture/charter.md)。

---

## 屏障约束

- ✅ **唯一允许 import SurrealDB SDK 的位置**
- ❌ 其他纵向层禁止直接 import SurrealDB SDK
- ❌ ESLint 强制:`src/storage/**` 只允许 surrealdb + 内部模块,不允许 prosemirror / three / pdfjs 等

详细见 [docs/00-architecture/directory-structure.md § 4](../../docs/00-architecture/directory-structure.md)。

---

## 子目录划分

待持久化需求实施时设计。预期结构:

```
src/storage/
├── surreal-client/    (SurrealDB 连接管理 + schema 定义)
└── ipc-handlers/      (Atom / Workspace 状态读写 IPC handler)
```

---

## V1 学习参考

V1 存储层在 `src/main/storage/`,含:
- `client.ts`(SurrealDB 连接)
- `schema.ts`(数据库 schema)
- `note-store.ts` / `folder-store.ts` / `thought-store.ts` / 等(各业务实体的 store)
- `migrate-json-to-surreal.ts`(从 JSON 迁移)
- `init-docs.ts`(用户手册 init)

V2 简化:
- 不再每个业务实体一个 store(那是 V1 的耦合)
- 改为统一 atom 持久化 + Workspace 状态持久化
- 业务级查询由能力层组装(能力层调存储层的 atom 读 IPC)

---

## 下一步

需要持久化时:
1. 写 `src/storage/DESIGN.md`
2. 实施 SurrealDB 连接 + atom schema
3. 提供 IPC handler 给能力层
