# note capability

> v0.1 · 2026-05-12 · L7-sub2
>
> 配套:[../../../docs/RefactorV2/data-model/persistence/decisions/012-sub-phase-2-note-folder-migration.md](../../../docs/RefactorV2/data-model/persistence/decisions/012-sub-phase-2-note-folder-migration.md)

## 职责

把 main 进程的 noteCapability 持久化能力(CRUD + 列表广播)封装成 renderer 端 API。
noteCapability 内部走 storage (SurrealDB Sidecar,L7-sub1 实施)。

view 通过 `requireCapabilityApi<NoteCapabilityApi>('note')` 拿 api,不直触 storage
(W5 严格态 charter § 5.4)。

## 实现位置

| 层 | 路径 | 备注 |
|---|---|---|
| Renderer 入口 | `src/capabilities/note/index.ts` | IPC 调用封装 + capabilityRegistry 注册 |
| 类型 | `src/capabilities/note/types.ts` | NoteCapabilityApi + NoteInfo + NoteDocEnvelope |
| Renderer 启动迁移 | `src/capabilities/note/migration.ts` | 清 V1 legacy localStorage 键(idempotent) |
| Main 实现 | `src/platform/main/note/capability-impl.ts` | create/list/get/update/move/delete 7 API |
| Main 工具 | `src/platform/main/note/derive-title.ts` | 从裸 PmPayload 派生 title (10 行自包含) |
| Main 工具 | `src/platform/main/note/envelope.ts` | DriverSerialized ↔ 裸 PmPayload wrap/unwrap (路径 Y) |
| Main 广播 | `src/platform/main/note/broadcast.ts` | broadcastNoteListChanged (跨模块复用) |
| IPC handlers | `src/platform/main/note/handlers.ts` | 6 ipcMain.handle (业务 IPC + 广播) |
| IPC channel | `src/shared/ipc/channel-names.ts` 加 NOTE_* 7 条 | |
| preload | `src/platform/main/preload/main-window-preload.ts` 末尾追加 | noteCreate / List / Get / Update / Move / Delete + onNoteListChanged |
| electron-api 类型 | `src/shared/ipc/electron-api.d.ts` 末尾追加 | |

## 数据模型

```ts
// atom 形态 (decision 012 §3.2 路径 Y):
{
  payload: {
    domain: 'pm',
    payload: <PM doc root>,   // 裸 PmPayload (信封压缩到 capability 内部)
  }
}

// view ↔ capability 边界 (NoteInfo):
{
  id: ULID,
  title: <派生自 doc.content[0]>,
  doc: NoteDocEnvelope { format:'pm-doc-json', version:'0.1', payload: <PM doc> },
  folderId: <派生自 user:krig:inFolder 边>,
  createdAt, updatedAt,
}
```

## 边界纪律

- view ↔ capability:NoteInfo.doc = DriverSerialized 信封
- capability 内部 ↔ storage:裸 PmPayload (envelope.ts wrap/unwrap)
- title 派生自 doc.content[0] 首段文本,不存 atom payload
- folderId 派生自 user:krig:inFolder 边,不存 atom payload

## 订阅机制

main → renderer 广播 `NOTE_LIST_CHANGED`,renderer 端走 `useAllNotes` hook
(views/note/use-notes-folders.ts):

```ts
const notes = useAllNotes();  // 首次 [] → IPC fetch → setState;后续 onListChanged 增量推
```

## sync 缓存(给 driver resolveNoteTitle 守约)

driver 的 LinkClickHandler.resolveNoteTitle 是 sync API (PM transaction commit
路径不能 await)。view 层私有缓存 `src/views/note/note-cache.ts` 启动后由 onListChanged
增量更新,resolveNoteTitle 走 `getNoteTitle(id)` 同步查 (设计师批复 L2)。

## V1 legacy 清理

启动时 `migration.ts` 清掉 V1 兼容键 `krig.notes` / `krig.folders` (decision 012 §3.6
用户拍板选项 M:V2 测试数据可丢),idempotent + 静默 no-op 兼容。
