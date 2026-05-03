# Cross-View Toggle 设计方案

> 在 NoteView / EBookView / WebView 的 Toolbar 增加一个 Toggle 按钮，用于在 Right Slot 中打开任意 View 并实现关联导航 + 锚定同步。

---

## 一、UI 设计：单按钮 + 下拉菜单

### 布局

在每个 View Toolbar 的 `×` 关闭按钮左侧，增加一个 Toggle 按钮：

```
... [⊞ ▾] [×]
```

### 交互

点击弹出下拉菜单：

```
┌─────────────┐
│ 📝 Note     │  ← 当前 right slot 高亮
│ 📕 eBook    │
│ 🌐 Web      │
└─────────────┘
```

| 操作 | 行为 |
|------|------|
| 点选一项 | 在 right slot 打开（或切换到）该 view |
| 再次点选已高亮项 | 关闭 right slot |
| 允许同类型组合 | Note+Note、eBook+eBook、Web+Web 均合法 |

### 组件实现

新建 `src/shared/components/SlotToggle.tsx`：

```tsx
interface SlotToggleProps {
  currentWorkModeId: string;  // 当前 view 的 workModeId
}
```

- 通过 `viewAPI.openRightSlot(workModeId)` 打开/切换
- 通过 `viewAPI.closeSlot()` 关闭（点击已高亮项时）
- 需要知道当前 right slot 状态（新增 IPC 或由 main 推送）

---

## 二、实体入库 — 所有实体进 SurrealDB

### 2.1 现状

原则：**除状态数据外，所有业务数据入库**。

| 实体 | 性质 | 当前存储 | 目标 |
|------|------|---------|------|
| note | 业务数据 | SurrealDB `note` 表 | 已入库 |
| folder (note) | 业务数据 | SurrealDB `folder` 表 | 已入库 |
| activity | 业务数据 | SurrealDB `activity` 表 | 已入库 |
| vocab | 业务数据 | SurrealDB `vocab` 表 | 已入库 |
| **ebook** | 业务数据 | JSON `bookshelf.json` | **待迁移** |
| **ebook folder** | 业务数据 | JSON `bookshelf.json` | **待迁移** |
| **ebook annotation** | 业务数据 | JSON `annotations/{bookId}.json` | **待迁移** |
| **web bookmark** | 业务数据 | JSON `bookmarks.json` | **待迁移** |
| **web bookmark folder** | 业务数据 | JSON `bookmarks.json` | **待迁移** |
| **web history** | 业务数据 | JSON `history.json` | **待迁移** |
| **media index** | 业务数据 | JSON `media-index.json` | **待迁移** |
| session | 运行时状态 | SurrealDB `session` 表 | 保持现状（已入库，不回迁） |

### 2.2 新增 SurrealDB 表

```sql
-- ebook 书籍
DEFINE TABLE ebook SCHEMALESS;
DEFINE INDEX ebook_folder ON ebook FIELDS folder_id;
DEFINE INDEX ebook_opened ON ebook FIELDS last_opened_at;

-- ebook 文件夹
DEFINE TABLE ebook_folder SCHEMALESS;

-- ebook 标注
DEFINE TABLE annotation SCHEMALESS;
DEFINE INDEX annotation_book ON annotation FIELDS book_id;
DEFINE INDEX annotation_page ON annotation FIELDS book_id, page_num;

-- web 书签
DEFINE TABLE bookmark SCHEMALESS;
DEFINE INDEX bookmark_url ON bookmark FIELDS url;
DEFINE INDEX bookmark_folder ON bookmark FIELDS folder_id;

-- web 书签文件夹
DEFINE TABLE bookmark_folder SCHEMALESS;

-- web 浏览历史
DEFINE TABLE web_history SCHEMALESS;
DEFINE INDEX history_visited ON web_history FIELDS visited_at;
DEFINE INDEX history_url ON web_history FIELDS url;

-- 媒体资源索引（音频、图片等）
DEFINE TABLE media SCHEMALESS;
DEFINE INDEX media_url ON media FIELDS original_url;
```

### 2.3 记录结构（保持与现有 JSON 结构一致，平滑迁移）

```typescript
// ebook 表
interface EBookRecord {
  id: string;             // SurrealDB record id
  file_type: 'pdf' | 'epub' | 'djvu' | 'cbz';
  storage: 'link' | 'managed';
  file_path: string;
  original_path?: string;
  file_name: string;
  display_name: string;
  page_count?: number;
  folder_id: string | null;
  added_at: number;
  last_opened_at: number;
  last_position?: { page?: number; scale?: number; fit_width?: boolean; cfi?: string };
  bookmarks?: number[];
  cfi_bookmarks?: Array<{ cfi: string; label: string }>;
}

// annotation 表
interface AnnotationRecord {
  id: string;
  book_id: string;        // → ebook.id
  type: 'rect' | 'underline';
  color: string;
  page_num: number;
  rect: { x: number; y: number; w: number; h: number };
  cfi?: string;
  text_content?: string;
  ocr_text?: string;
  created_at: number;
}

// bookmark 表
interface BookmarkRecord {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  folder_id: string | null;
  created_at: number;
}

// web_history 表
interface WebHistoryRecord {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  visited_at: number;
}

// media 表
interface MediaRecord {
  id: string;             // media_id (如 audio-{hash16}, img-{hash16})
  original_url: string;
  local_path: string;
  size: number;
  mime_type: string;
  created_at: number;
}
```

---

## 三、Graph 关系 — 用 SurrealDB RELATE 建立实体关联

### 3.1 设计理念

所有实体入库后，用 SurrealDB 原生的 Graph 关系（`RELATE`）连接它们。关系本身是 record，可以携带属性（页码范围、锚定信息等）。

这是引入 SurrealDB 的核心价值：为 app 中的实体建立关系图，为未来分析做准备。

### 3.2 关系类型定义

```
┌──────────┐  sourced_from   ┌──────────┐
│   note   │ ──────────────→ │  ebook   │
│          │ ←────────────── │          │
└──────────┘  has_notes      └──────────┘
      │                            │
      │ sourced_from               │ (annotation 是 ebook 的属性，不需要 RELATE)
      ▼                            │
┌──────────┐                       │
│ bookmark │ (web page)            │
│ /web_url │                       │
└──────────┘                       │
      │                            │
      └────── referenced_by ───────┘
              (少见，手动关联)
      
┌──────────┐  links_to      ┌──────────┐
│  note A  │ ──────────────→ │  note B  │
└──────────┘                 └──────────┘
```

### 3.3 RELATE 定义 + 边属性

```sql
-- ═══════════════════════════════════════
-- 关系边表定义
-- ═══════════════════════════════════════

-- note → ebook：笔记来源于某本书
DEFINE TABLE sourced_from SCHEMALESS;
-- 边属性：
--   extraction_type: 'pdf' | 'epub'
--   page_start: int          -- 该笔记内容覆盖的起始页
--   page_end: int            -- 该笔记内容覆盖的结束页
--   chapter_title: string    -- 章节名
--   created_at: int

-- note → web_url：笔记来源于某个网页
DEFINE TABLE clipped_from SCHEMALESS;
-- 边属性：
--   url: string
--   page_title: string
--   created_at: int

-- note → note：笔记间链接引用
DEFINE TABLE links_to SCHEMALESS;
-- 边属性：
--   created_at: int

-- ebook → ebook：系列书籍（预留）
DEFINE TABLE series_of SCHEMALESS;
-- 边属性：
--   order: int
--   series_name: string
```

### 3.4 RELATE 操作示例

```sql
-- 导入 PDF 章节后，建立 note → ebook 关系
RELATE note:chapter1 -> sourced_from -> ebook:book123
  SET extraction_type = 'pdf',
      page_start = 1,
      page_end = 30,
      chapter_title = '第一章 函数与极限',
      created_at = time::now();

-- 网页剪藏后，建立 note → bookmark 关系
RELATE note:clip001 -> clipped_from -> bookmark:bm456
  SET url = 'https://example.com/article',
      page_title = 'Some Article',
      created_at = time::now();

-- 笔记间链接
RELATE note:noteA -> links_to -> note:noteB
  SET created_at = time::now();
```

### 3.5 Graph 查询

```sql
-- ══════════════════════════════════════
-- 关联发现查询（替代遍历 atoms）
-- ══════════════════════════════════════

-- 1) 某本书关联的所有笔记
SELECT <-sourced_from<-note FROM ebook:book123;

-- 2) 某本书关联的笔记，按页码范围过滤（当前翻到第 15 页）
SELECT <-sourced_from<-note FROM ebook:book123
  WHERE page_start <= 15 AND page_end >= 15;

-- 3) 某篇笔记的来源书籍
SELECT ->sourced_from->ebook FROM note:chapter1;

-- 4) 某篇笔记的来源网页
SELECT ->clipped_from->bookmark FROM note:clip001;

-- 5) 某篇笔记链接到的其他笔记
SELECT ->links_to->note FROM note:noteA;

-- 6) 反向：哪些笔记链接到了这篇笔记
SELECT <-links_to<-note FROM note:noteB;

-- 7) 某个网页 URL 关联的所有笔记
SELECT <-clipped_from<-note FROM bookmark WHERE url = 'https://example.com/article';

-- ══════════════════════════════════════
-- 多跳查询（Graph 的独特优势）
-- ══════════════════════════════════════

-- 8) 同一本书的所有笔记（当前笔记 → 来源书 → 所有笔记）
SELECT ->sourced_from->ebook<-sourced_from<-note FROM note:chapter1;

-- 9) 与当前笔记共享来源的其他笔记（知识图谱发现）
SELECT ->sourced_from->ebook<-sourced_from<-note AS related,
       ->clipped_from->bookmark<-clipped_from<-note AS web_related
FROM note:chapter1;

-- 10) 某本书 → 所有笔记 → 这些笔记引用的其他书（推荐阅读）
SELECT <-sourced_from<-note->sourced_from->ebook FROM ebook:book123;
```

### 3.6 写入时机

| 事件 | 写入操作 |
|------|---------|
| PDF/EPUB 导入（import-service） | `RELATE note → sourced_from → ebook`，附带 page_start/page_end |
| 网页剪藏 | `RELATE note → clipped_from → bookmark` |
| 笔记中插入 note-link | `RELATE note → links_to → note` |
| 笔记中删除 note-link | `DELETE` 对应的 `links_to` 边 |
| 用户手动关联（未来） | 通过 UI 手动建立任意 RELATE |

### 3.7 与 Atom.from 的关系

`Atom.from`（FromReference）保留不变——它记录的是**每个 atom 级别**的精确来源（具体页码、bbox、CFI）。

Graph 关系是**文档级别**的关联（note ↔ ebook），用于快速发现和导航。

两者互补：
- **Graph 关系**：快速回答"这本书有哪些笔记？" → 用于 SlotToggle 关联发现
- **Atom.from**：精确回答"这个段落来自第几页？" → 用于锚定同步时的位置定位

---

## 四、关联发现

### 4.1 关联发现服务

基于 Graph 查询，不再遍历 atoms：

```typescript
// IPC: 'association:find-related'

interface FindRelatedRequest {
  sourceType: 'note' | 'ebook' | 'web';
  sourceId: string;
  targetType: 'note' | 'ebook' | 'web';
  hint?: { currentPage?: number; currentUrl?: string };  // 辅助精确匹配
}

interface FindRelatedResponse {
  found: boolean;
  items: Array<{
    id: string;
    title: string;
    relevance: 'exact' | 'range' | 'loose';  // 匹配精确度
    anchorHint?: AnchorPayload;
  }>;
}
```

实现（main 进程）：

```typescript
async function findRelated(req: FindRelatedRequest): Promise<FindRelatedResponse> {
  const { sourceType, sourceId, targetType, hint } = req;

  if (sourceType === 'ebook' && targetType === 'note') {
    // Graph 查询：ebook 的所有关联笔记
    const all = await db.query(
      `SELECT <-sourced_from<-note.* FROM ebook:$id`, { id: sourceId }
    );
    // 按页码范围排序，精确匹配当前页
    if (hint?.currentPage) {
      // exact: page_start <= currentPage <= page_end
      // range: 同一本书但不含当前页的章节
    }
    return { found: all.length > 0, items: ranked };
  }

  if (sourceType === 'note' && targetType === 'ebook') {
    // Graph 查询：笔记的来源书籍
    const books = await db.query(
      `SELECT ->sourced_from->ebook.* FROM note:$id`, { id: sourceId }
    );
    return { found: books.length > 0, items: books };
  }

  // ... 其他组合类似
}
```

### 4.2 导航优先级

```
1. Graph 查询关联文件
   → 有精确匹配（exact）：自动打开 + 锚定
   → 有多个匹配：自动打开最相关的 + 显示选择下拉
2. 无关联 → 在 right slot 显示「选择文件」界面
```

### 4.3 多关联文件 — 页码匹配优先 + 用户可选

```
┌─ Right Slot ─────────────────────────┐
│ [第一章 函数与极限 ▾]  ← 关联笔记选择  │
│                                       │
│  笔记内容...                          │
└───────────────────────────────────────┘
```

匹配逻辑：
```typescript
const matched = relatedNotes
  .filter(n => n.page_start <= currentPage && currentPage <= n.page_end)
  .sort((a, b) => a.page_start - b.page_start);

if (matched.length > 0) {
  openNote(matched[0].id);   // 自动打开最匹配的
  showSelector(matched);      // 同时显示选择器
} else {
  showSelector(relatedNotes); // 无精确匹配，展示全部关联
}
```

### 4.4 无关联时的文件选择

| 目标 View | 选择内容 |
|-----------|---------|
| Note | 笔记列表（复用 NavSide note-list 数据） |
| eBook | 书架列表（复用 bookshelf 数据，现已在 SurrealDB） |
| Web | 书签列表 + URL 输入框 |

---

## 五、锚定同步协议（双工通信）

基于现有 `protocolRegistry` + `sendToOtherSlot` / `onMessage` 机制。

### 5.1 通用锚定消息格式

```typescript
interface AnchorSyncMessage {
  protocol: string;
  action: 'anchor-sync';
  payload: AnchorPayload;
}

interface AnchorPayload {
  anchorType: 'pdf-page' | 'epub-cfi' | 'url' | 'note-link' | 'scroll-position';

  // PDF 锚定
  pdfPage?: number;
  pdfBbox?: { x: number; y: number; w: number; h: number };

  // EPUB 锚定
  epubCfi?: string;

  // Web 锚定
  url?: string;
  scrollY?: number;

  // Note 锚定
  atomId?: string;
  noteId?: string;
}
```

### 5.2 各组合锚定方法

#### eBook(PDF) ↔ Note — 基于 `from.pdfPage`

最成熟的路径，数据已完备。

```
eBook 翻页
  → send({ anchorType: 'pdf-page', pdfPage: 5 })
  → Note 扫描 atoms，找 from.pdfPage === 5 的第一个 atom
  → scrollIntoView

Note 光标移动
  → 读取当前 atom 的 from.pdfPage
  → send({ anchorType: 'pdf-page', pdfPage: N })
  → eBook goToPage(N)
```

#### eBook(EPUB) ↔ Note — 基于 `from.epubCfi`

```
eBook 翻章/翻页
  → send({ anchorType: 'epub-cfi', epubCfi: '...' })
  → Note 找 from.epubCfi 最近的 atom → scrollIntoView

Note 光标移动
  → 读取 from.epubCfi → send(...)
  → eBook goTo({ type: 'cfi', cfi })
```

#### Note ↔ Web — 基于 `from.url`

```
Note 光标到含 from.url 的 atom
  → send({ anchorType: 'url', url: '...' })
  → Web 导航到该 URL

Web 页面 URL 变化
  → send({ anchorType: 'url', url: currentUrl })
  → Note 找 from.url 匹配的 atom → scrollIntoView
```

#### Note ↔ Note — 文件级导航

```
Note-A 点击 note-link
  → send({ anchorType: 'note-link', noteId: '...' })
  → Note-B 加载对应 noteId
（仅文件级导航，无位置同步）
```

#### 同类型（eBook↔eBook, Web↔Web）

无自动锚定，独立操作。

### 5.3 锚定同步频率

默认 **300ms debounce**，通过常量控制便于调试：

```typescript
// src/shared/constants.ts
export const ANCHOR_SYNC_DEBOUNCE_MS = 300;
```

### 5.4 需要新增的协议注册

现有：`demo-sync` (note→ebook)、`demo-sync-reverse` (ebook→note)、`ebook-extraction`

需补充：

```typescript
// app.ts
protocolRegistry.register({ id: 'note-web',    match: { left: { type: 'note' },  right: { type: 'web' } } });
protocolRegistry.register({ id: 'web-note',    match: { left: { type: 'web' },   right: { type: 'note' } } });
protocolRegistry.register({ id: 'web-ebook',   match: { left: { type: 'web' },   right: { type: 'ebook' } } });
protocolRegistry.register({ id: 'ebook-web',   match: { left: { type: 'ebook' }, right: { type: 'web' } } });
protocolRegistry.register({ id: 'note-note',   match: { left: { type: 'note' },  right: { type: 'note' } } });
protocolRegistry.register({ id: 'ebook-ebook', match: { left: { type: 'ebook' }, right: { type: 'ebook' } } });
protocolRegistry.register({ id: 'web-web',     match: { left: { type: 'web' },   right: { type: 'web' } } });
```

---

## 六、涉及的文件变更

### 新建

| 文件 | 说明 |
|------|------|
| `src/shared/components/SlotToggle.tsx` | Toggle 下拉菜单组件 |
| `src/main/association/find-related.ts` | 关联发现服务（基于 Graph 查询） |
| `src/main/ebook/bookshelf-surreal-store.ts` | eBook 书架 SurrealDB 存储 |
| `src/main/ebook/annotation-surreal-store.ts` | eBook 标注 SurrealDB 存储 |
| `src/plugins/web/main/bookmark-surreal-store.ts` | Web 书签 SurrealDB 存储 |
| `src/plugins/web/main/history-surreal-store.ts` | Web 历史 SurrealDB 存储 |
| `src/main/media/media-surreal-store.ts` | 媒体索引 SurrealDB 存储 |

### 修改

| 文件 | 变更 |
|------|------|
| `src/main/storage/schema.ts` | 新增 ebook / annotation / bookmark / web_history / 关系边表 |
| `src/main/app.ts` | 补充协议注册 + 数据迁移启动逻辑 |
| `src/main/ipc/handlers.ts` | 注册 `association:find-related` IPC；导入时写入 RELATE |
| `src/main/extraction/import-service.ts` | 导入后建立 `note → sourced_from → ebook` 关系 |
| `src/main/preload/view.ts` | 暴露 `findRelated` API |
| `src/shared/types.ts` | 新增 AnchorPayload / FindRelatedRequest / FindRelatedResponse |
| `src/plugins/note/components/NoteView.tsx` | Toolbar 中加入 `<SlotToggle>` |
| `src/plugins/ebook/components/EBookToolbar.tsx` | 加入 `<SlotToggle>` |
| `src/plugins/web/components/WebToolbar.tsx` | 加入 `<SlotToggle>` |
| 各 View 组件 | 实现 `onMessage` 中的 `anchor-sync` 处理逻辑 |

---

## 七、实施阶段

| 阶段 | 内容 | 复杂度 |
|------|------|--------|
| **P0** | 实体入库：ebook / annotation / bookmark / web_history / media 迁移到 SurrealDB | 中 |
| **P1** | SlotToggle 组件 + openRightSlot + 无关联时的文件选择 | 低 |
| **P2** | Graph 关系建立：导入时 RELATE + 关联发现服务 | 中 |
| **P3** | eBook(PDF) ↔ Note 的 pdfPage 锚定同步 | 中 |
| **P4** | Note ↔ Web 的 URL 锚定 + EPUB ↔ Note 的 CFI 锚定 | 中 |
| **P5** | 同类型组合（Note↔Note 等） + 多跳查询（推荐阅读等） | 低 |

---

## 八、已确认决策

1. **关联发现**：使用 SurrealDB Graph 关系（`RELATE`），不建独立索引表。所有实体入库，用原生图查询替代遍历 atoms。
2. **锚定同步频率**：默认 300ms debounce，抽为 `ANCHOR_SYNC_DEBOUNCE_MS` 常量。
3. **多关联文件**：按当前页码范围匹配优先 + right slot 顶部下拉选择器，用户可切换。
4. **Atom.from 与 Graph 互补**：Graph 做文档级关联发现，Atom.from 做 atom 级精确锚定，两者各司其职。
