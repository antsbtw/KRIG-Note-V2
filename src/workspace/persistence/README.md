# persistence — Workspace 持久化

> 详细设计:[../DESIGN.md v0.1 § 3.2](../DESIGN.md)

---

## 文件清单

| 文件 | 职责 |
|---|---|
| `persistence-api.ts` | 抽象接口(load / save / clear)— 实现可替换 |
| `local-storage.ts` | localStorage 实现(L3 阶段)|

---

## 设计:接口稳定,实现可替换

```
Q4 决策(2026-05-05):
  L3 阶段用 localStorage(0 npm 依赖,renderer 进程原生支持)
  接口设计成可替换(PersistenceAPI),未来切 SurrealDB 时 WorkspaceManager 不变
```

未来扩展(L4+ 引入 SurrealDB 时):
- 实现 `surreal-storage.ts`(满足 PersistenceAPI)
- WorkspaceManager 切换 `setPersistence(surrealStoragePersistence)`
- 业务代码 0 改动

---

## 当前状态

⏳ **L3 阶段实施中**(2026-05-05)。
