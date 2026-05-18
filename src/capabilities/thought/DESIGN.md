# thought capability — v0.1 设计

**状态**:Phase 1 落地中
**主 SSOT**:`docs/RefactorV2/thought-view-port.md` v0.5+

## 定位

Thought 是 KRIG 的**横切思考层**(thought-view-port.md §0/§2)。

- 不依附任何单一 view
- 通过 `anchor: source-discriminated union` 挂到 note / book / graph / canvas 资源,或独立存在(unanchored)
- 所有 install 它的 view 看到的 API 完全一致(charter §1.4 line 196)

## 表面

8 个 invoke API + 1 个订阅 = 9 表面(`types.ts` ThoughtCapabilityApi)。

详见 [thought-view-port.md §5.3 接口表](../../../docs/RefactorV2/thought-view-port.md)。

## 与 ebook reading-thought 的关系(双轨期)

V2 sub-phase 022 的 `hasReadingThought / addReadingThoughtBlock` 系列 API(`ebook-library` capability)是过渡形态(一书一 doc 内含 N block)。本 capability 是统一替代:

- **Phase 1-3**:本 capability 与 ebook-library 老 API **并存**,互不干扰
- **Phase 4**:ebook view 创建标注路径**切到新 thought capability**(双轨实施 — 新建走新 API,老数据走老 API 只读)
- **Phase 6**(可选):老数据迁移(独立 sub-phase)

## 关键决议(短引)

| 决议 | 出处 | 含义 |
|---|---|---|
| 横切定位 | port.md §0/§2 | 不绑单一 view |
| Multi-source anchor | port.md §4.2 | discriminated union,新 source 仅加 locator |
| 单步原子 create | port.md §5.3 #1 | atom + 边一次事务 |
| Two-state 孤儿语义 | port.md §8.3 | dangling-anchor vs unanchored |
| capability 调用强约束 | port.md §7.1 | view 走 requireCapabilityApi |
| capability 不互调 | port.md §7.1 末段 | folder/note 组合在 view 层 |

## 9 种 thought type

`ThoughtType` = V1 6 种(thought/question/important/todo/analysis/ai-response)+ ebook 吸收 3 种(highlight/underline/rect-frame)。

UI 渲染元数据 `THOUGHT_TYPE_META`(在 `@shared/ipc/thought-types`)。

## 存储字面

- atom domain = `'thought'`
- edge predicates:
  - `user:krig:thoughtOf`(thought → source atom,attrs.source/locator)
  - `user:krig:inFolder`(thought → folder atom,Thought View 主舞台用)
- folder cascade 白名单已加 `'thought'` domain(删 folder 级联删 thought)

## 文件清单(本 capability)

```
capabilities/thought/
  types.ts       — ThoughtCapabilityApi + re-export shared types
  index.ts       — renderer 薄包装 + capabilityRegistry.register
  DESIGN.md      — 本文件
```

main 端实施在 `platform/main/thought/`(envelope + capability-impl + handlers + broadcast + index)。
