# 书签 步骤2:树 UI + 「+书签」「+文件夹」按钮

> 承接书签步骤1 数据层(commit 60a2a742,bookmark capability + FolderViewType 加 'web' 已就绪)。
> 本步把 NavSide「书签」占位段换成 **FolderTree 树**(照抄 ebook 书架 nav-side-content),加顶部 **「+书签」「+文件夹」** 按钮,支持文件夹分类 / 拖拽 / 重命名 / 右键菜单。
> **在 `feat/web-downloads` 分支继续,不切新分支,不 merge/push。**

---

## 0. 工作纪律

1. cwd 敏感 Bash 必前缀 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`;Read 绝对路径。
2. memory:`feedback_no_fallback_bandaid_fixes`、`feedback_merge_requires_explicit_ok`(commit 可,merge/push 等显式 OK)、`feedback-web-navside-vertical-toggle`(三段用垂直折叠,不用 tab)。
3. **⚠️ 严禁源码写字面控制字符(NUL `\0`)**。写完 `file <路径>` 确认 "UTF-8 text"。
4. sandbox 拦 npm start → 用户跑(完全退出重跑)。typecheck/单测自己跑。命令:typecheck=`npm run typecheck`,test=`npm run test`,lint=`npm run lint`。
5. 做完 typecheck + 自测 + commit → STOP 汇报。

---

## 1. 模板:照抄 ebook 书架(必读全文)

**动手前读这两个文件全文**——书签 UI 是它们的简化版:
- `src/views/ebook/nav-side-content.tsx` — **核心模板**:BookshelfPanel(FolderTree 用法 / buildChildren 组树 / handleDrop 拖拽 / commitRename 重命名 / handleKeyAction 键盘 / itemMeta 叶子显示)+ registerNavSide(actions 按钮)+ registerFolderTreeContextMenu(右键菜单)。
- `src/views/ebook/bookshelf-commands.ts` — encodeTreeId/decodeTreeId(区分 folder/item)+ command 注册(create-folder / rename / import 等)+ trigger 桥接(setRenameTrigger 等)。
- FolderTree 接口:`src/slot/shared-ui/FolderTree/FolderTree.tsx` + `types.ts`(TreeNode/FolderNode/ItemNode/KeyAction;itemMeta 返回 {icon,title,rightHint})。

**书签比 ebook 简单**:没有 import modal(managed/link 选择)、没有"重新定位/转管理"。书签的"导入"是步骤3(Chrome 导入),本步「+书签」是**手动加当前页/输入 URL**(见 §3.3)。

---

## 2. 步骤1 已就绪的数据层(本步消费)

- bookmark capability:`requireCapabilityApi<BookmarkApi>('bookmark')`,方法 add(url,title,folderId?)/list()/rename(id,title)/remove(id)/moveToFolder(id,folderId)/onListChanged。类型 [src/capabilities/bookmark/types.ts](src/capabilities/bookmark/types.ts)。
- folder capability:`requireCapabilityApi<FolderCapabilityApi>('folder')`,viewType **'web'** 已放行。listFolders('web')/createFolder/renameFolder/moveFolder/deleteFolder/onListChanged。
- BookmarkInfo 字段:`{ id, url, title, folderId, createdAt }`(以 types.ts 实际为准)。

---

## 3. 实现方案(步骤2)

### 3.1 web-bookmark-commands.ts(仿 bookshelf-commands)

新建 `src/views/web/web-bookmark-commands.ts`:
- `encodeTreeId(type:'bookmark'|'folder', id)` / `decodeTreeId(treeId)`(照搬 ebook,把 'book' 换 'bookmark')。
- command 注册 `registerWebBookmarkCommands()`:
  - `web-view.bm-create-folder`(根新建文件夹)→ `folderApi.createFolder('web', '新建文件夹', null)` → 触发重命名态
  - `web-view.bm-create-folder-in`(在某文件夹内新建,arg=folderId)
  - `web-view.bm-add`(加书签:当前活跃 tab 的 url+title,或弹输入框 — 见 §3.3)
  - `web-view.bm-rename`(arg=treeId)→ trigger
  - `web-view.bm-delete`(arg=treeId)→ folder/bookmark 分别 deleteFolder/remove
  - `web-view.bm-open`(arg=bookmark id)→ 取 url → `commandRegistry.execute('web-view.open-url', url)`
  - `web-view.bm-move-out`(arg=bookmark id)→ moveToFolder(id, null)
- trigger 桥接(setRenameTrigger / setFolderCreatedTrigger 等),仿 ebook。

### 3.2 nav-side-content.tsx 书签段换成 FolderTree

改 [src/views/web/nav-side-content.tsx](src/views/web/nav-side-content.tsx) 的书签占位段(`PlaceholderSection icon="📌"`)为 `<BookmarkSection/>`:
- `BookmarkSection` 仿 ebook BookshelfPanel,但**包在现有 CollapsibleSection 里**(保持垂直折叠,storeKey="bookmark")。
- 订阅:`bookmarkApi.list()` + `folderApi.listFolders('web')`,`onListChanged` 两条流都订阅(**ebook 教训**:漏订 folder 流 → 建文件夹后 UI 不刷新,见 ebook nav-side-content L102-111 注释)。
- buildChildren 组树:folder(parentId)+ bookmark(folderId),encodeTreeId 区分。bookmark 叶子 itemMeta:`{ icon:'🔖'(或 favicon), title: bookmark.title || url host, rightHint:'' }`。
- FolderTree props 照 ebook:nodes/selectedIds/onFolderToggle/itemMeta/onItemClick(打开 url)/onItemDoubleClick(重命名)/draggable/onDrop/onKeyAction/renaming*/contextMenuScope="web-view"。
- 拖拽 handleDrop:bookmark 走 `bookmarkApi.moveToFolder`,folder 走 `folderApi.moveFolder`(照 ebook,含 isDescendantFolder 防环)。
- 重命名 commitRename:bookmark 走 `bookmarkApi.rename`,folder 走 `folderApi.renameFolder`。

**per-ws 展开/选中态**:ebook 存在 ebook data-model(expandedFolders/selectedIds)。web 的 data-model 现在是 tab schema。**本步决策**:书签的展开/选中是 transient UI 态,**优先用组件内 useState**(简单,不持久化展开态也可接受,跟 note 的 transient 同性质);若要 per-ws 持久化展开态,再评估加 web data-model 字段。**先用组件 useState,汇报说明**(别为这个去动 tab schema 那条 hydrate cache 不变量)。

### 3.3 「+书签」「+文件夹」按钮

NavSide actions(就是用户截图要的,note/ebook 顶部那行):
- **方案**:CollapsibleSection 的 header 右侧(headerExtra)放「+书签」「+文件夹」两个小按钮(书签段展开时显示),点击 stopPropagation(不触发折叠)+ execute 对应 command。
  - 「+文件夹」→ `web-view.bm-create-folder`
  - 「+书签」→ `web-view.bm-add`
- **「+书签」加什么**:本步加"**当前活跃 tab 的 url + title**"(从 web data-model 取活跃 tab 的 url;title 用 tab 现有信息或 url host)。若当前没合适 url(about:blank),可弹一个简单输入框让用户输 url —— **MVP 先加当前 tab url,about:blank 时 no-op 或提示**,汇报说明。
- 注:NavSide registry 的 `actions` 字段是整个面板顶部的(view 级,note 的"+笔记 +文件夹"),但 web 是三段折叠、书签只是其中一段。**放 CollapsibleSection headerExtra 更合理**(按钮跟书签段绑定),不放面板顶部 actions。除非你(subagent)判断放面板顶 actions 更顺,汇报说明选择。

### 3.4 右键菜单(可选,本步可简化)

ebook 注册了一堆 folderTreeContextMenuRegistry 项(scope='ebook-view')。书签照做 scope='web-view',但**精简**:新建文件夹/在此新建子文件夹/重命名/移出文件夹/删除即可(去掉电子书特有的导入/重新定位/转管理)。**本步可先做核心几项,汇报说明**。

### 3.5 注册入口

[src/views/web/index.ts](src/views/web/index.ts):调 `registerWebBookmarkCommands()` + `registerFolderTreeContextMenu()`(若做了右键菜单)。registerNavSide 已有(批1),BookmarkSection 替换占位即可。

---

## 4. 文件清单(步骤2)

| 文件 | 改动 |
|---|---|
| `src/views/web/web-bookmark-commands.ts` | **新增** encodeTreeId/decodeTreeId + command 注册 + trigger 桥接 |
| `src/views/web/nav-side-content.tsx` | 书签占位段 → BookmarkSection(FolderTree)+ headerExtra 按钮 |
| `src/views/web/index.ts` | 调 registerWebBookmarkCommands(+ 右键菜单注册) |
| `src/views/web/web.css` | FolderTree 容器 / 按钮样式(FolderTree 自带 inline style,补容器即可) |
| (可能) `src/views/web/data-model.ts` | **仅当**决定持久化展开态才动(默认不动,用组件 useState) |

**不动** bookmark capability(步骤1 已成)、FolderTree 组件本身、data-model tab schema(除非 §3.2 决定持久化展开,先别动)、web-history/web-download。

---

## 5. 坑清单

1. **订阅两条流**(bookmark + folder 的 onListChanged)—— 漏 folder 流 → 建文件夹后 UI 不刷新(ebook 同款坑,L102-111 注释)。
2. **严禁字面控制字符**。
3. **encodeTreeId 区分 bookmark/folder** —— decodeTreeId 后按 type 分派(bookmark 走 bookmarkApi,folder 走 folderApi)。
4. **拖拽防环**:folder 拖进自己子孙要拦(照 ebook isDescendantFolder)。
5. **don't 动 tab data-model hydrate cache 不变量**(§3.2,展开态优先用组件 useState)。
6. **「+书签」url 来源**:从活跃 tab 取 url(web data-model 的 activeTabId → tab.url);about:blank 兜底。
7. **FolderTree 是受控组件**:重命名/选中/展开态都靠 props + 回调,view 自己接管落库(照 ebook)。

---

## 6. 不做的事
- ❌ 不做 Chrome 导入(步骤3)。
- ❌ 不改 FolderTree 组件本身 / bookmark capability。
- ❌ 不动 tab data-model hydrate cache(除非决定持久化展开态,先汇报)。
- ❌ 不写字面控制字符。
- ❌ 不 merge/push。

---

## 7. 验收 + 汇报

commit 前:typecheck PASS / 现有单测无回归 / lint 改动文件 PASS / `file` 确认无 null 字节。

手动复现(给用户,完全退出重跑 npm start):
1. 切 web view → NavSide 书签段展开 → 出现「+书签」「+文件夹」按钮 + 空树(emptyText)。
2. 点「+文件夹」→ 建文件夹 + 进重命名态 → 输名字回车。
3. 浏览某网页 → 点「+书签」→ 当前页加进书签(根或选中文件夹)。
4. 拖书签进文件夹 / 拖文件夹嵌套 → 落库刷新。
5. 双击书签重命名;点书签 → 右栏打开该 url;右键 → 菜单(删除等)。
6. **这步也是步骤1 数据层的集成验证**:能建/列/拖/删 = 数据层 + UI 都通。

汇报模板:
```
书签步骤2 树 UI(feat/web-downloads)完成:
一、产出(commit hash + 文件数)
二、实现要点(web-bookmark-commands / BookmarkSection 仿 ebook / headerExtra 按钮 / 「+书签」url 来源 / 展开态用组件 useState)
三、决策点(展开态持久化与否 / 按钮放 headerExtra vs 面板 actions / 右键菜单做了哪几项)
四、踩坑(两条流订阅 / 拖拽防环)
五、验收(typecheck/单测/lint/file 无 null 字节)
六、手动复现步骤(含步骤1 数据层集成验证)
七、等指挥:进步骤3(Chrome 导入)?
```

---

## 8. Self-Contained Check
- ✅ ebook 模板必读清单(§1)+ 步骤1 已就绪数据层(§2)
- ✅ commands / BookmarkSection / 按钮 / 右键菜单方案(§3)
- ✅ 文件清单(§4)+ 7 坑(§5)
- ✅ 验收(含数据层集成验证)+ 汇报(§7)

**外部依赖**:用户 npm start 验证(建/拖/删书签,顺带验步骤1 数据层);指挥拍板进步骤3。展开态持久化 / 按钮位置 / 右键菜单范围,实现时判断 + 汇报。

---

*书签步骤2 树 UI · 2026-06-01 · feat/web-downloads · FolderTree 照抄 ebook 书架 + 「+书签」「+文件夹」按钮 · 复用步骤1 bookmark capability*
