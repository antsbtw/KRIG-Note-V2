# Decision 004 — Phase 2b 决议合集

> **状态**：已决议（2026-05-11）
> **影响**：`naming-conventions.md` §2.3 / §2.8 / §2.12 / §1.2.1 / §6 / §5 反向更新
> **触发**：Phase 2a 写 RFC 后，需在 Phase 2c（写 `relations/pm-note.md`）启动前消化关键 Open Question + 决议 Mixin 列表

---

## 0. 本决议覆盖的范围

本决议解决 4 个 Phase 2a 遗留问题：

| 编号 | 主题 | 决议结论 |
|---|---|---|
| §1 | **N6 Mark 命名**（bold/italic vs strong/em） | 保留 V1 `bold` / `italic`，登记为阶梯 1 PM 优先规则例外 |
| §2 | **N4 mathBlock 视觉属性**（color / bgColor 保留 vs 删除） | 保留（语义场景下颜色承载意图）+ bgColor 改名 backgroundColor |
| §3 | **N7 V1 image.caption 历史迁移** | 核验发现 V2 已实现 caption 为 content 子节点（优于 RFC 提议），反向更新 RFC |
| §4 | **Mixin 列表** | 保留 2 个（TextFlowAttrs / MediaResourceAttrs），砍 3 个候选 |

---

## §1 N6 — Mark 命名保留 V1 `bold` / `italic`

### 1.1 决议结论

V2 Mark 命名**保留 V1 现状**：

```
mark.type: 'bold' | 'italic' | 'underline' | 'strike' | 'code'
         | 'highlight' | 'textStyle' | 'link'
```

**不**改为 PM / Markdown 标准的 `strong` / `em`。

### 1.2 推理过程

#### 1.2.1 标准对齐 vs 用户意图取舍

| 维度 | 改名（strong / em） | 保留（bold / italic） |
|---|---|---|
| Markdown CommonMark 标准 | ✓ `**text**` → `<strong>` | ✗ 严格意义不对齐 |
| PM `prosemirror-schema-basic` 标准 | ✓ strong / em | ✗ 严格意义不对齐 |
| HTML5 语义化 | strong = 强调（语义），em = 强调（语义） | bold = 视觉粗体（样式），italic = 视觉斜体（样式） |
| **用户编辑器实际意图** | ✗ "我要表达强调" | ✓ "我要让这段视觉粗体 / 斜体" |
| V2 现有代码迁移成本 | 60+ 处使用，文件名 / 字符串 / 测试全量改 | 零成本 |
| 命名一致性（mark 系统） | `strong`/`em` 跟其他 mark `underline`/`strike`/`highlight` 风格不一致 | `bold`/`italic` 与样式型 mark 风格一致 |

#### 1.2.2 决定性论据

**HTML5 规范明确区分 `<strong>` 和 `<b>` 是两个不同元素**：
- `<strong>`：语义化强调
- `<b>`：纯视觉粗体

但**编辑器加粗按钮的用户意图 99% 是"视觉粗体"**（样式意图），不是"强调"（语义意图）。如果命名要严格语义化，那 highlight 也该叫 mark（HTML5 是 `<mark>`），underline 也该叫 ins / u 等 —— 整个 mark 命名体系都要改。

→ V2 选择**保持现状一致性 + 准确反映用户意图**，不追求字面对齐 Markdown 解析输出。

PM 互操作通过 capability.text-editing 的转换层处理（`bold` ↔ `strong` 映射），不影响 V2 内部命名。

### 1.3 例外清单登记

本决议在 `naming-conventions.md §1.2.1 PM 优先规则的例外清单` 加入：

| 概念 | V2 采纳 | 例外类型 | 理由 |
|---|---|---|---|
| 文字加粗 mark | `bold` | "PM 命名语义偏狭" | Markdown / PM 用 `strong` 表达语义强调，但用户编辑场景 99% 是视觉粗体意图。V2 采用样式命名更准确。决议详 decision 004 §1。 |
| 文字斜体 mark | `italic` | 同上 | 同上 |

### 1.4 影响清单

1. V2 mark 命名维持现状（`src/drivers/text-editing-driver/marks/bold.ts` 等不改）。
2. `naming-conventions.md §2.12` 移除"待决议"标签，标"保留 V1"。
3. `naming-conventions.md §5` 命名变更影响表删除 bold→strong / italic→em 两条。
4. `naming-conventions.md §6 N6` 标"已决议（决议 004 §1）"。
5. `naming-conventions.md §1.2.1` 例外清单加 mark 两条。

---

## §2 N4 — mathBlock 视觉属性

### 2.1 决议结论

mathBlock 节点保留 `color` / `backgroundColor` attrs：

```ts
mathBlock.attrs = {
  latex: string;
  color?: string;
  backgroundColor?: string;  // V1 名 bgColor 改名（与 CSS 对齐）
}
```

### 2.2 数学公式中颜色的语义性论证

按 V2 `docs/00-architecture/three-layer.md` 原则 1（语义层不知道视图层），段落级颜色应剥离。

**但数学公式场景下颜色承载语义意图**：

| 场景 | 例子 | 颜色作用 |
|---|---|---|
| 教学公式 | `\textcolor{red}{x}^2 + 2 \textcolor{red}{x} + 1` | 强调"x"是核心变量（视觉装饰不能表达） |
| 错误标注 | `2 + 2 = \textcolor{red}{5}` | 标记错误项（数据本身的一部分） |
| 重要项目高亮 | `E = mc^2` 重要部分加背景色 | 教学重点 |

类比依据：LaTeX `\textcolor{red}{...}` 是**公式语义的一部分**（保存到 LaTeX 源码、跟随文档导出），不是 CSS 装饰层的视觉样式。同理 `\colorbox{yellow}{...}` 是背景色。

**与段落 color 的区别**：

- 段落 `<p style="color: red">` —— 通常是视觉装饰，不承载语义（剥离到视图层）。
- mathBlock `color` —— 承载教学 / 强调意图，是公式内容的一部分。

### 2.3 命名调整

V1 字段名 `bgColor` 改为 `backgroundColor`：

- V1 命名：`bgColor` —— 缩写不规范，CSS 标准是 `background-color`。
- V2 命名：`backgroundColor` —— 与 CSS 标准对齐（camelCase 拼写）。

### 2.4 影响清单

1. V2 mathBlock 节点 attrs 保留 color + backgroundColor。
2. `naming-conventions.md §2.8` 把 `bgColor / color` 从"删除待决议"改为"保留 + 改名 backgroundColor"。
3. `naming-conventions.md §6 N4` 标"已决议（决议 004 §2）"。
4. `naming-conventions.md §5` 命名变更影响表加 `mathBlock.bgColor → backgroundColor`。

---

## §3 N7 — V1 image.caption 历史迁移

### 3.1 决议结论

**核验 V2 现有实现后修正决议方向**：

V2 image 节点已经实现 caption 为 **PM content 子节点**（HTML5 figure 风格），优于 RFC §2.3 提议的"caption 作为 attrs"形态。

→ N7 决议变成：**反向更新 RFC §2.3 对齐 V2 实际实现**，不是"决议 caption 迁移到 alt"。

### 3.2 V2 实际实现状态

V2 image 节点 schema（`src/drivers/text-editing-driver/blocks/image/spec.ts`）：

```ts
{
  content: 'block',     // ← caption 作为内嵌单段 block（通常是 textBlock）
  attrs: {
    src: { default: null },
    alt: { default: '' },         // 替代文本（Markdown 标准）
    title: { default: '' },       // tooltip（Markdown 标准）
    width: { default: null },
    height: { default: null },
    alignment: { default: 'center' },
    atomId: { default: null },    // KRIG 知识图谱挂钩（待 L5-B+ 接入）
    sourcePages: { default: null },
    thoughtId: { default: null },
  },
  // ...
}
```

**关键观察**：
- `caption` **不**是 attrs 字段。
- caption 是 PM content `'block'` 嵌套的子节点 —— 与 HTML5 `<figure><img><figcaption>` 结构完全一致。
- 用户编辑 caption 时，PM 把它当独立段落处理（独立光标 / 独立 marks / 独立 Enter 行为）。
- 节点 attrs 已有 `atomId` / `sourcePages` / `thoughtId` 等 KRIG 知识图谱挂钩占位符。

### 3.3 与 RFC §2.3 的差异

| 项 | RFC §2.3 当前描述 | V2 实际 | 修正方向 |
|---|---|---|---|
| `alt` | attrs 字段 | ✓ attrs 字段 | 无需改 |
| `title` | attrs 字段 | ✓ attrs 字段 | 无需改 |
| `caption` | attrs 字段（暗示） | content 子节点 | **RFC 改正** |
| `alignment` | RFC 未提 | attrs 字段 | RFC 补充 |
| `atomId` / `sourcePages` / `thoughtId` | RFC 未提 | attrs 字段（KRIG 挂钩） | RFC 补充说明（注：这些是边的关联，按"走法 B"应走边表达；属于 V2 当前过渡实现，留待 Phase 2c 决议） |

### 3.4 V1 → V2 迁移路径（未来如需）

V2 当前无 V1 历史数据需迁移。如果未来需要从 V1 真实数据迁：

| V1 字段 | V2 处置 |
|---|---|
| V1 `image.caption: string` | V2 image 节点的 content 子节点（创建一个 textBlock，把 V1 字符串放进去作为段落文本）|
| V1 `image.alt`（如有） | V2 `image.attrs.alt`（直接搬） |
| V1 `image.caption` 同时被当 alt 用的场景 | 人工判断：典型情况搬到 V2 caption 子节点；alt 留空（按 RFC §2.3 "存量迁移期允许为空"） |

### 3.5 KRIG 知识图谱挂钩字段（atomId / sourcePages / thoughtId）的处置

V2 image 节点 attrs 里有 3 个 KRIG 挂钩字段（来自 V1 直迁）：

- `atomId: null` —— 该 image atom 在知识图谱中的对应 atom id
- `sourcePages: null` —— 来源页码（PDF 提取场景）
- `thoughtId: null` —— 思考标注关联

**按 V2 走法 B 原则**，这些字段都应**走边表达**：

- `atomId` → 该 image 节点本身就是 atom，不需要 attrs 引用自己
- `sourcePages` → 走 `*:prov:wasInformedBy` 边的 attrs 扩展
- `thoughtId` → 走 thought 系统（Phase 2c+ 决议）

**当前处置**：保留这些字段作为 V2 → 走法 B 完整切换前的**过渡 attrs**，标"过渡字段，Phase 2c+ 改为边"。

### 3.6 影响清单

1. **反向更新 RFC §2.3** —— 修正 caption 的描述为"PM content 子节点"，补充 alignment 字段，补充 atomId / sourcePages / thoughtId 过渡字段说明。
2. `naming-conventions.md §6 N7` 标"已决议（决议 004 §3）—— V2 已实现且优于 RFC 提议"。
3. `naming-conventions.md §5` 命名变更影响表的 image 行改为 "V2 已实现 caption 为 content 子节点，对齐 HTML5 figure 标准"。
4. **Phase 2c** 写 image 子文档时严格按 V2 实际实现描述（caption 是子节点）+ 标注 KRIG 挂钩字段的过渡状态。

---

## §4 Mixin 列表决议

### 4.1 决议结论

**保留 2 个 Mixin**：

| Mixin | 复用次数 | 适用节点 |
|---|---|---|
| **TextFlowAttrs** | 4+ | paragraph / heading / blockquote / 其他段落级 |
| **MediaResourceAttrs** | 6 | image / video / audio / fileBlock / externalRef / figure |

**砍 3 个候选**：

| 候选 | 砍掉理由 |
|---|---|
| TableCellAttrs | 仅 tableCell / tableHeader 2 次重复；且 V2 倾向合并 tableCell + tableHeader（用 isHeader attrs 区分），抽 mixin 没必要 |
| LifecycleAttrs | 仅 taskItem 1 次使用，预防性抽象 = over-engineering；未来出现第二个用户（如 milestone / event）时再抽 |
| SyntaxMetaMixin | codeBlock 用 Markdown 标准 `info`，mathBlock 用 KRIG `syntax`，命名不一致 → 强行 mixin 反而破坏"字段按标准命名"原则 |

### 4.2 保留 Mixin 的字段定义

#### TextFlowAttrs

```ts
interface TextFlowAttrs {
  textIndent?: boolean;     // 段落首行缩进（CSS text-indent 风格）
  indent?: number;          // 整段缩进层级（CSS padding-left 风格，0 = 无缩进）
  align?: 'left' | 'center' | 'right' | 'justify';
}
```

适用节点：paragraph、heading、blockquote、（未来）类似的段落级节点。

#### MediaResourceAttrs

```ts
interface MediaResourceAttrs {
  src: string;              // 资源 URL（http / https / data: / media://）
  mimeType?: string;        // MIME 类型
  size?: number;            // 字节数
  title?: string;           // tooltip / 显示名
}
```

适用节点：image、video、audio、fileBlock、externalRef、figure。

**注意不包含**：
- `alt`（image 专属，Markdown 语义不同）
- `caption`（image / figure / video / audio 各自的 content 子节点处理，不是 attrs）
- `width` / `height`（image 专属）
- `duration` / `poster`（video / audio 专属）
- `alignment`（V2 image 独有）

→ Mixin **只抽真正全部共有的字段**，节点专属字段保留在节点自己。

### 4.3 Mixin 文档结构

```
data-model/mixins/
├── spec.md                   Mixin 总览 + 设计原则
├── text-flow.md              TextFlowAttrs 完整定义
└── media-resource.md         MediaResourceAttrs 完整定义
```

**spec.md 包含**：
- §1 Mixin 是什么（数据形状复用，不是行为继承）
- §2 适用范围（atom payload / edge attrs）
- §3 命名约定（`<Concept>Attrs` 后缀）
- §4 注册流程
- §5 当前 Mixin 清单（链接 text-flow.md / media-resource.md）
- §6 拒绝的 Mixin（备忘 TableCellAttrs / LifecycleAttrs / SyntaxMetaMixin 砍掉理由）

### 4.4 影响清单

1. Phase 2c 起新建 `data-model/mixins/` 目录 + 3 个文件（spec / text-flow / media-resource）。
2. `relations/pm-note.md` 写 block 子文档时，paragraph / heading / blockquote 引用 TextFlowAttrs；image / video / audio / fileBlock / externalRef / figure 引用 MediaResourceAttrs。
3. 后续如发现新 Mixin 候选 → 单独 decision 立项（如 decision 005 / 006 ...）。

---

## §5 本决议触发的 naming-conventions.md 反向更新清单

详见各决议的"影响清单"段，汇总如下：

| naming-conventions.md 位置 | 变更动作 |
|---|---|
| §1.2.1 PM 优先例外清单 | 新增 mark `bold` / `italic` 例外两条 |
| §2.3 image 字段表 | 修正 caption 为 content 子节点；补 alignment / atomId / sourcePages / thoughtId 说明 |
| §2.8 mathBlock color / bgColor | 改为"保留 + bgColor 改名 backgroundColor" |
| §2.12 Mark 命名表 | 移除 `bold` / `italic` 的"待决议"标识，标"保留 V1 命名（例外）" |
| §5 命名变更影响表 | 删除 bold→strong / italic→em；加 bgColor→backgroundColor；image 行改"V2 已实现" |
| §6 N4 / N6 / N7 | 全部标"已决议（决议 004）" |

---

## §6 Phase 2c 启动条件

Phase 2c（写 `relations/pm-note.md`）启动条件：

1. ✓ Phase 2a RFC commit（commit `5095ec9`）。
2. ✓ Phase 2b 决议 commit（本决议）。
3. ✓ naming-conventions.md 反向更新到位（决议 004 §5 清单）。
4. ✓ Mixin 列表敲定（决议 004 §4）。
5. ⏭ Phase 2c 任务：
    - 新建 `mixins/` 目录及 3 文件（spec / text-flow / media-resource）
    - 写 `relations/pm-note.md` 主索引（按 Phase 2 §"分批策略"，先写批 1）
    - 按 Phase 2c 实施清单逐项推进
