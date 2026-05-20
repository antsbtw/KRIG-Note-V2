# #4 双 Channel 方案 — 实施 Checklist

> 2026-05-20。基于 [noteview-sync-architecture-decision.md](noteview-sync-architecture-decision.md) §3.3 选定方案,吸收用户审计 2 个补充:
> 1. **DOC_CONTENT_CHANGED 由 note capability hook 消费**(不污染 driver)
> 2. **payload 带 origin + updatedAt**(便于诊断与策略化)
>
> 落地顺序:本 PR 只做 #4(双 channel);**角度 C(Host ref-based)留 followup**,稳定后再做。
>
> 关联:[cursor-jump-rootcause.md](cursor-jump-rootcause.md) 根因 / [host-ref-based-checklist.md](host-ref-based-checklist.md) C 路线(暂搁) / [noteview-sync-architecture-decision.md](noteview-sync-architecture-decision.md) 方案对比。

---

## 0. 关键事实(grep 验证)

### channel 命名规范
[src/shared/ipc/channel-names.ts:8](../../src/shared/ipc/channel-names.ts#L8) 规定 `<层>.<动作>`,如 `note.list-changed`、`graph.list-changed`、`ebook.bookshelf-changed`。

### 现有 broadcast 入口
[src/platform/main/note/broadcast.ts:16](../../src/platform/main/note/broadcast.ts#L16) `broadcastNoteListChanged()` 只发 `NOTE_LIST_CHANGED`,payload 是**整个 list**。

### updateNote 真实调用方(2 类)
1. **renderer IPC**:[src/platform/main/note/handlers.ts:53](../../src/platform/main/note/handlers.ts#L53) `NOTE_UPDATE` handler 有 `IpcMainInvokeEvent.sender.id`
2. **main 内直接调**:[src/platform/main/ebook/capability-impl.ts:694, 723](../../src/platform/main/ebook/capability-impl.ts#L694) `addReadingThoughtBlock` / `removeReadingThoughtBlock` 无 sender

### ⚠️ Latent bug 顺手暴露
**`addReadingThoughtBlock` / `removeReadingThoughtBlock` 写完 `updateNote` 后没调任何 broadcast** — 也就是说,**当前 P1#1 场景(ebook 标注实时反映到打开的 NoteView)根本不工作**。本 PR 同步修复此 latent bug:ebook 写完调新 channel 广播。

### preload 风格
[src/platform/main/preload/main-window-preload.ts:385](../../src/platform/main/preload/main-window-preload.ts#L385) `onNoteListChanged(callback): () => void` 模式 — 新加 `onNoteDocContentChanged` 沿用。

### note capability API 风格
[src/capabilities/note/types.ts:25](../../src/capabilities/note/types.ts#L25) `onListChanged(callback): () => void` — 新加 `onDocContentChanged` 同款。

---

## 1. 设计契约

### 1.1 新 channel

```ts
// channel-names.ts(在 NOTE_LIST_CHANGED 之后加一行)
NOTE_DOC_CONTENT_CHANGED: 'note.doc-content-changed',  // main → renderer 推送(doc 内容)
```

### 1.2 Payload 类型

新增 [src/shared/ipc/note-folder-types.ts](../../src/shared/ipc/note-folder-types.ts):

```ts
/**
 * NOTE_DOC_CONTENT_CHANGED origin 常量
 *
 * 用常量而非字符串 union — 避免散落字面值拼写漂移(eg 'ebook-reading-thoughts' / 'ebook_reading_thought');
 * 任何调用方写 broadcast 时引用此常量,IDE 自动补全 + grep 可查所有使用点。
 */
export const NOTE_DOC_ORIGIN = {
  /** renderer 通过 NOTE_UPDATE IPC 进来的用户编辑 */
  NOTE_EDITOR: 'note-editor',
  /** ebook capability addReadingThoughtBlock / removeReadingThoughtBlock 触发 */
  EBOOK_READING_THOUGHT: 'ebook-reading-thought',
  /** extraction-import 路径创建/更新(本 PR 暂不接入,留 followup) */
  EXTRACTION_IMPORT: 'extraction-import',
  /** 启动时 migration 修正 doc(留 followup) */
  MIGRATION: 'migration',
} as const;

export type NoteDocOrigin = typeof NOTE_DOC_ORIGIN[keyof typeof NOTE_DOC_ORIGIN];

/**
 * NOTE_DOC_CONTENT_CHANGED payload — 单个 note 的 doc 变化推送
 *
 * 跟 NOTE_LIST_CHANGED 的区别:
 * - NOTE_LIST_CHANGED:整个 list 元数据(title / folderId / updatedAt 等),所有订阅者收
 * - NOTE_DOC_CONTENT_CHANGED:单个 noteId+doc payload,发起 renderer **不收**(防 echo 回灌)
 *
 * 设计:
 * - emitterId:有时表示"NOTE_UPDATE 经 IPC handler 进来的发起 renderer",main 内部直接
 *   调 updateNote(ebook capability 等)时 undefined
 * - main broadcast 时根据 emitterId 排除该 renderer
 */
export interface NoteDocContentChangedPayload {
  noteId: string;
  doc: NoteDocEnvelope;
  origin: NoteDocOrigin;
  updatedAt: number;
  /** 仅 origin=NOTE_EDITOR 时有 — 发起更新的 renderer webContents.id */
  emitterId?: number;
}
```

**写 broadcast 时统一引用常量**(不写字面值):

```ts
import { NOTE_DOC_ORIGIN } from '@shared/ipc/note-folder-types';

// note handlers.ts:
await broadcastNoteDocContentChanged({
  ...,
  origin: NOTE_DOC_ORIGIN.NOTE_EDITOR,  // 不写 'note-editor'
  emitterId: e.sender.id,
});

// ebook capability-impl.ts:
await broadcastNoteDocContentChanged({
  ...,
  origin: NOTE_DOC_ORIGIN.EBOOK_READING_THOUGHT,  // 不写 'ebook-reading-thought'
});
```

### 1.3 noteCapability 新 API

```ts
// src/capabilities/note/types.ts NoteCapabilityApi 加:
onDocContentChanged(
  callback: (payload: NoteDocContentChangedPayload) => void,
): () => void;
```

### 1.4 view 层消费 hook

**新文件** `src/views/note/use-active-note-doc-sync.ts`:

```ts
/**
 * useActiveNoteDocSync — NoteView 订阅同 noteId 的外部更新
 *
 * 职责单一:把 NOTE_DOC_CONTENT_CHANGED 广播翻译成"对当前打开的 note 调 swapDoc"。
 *
 * 设计:
 * - 只关心当前 activeNoteId 的更新;其他 note 的广播忽略
 * - 不直接订阅 IPC,通过 noteCapability hook 间接路由(W5 严格态)
 * - origin='note-editor' + emitterId=本 renderer 的广播在 main 侧已被排除,本 hook 无需再过滤
 */
import { useEffect } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { NoteCapabilityApi } from '@capabilities/note/types';
import type { NoteDocEnvelope, NoteDocOrigin } from '@shared/ipc/note-folder-types';

export function useActiveNoteDocSync(
  activeNoteId: string | null,
  onExternalChange: (doc: NoteDocEnvelope, origin: NoteDocOrigin) => void,
): void {
  useEffect(() => {
    if (!activeNoteId) return;
    const note = requireCapabilityApi<NoteCapabilityApi>('note');
    return note.onDocContentChanged((payload) => {
      if (payload.noteId !== activeNoteId) return;
      onExternalChange(payload.doc, payload.origin);
    });
  }, [activeNoteId, onExternalChange]);
}
```

### 1.5 NoteView 接入方式(不动 Host)

NoteView 当前 [src/views/note/NoteView.tsx:113](../../src/views/note/NoteView.tsx#L113) 仍然 `<Host doc={activeNote.doc}>`(受控同步)。

本 PR **不改 Host**,改的是 **`activeNote.doc` 怎么变**:
- 用户自己编辑:走 onChange → updateNote → DB → 广播 → 发起 renderer 不收 → activeNote.doc 不变 → Host 不触发 useEffect → 不跳
- 外部更新(ebook):走广播 → 本 renderer 收到 → 触发 noteCap.getNote 或者直接用 payload.doc → setState activeNote.doc → Host useEffect[doc] → swapDoc(其实是 replaceWith,sel atStart)

**等等** — Host 现在仍然 useEffect[doc] → applyExternalDoc → replaceWith,光标跳问题还是会发生在"外部更新"路径。**这里有个设计选择**:

#### 选择 A:不动 Host,把 jump 风险锁定在"外部更新"窄路径
- 用户自己编辑路径(高频)完全切断:发起 renderer 不收到 echo,activeNote.doc 引用不变
- 外部更新路径(低频)仍走 useEffect[doc] → replaceWith,但 selection 会跳
- 优点:本 PR 改动面最小,**修主要 bug**
- 缺点:外部更新发生时光标仍跳 — 1a 场景体验差

#### 选择 B:Host 加最小防御 — 收到外部更新 doc 时显式做 swapDoc 语义
- Host 仍接 doc prop,但 useEffect 内部:**仅当 view.state.doc.eq(newDoc) 为 false 时**才 replaceWith,且 selection 一律 atStart
- 优点:不引入 ref API,改动小;外部更新光标重置到 atStart(可接受,反正不是用户主动操作的)
- 缺点:本质上还是受控同步,留着 useEffect[doc] 这条隐患路径

#### 选择 C:本 PR 同步带角度 C(Host ref-based)
- 完整重构,改动最大
- 优点:架构最干净,后续不需要再做一次
- 缺点:本 PR 行数从 ~100 增至 ~200,风险面增大

**推荐选择 B**:本 PR 主目标是修跳末尾 + P1#1 外部更新,Host 改成"selection atStart"已经足够,不引入 ref。C 留 followup 提升架构。

---

## 2. 文件改动清单(按依赖顺序)

### 2.1 IPC 协议层

#### `src/shared/ipc/channel-names.ts`
```diff
   NOTE_LIST_CHANGED: 'note.list-changed',           // main → renderer 推送
+  NOTE_DOC_CONTENT_CHANGED: 'note.doc-content-changed',  // main → renderer 推送(单 note doc 变化,发起者除外)
```

#### `src/shared/ipc/note-folder-types.ts`
```diff
 export interface NoteInfo { ... }
+
+export interface NoteDocContentChangedPayload {
+  noteId: string;
+  doc: NoteDocEnvelope;
+  origin: 'note-editor' | 'ebook-reading-thought' | 'extraction-import' | 'migration';
+  updatedAt: number;
+  emitterId?: number;
+}
```

### 2.2 Main 层

#### `src/platform/main/note/broadcast.ts`(改)
新增 `broadcastNoteDocContentChanged` 函数。**原 `broadcastNoteListChanged` 不动**(NavSide / TOC 等仍依赖)。

```diff
+import type { NoteDocContentChangedPayload } from '@shared/ipc/note-folder-types';

 export async function broadcastNoteListChanged(): Promise<void> {
   // 不变
 }

+/**
+ * broadcastNoteDocContentChanged — 单 note doc 变化推送
+ *
+ * 与 broadcastNoteListChanged 的区别:
+ * - 只携 noteId+doc,不整 list 派发,带宽更小
+ * - emitterId 用于排除发起 renderer(防 echo 触发 NoteView Host 回灌跳光标)
+ * - origin 用于诊断 + view 层策略化(目前 NoteView 不区分,但保留扩展)
+ *
+ * 调用方:
+ * - note handlers NOTE_UPDATE(emitterId=event.sender.id, origin='note-editor')
+ * - ebook capability addReadingThoughtBlock / removeReadingThoughtBlock(emitterId 不传, origin='ebook-reading-thought')
+ */
+export async function broadcastNoteDocContentChanged(
+  payload: NoteDocContentChangedPayload,
+): Promise<void> {
+  try {
+    for (const win of BrowserWindow.getAllWindows()) {
+      if (win.isDestroyed()) continue;
+      // 排除发起 renderer(防 NoteView Host useEffect[doc] echo 回灌)
+      if (payload.emitterId != null && win.webContents.id === payload.emitterId) continue;
+      win.webContents.send(IPC_CHANNELS.NOTE_DOC_CONTENT_CHANGED, payload);
+    }
+  } catch (err) {
+    console.warn('[note] broadcast doc-content-changed failed:', err);
+  }
+}
```

#### `src/platform/main/note/handlers.ts`(改 NOTE_UPDATE handler)
```diff
-import { broadcastNoteListChanged } from './broadcast';
+import { broadcastNoteListChanged, broadcastNoteDocContentChanged } from './broadcast';
+import { NOTE_DOC_ORIGIN } from '@shared/ipc/note-folder-types';

-  ipcMain.handle(IPC_CHANNELS.NOTE_UPDATE, async (_e, payload: unknown) => {
+  ipcMain.handle(IPC_CHANNELS.NOTE_UPDATE, async (e, payload: unknown) => {
     const p = payload as { id?: unknown; doc?: unknown } | null;
     if (!p || typeof p.id !== 'string' || !p.id) return null;
     if (!isDocEnvelope(p.doc)) return null;
     const note = await updateNote(p.id, p.doc);
+    if (note) {
+      // 新 channel:发起者(e.sender.id)不收;NavSide/TOC 等仍走老 channel
+      await broadcastNoteDocContentChanged({
+        noteId: note.id,
+        doc: note.doc,
+        origin: NOTE_DOC_ORIGIN.NOTE_EDITOR,
+        updatedAt: note.updatedAt,
+        emitterId: e.sender.id,
+      });
+    }
     await broadcastNoteListChanged();
     return note;
   });
```

注:**两个 broadcast 都发**。新 channel 喂 Host 类订阅者,老 channel 喂 NavSide/TOC/note-link 等列表订阅者。发的顺序:**先 DOC_CONTENT_CHANGED,后 LIST_CHANGED**(语义上 doc 先变 metadata 派生才变)。

#### `src/platform/main/ebook/capability-impl.ts`(顺手修 latent bug)
[line 694 / 723](../../src/platform/main/ebook/capability-impl.ts#L694) 两处 `updateNote` 后**当前完全没广播**,导致 P1#1 一直不工作。本 PR 修:

```diff
-import { updateNote, wrapPmDoc, unwrapPmDoc, emptyNoteDoc } from '@platform/main/note';
+import { updateNote, wrapPmDoc, unwrapPmDoc, emptyNoteDoc } from '@platform/main/note';
+import { broadcastNoteDocContentChanged, broadcastNoteListChanged } from '@platform/main/note/broadcast';
+import { NOTE_DOC_ORIGIN } from '@shared/ipc/note-folder-types';

 // addReadingThoughtBlock 末尾:
   await updateNote(thought.id, wrapPmDoc(updatedDoc));
+  // 顺手修 latent bug:ebook 写 thought doc 后必须广播,否则同进程内打开的
+  // NoteView 看不到外部更新(P1#1 场景实际从未工作)
+  const updated = await getReadingThought(bookId);  // 拿最新 NoteInfo 取 updatedAt
+  if (updated) {
+    await broadcastNoteDocContentChanged({
+      noteId: updated.id,
+      doc: updated.doc,
+      origin: NOTE_DOC_ORIGIN.EBOOK_READING_THOUGHT,
+      updatedAt: updated.updatedAt,
+      // emitterId 不传 — main 内部触发,所有 renderer 都该收到
+    });
+    await broadcastNoteListChanged();
+  }

 // removeReadingThoughtBlock 末尾同样补
```

**TODO 检查**:看 `getReadingThought` 返 NoteInfo 信封还是 raw — 我前面读过 [capability-impl.ts:549](../../src/platform/main/ebook/capability-impl.ts#L549) 说返 NoteInfo 信封,匹配。

#### `src/platform/main/preload/main-window-preload.ts`(改 +5 行)
```diff
+import type { NoteDocContentChangedPayload } from '@shared/ipc/note-folder-types';

   /** main → renderer 推送:笔记列表变更(create / update / move / delete 后广播)*/
   onNoteListChanged(callback: (list: unknown) => void): () => void {
     ...
   },
+  /**
+   * main → renderer 推送:单 note doc 内容变更(NOTE_UPDATE 发起者不收;ebook 外部更新所有 renderer 都收)
+   * 区别于 onNoteListChanged:粒度更细 + 发起者排除
+   */
+  onNoteDocContentChanged(
+    callback: (payload: NoteDocContentChangedPayload) => void,
+  ): () => void {
+    const handler = (_event: unknown, payload: NoteDocContentChangedPayload): void => callback(payload);
+    ipcRenderer.on(IPC_CHANNELS.NOTE_DOC_CONTENT_CHANGED, handler);
+    return () => ipcRenderer.off(IPC_CHANNELS.NOTE_DOC_CONTENT_CHANGED, handler);
+  },
```

也要在 preload 的 TS 类型声明里加(若有):

```diff
// src/platform/main/preload/electron-api.d.ts(或类似)
+  onNoteDocContentChanged(
+    callback: (payload: NoteDocContentChangedPayload) => void,
+  ): () => void;
```

### 2.3 capability 层

#### `src/capabilities/note/types.ts`
```diff
+import type { NoteDocContentChangedPayload } from '@shared/ipc/note-folder-types';

 export interface NoteCapabilityApi {
   ...
   onListChanged(callback: (list: NoteInfo[]) => void): () => void;
+  /** 订阅单 note doc 变化 (W5 严格态:view 层 hook 走此 API,不直接订阅 IPC) */
+  onDocContentChanged(
+    callback: (payload: NoteDocContentChangedPayload) => void,
+  ): () => void;
 }
```

#### `src/capabilities/note/index.ts`
```diff
+function onDocContentChanged(
+  callback: (payload: NoteDocContentChangedPayload) => void,
+): () => void {
+  return window.electronAPI.onNoteDocContentChanged(callback);
+}

 export const noteCapability: NoteCapabilityApi = {
   createNote,
   listNotes,
   getNote,
   updateNote,
   moveNote,
   deleteNote,
   onListChanged,
+  onDocContentChanged,
 };
```

### 2.4 view 层

#### `src/views/note/use-active-note-doc-sync.ts`(新文件)

字面见 §1.4。

#### `src/views/note/NoteView.tsx`(改)
**选择 B**:Host 不改 ref-based,但 NoteView 通过 hook 订阅 doc-content-changed,**用 hook 本地 setState 一个 `incomingDoc`**,优先用它覆盖 `activeNote.doc` 喂给 Host:

```diff
+import { useActiveNoteDocSync } from './use-active-note-doc-sync';

 export function NoteView({ workspaceId }: NoteViewProps) {
   ...
+  // 本 renderer 自家编辑路径:走 onChange → updateNote → 发起者不收广播 → activeNote.doc 引用不变
+  // 外部更新路径(ebook 写 thought 等):走 onDocContentChanged → 显式 setState incomingDocRef
+  const [incomingDoc, setIncomingDoc] = useState<NoteDocEnvelope | null>(null);
+  useActiveNoteDocSync(activeNoteId, useCallback((doc, origin) => {
+    console.debug('[NoteView] external doc update', { origin });
+    setIncomingDoc(doc);
+  }, []));
+
+  // 优先 incomingDoc(外部更新);若 activeNoteId 切换则清空 incomingDoc,回退用 activeNote.doc
+  useEffect(() => {
+    setIncomingDoc(null);
+  }, [activeNoteId]);
+
+  const docToShow = incomingDoc ?? activeNote?.doc;
   ...
       <Host
         config={...}
-        doc={activeNote.doc}
+        doc={docToShow}
         onChange={handleDocChange}
       />
```

#### `src/drivers/text-editing-driver/Host.tsx`(改 — 选择 B 的微调)

仅改一处 `applyExternalDoc`:**replaceWith 时强制 setSelection atStart**,而不是依赖 PM 默认 mapping 把光标推末尾:

```diff
+import { Selection } from 'prosemirror-state';

   const applyExternalDoc = (nextDoc: DriverSerialized): boolean => {
     ...
     if (view.state.doc.eq(newDoc)) return true;
     const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, newDoc.content);
+    tr.setSelection(Selection.atStart(tr.doc));
     tr.setMeta('addToHistory', false);
     view.dispatch(tr);
     return true;
   };
```

**删除 200ms 时间窗 + 指纹机制(⚠️ 分两阶段,gated)**

> **不能跟双 channel 改动一并提交**。理由:删除旧守护属于"撤掉安全网",必须**先证明上游 echo 切断在所有路径上都生效**,才能拆。证明手段是 §3.1 + §3.2 测试 PASS,不是"理论推导上游切断了"。
>
> 见 [[strict-compliance-workflow]] §"移除安全网前必须证明安全网已无效"原则。

#### 阶段 1(本 PR 含):双 channel 上线,**旧守护保留**
- 不动 `lastEmittedJsonRef` / `lastEmitTsRef` / 200ms 时间窗判断
- 双 channel + ebook latent bug 修 + NoteView incomingDoc 都做
- 跑 §3 全部测试,**特别 §3.1 (跳末尾) + §3.2 (外部更新) 必须全 PASS**
- 此时 Host 既有双 channel 切 echo,又有 200ms 兜底 — 安全冗余

#### 阶段 2(独立 followup PR,条件触发):删旧守护
- **触发条件**:阶段 1 合 main 后**至少 7 天**生产观察期,无 cursor-jump 报警
- 删除 `lastEmittedJsonRef` / `lastEmitTsRef` 及相关代码:

```diff

```diff
-  const lastEmittedJsonRef = useRef<string | null>(null);
-  const lastEmitTsRef = useRef<number>(0);

   // onTransaction emit 时:
   if (tr.docChanged) {
     const serialized = serializeDoc(v.state.doc);
     if (v.composing) {
       pendingComposingDocRef.current = serialized;
     } else {
-      lastEmittedJsonRef.current = JSON.stringify(serialized.payload);
-      lastEmitTsRef.current = Date.now();
       onChangeRef.current?.(serialized);
     }
   }
   // compositionend 同样删两行

   const applyExternalDoc = (nextDoc: DriverSerialized): boolean => {
     ...
-    const incomingJson = JSON.stringify(nextDoc.payload);
-    if (incomingJson === lastEmittedJsonRef.current) return true;
-    if (Date.now() - lastEmitTsRef.current < 200) return true;
     ...
   };
```

并清掉那段 100 行长 comment([Host.tsx:106-119](../../src/drivers/text-editing-driver/Host.tsx#L106))。

#### 阶段 2 回滚 gate
如果删旧守护后**任何**跳末尾报警重现:
1. 立刻 revert 阶段 2 commit(恢复旧守护)
2. 排查双 channel 漏路径(grep 所有 `updateNote` 调用 / 检查是否有路径未广播)
3. 补完路径后再试一次阶段 2

**本 PR 范围结论**:**仅阶段 1**。Host.tsx 唯一改动是加 `Selection.atStart`(替代 PM 默认末尾 fallback),旧守护一行不动。

---

## 3. 测试清单(全 PASS 才合 main)

### 3.1 跳末尾 bug(主目标)
- [ ] 长 note(>1万字)连续输入 50 字符,光标不跳末尾
- [ ] 连续按 Enter / Backspace / Delete 各 20 次,光标不跳末尾
- [ ] 中文 IME 拼音连续 20 字,无字符丢失/光标跳
- [ ] 同时右槽打开 Thought,左槽编辑稳定

### 3.2 外部更新(P1#1 — 新功能)⭐
- [ ] **打开 NoteView 显示某 thought 关联的 note**
- [ ] **切回 ebook 加 highlight**(走 `addReadingThoughtBlock`)
- [ ] **NoteView 自动刷新显示新增标注 block**,光标重置 atStart 可接受
- [ ] DevTools console 看到 `[NoteView] external doc update { origin: 'ebook-reading-thought' }`
- [ ] 反向:在 ebook 删除 highlight,NoteView 也自动刷新

### 3.3 老 NOTE_LIST_CHANGED 仍 work
- [ ] 用户改 note 首段(改 title)→ NavSide 列表上的 title 立即更新
- [ ] 用户新建 note → NavSide 列表立即看到新 note
- [ ] 删除 note → NavSide 列表立即移除
- [ ] note-link search panel 列表能搜到最新 title

### 3.4 切笔记
- [ ] note A → B,B 内容完整加载(含 image/math/table/callout 等)
- [ ] A → B → A,A 重新打开内容完整
- [ ] 点 note-link 跳转目标正常
- [ ] **打开 note A → NavSide 删除 note A → NoteView 显示"笔记加载中或已删除"兜底**(不显示旧 A 内容)
- [ ] 点 note-link 跳转到不存在的 noteId → NoteView 兜底态(不闪现旧内容)

### 3.5 既有功能不回归
- [ ] cmd+Z 不跳末尾(已修)
- [ ] 媒体 NodeView 上传完成不跳末尾(已修)
- [ ] TOC / floating toolbar / slash menu / handle menu 等正常
- [ ] vocab highlight / thought anchor decoration 正常
- [ ] ThoughtCardEditor 编辑正常(不受本 PR 影响)
- [ ] canvas-text-node overlay 编辑正常(不受本 PR 影响)

---

## 4. 验证命令

```bash
# 1. TS 检查
npx tsc --noEmit

# 2. 验证 channel 常量(预期返回 NOTE_DOC_CONTENT_CHANGED 一行)
grep -n 'NOTE_DOC_CONTENT_CHANGED' src/shared/ipc/channel-names.ts

# 3. 验证两个 broadcast 都调用(预期 NOTE_UPDATE 处两个 broadcast 都在)
grep -A3 "NOTE_UPDATE.*async" src/platform/main/note/handlers.ts | grep broadcast

# 4. 验证 ebook latent bug 修了(预期返回 broadcastNoteDocContentChanged + broadcastNoteListChanged)
grep -n 'broadcast' src/platform/main/ebook/capability-impl.ts

# 5. 验证 NoteView 接了 hook(预期返回 useActiveNoteDocSync 一行)
grep -n 'useActiveNoteDocSync' src/views/note/NoteView.tsx

# 6. 启动 dev 跑 §3 测试清单
npm start
```

---

## 5. 风险点 + 应对

| 风险 | 概率 | 应对 |
|---|---|---|
| broadcast 时序:DOC_CONTENT_CHANGED 比 LIST_CHANGED 晚到致 NavSide title 派生与 doc 不一致 | 低 | 两 broadcast 都用 `await` 串行,顺序 DOC → LIST;且 title 派生很快,不一致窗口 <10ms |
| emitterId === undefined 时所有 renderer 收到 → 多 renderer 场景一起 swapDoc 致 selection atStart | 中 | 用户当前打开 NoteView 的窗口被刷,光标回 atStart;反直觉但属"外部更新可接受副作用"(选择 B 的折衷) |
| ebook 加 broadcast 后,**老的 NOTE_LIST_CHANGED 也同时发** → 同 renderer 内 useAllNotes 重渲 → activeNote.doc 引用变 → Host useEffect[doc] 触发 → 走 replaceWith → 此时 incomingDoc 已经 setState 了,docToShow=incomingDoc,但 activeNote.doc 也已经是新引用了 → useEffect 仍触发 replaceWith | **高** | 选择 B 的关键风险:需要在 NoteView **避免 activeNote.doc 喂给 Host**,只用 incomingDoc。**见下方"§5.1 关键决策点"** |
| extraction-import 路径未发 DOC_CONTENT_CHANGED → 新建 note 不影响打开的 NoteView | 0 | 新建 note 不属于本 PR 修复目标,extraction-import 走 NOTE_CREATE 路径,自然走 LIST_CHANGED |
| ThoughtCardEditor 使用同一个 note 表 — ebook 写 thought 也会触发 ThoughtView 刷新吗? | 中 | 本 PR 不动 ThoughtCardEditor;若它也需要外部更新刷新,沿用 useActiveNoteDocSync 模式 followup |

### 5.1 关键决策点:NoteView 何时用 incomingDoc 何时用 activeNote.doc

**问题**:NoteView 同时订阅了:
- `useAllNotes` (老 LIST_CHANGED) → `activeNote.doc` 引用变
- `useActiveNoteDocSync` (新 DOC_CONTENT_CHANGED) → `incomingDoc` setState

两条都会让 NoteView 重渲。Host 现在仍接 doc prop,**喂哪个**?

**严格逻辑**:
- 用户自己编辑:DOC_CONTENT_CHANGED 在 main 排除了发起者 → `incomingDoc` 不变 → 但 LIST_CHANGED 仍来 → `activeNote.doc` 引用变 → 若喂 activeNote.doc → useEffect 触发 → 跳!
- 外部更新:DOC_CONTENT_CHANGED 触发 → `incomingDoc` setState → 想要这个

**解法**:NoteView **永远只喂 incomingDoc**,即:
- 切笔记时:用 `getNote(activeNoteId)` 拉一次 doc,setState 到 `incomingDoc`(初始)
- 自家编辑:onChange 只触发 IPC,不动 incomingDoc(Host 内部 PM state 已是最新)
- 外部更新:DOC_CONTENT_CHANGED → setIncomingDoc

具体:

```ts
const [incomingDoc, setIncomingDoc] = useState<NoteDocEnvelope | null>(null);

// 切笔记:拉初始 doc
// **note 不存在(已被删/找不到)语义**:
//   - getNote 返 null → setIncomingDoc(null) 显式清空,UI 回 "未选择笔记" 态
//   - 不能保留旧 doc,否则 NavSide 删了 note 但 NoteView 仍显示旧内容,用户错觉"删除没生效"
useEffect(() => {
  if (!activeNoteId) {
    setIncomingDoc(null);
    return;
  }
  let cancelled = false;
  const note = requireCapabilityApi<NoteCapabilityApi>('note');
  void note.getNote(activeNoteId).then((info) => {
    if (cancelled) return;
    // 显式区分 info=null(已删除)vs info=NoteInfo(成功):任何情况都覆盖 incomingDoc
    setIncomingDoc(info ? info.doc : null);
  });
  return () => { cancelled = true; };
}, [activeNoteId]);

// 外部更新:广播触发
useActiveNoteDocSync(activeNoteId, useCallback((doc) => {
  setIncomingDoc(doc);
}, []));

// NoteView 不再从 useAllNotes 取 activeNote.doc — 但 NavSide title 等仍走 useAllNotes
// 即 NoteView 只读 list 的 title/folderId metadata,doc 走独立 incomingDoc 通道

// 渲染时区分三态:
//   - incomingDoc=null + activeNoteId=null    → 未选择笔记
//   - incomingDoc=null + activeNoteId 有值   → 正在加载 / note 已被删
//   - incomingDoc 有值                       → 正常渲染 Host
if (!activeNoteId) return <empty>未选择笔记</empty>;
if (!incomingDoc) return <empty>笔记加载中或已删除</empty>;

<Host doc={incomingDoc} onChange={...} />
```

**额外考虑:active note 被外部删除时**

useAllNotes 收到 LIST_CHANGED → allNotes 不含 activeNoteId 的 note → 但 `activeNoteId` 本身由 workspaceManager 管,不会自动清空。两种处理:

- **方案 a**(推荐): NoteView useEffect 监听 allNotes,若 `allNotes.find(n => n.id === activeNoteId) === undefined` 且非加载中,显式调 workspaceManager 清空 activeNoteId
- **方案 b**: 仅 UI 层显示 "笔记已删除" 兜底,不动 activeNoteId — 用户手动切走

本 PR 选 **方案 b**(改动小,容错够) — 不主动改 workspaceManager 状态,留 followup。

```ts
// allNotes 变化:若 activeNote 被外部删除,清空 incomingDoc
useEffect(() => {
  if (!activeNoteId || !incomingDoc) return;
  const stillExists = allNotes.some((n) => n.id === activeNoteId);
  if (!stillExists) setIncomingDoc(null);
}, [allNotes, activeNoteId]);
```

**这意味着 NoteView 的 `activeNote` 从 useAllNotes 取的字段只用 `title` 等 metadata,`doc` 字段完全靠 incomingDoc**。两条订阅各管各的,语义清晰。

修改后:

```diff
   const allNotes = useAllNotes();
-  const activeNote = activeNoteId ? allNotes.find((n) => n.id === activeNoteId) ?? null : null;
+  const activeNoteMeta = activeNoteId ? allNotes.find((n) => n.id === activeNoteId) ?? null : null;
+  // doc 独立通道:不从 list 拿,避免 echo 回灌 → activeNote.doc 引用变 → Host useEffect 跳
+  const [incomingDoc, setIncomingDoc] = useState<NoteDocEnvelope | null>(null);
+  ...
```

并把后续用 `activeNote.doc` 的地方改为 `incomingDoc`,用 `activeNote.title` 的地方改为 `activeNoteMeta?.title`。

---

## 6. PR 拆分

**单 PR 一次过**:`refactor/note-doc-broadcast-dual-channel`

- IPC 层:2 文件(channel-names + types)
- main:3 文件(broadcast + handlers + ebook capability-impl)
- preload:1 文件
- capability:2 文件(types + index)
- view:2 文件(use-active-note-doc-sync 新建 + NoteView 改)
- driver:1 文件(Host 删指纹/时间窗 + atStart)
- 净改估计:**+170 / -90 行**

### 标题:`fix(note): 双 channel 修光标跳末尾 + 顺手修 ebook 外部更新不广播 latent bug`

### Commit 信息要点:
- 主目标:NOTE_DOC_CONTENT_CHANGED 排除发起者,根治"自家编辑 echo 回灌触发 Host useEffect" 跳末尾
- 顺手:ebook addReadingThoughtBlock / removeReadingThoughtBlock 加 broadcast(老 bug,P1#1 一直没工作)
- Host 加 Selection.atStart — 替代 PM 默认末尾 fallback
- 不动 Host props 受控同步(角度 C 留 followup)
- **保留 200ms 时间窗 + JSON 指纹兜底**(gated,留独立 followup PR 删除;见 §2.4 阶段 1/2 分割)

---

## 7. 实施顺序

1. **IPC 协议改**:channel-names.ts + types(§2.1)→ `npx tsc --noEmit` 应过
2. **main broadcast.ts** + handlers.ts(§2.2 前两个)→ TS 过
3. **ebook capability-impl.ts** 顺手修 latent bug(§2.2 第三个)→ TS 过
4. **preload**(§2.2 第四个)+ preload .d.ts → TS 过
5. **capability**(§2.3)→ TS 过
6. **view 新建 hook** + NoteView 改(§2.4)→ TS 过
7. **driver Host.tsx** 加 `Selection.atStart` 一行,**不动**旧守护(§2.4)→ TS 过
8. **跑 §4 grep 验证 + §3 全部测试** — 特别 §3.1 + §3.2 必须 PASS
9. **commit + merge**

阶段 2(独立 followup PR,7 天观察期后):
10. 删 lastEmittedJsonRef / lastEmitTsRef / 100 行长 comment
11. 跑 §3 测试,无回归 → commit
12. **若任何跳末尾重现 → 立刻 revert**

每步跑 `npx tsc --noEmit` 绿了才下一步。

---

## 8. Followup(本 PR 不做)

按优先级:

### 8.1 阶段 2:删 200ms 时间窗 + JSON 指纹兜底
- 见 §2.4 阶段 2 + §7 步骤 10-12
- 条件:阶段 1 合 main 后 ≥7 天无 cursor-jump 报警
- 改动:Host.tsx 删 4-5 行 ref + 2 条判断 + 100 行长 comment
- 风险:见 §2.4 阶段 2 回滚 gate

### 8.2 其他
- [ ] **角度 C(Host ref-based)** — 架构硬化,详见 [host-ref-based-checklist.md](host-ref-based-checklist.md);阶段 2 稳定后再做
- [ ] **ThoughtView 外部更新同步** — 同思路用 use-active-note-doc-sync(或类似 hook 沿 thought capability);本 PR 不动
- [ ] **migration / extraction-import origin 接入** — payload 类型已预留 NOTE_DOC_ORIGIN.MIGRATION / EXTRACTION_IMPORT,实际写广播留 followup
- [ ] **emitterId 未来扩展**:多窗口同 note 编辑场景的更细判断(目前 KRIG 单窗口)
- [ ] **active note 被删时显式清 activeNoteId**(§5.1 方案 a):本 PR 走方案 b(UI 兜底),需要时升级 workspaceManager 接入

---

*v1 撰写于 2026-05-20。基于用户审计:"先做 #4,C 留 followup" + "DOC_CONTENT_CHANGED 由 hook 消费" + "payload 带 origin"*
