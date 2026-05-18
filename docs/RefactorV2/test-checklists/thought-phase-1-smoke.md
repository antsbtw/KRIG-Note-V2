# Thought Phase 1 — devtools 烟雾测试清单

**前提**:`npm start` 跑起 app,等 NavSide 出现。

**何时跑**:Phase 1 合并前用户验收。

**位置**:Electron DevTools(`Cmd+Opt+I`)的 Console 区。

> ⚠️ 这一批测试只验证 **后端 IPC 链路通畅**(没有 ThoughtView UI — UI 在 Phase 2);
> Phase 1 完成定义 = 这 6 项全 PASS,UI 在 Phase 2-5 渐次补齐。

---

## 测试 #1 — IPC 表面可见

粘到 DevTools Console:

```js
// 应输出 9 个函数名: thoughtCreate / thoughtList / thoughtListBySource / thoughtGet /
//                  thoughtUpdate / thoughtDelete / thoughtMoveToFolder / thoughtUpdateAnchor /
//                  onThoughtListChanged
Object.keys(window.electronAPI).filter(k => k.startsWith('thought') || k === 'onThoughtListChanged').sort();
```

**期望**:9 个,完全匹配。

---

## 测试 #2 — 建独立(unanchored)thought + 列表

```js
const emptyDoc = { format: 'pm-doc-json', version: '0.1', payload: { type: 'doc', content: [{ type: 'paragraph' }] } };
const t1 = await window.electronAPI.thoughtCreate({
  type: 'thought',
  resolved: false,
  pinned: false,
  doc: emptyDoc,
  folderId: null,
  anchor: null,   // 显式 unanchored
});
console.log('created:', t1);
const list = await window.electronAPI.thoughtList();
console.log('list len:', list.length, 'has:', list.some(t => t.id === t1.id));
```

**期望**:
- `t1.id` 是非空字符串
- `t1.anchor === null`
- `t1.type === 'thought'`
- `list.length >= 1` 且包含刚才创建的 id

---

## 测试 #3 — 重启 app 后 thought 仍在(持久化)

1. 重启 app(`npm start` 重跑)
2. DevTools Console:

```js
const list = await window.electronAPI.thoughtList();
console.log('after restart, list:', list);
```

**期望**:测试 #2 创建的 thought 仍在列表中。

---

## 测试 #4 — anchored thought + listBySource

**前置**:先建一个 note,记下其 id。

```js
// 拿一个 note id
const notes = await window.electronAPI.noteList();
const noteId = notes[0]?.id;
console.log('using noteId:', noteId);
if (!noteId) throw new Error('请先建一个 note 再跑此测试');

// 建一个挂在该 note 上的 thought
const emptyDoc = { format: 'pm-doc-json', version: '0.1', payload: { type: 'doc', content: [{ type: 'paragraph' }] } };
const t2 = await window.electronAPI.thoughtCreate({
  type: 'question',
  resolved: false,
  pinned: false,
  doc: emptyDoc,
  folderId: null,
  anchor: {
    source: 'note',
    resourceId: noteId,
    locator: { pmPos: 5, anchorType: 'inline', text: 'test selection' },
  },
});
console.log('anchored:', t2);

// listBySource 应能拿到它
const inNote = await window.electronAPI.thoughtListBySource('note', noteId);
console.log('thoughts in note:', inNote.length, inNote.map(t => t.id));
```

**期望**:
- `t2.anchor.source === 'note'`
- `t2.anchor.resourceId === noteId`
- `t2.anchor.locator.pmPos === 5`
- `inNote` 数组含 `t2.id`,不含测试 #2 那个 unanchored thought

---

## 测试 #5 — updateAnchor 显式解依附(dangling → unanchored)

```js
// 接测试 #4
await window.electronAPI.thoughtUpdateAnchor(t2.id, null);
const after = await window.electronAPI.thoughtGet(t2.id);
console.log('after unanchor:', after.anchor);  // 应是 null
const inNoteAfter = await window.electronAPI.thoughtListBySource('note', noteId);
console.log('still in note?', inNoteAfter.some(t => t.id === t2.id));  // 应是 false
const allAfter = await window.electronAPI.thoughtList();
console.log('still in list?', allAfter.some(t => t.id === t2.id));     // 应是 true
```

**期望**:
- `after.anchor === null`
- `listBySource` 返回里**不包含**该 thought
- `list()` 返回里**仍包含**该 thought

(这就是 v0.5 §8.3 unanchored 态字面验证。)

---

## 测试 #6 — update 改 type + 广播 + delete

```js
// 订阅广播
const unsub = window.electronAPI.onThoughtListChanged((list) => {
  console.log('broadcast received, len:', list.length);
});

// 改 type
const updated = await window.electronAPI.thoughtUpdate(t2.id, { type: 'todo', resolved: true });
console.log('updated:', updated.type, updated.resolved);

// 删
await window.electronAPI.thoughtDelete(t2.id);
const gone = await window.electronAPI.thoughtGet(t2.id);
console.log('after delete, get:', gone);  // 应是 null

unsub();
```

**期望**:
- `updated.type === 'todo'` + `updated.resolved === true`
- 期间 console 至少多打 2 条 `broadcast received` 行(update + delete 各一次)
- `gone === null`

---

## 收尾 — 清理

```js
// 删测试 #2 创建的 thought
await window.electronAPI.thoughtDelete(t1.id);
console.log('cleanup done');
```

---

**全 6 项 PASS = Phase 1 验收通过,可以 commit。**
