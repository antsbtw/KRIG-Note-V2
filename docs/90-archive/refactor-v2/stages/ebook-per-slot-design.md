# eBook per-slot 化 — 诊断与实施交接

> 立项日期:2026-08-08
> 前置:分支 `feat/multi-window-step2`,commit `cc9be067`(navSide 跟随活跃槽三连已合)
> 状态:**已实施**(2026-08-08,commit `1a1e8ab5` / `d1b6238a` / `3aabe642`)。
> 总指挥拍板走**路线 B**(广播带 requester),范围严格收在 eBook。
> 本文档保留原诊断作为背景;实施结果与偏差见文末 §8。

---

## 0. 一句话问题

**左右双开 eBook 时,两栏恒显同一本书;在书架点任一本,两栏同时换过去。**

Note 已在 `4fda395b` + `cc9be067` 完成 per-slot 化(左右可各看一篇、navSide 跟随活跃槽),
eBook 停留在改造前的形态 —— 用户实测原话:「note 分开 navside 响应可以了,ebook 还不行。
点击 file,两个 view 同时响应。」

---

## 1. 诊断结论:**两个独立缺陷叠加**,只修一个不够

这是本文档最重要的一节。曾经的直觉判断是「照 `4fda395b` 给 eBook 补个
`rightActiveBookId` 就行」—— **那是错的**,补完仍会两栏同时换书。

### 缺陷 ①:`activeBookId` 没有槽维度

`src/views/ebook/data-model.ts:31`

```ts
export interface EBookWorkspaceState {
  activeBookId: string | null;   // ← 整个 ws 只有一个
  expandedFolders: Set<string>;
  readingState: EBookReadingState | null;   // ← 阅读位置同样只有一份
  selectedIds: Set<string>;
}
```

与 Note 改造**前**完全同构(note 当时也只有 `activeNoteId`)。
后果:两栏订阅同一字段,永远显示同一本;且阅读进度互相覆盖
(左栏翻到 100 页,右栏的 `readingState` 被一起改写)。

**连带**:`EBookView` 压根**没接 `slot` prop**:

```ts
// src/views/ebook/EBookView.tsx:60-64
interface EBookViewProps {
  workspaceId: string;
  payload?: unknown;          // ← 没有 slot
}
export function EBookView({ workspaceId }: EBookViewProps) {
```

而 `SlotArea` 是**传了**的(`<Comp workspaceId={} payload={} slot={slot} />`,
`SlotArea.tsx:119`)—— view 自己丢掉了。所以 eBook 侧此刻**没有任何东西知道自己在哪一栏**。

### 缺陷 ②:`onBookOpened` 是全局广播,两个 Host 都无条件消费 ← **截图现象的直接原因**

这条是缺陷 ① 之外的**独立**问题,也是「点一本两栏同时响应」的真凶。

完整链路(逐跳已核):

```
renderer  library.open(id)                     capabilities/ebook-library/index.ts:87
   ↓ ipcRenderer.invoke(EBOOK_BOOKSHELF_OPEN)  platform/main/preload/main-window-preload.ts:274
main      handler → loadEBook → broadcast      platform/main/ebook/library-handlers.ts:139
   ↓ broadcastEBookLoaded()
          for (win of BrowserWindow.getAllWindows())      ← ⚠️ 发给所有窗口
              win.webContents.send(EBOOK_LOADED, info)    library-handlers.ts:70-81
renderer  每个 EBookView 的 onBookOpened 回调都触发        views/ebook/EBookView.tsx:172-185
              → hostRef.current.loadFromInfo(info)         ← 两个 Host 都加载
```

关键点:**`EBOOK_LOADED` 的 payload 里没有任何「谁发起的」标识**:

```ts
// platform/main/ebook/library-handlers.ts:70
function broadcastEBookLoaded(info: {
  bookId: string; fileName: string; fileType: EBookFileType;
  lastPosition?: ReadingPosition;      // ← 没有 wsId,没有 slot,没有 requesterId
}): void
```

而 `EBookView` 的订阅是**无条件**的 —— 收到就加载,不问是不是给自己的:

```ts
// views/ebook/EBookView.tsx:172-185
useEffect(() => {
  return library.onBookOpened((info) => {      // ← 无任何过滤
    setFileName(info.fileName);
    activeBookIdRef.current = info.bookId;
    void hostRef.current?.loadFromInfo(info);
    bookmarks.loadOnBookOpen(info.bookId);
    void ann.loadOnBookOpen(info.bookId);
    void pdfAnn.loadOnBookOpen(info.bookId);
  });
}, [library, activeBookIdRef, bookmarks, ann, pdfAnn]);
```

**⇒ 即使补上 `rightActiveBookId`,点书仍会两栏同时加载** —— 因为加载不是由
`activeBookId` 驱动的,而是由这条广播驱动的。`activeBookId` 只负责
「启动 / 切书时主动 `open()` 一次」(`EBookView.tsx:221-227`),真正让 Host 出画面的是广播。

### 缺陷 ② 的扇出范围比想象大

`BrowserWindow.getAllWindows()` 意味着扇出是 **2 槽 × N workspace × N 窗口**,
不止左右两栏。这与 memory `project-host-broadcast-multi-ws-fanout`(宿主广播×多ws扇出,
「点直播弹 N tab」)是**同一个 bug 家族**,只是当时在别的 capability 上遇到。
那次的解法是「监听器加 `getActiveId()` 守卫」,本次不能照抄 —— 见 §3 取舍。

---

## 2. Blast radius(实测,非估算)

per-slot 化要动的文件与消费点:

| 文件 | 消费点 | 说明 |
|---|---|---|
| `views/ebook/data-model.ts` | `:31` `:42` `:48` `:76` `:128` | 加 `rightActiveBookId` + `readingState` 按槽;`setActiveBookId` 加 slot 参 |
| `views/ebook/EBookView.tsx` | `:60` `:87` `:97` `:172` `:221` `:618` | 接 `slot` prop;广播过滤;`activeBookId` 按槽读 |
| `views/ebook/use-ebook-progress.ts` | `:37` `:56` `:75` | `setReadingState(workspaceId, …)` 要带槽,否则两栏进度互覆盖 |
| `views/ebook/bookshelf-commands.ts` | `:57` `:81-82` | `open-book` 命令要按 activeSlot 落栏(对标 note 的 `targetSlot()`) |
| `views/ebook/nav-side-content.tsx` | `:166` | 书架高亮按活跃槽派生(对标 note 的 `activeId`) |
| `views/ebook/context-menu-content.ts` | `:139` | 右键取 activeBookId 要带槽 |
| `views/ebook/epub-context-menu-content.ts` | `:57` `:76-78` | 同上(注:走 `contextMenuController.custom` 注入) |
| `platform/main/ebook/library-handlers.ts` | `:70-81` `:139` | 广播加 requester 标识(见 §3) |
| `capabilities/ebook-library/index.ts` | `:87` `:147` | `open()` 透传 requester;`onBookOpened` 类型加字段 |
| `platform/main/preload/main-window-preload.ts` | `:274` `:310` | IPC 签名 |
| `shared/ipc/electron-api.d.ts` | `:257` | 类型 |

**注意**:`bookmarks` / `ann`(EPUB 标注)/ `pdfAnn`(PDF 空间标注)三套都挂在
`onBookOpened` 回调里按 bookId 加载。广播过滤修好后它们自动跟着对 —— 但如果选了
「只补 activeBookId 不修广播」的方案,这三套会在两栏之间串数据,**必须一起验**。

---

## 3. 实施建议与关键取舍(供总指挥拍板,不是既定结论)

### 缺陷 ② 的修法:两条路,推荐 B

**路线 A:renderer 侧加守卫**(照抄 `project-host-broadcast-multi-ws-fanout` 的做法)
每个 `EBookView` 在回调里判断「这本书是不是我这一栏的 `activeBookId`」,不是就 return。
- 优点:不动主进程与 IPC 契约,改动最小
- 缺点:**左右双开同一本书时会误判**(两栏 activeBookId 相同 → 都认领 → 回到原状)。
  用户对照阅读同一本书的不同页是真实用法,这个漏洞不能接受

**路线 B:广播带 requester 身份**(推荐)
`open()` 调用方带上 `{ wsId, slot }`,主进程原样回传进 `EBOOK_LOADED` payload,
`EBookView` 只认领 `info.requester.wsId === myWsId && info.requester.slot === mySlot` 的推送。
- 优点:同一本书双开也不串;顺带把 2槽×N ws×N 窗口 的扇出一次性收口
- 缺点:动 IPC 契约(4 个文件的签名),需要同步改类型
- 与 PROTOCOL.md §1.5 原则 1 的推论一致:**「命令必须由调用方显式携带槽 / instanceId」**,
  与 `toolbar-invocation.ts` 的既有做法同构

### 缺陷 ① 的修法:照 `4fda395b` 镜像

- 字段名 `activeBookId`(left,不做 migration,历史数据天然落 left)+ 新增 `rightActiveBookId`
- `readingState` 同样要按槽拆(`readingStateRight` 或改成 `Record<slot, …>`),
  否则两栏阅读进度互相覆盖 —— 这条**比笔记更痛**,因为 PDF 每翻一页都写
- `EBookView` 接 `slot` prop,`useEBookProgress(workspaceId, slot)`
- Host 若需要 per-slot 身份,对标 `noteInstanceId(wsId, slot)` 立 `ebookInstanceId`

### 顺带该做的:书架高亮 + 点击落栏

navSide 侧对标 note 已完成的部分(`cc9be067`):
- `nav-side-content.tsx` 传 `activeId`(FolderTree 的 `activeId` prop **已存在**,
  是本次 navSide 改造加的,eBook 直接复用即可,不用再改 shared-ui)
- `bookshelf-commands.ts` 的 `open-book` 按 `getActiveSlot(wsId)` 落栏,
  对标 note-commands 的 `targetSlot()`(`getInvokingSlot() ?? getActiveSlot(wsId)`)
- 右键项可加「在另一栏打开」,对标 `note-view.open-in-other-slot`

**activeSlot 单一来源已就绪**,直接 `import { getActiveSlot } from
'@workspace/workspace-state/active-slot'` 即可,不要另立第二处槽判断(硬约束)。

---

## 4. 硬约束(沿用 navSide 那轮,仍然有效)

1. **activeSlot 单一来源** —— 全仓只 `workspace-state/active-slot.ts` 一处判断「当前是哪个槽」。
   eBook 侧**不得**自行推导(如靠 focused 实例反查)。
2. **不落库 activeSlot** —— 它是纯内存会话级;但 `rightActiveBookId` / per-slot
   `readingState` **要**落库(那是内容状态,不是焦点状态,别搞混)。
3. **不抽通用 ActiveResourceManager** —— eBook 是第二个 per-slot 实现,
   **抽象时机到了但本次不抽**:先让 eBook 跑通,两个实现都稳定后再回头抽,
   遵循「先复用后抽象」(memory `project-block-serialization-layering`)。
   实施中若发现某段「明显该通用」,写 TODO 标记即可。
4. **fail loud** —— 广播认领失败 / 解析不出槽时 `console.error`,不静默 return
   (memory `feedback-fail-loud-no-fallback`)。特别注意:路线 B 的过滤器本身
   **不算**静默兜底(那是正常的「不是给我的」),但「解析不出自己是哪一栏」要报错。
5. **删共用边先 grep** —— `onBookOpened` 跨 capability 被消费,改签名前全仓核一遍
   (memory `feedback-grep-shared-edge-before-delete`)。
6. **ebook 非右键命令别读菜单上下文** —— 既有铁律,双击/快捷键路径不得从
   `contextMenuController.custom` 读 wsId/bookId(memory
   `project-ebook-nonrightclick-cmd-context`)。本次给命令加槽参数时**尤其容易犯**:
   别图省事把 slot 塞进 custom。

---

## 5. 验收标准

### 5.1 功能(真机,逐项验)

| # | 操作 | 预期 |
|---|---|---|
| 1 | 左右双开 eBook,书架点 A 书 | **只有活跃栏**换成 A,另一栏不动 |
| 2 | 点右栏 → 书架点 B 书 | 右栏变 B,左栏仍是 A |
| 3 | 左右开**同一本**书 | 两栏都能显示,各自独立翻页(路线 A 会在这条挂) |
| 4 | 左栏翻到 100 页,右栏翻到 5 页,重启 | 两栏各自回到 100 / 5,不互相覆盖 |
| 5 | 点右栏 → 看 navSide | 书架高亮 = 右栏那本 |
| 6 | 右栏加书签 / 标注 | 只落在右栏那本,左栏不受影响 |
| 7 | 关右栏 | 活跃槽回落 left,书架高亮回左栏那本 |
| 8 | 多窗口:窗口 2 点书 | 窗口 1 **不动**(验 `getAllWindows()` 扇出已收口)|

### 5.2 质量门槛

- `npx tsc --noEmit -p tsconfig.json` —— 基线 **1 条**:
  `src/views/x-inbox/XInboxView.tsx(714,48) WebkitAppRegion`,与本次无关不要修
- `npx vitest run` —— 基线 **625 passed**;6 个 suite 因 Electron `app.getPath`
  在 vitest 下不可用而 import 失败,属正常
- 纯 UI 行为,自动化测不到 —— **必须真机验 §5.1 全部 8 项**

---

## 6. 参考:Note 侧已完成的对照实现

改 eBook 时**照着这些抄**,形状已验证过:

| 关注点 | Note 的实现 |
|---|---|
| per-slot 活跃资源字段 | `views/note/data-model.ts:181-209`(`activeNoteId` / `rightActiveNoteId`)|
| per-slot scope key | `noteScopeKey(wsId, slot)` `data-model.ts:164` |
| per-slot PM 实例 id | `noteInstanceId(wsId, slot)` `data-model.ts:174` |
| 命令目标槽合成 | `note-commands.ts` 的 `targetSlot()`(invokingSlot 优先,回落 activeSlot)|
| 保证目标栏装得下 | `note-commands.ts` 的 `ensureNoteViewInSlot()` |
| 树高亮按活跃槽派生 | `views/note/nav-side-content.tsx:77` + FolderTree 的 `activeId` prop |
| 「在另一栏打开」 | `note-view.open-in-other-slot` + `context-menu-registrations.ts` |
| 活跃槽单一来源 | `workspace/workspace-state/active-slot.ts` |

---

## 7. 交付

- 建议 **3 个 commit**:①广播收口(缺陷②,含 IPC 契约)②per-slot 字段 + readingState
  ③书架高亮 + 点击落栏 + 右键项
- commit message 用中文,说明**根因与取舍**,不只列改动
- 完成后回报:§5.1 八项真机结果(逐项)+ tsc / vitest 实际输出
- **如实报告**:哪项没验、哪项不通过都要明说,不要报「应该没问题」


---

## 8. 实施结果(2026-08-08 回填)

三个 commit:`1a1e8ab5` resolveActiveViewId 抽取 / `d1b6238a` 广播收口 /
`3aabe642` per-slot 化。

### 与本文档诊断的偏差

| 项 | 诊断时的说法 | 实际 |
|---|---|---|
| `clearActiveSlot` 无调用点 | 验收时提出需补 | **已有调用**(`workspace-manager.ts` remove 内,commit `1f6280f6` 就加了),无需补 |
| `readingState` | 只说"要按槽拆" | 补充事实:该字段**只写不读**,恢复实际走 `entry.lastPosition`。仍按槽拆(理由见 commit) |
| blast radius | 11 个文件 | 实际 15 个 —— 多出 3 处**双开才暴露**的槽盲(✕ 关错栏 / 删书只清 left / PDF 右键取错书),诊断时未预见 |

### 新发现的已知局限

**右栏进全屏不腾空左栏**。腾左栏只能调 `closeLeft()`,而它触发 right→left
升级(铁律 7)→ 本实例 React key 从 `ebook-view:right` 变成 `ebook-view:left`
→ 实例重建 → 刚设的 `isFullscreen` 丢失,进全屏当场失效。
正解需要一个「不升级的腾空」原语,或把全屏改成覆盖层而非借 slot 布局 ——
属独立工作量,本次不做。现状:右栏进全屏 = 只占右半边 + 收 NavSide。

### 未验

§5.1 八项真机验收**一项未验** —— 无 GUI 自动化手段(项目无 Playwright 等),
只验证了 `npm start` 构建通过 + Electron 正常拉起。需人工过一遍,
第 3 项(左右开同一本书)专用于照出路线 A 会挂而路线 B 不挂。
