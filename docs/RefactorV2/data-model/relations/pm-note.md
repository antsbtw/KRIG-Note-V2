# pm-note —— pm atom 如何组成一篇 note

> **Phase**: 2c（pm domain 业务展开 / 主索引）
> **状态**: 撰写中（批 1 进行）
> **参考依据**: `atom/spec.md` + `mixins/spec.md` + `decisions/004` + `decisions/005` + `naming-conventions.md`

---

## 0. 本文档定位

本文档定义 **pm domain 的 atom 如何组成一篇 note**：

- Note 的整体结构（root / noteTitle / 块序列）
- V2 已注册的 PM block / inline / mark 完整清单
- 每个 block / inline / mark 的 schema 细节（含 attrs / content / 嵌套规则）
- 与 V2 现有实现 (`src/drivers/text-editing-driver/`) 的对齐状态

子文档放在 `relations/pm-note/blocks/` / `relations/pm-note/inlines/` / `relations/pm-note/marks/` 下，每节点一份。

---

## 1. Note 整体结构

### 1.1 Root 节点 (doc)

V2 schema 框架（`src/drivers/text-editing-driver/schema-builder.ts:36-37`）强制：

```
doc:  { content: 'block+' }
text: { group: 'inline' }
```

- `doc` 由 schema-builder 框架提供，不是 BlockSpec 注册的 block。
- `text` 是 PM 默认 inline 节点，由 schema-builder 框架提供。
- **任何 block** 都属于 `'block'` group（含 paragraph / heading / blockquote / list / 等）。
- **inline 节点**（如 mathInline / codeInline / noteLink）属于 `'inline'` group。

### 1.2 noteTitle 守门约束

按 [decision 005 D1](../atom/decisions/005-block-schema-decomposition.md#1-改造目标-what)，**noteTitle 是 paragraph 的特殊形态**（`paragraph.attrs.isTitle: true`），不是独立节点也不是 heading level=1。

由 `title-guard plugin` 维护：

1. **doc 必须以 `paragraph.attrs.isTitle: true` 开头** — 若被删 / 改类型，appendTransaction 自动补回。
2. **title 内不允许换行** — paste 时只取第一行；Enter 跳到下一段。
3. **title 不允许 turnInto 任何类型** — Slash / handle 命令对 title block 直接 noop。

### 1.3 Note 整体形态示例

```ts
{
  format: 'pm-doc-json',
  version: '0.1',
  payload: {
    type: 'doc',
    content: [
      { type: 'paragraph', attrs: { isTitle: true }, content: [{ type: 'text', text: '我的笔记' }] },
      { type: 'paragraph', attrs: { isTitle: false }, content: [{ type: 'text', text: '正文段落…' }] },
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '章节标题' }] },
      { type: 'bulletList', content: [
        { type: 'listItem', content: [
          { type: 'paragraph', attrs: { isTitle: false }, content: [{ type: 'text', text: '列表项' }] }
        ]}
      ]},
    ]
  }
}
```

---

## 2. V2 已注册节点清单（28 个 + 8 marks）

按 `Host.tsx:60-88` ENABLED_BLOCKS 列表 + `marks/index.ts` MARKS 实际注册。

### 2.1 文本流 block（3 个）

| 节点 type | 含义 | 子文档 | 状态 |
|---|---|---|---|
| `paragraph` | 普通段落 + noteTitle | [blocks/paragraph.md](pm-note/blocks/paragraph.md) | ✓ 批 1 |
| `heading` | 章节标题（level 1-6） | [blocks/heading.md](pm-note/blocks/heading.md) | ✓ 批 1 |
| `blockquote` | 引用块 | [blocks/blockquote.md](pm-note/blocks/blockquote.md) | ✓ 批 2 |

注：`hardBreak` 是 inline 节点（`group: 'inline'`），归 §2.7。

### 2.2 列表 block（5 个）

| 节点 type | 子文档 | 状态 |
|---|---|---|
| `bulletList` | [blocks/bullet-list.md](pm-note/blocks/bullet-list.md) | ✓ 批 2 |
| `orderedList` | [blocks/ordered-list.md](pm-note/blocks/ordered-list.md) | ✓ 批 2 |
| `listItem` | [blocks/list-item.md](pm-note/blocks/list-item.md) | ✓ 批 2 |
| `taskList` | [blocks/task-list.md](pm-note/blocks/task-list.md) | ✓ 批 2 |
| `taskItem` | [blocks/task-item.md](pm-note/blocks/task-item.md) | ✓ 批 2 |

### 2.3 渲染块 block（3 个）

| 节点 type | 子文档 | 状态 |
|---|---|---|
| `codeBlock` | [blocks/code-block.md](pm-note/blocks/code-block.md) | ✓ 批 2 |
| `mathBlock` | [blocks/math-block.md](pm-note/blocks/math-block.md) | ✓ 批 2 |
| `horizontalRule` | [blocks/horizontal-rule.md](pm-note/blocks/horizontal-rule.md) | ✓ 批 1 |

注：V2 实际 id 为驼峰命名（`horizontalRule`），不是 `horizontal-rule`。

### 2.4 媒体 block（6 个）

| 节点 type | 子文档 | 状态 |
|---|---|---|
| `image` | （批 3 待写） | ⏳ |
| `fileBlock` | （批 3 待写） | ⏳ |
| `audioBlock` | （批 3 待写） | ⏳ |
| `videoBlock` | （批 3 待写） | ⏳ |
| `tweetBlock` | （批 3 待写） | ⏳ |
| `externalRef` | （批 3 待写） | ⏳ |

注：`externalRef` 实际 `group: 'block'` + `atom: true`（block atom 节点），跟 `image` / `fileBlock` 等媒体 block 同类，**不**是 inline 节点。

### 2.5 容器装饰 block（2 个）

| 节点 type | 子文档 | 状态 |
|---|---|---|
| `callout` | [blocks/callout.md](pm-note/blocks/callout.md) | ✓ 批 2 |
| `toggleList` | [blocks/toggle-list.md](pm-note/blocks/toggle-list.md) | ✓ 批 2 |

### 2.6 表格 block（4 个）

| 节点 type | 子文档 | 状态 |
|---|---|---|
| `table` | （批 3 待写） | ⏳ |
| `tableRow` | （批 3 待写） | ⏳ |
| `tableCell` | （批 3 待写） | ⏳ |
| `tableHeader` | （批 3 待写） | ⏳ |

### 2.7 inline 节点（4 个）

| 节点 type | 含义 | 子文档 | 状态 |
|---|---|---|---|
| `mathInline` | 行内数学公式 atom | [inlines/math-inline.md](pm-note/inlines/math-inline.md) | ✓ 批 1 |
| `noteLink` | 笔记内部链接 `[[note-title]]` atom | [inlines/note-link.md](pm-note/inlines/note-link.md) | ✓ 批 1 |
| `hardBreak` | 软换行 inline atom（Shift-Enter） | [inlines/hard-break.md](pm-note/inlines/hard-break.md) | ✓ 批 1 |
| `fileLink` | 文件链接 atom | （批 3 待写） | ⏳ |

**身份说明**：
- `text` 是 PM 默认 inline 节点，由 schema-builder 框架提供，不需要 BlockSpec 注册，也不需要独立子文档（PM 标准）。
- `code` 是 **mark**（[marks/basic-marks.md](pm-note/marks/basic-marks.md)），不是 inline 节点。V2 当前 `src/drivers/text-editing-driver/marks/code.ts` 实际是 `MarkSpec`。"codeInline 节点"这一概念在 V2 不存在 —— 行内代码通过给 text 节点叠加 `code` mark 实现。

### 2.8 占位块（1 个）

| 节点 type | 含义 | 子文档 | 状态 |
|---|---|---|---|
| `unknown` | 未知节点占位（转换器 fallback） | [blocks/unknown.md](pm-note/blocks/unknown.md) | ✓ 批 2 |

### 2.9 Mark（8 个）

| Mark type | 含义 | 子文档 | 状态 |
|---|---|---|---|
| `bold` | 视觉粗体 | [marks/basic-marks.md](pm-note/marks/basic-marks.md) | ✓ 批 1 |
| `italic` | 视觉斜体 | 同上 | ✓ 批 1 |
| `underline` | 下划线 | 同上 | ✓ 批 1 |
| `strike` | 删除线 | 同上 | ✓ 批 1 |
| `code` | 行内代码 | 同上 | ✓ 批 1 |
| `textStyle` | 文字样式 mark（携带 color） | （批 3 待写） | ⏳ |
| `highlight` | 高亮（携带 color） | （批 3 待写） | ⏳ |
| `link` | 超链接 | （批 3 待写） | ⏳ |

`bold` / `italic` 保留 V1 命名（按 [decision 004 §1](../atom/decisions/004-phase2b-resolutions.md#1-n6--mark-命名保留-v1-bold--italic) PM 优先例外）。

---

## 3. 框架级 attrs（规范影响说明）

V2 schema 框架对所有 `group: 'block'` 节点自动注入 `indent` attrs（默认 `0`）。引用：`src/drivers/text-editing-driver/schema-builder.ts`。

**对本文档的影响**：[`mixins/text-flow.md`](../mixins/text-flow.md) 中 TextFlowAttrs 的 `indent` 字段 V2 schema 层面已存在；Phase 2c 引入 TextFlowAttrs 时只需新增 `textIndent` / `align` 到节点级 attrs，`indent` 不需要在节点级重复声明。

### 3.1 字段优先级规则（强制约定）

**framework-injected > node-declared**：同名字段若已由 schema 框架注入（如 `indent`），节点级 attrs **不重复声明**。

适用范围：所有 block 子文档（`pm-note/blocks/*.md`）写 §3 attrs schema 时，按此规则区分"框架级"与"节点级"两段，避免歧义和 schema 重复声明错误。

---

## 4. 子文档模板

每个 block / inline / mark 子文档统一用 7 节模板：

```markdown
# <NodeName>

> **Status**: V2 已实现 ✓ / 待实施 ⏳
> **Source**: src/drivers/text-editing-driver/blocks/<name>/spec.ts （如有）

## 1. 语义边界

[节点是什么，跟相邻节点的区别，为什么独立成 block]

## 2. type 字段值

[type 字符串字面量]

## 3. attrs schema

[字段表 + 取值 + 默认值 + 命名依据（哪个标准）]

## 4. content 嵌套规则

[content 表达式 + 允许的子节点类型 + 嵌套深度约束]

## 5. 转换契约

[atom ↔ PM doc 可逆性 + Markdown 互转的有损边界 + parseDOM / toDOM 概要]

## 6. V1 → V2 处置

[V1 该节点原本叫什么、字段是什么、V2 怎么处置（直搬 / 重命名 / 拆分 / 删除）]

## 7. Open Questions（如有）

[本节点引入的新决议项]
```

---

## 5. 与现有规范文档的引用关系

| 上游 | 本文件如何引用 |
|---|---|
| `atom/spec.md` | pm atom 通用接口 + Domain 注册治理（domain='pm'） |
| `mixins/spec.md` + `mixins/text-flow.md` + `mixins/media-resource.md` | block 子文档 §3 attrs 引用 Mixin |
| `naming-conventions.md` | 子文档 §3 字段命名时引用三阶梯 + 字段对照表 |
| `decisions/002` | 子文档 §6 V1 → V2 处置部分引用 |
| `decisions/003` | 边命名 / 走法 B 原则在跨节点关系时引用 |
| `decisions/004` | N6 mark 命名 / N4 mathBlock color / Mixin 砍掉理由 |
| `decisions/005` | paragraph / heading 拆分实施记录 |
| `relations/spec.md` | 跨 atom 关系（如 derived_from / linksTo）在子文档"跨节点引用"部分引用 |

---

## 6. Open Questions（本文档引入的）

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| PM1 | mixins/text-flow.md 中 `indent` 字段与 schema-builder 框架级 `indent` 注入冲突 —— Mixin 是否要去掉 indent，只保留 textIndent / align？ | **Mixin 保留 indent 概念**作为 schema 标识；实施时框架级已有则跳过节点级 attrs，避免重复 | Phase 2c 写 paragraph / heading 子文档时按节点详细决议 |
| PM2 | `unknown` block 的语义边界 —— V1 兼容字段还是 V2 转换器 fallback 标准节点？ | **作为转换器 fallback 节点**，未识别的旧数据降级显示 | 批 2 写 unknown 子文档时具体定义 |
| PM3 | `text` 节点不需要独立子文档（PM 默认），但是否需要在本文档显式登记一份？ | 不登记独立子文档，仅在 §2.7 注释说明 | （本文档采纳） |
| PM4 | 24+ 子文档分批节奏：批 1 (核心 paragraph/heading/hard_break + 4 inline + basic-marks ~9 份) → 批 2 (列表 + 容器 + code/math ~10 份) → 批 3 (媒体 + 表格 + 剩余 mark ~10 份) | 同上分批 | 实施中 |

---

## 7. 实施路线图

### 批 1（当前进行）

主索引 + 7 份子文档（**全部完成 ✓**）：

- ✓ `pm-note.md`（本文件）—— 主索引
- ✓ `pm-note/blocks/paragraph.md` —— sample（已审计通过）
- ✓ `pm-note/blocks/heading.md`
- ✓ `pm-note/blocks/horizontal-rule.md`
- ✓ `pm-note/inlines/math-inline.md`
- ✓ `pm-note/inlines/note-link.md`
- ✓ `pm-note/inlines/hard-break.md` —— V2 id 实际是驼峰 `hardBreak`，文件名仍用 kebab 与目录风格一致
- ✓ `pm-note/marks/basic-marks.md` —— bold / italic / underline / strike / code 五合一

**身份核验后取消的子文档**：
- `text` —— PM 默认 inline 节点（主索引 §2.7 说明即可，不独立成文档）
- `code-inline` —— V2 实际是 mark 不是节点（`src/drivers/text-editing-driver/marks/code.ts` 为 `MarkSpec`），在 basic-marks.md 中处理

### 批 2（已完成 ✓）

11 份子文档：

- ✓ `blocks/blockquote.md`
- ✓ `blocks/bullet-list.md`
- ✓ `blocks/ordered-list.md`
- ✓ `blocks/list-item.md`
- ✓ `blocks/task-list.md`
- ✓ `blocks/task-item.md`
- ✓ `blocks/callout.md`
- ✓ `blocks/toggle-list.md`
- ✓ `blocks/code-block.md`
- ✓ `blocks/math-block.md`
- ✓ `blocks/unknown.md`

### 批 3（批 2 审过后启动）

约 10 份：image / fileBlock / audio / video / tweet / table 系列 / fileLink / externalRef / textStyle / highlight / link。

---

**当前批 1 进度**：主索引（本文件）+ paragraph sample 审计通过。继续铺批 1 其余 6 份子文档。
