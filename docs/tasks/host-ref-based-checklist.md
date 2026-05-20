# NoteView 光标跳末尾根治 — 角度 A + C 联合方案实施 Checklist

> v2(2026-05-20):基于用户审计反馈重写。
>
> 上一版仅做角度 C(Host ref-based),漏了"同 note 外部更新"路径(ebook capability 直接调 main updateNote 写 thought doc → NoteView 该收到刷新)。本版改为 **角度 A + C 联合**:
> - **角度 A(IPC 层)**:NOTE_UPDATE handler 让 broadcast 排除发起者 renderer,echo 在源头切断
> - **角度 C(view 层)**:Host 从受控 prop 改 ref-based 显式 swapDoc,架构级正确性保证
>
> 两条独立,任一独立都能修跳末尾。叠加做的理由:A 已修 echo 主干,C 让架构防御未来"漏排除"和"误传 sender"的回归 bug。
>
> 关联文档:[cursor-jump-rootcause.md](cursor-jump-rootcause.md) 问题分析。

---

## 0. 关键事实(grep 验证,2026-05-20)

### Host 使用者只有 3 个
- [src/views/note/NoteView.tsx:98-115](../../src/views/note/NoteView.tsx#L98-L115) — **唯一受 bug 影响的真实用户**
- [src/views/thought/ThoughtCardEditor.tsx:70-98](../../src/views/thought/ThoughtCardEditor.tsx#L70-L98) — `key={thought.id}` 父级 remount,无 prop 回灌问题
- [src/capabilities/canvas-text-node/edit-overlay.tsx:133-168](../../src/capabilities/canvas-text-node/edit-overlay.tsx#L133-L168) — 用 initialDoc state 只 setState 一次,本来就没 prop 回灌

### 同 note 外部更新真实路径(P1#1)
- ebook capability appendReadingThoughtBlock/removeReadingThoughtBlock 直接在 main 进程调 `updateNote(thought.id, ...)` ([src/platform/main/ebook/capability-impl.ts:694, 723](../../src/platform/main/ebook/capability-impl.ts#L694))
- thought 信封即 NoteInfo(同一张 note 表),所以 NoteView 打开同 thought 时会收到广播
- 角度 A 设计:此场景下**没有 sender renderer**(直接 main 内调用),`broadcastNoteListChanged(undefined)` 不会排除任何 renderer,所有 NoteView 都收到广播 → 自然 swapDoc

### 不需要 docVersion / docHash / 时间窗
- 角度 A 在 IPC 层切断 echo,view 层不需要再判 "我刚 emit 的"
- 角度 C 让 Host 不再自动同步,即使 echo 走漏一次也不会触发 replaceWith

---

## 1. 角度 A:main broadcast 排除发起者

### 1.1 改动文件 + 改动点

#### `src/platform/main/note/broadcast.ts`(+3 行)

```diff
-export async function broadcastNoteListChanged(): Promise<void> {
+export async function broadcastNoteListChanged(excludeSenderId?: number): Promise<void> {
   try {
     const list = await listNotes();
     for (const win of BrowserWindow.getAllWindows()) {
-      if (!win.isDestroyed()) {
+      if (win.isDestroyed()) continue;
+      // 排除发起 NOTE_UPDATE 的 renderer — 防 echo 回灌触发 NoteView Host
+      // useEffect 重渲(光标跳末尾根因)。外部更新(main 直接调 updateNote)
+      // excludeSenderId=undefined,所有 renderer 都收到广播,语义正确。
+      if (excludeSenderId != null && win.webContents.id === excludeSenderId) continue;
       win.webContents.send(IPC_CHANNELS.NOTE_LIST_CHANGED, list);
-      }
     }
   } catch (err) {
     console.warn('[note] broadcast list-changed failed:', err);
   }
 }
```

#### `src/platform/main/note/handlers.ts`(改 1 行)

**只**给 `NOTE_UPDATE` 传 `e.sender.id`。`NOTE_CREATE` / `NOTE_MOVE` / `NOTE_DELETE` 保持不传(它们改的是 list 结构,发起者的 NavSide 需要同步)。

```diff
-  ipcMain.handle(IPC_CHANNELS.NOTE_UPDATE, async (_e, payload: unknown) => {
+  ipcMain.handle(IPC_CHANNELS.NOTE_UPDATE, async (e, payload: unknown) => {
     const p = payload as { id?: unknown; doc?: unknown } | null;
     if (!p || typeof p.id !== 'string' || !p.id) return null;
     if (!isDocEnvelope(p.doc)) return null;
     const note = await updateNote(p.id, p.doc);
-    await broadcastNoteListChanged();
+    // 排除发起 renderer 的 echo(光标跳末尾防御主干)
+    await broadcastNoteListChanged(e.sender.id);
     return note;
   });
```

### 1.2 边界 case 验证

| 触发源 | sender.id | 期望行为 | 验证 |
|---|---|---|---|
| 用户编辑 → IPC NOTE_UPDATE | 有(renderer X) | renderer X 收不到 echo,其他 view 收到 | NoteView 不跳 |
| ebook 标注 → main 直接 updateNote | undefined(不走 ipcMain.handle) | 所有 renderer 收到广播 | 同 thought NoteView 触发 swapDoc 外部刷新 |
| 跨窗口 ebook view 写 thought | 走 IPC 但 NOTE_UPDATE handler 触发? | 是 — 也排除发起 ebook renderer | 该 ebook view 不会收到 echo,但同进程的 NoteView 收到 |

最后一行要再确认:ebook capability-impl.ts 是 main 端代码,但**调用入口**可能从 renderer ipc 进来。grep:

```bash
grep -rn "appendReadingThoughtBlock\|removeReadingThoughtBlock" src/ --include='*.ts'
```

如果调用源在 main 内(getReadingThought 等链路),sender 自然 undefined,无问题。如果从 renderer ipc 进来,**排除 sender 仍然没问题**(ebook view 本身不挂 NoteView Host,echo 给它也无害,只是没必要)。

---

## 2. 角度 C:Host ref-based + 删 doc prop 同步

### 2.1 swapDoc API 契约

```ts
interface TextEditingHostHandle {
  /**
   * 显式换 doc
   * - selection 一律落 atStart;调用方需要保留 selection 时分两步走
   * - view destroyed 时静默吞掉
   * - IME composing 时 stash 到 pendingExternalDocRef,compositionend 后 flush
   * @param reason 仅用于日志/调试,可选
   */
  swapDoc(doc: DriverSerialized, opts?: { reason?: 'note-switch' | 'external-sync' | 'init' }): void;
}
```

### 2.2 Host props 变化

| 字段 | 旧 | 新 |
|---|---|---|
| `config` | 同 | 同 |
| `doc` | 受控 prop,变化触发 replaceWith | **完全删除** |
| `onChange` | 同 | 同 |
| `readOnly` | 同 | 同 |
| `className` | 同 | 同 |
| `ref` | — | `forwardRef<TextEditingHostHandle>` |

**不留兼容层**。3 个使用者一次性全改。

### 2.3 改动文件

#### `src/drivers/text-editing-driver/types.ts`

```diff
 export interface TextEditingHostProps {
   config: TextEditingConfig;
-  doc: DriverSerialized;
   onChange: (newDoc: DriverSerialized) => void;
   readOnly?: boolean;
   className?: string;
 }
+
+export interface TextEditingHostHandle {
+  swapDoc(doc: DriverSerialized, opts?: { reason?: 'note-switch' | 'external-sync' | 'init' }): void;
+}

 export interface TextEditingDriver {
   readonly id: 'text-editing-driver';
   readonly version: string;
-  Host: ComponentType<TextEditingHostProps>;
+  Host: ForwardRefExoticComponent<TextEditingHostProps & RefAttributes<TextEditingHostHandle>>;
   ...
 }
```

#### `src/capabilities/text-editing/types.ts`

```diff
+export type { TextEditingHostHandle } from '@drivers/text-editing-driver/types';
 // DriverHost 类型同步改 ForwardRef
```

#### `src/drivers/text-editing-driver/Host.tsx`(核心改动)

**改 1:Host 改 forwardRef**

```diff
-export function Host(props: TextEditingHostProps) {
-  const { config, doc, onChange } = props;
+export const Host = forwardRef<TextEditingHostHandle, TextEditingHostProps>(function Host(
+  props, ref,
+) {
+  const { config, onChange } = props;
```

**改 2:删除指纹/时间戳 refs**

```diff
-  const lastEmittedJsonRef = useRef<string | null>(null);
-  const lastEmitTsRef = useRef<number>(0);
   const pendingExternalDocRef = useRef<DriverSerialized | null>(null);
   const pendingComposingDocRef = useRef<DriverSerialized | null>(null);
+  // ref 还没绑(swapDoc 在 EditorView mount 之前调用)时 stash 初始 doc
+  const pendingInitialDocRef = useRef<DriverSerialized | null>(null);
```

**改 3:mount EditorView 用空 doc**

```diff
   useEffect(() => {
     const container = containerRef.current;
     if (!container) return;
     const schema = buildSchema(ENABLED_BLOCKS);
-    const initialDoc = deserializeDoc(doc, schema);
-    if (!initialDoc) {
-      console.error('[text-editing-driver] deserialize failed; falling back to empty doc');
-      return;
-    }
+    // 空 doc 挂 EditorView,调用方 mount 后立即 ref.swapDoc 注入真实内容
+    const initialDoc = schema.nodes.doc.createAndFill();
+    if (!initialDoc) return;
```

**改 4:onTransaction emit 时不再记指纹/时间戳**

```diff
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
```

compositionend 同样:

```diff
   if (composed) {
     pendingComposingDocRef.current = null;
-    lastEmittedJsonRef.current = JSON.stringify(composed.payload);
-    lastEmitTsRef.current = Date.now();
     onChangeRef.current?.(composed);
   }
```

**改 5:mount useEffect 末尾 flush pendingInitialDoc**

```diff
     ...
     view.dom.addEventListener('compositionend', onCompositionEnd);
+    // 若 ref.swapDoc 在 EditorView mount 之前被调用过,补 apply
+    if (pendingInitialDocRef.current) {
+      const pending = pendingInitialDocRef.current;
+      pendingInitialDocRef.current = null;
+      applyExternalDoc(pending);
+    }
     ...
```

**改 6:applyExternalDoc 简化(无 docHash/时间窗,保留 PM eq 快路径)**

```diff
-  const applyExternalDoc = (nextDoc: DriverSerialized): boolean => {
+  const applyExternalDoc = (nextDoc: DriverSerialized, reason?: string): void => {
     const view = viewRef.current;
-    if (!view) return true;
+    if (!view || view.isDestroyed) return;
     if (view.composing) {
       pendingExternalDocRef.current = nextDoc;
-      return false;
+      return;
     }
-    const incomingJson = JSON.stringify(nextDoc.payload);
-    if (incomingJson === lastEmittedJsonRef.current) return true;
-    if (Date.now() - lastEmitTsRef.current < 200) return true;
     const schema = view.state.schema;
     const newDoc = deserializeDoc(nextDoc, schema);
-    if (!newDoc) return true;
-    if (view.state.doc.eq(newDoc)) return true;
+    if (!newDoc) return;
+    if (view.state.doc.eq(newDoc)) return; // 已等价,跳过
     const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, newDoc.content);
+    tr.setSelection(Selection.atStart(tr.doc));
     tr.setMeta('addToHistory', false);
     view.dispatch(tr);
-    return true;
   };
```

**改 7:useImperativeHandle 暴露 swapDoc**

```diff
+  useImperativeHandle(ref, () => ({
+    swapDoc(doc: DriverSerialized, opts?: { reason?: string }): void {
+      if (!viewRef.current) {
+        pendingInitialDocRef.current = doc;
+        return;
+      }
+      applyExternalDoc(doc, opts?.reason);
+    },
+  }), []);
```

**改 8:删 useEffect[doc] 自动同步**

```diff
-  useEffect(() => {
-    applyExternalDoc(doc);
-  }, [doc]);
```

**改 9:imports**

```diff
-import { useEffect, useRef } from 'react';
+import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
+import { Selection } from 'prosemirror-state';
```

#### `src/views/note/NoteView.tsx`

**改 1:hostRef + 切笔记 swapDoc**

```diff
-import { useMemo, useSyncExternalStore, useCallback, useEffect } from 'react';
+import { useMemo, useSyncExternalStore, useCallback, useEffect, useRef } from 'react';
+import type { TextEditingHostHandle } from '@capabilities/text-editing/types';

 export function NoteView({ workspaceId }: NoteViewProps) {
+  const hostRef = useRef<TextEditingHostHandle>(null);
   ...
+  // 切笔记 → swapDoc('note-switch')
+  useEffect(() => {
+    if (!activeNote) return;
+    hostRef.current?.swapDoc(activeNote.doc, { reason: 'note-switch' });
+    // deps 字面只跟 activeNoteId:同 noteId 下 doc 引用变(broadcast 外部更新)由下方 effect 处理
+  }, [activeNoteId]);
+
+  // 外部更新(同 noteId 但 doc 引用变化)→ swapDoc('external-sync')
+  // 角度 A 已在 IPC 层切断 echo,这里收到的 activeNote.doc 一定是真外部更新
+  // (ebook 标注写 thought / 跨进程协作等场景)
+  useEffect(() => {
+    if (!activeNote) return;
+    hostRef.current?.swapDoc(activeNote.doc, { reason: 'external-sync' });
+  }, [activeNote?.doc]);
```

**注意**:两个 effect 必须保持顺序——`[activeNoteId]` 先,`[activeNote?.doc]` 后。React 跑 effect 按声明顺序,切笔记时两个 effect 都触发,note-switch 先把 view 重置,external-sync 紧接着重新 swap 同样的 doc(doc.eq 在 Host 里会快路径跳过)。

**或者**简化成一个 effect 但带 reason 判断:

```ts
const prevNoteIdRef = useRef<string | null>(null);
useEffect(() => {
  if (!activeNote) return;
  const isNoteSwitch = prevNoteIdRef.current !== activeNoteId;
  prevNoteIdRef.current = activeNoteId;
  hostRef.current?.swapDoc(activeNote.doc, {
    reason: isNoteSwitch ? 'note-switch' : 'external-sync',
  });
}, [activeNoteId, activeNote?.doc]);
```

**推荐用合并版**(代码更直观)。

**改 2:JSX 删 doc prop + 加 ref + 等 activeNote 就绪后挂 Host**

```diff
   if (!activeNote) {
     return (...);  // 已有 empty state
   }

   const Host = textEditing.Host;
   return (
     <div className="krig-note-view-frame">
       <div className="krig-note-view" data-view-id="note-view">
         <div className="krig-note-view-content">
           <Host
+            ref={hostRef}
             config={...}
-            doc={activeNote.doc}
             onChange={handleDocChange}
           />
         </div>
       </div>
       ...
     </div>
   );
```

**注意**:NoteView 当前已经 `if (!activeNote) return <empty>;`,所以 Host 仅在 activeNote 就绪后挂载,P1#2 自然满足。**无需额外改动**。

#### `src/views/thought/ThoughtCardEditor.tsx`

`key={thought.id}` 父级 remount,每个 thought 独立 Host 实例。mount 后注入初始 doc:

```diff
-import { useEffect, useMemo, useRef } from 'react';
+import { useEffect, useMemo, useRef } from 'react';
+import type { TextEditingHostHandle } from '@capabilities/text-editing/types';

   ...
+  const hostRef = useRef<TextEditingHostHandle>(null);
+
+  // mount 时注入初始 doc(thought.id 变化时父级 remount,自然走到这里)
+  useEffect(() => {
+    hostRef.current?.swapDoc(thought.doc, { reason: 'init' });
+    // 仅 mount 跑一次;后续 thought.doc 变化也不触发(自家 onChange 反射回来由 lastSavedRef 防御)
+    // eslint-disable-next-line react-hooks/exhaustive-deps  -- 字面 mount 时拿 thought.doc 不依赖后续变化
+  }, []);
```

JSX:

```diff
   return (
     <Host
+      ref={hostRef}
       config={...}
-      doc={thought.doc}
       onChange={handleChange}
       readOnly={readOnly}
       className="krig-thought-card-editor-host"
     />
   );
```

**保留 lastSavedRef** echo 防御 — 防 thoughtApi.updateThought 触发自家 onChange 反射循环,跟本次重构无关。

#### `src/capabilities/canvas-text-node/edit-overlay.tsx`

```diff
+import type { TextEditingHostHandle } from '@capabilities/text-editing/types';

+  const hostRef = useRef<TextEditingHostHandle>(null);
+
   useEffect(() => {
     if (!session) {
       setInitialDoc(null);
       latestDocRef.current = null;
       return;
     }
     let cancelled = false;
     void docToDriverSerialized(session.opts.initialDoc).then((d) => {
       if (cancelled) return;
       const ds = d as DriverSerialized;
       setInitialDoc(ds);
       latestDocRef.current = ds;
+      hostRef.current?.swapDoc(ds, { reason: 'init' });
     });
     return () => { cancelled = true; };
   }, [session]);
```

JSX:

```diff
       <Host
+        ref={hostRef}
         config={...}
-        doc={initialDoc}
         onChange={handleChange}
       />
```

**注意**:`if (!session || !initialDoc) return null;` 保留 — 拿不到 initialDoc 前 Host 不挂(P1#2 自然满足)。

#### `src/drivers/text-editing-driver/index.ts`

```diff
+export type { TextEditingHostHandle } from './types';
```

---

## 3. 测试清单(全部 PASS 才合 main)

### 3.1 跳末尾 bug(主目标)
- [ ] 长 note(>1万字)内连续输入 50 字符,光标不跳末尾
- [ ] 连续按 Enter / Backspace / Delete 各 20 次,光标不跳末尾
- [ ] 同时打开 Thought 右槽,左槽 note 输入稳定
- [ ] DevTools 控制台无任何 cursor-jump 报警(若 v5 探测已撤可跳过)

### 3.2 IME 中文输入回归
- [ ] 中文拼音连续输入 20 字,无字符丢失/光标跳
- [ ] 拼音中开右槽 thought 编辑,左槽拼音不中断
- [ ] 完成拼音后按方向键,光标位置正确

### 3.3 切笔记
- [ ] note A → B,B 内容完整加载(含 image/math/table/callout/toggle 等)
- [ ] A → B → A,A 重新打开内容完整、光标 atStart 可接受
- [ ] 点击 note-link 跳转目标 note 正常加载并滚到 anchor

### 3.4 外部更新(P1#1 核心验证)⭐ **本版新增**
- [ ] 打开 NoteView 显示某 thought 关联的 note
- [ ] 同时打开对应 ebook,做 highlight 操作(触发 main appendReadingThoughtBlock)
- [ ] NoteView 应**自动刷新**显示新增的标注块,且光标不跳(因为是 'external-sync' 走 swapDoc atStart)
- [ ] DevTools console 看到 `[Host] swapDoc reason=external-sync` 日志(若加了)

### 3.5 ThoughtCardEditor
- [ ] 单击 thought 卡片进入编辑,内容正常显示
- [ ] 卡片快速切换,内容正确刷新
- [ ] 编辑 + 1 秒后自动落库(debounce)正常

### 3.6 canvas-text-node 编辑 overlay
- [ ] 双击画板文字节点进入编辑,内容显示
- [ ] Esc 取消 / Cmd+Enter 提交都正常
- [ ] 编辑期间内容不重置

### 3.7 既有功能不回归
- [ ] cmd+Z 不跳末尾(已修,本 PR 不动该路径)
- [ ] 媒体 NodeView 上传完成不跳末尾(已修)
- [ ] TOC 点击跳转正常
- [ ] floating toolbar / slash menu / handle menu 等弹层正常
- [ ] vocab highlight / thought anchor decoration 正常
- [ ] NavSide note 列表能正确显示新建/删除/重命名(角度 A 没排除这些 broadcast)

---

## 4. 验证命令

```bash
# 1. TS 检查
npx tsc --noEmit

# 2. lint(若可用)
npm run lint 2>/dev/null || true

# 3. grep 验证所有 Host 使用者都已迁移(预期 0 行)
grep -rn '<Host' src/ --include='*.tsx' | grep 'doc=' | grep -v '\.md:'

# 4. grep 验证 3 个使用者都加了 ref(预期 3 行)
grep -rn 'ref=.*hostRef\|hostRef\.current\.swapDoc' src/ --include='*.tsx' | grep -v '\.md:'

# 5. grep 验证 NOTE_UPDATE handler 传了 sender.id(预期 1 行)
grep -n 'broadcastNoteListChanged(e\.sender\.id)' src/platform/main/note/handlers.ts

# 6. 启动 dev 跑 §3 测试清单
npm start
```

---

## 5. 风险点 + 应对

| 风险 | 概率 | 应对 |
|---|---|---|
| ref 未绑时 swapDoc 调用拿 null | 中 | `pendingInitialDocRef` 兜底(§2.3 改 5) |
| ThoughtCardEditor `key={id}` + ref stale | 低 | key 变化整组件 remount,新 ref 无 stale |
| canvas 异步 docToDriverSerialized 在 Host mount 前完成 | 中 | hostRef 未挂时走 pendingInitialDocRef 兜底 |
| 删 doc prop 后某使用者漏改 | 高 | §4 grep 命令 #3 必须返回 0 行 |
| NoteView 两个 effect 顺序导致重复 swapDoc(切笔记时) | 低 | 推荐合并版 effect;退一步 doc.eq 快路径在 Host 内已挡 |
| 角度 A 排除 sender 后,**同 renderer 多 NoteView 实例**(分屏)也被一起排除 | 中 | 分屏目前不支持(参见 [[active-resource-id-arch-debt]]);未来实施分屏前需改为 sender-by-view 排除 |
| 角度 A 排除 sender 后,**发起方 NavSide 列表也收不到更新**? | 低 | NavSide 用 useAllNotes,确实会受影响;但 NOTE_UPDATE 只改 doc/title,不改 list 结构;若标题派生改了,需要 NavSide 显式从 onChange 处取更新(本 PR 范围外,留 TODO) |
| ebook capability 写 thought 的 broadcast,thought view 该如何同步 | 中 | thought view ThoughtCardEditor 不依赖 useEffect[doc],它用 key remount 解决;若 thought view 需要也走 swapDoc(external-sync),沿用 NoteView 模式(本 PR 范围外) |

---

## 6. PR 拆分

**单 PR 一次过**:`refactor/host-ref-based-and-broadcast-exclude-sender`

- 角度 A 改 2 个文件(broadcast.ts + handlers.ts)
- 角度 C 改 6 个文件(types ×2 + Host + 3 个使用者)
- 净行数:**+90 / -130 行**(删的比加的多)
- 合 main 前必须跑 §3 全部测试,特别是 §3.4 外部更新(P1#1 验证)

---

## 7. 实施顺序

按 **先 A 后 C** 的顺序,因为 A 改的少,先验证 echo 在源头切断;再做 C 让架构稳固:

1. **角度 A 改 broadcast.ts + handlers.ts**(§1.1) — 5 行改动
2. 跑 §3.1 / §3.4 验证 echo 切断 + 外部更新正常
3. **角度 C 改 types**(§2.3 types.ts ×2)— TS 编译会立刻报使用者错,断点指引
4. **角度 C 改 Host.tsx**(§2.3 改 1-9)
5. **角度 C 改 NoteView.tsx**(§2.3)
6. **角度 C 改 ThoughtCardEditor**(§2.3)
7. **角度 C 改 canvas edit-overlay**(§2.3)
8. **跑 §4 grep 验证**
9. **跑 §3 全部测试**
10. **commit + merge**

每步完成跑 `npx tsc --noEmit`,绿了再继续。

---

## 8. 未尽事项(本 PR 范围外)

- [ ] NavSide note 列表标题派生若需实时刷新自家 NoteView 编辑后的标题,需 NavSide 监听其他渠道(目前可能依赖 broadcast,角度 A 排除后**首段标题改后 NavSide 不自动更新**) — 实施前需 grep NavSide 怎么订阅 title;若依赖 onListChanged,**回归测试要覆盖**
- [ ] thought view ThoughtCardEditor 若也想接外部更新(ebook 写自己的 thought),可沿用 NoteView 模式加 external-sync useEffect — 当前不做,key remount 已经 work
- [ ] 探测器 v5 log 已撤,无需清理
- [ ] Host.tsx 删指纹机制后,旧注释段(§108-114 那段长 comment)一起清理
- [ ] 删 `pendingExternalDocRef` IME 兜底? — **不删**,成本极低、防 swapDoc 在 composing 时调,删了出问题更难加回

---

*v2 生成于 2026-05-20,基于用户审计反馈 P1#1+P1#2 重写*
