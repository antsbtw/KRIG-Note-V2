# Web 收尾:关闭按钮 + 下载持久化(NavSide 下载段实装 + 去工具栏图标)

> web 增强**最后一批**。两件事:① 加 web view「× 关闭」按钮(对齐 ebook)② 下载持久化 — 落盘 + NavSide 下载段实装(进行中+历史)+ 去工具栏下载图标。
> 做完整个 web 增强彻底完工,一次性全 merge。
> **在 `feat/web-downloads` 分支继续,不切新分支,不 merge/push。**

---

## 0. 工作纪律

1. cwd 敏感 Bash 必前缀 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`;Read 绝对路径。
2. memory:`feedback_no_fallback_bandaid_fixes`、`feedback_merge_requires_explicit_ok`、`feedback_main_console_not_in_devtools`。
3. **⚠️ 严禁源码写字面控制字符(NUL `\0`)**。写完 `file <路径>` 确认 "UTF-8 text"。
4. sandbox 拦 npm start → 用户跑。typecheck/单测自己跑。命令:typecheck=`npm run typecheck`,test=`npm run test`,lint=`npm run lint`。
5. 建议拆 2 commit:① 关闭按钮 ② 下载持久化。每个 commit 前 typecheck + 自测。做完 STOP 汇报。

---

## 1. 第一件:web view「× 关闭」按钮(对齐 ebook)

### 现状
- 其他 view 都有「× 关闭」(关当前 slot 的 view),web 缺。
- **照 ebook 模式(命令式),不照 note**(note 硬编码 closeLeft,web 可进 right slot 会误关)。

### 范本
- ebook 按钮:[EBookToolbar.tsx:439-446](src/views/ebook/EBookToolbar.tsx#L439)(toolbar 最右,onClick={onClose})。
- ebook onClose(**正确判 slot**):[EBookView.tsx:543-554](src/views/ebook/EBookView.tsx#L543):
  ```ts
  const onClose = useCallback(() => {
    const ws = workspaceManager.get(workspaceId);
    const bus = workspaceManager.getBus(workspaceId);
    if (ws.slotBinding.right === 'ebook-view') bus.slot.closeRight();
    else bus.slot.closeLeft();
  }, [workspaceId]);
  ```
- 通用底座:`bus.slot.closeLeft()` / `closeRight()`([slot-control.ts](src/slot/workspace-bus/slot-control.ts),closeRight 置 right=null;closeLeft 有 right 则升级 right→left,否则拒绝"最后一个不可关")。

### 实现
1. [WebView.tsx](src/views/web/WebView.tsx):加 `onClose`(复制 ebook,`'ebook-view'`→`'web-view'`)。
2. [WebToolbar.tsx](src/views/web/WebToolbar.tsx):props 加 `onClose: () => void`;actions 区**最右端**(语言下拉 ▾ 之后)加 `×` 按钮,复用 `krig-web-toolbar__btn` + 加 close 修饰类(可参考 ebook close 按钮样式)。
3. WebView 传 `onClose={onClose}`。

---

## 2. 第二件:下载持久化(存主进程 JSON 文件)

### 决策
- 存**主进程 JSON 文件**(复刻 [learning/vocab-store.ts](src/platform/main/learning/vocab-store.ts)):`{userData}/krig-data/web/downloads.json`。理由:done 事件在主进程产生,**同进程落盘无 IPC 时序丢失**(localStorage 方案有"done 时 NavSide 未 mount 就丢"的脆弱性)。
- NavSide 下载段**同时显进行中(进度+取消)+ 已完成历史**(像 Chrome 下载页)。
- **去掉工具栏下载图标**(全移 NavSide)。

### 现状
- [web-download/handler.ts](src/platform/main/web-download/handler.ts):done(L112-119)只 send 推 renderer + `active.delete(id)`,**元数据不落盘**。payload **不含 url**(要补 `item.getURL()`)。
- 会话级内存在 renderer:[WebDownloadBar.tsx:48](src/views/web/WebDownloadBar.tsx#L48) useState,关 app 清。
- NavSide 下载段是占位:[nav-side-content.tsx](src/views/web/nav-side-content.tsx) `PlaceholderSection icon="⬇" title="下载"`。

### 实现

**主进程:**
1. 新建 `src/platform/main/web-download/download-store.ts` — 复刻 vocab-store.ts。条目:`{ id, filename, url, savePath, total, completedAt, state }`(state: 'completed'|'cancelled'|'interrupted')。内存 Map 缓存 + atomic 写(tmp→rename)+ lazy load + 字段校验,照 vocab-store。
2. [handler.ts](src/platform/main/web-download/handler.ts) done 分支:`active.delete(id)` 前 `downloadStore.add({...})`,url 用 `item.getURL()`(WebDownloadEvent payload 也补 url 给进行中显示用)。只存终态。
3. 新建 `src/platform/main/web-download/handlers.ts`(仿 [learning/handlers.ts](src/platform/main/learning/handlers.ts)):
   - invoke `WEB_DOWNLOAD_LIST` → downloadStore.list()
   - invoke `WEB_DOWNLOAD_REMOVE`(id) → downloadStore.remove(id)
   - 推送 `WEB_DOWNLOAD_HISTORY_CHANGED`(broadcast 模式)→ NavSide 刷新
   - **注意**:现有 download `WEB_DOWNLOAD_ACTION`(cancel)的 handler 在哪注册的,grep 确认,新 handlers 别重复注册冲突。
4. 在 [ipc-bus.ts](src/platform/main/ipc/ipc-bus.ts) 注册(跟 registerLearningHandlers 平级)。

**channel + preload:**
- [channel-names.ts](src/shared/ipc/channel-names.ts):加 `WEB_DOWNLOAD_LIST` / `WEB_DOWNLOAD_REMOVE` / `WEB_DOWNLOAD_HISTORY_CHANGED`。
- preload + [electron-api.d.ts](src/shared/ipc/electron-api.d.ts):加 `webDownloadList()` / `webDownloadRemove(id)` / `onWebDownloadHistoryChanged(cb)`(onWebDownloadEvent / webDownloadAction / showItemInFolder 已就位)。

**渲染进程 NavSide 下载段实装:**
- [nav-side-content.tsx](src/views/web/nav-side-content.tsx):把下载 PlaceholderSection 换成 `DownloadSection`(包在 CollapsibleSection storeKey="download")。
- `DownloadSection`:**合并展示**
  - **进行中**:订阅 `onWebDownloadEvent`(started/progress/done,内存态),显文件名+进度条+取消(照现有 WebDownloadBar 逻辑迁过来)。
  - **已完成历史**:mount 调 `webDownloadList()` + 订阅 `onWebDownloadHistoryChanged` 刷新,每条:文件名 + 「在 Finder 显示」(`showItemInFolder(savePath)`)+ 「删除记录」(`webDownloadRemove(id)`,仅删记录不删磁盘文件,对齐 Chrome)。
  - 头部「清空」按钮(仿 HistorySection clearBtn)。
  - 进行中 done 后 → 落盘 → history-changed broadcast → 从进行中列表移到历史列表(去重:done 的 id 在历史出现就从内存进行中移除)。

**去工具栏图标:**
- [WebToolbar.tsx](src/views/web/WebToolbar.tsx):删 `{downloadSlot}`(actions 区)+ props `downloadSlot`。
- [WebView.tsx](src/views/web/WebView.tsx):删 `downloadSlot={<WebDownloadBar />}` + import。
- `WebDownloadBar.tsx`:整文件删除(进度/取消/Finder 逻辑迁进 DownloadSection)。

---

## 3. 文件清单

| 文件 | 改动 | 件 |
|---|---|---|
| `src/views/web/WebView.tsx` | onClose + 传给 toolbar;删 downloadSlot/WebDownloadBar import | ①② |
| `src/views/web/WebToolbar.tsx` | onClose prop + × 按钮;删 downloadSlot | ①② |
| `src/platform/main/web-download/download-store.ts` | **新增** 复刻 vocab-store | ② |
| `src/platform/main/web-download/handler.ts` | done 落盘 + payload 补 url | ② |
| `src/platform/main/web-download/handlers.ts` | **新增** list/remove/broadcast | ② |
| `src/platform/main/ipc/ipc-bus.ts` | 注册 handlers | ② |
| `src/shared/ipc/channel-names.ts` | 加 3 channel | ② |
| `src/platform/main/preload/main-window-preload.ts` + `electron-api.d.ts` | list/remove/onHistoryChanged | ② |
| `src/views/web/nav-side-content.tsx` | DownloadSection(进行中+历史) | ② |
| `src/views/web/WebDownloadBar.tsx` | **删除** | ② |
| `src/views/web/web.css` | × 按钮样式 + 下载段样式(可复用既有 download CSS) | ①② |
| `tests/...` | download-store 单测(add/list/remove)| ② |

**不动** bookmark/folder、web-history、其他 view、FolderTree。

---

## 4. 坑清单

1. **关闭按钮判 slot**:照 ebook 判 `slotBinding.right === 'web-view'`,不硬编码 closeLeft。
2. **下载落盘在主进程 done**:同进程无 IPC 丢失;payload 补 url。
3. **进行中 vs 历史去重**:done 后从内存进行中移除,避免和历史重复显示。
4. **WEB_DOWNLOAD_ACTION 别重复注册**:grep 现有 cancel handler 在哪,新 handlers.ts 别冲突。
5. **删记录 ≠ 删文件**:webDownloadRemove 只删 JSON 记录,不动磁盘文件(对齐 Chrome)。
6. **严禁字面控制字符**。
7. **vocab-store atomic 写**:照搬 tmp→rename,别简化成直接 writeFile(防写一半损坏)。
8. **broadcast 刷新**:历史变更要 broadcast,NavSide 才刷新。

---

## 5. 不做的事
- ❌ 关闭按钮不照 note 硬编码 closeLeft。
- ❌ 删记录不删磁盘文件。
- ❌ 不做暂停/继续(MVP)。
- ❌ 不写字面控制字符。
- ❌ 不 merge/push。

---

## 6. 验收 + 汇报

每 commit 前:typecheck PASS / download-store 单测过 / 现有单测无回归 / lint 改动文件 PASS / `file` 无 null 字节。

手动复现(给用户,完全退出重跑 npm start):
- **关闭按钮**:web toolbar 最右 × → 点击关闭 web view(在 left 关 left,在 right 关 right;最后一个 view 不可关)。
- **下载**:下载文件 → NavSide 下载段显**进行中**(进度+取消);完成 → 移到**历史**(在 Finder 显示/删记录);关 app 重开 → 历史**还在**(持久化);工具栏**无**下载图标了。

汇报模板:
```
Web 收尾(feat/web-downloads)— commit ①② 完成:
一、产出(commit hash)
二、关闭按钮(照 ebook 判 slot)
三、下载持久化(JSON store / done 落盘 / NavSide 进行中+历史 / 去工具栏图标)
四、踩坑(去重 / WEB_DOWNLOAD_ACTION 不冲突 / atomic 写)
五、验收(typecheck/单测/lint/file 无 null)
六、手动复现
七、整个 web 增强完工,等指挥全 merge
```

---

## 7. Self-Contained Check
- ✅ 关闭按钮 ebook 范本 + 实现(§1)
- ✅ 下载持久化 vocab-store 范本 + 链路(§2)
- ✅ 文件清单(§3)+ 8 坑(§4)
- ✅ 验收 + 汇报(§6)

**外部依赖**:用户 npm start 验证;指挥拍板全 merge。

---

*Web 收尾 · 2026-06-01 · feat/web-downloads · 关闭按钮(照 ebook)+ 下载持久化(JSON store + NavSide 进行中+历史 + 去工具栏图标)· web 增强最后一批*
