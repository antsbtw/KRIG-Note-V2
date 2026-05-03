# 存储层 Phase 1 — 最小可用设计

> **目标**：NoteFile 保存/加载 + 操作记录 + 状态记录
> **存储引擎**：SurrealDB（Sidecar + WebSocket）
> **状态**：已实施（SurrealDB Sidecar + note/activity/session 三表）
>
> **注意**：本文档的 Schema 定义（§三）和 NoteRecord 类型（§四）已被取代。
> 权威数据模型见：
> - `docs/Ai-Design/KRIG-Atom体系设计文档.md`（Atom 类型体系）
> - `docs/Ai-Design/KRIG-SurrealDB-Schema设计文档.md`（统一 Schema）
>
> 本文档保留价值：SurrealDB Sidecar 启动流程（§二）、LOCK 清理、IPC 通道（§六）、
> 异步初始化流程（§八）、mirro-desktop 经验（§九）。

---

## 一、架构总览

```
应用启动
  → 立即显示窗口（空文档）            ← 用户 0 延迟
  → 后台启动 SurrealDB Sidecar       ← 异步，不阻塞
  → SurrealDB 就绪
    → 初始化 Schema（3 个表）
    → 恢复 Session（Workspace 布局）
    → 加载 NoteFile 列表 → NavSide Content List
    → 加载上次打开的 NoteFile → 编辑器
  → 就绪
```

### 关键原则

1. **异步初始化**：窗口先开，SurrealDB 后台启动，用户感知不到延迟
2. **编辑不等存储**：编辑器变更 → debounce → 异步写入，不阻塞编辑
3. **直接 SurrealDB**：不做 JSON 中间层，IStorage 只有 SurrealDB 实现
4. **LOCK 清理**：启动前检测并清理残留的 LOCK 文件

---

## 二、SurrealDB 集成

### 2.1 Sidecar 模式（和 mirro-desktop 一致）

```
Electron main process
  → findBinary()          查找 SurrealDB binary
  → cleanLock()           清理残留 LOCK 文件
  → spawn('surreal', ['start', ...])   启动 server 进程
  → waitForReady()        轮询 /health 端点
  → connect('ws://127.0.0.1:{port}/rpc')  WebSocket 连接
```

### 2.2 Binary 查找顺序

```
1. extraResources/surreal      ← 打包内置（生产环境）
2. {userData}/bin/surreal       ← 手动安装
3. /opt/homebrew/bin/surreal    ← Homebrew（macOS 开发）
4. /usr/local/bin/surreal       ← 系统安装
5. which surreal                ← PATH 中查找
```

### 2.3 启动参数

```bash
surreal start \
  --bind 127.0.0.1:{port} \
  --username root \
  --password root \
  --log warn \
  rocksdb://{userData}/krig-db
```

- 端口：默认 8532，冲突时递增探测
- 数据目录：`{userData}/krig-db/`
- 命名空间/数据库：`krig` / `main`

### 2.4 LOCK 文件清理

```typescript
function cleanLock(): void {
  const lockPath = path.join(dbPath, 'LOCK');
  if (fs.existsSync(lockPath)) {
    fs.unlinkSync(lockPath);
  }
}
```

启动前执行，解决 mirro-desktop 遇到的 LOCK 残留问题。

### 2.5 进程生命周期

| 场景 | 处理 |
|------|------|
| 正常退出 | `app.on('will-quit')` → SIGTERM → 等 2s → SIGKILL |
| Electron 崩溃 | 下次启动时 cleanLock() 清理 |
| Server 崩溃 | `proc.on('close')` 检测，标记不可用 |

---

## 三、Schema（3 个表）

### 3.1 note — NoteFile

```sql
DEFINE TABLE note SCHEMALESS;

-- 元数据字段（SCHEMALESS 下不强制，但约定结构）
-- id:           string     NoteFile ID（note-{uuid}）
-- title:        string     从 noteTitle 自动派生
-- doc_content:  array      完整的 ProseMirror Doc JSON（Atom 数组）
-- created_at:   datetime
-- updated_at:   datetime
-- folder_id:    option<string>   所属文件夹（未来）

DEFINE INDEX note_title ON note FIELDS title;
DEFINE INDEX note_updated ON note FIELDS updated_at;
```

**为什么 SCHEMALESS**：doc_content 是嵌套的 Atom JSON 数组，SCHEMAFULL 下 SurrealDB v3 会严格检查所有嵌套字段，和复杂 JSON 结构冲突（mirro-desktop 经验）。

### 3.2 activity — 操作记录

```sql
DEFINE TABLE activity SCHEMALESS;

-- id:           string     自动生成
-- timestamp:    datetime   操作时间
-- action:       string     操作类型（note.create / note.save / note.delete / note.open / ...）
-- target:       option<string>   操作对象（noteId / blockType）
-- metadata:     option<object>   附加信息

DEFINE INDEX activity_time ON activity FIELDS timestamp;
DEFINE INDEX activity_action ON activity FIELDS action;
```

### 3.3 session — 状态记录

```sql
DEFINE TABLE session SCHEMALESS;

-- id:           固定 'current'（只有一条记录）
-- workspaces:   array      Workspace 列表
-- active_workspace_id: string
-- nav_side_width: number
-- updated_at:   datetime
```

替代当前的 session.json 文件。

---

## 四、IStorage 接口

### 4.1 INoteStore

```typescript
interface INoteStore {
  create(title?: string): Promise<NoteRecord>;
  get(id: string): Promise<NoteRecord | null>;
  save(id: string, docContent: unknown[], title: string): Promise<void>;
  delete(id: string): Promise<void>;
  list(): Promise<NoteListItem[]>;
}

interface NoteRecord {
  id: string;
  title: string;
  doc_content: unknown[];     // ProseMirror Doc JSON
  created_at: number;
  updated_at: number;
}

interface NoteListItem {
  id: string;
  title: string;
  updated_at: number;
}
```

### 4.2 IActivityStore

```typescript
interface IActivityStore {
  log(action: string, target?: string, metadata?: Record<string, unknown>): Promise<void>;
  getRecent(limit?: number): Promise<ActivityRecord[]>;
  getByAction(action: string, limit?: number): Promise<ActivityRecord[]>;
}

interface ActivityRecord {
  id: string;
  timestamp: number;
  action: string;
  target?: string;
  metadata?: Record<string, unknown>;
}
```

### 4.3 ISessionStore

```typescript
interface ISessionStore {
  save(session: SessionData): Promise<void>;
  load(): Promise<SessionData | null>;
}

interface SessionData {
  workspaces: WorkspaceState[];
  activeWorkspaceId: string | null;
  navSideWidth: number;
}
```

---

## 五、数据流

### 5.1 NoteFile 保存

```
用户编辑
  → ProseMirror Doc 变更
  → debounce 2 秒
  → 提取 title（从 noteTitle Block）
  → 提取 doc_content（Doc JSON）
  → noteStore.save(id, docContent, title)
  → activityStore.log('note.save', noteId)
```

### 5.2 NoteFile 加载

```
用户点击 NavSide Content List 中的笔记
  → noteStore.get(noteId)
  → 将 doc_content 转为 ProseMirror Doc
  → 编辑器加载文档
  → activityStore.log('note.open', noteId)
```

### 5.3 NoteFile 列表

```
SurrealDB 就绪后
  → noteStore.list()
  → NavSide Content List 显示列表
  → 按 updated_at 倒序排列
```

### 5.4 Session 保存/恢复

```
保存：
  → 定时 30s + 应用退出前
  → sessionStore.save(currentSession)

恢复：
  → SurrealDB 就绪后
  → sessionStore.load()
  → 恢复 Workspace 布局
```

---

## 六、IPC 通道

| 通道 | 方向 | 说明 |
|------|------|------|
| `note:create` | renderer → main | 创建新 NoteFile |
| `note:save` | renderer → main | 保存 NoteFile |
| `note:load` | renderer → main | 加载 NoteFile |
| `note:delete` | renderer → main | 删除 NoteFile |
| `note:list` | renderer → main | 获取 NoteFile 列表 |
| `note:list-changed` | main → renderer | NoteFile 列表变更通知 |
| `db:ready` | main → renderer | SurrealDB 就绪通知 |
| `db:status` | renderer → main | 查询 SurrealDB 状态 |

---

## 七、模块结构

```
src/main/storage/
├── client.ts              ← SurrealDB Sidecar 启动 + WebSocket 连接
├── schema.ts              ← Schema 初始化（3 个表）
├── note-store.ts          ← INoteStore 实现
├── activity-store.ts      ← IActivityStore 实现
├── session-store.ts       ← ISessionStore 实现（替代 JSON 文件）
└── types.ts               ← Record 类型定义
```

---

## 八、异步初始化流程

```
app.whenReady()
  → 1. registerPlugins()
  → 2. registerIpcHandlers()
  → 3. 创建默认 Workspace（空文档）
  → 4. createShell()                    ← 窗口立即显示
  → 5. menuRegistry.rebuild()
  → 6. 异步启动 SurrealDB：
       startSurrealDB()
         → cleanLock()
         → spawn surreal server
         → waitForReady()
         → connect WebSocket
         → initSchema()
         → 恢复 Session
         → 加载 NoteFile 列表 → 通知 renderer
         → 加载上次打开的 NoteFile → 通知 renderer
```

第 1-5 步同步完成（< 100ms），窗口立即显示。
第 6 步异步完成（3-10s），SurrealDB 就绪后自动加载数据。

---

## 九、mirro-desktop 经验借鉴

| mirro-desktop 的坑 | KRIG-Note 的应对 |
|---|---|
| `@surrealdb/node` native binding 不兼容 | 直接用 Sidecar + WebSocket，不试 native binding |
| SurrealDB v3 全文搜索语法变更 | Phase 1 不做全文搜索，后续再研究 v3 语法 |
| SCHEMAFULL + 嵌套 JSON 冲突 | note 表用 SCHEMALESS |
| LOCK 文件残留 | 启动前 cleanLock() |
| 启动慢（15s 超时） | 异步初始化，窗口先开 |
| RecordId 序列化问题 | 用 string ID，不用 RecordId |
| 端口冲突 | 动态端口探测（8532 起） |

---

## 十、后续 Phase

| Phase | 表 | 内容 |
|-------|---|------|
| **1（本次）** | note + activity + session | NoteFile CRUD + 操作记录 + 状态记录 |
| **2** | + thought + highlight | Thought 统一存储 + PDF 高亮 |
| **3** | + folder + media | 文件夹 + 媒体资源 |
| **4** | + node + triple + atom_index | 知识图谱 + 全文搜索 |

---

## 十一、设计原则

1. **异步不阻塞**：SurrealDB 启动不阻塞窗口显示
2. **SCHEMALESS 优先**：避免 v3 的严格类型检查和嵌套 JSON 冲突
3. **String ID**：不用 SurrealDB 的 RecordId，用普通 string 避免序列化问题
4. **操作可追溯**：activity 表记录所有用户操作
5. **状态可恢复**：session 表替代 JSON 文件
6. **编辑不等存储**：debounce + 异步写入
