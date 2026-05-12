# Mixin 总览（V2 数据建模）

> 本文件定义 V2 数据建模中**Mixin** 的概念、设计原则、注册流程。
>
> 参考：`atom/decisions/004-phase2b-resolutions.md` §4（Mixin 列表决议）。

---

## 0. Mixin 是什么

**Mixin = 数据形状的复用单元**。多个 atom payload / edge attrs 共享的字段集合，抽出来一份单独定义，引用方各自组合。

**核心语义**：
- Mixin 是**结构复用**（字段集合），不是**行为复用**（不是 OO 继承 / 不带方法）。
- 引用方通过 **TypeScript intersection types**（`&`）组合 Mixin 与自身字段。
- Mixin 改动 → 所有引用方自动同步（一处改，处处生效）。

**典型例子**：

```ts
// Mixin 定义
interface TextFlowAttrs {
  textIndent?: boolean;
  indent?: number;
  align?: 'left' | 'center' | 'right' | 'justify';
}

// Block attrs 引用 Mixin
type ParagraphAttrs = TextFlowAttrs;
type HeadingAttrs = TextFlowAttrs & {
  level: 1 | 2 | 3 | 4 | 5 | 6;
};
type BlockquoteAttrs = TextFlowAttrs;
```

→ 未来给 `align` 加 `'right-to-left'` 选项 → **只改 TextFlowAttrs 一处**，所有引用 block 自动得到新选项。

---

## 1. Mixin 适用范围

V2 数据模型中可挂 Mixin 的位置：

| 位置 | 说明 | 当前实例 |
|---|---|---|
| **atom payload 字段** | atom 数据形态内部字段（如 pm domain 的 attrs） | TextFlowAttrs / MediaResourceAttrs |
| **edge attrs 字段** | 边的 attrs 内部字段 | （Phase 1 暂无，AuditAttrs 已在 `relations/spec.md` §3 内联定义） |

Mixin **不**用于：

- ❌ 跨 atom / edge 的语义关系（用边表达，详 atom/decisions/003 §3 走法 B）
- ❌ 跨 domain 的数据转换（用 capability 层的 converter）
- ❌ 表达可重用的"行为"或"操作"（这是 capability / function 的职责）

---

## 2. 设计原则

### 2.1 Mixin 抽取标准

满足以下**全部**条件才抽 Mixin：

| 条件 | 说明 |
|---|---|
| **复用次数 ≥ 3** | 至少 3 个 block / atom 使用同一组字段 |
| **字段集合一致** | 字段名 + 类型 + 默认值在所有引用方相同（不能"差不多") |
| **语义一致** | 字段含义在所有引用方相同（避免"看起来一样，实际语义不同"的伪共性) |

**反例**：image 的 `alt` 跟 video 的 `title` 看起来都是"描述文字"，但 alt 是替代呈现（屏幕阅读器）、title 是 tooltip，**语义不同 → 不抽 Mixin**。

### 2.2 Mixin 命名约定

| 用法 | 命名风格 | 例 |
|---|---|---|
| atom payload mixin | `<Concept>Attrs` 后缀 | `TextFlowAttrs` / `MediaResourceAttrs` |
| edge attrs mixin | `<Concept>Attrs` 后缀 | `AuditAttrs`（未来） |
| 其他用途 | `<Concept>Mixin` 后缀（如有） | （Phase 1 暂无） |

命名风格 camelCase（与 `naming-conventions.md` §3.1 一致）。

### 2.3 Mixin 的反 OO 原则

Mixin **不是继承**：

- 不创建"父子关系"，引用方仍然是独立类型。
- 不挂方法 / 行为 / 生命周期 hook。
- 不嵌套 Mixin（一个 Mixin 不引用另一个 Mixin）。

如果发现 Mixin 嵌套 / 行为耦合 → 信号：可能需要拆分成多个独立 Mixin 或重新审视抽象。

---

## 3. 注册流程

新 Mixin 加入 V2 时：

### 步骤 1：识别复用模式

观察现有 atom payload / edge attrs，确认字段重复达到**复用次数 ≥ 3** 阈值（详 §2.1）。

### 步骤 2：写 Mixin 文档

在 `data-model/mixins/<mixin-name>.md` 创建文档，按以下模板：

```markdown
# <Mixin Name>

> 决议来源：decision XXX §N（如有专项决议）

## 1. 用途

[Mixin 解决什么问题，承载什么共性]

## 2. 字段定义

[ts interface 完整定义 + 每个字段语义 + 默认值]

## 3. 适用节点 / 边

[逐项列出哪些 atom / edge 引用此 Mixin]

## 4. 不包含的字段（边界澄清）

[列出"看起来共有但实际不抽进 Mixin"的字段及理由]

## 5. 影响清单

[Mixin 改动会影响哪些文件 / 代码模块]
```

### 步骤 3：更新本文件

在 §5 当前 Mixin 清单加一行（含名称 / 用途 / 适用节点）。

### 步骤 4：决议立项（如有争议）

若 Mixin 抽取本身有争议（如"是否值得抽"），在 `atom/decisions/<编号>.md` 立项决议。

### 步骤 5：代码实施

在 `src/semantic/mixins/<mixin-name>.ts`（暂留位置，Phase 3 启动 src/semantic/ 时落地）定义 ts interface。各 block / edge attrs 通过 intersection type 引用。

---

## 4. 拒绝的 Mixin 候选（备忘）

`atom/decisions/004-phase2b-resolutions.md` §4 已砍 3 个 Mixin 候选，备忘以便未来回顾：

| 候选 | 砍掉理由 |
|---|---|
| **TableCellAttrs** | 仅 tableCell / tableHeader 2 次重复；且 V2 倾向合并 cell + header（用 isHeader attrs 区分），抽 Mixin 没必要 |
| **LifecycleAttrs** | 仅 taskItem 1 次使用，预防性抽象 = over-engineering；未来出现第二个用户（如 milestone / event）时再抽 |
| **SyntaxMetaMixin** | codeBlock 用 Markdown 标准 `info`，mathBlock 用 KRIG `syntax`，命名不一致 → 强行 Mixin 反而破坏"字段按标准命名"原则 |

→ 未来如这些候选满足"复用次数 ≥ 3 + 字段一致 + 语义一致"，可立项决议升级为正式 Mixin。

---

## 5. 当前 Mixin 清单

| Mixin | 用途 | 适用节点 / 边 | 文档 |
|---|---|---|---|
| **TextFlowAttrs** | 段落级文本流的视觉表达（缩进 / 对齐） | paragraph / heading / blockquote 等 | [text-flow.md](text-flow.md) |
| **MediaResourceAttrs** | 媒体资源的元信息（src / mimeType / size / title） | image / video / audio / fileBlock / externalRef / figure | [media-resource.md](media-resource.md) |

---

## 6. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| M1 | edge attrs 的 AuditAttrs（createdBy / createdAt / confidence 等）是否升级为正式 Mixin（独立文档）？当前在 `relations/spec.md` §3 内联定义 | 暂保持内联定义（仅 1 处使用） | Phase 3+ 视新边 vocabulary 出现时决议 |
| M2 | 未来 Mixin 嵌套 / 组合需求出现时（如 `MediaResourceAttrs` + 某个新 Mixin），是否允许嵌套？还是拒绝并改为引用方各自组合？ | **拒绝嵌套**（保持 §2.3 反 OO 原则） | 未来真出现需求时决议 |

---

## 7. 影响清单

1. **Phase 2c 实施** —— 写 `relations/pm-note.md` 各 block 子文档时，按 §5 清单引用 Mixin。
2. **未来代码实施** —— `src/semantic/mixins/` 下定义对应 ts interface。
3. **Mixin 变更** —— 改动 Mixin 字段必须更新本文件 §5 清单 + 通知所有引用方（在 PR 描述中列出）。
