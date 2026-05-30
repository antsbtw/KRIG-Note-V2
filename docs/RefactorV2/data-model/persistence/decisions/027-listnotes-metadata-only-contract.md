# Decision 027 — listNotes metadata-only 契约(冷启动性能)

> 2026-05-29 · fix/listnotes-cold-start-slow · 字面基于实测日志拍板

## 1. 背景

L7 block atomization(decision 026)后,单 note = 1 个 container atom + N 个 block
atom + 三类边(belongsToNote / childOf / nextSibling)。`assemblePmDoc(noteId)` 单篇
约 5 次 storage round-trip,实测平均 ~700ms / 篇(最大 note 993 block × 2.2s)。

`listNotes()` 旧实现对每篇 note 都 `assemblePmDoc` 拼全文 doc 再 `deriveTitle`。
冷启动期 NavSide / note-cache / NoteLinkSearch / NoteView 四个 caller 各发一次
`listNotes` IPC,4 × 92 篇串行 assemble、彼此几乎零 cache 复用 → **墙钟 66s 卡死**。

migration 023 引入的 `container.attrs.title` 缓存只优化了 `listNoteTitles()`,
NavSide 走的是 `listNotes()`,**完全绕过缓存** → title 缓存对冷启动无效。

实测铁证(`[DIAG-coldstart]` 日志):
- 修复前:`listNotes EXIT elapsedMs=66488 assembled=91`,`deriveTitle cacheHit=true ×370`
- 修复后:`listNoteMetadata EXIT cacheHit=92 fallbackAssemble=0 elapsedMs=218`(~300× 提速)

## 2. 契约

**`listNotes()` 返回的 `NoteInfo.doc` 字段为空 container payload(`{type:'doc',content:[]}`),
不含真正 block 内容。** 需要 doc 内容的调用方必须走 `getNote(id)` 单点 assemble。

这与 `createNotesBatch` 的 `NoteInfo.doc` 约定一致(见
`capabilities/note/types.ts` §CreateNoteBatchResult)。

实现:`listNotes` / `listNoteTitles` 共用内部 `listNoteMetadata()`:
- 读 `container.attrs.title` 缓存(O(1)),不 assemble
- 缺缓存(老数据 / migration 023 失败篇)→ 等 backfill,仍缺则 fallback assemble +
  deriveTitle(**不写回**),串行避免 SurrealDB ws 雪崩

## 3. 调用方影响

| 调用方 | 用到的字段 | 影响 |
|---|---|---|
| NavSide `useAllNotes` | id / title / folderId / updatedAt | ✅ 直接受益 |
| note-cache(link-click title) | id / title | ✅ |
| NoteLinkSearch `useNoteList` | id / title / folderId | ✅ |
| NoteView 订阅 | metadata | ✅ |
| extraction-import 去重 | title / folderId | ✅ |
| **tree-operations 粘贴** | **doc** | ⚠ 改走 `getNote(id)` 单点拉(用户操作,非冷启动,<1s) |

## 4. 不在本期范围(剩余债)

- NavSide 渲染 92+ 节点未虚拟化 → 本期 metadata-only 后渲染已快,若大库再立 PR
- 冷启动 4 个 caller 各发一次 `listNotes` IPC(各 ~210ms,彼此不复用)→ 可加
  main 端短 TTL 合并,但本期 metadata-only 后已无痛点,留观察
- migration 023 fallback assemble 仍存在(老数据缺缓存篇),正常路径不触发
