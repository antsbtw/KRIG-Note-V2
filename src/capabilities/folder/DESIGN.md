# folder capability

> v0.1 · 2026-05-12 · L7-sub2
>
> 配套:[../../../docs/RefactorV2/data-model/persistence/decisions/012-sub-phase-2-note-folder-migration.md](../../../docs/RefactorV2/data-model/persistence/decisions/012-sub-phase-2-note-folder-migration.md)

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

## deleteFolder Path Y 语义 (decision 012 设计师批复)

**业务契约变更** (对齐 macOS Finder):

- V1/V2 现状: 删 folder = 删 folder + 子 folder; 笔记移到根级
- Path Y    : 删 folder = 删 folder + 子 folder + 内含笔记 (整棵子树消失)

实施 (`capability-impl.ts deleteFolder`):
1. BFS 收集所有 descendants (含 self,通过 user:krig:inFolder 边逆向查)
2. 收集所有 inFolder 这些 folder 的 notes
3. `storage.transaction` 包整段:逐个 deleteAtom (note 先 / folder 后),
   storage 应用层 cascade 自动删关联 edges (sub-phase 1 实施)
4. 返 `{ deletedFolders, deletedNotes, cascadedEdges }` 给 UI 记账

广播触发两条变更通知:`FOLDER_LIST_CHANGED` + `NOTE_LIST_CHANGED`。

⚠ **风险登记**: 误删 folder = 丢笔记。配套保护 (删除前弹窗 + 回收站) 留
sub-phase 3+ 单独 decision (decision 012 §8 Q7)。

## 订阅机制

main → renderer 广播 `FOLDER_LIST_CHANGED`,renderer 端走 `useAllFolders` hook。
