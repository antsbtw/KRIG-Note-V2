# src/semantic — 语义层(纯类型)

> **纵向类目**:语义层
> **横向 L 层**:跨 L0~L5(纯类型,任何层可用)
> **当前状态**:⏸️ 待启用,实施需要语义类型时填充(可能 L3 / L5 阶段)

---

## 该层做什么

内容本体,与可视化无关。Atom + block + intents + ids 等纯类型在这里定义。

详细说明见 [docs/00-architecture/charter.md § 2.1 语义层 + § 4 atom/block/blockView 精确定位](../../docs/00-architecture/charter.md)。

---

## 屏障约束

- ❌ 0 处 npm 业务包 import
- ❌ ESLint 强制:`src/semantic/**` 不允许 import 任何 npm 包(只允许 import 同层内部模块)
- ✅ 纯类型 + 纯逻辑(不持有状态)
- ✅ 跨视图通用(任何视图都能消费)

详细见 [docs/00-architecture/directory-structure.md § 4](../../docs/00-architecture/directory-structure.md)。

---

## 子目录划分

待具体类型实施时设计。预期结构:

```
src/semantic/
├── atom/        (Atom 类型定义 — 最小单元)
├── block/       (block 概念定义 — atom 组合,自身可嵌套)
├── intents/     (IntentEvent 类型)
└── ids/         (各类 ID 类型)
```

---

## 概念关系(由 charter § 4 定义)

```
atom(最小单元,语义层)
  ↓ 组合
block(atom 的语义组合,自身可嵌套 block)
  ↓ 渲染(由能力层 blockView 投影)
view(可视化层)
```

block 在语义层定义形态,blockView 在能力层定义渲染方法。

---

## 下一步

需要语义类型时:
1. 写 `src/semantic/DESIGN.md`(子目录详细设计)
2. 从 V1 拷贝相关类型(如 V1 `src/shared/types/atom-types.ts` → `src/semantic/atom/atom-types.ts`)
3. 必要时参考 [docs/10-business-design/ai/KRIG-Atom体系设计文档.md](../../docs/10-business-design/ai/KRIG-Atom体系设计文档.md) + [docs/10-business-design/block/](../../docs/10-business-design/block/)
