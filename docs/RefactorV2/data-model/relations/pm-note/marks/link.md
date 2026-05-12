# link mark

> **Status**: V2 已实现 ✓（L5-B3.4）
> **Source**: `src/drivers/text-editing-driver/marks/link.ts`

---

## 1. 语义边界

`link` 是**行内超链接** mark —— 对应 HTML `<a href>`、Markdown `[text](href "title")`。

### 1.1 形态特征

- **inline mark**，可叠加在 text 上。
- **attrs**：`href`（必填）+ `title`（可选）。
- **inclusive: false** —— 光标在链接末尾输入新字符**不**延长链接（与 V1 一致，避免误扩展）。
- **5 协议支持**（配 link-click plugin）：
  - `krig://note/{id}` —— 跳到 right slot note
  - `krig://block/{id}/{anchor}` —— 同文档当场滚 / 跨文档 right slot + 滚动
  - `https://...` / `http://...` —— Electron `shell.openExternal`
  - `file://...` —— Electron `shell.openPath`
  - `media://...` —— 留 viewAPI 阶段

### 1.2 link vs noteLink vs fileLink

| 场景 | 类型 |
|---|---|
| 普通超链接 `[text](url)` | `link` mark（包裹任意 text） |
| 笔记内部引用 `[[Other Note]]` | `noteLink` 节点（独立 inline atom，详 [note-link.md](../inlines/note-link.md)） |
| 段落内附件 chip | `fileLink` 节点（独立 inline atom，详 [file-link.md](../inlines/file-link.md)） |

**核心区别**：
- `link` 是 mark（叠加在文字上，文字可编辑）
- `noteLink` / `fileLink` 是 atom 节点（独立单元，整体选中 / 删除）

---

## 2. type 字段值

```ts
mark.type: 'link'
```

PM / HTML / Markdown 标准命名（阶梯 1）。

---

## 3. attrs schema

| 字段 | 类型 | 默认值 | 含义 | 命名依据 |
|---|---|---|---|---|
| `href` | `string` | 无（必填） | 链接目标 URL | 阶梯 1（Markdown / HTML 标准） |
| `title` | `string \| null` | `null` | tooltip / 鼠标悬停文字 | 阶梯 1（Markdown `[text](href "title")` 标准） |

---

## 4. 互斥规则

无（link 可与任何 mark 叠加，如 bold link / italic link）。

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
{
  type: 'text',
  text: 'Click here',
  marks: [{ type: 'link', attrs: { href: 'https://example.com', title: 'Example' } }]
}
```

叠加其他 mark：

```ts
{ type: 'text', text: 'bold link', marks: [
  { type: 'bold' },
  { type: 'link', attrs: { href: 'https://...', title: null } }
]}
```

### 5.2 parseDOM / toDOM

```ts
parseDOM: [
  {
    tag: 'a[href]',
    getAttrs(node) {
      const el = node as HTMLElement;
      return {
        href: el.getAttribute('href'),
        title: el.getAttribute('title'),
      };
    },
  },
]
toDOM(mark) {
  const href = mark.attrs.href as string;
  const title = mark.attrs.title as string | null;
  const attrs: Record<string, string> = { href };
  if (title) attrs.title = title;
  return ['a', attrs, 0];
}
```

### 5.3 Markdown 互转

| 方向 | 转换 |
|---|---|
| MD → link | `[text](href "title")` → text node + link mark |
| link → MD | `[<text>](<href> "<title>")`（title 可选） |

### 5.4 可逆性

| 路径 | 是否无损 |
|---|---|
| link ↔ PM doc | ✓ 完全无损 |
| link → Markdown → link | ✓ 完全无损（CommonMark 标准支持 href + title） |

---

## 6. V1 → V2 处置

V1 `link` —— 同名 mark + 相同 attrs（href + title）。V2 直搬。

注意：V1 把 link 当作 inline node（`{ type: 'link', children: [...] }`），V2 改为 mark（更符合 PM 标准）。

### 6.1 V1 数据迁移

V1 LinkNode 形态：
```ts
{ type: 'link', href: '...', title: '...', children: [{ type: 'text', text: 'Click' }] }
```

V2 改为 mark 叠加在 text 上：
```ts
function migrateV1Link(v1Link: V1LinkNode): V2TextWithMark[] {
  return v1Link.children.map(child => ({
    ...child,
    marks: [
      ...(child.marks ?? []),
      { type: 'link', attrs: { href: v1Link.href, title: v1Link.title ?? null } },
    ],
  }));
}
```

→ 详 [decision 002 §"V1 InlineElement / Mark 判定"](../../atom/decisions/002-v1-fields-migration.md)。

---

## 7. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| P-LK-1 | `krig://block/{id}/{anchor}` 协议是否走边表达？（跨 atom 锚点引用应该是边） | **保留 mark + href 实现**（V2 现状） | Phase 3+ 视 KRIG 知识图谱业务 |
| P-LK-2 | `media://` 协议是否启用？V2 当前注释"留 viewAPI 阶段" | **暂不启用**，等 viewAPI 决议 | Phase 2c+ |
| P-LK-3 | inclusive: false 行为是否仍合理？（与 V1 一致） | **保留 V1 行为** | 不调整 |

---

## 8. 参考来源

- `src/drivers/text-editing-driver/marks/link.ts`
- Markdown CommonMark link 标准 / HTML5 `<a href>`
- Electron `shell.openExternal` / `shell.openPath` API
- [decisions/002 §"V1 InlineElement / Mark 判定"](../../atom/decisions/002-v1-fields-migration.md)（V1 link node → V2 link mark 重构）
