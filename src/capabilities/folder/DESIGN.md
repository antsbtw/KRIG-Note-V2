# folder capability

> v0.2 · 2026-05-12 · L7-sub2 + L7-sub3a-1 反向更新
>
> 配套:
> - [decision 012](../../../docs/RefactorV2/data-model/persistence/decisions/012-sub-phase-2-note-folder-migration.md) — sub-phase 2 基础设计
> - [decision 014](../../../docs/RefactorV2/data-model/persistence/decisions/014-sub-phase-3a-1-graph-canvas-instance-migration.md) — sub-phase 3a-1 cascade scope 扩展

## 职责

文件夹层级管理 (CRUD + 嵌套 + 内含笔记)。folder 嵌套 + note 归属共用同一条边类型
`user:krig:inFolder` (decision 012 §3.1 §3.3)。

view 通过 `requireCapabilityApi<FolderCapabilityApi>('folder')` 拿 api。

## 实现位置

| 层 | 路径 | 备注 |
|---|---|---|
| Renderer 入口 | `src/capabilities/folder/index.ts` | IPC 调用封装 + capabilityRegistry 注册 |
| 类型 | `src/capabilities/folder/types.ts` | FolderCapabilityApi + FolderInfo + FolderDeleteResult |
| Main 实现 | `src/platform/main/folder/capability-impl.ts` | create/list/get/rename/move/delete 7 API |
| IPC handlers | `src/platform/main/folder/handlers.ts` | 6 ipcMain.handle + broadcastFolderListChanged |
| IPC channel | `src/shared/ipc/channel-names.ts` 加 FOLDER_* 7 条 | |
| preload | `src/platform/main/preload/main-window-preload.ts` 末尾追加 | folderCreate / List / Get / Rename / Move / Delete + onFolderListChanged |
| electron-api 类型 | `src/shared/ipc/electron-api.d.ts` 末尾追加 | |

## 数据模型

```ts
// atom 形态 (decision 012 §3.1):
{
  payload: {
    domain: 'folder',
    payload: { title: string },
  }
}

// folder 嵌套 / note 归属用边表达:
edge:
  predicate: 'user:krig:inFolder'
  subject: AtomRef(atomId=<note 或 folder atomId>)
  object: AtomRef(atomId=<父 folder atomId>)
  attrs: { createdBy:'user-default', createdAt:... }

// view ↔ capability 边界 (FolderInfo):
{
  id: ULID,
  title: <atom.payload.payload.title>,
  parentId: <派生自 inFolder 边>,
  createdAt, updatedAt,
}
```

## Cardinality

- subject (note / folder) → object (folder):一对一 (一个 note / folder 只能在一个父
  folder 内)
- 根级 note / folder:没有 inFolder 边

## moveFolder 语义

`storage.transaction` 包"删旧 inFolder 边 + 加新 inFolder 边"原子操作,
保证树形结构一致性。

> 事务原子性已恢复 (sub-phase 3a-tx 完成,[decision 020](../../../docs/RefactorV2/data-model/persistence/decisions/020-sub-phase-3a-tx-true-atomicity.md)):
> SDK 2.x `beginTransaction()` 原生路径,任一步失败整段回滚。

## deleteFolder Path Y 语义 (decision 012 设计师批复)

**业务契约变更** (对齐 macOS Finder):

- V1/V2 现状: 删 folder = 删 folder + 子 folder; 笔记移到根级
- Path Y    : 删 folder = 删 folder + 子 folder + 内含资源 (整棵子树消失)

### Cascade scope 白名单(sub-phase 3a-1 反向扩展,2026-05-12)

`collectResourcesInFolders` 函数(原名 `collectNotesInFolders`,sub-phase 3a-1 重命名)
按白名单 cascade 内含资源:

```ts
// src/platform/main/folder/capability-impl.ts:201-220
const RESOURCE_DOMAINS = ['pm', 'graph-canvas'];   // 当前白名单
// 未来 sub-phase 3b ebook 接入时:加 'ebook'
```

| Sub-phase | 加入白名单 | 影响 |
|---|---|---|
| sub-phase 2 | `'pm'`(note)| 删 folder 同时删内含 note |
| sub-phase 3a-1 | `'graph-canvas'` | 删 folder 同时删内含画板(及其内含 instance + pm content)|
| sub-phase 3b(future)| `'ebook'`(预计)| 删 folder 同时删内含 ebook 资源 |

每个内容 domain 接入时,**显式约束**:
- 代码层在 `RESOURCE_DOMAINS` 数组加入
- 决议层在该 sub-phase 文档中显式登记

### 实施步骤

1. BFS 收集所有 descendants(含 self,通过 user:krig:inFolder 边逆向查)
2. 收集所有 inFolder 这些 folder 的资源(按 RESOURCE_DOMAINS 白名单过滤)
3. `storage.transaction` 包整段:逐个 deleteAtom(资源先 / folder 后),
   storage 应用层 cascade 自动删关联 edges(sub-phase 1 实施);
   **事务原子性已恢复**(sub-phase 3a-tx,decision 020 — 任一 deleteAtom 失败
   整棵子树全回滚,§7.5 故障注入 DF1-DF5 5 项 PASS)
4. 返 `{ deletedFolders, deletedResources, cascadedEdges }` 给 UI 记账
   (sub-phase 3a-1 反向更新 `deletedNotes → deletedResources` 字段名,
   类型扩展,语义不变)

广播触发**多条变更通知**(按白名单同步广播):
- `FOLDER_LIST_CHANGED`(总是)
- `NOTE_LIST_CHANGED`(当 cascade 删了 note 时)
- `GRAPH_LIST_CHANGED`(当 cascade 删了 graph-canvas 时,sub-phase 3a-1 加)
- 未来 sub-phase 3b 加 ebook 时同款扩展

⚠ **风险登记**: 误删 folder = 丢所有内含资源。配套保护(删除前弹窗 + 回收站)留
sub-phase 3+ 单独 decision(decision 012 §8 Q7 + decision 014 §8 Q7)。

### 跨 sub-phase 设计纪律

`deleteFolder` 是 KRIG 通用容器 Path Y cascade 的"枢纽点",**任何新内容 domain
接入时必须**:
1. 显式加入 `RESOURCE_DOMAINS` 白名单
2. 同步加 `<新 domain>_LIST_CHANGED` 广播触发
3. 在对应 sub-phase 决议文档登记扩展

→ 详 [decision 013 §0.5 设计师纪律 4](../../../docs/RefactorV2/data-model/persistence/decisions/013-sub-phase-3a-graph-canvas-migration.md)。

## 订阅机制

main → renderer 广播 `FOLDER_LIST_CHANGED`,renderer 端走 `useAllFolders` hook。
