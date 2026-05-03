# 里程碑 4 — Session 持久化 + 存储层蓝图

:::callout[NOTE]
**目标**：关闭应用再打开，恢复到离开时的 Workspace 布局。同时完成存储层的蓝图设计（知识图谱三元组模型）。
:::

---

:::toggle-heading[## 一、Session 持久化]

### 解决什么问题

里程碑 1-3 的所有状态都在内存中，关闭应用后丢失。用户下次打开时应该看到和离开时一样的工作环境。

### 保存内容

| 数据 | 来源 | 说明 |
|------|------|------|
| Workspace 列表 + 顺序 | workspaceManager.getAll() | 恢复 WorkspaceBar |
| 每个 Workspace 的 workModeId | WorkspaceState | 恢复 NavSide ModeBar 选中 |
| 每个 Workspace 的 navSideVisible | WorkspaceState | 恢复 NavSide 展开/收起 |
| 每个 Workspace 的 dividerRatio | WorkspaceState | 恢复 Divider 位置 |
| 活跃的 Workspace ID | workspaceManager.getActiveId() | 恢复焦点 |
| NavSide 宽度 | getNavSideWidth() | 恢复拖拽后的宽度 |

### 存储格式

```typescript
interface PersistedSession {
  activeWorkspaceId: string | null;
  workspaces: WorkspaceState[];
  navSideWidth: number;
}
```

文件位置：`{userData}/session.json`（macOS: `~/Library/Application Support/KRIG Note/session.json`）

### 保存时机

- **定时自动保存**：每 30 秒
- **退出前保存**：`app.on('before-quit')`

不在每次状态变更时保存（避免频繁磁盘写入）。

### 恢复流程

```
应用启动
  → loadSession() 读取 session.json
  → 有数据？
    → 有：按顺序重建 Workspace → 恢复 NavSide 宽度 → 切换到活跃 Workspace
    → 无（首次启动）：创建默认 Workspace 1
  → createShell()
```

### 注意事项

Workspace ID 在每次启动时重新生成（因为 WorkspaceManager 用自增 counter）。恢复活跃 Workspace 时通过**索引**匹配（在持久化列表中的位置），而非 ID 匹配。

:::

:::toggle-heading[## 二、核心代码]

### main/storage/session-store.ts

```typescript
// 读取
export function loadSession(): PersistedSession | null;

// 保存
export function saveSession(session: PersistedSession): void;

// 从当前状态构建
export function buildSession(
  workspaces: WorkspaceState[],
  activeId: string | null,
  navSideWidth: number,
): PersistedSession;
```

JSON 文件读写，error handling 静默失败（Session 丢失不影响功能，只是恢复到默认状态）。

### app.ts 集成

```typescript
// 启动时恢复
const session = loadSession();
if (session && session.workspaces.length > 0) {
  // 重建 Workspace + 恢复状态
} else {
  // 创建默认 Workspace
}

// 定时保存
setInterval(persistSession, 30_000);

// 退出前保存
app.on('before-quit', () => persistSession());
```

:::

:::toggle-heading[## 三、存储层蓝图（storage.md）]

本次同步完成了 KRIG Note 的存储层蓝图设计（`ui-framework/storage.md`），核心决策：

### 两层架构

- **核心存储**（编辑器数据）：note, thought, highlight, pdf_book, folder, media
- **知识图谱**（推理数据）：node, triple, atom_index

### Atom 混合存储

- 编辑用：`note.doc_content` 存完整 Atom JSON（原子读写，快）
- 查询用：`atom_index` 表存纯文本索引（异步同步）

### 知识图谱三元组模型

**一生二、二生三、三生万物**：

- **node**：知识的基本粒子（不区分 concept/entity，统一为 node）
- **triple**：(subject, predicate, object)，predicate 是自由文本
- "人事物时空"不硬编码，从三元组模式中由推理模型涌现

### 分步实施

- Phase 1：JSON 文件（当前，快速验证）
- Phase 2：SurrealDB（嵌入式 RocksDB，全文搜索 + 图遍历）
- 接口不变，只换实现

### Thought 统一

Thought 是 NoteView 的 variant（`note:thought`），内容是 Atom[] 文档。存储在统一的 `thought` 表中，无论来源是 Note 还是 PDF。

:::

:::toggle-heading[## 四、累计已验证能力]

### 里程碑 1-3（框架骨架 + 双栏 + 协议/菜单/拖拽）

- ✅ BaseWindow + WebContentsView 多进程架构
- ✅ Toggle / WorkspaceBar / NavSide / Slot 布局
- ✅ WorkMode 注册制 + 切换联动 + View 懒创建
- ✅ Workspace 创建/切换/关闭 + View 池隔离
- ✅ 双栏布局 + Divider 拖拽 + View 间 JSON 消息双工
- ✅ 协同协议注册表（宽松模式）
- ✅ Application Menu（全局稳定）
- ✅ NavSide 宽度拖动 + APP_CONFIG 配置化

### 里程碑 4（本次）

- ✅ **Session 持久化**（关闭恢复 Workspace 布局）
- ✅ **存储层蓝图**（知识图谱三元组模型设计）

### 下一步

- 第一个真实 View 插件（NoteView）
- IStorage 接口层（INoteStore, IThoughtStore）
- 知识图谱基础（node + triple 的 CRUD）

:::
