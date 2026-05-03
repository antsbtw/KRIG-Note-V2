# PDF 全书提取设计

> 状态：设计讨论中
> 参考：mirro-desktop 的 pdf-llm 模块（验证原型，11 份设计文档 + 61 个实现文件）
> 范围：EBookView (PDF) → 全书结构化提取 → Atom → NoteView
>
> **设计约束**：遵循 `principles.md`（分层设计、模块自包含、注册制）和 `design-philosophy.md`（P1 组织思考、P3 Block 双重身份、P6 懒惰构建、P7 系统提议用户确认）
>
> **关联文档**：
> - `EBookView-设计.md`（PDF 阅读器，提取的源头）
> - `KRIG-Atom体系设计文档.md`（统一中间格式，提取的输出）
> - `WebBridge-设计.md`（L4 管线层参考，ExtractedBlock → Atom 转换）
> - `KRIG-Knowledge-Platform-设计.md`（后端平台完整设计文档，含数据库 Schema、API、权限、部署）
>
> **后端架构（三层）**：
> ```
> KRIG-Note（桌面端）
>     ↓ API 调用
> KRIG Knowledge Platform (:8090)  ←→  glm-ocr-service (:8080, 只管 OCR)
>     ↓ PostgreSQL
> 知识资产存储（PDF + Atom + 用户 + 权限）
> ```
> - OCR：GLM-OCR (Vision-Language Model, CUDA float16)
> - 版面分析：DocLayout-YOLO (CPU)
> - 处理速度：~30s/页，300 页 ≈ 2.5 小时

---

## 一、定位：为什么需要全书提取

### 1.1 在 KRIG 思考系统中的角色

全书提取不是"PDF 转文字"，而是将**纸质知识的物理排版**转化为 **KRIG 可编辑、可标注、可关联的 Atom 序列**。

```
PDF 物理页面（图片、排版、公式）
       ↓  全书提取
Atom 序列（结构化、可搜索、可标注、可关联到知识图谱）
       ↓  NoteView
用户的知识载体（编辑、批注、Thought、知识图谱）
```

遵循 P1 原则：系统负责提取和结构化呈现，用户决定哪些内容值得深入、如何组织、如何关联。

### 1.2 与现有能力的关系

| 能力 | 载体 | 说明 |
|------|------|------|
| **阅读 PDF** | EBookView | 已有。渲染 + 翻页 + 缩放 + 标注 |
| **手动提取片段** | EBookView → WebBridge L4 → NoteView | 选区/截图 → AI → Atom → Note |
| **全书提取** | 本文档设计的能力 | 整本书 → 后端处理 → 全量 Atom → 一个或多个 Note |

全书提取是手动提取的**批量化、自动化**版本，共享同一个 Atom 输出格式和 NoteView 接收能力。

### 1.3 不做的功能

| 不做 | 原因 |
|------|------|
| 实时翻译 | 是 NoteView 的 AI 能力，不是提取层的职责 |
| OCR 引擎 | 后端处理，前端只消费结果 |
| PDF 编辑 | PDF 是只读源，编辑在 NoteView 中进行 |
| 多人协同提取 | V1 不需要，未来可通过共享书库实现 |

---

## 二、核心概念

### 2.1 三个角色

```
EBookView（PDF）     KRIG Knowledge Platform     glm-ocr-service     NoteView（编辑器）
   源头                 业务中间层                  OCR 引擎             目的地
   提供 PDF 文件        权限 + 存储 + 调度          纯 OCR 计算          接收 Atom
   触发上传            增量管理 + Web UI            不管业务逻辑          用户编辑审核
                       超时重试 + 去重
```

**关键设计决策**：
- KRIG-Note 前端不做提取逻辑，只做"上传 PDF"和"导入结果"
- Platform 负责业务逻辑（权限、增量、调度），glm-ocr-service 只管 OCR
- Platform 有自己的 Web UI（React），KRIG-Note 通过 WebView 嵌入

### 2.2 ExtractionTask — 提取任务

一次全书提取 = 一个 ExtractionTask。

```typescript
interface ExtractionTask {
  // ── 身份 ──
  taskId: string;               // 后端分配的唯一 ID
  pdfBookId: string;            // EBookView 中的 book ID
  pdfMd5: string;               // PDF 文件 MD5（缓存命中键）

  // ── 范围 ──
  mode: 'whole' | 'chapters';   // 整书 or 分章
  pageStart: number;            // 起始页（1-based）
  pageEnd: number;              // 结束页
  chapters?: Chapter[];         // 分章模式的章节列表

  // ── 状态 ──
  status: TaskStatus;
  progress: TaskProgress;

  // ── 时间 ──
  createdAt: number;            // 毫秒时间戳
  updatedAt: number;
}

type TaskStatus = 'queued' | 'processing' | 'completed' | 'failed';

interface TaskProgress {
  currentPage: number;
  totalPages: number;
  percent: number;              // 0-100
  // 分章模式
  chapterProgress?: ChapterProgress[];
}
```

### 2.3 Chapter — 章节

```typescript
interface Chapter {
  index: number;
  title: string;
  pageStart: number;
  pageEnd: number;
  level: number;                // 层级（1=部/篇，2=章，3=节）
}

interface ChapterProgress extends Chapter {
  status: 'none' | 'processing' | 'available';
  atomCount?: number;           // 已提取的 Atom 数量
  percent?: number;
}
```

### 2.4 提取结果

后端返回的结果最终转化为 Atom 序列（遵循 `KRIG-Atom体系设计文档.md`）。

每个提取出的 Atom 自动携带 `from` 来源追溯：

```typescript
// 提取出的 Atom 的 from 字段
{
  extractionType: 'pdf',
  pdfBookId: 'book:xxx',
  pdfPage: 42,
  pdfBbox: { x, y, w, h },     // 可选，后端提供时填入
  extractedAt: 1712580000000
}
```

---

## 三、提取流程

### 3.1 用户视角

```
① 用户在 EBookView (Left Slot) 中打开 PDF
② 用户点击 Toolbar 的"提取"按钮
③ KRIG 自动上传 PDF 到后端（若未上传过）
④ Right Slot 打开 ExtractionView，导航到该书的详情页
⑤ 用户在后端 web 界面中操作：
   - 查看章节结构（系统检测 → 用户确认）
   - 选择提取范围（整书 / 章节 / 页码）
   - 提交提取请求
   - 查看进度（可以关闭窗口，过一阵子回来看）
   - 提取完成后下载结果
⑥ KRIG 拦截下载 → 转换为 Atom → 导入 Note
```

**核心交互原则**：
- **提交后离开**：300 页 ≈ 2.5 小时，用户不需要守着看。提交后做别的事，回来看结果
- **不自动导入**：提取完成后等待用户在 web 界面中手动下载，KRIG 拦截后导入 Note
- **后端独立**：所有提取管理在后端 web 界面中完成，KRIG 前端只做"上传 PDF"和"导入结果"

### 3.2 数据流

```
EBookView (Left)     ExtractionView (Right)     Platform (:8090)     glm-ocr (:8080)
    │                      │                        │                     │
    │─ upload PDF ────────────────────────────────→ │                     │
    │                      │                        │── 保存 PDF + 入库   │
    │─ 导航 /book/{md5} ─→ │                        │                     │
    │                      │                        │                     │
    │                      │ 用户在 Platform Web UI  │                     │
    │                      │── 选页码 → 提取 ───────→│                     │
    │                      │                        │── 计算增量           │
    │                      │                        │── submit ──────────→│
    │                      │                        │                     │── OCR
    │                      │                        │←── SSE 进度 ────────│
    │                      │                        │── 写入 page_N.json  │
    │                      │                        │── 更新 PostgreSQL   │
    │                      │                        │                     │
    │                      │── 查看进度 ────────────→│                     │
    │                      │←── 进度/状态 ───────────│                     │
    │                      │                        │                     │
    │                      │── 下载 ────────────────→│                     │
    │                      │←── Atom JSON ───────────│                     │
    │                      │                        │                     │
    │←─ KRIG 拦截下载 ─────│                        │                     │
    │── Atom[] → NoteService.createNote() → NoteView│                     │
```

### 3.3 章节检测（P7 的具体应用）

章节检测在后端 web 界面中呈现，体现 P7 原则"系统提议、用户确认"：

后端检测方法（已实现）：
- 中文模式：第N章 → partTitle，第N节 → H1，数字编号自动判定层级
- 英文模式：短大写短语 → H3，Chapter N / Part N → partTitle
- Prompt 工程引导 GLM-OCR 按视觉大小输出 #/##/###

用户在 web 界面中看到章节列表，可以选择提取哪些章节

---

## 四、架构设计

### 4.1 核心架构决策：ExtractionView = WebView 变种

**不在前端做提取 UI**，而是用 WebView 变种嵌入 KRIG Knowledge Platform 的 web 管理界面。

```
Workspace 布局
┌──────────┬──────────────────────┬──────────────────────────┐
│ NavSide  │    Left Slot         │     Right Slot           │
│          │                      │                          │
│          │  EBookView           │  ExtractionView          │
│          │  阅读 PDF 原文       │  (WebView variant)       │
│          │                      │  嵌入 Platform Web UI    │
│          │                      │  192.168.1.240:8091      │
│          │                      │                          │
│          │  ← 拖拽分割线 →      │                          │
└──────────┴──────────────────────┴──────────────────────────┘
```

**三层分工**：

| 层 | 职责 | 技术 |
|---|------|------|
| KRIG-Note 前端 | 上传 PDF + 嵌入 Web UI + 拦截下载导入 Note | Electron WebView |
| KRIG Knowledge Platform | 权限 + 存储 + 增量管理 + Web UI + 调度 OCR | FastAPI + PostgreSQL + React |
| glm-ocr-service | 纯 OCR 计算（不改动） | GLM-OCR + DocLayout-YOLO |

- Platform 是独立公共服务，任何浏览器可访问，不依赖 KRIG-Note
- KRIG-Note 前端零提取逻辑，只做两件事：**上传 PDF** 和 **导入结果**
- 符合 WebView `ai` 变种的先例模式

### 4.2 前端模块（极简）

```
src/plugins/pdf-extraction/          ← 独立插件模块
├── index.ts                         ← 导出：注册 WorkMode + 上传 + 导入
├── types.ts                         ← Atom 转换相关类型
├── upload-service.ts                ← 上传 PDF 到后端（POST /api/v1/library/upload）
├── atom-converter.ts                ← 后端 Atom JSON → KRIG Atom 格式转换
└── import-handler.ts                ← 拦截 webview 下载 → 转为 Atom → 创建 Note
```

**前端只做三件事**：

| 职责 | 说明 |
|------|------|
| 注册 ExtractionView | WebView 变种 `extraction`，加载后端 URL |
| 上传 PDF | EBookView Toolbar 按钮 → 上传当前 PDF → 导航到 `/book/{md5}` |
| 导入结果 | 拦截 webview 下载 → Atom JSON → NoteService.createNote() |

**不在前端做的事**：

| 职责 | 归属 |
|------|------|
| 任务管理、进度展示、章节展示 | 后端 web 界面 |
| 提取逻辑、OCR、版面分析 | 后端 glm-ocr-service |
| PDF 渲染 | EBookView |
| Atom 类型定义 | `src/shared/types/atom-types.ts` |

### 4.3 Left Slot → Right Slot 联动

Left Slot (EBookView) 驱动 Right Slot (ExtractionView)：

```typescript
// EBookView Toolbar 的"提取"按钮点击事件
async function handleExtractClick(pdfFilePath: string) {
  // 1. 上传 PDF（若已上传则秒级返回 md5）
  const { md5 } = await uploadService.upload(pdfFilePath);

  // 2. 打开 Right Slot，导航到书籍详情页
  workspace.openRightSlot('extraction', `http://192.168.1.240:8080/book/${md5}`);

  // 3. 之后用户在 Right Slot 中自主操作，Left Slot 不再干预
}
```

### 4.4 导入结果到 Note

用户在后端 web 界面下载结果时，KRIG 前端拦截并导入：

```typescript
// ExtractionView 的 webview will-download 事件
webview.session.on('will-download', async (event, item) => {
  event.preventDefault();
  
  // 读取下载内容（Atom JSON）
  const atomJson = await fetchDownloadContent(item.getURL());
  
  // 转换为 KRIG Atom 格式
  const atoms = atomConverter.convert(atomJson);
  
  // 创建 Note
  await noteService.createNote({
    title: atomJson.bookName + ' — ' + atomJson.chapterTitle,
    atoms,
    sourceRef: {
      type: 'pdf-extraction',
      pdfMd5: atomJson.md5,
      chapter: atomJson.chapter
    }
  });
});
```

分章下载时，每章创建独立 Note：

```
📁 Thomas' Calculus                  ← 自动创建文件夹
├── 📝 目录                          ← 目录 Note（链接到各章）
├── 📝 第1章 Functions               ← 独立 Note
├── 📝 第2章 Limits and Continuity
├── 📝 第3章 Derivatives
└── ...
```

---

## 五、后端接口

详细接口设计见 `KRIG-Knowledge-Platform-设计.md` 第五节。

### 5.1 KRIG-Note 前端直接调用的接口（仅 2 个）

由于提取管理全在 Platform Web UI 中完成，KRIG-Note 前端只需调用：

| # | 方法 | 端点（Platform :8090） | 用途 | 调用时机 |
|---|------|------|------|---------|
| 1 | POST | `/api/v1/library/upload` | 上传 PDF | EBookView 点击"提取"按钮 |
| 2 | GET | `/api/v1/library/{md5}/download` | 下载 Atom 结果 | webview 拦截下载事件 |

其余所有接口（extract、tasks、chapters、书库列表、用户管理等）由 Platform Web UI 自行调用，KRIG-Note 不参与。

### 5.2 Platform 完整接口（前端不直接调用，由 Web UI 使用）

| 方法 | 端点 | 权限 | 说明 |
|------|------|------|------|
| POST | `/api/v1/auth/register` | public | 注册 |
| POST | `/api/v1/auth/login` | public | 登录，返回 JWT |
| GET | `/api/v1/library` | viewer+ | 列出可见书籍 |
| GET | `/api/v1/library/{md5}` | viewer+ | 书籍详情 |
| POST | `/api/v1/library/upload` | contributor+ | 上传 PDF |
| POST | `/api/v1/library/{md5}/extract` | contributor+ | 提交提取请求（增量） |
| GET | `/api/v1/library/{md5}/download` | viewer+ | 下载 Atom JSON |
| GET | `/api/v1/library/{md5}/chapters` | viewer+ | 章节列表 |
| DELETE | `/api/v1/library/{md5}` | admin | 删除书籍 |

### 5.3 数据格式契约

| 项目 | 规则 |
|------|------|
| 字段命名 | camelCase |
| 时间戳 | 毫秒整数 |
| 页码 | 1-based |
| Atom 格式 | 遵循 `KRIG-Atom体系设计文档.md` |
| 空段落 | 后端不输出 |
| 公式 | 完整 LaTeX 字符串 |
| 图片 | base64 或 URL |

---

## 六、mirro-desktop 经验教训

### 6.1 要带入的设计

| 经验 | 说明 |
|------|------|
| **MD5 去重** | 同一本 PDF 不重复上传和处理 |
| **页面粒度存储** | 后端按页存储结果，支持增量提取 |
| **分章独立 Note** | 每章一个 Note，而不是一个巨大文档 |
| **目录 Note** | 汇总文档，链接到各章 Note |
| **Atom 数据契约** | 统一的 Atom 格式，前后端共识 |

### 6.2 不带入的设计

| mirro-desktop 设计 | 不带入原因 | KRIG-Note 替代方案 |
|-------------------|-----------|-------------------|
| **AI 截图提取路径** | 两条路径增加复杂度 | 全书提取走后端；手动片段提取走 WebBridge |
| **前端提取面板 (React)** | 前端重复实现后端的任务管理 | 后端做 web 界面，前端嵌入 |
| **ExtractionOrchestrator 状态机** | 为 AI 自动化设计的复杂状态机 | 前端只做上传和导入，无需状态机 |
| **PDFController 1635 行巨文件** | 职责混杂 | 各归各模块 |
| **SSE 实时推送到前端** | 前端不需要实时感知进度 | 用户在后端 web 界面查看进度 |
| **前端 snake_case → camelCase 适配** | 不应在前端做清洗 | 后端直接输出正确格式 |

### 6.3 后端已修复的质量问题

基于后端回复（2026-04-08）：

| 问题 | 状态 |
|------|------|
| 公式内联/块级误用 | ✅ 已修复 |
| 图片重复 | ✅ 已修复（IoU > 0.3 去重） |
| 图片插入位置 | ✅ 已修复（按 Y 坐标比例） |
| HTML 表格误识别 | ✅ 已修复 |
| 代码块未闭合 | ✅ 已修复 |
| 标题检测不一致 | ✅ 已改进（prompt 工程） |
| 多栏布局 | ⚠️ 已实现后禁用（误报太多） |

---

## 七、实施计划

### 后端：KRIG Knowledge Platform（新建项目）

详见 `KRIG-Knowledge-Platform-设计.md`

```
Phase B1：项目骨架 + 数据库
  - FastAPI + PostgreSQL + Alembic
  - 四张表：users, books, extraction_tasks, book_access
  - 文件系统：/data/krig-platform/library/{md5_prefix}/{md5}/
  - JWT 认证

Phase B2：PDF 管理 + 提取调度
  - POST /api/v1/library/upload（上传 PDF，永久保存）
  - POST /api/v1/library/{md5}/extract（增量提取，自动跳过已有页）
  - 调度逻辑：查 extracted_pages → 计算差集 → 提交给 glm-ocr-service
  - SSE 监听 glm-ocr-service → 写入 page_N.json → 更新 PostgreSQL
  - 超时重试机制（5 分钟扫描，30 分钟超时，最多重试 3 次）

Phase B3：Web 管理界面（React）
  - 书库首页（/）
  - 书籍详情页（/book/{md5}）— 章节、进度、下载
  - 管理员页面（/admin）— 用户管理、存储空间、任务队列
  - 部署在 :8091
```

### 后端：glm-ocr-service（不改动）

保持现有 API 接口不变，Platform 通过 HTTP 调用它。

### 前端：KRIG-Note

```
Phase F1：ExtractionView 注册
  - WebView 变种 extraction
  - WorkMode 注册
  - 加载 Platform Web UI URL (:8091)

Phase F2：EBookView → ExtractionView 联动
  - Toolbar "提取"按钮
  - upload-service.ts（POST /api/v1/library/upload → 拿到 md5）
  - 打开 Right Slot → 导航到 Platform /book/{md5}

Phase F3：下载结果导入 Note
  - import-handler.ts（拦截 webview will-download）
  - atom-converter.ts（Platform Atom JSON → KRIG Atom）
  - NoteService.createNote()（创建 Note）
  - 分章导入 → 文件夹 + 各章 Note + 目录 Note
```

---

## 八、已确认的设计决策

| # | 决策 | 说明 |
|---|------|------|
| 1 | 三层架构 | KRIG-Note → Platform (业务) → glm-ocr-service (OCR) |
| 2 | Platform 独立项目 | FastAPI + PostgreSQL + React Web UI |
| 3 | glm-ocr-service 不改动 | Platform 通过 HTTP 调用现有接口 |
| 4 | 后端做 web 界面 | Platform 是独立公共服务，任何浏览器可用 |
| 5 | MD5 匹配整本书 | Platform 维护 extracted_pages，自动计算增量 |
| 6 | 数据永久保存 | 不自动删除，管理员手动管理 |
| 7 | PDF 不删除 | 后续请求不用重新上传 |
| 8 | 先上传再操作 | 点击"提取"→ 上传到 Platform → Web UI 操作 |
| 9 | Left 驱动 Right | EBookView 触发上传，ExtractionView 嵌入 Platform Web UI |
| 10 | 权限体系 | admin / contributor / viewer 三角色，JWT 认证 |
| 11 | 共享书库 | 所有用户的提取结果按权限共享 |
| 12 | 超时重试 | Platform 检测 glm-ocr-service 超时并自动重提交 |

---

## 九、未来演进（V2/V3）

### V2：用户编辑版 Atom 书库

用户在 NoteView 中编辑修正提取结果后，可上传回后端：

```
后端 OCR 提取（原始版）→ 用户在 Note 中编辑 → 上传精修版 → 其他用户下载精修版
```

### V3：多版本商城

同一本书有多人的版本，可评分、选择下载：

```
📕 Thomas' Calculus
  版本 A：用户 X 的精修版 ⭐4.8 (23 下载)
  版本 B：用户 Y 的翻译版 ⭐4.5 (15 下载)
  版本 C：原始 OCR 版 ⭐3.2 (8 下载)
```

这些是未来方向，当前 V1 只需确保 Atom 格式可以支撑演进（预留版本和贡献者字段）。
