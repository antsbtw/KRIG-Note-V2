# KRIG Knowledge Platform — 设计文档

> 版本：v0.1
> 状态：Phase 1 设计稿
> 日期：2026-04-08

---

## 一、定位与边界

### 1.1 是什么

KRIG Knowledge Platform 是一个独立的 Web 服务，负责管理所有知识资产：

- PDF 源文件及提取结果（Atom JSON）
- 用户贡献的 Note 内容
- 知识图谱关系
- 用户身份与权限

### 1.2 不是什么

Platform **不负责** OCR 计算。PDF 提取能力由 `glm-ocr-service` 提供，Platform 通过 HTTP 调用它，两者独立部署，互不侵入。

```
KRIG-Note（桌面端）
    ↓ API 调用
KRIG Knowledge Platform     ←→     glm-ocr-service（只管提取）
    ↓ PostgreSQL
知识资产存储
```

### 1.3 glm-ocr-service 接口契约（只读，不改动）

| 接口 | 用途 |
|------|------|
| `POST /api/v1/pdf/submit` | 提交提取任务，返回 `task_id` |
| `GET /api/v1/pdf/status/{task_id}` | 查询任务进度 |
| `GET /api/v1/pdf/stream/{task_id}` | SSE 实时推送，每 10 页一次 |
| `GET /api/v1/pdf/result/{task_id}` | 获取完成的 Atom JSON |
| `GET /api/v1/pdf/lookup` | 按 MD5 查找已有任务 |

**已知限制（Platform 侧处理，不要求后端修改）：**

- 去重 key 为 `{md5}:{page_start}:{page_end}` 精确匹配，不支持增量提取 → Platform 自己维护已提取页码状态，拆分增量请求
- 服务重启后 processing/queued 任务不自动恢复 → Platform 实现超时检测 + 重新提交机制

---

## 二、模块规划

### 2.1 总览

```
┌─────────────────────────────────────────────┐
│           KRIG Knowledge Platform           │
│                                             │
│  User & Auth    │    Note Store             │
│  PDF Extraction │    Knowledge Graph        │
│  Search         │    Share                  │
│                                             │
│         Platform REST API                   │
│                                             │
│    Web UI (React)  │  KRIG-Note (API)       │
└─────────────────────────────────────────────┘
```

### 2.2 Phase 1 范围（当前目标）

只建两个模块，其余暂不开发：

**User & Auth**
- 用户注册 / 登录，JWT token
- 三个角色：`admin` / `contributor` / `viewer`
- 所有其他模块的认证前提

**PDF Extraction**
- 接收 PDF 上传，持久化存储源文件
- 维护已提取页码状态，支持增量提取
- 调度任务到 glm-ocr-service，处理超时重试
- 存储返回的 Atom JSON，按书籍 / 页码组织
- 基础访问权限控制

### 2.3 后续模块（Phase 2+，暂不设计）

| 模块 | 职责 |
|------|------|
| Note Store | 用户手写 Note 存储、版本管理，复用 Atom 格式契约 |
| Share | 完善版本发布、审核、下载计数 |
| Knowledge Graph | 节点关系存储，对接 KRIG-Note SurrealDB |
| Search | 全文检索 + 向量检索（pg_vector） |

---

## 三、技术栈

| 层 | 选型 | 说明 |
|----|------|------|
| 后端框架 | FastAPI + Python 3.11 | ASGI 异步，IO 密集场景够用 |
| 数据库 | PostgreSQL 16 | 主数据存储，为后续图查询、向量检索预留扩展空间 |
| ORM | SQLAlchemy 2.0 (async) | 异步 ORM，配合 asyncpg 驱动 |
| 数据库迁移 | Alembic | 版本化 schema 管理 |
| 认证 | JWT（python-jose） | 无状态 token，适合多客户端 |
| 前端 | React + TypeScript + Vite | 与 KRIG-Note 共享技术语言 |
| 部署 | 与 glm-ocr-service 同机，不同端口 | Platform 建议端口 `8090` |

---

## 四、数据库设计（Phase 1）

### 4.1 设计原则

- 可查询的元数据进库（用户、书籍状态、任务、权限）
- 二进制和大 JSON 留文件系统，用 MD5 关联
- Phase 1 只建必要的四张表，后续模块加新表，不改现有结构

### 4.2 表结构

#### `users` — 用户表

```sql
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'contributor',
                  -- admin | contributor | viewer
    is_active     BOOLEAN DEFAULT TRUE,
    created_at    BIGINT NOT NULL,   -- 毫秒时间戳
    last_login    BIGINT
);
```

**角色能力边界：**

| 能力 | admin | contributor | viewer |
|------|-------|-------------|--------|
| 上传 PDF | ✅ | ✅ | ❌ |
| 提交提取任务 | ✅ | ✅ | ❌ |
| 下载（受权限控制） | ✅ | ✅ | ✅ |
| 修改书籍可见性 | ✅ | 仅自己上传的 | ❌ |
| 删除书籍 | ✅ | ❌ | ❌ |
| 管理用户 | ✅ | ❌ | ❌ |

#### `books` — 书籍元数据表

```sql
CREATE TABLE books (
    md5              TEXT PRIMARY KEY,
    file_name        TEXT NOT NULL,
    total_pages      INTEGER NOT NULL,
    file_size        BIGINT NOT NULL,
    uploaded_at      BIGINT NOT NULL,
    uploaded_by      UUID NOT NULL REFERENCES users(id),

    -- 提取统计（冗余字段，避免扫描文件系统）
    extracted_pages  INTEGER[] DEFAULT '{}',  -- 已提取页码列表
    total_atoms      INTEGER DEFAULT 0,
    last_extracted   BIGINT,

    -- 权限
    visibility       TEXT DEFAULT 'private',
                     -- public | private | restricted

    -- 章节检测状态
    chapters_status  TEXT DEFAULT 'pending'
                     -- pending | processing | done | failed
);
```

#### `extraction_tasks` — 提取任务表

Platform 侧独立维护任务状态，不依赖 glm-ocr-service 的内存。

```sql
CREATE TABLE extraction_tasks (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    book_md5         TEXT NOT NULL REFERENCES books(md5),
    submitted_by     UUID NOT NULL REFERENCES users(id),
    submitted_at     BIGINT NOT NULL,

    page_start       INTEGER NOT NULL,
    page_end         INTEGER NOT NULL,
    pages_needed     INTEGER[] NOT NULL,  -- 实际需处理页码（去掉已有的）

    -- glm-ocr-service 侧状态
    ocr_task_id      TEXT,                -- glm-ocr-service 返回的 task_id
    ocr_submitted_at BIGINT,

    -- Platform 侧状态
    status           TEXT DEFAULT 'queued',
                     -- queued | submitted | processing | done | failed | timeout
    current_page     INTEGER,
    completed_pages  INTEGER DEFAULT 0,
    started_at       BIGINT,
    finished_at      BIGINT,
    error_message    TEXT,
    retry_count      INTEGER DEFAULT 0   -- 超时重试次数，上限 3
);

CREATE INDEX idx_extraction_tasks_status  ON extraction_tasks(status);
CREATE INDEX idx_extraction_tasks_book    ON extraction_tasks(book_md5);
CREATE INDEX idx_extraction_tasks_ocr_id ON extraction_tasks(ocr_task_id);
```

#### `book_access` — 书籍访问权限表

仅 `visibility = 'restricted'` 时使用。

```sql
CREATE TABLE book_access (
    book_md5    TEXT NOT NULL REFERENCES books(md5) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    granted_by  UUID NOT NULL REFERENCES users(id),
    granted_at  BIGINT NOT NULL,
    PRIMARY KEY (book_md5, user_id)
);
```

**查询"当前用户可见的书"：**

```sql
SELECT * FROM books
WHERE visibility = 'public'
   OR uploaded_by = :current_user_id
   OR md5 IN (
       SELECT book_md5 FROM book_access
       WHERE user_id = :current_user_id
   );
```

### 4.3 文件系统结构

```
/data/krig-platform/
├── library/
│   └── {md5_prefix}/{md5}/
│       ├── source.pdf          -- 原始 PDF（永久保留）
│       ├── pages/
│       │   ├── page_001.json   -- 单页 Atom JSON
│       │   ├── page_002.json
│       │   └── ...
│       └── chapters.json       -- 章节检测缓存
└── config.json
```

数据库管理元数据，文件系统存二进制和大 JSON，通过 MD5 关联。

---

## 五、API 接口设计（Phase 1）

### 5.1 认证接口

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/v1/auth/register` | 注册（首次部署或 admin 邀请） |
| POST | `/api/v1/auth/login` | 登录，返回 JWT token |
| POST | `/api/v1/auth/logout` | 登出（token 加入黑名单） |
| GET  | `/api/v1/auth/me` | 获取当前用户信息 |

### 5.2 书籍 / 提取接口

| 方法 | 端点 | 权限 | 说明 |
|------|------|------|------|
| GET    | `/api/v1/library` | viewer+ | 列出当前用户可见的书籍 |
| GET    | `/api/v1/library/{md5}` | viewer+ | 获取书籍详情（含已提取页码、章节） |
| POST   | `/api/v1/library/upload` | contributor+ | 上传 PDF，返回 md5（已存在则秒返） |
| DELETE | `/api/v1/library/{md5}` | admin | 删除书籍及所有提取结果 |
| PATCH  | `/api/v1/library/{md5}/visibility` | contributor（限自己） | 修改可见性 |
| POST   | `/api/v1/library/{md5}/extract` | contributor+ | 提交提取请求（增量，自动跳过已有页） |
| GET    | `/api/v1/library/{md5}/tasks` | contributor+ | 列出该书的任务历史 |
| GET    | `/api/v1/library/{md5}/download` | viewer+ | 下载 Atom JSON（支持页码范围） |
| GET    | `/api/v1/library/{md5}/chapters` | viewer+ | 获取章节列表 |
| POST   | `/api/v1/admin/book-access` | admin | 为 restricted 书籍授权用户 |

### 5.3 关键请求 / 响应示例

**上传 PDF：**

```http
POST /api/v1/library/upload
Content-Type: multipart/form-data

file=<binary>
title="Thomas' Calculus 14th Edition"   (optional)
visibility=private                       (default)
```

```json
{
  "md5": "abc123...",
  "fileName": "Thomas Calculus.pdf",
  "totalPages": 1212,
  "alreadyExists": false
}
```

**提交提取请求（增量）：**

```http
POST /api/v1/library/{md5}/extract
{
  "pageStart": 1,
  "pageEnd": 300
}
```

```json
{
  "taskId": "uuid-xxx",
  "pagesRequested": 300,
  "pagesAlreadyExtracted": 0,
  "pagesQueued": 300,
  "estimatedMinutes": 150
}
```

Platform 内部逻辑：查 `books.extracted_pages`，计算差集，只把未提取的页码提交给 glm-ocr-service。

**下载提取结果：**

```http
GET /api/v1/library/{md5}/download?pageStart=1&pageEnd=100&format=atom
```

```json
{
  "md5": "abc123...",
  "pages": [
    {
      "pageNumber": 1,
      "atoms": [...],
      "positions": [...],
      "pageSize": { "width": 595, "height": 842 }
    }
  ]
}
```

### 5.4 管理员接口

| 方法 | 端点 | 说明 |
|------|------|------|
| GET   | `/api/v1/admin/users` | 列出所有用户 |
| POST  | `/api/v1/admin/users` | 创建用户 |
| PATCH | `/api/v1/admin/users/{id}` | 修改角色 / 停用账号 |
| GET   | `/api/v1/admin/storage` | 查看存储使用情况 |
| GET   | `/api/v1/admin/queue` | 查看全局任务队列状态 |

---

## 六、任务调度设计

### 6.1 增量提取流程

```
用户提交 extract(md5, p1-300)
    ↓
Platform 查 books.extracted_pages
    ↓
计算差集 → pages_needed = [1..300] - already_extracted
    ↓
pages_needed 为空？
    → 是：直接返回，无需提交
    → 否：创建 extraction_tasks 记录，提交给 glm-ocr-service
    ↓
轮询 / SSE 监听 glm-ocr-service 进度
    ↓
每个 segment 完成 → 写入文件系统 → 更新 books.extracted_pages
    ↓
任务完成 → extraction_tasks.status = done
```

### 6.2 超时重试机制

针对 glm-ocr-service 重启后任务卡住的问题：

- 后台定时任务每 5 分钟扫描 `status = 'submitted' OR 'processing'` 的任务
- 若 `now - ocr_submitted_at > 30min` 且无进度更新 → 判定超时
- 将任务重置为 `queued`，`retry_count + 1`
- `retry_count >= 3` → 标记为 `failed`，通知用户

---

## 七、KRIG-Note 集成方式

### 7.1 上传并触发提取

用户在 EBookView 点击"提取"按钮：

```
1. KRIG-Note 获取当前 PDF 路径
2. POST /api/v1/library/upload  →  拿到 md5
3. POST /api/v1/library/{md5}/extract (pageStart, pageEnd)
4. ExtractionView（WebView）导航到 Platform Web UI /book/{md5}
5. 用户在 Web UI 中自主查看进度、下载结果
```

### 7.2 导入提取结果到 Note

推荐方案：**拦截 webview 下载事件（will-download）**

```
用户在 Platform Web UI 点击"下载"
    ↓
webview 触发 will-download 事件
    ↓
KRIG-Note 拦截，读取 Atom JSON
    ↓
NoteService.createFromAtoms(atoms)
    ↓
在当前 workspace 创建新 Note
```

Platform Web UI 同时提供"复制 Atom JSON 到剪贴板"按钮，作为非 KRIG 环境下的备用方案。

---

## 八、部署说明

### 8.1 端口规划

| 服务 | 地址 |
|------|------|
| glm-ocr-service | `192.168.1.240:8080` |
| KRIG Knowledge Platform API | `192.168.1.240:8090` |
| KRIG Knowledge Platform Web UI | `192.168.1.240:8091` |

### 8.2 目录结构

```
krig-platform/
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── api/
│   │   │   ├── auth.py
│   │   │   ├── library.py
│   │   │   └── admin.py
│   │   ├── models/             -- SQLAlchemy ORM models
│   │   ├── schemas/            -- Pydantic request/response schemas
│   │   ├── services/
│   │   │   ├── extraction.py   -- 调度 glm-ocr-service
│   │   │   └── storage.py      -- 文件系统管理
│   │   └── core/
│   │       ├── auth.py         -- JWT 工具
│   │       └── config.py
│   ├── alembic/                -- 数据库迁移
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Library.tsx     -- 书库首页
│   │   │   └── BookDetail.tsx  -- 书籍详情页
│   │   ├── components/
│   │   └── api/                -- API 调用层
│   └── package.json
└── docker-compose.yml          -- PostgreSQL + Platform 一键启动
```

---

## 九、未解决的问题（待后续讨论）

| 问题 | 优先级 | 说明 |
|------|--------|------|
| Note Store 的 Atom 格式与 PDF 提取结果是否完全复用同一契约？ | 高 | 影响 Phase 2 数据模型设计 |
| 用户注册是开放还是仅限 admin 邀请？ | 中 | 影响 Auth 模块实现 |
| 提取结果是否需要版本管理（提取质量提升后重新提取）？ | 中 | 影响文件系统设计 |
| Knowledge Graph 与 KRIG-Note 的 SurrealDB 如何同步？ | 低 | Phase 3+ 再讨论 |

---

*文档将随开发进展持续更新。*
