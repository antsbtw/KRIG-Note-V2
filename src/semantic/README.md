# src/semantic — 语义层 (纯类型)

> **纵向类目**: 语义层
> **横向 L 层**: 跨 L0~L5 (纯类型, 任何层可用)
> **当前状态**: ✅ Sub-phase 1 atom + edge 类型已落地

完整规范见
[`docs/RefactorV2/data-model/atom/spec.md`](../../docs/RefactorV2/data-model/atom/spec.md)
+ [`docs/RefactorV2/data-model/relations/spec.md`](../../docs/RefactorV2/data-model/relations/spec.md)
+ [`docs/RefactorV2/data-model/persistence/`](../../docs/RefactorV2/data-model/persistence/)。

---

## 实施状态 (Phase N sub-phase 1 完成)

```
src/semantic/
├── types/
│   ├── atom.ts          Atom<D> + AtomDomain + AtomPayloadOf<D>
│   │                    + PmPayload / RdfPayload / EmbeddingPayload / ThreePayload
│   │                    + Mark (pm domain inline marks)
│   ├── atom-entity.ts   AtomEntity<D>  (持久化壳: id/createdAt/updatedAt/createdBy/payload)
│   ├── edge.ts          Edge + EdgePredicate + AtomRef + LiteralValue + EdgeEndpoint + EdgeAttrs
│   ├── edge-entity.ts   EdgeEntity (extends Edge)
│   └── index.ts         re-export
└── index.ts             re-export ./types
```

---

## 屏障约束

- ❌ 0 处 npm 业务包 import (纯类型)
- ❌ ESLint 强制: `src/semantic/**` 只允许同层内部 import,不允许 prosemirror / three / surrealdb 等
- ✅ 跨视图通用 (任何视图都能消费)

---

## 类型层契约

按 decision 011 §3.2 + [`docs/RefactorV2/data-model/atom/spec.md`](../../docs/RefactorV2/data-model/atom/spec.md):

- `Atom<D>` 主接口: `{ domain: D; payload: AtomPayloadOf<D> }`,domain 开放注册
- `AtomEntity<D>` 持久化壳: 加 `id / createdAt / updatedAt / createdBy`,包 atom 在 `payload` 字段
- `Edge` 主接口: `{ predicate; subject: AtomRef; object: EdgeEndpoint; attrs }`,subject **类型层强制 AtomRef**
- `EdgePredicate` 串: `<source>:<vocabulary>:<edge-name>` 三段,正则在 storage schema 校验
- `AtomRef` / `LiteralValue` / `EdgeEndpoint`: 端点统一抽象,object 可为 atom ref 或 literal

---

## 下一步 (sub-phase 2)

- noteStore / folderStore 迁移时,业务层从 V1 plain JSON 模型转换为 atom domain='pm' + 关系边
- 之后扩展 atom domain (rdf / embedding / three / ...) 时,只需在 `AtomPayloadOf<D>` 条件类型上加分支
