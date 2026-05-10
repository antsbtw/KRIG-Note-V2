# L5-C1 ebook 平台基座 + library capability + view 骨架 完成报告

> 阶段:L5-C1 — V1 → V2 ebook 迁移第 1 段(共 5 段 C1~C5)
> 分支:`feature/L5C1-ebook-platform-base`
> 起草日期:2026-05-09
> 设计:[../v1-ebook-migration-plan.md](../v1-ebook-migration-plan.md) v0.3 § 5 C1
> 业务规格:[../../10-business-design/ebook/EBookView-设计.md](../../10-business-design/ebook/EBookView-设计.md)

---

## 0. 完成清单

### Commit 1 — feat(platform):main 侧 ebook 后端(89ae4ef)

| 项 | 实际 | 状态 |
|---|---:|---|
| `src/platform/main/ebook/bookshelf-store.ts`(NEW,V1 JSON 直迁 + atomic write)| 392 行 | ✅ |
| `src/platform/main/ebook/annotation-store.ts`(NEW,V1 直迁)| 125 行 | ✅ |
| `src/platform/main/ebook/file-loader.ts`(NEW,V1 直迁)| 49 行 | ✅ |
| `src/platform/main/ebook/library-handlers.ts`(NEW,V1 IPC 改写)| 307 行 | ✅ |
| `src/shared/ipc/channel-names.ts`(改 — 加 25 条 `EBOOK_*`)| +32 行 | ✅ |
| `src/platform/main/preload/main-window-preload.ts`(改 — 加 28 个 ebook* invoke + on*)| +96 行 | ✅ |
| `src/shared/ipc/electron-api.d.ts`(改 — 同步类型,unknown 边界)| +44 行 | ✅ |
| `src/platform/main/ipc/ipc-bus.ts`(改 — 接进 registerEBookHandlers)| +2 行 | ✅ |

### Commit 2 — feat(capabilities,view):ebook-library capability + EBookView 骨架(d8389fa)

| 项 | 实际 | 状态 |
|---|---:|---|
| `src/capabilities/ebook-library/types.ts`(NEW)| 170 行 | ✅ |
| `src/capabilities/ebook-library/index.ts`(NEW,IPC 客户端 + Registry 注册)| 287 行 | ✅ |
| `src/capabilities/ebook-library/DESIGN.md`(NEW)| 102 行 | ✅ |
| `src/views/ebook/index.ts`(NEW,registerView + 注册菜单)| 39 行 | ✅ |
| `src/views/ebook/EBookView.tsx`(NEW,骨架主组件)| **81 行 ≤150~200 红线** ✅ | ✅ |
| `src/views/ebook/data-model.ts`(NEW,pluginStates 形状)| 161 行 | ✅ |
| `src/views/ebook/nav-side-content.tsx`(NEW,书架面板 + 文件夹树 + ImportModal)| 640 行 | ✅ |
| `src/views/ebook/bookshelf-commands.ts`(NEW,ebook-view.* 9 commands + 桥接器)| 145 行 | ✅ |
| `src/views/ebook/ebook.css`(NEW,主组件薄壳样式)| 73 行 | ✅ |
| `src/platform/renderer/index.tsx`(改 — import capability + view)| +2 行 | ✅ |

### Commit 3 — docs(L5-C1):completion + state-snapshot 入表(本)

总:**~2747 行新增**(对齐设计 v0.3 § 5 C1 估算 "~600 driver + ~150 CSS";实际偏多因 IPC handlers + preload + electron-api 类型这部分原 estimate 没单独计 LOC,加上 nav-side-content 完整的 ImportModal + 8 项右键菜单 + toast UI)。

---

## 1. 实际改动 vs 设计

### 1.1 完全照设计

- **D-3=B JSON 起步**:沿用 V2 既有 `learning/vocab-store` / `media-storage` 的 atomic write tmp+rename 模板;持久化路径 `{userData}/krig-data/ebook/`(对齐 V2 命名)
- **D-4=B 过渡态**:platform/main/ebook 下放,带退出条件(C5 验收 + 稳定 ≥2 周 + W6 SurrealDB 客户端 epic 落地)
- **D-2=A pluginStates**:activeBookId / expandedFolders / readingState 走 `pluginStates['ebook-view']`,renderer 端 `workspaceManager.update()` 直写,**不需 IPC**(精简 V1 的 `EBOOK_SET_ACTIVE_BOOK / EBOOK_SET_EXPANDED_FOLDERS` 两条 channel)
- **D-7=A thumbnail base64 inline**:annotation 数据模型 `thumbnail?: string` 字段,不挂 media://
- **D-5 重新定位**:platform 侧 `bookshelfStore.relocate()` + `EBOOK_BOOKSHELF_RELOCATE` channel + 命令 + 右键菜单项三件套就位
- **D-1 view 命名**:实施时确认 V2 实际惯例 `*-view`(`note-view` / `web-view`),从 v0.3 字面 `ebook` 微调为 **`ebook-view`**(目录名仍 `views/ebook/`,对齐现有结构)
- **W5 严格态 A 边界**:view 通过 `requireCapabilityApi` 间接路由;capability 双导出(模块级 + api 字段);driver/slot 暂无消费者

### 1.2 微调

| 项 | 设计 | 实际 | 理由 |
|---|---|---|---|
| view-id | `ebook` | `ebook-view` | 对齐 V2 现状(note-view / web-view),v0.3 § 3.5 IPC 表已用 `ebook.<动作>`,view-id 跟 IPC 命名空间无冲突;目录名仍 `views/ebook/` |
| renderer 入口 capability 显式拉 | 设计未列细节 | 加 `import '@capabilities/ebook-library'` | 对齐 learning P1 审计修正模式 — 即使 view install 列表声明,也得 renderer 显式拉 capability 副作用,确保 register 早于 install 校验 |
| nav-side-content 的 selectedIds 订阅 | data-model 完整 transientVersion 订阅 | 仅依赖 ws 引用变化,WeakMap 失效 hydrate(单 click 操作不滞后)| C1 简化,如 C5 验收时发现实际有问题再补 transientVersion 订阅(对齐 note-view) |
| Outline / Search bar / FixedPageContent / ReflowableContent | C1 不做 | 留 C2~C3 | 对齐设计 v0.3 § 5 切片 |
| OCR / Toolbar / 锚定同步 | C1 不做 | 留 C5 / C2~C5 / 单独阶段 | D-12=A / D-9=B |

### 1.3 砍掉 / 推迟

| 项 | 原 V1 实现 | C1 处置 |
|---|---|---|
| Application Menu "Open eBook"(Cmd+O) | V1 `register.ts` 内挂菜单 | C1 不做(V2 现状无 menu-registry 框架接,留 C2 或 C5 一并加;NavSide "+导入" 已是主入口)|
| `EBOOK_SET_ACTIVE_BOOK / EBOOK_SET_EXPANDED_FOLDERS` IPC | V1 走 main 侧 workspaceManager 持久化 | D-2=A 改 renderer 直写 pluginStates,2 条 IPC 不要了 |
| `EBOOK_RESTORE`(启动恢复 IPC)| V1 menu/main 侧拉上次书自动加载 | C1 改成 view 端订阅 onBookOpened + 默认空状态;若需启动自动恢复,可在 C2 main 端补一条;暂留 channel 名预留位 |
| `ProtocolRegistry` 协议匹配(note↔ebook / ebook↔web 等)| V1 `register.ts` 注册 7 协议 | V2 走 workspace-bus,无协议表概念,锚定同步留 D-9=B 单独阶段 |
| useEpubAnnotation / useBookmarks / useSearch 三个 hooks | V1 在 plugins/ebook/hooks/ | 留 C2~C4(进 ebook-rendering capability)|

---

## 2. 完成判据

- ✅ `npm run typecheck` 全绿(0 error)
- ✅ `npm run lint --max-warnings 0` 全绿(0 error 0 warning)
- ⚠️ `npm start` UI 验收:**需要用户实跑**(Claude 无 UI 能力,本段 LOC 模板沿用 B3.19.e 等既有模式)— 详见 § 3 验收清单

---

## 3. C1 验收清单(本段单独验收,对齐 v0.3 § 5 C1 表的 "验收" 列)

### 3.1 启动 + 视图切换

1. `npm start` → console 无报错
2. WorkspaceBar 显示 ws-1 + 切换器
3. NavSide ViewSwitcher 出现 3 个 tab:📝 Note / **📕 eBook**(NEW)/ 🌐 Web,顺序对(Note=1 / eBook=2 / Web=3)
4. console 应见 install-coverage 输出 `ebook-view × ['ebook-library']`,无 missing
5. console 应见 capabilityRegistry 注册数为 12(原 11 + ebook-library)

### 3.2 切到 ebook view

6. 点击 NavSide tab "📕 eBook" → 主区显空状态:
   - 📕 大图标
   - "在左侧书架中选择电子书"
   - "或点击 NavSide 顶部 + 导入"
7. NavSide 顶部显:
   - 标题"书架"
   - 两个 action 按钮 `+ 文件夹` / `+ 导入`
   - 搜索框 placeholder "搜索书库..."
8. NavSide 主区空:"点击上方 + 导入 添加电子书"

### 3.3 导入 PDF / EPUB(D-7=A 默认 managed)

9. 点 `+ 导入` → 弹文件对话框
10. 选一份 .pdf 文件 → 文件对话框关 → 弹 ImportModal:
    - 显文件名(📄 ...pdf)
    - 默认选中"拷贝到 KRIG 管理(推荐)"(managed)
    - 副选项"链接原文件"(link)
11. 点"导入" → ImportModal 关
12. NavSide 书架出现该书条目(显示文件名 + "刚刚")
13. 主区从空状态变为占位:"已加载: <fileName>"(C1 仅 console + UI 占位,C2 起 Host 接管渲染)
14. 验证文件落盘:`{userData}/krig-data/ebook/library/{uuid}.pdf` 已生成
15. 验证元数据落盘:`{userData}/krig-data/ebook/bookshelf.json` 含该 entry,storage='managed'
16. 切换 link 模式重做一次:bookshelf.json 的 entry storage='link',library/ 不增文件

### 3.4 文件夹树 + 拖拽 + 右键

17. 点 `+ 文件夹` → 根目录出现"新建文件夹"且自动进入 inline rename 态
18. 输入"学术论文" → Enter 提交
19. 把已导入的 PDF 拖到"学术论文" → 落入文件夹下
20. 点击文件夹 toggle → 折叠/展开生效
21. 右键空白处 → 显:`新建文件夹` / —— / `导入电子书…`
22. 右键文件夹 → 显:`在此新建文件夹` / —— / `重命名` / —— / `删除`
23. 右键书项(在文件夹内)→ 显:`重命名` / `移出文件夹` / `重新定位…` / `拷贝到 KRIG 管理`(link 模式才有意义)/ —— / `删除`
24. 点书项 → 主区从占位变为对应书"已加载"占位 + console 见 `[ebook-view] onBookOpened: { bookId, fileName, fileType }`

### 3.5 重启恢复(D-2=A pluginStates 验证)

25. 切到 ebook,选某书,展开某文件夹
26. 完全退出 app(Cmd+Q)
27. 重新 `npm start`
28. 应自动停留在 ebook view(activeViewId 持久化)
29. NavSide 文件夹展开状态保留(expandedFolders 持久化)
30. activeBookId 持久化(C2 起,Host 会自动加载;**C1 仅看到占位仍显示当时书名 = 不需要,activeBookId 仍生效但 main 侧重启后 currentFile=null,view 主区显占位但 onBookOpened 未触发**)

### 3.6 多 Workspace 隔离(D-2 + 全局书架)

31. 创建 ws-2 → 切到 ws-2 → 切 ebook view → NavSide 显**同一份书架**(全局共享)
32. 在 ws-2 打开另一本书 → ws-1 切回 → activeBookId 各自记忆(per-ws),**互不影响**

### 3.7 失败路径

33. 删除 link 模式书的源文件(在 Finder 删 .pdf)→ 在 NavSide 点该书 → 弹 toast"无法打开「<name>」:源文件已丢失..."
34. 右键该书 → "重新定位…" → 选新位置 → toast 消失,再点能打开

### 3.8 工程纪律

35. `npm run typecheck` 0 error
36. `npm run lint --max-warnings 0` 0 error 0 warning
37. `grep -rn "from 'pdfjs-dist\|from 'foliate-js\|from 'epubjs" src/views/ src/shell/ src/workspace/ src/slot/` 应 0 命中(屏障验证)
38. `grep -rn "from '@capabilities/ebook-library'" src/views/ebook/` 仅类型 import,无运行时直引(W5 严格态 A 边界)

---

## 4. 已知短板

### 4.1 UI 占位组件不渲染真内容

C1 仅骨架 — 主区显示"已加载: xxx" 占位文字,**没有 PDF 渲染**。C2 接 ebook-rendering capability 才出 Canvas 渲染。

### 4.2 重启不触发 onBookOpened 自动恢复

main 侧 currentFile 是内存单例,重启后清零。activeBookId 持久化但 view 不会自动调 `library.open(activeBookId)`。**C2 接 Host 时让 Host 在 mount 时检测 activeBookId → 自动 open**。

### 4.3 移出文件夹 / 重新定位 / 转托管 菜单项过滤不精确

`enabledWhen` 没访问到 book 的 folderId / storage 字段(folderTreeContextMenu ctx 只有 targetId 一类基础信息)。当前是宽松显示,用户点击会无操作或直接生效(`moveToFolder(id, null)` / `relocate(id)` 都幂等)。**C5 验收阶段如真有体验问题再加 ctx.extra 字段**(对齐 note-view `contextMenuCtxExtra` 模式)。

### 4.4 selectedIds 单击操作没 transient 订阅

C1 简化,wsState.selectedIds 通过 hydratedCache 失效拿,跨组件不实时同步。**实测如有问题(多选删除等)再补 transientVersion 订阅**。

### 4.5 NavSide 搜索框暂不过滤

C1 `onSearch` 是 noop。**留 C3+ 全文搜索段统一做 — 跟书内 Cmd+F 复用机制**。

### 4.6 Application Menu Open eBook(Cmd+O)未挂

V1 有 Cmd+O 走菜单导入。V2 现状无 menu-registry 框架接 — 留 C2 或 C5 一并加。NavSide "+导入" 是主入口,缺这个不阻塞。

### 4.7 EBOOK_RESTORE 等若干 IPC 未消费

`EBOOK_RESTORE / EBOOK_BOOKSHELF_REMOVE / EBOOK_BOOKSHELF_TRANSFER` 等 channel 已建但 view 端在 C1 阶段不全消费(没启动恢复入口、删除从右键菜单走 `ebook-view.delete` 命令)。**留作下游消费,无副作用**。

---

## 5. v0.3 文档微调登记

| 项 | v0.3 字面 | 实际实施 | 影响 |
|---|---|---|---|
| view-id | `ebook` | `ebook-view` | 对齐 V2 现状(note-view / web-view);IPC 命名 `ebook.*` 不变;目录 `views/ebook/` 不变 |

下次 v0.4 修订时建议把 D-1 推荐项改为 `ebook-view`(B 选项扶正),理由:V2 实际 view-id 命名约定。

---

## 6. 下一步(C2)

按设计 v0.3 § 5 C2 切片:

- 新建 `src/capabilities/ebook-rendering/` capability(types + Host + pdfjs-dist 4.9.155 锁版)
- pdf renderer + fixed-page-content(虚拟滚动 + Canvas 渲染)
- view 端接 Host:订阅 onBookOpened → Host.openBookEntry → 显示真内容
- EBookToolbar(导航 + 缩放 + 适应宽度,~250 行 V1 Toolbar 直迁缩水)
- EBookView 主组件由 81 行 → ~150 行(接 Host + Toolbar 编排)

工作量预估:~1200 driver + ~300 CSS,直迁约 80%。

---

## 7. 工作流约定

按 B3.19 / 总设计沿用模式:**段间不单独 user 验收**(本 § 3 是建议性自查清单),C5 段后给完整 C1~C5 整体验收清单。如本段实测发现严重问题,可针对性 fix(1-2 commit)。

如 C1 → main merge 后用户实测发现严重 bug(无法打开 / 无法导入 / 启动崩溃等),走 fix branch 修补;若架构问题,回退后修订 v0.4 文档再来。
