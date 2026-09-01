# NoteView 编辑时光标跳 doc 末尾 — 问题分析

> 状态:**问题描述**,**不含修复方案**。基于 2026-05-20 的诊断证据。
>
> 历史背景:今天已合 main 3 次 fix(0ba6f74b / 692a82a7 / d982a921),全部基于"指纹/时间窗/addToHistory:false"等**症状级补丁**。本文回到架构层,把"为什么会发生"讲清楚,作为下一轮根治的依据。

---

## 1. 现象

用户在 NoteView 里做**正常的编辑操作**(回车、空格、Backspace、Delete、普通字符输入),光标偶尔会突然跳到整个 note 的末尾。今天最后一次复现:`oldSelFrom: 3423` → `newSelFrom: 56567`(doc size 56568),整片 viewport 也滚到底部。

**关键诊断**:跳的那一刻,PM 内部有一个 `ReplaceStep`,把整个 doc 内容替换了一遍。selection 因为整篇替换被 PM 推到末尾。

stack 顶端:
```
EditorView.dispatchTransaction
  ← view.dispatch
  ← applyExternalDoc (Host.tsx)
  ← useEffect[doc] commit
  ← React commitHookPassiveMountEffects
```

也就是说,触发整篇替换的不是用户按键,而是 **React useEffect 在某次重渲染后判定 props.doc 变了,Host 主动 dispatch 了一个 replaceWith tr**。

---

## 2. 完整链路(8 段)

```
[1] 用户按键(Enter / Backspace / 字符等)
[2] PM dom 拦截 keydown
[3] PM keymap / plugin 跑命令 → 生成 tr (含 ReplaceStep)
[4] view.dispatch(tr) → dispatchTransaction → updateState
[5] onTransaction 触发 Host onChange(serializedDoc)
[6] NoteView.handleDocChange → updateNote(noteId, { doc })
    → noteCap.updateNote → IPC NOTE_UPDATE
[7] main:ipcMain.handle 收到 → SurrealDB UPDATE
    → broadcastNoteListChanged():
        for (win of getAllWindows())
          win.webContents.send(NOTE_LIST_CHANGED, fullNoteList)
[8] renderer:useAllNotes onListChanged → setNotes(...)
    → NoteView 重渲 → allNotes.find(activeNoteId) 拿到 note 新引用
    → <Host doc={新引用} onChange={...} />
    → React 比对 props.doc:旧引用 !== 新引用 → useEffect[doc] 触发
    → applyExternalDoc(nextDoc) → tr.replaceWith(0, docSize, newContent)
    → view.dispatch(tr) → PM 把 selection 推到末尾
```

**[1]-[5] 是编辑本身,[6]-[8] 是"非编辑的二次链"**。问题就在 [6]→[8] 的回灌循环里。

---

## 3. 用户问题的精确回答

> "PM 的一个正常编辑行为,为什么会触发其他非编辑行为的操作?"

**因为 KRIG 的多视图同步设计把"持久化 + 跨视图广播"和"编辑器自身的状态"绑在了一条 React props 同步路径上**。具体三点共同造成:

### 3.1 main broadcast 不区分发起者
[src/platform/main/note/broadcast.ts:19-21](src/platform/main/note/broadcast.ts#L19-L21):
```ts
for (const win of BrowserWindow.getAllWindows()) {
  if (!win.isDestroyed()) {
    win.webContents.send(IPC_CHANNELS.NOTE_LIST_CHANGED, list);
  }
}
```
广播给**所有窗口**,**包括刚刚发起 updateNote 的那一个**。也就是"用户在 NoteView 编辑 → 自己又收到自己的 echo"。

main 的 NOTE_UPDATE handler 收到 IpcMainInvokeEvent `e`,本来可以拿 `e.sender.id` 排除发起者,但目前没用。

### 3.2 broadcast 粒度是 "全 list",不是 "单 note patch"
广播 payload 是 `fullNoteList` —— 所有 note 的完整数据。renderer 收到后 useAllNotes setState 整个数组,React shallow compare 不可能在 list 层 dedup,**每个 NoteView 都重渲**。

如果广播是 "noteId X 的 doc 改成了 Y",发起者可以在 reducer 里判 X === selfActiveNoteId 跳过自己的回写。现在做不到。

### 3.3 Host 接受 doc 作为 React prop
[src/drivers/text-editing-driver/Host.tsx:267-271](src/drivers/text-editing-driver/Host.tsx#L267-L271):
```ts
useEffect(() => {
  applyExternalDoc(doc);
}, [doc]);
```
Host 把 doc 当作 React 同步的 prop。任何让 props.doc 引用变化的事件,都会让 Host 主动尝试把 view 拉到那个 doc。这是经典的 "PM + React 双向绑定" 反模式 —— PM 本身是个**有状态的内部世界**,把它当受控组件用,就必然要写一堆 "我的状态比 props 新,别拉我" 的补丁。

---

## 4. 我们已经打过的补丁(全都是症状级)

| Commit | 时间 | 补丁内容 | 性质 |
|---|---|---|---|
| 早期 | - | JSON 字面指纹比对 `lastEmittedJsonRef` | 用字面相等判 echo,IPC 序列化 key 重排后几乎从不命中 |
| 0ba6f74b | 今天 | 200ms 时间窗守护 `lastEmitTsRef` | **靠延时碰运气**;遇到慢机器/IPC 卡顿就漏 |
| 692a82a7 | 今天 | math-visual updateAttrs 加 addToHistory:false | 修 cmd+Z 跳末尾(独立 bug,跟本问题无关) |
| d982a921 | 今天 | 6 媒体 NodeView updateAttrs 加 addToHistory:false | 同上 |

**这次复现说明:200ms 时间窗没拦住**。要么 broadcast 来得太晚(>200ms),要么是 useEffect 第一次跑(useEffect[doc] 初挂载也会触发 applyExternalDoc)。无论哪种,**靠时间窗都是"我猜大多数情况够用",不是"逻辑上保证正确"**。

---

## 5. 用户最新明确判断

> "我觉得通过延时的方法修复 bug 就不是一个靠谱的事情"

完全同意。所有"延时碰运气"的方案都不可接受。下一轮修复必须基于**逻辑判断**而非时序。

---

## 6. 三个独立的修复角度(待 review,不做决定)

### 角度 A:main broadcast 排除发起者
- **改动面**:`src/platform/main/note/broadcast.ts` + `src/platform/main/note/handlers.ts`,约 10 行
- **思路**:`NOTE_UPDATE` handler 收到 IpcMainInvokeEvent `e`,把 `e.sender.id` 传给 `broadcastNoteListChanged(excludeSenderId)`,broadcast 时 `if (win.webContents.id !== excludeSenderId) win.webContents.send(...)`
- **优点**:**源头堵**;不依赖任何时序;单次性架构改进;其他订阅者(NavSide、ThoughtView、TOC、note-link-search 等)不受影响,它们仍能收到广播
- **风险**:同一 renderer 内多 NoteView 实例(分屏场景)的子实例可能也被排除 —— 需要按 view-instance 排除,但当前没有这个标识。这条要进一步设计

### 角度 B:NoteView 层加 noteId/origin 守门
- **改动面**:`NoteView.tsx` + `Host.tsx` + 可能要传 origin 标识
- **思路**:NoteView 跟踪 "自己最近一次 emit 出去的 docVersion",props.doc 变化时如果 version <= self emit 版本 → 不传给 Host
- **优点**:不动 IPC 协议;在 view 层局部修
- **风险**:Host 依然有 useEffect[doc],NoteView 要做的判断和 200ms 时间窗本质一样,只是判断信号从 "时间" 换成 "版本号" —— 仍是补丁

### 角度 C:Host 改成 ref-based API,取消 props.doc 自动同步
- **改动面**:Host.tsx(去 useEffect[doc])、NoteView/EBookView/CanvasTextNode 等所有 host 使用者
- **思路**:Host 暴露 `hostRef.current.swapDoc(newDoc)` 显式 API,只在切笔记时由 view 主动调;props.doc 退化为 "初始 doc",不再触发 useEffect
- **优点**:**架构根治**;PM 不再被 React 当受控组件用,与 PM 本身的设计哲学一致;不可能出现 "自家广播打自家"
- **风险**:改 5-7 个 host 使用者的 API;需要短期接受不稳定窗口;切笔记/外部更新的 view 层逻辑要重写

---

## 7. 决策点(留给用户)

1. **先动哪个角度?** A 最快、C 最干净、B 不推荐(仍是补丁性质)。
2. **是否同时撤掉已合 main 的 200ms 时间窗?** 角度 A/C 落地后理论上 200ms 守护无用,但保留作二道防线也没坏处。
3. **诊断 log v5 怎么办?** 目前在 [editor-view-builder.ts:142](src/drivers/text-editing-driver/editor-view-builder.ts#L142) 还挂着,留着抓后续复现 / 修完撤掉都可以。

---

## 附:相关 memory

- [[project-noteview-cursor-jump-fix]] 今天三次 fix 的演化记录
- [[pm-internal-attr-write-must-mark-no-history]] cmd+Z 跳末尾的独立类型(不是本文这条)
- [[view-self-loop-jitter]] view 自打自循环模式(IME / WebView Google)
- [[external-sdk-lifecycle]] 外部 SDK 生命周期边界

---

*生成于 2026-05-20,作者:Claude(应用户明确要求"先把问题描述清楚,写到一个.md文件",不含修复)*
