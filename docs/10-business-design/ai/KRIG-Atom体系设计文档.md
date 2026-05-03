# KRIG Atom 体系设计文档

> 文档类型：数据层设计
> 产品名称：KRIG / KRIG Note
> 状态：设计阶段 | 创建日期：2026-04-08 | 版本：v0.1
> 位置：`src/shared/types/atom-types.ts`（类型定义）+ 各 Block 的 `converter`（双向转换）
>
> **文档目的**：定义 KRIG 统一的内容中间层（Atom），覆盖所有内容来源——
> Note 编辑器手动输入、PDF 导入、Web 提取、AI 对话提取。
> 作为编辑器引擎与存储层之间的框架无关格式，同时是知识图谱的原始数据来源。
>
> **关联文档**：
> - `KRIG-SurrealDB-Schema设计文档.md`（存储层，Atom 写入此文档定义的表）
> - `KRIG-设计哲学与产品原则.md`（P3、P6、P7 是 Atom 设计的哲学依据）
> - `WebBridge-设计.md`（L4 管线层的 ExtractedBlock → Atom 转换）

---

## 一、为什么需要统一 Atom 层

### 1.1 当前问题

KRIG-Note 当前直接存 ProseMirror Doc JSON，Schema 文档中的 `atom` 表只覆盖 PDF 物理内容。两者存在三个根本缺陷：

**缺陷 1：框架绑定**
```
Note 存储：doc_content = ProseMirror JSON（{ type, attrs, content }）
换编辑器引擎 = 历史数据全部作废
```

**缺陷 2：知识不可提取**
```
PDF atom 类型：只有 paragraph / formula / figure / table
Note block 类型：unknown[]，无结构化语义

知识图谱层无法可靠地区分：
  "这是引用了某论文的段落" vs "这是普通文字"
  "这是数学公式" vs "这是代码"
```

**缺陷 3：来源两张皮**
```
PDF atom：有页码和坐标（bbox），但没有跨来源的统一追溯格式
Note block：完全没有来源信息
Web 提取、AI 对话提取：各自独立，没有统一格式
```

### 1.2 统一 Atom 层的定位

Atom 是所有内容来源的**统一中间表示**：框架无关、类型完整、来源可追溯。

```
来源 A：Note 编辑器（ProseMirror）
来源 B：PDF 导入（物理页面内容）
来源 C：Web 提取（WebBridge L4）
来源 D：AI 对话提取（AIBridge → Thought）
              ↓
         统一 Atom 层
              ↓
         SurrealDB 存储
              ↓
         知识图谱（node / triple）
```

**对比原来的两张皮：**

| | 原来 | 统一后 |
|---|---|---|
| Note Block | ProseMirror JSON，无类型 | Atom，20+ 种明确类型 |
| PDF Atom | 4 种类型（para/formula/fig/table），有 bbox | Atom，同样 4 种类型 + bbox 放入 meta |
| Web 提取 | ExtractedBlock，独立格式 | Atom + FromReference.url |
| AI 对话提取 | 无标准格式 | Atom + FromReference.extractionType='ai-conversation' |

---

## 二、Atom 基础结构

### 2.1 核心接口

```typescript
export interface Atom {
  // 身份
  id: string;
  type: AtomType;

  // 内容（每种 type 对应精确的 content 结构，见第四节）
  content: AtomContent;

  // 结构关系（扁平存储，不嵌套）
  parentId?: string;          // 父 Atom（如 listItem → bulletList）
  order?: number;             // 在父容器或文档中的顺序

  // 知识关系
  links?: string[];           // 关联 Atom ID（用户显式创建的双向链接）

  // 来源追溯（一等字段，不是附加元数据）
  from?: FromReference;

  // 元数据
  meta: AtomMeta;
}
```

### 2.2 FromReference — 来源追溯

来源追溯是知识表示的核心需求，不是附加功能。`from` 是 Atom 的一等字段。

```typescript
export interface FromReference {
  // ── 来源类型 ──
  extractionType:
    | 'manual'           // 用户在 Note 编辑器中手动输入
    | 'pdf'              // 从 PDF 书本导入
    | 'web'              // 从网页提取（WebBridge）
    | 'ai-conversation'  // 从 AI 对话提取（AIBridge → Thought）
    | 'epub'             // 从 EPUB 电子书提取
    | 'clipboard';       // 从剪贴板粘贴

  // ── 来源定位 ──
  // PDF 来源
  pdfBookId?: string;         // 关联的 book:{id}
  pdfPage?: number;           // 页码（原 atom 表的 page 字段）
  pdfBbox?: {                 // 页面坐标（原 atom 表的 bbox 字段）
    x: number; y: number;
    w: number; h: number;
  };

  // Web 来源
  url?: string;               // 原始网页 URL
  pageTitle?: string;         // 页面标题

  // AI 对话来源
  conversationId?: string;    // ai_conversation 表的记录 ID
  messageIndex?: number;      // 对话中的消息索引

  // EPUB 来源
  epubCfi?: string;           // EPUB CFI 定位符
  epubBookId?: string;        // EPUB 书籍 ID

  // ── 引用信息（学术场景）──
  citation?: {
    title?: string;
    author?: string;
    publisher?: string;
    year?: string;
    page?: string;
    doi?: string;
    accessedAt?: number;
  };

  extractedAt: number;        // 提取时间戳
}
```

### 2.3 AtomMeta — 元数据

```typescript
export interface AtomMeta {
  createdAt: number;
  updatedAt: number;

  // 知识图谱（异步回填，不阻塞编辑）
  nodeIds?: string[];         // 关联的 node 表记录 ID（AI 提取后回填）

  // 全文索引
  dirty: boolean;             // 是否需要重新推断关系（P6 增量更新）
}
```

---

## 三、AtomType 枚举

### 3.1 完整类型体系

AtomType 与 KRIG-Note BlockRegistry 一一对应，同时覆盖 PDF 物理内容类型。

```typescript
// ── 文本流 ──
export type TextAtomType =
  | 'paragraph'               // 普通段落
  | 'heading'                 // 标题（h1/h2/h3）
  | 'noteTitle';              // Note 文档标题（唯一，不可删除）

// ── 容器 ──
export type ContainerAtomType =
  | 'bulletList'              // 无序列表
  | 'orderedList'             // 有序列表
  | 'listItem'                // 列表项
  | 'taskList'                // 任务列表
  | 'taskItem'                // 任务项（带 checkbox）
  | 'blockquote'              // 引用块
  | 'callout'                 // 标注块（info/warning/tip/danger）
  | 'toggleList'              // 折叠列表
  | 'toggleItem'              // 折叠项
  | 'frameBlock'              // 框架块（带标签的容器）
  | 'table'                   // 表格
  | 'tableRow'                // 表格行
  | 'tableCell'               // 表格单元格
  | 'tableHeader'             // 表格标题单元格
  | 'columnList'              // 多列布局
  | 'column';                 // 列

// ── 渲染块 ──
export type RenderAtomType =
  | 'codeBlock'               // 代码块
  | 'mathBlock'               // 数学公式块（LaTeX）
  | 'image'                   // 图片
  | 'figure'                  // PDF 图表（来自 PDF 导入）
  | 'video'                   // 视频
  | 'audio'                   // 音频
  | 'tweet';                  // 推文嵌入

// ── 特殊 ──
export type SpecialAtomType =
  | 'horizontalRule'          // 分割线
  | 'hardBreak'               // 强制换行
  | 'document';               // 根节点

// ── 完整联合类型 ──
export type AtomType =
  | TextAtomType
  | ContainerAtomType
  | RenderAtomType
  | SpecialAtomType;
```

### 3.2 PDF 物理内容类型的映射

原 Schema 文档中 `atom` 表的 4 种类型，映射到统一 AtomType：

| 原 PDF atom 类型 | 统一 AtomType | 说明 |
|-----------------|--------------|------|
| `paragraph` | `paragraph` | 直接对应 |
| `formula` | `mathBlock` | 语义对齐：公式 = 数学块 |
| `figure` | `figure` | 保留独立类型，区别于 Note 的 image |
| `table` | `table` | 直接对应 |

原来的 `bbox` 和 `page` 字段迁移到 `from.pdfBbox` 和 `from.pdfPage`。

### 3.3 textBlock 的映射规则

ProseMirror 的 `textBlock` 通过 attrs 变体区分，Atom 层直接映射为独立类型：

| ProseMirror textBlock attrs | AtomType | 理由 |
|---|---|---|
| `level: null` | `paragraph` | 普通段落，语义独立 |
| `level: 1/2/3` | `heading` | 文档结构，语义不同 |
| `isTitle: true` | `noteTitle` | 唯一文档标题，特殊语义 |

---

## 四、AtomContent

每种 AtomType 对应精确的 content 结构，不使用 `Record<string, unknown>` 通用 fallback。

### 4.1 文本流

```typescript
export interface ParagraphContent {
  children: InlineElement[];
}

export interface HeadingContent {
  level: 1 | 2 | 3;
  children: InlineElement[];
}

export interface NoteTitleContent {
  children: InlineElement[];
}
```

### 4.2 容器

```typescript
export interface ListContent {
  listType: 'bullet' | 'ordered' | 'task';
  start?: number;             // orderedList 起始序号
  // 子 Atom 通过 parentId 关联，不嵌套存储
}

export interface ListItemContent {
  children: InlineElement[];
  checked?: boolean;          // taskItem 的勾选状态
}

export interface BlockquoteContent {
  children: InlineElement[];
  citation?: string;
}

export interface CalloutContent {
  calloutType: 'info' | 'warning' | 'tip' | 'danger' | 'note';
  emoji?: string;
  title?: string;
  // 内部 Block 通过 parentId 关联
}

export interface ToggleListContent {
  open: boolean;
  title: string;
  // 子 Atom 通过 parentId 关联
}

export interface FrameBlockContent {
  label?: string;
  // 内部 Block 通过 parentId 关联
}

export interface TableContent {
  colCount: number;
  // tableRow → tableCell/tableHeader 通过 parentId 链
}

export interface TableCellContent {
  children: InlineElement[];
  colspan?: number;
  rowspan?: number;
  isHeader?: boolean;
}

export interface ColumnListContent {
  columns: number;
  // column 子 Atom 通过 parentId 关联
}
```

### 4.3 渲染块

```typescript
export interface CodeBlockContent {
  code: string;
  language: string;
}

export interface MathBlockContent {
  latex: string;
}

export interface ImageContent {
  src: string;                // 本地路径或外部 URL
  alt?: string;
  width?: number;
  height?: number;
  caption?: string;
  originalSrc?: string;       // 原始外部 URL（本地化后保留）
  mediaId?: string;           // 本地媒体 ID
}

export interface FigureContent {
  // PDF 导入的图表（来自 from.extractionType = 'pdf'）
  src: string;                // 提取的图片路径
  caption?: string;
  figureType?: 'chart' | 'diagram' | 'photo' | 'unknown';
  // 坐标信息在 from.pdfBbox 中
}

export interface VideoContent {
  src: string;
  title?: string;
  embedType?: 'youtube' | 'vimeo' | 'direct';
  poster?: string;
  duration?: number;
}

export interface AudioContent {
  src: string;
  title?: string;
  mimeType?: string;
  duration?: number;
}

export interface TweetContent {
  tweetUrl: string;
  tweetId?: string;
  author?: { name: string; handle: string; avatar?: string };
  text?: string;
  createdAt?: string;
  media?: Array<{ type: 'image' | 'video'; url: string }>;
}
```

### 4.4 完整联合类型

```typescript
export type AtomContent =
  | ParagraphContent
  | HeadingContent
  | NoteTitleContent
  | ListContent
  | ListItemContent
  | BlockquoteContent
  | CalloutContent
  | ToggleListContent
  | FrameBlockContent
  | TableContent
  | TableCellContent
  | ColumnListContent
  | CodeBlockContent
  | MathBlockContent
  | ImageContent
  | FigureContent
  | VideoContent
  | AudioContent
  | TweetContent;
```

---

## 五、InlineElement

段落、标题、列表项内部的行内文本和对象。

```typescript
export type InlineElement =
  | TextNode
  | MathInline
  | CodeInline
  | LinkNode
  | NoteLinkNode
  | MentionNode;

export interface TextNode {
  type: 'text';
  text: string;
  marks?: Mark[];
}

export interface MathInline {
  type: 'math-inline';
  latex: string;
}

export interface CodeInline {
  type: 'code-inline';
  code: string;
}

export interface LinkNode {
  type: 'link';
  href: string;
  title?: string;
  children: TextNode[];
}

export interface NoteLinkNode {
  type: 'note-link';
  noteId: string;
  title: string;
}

export interface MentionNode {
  type: 'mention';
  targetId: string;
  label: string;
}
```

### Mark（行内格式）

```typescript
export type Mark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'underline' }
  | { type: 'strike' }
  | { type: 'code' }
  | { type: 'highlight'; color?: string }
  | { type: 'textStyle'; color?: string }
  | { type: 'thought'; thoughtId: string };   // Thought Tab 锚点（P5）
```

---

## 六、Converter 规范

### 6.1 职责

Converter 负责 ProseMirror Node ↔ Atom 的双向转换，是编辑器引擎和存储层之间的唯一桥梁。

```typescript
export interface AtomConverter {
  atomTypes: AtomType[];      // 此 converter 处理的 AtomType（可多个）
  pmType: string;             // 对应的 ProseMirror 节点类型名

  /** ProseMirror Node → Atom（可能返回多个，如 textBlock → heading/paragraph/noteTitle） */
  toAtom(node: PMNode, parentId?: string): Atom | Atom[];

  /** Atom → ProseMirror Node JSON */
  toPM(atom: Atom): PMNodeJSON;
}
```

### 6.2 设计约束

```
✓ 纯函数：无副作用，相同输入永远产生相同输出
✓ 幂等：toAtom(toPM(atom)) 应等价于原 atom（Round-trip）
✓ 容错：遇到无法识别的节点类型，降级为 paragraph 而不是抛错
✗ 不访问网络、不读写数据库、不触发副作用
```

### 6.3 textBlock Converter 示例

```typescript
const textBlockConverter: AtomConverter = {
  atomTypes: ['paragraph', 'heading', 'noteTitle'],
  pmType: 'textBlock',

  toAtom(node, parentId) {
    const { level, isTitle } = node.attrs;

    if (isTitle) {
      return createAtom('noteTitle',
        { children: inlinesToAtom(node) } as NoteTitleContent,
        parentId
      );
    }
    if (level) {
      return createAtom('heading',
        { level, children: inlinesToAtom(node) } as HeadingContent,
        parentId
      );
    }
    return createAtom('paragraph',
      { children: inlinesToAtom(node) } as ParagraphContent,
      parentId
    );
  },

  toPM(atom) {
    if (atom.type === 'noteTitle') {
      return { type: 'textBlock', attrs: { isTitle: true },
               content: atomToInlines(atom.content as NoteTitleContent) };
    }
    if (atom.type === 'heading') {
      const c = atom.content as HeadingContent;
      return { type: 'textBlock', attrs: { level: c.level },
               content: atomToInlines(c) };
    }
    return { type: 'textBlock',
             content: atomToInlines(atom.content as ParagraphContent) };
  },
};
```

### 6.4 ConverterRegistry

从 BlockRegistry 自动收集所有 Converter，提供批量转换能力：

```typescript
class ConverterRegistry {
  /** 从 BlockRegistry 收集所有 converter，在应用启动时调用一次 */
  init(blocks: BlockDef[]): void { ... }

  /** ProseMirror Doc → Atom[]（扁平，子节点通过 parentId 关联） */
  docToAtoms(doc: PMNode): Atom[] { ... }

  /** Atom[] → ProseMirror Doc JSON */
  atomsToDoc(atoms: Atom[]): PMNodeJSON { ... }

  /** 容错模式：PM JSON（旧格式）→ Atom[]，用于数据迁移 */
  pmJsonToAtoms(json: unknown[]): Atom[] { ... }
}
```

---

## 七、存储层对接

### 7.1 对 Schema 文档的影响（方案 A：统一 Atom）

原 Schema 文档（v0.4）有两张内容存储表：
- `atom:{book_id}_{atom_id}`：只存 PDF 物理内容，4 种类型
- `block:{note_id}_{block_id}`：存 Note 编辑器内容，类型不明

**方案 A 统一后，合并为一张表：**

```
atom:{source_id}_{atom_id} {
    id              : string,

    // 来源定位
    source_type     : string,       // "note" | "pdf_book" | "web" | "ai_conversation"
    source_id       : string,       // note_id / book_id / conversation_id

    // Atom 核心字段
    type            : AtomType,     // 完整的 20+ 种类型枚举
    content         : AtomContent,  // 对应 type 的精确结构
    order           : number,       // 在文档或父容器中的顺序
    parent_id       : string,       // 父 Atom ID（扁平存储）

    // 来源追溯
    from            : FromReference,  // 统一来源格式

    // 知识图谱
    dirty           : boolean,      // 是否需要重新推断关系（P6）
    node_ids        : array,        // 关联的 node 表记录（异步回填）

    // 时间
    created_at      : datetime,
    updated_at      : datetime,
}
```

**原 `block` 表废弃**，Note 内容改为写入 `atom` 表（source_type: 'note'）。
**原 `atom` 表的 `bbox`/`page` 字段**迁移到 `from.pdfBbox`/`from.pdfPage`。

### 7.2 数据流变更

**Note 保存流程（新）：**
```
编辑器 ProseMirror Doc
  → ConverterRegistry.docToAtoms()
  → Atom[]（source_type: 'note'，from.extractionType: 'manual'）
  → SurrealDB atom 表
  → 异步：atom_index 更新 + 知识图谱推断
```

**PDF 导入流程（新）：**
```
PDF 解析（Docling/PyMuPDF）
  → ExtractedBlock[]
  → Atom[]（source_type: 'pdf_book'，from.extractionType: 'pdf'，from.pdfBbox）
  → SurrealDB atom 表
```

**Web 提取流程（新）：**
```
WebBridge L4 extractToNote()
  → ExtractedBlock[]
  → Atom[]（source_type: 'web'，from.extractionType: 'web'，from.url）
  → SurrealDB atom 表
```

### 7.3 数据迁移

现有数据格式迁移路径：

```
mirro-desktop atom 表（4 种类型 + bbox/page）
  → source_type: 'pdf_book'
  → from.extractionType: 'pdf'
  → from.pdfBbox, from.pdfPage（从原字段迁移）
  → type: 映射规则见 §3.2

mirro-desktop note 的 doc_content（ProseMirror JSON）
  → ConverterRegistry.pmJsonToAtoms()（容错模式）
  → source_type: 'note'
  → from.extractionType: 'manual'
```

迁移在 DB ready 后、编辑器加载前执行。失败的记录保留原始格式，下次启动重试。

---

## 八、知识图谱连接

### 8.1 atom_index（全文搜索辅助）

文档保存后异步提取纯文本索引，支持搜索：

```typescript
interface AtomIndexRecord {
  id: string;
  atom_id: string;
  source_type: string;
  source_id: string;
  type: AtomType;
  text_content: string;     // 提取的纯文本（搜索用）
}
```

### 8.2 Atom 到知识图谱的提取逻辑

Atom 的结构化语义让知识提取有了更精确的依据：

```
Atom 保存后（异步，符合 P6）
  → 按 type 分类处理：
      heading          → 可能是概念定义，提取候选 node
      paragraph        → 提取实体关系，生成 triple 候选
      mathBlock        → 公式类型节点，关联数学概念
      blockquote       → from.citation 存在时，提取引用关系
      codeBlock        → 技术实现节点

  → from 字段提供上下文：
      from.url         → 知识来源（外部网页）
      from.pdfBookId   → 知识来源（学术书本）
      from.citation    → 学术引用信息（可直接生成 triple）

  → 写入 node（status: candidate, confidence < 1.0）
  → 写入 triple（source: system:ner 等）
  → 回填 atom.meta.nodeIds
```

### 8.3 来源追溯的知识价值

`from` 字段使知识图谱具备溯源能力：

```
node "熵增原理"
  → atom A（from.pdfBookId: 热力学基础, from.pdfPage: 42）
  → atom B（from.url: arxiv.org/abs/..., from.citation.author: Clausius）
  → atom C（from.extractionType: ai-conversation, from.conversationId: xxx）

用户提问："这个概念是从哪里来的？"
→ 系统能直接回答：书本第 42 页 + 一篇 arXiv 论文 + 一次 AI 对话
```

---

## 九、跨模块接口

### 9.1 WebBridge L4 管线

WebBridge 的 `extractToNote()` 输出 Atom：

```typescript
// WebBridge pipeline/note-creator.ts
function extractedToAtom(
  block: ExtractedBlock,
  source: FromReference
): Atom {
  return {
    id: generateId(),
    type: mapExtractedTypeToAtomType(block.type),  // ExtractedBlock.type → AtomType
    content: mapExtractedContent(block),
    from: source,
    meta: { createdAt: Date.now(), updatedAt: Date.now(), dirty: true },
  };
}
```

### 9.2 PDF 导入管线

PDF 解析输出直接映射为 Atom：

```typescript
// PDF pipeline → Atom
{
  type: 'mathBlock',
  content: { latex: '\\Delta S \\geq 0' },
  from: {
    extractionType: 'pdf',
    pdfBookId: 'book:thermal-dynamics',
    pdfPage: 42,
    pdfBbox: { x: 120, y: 340, w: 380, h: 60 },
    extractedAt: Date.now(),
  },
  meta: { createdAt: Date.now(), updatedAt: Date.now(), dirty: true },
}
```

### 9.3 AI 对话提取

用户从 AI 对话中提取 Thought，生成带来源的 Atom：

```typescript
{
  type: 'paragraph',
  content: { children: [{ type: 'text', text: 'AI 解释的熵增原理...' }] },
  from: {
    extractionType: 'ai-conversation',
    conversationId: 'ai_conv:claude:xxx',
    messageIndex: 3,
    url: 'claude.ai/chat/xxx',
    extractedAt: Date.now(),
  },
  meta: { createdAt: Date.now(), updatedAt: Date.now(), dirty: true },
}
```

---

## 十、实施计划

### Phase 1：类型定义 + Converter 框架

```
□  src/shared/types/atom-types.ts         Atom、AtomType、AtomContent
□  src/shared/types/extraction-types.ts   FromReference、ExtractedBlock（跨模块共享）
□  src/plugins/note/converters/           ConverterRegistry + 基础 Converter
□  扩展 BlockDef：增加 converter 字段
□  扩展 BlockRegistry：buildConverterRegistry()
```

### Phase 2：存储层接入

```
□  修改 SurrealDB Schema：atom 表统一为新结构，废弃 block 表
□  修改 noteStore.save()：保存前 PM → Atom 转换
□  修改 noteStore.get()：加载后 Atom → PM 转换
□  数据迁移脚本：mirro-desktop 旧格式 → 新 Atom 格式
```

### Phase 3：所有 Block Converter

```
□  textBlock（paragraph / heading / noteTitle）
□  bulletList / orderedList / taskList 及其 item
□  blockquote / callout / toggleList / frameBlock
□  table / tableRow / tableCell
□  columnList / column
□  codeBlock / mathBlock
□  image / figure / video / audio / tweet
□  horizontalRule / hardBreak
□  每个 Converter 的 Round-trip 测试
```

### Phase 4：知识图谱连接

```
□  atom_index 异步索引（文档保存后触发）
□  Atom → node/triple 提取逻辑（按 type 分类处理）
□  from 字段的回填（WebBridge / PDF / AI 对话）
□  meta.nodeIds 回填
```

---

## 十一、设计决策

| # | 决策 | 理由 |
|---|------|------|
| 1 | 统一 Atom 层覆盖所有来源（方案 A） | 消除两张皮，知识图谱有统一的输入格式 |
| 2 | `from` 是一等字段，不是 meta | 来源追溯是知识表示的核心，不是可选附件 |
| 3 | 废弃 `block` 表，合并入 `atom` 表 | 一张表统一存储，source_type 区分来源 |
| 4 | PDF 的 bbox/page 迁移到 from 字段 | 来源信息统一放在 from，不散落在顶层 |
| 5 | figure 保留独立 AtomType（区别于 image） | PDF 图表和 Note 图片语义不同，便于知识提取分类处理 |
| 6 | 容器子节点通过 parentId 关联（扁平存储） | 便于单个 Atom 的独立查询和索引，不嵌套 |
| 7 | Converter 是纯函数 | 无副作用，可缓存，可测试 |
| 8 | 知识图谱连接是异步的（dirty 标记） | 不阻塞编辑体验（P6：懒惰构建） |
| 9 | 迁移采用容错模式 | 旧数据转换失败不阻塞启动，下次重试 |
| 10 | AtomType 与 BlockRegistry 一一对应 | 保证编辑器能力和存储能力持续对齐 |

---

*本文档随设计讨论持续更新。*
*Phase 1 类型定义稳定后，版本升级为 v1.0。*
