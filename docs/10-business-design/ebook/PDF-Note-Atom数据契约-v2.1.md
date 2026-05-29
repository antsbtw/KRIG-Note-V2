# PDF → Note Atom 数据契约

> 版本：v2.1 | 日期：2026-05-29
> 基于 KRIG-Note Atom 体系（`src/semantic/types/`），后端 `glm-ocr-service` 输出必须符合本契约。
> v2.1 是 v2.0（2026-04-08）的全量替代版本，仅一项字段重命名 + 兼容兜底；其余字面 1:1 继承 v2.0。
> 历史版本 [v2.0](PDF-Note-Atom数据契约-v2.md) 保留作历史参考。

---

## 〇、本版变更概述（v2.0 → v2.1）

v2.1 是 v2.0 的**字段重命名版**，**结构与语义零变更**。仅一项字面增量：

| 项 | v2.0 | v2.1 | 影响范围 |
|---|---|---|---|
| 子结构容器字段名 | `tiptapContent` | **`pmContent`** | `table` / `blockquote` / `callout` / `columnList` 4 类 atom 的 content 子树 |

**理由**：`tiptapContent` 字段名来自 V1 KRIG-Note 时期（基于 Tiptap 编辑器实现）的命名习惯。V2 重构起项目字面已废 Tiptap 方案，直接用 ProseMirror（详 [feedback memory `tiptap-abandoned`]）。继续保留 `tiptapContent` 字段名会：
1. **误导维护者**：字段名暗示绑定 Tiptap，实际是 generic ProseMirror node JSON 子结构
2. **跨上下游不一致**：V2 内部所有 PM 子树/payload/schema 引用都用 `pm`/`prosemirror` 前缀（`PmPayload` / `pm-atom-draft.ts` 等）
3. **未来契约扩展时累积债**：v2.2 加 7 类媒体 atom（5B §7.5.1）字面也走 `pmContent`

→ v2.1 字面 rename 是**单点清算**。其余字段名（`children[]` 内 InlineElement 命名 / Atom type camelCase / `from` 一等字段等）字面**继承 v2.0 不动**。

### 兼容期

V2 端 `sanitizeAtoms` 字面**双字段兜底** `tiptapContent ?? pmContent`，兼容期 **1 个 V2 release（30-60 天）**。详 §九。

### v2.2 前瞻（不在本期）

5B §7.5.1 字面登记 v2.2 媒体扩展 7 类 atom type：`fileBlock` / `audioBlock` / `videoBlock` / `htmlBlock` / `tweetBlock` / `mathVisual` / `externalRef`。v2.2 启动时另起独立契约文档，**字面继承 v2.1 的 `pmContent` 字段名**。

---

## 一、与 v1 的关键差异

| | **v1（mirro-desktop，已废弃）** | **v2.1（KRIG-Note）** |
|---|---|---|
| Atom type 命名 | kebab-case: `math-block`, `code-block` | camelCase: `mathBlock`, `codeBlock` |
| 文档根节点 | 必须有 `type: "document"` root | **不需要** document root |
| parentId | 所有顶层 atom 必须指向 root | 顶层 atom **无 parentId**（`undefined`） |
| 来源追溯 | `meta.sourcePages` | `from: FromReference`（一等字段） |
| 文档标题 | `partTitle` | `noteTitle` |
| Inline 公式 | `children` 中用 kebab: `math-inline` | **不变**，仍用 `math-inline`（InlineElement 保持 kebab） |
| 子结构容器 | `tiptapContent` | **`pmContent`**（v2.1 rename，v2.0 字面是 `tiptapContent`）|

**注意**：InlineElement（`children[]` 内部）的命名规则**不变**——`math-inline`、`code-inline` 仍用 kebab-case。变的是 Atom 顶层 type 和 v2.0→v2.1 的 `tiptapContent`→`pmContent` rename。

---

## 二、架构概览

```
glm-ocr-service (FastAPI, 192.168.1.240:8080)
  ↓ POST /api/v1/pdf/process
  ↓ 返回 JSON: { pages: PageResult[] }
  ↓
KRIG-Note 主进程 (extraction-import / krigBatchToAtoms)
  ↓ sanitizeAtoms()  — 容错清洗(含 v2.0 兼容兜底)
  ↓ 合并多页 → PmAtomDraft[]
  ↓ noteCap.createNotesBatch — 单事务批量写入 SurrealDB
  ↓
Note 编辑器
  ↓ assemblePmDoc — atom + edge → ProseMirror Doc JSON
  ↓ ProseMirror 渲染
```

### 前后端职责边界

```
后端职责                              前端职责
─────────                            ─────────
输出符合本契约的 Atom JSON              sanitizeAtoms() — 容错清洗 + v2.0 字段兼容
  children[] 用 InlineElement 格式           ↓
  pmContent[] 用 ProseMirror 格式      krigBatchToAtoms — Atom JSON → PmAtomDraft[]
                                            ↓
                                       createNotesBatch — atoms 直写 storage
                                            ↓
                                       assemblePmDoc → ProseMirror 渲染
```

---

## 三、API 响应结构

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

## 四、Atom 基础结构

```typescript
interface Atom {
  id: string;                  // 格式: "atom-{timestamp}-{counter}"
  type: AtomType;              // 见下方类型列表（camelCase）
  content: AtomContent;        // 类型专属内容（见第五节）

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

| v1 | v2.1 | 说明 |
|---|---|---|
| `meta.sourcePages: { startPage, endPage }` | `from.pdfPage` | 单页页码，不再用范围 |
| 无 | `from.pdfBbox` | PDF 坐标（原来 v1 放在 image.content.originalSrc） |
| 无 | `from.extractedAt` | 提取时间戳 |

### Atom Type 命名规范（v2.1）

Atom 顶层 type 统一使用 **camelCase**：

| v1 (kebab-case) | v2.1 (camelCase) |
|---|---|
| `code-block` | `codeBlock` |
| `math-block` | `mathBlock` |
| `column-list` | `columnList` |
| `horizontal-rule` → `divider` | `horizontalRule` |

**不变的类型**（本身就是单词）：`paragraph`、`heading`、`image`、`table`、`blockquote`、`callout`、`bulletList`、`orderedList`、`listItem`。

**InlineElement 类型名不变**：`math-inline`、`code-inline` 仍用 kebab-case（因为它们在 `children[]` 内部，不是 Atom 顶层 type）。

---

## 五、各类型 Atom 的 content 格式规范

### 5.1 noteTitle（文档标题）

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

### 5.2 heading（标题）

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
- `children`：InlineElement 数组（见第六节）

### 5.3 paragraph（段落）

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

### 5.4 mathBlock（独立公式块）

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

### 5.5 codeBlock（代码块）

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

### 5.6 image（图片）

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

### 5.7 table（表格）

表格以 ProseMirror JSON 子树存储在 **`pmContent`** 中（v2.1 rename：v2.0 字面是 `tiptapContent`）。

```json
{
  "type": "table",
  "content": {
    "colCount": 2,
    "pmContent": [
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

**pmContent 内的规则不变**：camelCase + attrs 包裹（`mathInline` + `attrs.latex`）。

### 5.8 blockquote（引用块）

适用于定义、定理、引理、证明等。

单段引用：

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

多段引用使用 **`pmContent`**（v2.1 rename：v2.0 字面是 `tiptapContent`）：

```json
{
  "type": "blockquote",
  "content": {
    "pmContent": [
      {"type": "paragraph", "content": [{"type": "text", "text": "Theorem 1.1 ..."}]},
      {"type": "paragraph", "content": [{"type": "text", "text": "Proof. ..."}]}
    ]
  }
}
```

### 5.9 bulletList / orderedList（列表容器）

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

### 5.10 listItem（列表项）

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

### 5.11 horizontalRule（分隔线）

```json
{
  "type": "horizontalRule",
  "content": {}
}
```

### 5.12 callout（提示框，可选）

子结构使用 **`pmContent`**（v2.1 rename：v2.0 字面是 `tiptapContent`）：

```json
{
  "type": "callout",
  "content": {
    "calloutType": "info",
    "emoji": "💡",
    "pmContent": [
      {"type": "paragraph", "content": [{"type": "text", "text": "Note: This property..."}]}
    ]
  }
}
```

### 5.13 columnList（多列布局）

适用于 PDF 中的双栏或三栏排版。子结构使用 **`pmContent`**（v2.1 rename：v2.0 字面是 `tiptapContent`）：

```json
{
  "type": "columnList",
  "content": {
    "columns": 2,
    "pmContent": [
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

## 六、InlineElement（行内元素）规范

`children` 数组中的每个元素，**命名规则与 v1 一致**（kebab-case + 扁平字段）。

### 6.1 纯文本

```json
{"type": "text", "text": "普通文本内容"}
```

**⚠️ text 不得为空字符串。**

### 6.2 带格式标记的文本

```json
{"type": "text", "text": "加粗文本", "marks": [{"type": "bold"}]}
{"type": "text", "text": "斜体文本", "marks": [{"type": "italic"}]}
{"type": "text", "text": "行内代码", "marks": [{"type": "code"}]}
```

### 6.3 链接

```json
{
  "type": "link",
  "href": "https://example.com",
  "children": [{"type": "text", "text": "链接文字"}]
}
```

### 6.4 行内数学公式

```json
{"type": "math-inline", "latex": "x^2 + y^2 = r^2"}
```

**仍用 kebab-case `math-inline`**，不是 `mathInline`。

### 6.5 格式速查表

| 位置 | 行内公式格式 | 示例 |
|---|---|---|
| `children[]` | InlineElement 格式 | `{"type": "math-inline", "latex": "x^2"}` |
| `pmContent[]` 内 | ProseMirror 格式 | `{"type": "mathInline", "attrs": {"latex": "x^2"}}` |

---

## 七、Atom 层级关系

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
- 其他容器类型（table、blockquote、callout、columnList）的子结构在 **`pmContent`** 中

---

## 八、后端识别来源 → Atom 类型映射表

| 来源 | 条件 | Atom 类型 | 说明 |
|---|---|---|---|
| `#` / `##` 标题 | — | `heading` | level 由 `#` 数量决定（max 3） |
| 章/篇/Chapter 标题 | 语义判断 | `noteTitle` | 文档级标题（每个 segment 最多一个） |
| 段落文本 | — | `paragraph` | 含 `math-inline`、code mark |
| ` ```lang...``` ` | 多行或有语言标注 | `codeBlock` | 保留语言信息 |
| `$$...$$` 独立行 | — | `mathBlock` | 独立公式块 |
| `$...$` 行内 | — | `math-inline` | 在 children 中 |
| `|...|` 表格 | — | `table` | → pmContent |
| `- / * / •` | — | `bulletList` + `listItem` | 无序列表 |
| `1. 2. 3.` | — | `orderedList` + `listItem` | 有序列表 |
| Definition/Theorem/... 开头 | 正则 | `blockquote` | 数学定义/定理框 |
| YOLO figure 区域 | bbox > 30pt | `image` | 裁剪 + base64 |

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
| `content.tiptapContent` 存在但无 `content.pmContent` | 字面归一化到 `content.tiptapContent`（内部表征保留）| **v2.0 → v2.1 兼容兜底**（兼容期 1 V2 release ≈ 30-60 天）|

### 9.1 v2.0 ↔ v2.1 兼容兜底详细

V2 端 `src/capabilities/content-ingest/internal/sanitize-atoms.ts` 字面实施：

```ts
// 5B Stage 8 兼容层 (字面拍板兜底 1 个 V2 release):
// v2.0 后端字面发 tiptapContent;v2.1 后端字面发 pmContent.
// 读侧字面 `tiptapContent ?? pmContent` 二者均可消费;
// 归一化保留 tiptapContent 字段(下游 atoms-to-pm / table-adapter 字面仍读 tiptapContent).
// 未来 (v2.2 发布 + 1 V2 release) 删除此兼容兜底,仅读 pmContent.
const pmSubtree =
  (Array.isArray(content.tiptapContent) ? content.tiptapContent : null) ??
  (Array.isArray(content.pmContent) ? content.pmContent : null);
if (pmSubtree) {
  content.tiptapContent = pmSubtree;  // 归一化保留 tiptapContent (内部表征)
  delete content.pmContent;
}
```

**兼容期内**：
- 后端 v2.0 发 `tiptapContent` → V2 字面消费 ✓
- 后端 v2.1 发 `pmContent` → V2 sanitize 字面归一化为 `tiptapContent` 内部表征 → 下游消费 ✓
- 后端**双发**（`tiptapContent` + `pmContent` 同填同子树）→ 兜底优先 `tiptapContent`，二者字面同值 ✓

**兼容期后**：sanitize 删除 `tiptapContent` 兜底分支，仅读 `pmContent`，并相应改下游字段名。老 V2 备份 restore 字面报错"contract v2.0 not supported, please re-export from KRIG Knowledge Platform"。

---

## 十、后端修改清单（v2.0 → v2.1 迁移）

| 优先级 | 修改内容 |
|---|---|
| **P0** | `table.content.tiptapContent` → `table.content.pmContent`（字段重命名） |
| **P0** | `blockquote.content.tiptapContent` → `blockquote.content.pmContent` |
| **P0** | `callout.content.tiptapContent` → `callout.content.pmContent` |
| **P0** | `columnList.content.tiptapContent` → `columnList.content.pmContent` |
| 兼容 | 兼容期可双发 `tiptapContent` + `pmContent`，V2 sanitize 字面优先 `tiptapContent`（向后兼容老客户端） |

### v1 → v2.1 迁移（保留作历史参考）

以下条目为 v1 → v2.0 时已字面登记，v2.1 字面继承不变：

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

## 十一、完整示例：一页 PDF 的理想输出

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

## 十二、本契约的 V2 端消费方

V2 代码消费本契约的位置：

| 位置 | 角色 |
|---|---|
| `src/capabilities/content-ingest/internal/sanitize-atoms.ts` | v2.0/v2.1 兼容入口，读 `tiptapContent ?? pmContent` |
| `src/capabilities/content-ingest/internal/table-adapter.ts` | 字面消费归一化后的 `content.tiptapContent`（兼容期内）|
| `src/capabilities/content-ingest/internal/krig-batch-to-atoms.ts` | 字面消费归一化后的 `content.tiptapContent`（兼容期内）|
| `src/capabilities/text-editing/converters/atoms-to-pm.ts` | V1NoteViewAtom 反向兼容路径，字面消费 `content.tiptapContent`（canvas-text-node 用，规范外）|

5B Stage 8 字面仅实施 sanitize-atoms.ts 兼容层（**单点兼容**）。其它消费方在 v2.2 启动 + 兼容期结束前不动 — 它们字面消费的是 sanitize 兜底后的内部归一化形态。

---

## 十三、版本历史

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-03-15 | 初始版本（mirro-desktop） |
| v1.1 | 2026-03-22 | 修正 children 中 mathInline 格式，新增 column-list |
| v2.0 | 2026-04-08 | **基于 KRIG-Note Atom 体系重写**：camelCase 类型名、移除 document root、`from` 替代 `sourcePages`、`noteTitle` 替代 `partTitle`、简化 mathBlock/codeBlock content |
| **v2.1** | **2026-05-29** | **字段重命名版**：子结构容器 `tiptapContent` → `pmContent`（清理 V1 Tiptap 命名残留）。其余 1:1 继承 v2.0。V2 端 sanitize 字面兼容兜底 `tiptapContent ?? pmContent`，兼容期 1 V2 release（30-60 天）。详 5B 设计 §7.5.1 / Stage 8 |
