# TextFlowAttrs

> **决议来源**：`atom/decisions/004-phase2b-resolutions.md` §4
> **Mixin 类型**：atom payload mixin
> **状态**：已决议

---

## 1. 用途

承载**段落级文本流**的视觉表达属性（首行缩进 / 整段缩进 / 水平对齐）。

跨多个段落级 block 共享这一组属性，避免在每个 block attrs 里重复定义。

---

## 2. 字段定义

```ts
interface TextFlowAttrs {
  /**
   * 段落首行缩进
   *   true  = 启用首行缩进（如中文论文格式两个字符缩进）
   *   false = 不缩进（默认）
   *
   * 命名依据: CSS text-indent 风格
   */
  textIndent?: boolean;

  /**
   * 整段缩进层级
   *   0 = 无缩进（默认）
   *   N = N 层缩进，每层缩进幅度由渲染层决定
   *   范围: [0, 6]，超过 6 由渲染层决定是否限制
   *
   * 命名依据: CSS padding-left 风格
   */
  indent?: number;

  /**
   * 水平对齐
   *   'left'    = 左对齐（默认）
   *   'center'  = 居中
   *   'right'   = 右对齐
   *   'justify' = 两端对齐
   *
   * 命名依据: CSS text-align + GFM 表格 align 标准
   */
  align?: 'left' | 'center' | 'right' | 'justify';
}
```

### 2.1 默认值约定

| 字段 | 默认值 | 含义 |
|---|---|---|
| `textIndent` | `false` | 不缩进 |
| `indent` | `0` | 无缩进层级 |
| `align` | `'left'` | 左对齐（中文 / 英文都是从左开始） |

所有字段都是 `?` 可选 —— 缺省时按默认值处理。**写入时**不强制要求带这些字段（节省 schema 大小）。

### 2.2 字段语义边界

- **textIndent vs indent**：textIndent 仅影响第一行（CSS `text-indent`），indent 影响整段（CSS `padding-left`）。两者可以同时启用（一段同时有首行缩进和整段缩进），互不冲突。
- **align 不影响 justify-content**：align 只是文字水平对齐，不影响整个 block 在容器中的位置。block 在容器中的位置由父级 layout 决定，不属于 TextFlowAttrs 范围。

---

## 3. 适用节点

V2 第一波引用 TextFlowAttrs 的节点：

| 节点 type | V2 节点状态 | 引用形式（目标态） | V2 当前 attrs |
|---|---|---|---|
| `paragraph` | ✅ 已实现（decision 005 / commit `c9ae4e4`） | `attrs: TextFlowAttrs & { isTitle: boolean }` | V2 当前 paragraph.attrs 只有 `isTitle`。TextFlowAttrs 三字段（textIndent / indent / align）**待 Phase 2c 引入** |
| `heading` | ✅ 已实现（decision 005 D2，level 1-6） | `attrs: TextFlowAttrs & { level: 1..6 }` | V2 当前 heading.attrs 只有 `level`。TextFlowAttrs 三字段**待 Phase 2c 引入** |
| `blockquote` | ✅ 已实现（V2 既有） | `attrs: TextFlowAttrs` | V2 当前 blockquote.attrs 待核验。TextFlowAttrs 字段引入**待 Phase 2c** |

**Phase 2c 实施动作**：将 TextFlowAttrs 的三个字段（textIndent / indent / align）作为新增 attrs 添加到 paragraph / heading / blockquote 节点 spec.ts。本 Mixin 文档为代码实施提供权威字段定义。

**未来候选**（Phase 2c 后视需要）：
- noteTitle-style block：V2 已用 `paragraph.attrs.isTitle: true` 实现（**不是** `heading level=1`，按 decision 005 D1），不需新节点
- callout / toggle 等容器 block —— 视真实场景决定（可能仅需 align 不需 indent）

---

## 4. 不包含的字段（边界澄清）

下列字段**看起来**像段落级文本属性，但**不**进 TextFlowAttrs：

| 字段 | 不抽进 Mixin 的理由 |
|---|---|
| `lineHeight` | 视觉装饰层（CSS line-height），非语义；归视图层 |
| `textDecoration`（underline / line-through 等） | 是 mark 系统的职责（每段文字独立的修饰），不是段落级 |
| `fontFamily` / `fontSize` / `color` | 纯视觉装饰，归视图层；如需 KRIG 语义颜色另议 |
| `direction`（ltr / rtl） | 文本方向是文档级 / 语言级属性，不是段落级；归 i18n 层 |
| `level`（heading 专用） | 只有 heading 用，非共有；heading 自己加 |

---

## 5. PM schema 表示

V2 paragraph / heading / blockquote 的 PM schema 实现示例（具体在 Phase 2c block 子文档展开）：

```ts
// paragraph node spec
{
  attrs: {
    textIndent: { default: false },
    indent: { default: 0 },
    align: { default: 'left' },
  },
  content: 'inline*',
  parseDOM: [{ tag: 'p', getAttrs: el => ({ ... }) }],
  toDOM: node => ['p', { ... }, 0],
}
```

具体 PM schema 写法（parseDOM / toDOM 实现）由 `capability.text-editing` 提供，本 Mixin 文档不涉及实现细节。

---

## 6. 影响清单

### 6.1 Mixin 改动的影响

如未来修改 TextFlowAttrs（如加 `align: 'right-to-left'`）：

- 影响所有引用节点（paragraph / heading / blockquote）。
- 必须**同时**更新本文件 §2 字段定义 + 所有引用节点的子文档。
- 必须更新 `naming-conventions.md` §2.4 段落 / 文本流相关字段表。

### 6.2 Phase 2c 实施清单

1. 写 `relations/pm-note.md` 主索引时，paragraph / heading / blockquote 三个 block 子文档**必须**显式引用 TextFlowAttrs（不再单独列重复字段）。
2. 子文档格式示例：

```markdown
## paragraph

### attrs

引用 `TextFlowAttrs`（详 `data-model/mixins/text-flow.md`），无额外字段。
```

3. **未来代码实施**：`src/semantic/mixins/text-flow.ts` 定义 ts interface；`src/drivers/text-editing-driver/blocks/paragraph/spec.ts` 等节点 spec 引用之。
