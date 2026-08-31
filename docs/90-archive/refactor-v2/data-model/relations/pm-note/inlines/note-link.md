# noteLink

> **Status**: V2 已实现 ✓
> **Source**: `src/drivers/text-editing-driver/blocks/note-link/spec.ts`

---

## 1. 语义边界

`noteLink` 是**笔记内部链接** inline atom 节点 —— 在文字流中嵌入对其他 note 的引用，类似 Obsidian / Roam 的 `[[note-title]]` 双链。

### 1.1 形态特征

- **inline 节点**（`inline: true` + `group: 'inline'`）。
- **atom**（`atom: true`）—— 光标不能进入节点内部。
- **承载目标 note id + label**：
  - `noteId`：目标 note 的存储 id（noteStore 中的 `note-<n>`）；`null` 表示失效引用。
  - `label`：派生自目标 `note.title`，NodeView mount 时同步一次（不实时跟随重命名）。
- **渲染**：`📄 <label>` 由 NodeView 接管。
- **触发**：`[[` 输入由 `build-note-link-command-plugin` 监听，弹出搜索面板。

### 1.2 noteLink vs fileLink vs link mark

| 场景 | 类型 |
|---|---|
| 引用其他笔记 `[[Other Note]]` | `noteLink` 节点 |
| 引用本地文件 `[[file:path]]` | `fileLink` 节点（批 3） |
| 普通超链接 `[text](url)` | `link` mark（批 3） |
| 引用外部资源（PDF / URL） | `externalRef` block 节点（批 3，归媒体 block 类别，非 inline） |

---

## 2. type 字段值

```ts
type: 'noteLink'
```

V2 实际 id 是驼峰 `noteLink`。

---

## 3. attrs schema

### 3.1 节点级 attrs

| 字段 | 类型 | 默认值 | 含义 | 命名依据 |
|---|---|---|---|---|
| `noteId` | `string \| null` | `null` | 目标 note 的存储 id（如 `'note-42'`）；null 表示失效 | KRIG 自定义（阶梯 3） |
| `label` | `string` | `''` | 显示文字，派生自 `note.title`，mount 时同步 | KRIG 自定义（阶梯 3） |

### 3.2 框架级注入 attrs

⚠ `noteLink` 是 inline 节点，**不**被框架级 `indent` 注入。

### 3.3 Mixin 引用

不引用任何 Mixin（KRIG 链接专属字段无共性）。

### 3.4 label 同步策略

V2 当前实现：**label 在 NodeView mount 时从目标 note.title 派生一次**，**不**实时跟随目标 note 重命名。

这是个**已知行为**（V1 直迁），保留至 Phase 2c+ 决议是否升级为"实时同步"或"按需 fetch"。

---

## 4. content 嵌套规则

```ts
content: undefined  // atom 叶子
inline: true
group: 'inline'
atom: true
```

`noteLink` 是 inline atom 叶子，**不接受任何子节点**。

可被嵌入所有 `inline*` content（paragraph / heading / listItem 内 paragraph / tableCell 内 paragraph / 等）。

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
{ type: 'noteLink', attrs: { noteId: 'note-42', label: 'Other Note' } }
```

### 5.2 parseDOM / toDOM

```ts
parseDOM: [
  {
    tag: 'span.krig-note-link',
    getAttrs(node) {
      const el = node as HTMLElement;
      return {
        noteId: el.getAttribute('data-note-id') || null,
        label: el.textContent?.replace(/^📄\s*/, '') || '',
      };
    },
  },
]
toDOM(node) {
  return [
    'span',
    { class: 'krig-note-link', 'data-note-id': node.attrs.noteId ?? '' },
    `📄 ${node.attrs.label || 'Untitled'}`,
  ];
}
```

### 5.3 leafText（纯文本复制 / textBetween）

V2 实现：`leafText: [[<label>]]` —— 对齐 mathInline 的 leafText 设计；剪贴板 / 文本提取还原源码 `[[Other Note]]`。

### 5.4 Markdown 互转

| 方向 | 转换 |
|---|---|
| MD → noteLink | `[[Note Title]]` → `noteLink({ label: 'Note Title', noteId: <lookup> })`，依赖 wiki-link 扩展 |
| noteLink → MD | `[[<label>]]` |

CommonMark 标准**不包含**双链语法，wiki-link 是社区扩展（Obsidian / Roam 风格）。

### 5.5 跨笔记关系（走边表达）

按 [decision 003](../../atom/decisions/003-naming-conventions.md) 走法 B，noteLink 表达的"note A 引用 note B"关系**应该走边**（不是 atom 字段）。但 V2 当前 noteLink 的 `noteId` attrs 是直接引用，属于过渡实现。

Phase 2c+ 决议是否走 `user:linksTo` 边表达，并把 noteId 字段标"过渡 attrs"。

### 5.6 可逆性

| 路径 | 是否无损 |
|---|---|
| noteLink ↔ PM doc | ✓ noteId + label 字段全保留 |
| noteLink → Markdown → noteLink | ⚠ 部分有损：noteId 丢失（仅从 label 反查目标，依赖标题唯一性） |

---

## 6. V1 → V2 处置

### 6.1 V1 原状

V1 `note-link`（kebab）—— inline atom，attrs: { noteId, title }。

### 6.2 V2 处置

- id 改驼峰：`note-link` → `noteLink`
- attrs `title` 改名 `label`（与 V2 当前实现一致，避免与 PM 标准 link mark 的 title 字段混淆）

### 6.3 V1 数据迁移

```ts
function migrateNoteLink(v1: V1NoteLink): V2NoteLink {
  return {
    type: 'noteLink',
    attrs: {
      noteId: v1.attrs.noteId,
      label: v1.attrs.title,  // V1 'title' → V2 'label'
    },
  };
}
```

---

## 7. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| P-NL-1 | noteId 是否走 `user:linksTo` 边？（按走法 B 应该走边） | **保留 attrs.noteId 为过渡实现**，Phase 2c+ 决议升级 | Phase 2c+ relations/pm-derived.md |
| P-NL-2 | label 是否实时跟随目标 note 重命名？V1 不跟随 | **保留 V1 行为**（mount 时同步一次） | Phase 2c+ 视用户反馈 |
| P-NL-3 | 失效 noteLink（noteId = null）如何渲染？显示灰色斜体 / 提示用户修复？ | **当前显示 `📄 Untitled`**（未明确"失效"视觉标识） | 实施时核验 capability.text-editing 视觉 |

---

## 8. 参考来源

- `src/drivers/text-editing-driver/blocks/note-link/spec.ts`
- [decision 003 §3 走法 B](../../atom/decisions/003-naming-conventions.md)（属性走边原则）
- [`relations/spec.md` §1.3](../../relations/spec.md)（vocabulary `krig` 命名空间）
- Obsidian wiki-link 规范（V1 设计灵感）
