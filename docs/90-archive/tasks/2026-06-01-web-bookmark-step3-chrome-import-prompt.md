# 书签 步骤3:Chrome 书签导入

> 承接书签步骤1 数据层(commit 60a2a742)+ 步骤2 树 UI(200ebd73 等)。本步是书签大工程**最后一步**。
> 从 Chrome 的 `Bookmarks` JSON 文件导入书签 + 文件夹,**完整保留 Chrome 文件夹层级**,落库到 bookmark/folder capability。
> 入口:**File 菜单**加 "Import Chrome Bookmarks..."(跟 Import Markdown/Word 并排)。
> **在 `feat/web-downloads` 分支继续,不切新分支,不 merge/push。**

---

## 0. 工作纪律

1. cwd 敏感 Bash 必前缀 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`;Read 绝对路径。
2. memory:`feedback_no_fallback_bandaid_fixes`、`feedback_merge_requires_explicit_ok`、`feedback_main_console_not_in_devtools`(主进程 log 终端 stdout)、`feedback_surrealdb_4x_no_type_thing`(若碰 SQL — 但本步走 capability,不直接写 SQL)。
3. **⚠️ 严禁源码写字面控制字符(NUL `\0`)**。写完 `file <路径>` 确认 "UTF-8 text"。
4. sandbox 拦 npm start → 用户跑。typecheck/单测自己跑。命令:typecheck=`npm run typecheck`,test=`npm run test`,lint=`npm run lint`。
5. 做完 typecheck + 自测 + commit → STOP 汇报。

---

## 1. 用户已拍板决策

| 决策 | 选择 |
|---|---|
| 选文件 | **自动找 Chrome 默认路径,找不到再弹 dialog 手选** |
| 导入结构 | **完整保留 Chrome 文件夹层级**(bookmark_bar / other 下的 folder 树原样建) |
| 入口 | **File 菜单** "Import Chrome Bookmarks..."(不新增 Web 菜单,跟现有 import 项并排) |

---

## 2. Chrome Bookmarks 文件格式(要解析的)

- **默认路径**(macOS):`~/Library/Application Support/Google/Chrome/Default/Bookmarks`(无扩展名,内容是 JSON)。用 `app.getPath('home')` + 拼路径,或 `os.homedir()`。
- **结构**:
  ```json
  {
    "roots": {
      "bookmark_bar": { "type": "folder", "name": "书签栏", "children": [...] },
      "other":        { "type": "folder", "name": "其他书签", "children": [...] },
      "synced":       { "type": "folder", ... }   // 可能有
    }
  }
  ```
- 每个节点:`type: 'url' | 'folder'`,`name`(标题),url 节点有 `url` 字段,folder 节点有 `children: [...]`。
- 解析逻辑:递归走 children,folder → 建 folder atom(viewType='web'),url → 建 bookmark atom 挂到对应 folder。

---

## 3. 模板(现成链路)

- **dialog 选文件**:[ebook/library-handlers.ts:86-104](src/platform/main/ebook/library-handlers.ts#L86)(EBOOK_PICK_FILE:ipcMain.handle + dialog.showOpenDialog + 返路径)。
- **fs 读 + 解析 + 落库链路**:[markdown-import/index.ts:36-65](src/platform/main/markdown-import/index.ts#L36)(dialog + fs 读 + 解析 + webContents.send 广播)。
- **File 菜单加项**:[framework-menus.ts:55-57](src/platform/main/menu/framework-menus.ts#L55) 现有 import 项模板;[:50-62](src/platform/main/menu/framework-menus.ts#L50) File 菜单 items 数组;命令注册用 `menuRegistry.registerCommand('file.import-chrome-bookmarks', handler)`(L17 模式)。
- **落库**:步骤1 的 bookmark capability(`bookmarkApi.add(url, title, folderId)`)+ folder capability(`folderApi.createFolder(title, parentId, 'web')`)。**注意**:capability 在渲染进程(`requireCapabilityApi`),但**主进程也有对应的 main 端实现**(`src/platform/main/bookmark/capability-impl.ts` / `src/platform/main/folder/capability-impl.ts`)—— 导入在主进程做,**直接调 main 端 capability-impl 的函数**(不绕 IPC 回渲染),最后 broadcast onListChanged 让 UI 刷新。grep 确认 main 端 impl 导出的函数名。

---

## 4. 实现方案

### 4.1 Chrome 解析纯函数(可单测)

新建 `src/platform/main/bookmark/chrome-import.ts`:
- `parseChromeBookmarks(json: unknown): { folders: ParsedFolder[]; bookmarks: ParsedBookmark[] }` 纯函数:
  - 递归走 `roots.bookmark_bar` / `roots.other` /(`synced` 若有)的 children。
  - folder 节点 → ParsedFolder `{ tempId, name, parentTempId }`(tempId 是解析时临时 id,落库后映射真实 folder id)。
  - url 节点 → ParsedBookmark `{ url, title, parentTempId }`。
  - **顶层 roots(bookmark_bar/other)本身**:可作为顶层 folder 建("书签栏"/"其他书签"),或其 children 直接进根 —— **建议把 bookmark_bar/other 作为两个顶层 folder 建**(保留 Chrome 结构),其下递归。汇报说明选择。
  - 纯函数不碰 fs / capability,**写单测**覆盖:嵌套 folder、url 节点、空 folder、缺字段兜底。

### 4.2 主进程导入 handler

新建/扩 `src/platform/main/bookmark/chrome-import.ts`(或 handlers.ts)的导入流程函数 `importChromeBookmarks(mainWindow)`:
1. 解析默认路径 `~/Library/Application Support/Google/Chrome/Default/Bookmarks`;`fs.existsSync` 检查。
2. 不存在 → `dialog.showOpenDialog`(让用户选 Bookmarks 文件;filters 可不限或 `[{name:'Bookmarks',extensions:['*']}]`,Chrome 文件无扩展名)。用户取消 → 中止。
3. `fs.readFile` 读 JSON → `JSON.parse` → `parseChromeBookmarks`。
4. **落库**(主进程直接调 main 端 capability-impl,保留层级):
   - 先建所有 folder(按层级顺序,parent 先建),维护 `tempId → realFolderId` 映射。
   - 再建所有 bookmark,folderId 用映射后的真实 id。
   - 用 main 端 folder capability-impl 的 createFolder + bookmark capability-impl 的 add(grep 确认函数签名)。
5. 完成 → broadcast(folder + bookmark 的 onListChanged 对应 main 端 broadcast)让 NavSide UI 刷新。
6. 失败(JSON 损坏 / 路径无权限)→ 主进程 log + 可选 dialog 提示,别崩。

### 4.3 File 菜单加项

[framework-menus.ts](src/platform/main/menu/framework-menus.ts):
- `registerCommand('file.import-chrome-bookmarks', () => importChromeBookmarks(BrowserWindow.getFocusedWindow()))`(L17 区)。
- File 菜单 items(L54-61)加 `{ id: 'import-chrome-bookmarks', label: 'Import Chrome Bookmarks...', command: 'file.import-chrome-bookmarks' }`(放 import-word-pandoc 后、sep-backup 前)。

---

## 5. 文件清单(步骤3)

| 文件 | 改动 |
|---|---|
| `src/platform/main/bookmark/chrome-import.ts` | **新增** parseChromeBookmarks 纯函数 + importChromeBookmarks 流程(dialog/fs/落库/broadcast)|
| `src/platform/main/menu/framework-menus.ts` | registerCommand + File 菜单加项 |
| `tests/...` | parseChromeBookmarks 单测(嵌套/url/空folder/兜底)|
| (可能) `src/platform/main/bookmark/capability-impl.ts` | 若 main 端没导出可复用的 add/createFolder 给导入用,可能要小调(优先复用,grep 确认)|

**不动** bookmark capability 数据模型(步骤1 已成)、nav-side-content/web-bookmark-commands(步骤2 已成,导入靠 broadcast 自动刷新)、FolderTree、其他 view。

---

## 6. 坑清单

1. **主进程直接调 capability-impl,不绕 IPC**:导入在主进程,bookmark/folder 的 main 端 impl 函数直接调。grep 确认 capability-impl.ts 导出的函数(add/createFolder/listFolders 等)+ broadcast 机制。
2. **层级顺序**:先建 parent folder 再建 child(parentTempId 映射真实 id);bookmark 在 folder 都建完后建。
3. **broadcast 刷新**:导入完必须触发 folder + bookmark 的 onListChanged broadcast,否则 NavSide 不刷新(ebook 同款坑)。grep main 端怎么 broadcast 的。
4. **严禁字面控制字符**。
5. **Chrome 文件无扩展名**:dialog filters 别只放具体扩展名挡住 Bookmarks 文件。
6. **JSON 健壮性**:Chrome 文件可能版本差异/字段缺失,parseChromeBookmarks 兜底(缺 children 当空、缺 name 用 url host、非 url/folder type 跳过)。
7. **重复导入**:多次导入会重复建(本步 MVP 不去重,汇报登记;用户可手动删)。
8. **路径权限**:读 ~/Library 可能需权限,失败别崩,提示用户手选。

---

## 7. 不做的事
- ❌ 不去重(重复导入产生重复书签,MVP 接受,登记)。
- ❌ 不支持其他浏览器(只 Chrome,Edge/Firefox 格式不同,未来)。
- ❌ 不改 bookmark/folder 数据模型 / 步骤2 UI。
- ❌ 不写字面控制字符。
- ❌ 不 merge/push。

---

## 8. 验收 + 汇报

commit 前:typecheck PASS / parseChromeBookmarks 单测过 / 现有单测无回归 / lint 改动文件 PASS / `file` 确认无 null 字节。

手动复现(给用户,完全退出重跑 npm start):
1. File 菜单 → "Import Chrome Bookmarks..." → 自动读 Chrome 默认书签(或弹 dialog 手选)。
2. 导入后 → 切 web view → NavSide 书签段出现 Chrome 的文件夹结构 + 书签(层级保留)。
3. 点导入的书签 → 右栏打开;拖动/重命名/删除照常(步骤2 能力)。
4. (无 Chrome 或路径不存在)→ 弹 dialog 手选 Bookmarks 文件 → 同样导入。

汇报模板:
```
书签步骤3 Chrome 导入(feat/web-downloads)完成:
一、产出(commit hash + 文件数)
二、实现要点(parseChromeBookmarks 解析 / 默认路径+兜底手选 / 主进程直调 capability-impl 落库保留层级 / File 菜单项 / broadcast 刷新)
三、决策点(bookmark_bar/other 作顶层 folder vs children 进根 / 去重与否)
四、踩坑(层级顺序 / broadcast / 无扩展名 filter / JSON 兜底)
五、验收(typecheck/单测/lint/file 无 null 字节)
六、手动复现步骤
七、等指挥:书签大工程完成,是否进剩余的「下载持久化」批 + 最终全 merge?
```

---

## 9. Self-Contained Check
- ✅ 用户 3 决策(默认路径+兜底 / 保留层级 / File 菜单)
- ✅ Chrome 格式(§2)+ 现成链路模板(§3)
- ✅ 解析纯函数 + 导入流程 + 菜单项方案(§4)
- ✅ 文件清单(§5)+ 8 坑(§6)
- ✅ 验收 + 汇报(§8)

**外部依赖**:用户 npm start 验证(真导入 Chrome 书签);指挥拍板进剩余下载持久化批 + 全 merge。main 端 capability-impl 导出函数名实现时 grep 确认。

---

*书签步骤3 Chrome 导入 · 2026-06-01 · feat/web-downloads · parseChromeBookmarks + 保留层级 + File 菜单入口 · 主进程直调 capability-impl 落库*
