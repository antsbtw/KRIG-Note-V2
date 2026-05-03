# PDF → Note Atom 数据契约

> 版本：v2.0 | 日期：2026-04-08
> 基于 KRIG-Note Atom 体系（`src/shared/types/atom-types.ts`），替代 mirro-desktop 的 v1 契约。
> 后端 `glm-ocr-service` 输出必须符合本契约。

---

## 〇、与 v1 的关键差异

| | **v1（mirro-desktop，已废弃）** | **v2（KRIG-Note）** |
|---|---|---|
| Atom type 命名 | kebab-case: `math-block`, `code-block` | camelCase: `mathBlock`, `codeBlock` |
| 文档根节点 | 必须有 `type: "document"` root | **不需要** document root |
| parentId | 所有顶层 atom 必须指向 root | 顶层 atom **无 parentId**（`undefined`） |
| 来源追溯 | `meta.sourcePages` | `from: FromReference`（一等字段） |
| 文档标题 | `partTitle` | `noteTitle` |
| Inline 公式 | `children` 中用 kebab: `math-inline` | **不变**，仍用 `math-inline`（InlineElement 保持 kebab） |
| `tiptapContent` | 不变 | **不变**，仍用 camelCase + attrs |

**注意**：InlineElement（`children[]` 内部）的命名规则**不变**——`math-inline`、`code-inline` 仍用 kebab-case。变的是 Atom 顶层 type。

---

## 一、架构概览

```
glm-ocr-service (FastAPI, 192.168.1.240:8080)
  ↓ POST /api/v1/pdf/process
  ↓ 返回 JSON: { pages: PageResult[] }
  ↓
KRIG-Note 主进程 (import-service.ts)
  ↓ sanitizeAtoms()  — 容错清洗
  ↓ 合并多页 → Atom[]
  ↓ 存储到 SurrealDB
  ↓
Note 编辑器
  ↓ ConverterRegistry.atomsToDoc(atoms)  — Atom → ProseMirror Doc JSON
  ↓ ProseMirror 渲染
```

### 前后端职责边界

```
后端职责                              前端职责
─────────                            ─────────
输出符合本契约的 Atom JSON              sanitizeAtoms() — 容错清洗
  children[] 用 InlineElement 格式           ↓
  tiptapContent[] 用 ProseMirror 格式  ConverterRegistry.atomsToDoc() — Atom → PM Doc
                                            ↓
                                       ProseMirror schema 验证 + 渲染
```

---

## 二、API 响应结构

```typescript
// POST /api/v1/pdf/process 响应
interface ProcessResponse {
  taskId: string;
  pages: PageResult[];
  processingTimeSeconds: number;
  summary: {
    totalAtoms: number;
    typeCounts: Record<string, number>;
    pageCount: number;
  };
}

interface PageResult {
  pageNumber: number;                    // 1-indexed PDF 页码
  atoms: Atom[];                         // 该页的所有元素
  positions: Record<string, BlockPosition>;  // atomId → PDF 坐标（空间视图用）
  pageSize: { width: number; height: number };
}
```

---

## 三、Atom 基础结构

```typescript
interface Atom {
  id: string;                  // 格式: "atom-{timestamp}-{counter}"
  type: AtomType;              // 见下方类型列表（camelCase）
  content: AtomContent;        // 类型专属内容（见第四节）

  // 结构关系
  parentId?: string;           // 容器子节点才有（如 listItem → bulletList）
                               // 顶层元素：无此字段或 undefined
  order?: number;              // 排序序号

  // 来源追溯（一等字段）
  from: FromReference;         // PDF 来源信息

  meta: AtomMeta;
}

interface FromReference {
  extractionType: 'pdf';       // 固定为 'pdf'
  pdfPage: number;             // 1-indexed 页码
  pdfBbox?: {                  // PDF 坐标（点），可选
    x: number;
    y: number;
    w: number;
    h: number;
  };
  extractedAt: number;         // Unix timestamp (ms)
}

interface AtomMeta {
  createdAt: number;           // Unix timestamp (ms)
  updatedAt: number;           // Unix timestamp (ms)
}
```

### v1 → v2 来源追溯对比

| v1 | v2 | 说明 |
|---|---|---|
| `meta.sourcePages: { startPage, endPage }` | `from.pdfPage` | 单页页码，不再用范围 |
| 无 | `from.pdfBbox` | PDF 坐标（原来 v1 放在 image.content.originalSrc） |
| 无 | `from.extractedAt` | 提取时间戳 |

### Atom Type 命名规范（v2）

Atom 顶层 type 统一使用 **camelCase**：

| v1 (kebab-case) | v2 (camelCase) |
|---|---|
| `code-block` | `codeBlock` |
| `math-block` | `mathBlock` |
| `column-list` | `columnList` |
| `horizontal-rule` → `divider` | `horizontalRule` |

**不变的类型**（本身就是单词）：`paragraph`、`heading`、`image`、`table`、`blockquote`、`callout`、`bulletList`、`orderedList`、`listItem`。

**InlineElement 类型名不变**：`math-inline`、`code-inline` 仍用 kebab-case（因为它们在 `children[]` 内部，不是 Atom 顶层 type）。

---

## 四、各类型 Atom 的 content 格式规范

### 4.1 noteTitle（文档标题）

替代 v1 的 `partTitle`。可选，通常取自 PDF 文件名或第一个章节标题。

```json
{
  "id": "atom-1710000000-1",
  "type": "noteTitle",
  "content": {
    "children": [{"type": "text", "text": "Chapter 1: Sets"}]
  },
  "from": {"extractionType": "pdf", "pdfPage": 22, "extractedAt": 1710000000000}
}
```

### 4.2 heading（标题）

```json
{
  "type": "heading",
  "content": {
    "level": 2,
    "children": [
      {"type": "text", "text": "1.2 The Cartesian Product"}
    ]
  }
}
```

- `level`：1-3（KRIG-Note 只支持 3 级）
- `children`：InlineElement 数组（见第五节）

### 4.3 paragraph（段落）

```json
{
  "type": "paragraph",
  "content": {
    "children": [
      {"type": "text", "text": "Given two sets "},
      {"type": "math-inline", "latex": "A"},
      {"type": "text", "text": " and "},
      {"type": "math-inline", "latex": "B"},
      {"type": "text", "text": ", the Cartesian product is "},
      {"type": "math-inline", "latex": "A \\times B"},
      {"type": "text", "text": "."}
    ]
  }
}
```

### 4.4 mathBlock（独立公式块）

注意类型名从 `math-block` 改为 `mathBlock`。

```json
{
  "type": "mathBlock",
  "content": {
    "latex": "A \\times B = \\{(a,b) : a \\in A, b \\in B\\}"
  }
}
```

**v2 简化**：不再需要 `children` 冗余存储，只保留 `latex` 字段。

### 4.5 codeBlock（代码块）

注意类型名从 `code-block` 改为 `codeBlock`。

```json
{
  "type": "codeBlock",
  "content": {
    "code": "def f(x):\n    return x**2",
    "language": "python"
  }
}
```

**v2 变更**：`content.children[0].text` → `content.code`（直接用 code 字段，不再包裹在 children 中）。

### 4.6 image（图片）

```json
{
  "type": "image",
  "content": {
    "src": "data:image/png;base64,iVBORw0KGgo...",
    "alt": "Cartesian product diagram",
    "caption": "Figure 1.1. A diagram of a Cartesian product",
    "width": 170,
    "height": 70
  },
  "from": {
    "extractionType": "pdf",
    "pdfPage": 22,
    "pdfBbox": {"x": 114, "y": 168, "w": 170, "h": 70},
    "extractedAt": 1710000000000
  }
}
```

**v2 变更**：`originalSrc` 编码的 PDF 坐标 → 移到 `from.pdfBbox`。`alignment` 移除（由前端编辑器控制）。

### 4.7 table（表格）

表格以 ProseMirror JSON 子树存储在 `tiptapContent` 中（与 v1 一致）。

```json
{
  "type": "table",
  "content": {
    "colCount": 2,
    "tiptapContent": [
      {
        "type": "tableRow",
        "content": [
          {
            "type": "tableHeader",
            "attrs": {"colspan": 1, "rowspan": 1},
            "content": [
              {"type": "paragraph", "content": [{"type": "text", "text": "x"}]}
            ]
          },
          {
            "type": "tableHeader",
            "attrs": {"colspan": 1, "rowspan": 1},
            "content": [
              {"type": "paragraph", "content": [{"type": "text", "text": "y = x²"}]}
            ]
          }
        ]
      }
    ]
  }
}
```

**tiptapContent 内的规则不变**：camelCase + attrs 包裹（`mathInline` + `attrs.latex`）。

### 4.8 blockquote（引用块）

适用于定义、定理、引理、证明等。

```json
{
  "type": "blockquote",
  "content": {
    "children": [
      {"type": "text", "text": "Definition 1.1 An ordered pair is a list "},
      {"type": "math-inline", "latex": "(x, y)"},
      {"type": "text", "text": "."}
    ]
  }
}
```

多段引用使用 `tiptapContent`：

```json
{
  "type": "blockquote",
  "content": {
    "tiptapContent": [
      {"type": "paragraph", "content": [{"type": "text", "text": "Theorem 1.1 ..."}]},
      {"type": "paragraph", "content": [{"type": "text", "text": "Proof. ..."}]}
    ]
  }
}
```

### 4.9 bulletList / orderedList（列表容器）

列表是容器，子元素是 listItem（通过 parentId 关联）。

```json
{
  "id": "atom-list-1",
  "type": "bulletList",
  "content": {"listType": "bullet"}
}
```

```json
{
  "id": "atom-list-2",
  "type": "orderedList",
  "content": {"listType": "ordered"}
}
```

**注意**：列表容器本身**无 parentId**（顶层元素）。

### 4.10 listItem（列表项）

```json
{
  "id": "atom-li-1",
  "type": "listItem",
  "content": {
    "children": [
      {"type": "text", "text": "The natural numbers: "},
      {"type": "math-inline", "latex": "\\mathbb{N} = \\{1, 2, 3, ...\\}"}
    ]
  },
  "parentId": "atom-list-1"
}
```

**parentId 指向其所属的 bulletList/orderedList 的 id**——这是 v2 中唯一需要 parentId 的场景。

### 4.11 horizontalRule（分隔线）

```json
{
  "type": "horizontalRule",
  "content": {}
}
```

### 4.12 callout（提示框，可选）

```json
{
  "type": "callout",
  "content": {
    "calloutType": "info",
    "emoji": "💡",
    "tiptapContent": [
      {"type": "paragraph", "content": [{"type": "text", "text": "Note: This property..."}]}
    ]
  }
}
```

### 4.13 columnList（多列布局）

适用于 PDF 中的双栏或三栏排版。

```json
{
  "type": "columnList",
  "content": {
    "columns": 2,
    "tiptapContent": [
      {
        "type": "column",
        "content": [
          {"type": "paragraph", "content": [{"type": "text", "text": "左栏第一段"}]},
          {"type": "paragraph", "content": [
            {"type": "text", "text": "含公式 "},
            {"type": "mathInline", "attrs": {"latex": "E = mc^2"}}
          ]}
        ]
      },
      {
        "type": "column",
        "content": [
          {"type": "paragraph", "content": [{"type": "text", "text": "右栏第一段"}]}
        ]
      }
    ]
  }
}
```

---

## 五、InlineElement（行内元素）规范

`children` 数组中的每个元素，**命名规则与 v1 一致**（kebab-case + 扁平字段）。

### 5.1 纯文本

```json
{"type": "text", "text": "普通文本内容"}
```

**⚠️ text 不得为空字符串。**

### 5.2 带格式标记的文本

```json
{"type": "text", "text": "加粗文本", "marks": [{"type": "bold"}]}
{"type": "text", "text": "斜体文本", "marks": [{"type": "italic"}]}
{"type": "text", "text": "行内代码", "marks": [{"type": "code"}]}
```

### 5.3 链接

```json
{
  "type": "link",
  "href": "https://example.com",
  "children": [{"type": "text", "text": "链接文字"}]
}
```

### 5.4 行内数学公式

```json
{"type": "math-inline", "latex": "x^2 + y^2 = r^2"}
```

**仍用 kebab-case `math-inline`**，不是 `mathInline`。

### 5.5 格式速查表

| 位置 | 行内公式格式 | 示例 |
|---|---|---|
| `children[]` | InlineElement 格式 | `{"type": "math-inline", "latex": "x^2"}` |
| `tiptapContent[]` 内 | ProseMirror 格式 | `{"type": "mathInline", "attrs": {"latex": "x^2"}}` |

---

## 六、Atom 层级关系

```
（无 document root）
├── noteTitle
├── heading
├── paragraph
├── mathBlock
├── blockquote
├── image
├── table
├── horizontalRule
├── codeBlock
├── callout
├── columnList
├── bulletList
│     ├── listItem (parentId = bulletList.id)
│     ├── listItem
│     └── listItem
└── orderedList
      ├── listItem (parentId = orderedList.id)
      └── listItem
```

**规则**：
- 顶层 Atom **无 parentId**
- listItem 的 `parentId` 指向其所属的 bulletList/orderedList
- 其他容器类型（table、columnList）的子结构在 `tiptapContent` 中

---

## 七、后端识别来源 → Atom 类型映射表

| 来源 | 条件 | Atom 类型 | 说明 |
|---|---|---|---|
| `#` / `##` 标题 | — | `heading` | level 由 `#` 数量决定（max 3） |
| 章/篇/Chapter 标题 | 语义判断 | `noteTitle` | 文档级标题（每个 segment 最多一个） |
| 段落文本 | — | `paragraph` | 含 `math-inline`、code mark |
| ` ```lang...``` ` | 多行或有语言标注 | `codeBlock` | 保留语言信息 |
| `$$...$$` 独立行 | — | `mathBlock` | 独立公式块 |
| `$...$` 行内 | — | `math-inline` | 在 children 中 |
| `|...|` 表格 | — | `table` | → tiptapContent |
| `- / * / •` | — | `bulletList` + `listItem` | 无序列表 |
| `1. 2. 3.` | — | `orderedList` + `listItem` | 有序列表 |
| Definition/Theorem/... 开头 | 正则 | `blockquote` | 数学定义/定理框 |
| YOLO figure 区域 | bbox > 30pt | `image` | 裁剪 + base64 |

---

## 八、完整示例：一页 PDF 的理想输出

```json
{
  "taskId": "abc-123",
  "pages": [{
    "pageNumber": 22,
    "pageSize": {"width": 396, "height": 640},
    "atoms": [
      {
        "id": "atom-1710000000-1",
        "type": "noteTitle",
        "content": {"children": [{"type": "text", "text": "1.2 The Cartesian Product"}]},
        "from": {"extractionType": "pdf", "pdfPage": 22, "extractedAt": 1710000000000},
        "meta": {"createdAt": 1710000000000, "updatedAt": 1710000000000}
      },
      {
        "id": "atom-1710000000-2",
        "type": "heading",
        "content": {"level": 2, "children": [{"type": "text", "text": "1.2 The Cartesian Product"}]},
        "from": {"extractionType": "pdf", "pdfPage": 22, "extractedAt": 1710000000000},
        "meta": {"createdAt": 1710000000000, "updatedAt": 1710000000000}
      },
      {
        "id": "atom-1710000000-3",
        "type": "paragraph",
        "content": {
          "children": [
            {"type": "text", "text": "Given two sets "},
            {"type": "math-inline", "latex": "A"},
            {"type": "text", "text": " and "},
            {"type": "math-inline", "latex": "B"},
            {"type": "text", "text": ", it is possible to multiply them."}
          ]
        },
        "from": {"extractionType": "pdf", "pdfPage": 22, "extractedAt": 1710000000000},
        "meta": {"createdAt": 1710000000000, "updatedAt": 1710000000000}
      },
      {
        "id": "atom-1710000000-4",
        "type": "blockquote",
        "content": {
          "children": [
            {"type": "text", "text": "Definition 1.1 An ordered pair is a list "},
            {"type": "math-inline", "latex": "(x, y)"},
            {"type": "text", "text": " of two things x and y."}
          ]
        },
        "from": {"extractionType": "pdf", "pdfPage": 22, "extractedAt": 1710000000000},
        "meta": {"createdAt": 1710000000000, "updatedAt": 1710000000000}
      },
      {
        "id": "atom-1710000000-5",
        "type": "mathBlock",
        "content": {
          "latex": "A \\times B = \\{(a,b) : a \\in A, b \\in B\\}"
        },
        "from": {"extractionType": "pdf", "pdfPage": 22, "extractedAt": 1710000000000},
        "meta": {"createdAt": 1710000000000, "updatedAt": 1710000000000}
      },
      {
        "id": "atom-1710000000-6",
        "type": "image",
        "content": {
          "src": "data:image/png;base64,iVBORw0KGgo...",
          "alt": "Cartesian product diagram",
          "caption": "Figure 1.1. A diagram",
          "width": 170,
          "height": 70
        },
        "from": {
          "extractionType": "pdf",
          "pdfPage": 22,
          "pdfBbox": {"x": 114, "y": 168, "w": 170, "h": 70},
          "extractedAt": 1710000000000
        },
        "meta": {"createdAt": 1710000000000, "updatedAt": 1710000000000}
      },
      {
        "id": "atom-1710000000-7",
        "type": "bulletList",
        "content": {"listType": "bullet"},
        "from": {"extractionType": "pdf", "pdfPage": 22, "extractedAt": 1710000000000},
        "meta": {"createdAt": 1710000000000, "updatedAt": 1710000000000}
      },
      {
        "id": "atom-1710000000-8",
        "type": "listItem",
        "content": {
          "children": [
            {"type": "text", "text": "The natural numbers: "},
            {"type": "math-inline", "latex": "\\mathbb{N} = \\{1, 2, 3, ...\\}"}
          ]
        },
        "parentId": "atom-1710000000-7",
        "from": {"extractionType": "pdf", "pdfPage": 22, "extractedAt": 1710000000000},
        "meta": {"createdAt": 1710000000000, "updatedAt": 1710000000000}
      }
    ],
    "positions": {
      "atom-1710000000-2": {"x": 15, "y": 289},
      "atom-1710000000-3": {"x": 15, "y": 309}
    }
  }],
  "processingTimeSeconds": 9.89,
  "summary": {
    "totalAtoms": 8,
    "typeCounts": {"noteTitle": 1, "heading": 1, "paragraph": 1, "blockquote": 1, "mathBlock": 1, "image": 1, "bulletList": 1, "listItem": 1},
    "pageCount": 1
  }
}
```

---

## 九、前端容错层（sanitizeAtoms）

前端在导入时内置以下容错转换，**后端不应依赖这些容错**：

| 后端错误格式 | 前端自动修正为 | 说明 |
|---|---|---|
| `"type": "math-block"` | `"type": "mathBlock"` | v1 kebab → v2 camelCase |
| `"type": "code-block"` | `"type": "codeBlock"` | 同上 |
| `"type": "column-list"` | `"type": "columnList"` | 同上 |
| `"type": "partTitle"` | `"type": "noteTitle"` | v1 名称 → v2 名称 |
| `"type": "document"` | 过滤移除 | v2 不需要 document root |
| `meta.sourcePages` 存在但无 `from` | 自动生成 `from` | v1 → v2 来源迁移 |
| `{"type": "text", "text": ""}` | 过滤移除 | 空 text 节点 |
| children 中 `{"type": "mathInline", "attrs": {"latex": "..."}}` | `{"type": "math-inline", "latex": "..."}` | ProseMirror 格式 → InlineElement 格式 |

---

## 十、后端修改清单（v1 → v2 迁移）

| 优先级 | 修改内容 |
|---|---|
| **P0** | Atom type 命名改为 camelCase：`math-block` → `mathBlock`，`code-block` → `codeBlock`，`column-list` → `columnList` |
| **P0** | `partTitle` → `noteTitle` |
| **P0** | 移除 `document` root atom（不再生成） |
| **P0** | 顶层 atom 不再设置 `parentId`（删除或设为 `undefined`） |
| **P0** | 新增 `from` 字段：`{"extractionType": "pdf", "pdfPage": N, "extractedAt": timestamp}` |
| **P0** | `mathBlock.content` 简化：只需 `latex` 字段，不再需要 `children` |
| **P0** | `codeBlock.content` 简化：用 `code` 字段，不再用 `children[0].text` |
| P1 | image 的 PDF 坐标从 `content.originalSrc` 移到 `from.pdfBbox` |
| P1 | `meta.sourcePages` → 不再生成（由 `from.pdfPage` 替代） |
| P1 | heading level 范围限制为 1-3（不再支持 4-6） |

---

## 十一、版本历史

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-03-15 | 初始版本（mirro-desktop） |
| v1.1 | 2026-03-22 | 修正 children 中 mathInline 格式，新增 column-list |
| **v2.0** | **2026-04-08** | **基于 KRIG-Note Atom 体系重写**：camelCase 类型名、移除 document root、`from` 替代 `sourcePages`、`noteTitle` 替代 `partTitle`、简化 mathBlock/codeBlock content |
