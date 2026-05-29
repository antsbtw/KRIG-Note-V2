# 导入体系调研报告（2026-05-28）

> 调研对象：V2 main HEAD 7476cfb1（= 3263b37f + 1 个 docs-only commit "import system survey prompt for subagent"，源码状态与 3263b37f 等同）。
> 产出方式：只读 + grep，不切分支、不改源码、不连 DB。
> 范围：节 1 写库入口清单；节 2 转换链路；节 3 web JSON 导入；节 4 数据契约；节 5 table bug 根因；节 6 反模式；节 7 重做必答题。

---

## 节 1：所有写库入口清单

### 1.1 经由 `noteCap()` 的 4 个写 API

主进程实现：[capability-impl.ts:162](src/platform/main/note/capability-impl.ts#L162)（createNote）/ [capability-impl.ts:421](src/platform/main/note/capability-impl.ts#L421)（updateNote）/ [capability-impl.ts:462](src/platform/main/note/capability-impl.ts#L462)（moveNote）/ [capability-impl.ts:485](src/platform/main/note/capability-impl.ts#L485)（deleteNote）。

IPC 桥：[handlers.ts:33-90](src/platform/main/note/handlers.ts#L33)（NOTE_CREATE / NOTE_UPDATE / NOTE_MOVE / NOTE_DELETE handler）。Renderer 薄包装：[capabilities/note/index.ts:41-67](src/capabilities/note/index.ts#L41)。

#### createNote 调用点

| # | 位置 | 触发场景 | doc 产出方式 | block 是否带 `attrs.id` |
|---|---|---|---|---|
| 1 | [views/note/data-model.ts:161](src/views/note/data-model.ts#L161) | 用户在 NavSide / 快捷键新建空 note（命令 `note-view.create-note`，[note-commands.ts:108](src/views/note/note-commands.ts#L108)） | `textEditing.createEmptyDoc()` → [drivers/text-editing-driver/index.ts:44](src/drivers/text-editing-driver/index.ts#L44)：用 `buildSchema([paragraphSpec])` 走 PM schema 实例化首块 isTitle paragraph | 单个 paragraph 的 `attrs.id = null`（schema default）。**实际 ULID 由 createNote 内 `injectIdsForCreate` 在 dissect 前补**（capability-impl.ts:171 / 250-278）|
| 2 | [views/note/markdown-import.ts:526](src/views/note/markdown-import.ts#L526) | File → Import Markdown / Import Word（mammoth / pandoc）后 renderer 端落地 | `markdownToProseMirror(md)` 出裸 PMNode[] → `ensureLeadingTitle` 前置 isTitle 段 → `{ format:'pm-doc-json', version:'0.1', payload:{type:'doc', content:[...]} }` | **不带 `attrs.id`**。靠 createNote → `injectIdsForCreate` 补 |
| 3 | [views/note/extraction-import.ts:152](src/views/note/extraction-import.ts#L152) | 主进程 `KRIG_IMPORT:` console-message → 广播 EXTRACTION_NOTE_CREATE → view 端 hook 调 | `tea.sanitizeAtoms(atoms)` → `tea.atomsToProseMirror({atoms:cleaned})` 出 PMNode[]，封 doc | atoms-to-pm 出口归一化加 `attrs.id: null` 占位（[atoms-to-pm.ts:578-589](src/capabilities/text-editing/converters/atoms-to-pm.ts#L578)），由 createNote `injectIdsForCreate` 补真 ULID |
| 4 | [views/note/tree-operations.ts:183](src/views/note/tree-operations.ts#L183) | 剪贴板粘贴单个 note（`pasteNote`） | `JSON.parse(JSON.stringify(src.doc))` 深拷贝（源 doc 来自 `noteCap().listNotes()`，已含 ULID） | **带 id**（旧的，等同于 paste 携运），由 plugin/inject 路径中重复检测时再生成新 ULID |
| 5 | [views/note/tree-operations.ts:236](src/views/note/tree-operations.ts#L236) | 剪贴板粘贴 folder 树（`pasteFolderTree` 递归内 note 拷贝） | 同 #4 | 同 #4 |

#### updateNote 调用点

| # | 位置 | 触发场景 | doc 产出方式 | id |
|---|---|---|---|---|
| 1 | [views/note/data-model.ts:185](src/views/note/data-model.ts#L185)（被 [NoteView.tsx:114](src/views/note/NoteView.tsx#L114) `handleDocChange` 调） | 用户 PM editor 内编辑触发 onChange | PM Host 走 `serializeDoc(state.doc)` 直出 DriverSerialized，已通过 `buildAutoBlockIdPlugin` 注入 id | 全带 |
| 2 | [views/note/data-model.ts:220](src/views/note/data-model.ts#L220)（`renameNote`） | 用户重命名 note（反写首段文本） | `JSON.parse` 深拷贝 + 改首段 text 节点 | 全带（沿原 doc） |
| 3 | [platform/main/ebook/capability-impl.ts:709](src/platform/main/ebook/capability-impl.ts#L709) | `addReadingThoughtBlock`（划线 / 框选 → reading-thought doc 加 block） | 手工拼新 block + 已有 doc.content 拼接 | 手工生成 ULID（`generateUlid()`）注 `attrs.id` |
| 4 | [platform/main/ebook/capability-impl.ts:751](src/platform/main/ebook/capability-impl.ts#L751) | `removeReadingThoughtBlock` | 过滤已有 doc.content | 全带（沿原 doc） |
| 5 | [platform/main/ebook/capability-impl.ts:838](src/platform/main/ebook/capability-impl.ts#L838) | reading-thought 其它写场景（同模式） | 同 #3/4 | 同 |

#### moveNote 调用点

| # | 位置 | 触发场景 |
|---|---|---|
| 1 | [views/note/data-model.ts:188](src/views/note/data-model.ts#L188)（`updateNote`-with-folderId 分支） | rename + 移动 |
| 2 | [views/note/tree-operations.ts:59](src/views/note/tree-operations.ts#L59) | NavSide 拖拽 note 到 folder |

#### deleteNote 调用点

| # | 位置 | 触发场景 |
|---|---|---|
| 1 | [views/note/data-model.ts:194](src/views/note/data-model.ts#L194) | data-model `deleteNote` 入口 |
| 2 | [views/note/note-commands.ts:129](src/views/note/note-commands.ts#L129) | 命令 `note-view.delete-active`（活跃 note 删除） |
| 3 | [views/note/note-commands.ts:184](src/views/note/note-commands.ts#L184) | 命令 `note-view.delete`（指定 id 删） |
| 4 | [views/note/tree-operations.ts:108](src/views/note/tree-operations.ts#L108) | 批量删除 `deleteSelected` |

### 1.2 绕过 capability 直接调 `storage.*` 的位置

| 类型 | 位置 | 说明 |
|---|---|---|
| migration | [storage/migrations/023-note-title-cache.ts:103](src/storage/migrations/023-note-title-cache.ts#L103) | `storage.putAtom<'pm'>` 串行回填 container payload 的 `attrs.title` 缓存。**绕开 dissect**（只改 container payload，不动 block atoms） |
| migration | [storage/migrations/022-ebook-thought.ts:275-403](src/storage/migrations/022-ebook-thought.ts#L275) | sub-phase 022 大 migration：putAtom ebook/reading-state/folder/pm + putEdge hasReadingState/hasReadingThought/inFolder/belongsToNote。**直接拼 atom + edge，不走 dissect/assemble** |
| backup | [platform/main/backup/backup-store.ts:115](src/platform/main/backup/backup-store.ts#L115)（`rewriteManagedEBookPaths`） | restore 后改写 ebook atom 的 `payload.filePath`。直接 putAtom |
| restore | [backup-store.ts:312-322](src/platform/main/backup/backup-store.ts#L312) | restore 主路径走 `surreal import` shell 进程：把 backup 内 `database.surql`（surreal export 出来的原始 SQL）整段塞回新库。**完全绕过 capability + dissect + PM 层**。是"原子 + 边集合"层级的快照恢复 |
| graph | [platform/main/graph/canvas-store.ts:312/334/343/346/363/373/379/382/513/517/561/623/654/695/701/721/725/738/741](src/platform/main/graph/canvas-store.ts#L312) | 画板 capability 自实施 putAtom/putEdge（graph-instance / graph-canvas / pm domain text-node 内容）。其中 line 343/373/379/738 直接 putAtom pm domain — **是另一条 pm 写入路径**（不走 dissect，因为画板 text-node 是单个 atom，不分 block） |
| folder | [platform/main/folder/capability-impl.ts:62/133/145/199/215](src/platform/main/folder/capability-impl.ts#L62) | folder capability 自实施 |
| thought | [platform/main/thought/capability-impl.ts:99/229/260/287](src/platform/main/thought/capability-impl.ts#L99) | thought capability 自实施 |
| pm-content | [platform/main/pm-content/capability-impl.ts:39/54](src/platform/main/pm-content/capability-impl.ts#L39) | graph text-node 的 PM 内容 capability（单 atom，不拆 block） |
| cardinality 自愈 | [storage/health/cardinality-check.ts](src/storage/health/cardinality-check.ts) | edge cardinality 修复期间直 storage |

---

## 节 2：转换链路对照表

### 2.1 入口 A — Import Word (mammoth)

```
触发: File → Import Word... (menu file.import-word)
main: src/platform/main/word-import/index.ts:155 runImportMammoth
   ↓ dialog 选 .docx → scanDocxPaths
   ↓ convertDocxBatch (src/platform/main/word-import/converter.ts)
   ↓   mammoth.convertToHtml(docx, styleMap)
   ↓   turndown(html) → markdown 字符串
   ↓   coverTitle 抠取 (krig-cover-title class)
   ↓   md-postprocess.splitImageWithTrailingText
   ↓   import-cache 落 01-raw / 02-postprocessed
   ↓ webContents.send IPC MARKDOWN_IMPORT_RUN { files: ScannedFile[] }
renderer: src/views/note/markdown-import.ts:537 importMarkdownBatch
   ↓ parseHeadings + oversized 双阈值判定
   ↓ buildFolderTreeCache (folderCap().listFolders + noteCap().listNoteTitles)
   ↓ ensureFolderPath (递归 folderCap().createFolder 重建 folder 树)
   ↓ 对每文件:
     ↓ tea.markdownToProseMirror(md) → PMNode[]  (capabilities/text-editing/converters/md-to-pm.ts:116)
     ↓ ensureLeadingTitle(content, title) — 强制首块 isTitle paragraph
     ↓ doc = { format:'pm-doc-json', version:'0.1', payload:{type:'doc', content:[...]} }
     ↓ noteCap().createNote(doc, folderId)
main: src/platform/main/note/capability-impl.ts:162 createNote
   ↓ unwrapPmDoc → injectIdsForCreate (line 250-278, 单 visit 递归注 ULID)
   ↓ storage.transaction:
       1. putAtom container { domain:'pm', payload:{type:'doc',attrs:{title},content:[]} }
       2. putEdge hasNoteView (literal boolean true)
       3. putEdge inFolder (if folderId)
       4. fullCreateDiff(docWithIds, containerId) = dissectPmDoc(docWithIds)
          → blocks + belongsEdges + nextSiblingEdges + childOfEdges
       5. applyDiff:
          - for added: tx.putAtom block(payload.payload = PM 节点 stripped)
          - for addedEdges: tx.putEdge predicate=user:krig:{belongsToNote|nextSibling|childOf}
DB: container atom + N block atom + 边集合
```

### 2.2 入口 B — Import Word (pandoc, High Quality)

```
触发: File → Import Word (High Quality)... (menu file.import-word-pandoc)
main: src/platform/main/word-import/index.ts:214 runImportPandoc
   ↓ detectPandoc — 未装 → 弹安装引导退出
   ↓ pickDocxFiles
   ↓ convertDocxBatchPandoc (src/platform/main/word-import/converter-pandoc.ts)
   ↓   spawn pandoc -f docx -t gfm+pipe_tables --wrap=none --extract-media=...
   ↓   markdown 字符串 + 媒体文件落临时目录
   ↓   post-process: math/html-img flatten + base64 内联
   ↓ import-cache 落 01-raw / 02-postprocessed
   ↓ webContents.send IPC MARKDOWN_IMPORT_RUN
[此后与入口 A 在 renderer markdownToProseMirror → createNote 完全共用]
```

### 2.3 入口 C — Import Markdown

```
触发: File → Import Markdown... (menu file.import-markdown)
main: src/platform/main/markdown-import/index.ts:33 runImport
   ↓ dialog 选 .md / 目录
   ↓ scanPaths → ScannedFile[] (relPath / content)
   ↓ 软上限 2000 弹确认
   ↓ webContents.send IPC MARKDOWN_IMPORT_RUN
[与入口 A 共用 renderer 端 importMarkdownBatch → createNote]
```

### 2.4 入口 D — NoteView 用户手动新建空 note

```
触发: 用户点 NavSide "+" / 快捷键 / 命令 note-view.create-note
view: src/views/note/note-commands.ts:108 → createNote(wsId, fid)
view: src/views/note/data-model.ts:154 createNote
   ↓ textEditing.createEmptyDoc()  → src/drivers/text-editing-driver/index.ts:44
   ↓   buildSchema([paragraphSpec]).node('doc', null, [paragraph{isTitle:true,id:null}])
   ↓   serializeDoc → DriverSerialized
   ↓ noteCap().createNote(emptyDoc, folderId)
[此后同 2.1 后半段。injectIdsForCreate 给唯一首段补 ULID]
```

### 2.5 入口 E — NoteView 用户编辑既有 note

```
触发: PM editor 内用户输入 / paste / command
view: src/drivers/text-editing-driver/Host.tsx onChange (dispatchTransaction tail)
   ↓ buildAutoBlockIdPlugin appendTransaction:
       descendants → null id 注 ULID + 重复 id 重生成 (split/paste)
       setMeta addToHistory:false + skipOnChange:true
       (skipOnChange:true → onChange 不发 IPC)
   ↓ user-edit tr (skipOnChange:false) → onChange → updateNote
view: src/views/note/NoteView.tsx:114 handleDocChange
   ↓ updateNote(activeNoteId, { doc: serializedDoc })
view: src/views/note/data-model.ts:185 → noteCap().updateNote
main: src/platform/main/note/capability-impl.ts:421 updateNote
   ↓ unwrapPmDoc → newDoc (id 全带,来自 plugin)
   ↓ oldDoc = pmDocCache.get(id) ?? assemblePmDoc(id)
   ↓ diffBlockTree(oldDoc, newDoc, id):
       oldDis = dissectPmDoc(oldDoc, id)
       newDis = dissectPmDoc(newDoc, id)
       atom diff by id; edge diff by canonical key
       removed atom 关联边剔出 removedEdges (storage.deleteAtom 已级联)
   ↓ storage.transaction:
       applyDiff (deleteAtom / putAtom / putEdge / deleteEdge)
       putAtom container { payload:{attrs:{title:newTitle},content:[]} } (刷 title 缓存 + updatedAt)
   ↓ pmDocCache.set(id, newDoc)
   ↓ broadcast NOTE_DOC_CONTENT_CHANGED (新 channel,排除 emitterId)
   ↓ broadcast NOTE_LIST_CHANGED
```

### 2.6 入口 F — AI extraction（KRIG_IMPORT atom batch）

```
触发: webview 加载 Platform URL,后端 OCR 完发 console.log("KRIG_IMPORT:" + JSON)
main: src/platform/main/extraction/handlers.ts:79 console-message listener
   ↓ message.startsWith('KRIG_IMPORT:') → SHA-256 短窗口去重 (5s TTL)
   ↓ JSON.parse → broadcastImport(data)
   ↓ webContents.send IPC EXTRACTION_NOTE_CREATE (所有窗口)
renderer: src/views/note/extraction-import.ts:76 importExtractionBatch (via useExtractionImport hook in NoteView)
   ↓ extractBookName → folderCap().listFolders('note') 找/建 bookName folder
   ↓ allNotes = noteCap().listNotes() (整篇 assemble!)
   ↓ existingTitles 去重
   ↓ for each chapter:
       buildAtoms(title, ch) — noteTitle atom 前置 + pages.flatMap(p.atoms with from.pdfPage)
       tea.sanitizeAtoms(atoms)   (src/capabilities/text-editing/converters/sanitize-atoms.ts:41)
       tea.atomsToProseMirror({atoms:cleaned})  (atoms-to-pm.ts)
         ↓ AtomType ↔ V2 PM node 13 种映射 (paragraph/heading/listItem/...)
         ↓ ensureBlockAttrIdField — 给所有非结构性非 inline node attrs.id=null 占位
       doc = { format:'pm-doc-json', version:'0.1', payload:{type:'doc',content:pmContent} }
       noteCap().createNote(doc, folderId)
[此后同 2.1 后半段。injectIdsForCreate 把 null id 改 ULID]
```

### 2.7 入口 G — backup-restore

```
触发: File → Backup / Restore
main: src/platform/main/backup/backup-store.ts:122 backup
   ↓ surreal export → database.surql (含 atom + edge + schema_version 全部行)
   ↓ cp media / ebook library / learning / .db-credentials
   ↓ write manifest.json
   ↓ tar -czf

main: src/platform/main/backup/backup-store.ts:228 restore
   ↓ tar -xzf
   ↓ 校验 manifest (version=2 + app='KRIG Note V2')
   ↓ shutdownSurrealDBAsync + rename dbDir → .pre-restore
   ↓ initSurrealDB (启空 rocksdb,★ 此步不跑 migration)
   ↓ surreal import (子进程,把 .surql 整段塞回新库 — atom + edge 行级恢复)
   ↓ runMigrations(getDB()) (按需补跑老备份升 schema 增量)
   ↓ runCardinalityCheck
   ↓ rewriteManagedEBookPaths (storage.putAtom 改 filePath)
   ↓ 恢复 media / ebook / learning 目录

关键: restore 路径 完全绕过 capability/PM/dissect/assemble。
是 atom+edge 行级快照恢复;contents 是已经 dissect 过的形态。
```

### 2.8 入口 H — Note 剪贴板粘贴

```
触发: NavSide 复制 + 粘贴
view: src/views/note/tree-operations.ts:172 pasteNote / 218 pasteFolderTree
   ↓ allNotes = noteCap().listNotes() → 拿源 doc (已 assemble)
   ↓ JSON.parse(JSON.stringify(src.doc)) 深拷贝 (含原 ULID)
   ↓ prefixFirstTextNode → 改首段 text "副本 " 前缀
   ↓ noteCap().createNote(docCopy, targetFolderId)
[createNote 内 injectIdsForCreate 字面对已带 id 保留;不触发新 ULID。
 但 buildAutoBlockIdPlugin 字面对 paste 内段会重复检测重生成 — 然而 createNote
 路径并不走 PM plugin,只跑 capability 层 inject。导致粘贴出的 note 与源 note
 字面共享所有 block id。是潜在的 id 复用问题 — 见节 6]
```

### 2.9 入口 I — Web 后台 JSON 文件导入

见节 3。当前 main HEAD 不存在"用户从磁盘选 JSON 文件导入"路径；存在的是 webview console-message KRIG_IMPORT 推送（=入口 F）。

---

## 节 3：寻找"web 后台 JSON 文件导入"路径

### 3.1 结论

**找到的是一条"webview 注入式 atom batch JSON 导入路径"**，不是"用户选磁盘 JSON 文件导入"路径。两者业务效果相近但触发方式不同。

**业务定位补充（2026-05-28 用户澄清）**：这条路径就是用户记忆中的"**web 后台 JSON 导入**"。"web 后台"=KRIG Knowledge Platform，部署在内网 `192.168.1.240`：

- `:8090` REST API（[platform/main/extraction/config.ts:10](src/platform/main/extraction/config.ts#L10) `PLATFORM_API`），用于上传 PDF + JWT 鉴权
- `:8091` Web UI（[platform/main/extraction/config.ts:13](src/platform/main/extraction/config.ts#L13) `PLATFORM_WEB_UI`），用户在 V2 右栏 webview 内浏览的后台网页
- `:8080` glm-ocr-service（FastAPI，仅后端微服务，V2 不直连）

业务流程（与"用户选磁盘 .json"形态不同但**业务效果等价**）：

```
1. V2 上传 PDF → 192.168.1.240:8090 (PLATFORM_API)
2. 后台 OCR 完成,产出 atom batch JSON
3. V2 右栏 webview 加载 192.168.1.240:8091/book/<md5> (PLATFORM_WEB_UI)
4. 用户在网页内选 chapter → 点"导入到 Note"
5. 后台网页前端 console.log("KRIG_IMPORT:" + JSON.stringify(batch))
6. V2 main 进程 console-message listener 截获 JSON → 走 §3.1 后续步骤入库
```

所以"找不到磁盘 JSON 导入"是正确的事实，但**"找不到 web 后台 JSON 导入"是不准确的措辞**——真实情况是**找到了**，只是它通过 webview console-message 传输，不是磁盘文件。这条路径已经在生产中运行（V1 时期落地，V2 在 sub-phase L5-C6 完整迁移）。

具体代码路径：[platform/main/extraction/handlers.ts:79-113](src/platform/main/extraction/handlers.ts#L79)。

机制（核对完毕）：

1. main 进程在 mainWindow 上挂 `did-attach-webview`（[handlers.ts:133](src/platform/main/extraction/handlers.ts#L133) `registerWebviewExtractionHook`）。
2. 任何 webview 导航到 Platform URL（`http(s)://<PLATFORM_API>` 或 `<PLATFORM_WEB_UI>` origin）就 attach console-message listener。
3. 后端 OCR 完成后，KRIG Platform 网页前端在浏览器控制台 `console.log("KRIG_IMPORT:" + JSON.stringify(batch))`。
4. main 截获 → SHA-256 5s 去重 → JSON.parse → `webContents.send EXTRACTION_NOTE_CREATE`（所有窗口广播）。
5. NoteView 的 `useExtractionImport` hook 接收，调 [views/note/extraction-import.ts:76 importExtractionBatch](src/views/note/extraction-import.ts#L76) 落地。

**当前 V2 main HEAD 不存在用户从本机磁盘选 .json 文件 → 解析 → 落 note 的 File 菜单入口**。File 菜单（[platform/main/menu/framework-menus.ts](src/platform/main/menu/framework-menus.ts)） 注册的 Import 类命令是：
- `file.import-markdown`
- `file.import-word`
- `file.import-word-pandoc`

没有 `file.import-json` / `file.import-extraction` / `file.import-atom` 类命令。

### 3.2 grep 范围与否决依据

| grep | 范围 | 命中 | 否决依据 |
|---|---|---|---|
| `import.*json` / `loadJson` / `restoreJson` / `parseJson` | `src/**/*.ts*` | JSON.parse 在多处出现，但全部是 OCR atom batch JSON、IPC 数据、settings 等，无"从文件系统选 .json 导入"路径 | 无 dialog.showOpenDialog filters 含 'json' / 'atoms' |
| `dialog.showOpenDialog.*json` | `src/**/*.ts*` | 无命中 | OS 文件选择对话框没注册 .json 过滤器 |
| menuRegistry.registerCommand 含 import/extraction | `src/**/*.ts*` | `file.import-word` / `file.import-word-pandoc` / `file.import-markdown` 三个 | 无 file.import-json 类命令 |
| `web-import` / `webImport` / `share-import` / `webExport` / `share-export` | `src/**/*.ts*` | 无命中 | 无"分享 / 网页导入"功能 |
| `tiptapContent` / `tiptap-content` | `src/**/*.ts*` | 仅命中 [sanitize-atoms.ts:14](src/capabilities/text-editing/converters/sanitize-atoms.ts#L14) 和 [atoms-to-pm.ts:173](src/capabilities/text-editing/converters/atoms-to-pm.ts#L173)（atoms-to-pm 4.7/4.8/4.12/4.13 case，是 atom.content 内嵌的 PM JSON 子树字段，**不是顶层文件格式**）| 是契约内字段，不是导入路径 |
| `v1-import` / `legacy-import` / `fromV1` / `v1JSON` | `src/**/*.ts*` | 无命中 | 无 V1 兼容导入 |
| `EXTRACTION_NOTE_CREATE` | `src/**/*.ts*` | main → broadcast；renderer hook 接 → importExtractionBatch | 已含入这里 |
| `KRIG_IMPORT` | `src/**/*.ts*` | [extraction/handlers.ts:82,93](src/platform/main/extraction/handlers.ts#L82) | webview console-message 协议 |

### 3.3 数据契约

虽然不是"文件导入"路径，但 KRIG_IMPORT JSON 的契约**有完整定义**，可作为未来"统一 atom 导入"参考：

**Schema 文件**：[docs/10-business-design/ebook/PDF-Note-Atom数据契约-v2.md](docs/10-business-design/ebook/PDF-Note-Atom数据契约-v2.md)

**输入 JSON 结构**（推送给 main 端）：

```ts
// KRIG_IMPORT: <JSON> 协议
interface KrigImportBatch {
  type: 'batch';
  bookName?: string;
  chapters: Array<{
    fileName?: string;
    bookName?: string;
    title?: string;
    pageStart?: number;
    pageEnd?: number;
    pages: Array<{
      pageNumber: number;
      atoms: Atom[];           // 见 PDF-Note-Atom数据契约-v2.md §3
      positions?: Record<string, BlockPosition>;
      pageSize?: { width: number; height: number };
    }>;
  }>;
}

// Atom (camelCase type, 13 种)
interface Atom {
  id?: string;                  // "atom-{timestamp}-{counter}"
  type: 'noteTitle' | 'heading' | 'paragraph' | 'mathBlock' | 'codeBlock'
      | 'image' | 'table' | 'blockquote' | 'callout'
      | 'bulletList' | 'orderedList' | 'listItem' | 'horizontalRule'
      | 'columnList';           // columnList 未实现 → unknown 占位
  content: AtomContent;         // 类型专属
  parentId?: string;            // 容器子节点才有
  order?: number;
  from: { extractionType:'pdf'; pdfPage:number; pdfBbox?; extractedAt:number };
  meta: { createdAt:number; updatedAt:number };
}
```

**InlineElement**（children[] 内部，kebab-case 保留）：text / link / math-inline / code-inline + marks。

**字段语义**（节录契约 §4）：
- `noteTitle.content.children` = InlineElement[] → V2 PM `paragraph(attrs.isTitle=true)`
- `heading.content.{level, children}` → V2 PM `heading(attrs.level=1-6)`
- `paragraph.content.children` → V2 PM `paragraph`
- `mathBlock.content.{latex}` → V2 PM `mathBlock`
- `image.content.{src, alt}` → V2 PM `image`（base64 转 media://）
- `table.content.{tiptapContent}` → V2 PM `table`（tiptapContent 已是 PM JSON 子树，**直装**）
- `blockquote.content.{tiptapContent | children}` → V2 PM `blockquote`
- `callout.content.{tiptapContent, emoji, iconName}` → V2 PM `callout`
- `bulletList / orderedList / listItem` → V2 PM 对应 list 节点（contracts 走扁平 + parentId 表达嵌套）
- `columnList` → unknown 占位（V2 PM schema 未实现 atom→PM 转换的 columnList 路径）

**字段转换实施**：[capabilities/text-editing/converters/atoms-to-pm.ts:atomsToProseMirror](src/capabilities/text-editing/converters/atoms-to-pm.ts) — 13 case 手工映射。其中 `table / blockquote / callout / column` 4 个走 "tiptapContent 直装" 路径（[atoms-to-pm.ts:173-200](src/capabilities/text-editing/converters/atoms-to-pm.ts#L173)）—— 即 atom.content.tiptapContent 必须**已是 PM JSON**，是从 V1 mirror 设计沿来的契约形式。

### 3.4 这条契约能否作为统一目标格式？

**关键事实**（2026-05-28 用户澄清后明确）：此契约**已经在生产中运行**——V2 与 KRIG Knowledge Platform 后台之间的真实数据交换格式。任何"重做导入系统"的设计必须**与之兼容**，不能产出一个跟生产契约对不上的新设计。

**部分能、部分不能**——观察事实：

- **能复用之处**：契约定义了 13 种 atom type + 与 V2 PM schema 的 1:1 映射，比 markdown 中间格式 lossier-less 更高（保留 callout/columnList 等 V2 原生节点）。`from` 字段（pdfPage / extractedAt）是 markdown 没有的来源追溯信息。在生产中跑过实际数据，鲁棒性已被验证。
- **不能直接复用之处**：契约源自 V1 mirror（mirro-desktop）+ 后端 OCR 服务的特定输出。`table.content.tiptapContent` 字段名是 V1 历史命名，"tiptap" 在本仓库的项目纪律里已被废弃（MEMORY 记录"V2 抛弃 Tiptap"）。
- **不知道之处**：契约是否覆盖所有 V2 PM 节点类型（如 fileBlock / audioBlock / videoBlock / htmlBlock / tweetBlock / mathVisual / externalRef 等媒体类）需另查；契约文档 §4 只详写了 13 种 atom。
- **战略意义**：考虑到此契约已经在生产中且文档化（[PDF-Note-Atom数据契约-v2.md](docs/10-business-design/ebook/PDF-Note-Atom数据契约-v2.md)），未来 markdown / word 导入设计**应优先考虑收敛到这份契约**（节 7.5 第 11 题）；如果发现契约有不足（节 7.5 不知道之处），应**扩展契约**而非另起炉灶。

---

## 节 4：当前数据契约盘点

### 4.1 Decision 026 — Block 独立化（核心决议）

文件：[docs/RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md](docs/RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md)

**关键不变量**（节录）：

| 项 | 字面拍板 | 位置 |
|---|---|---|
| 颗粒度 | "叶子 block + 叶子级容器拆 atom；结构性容器(table/tableRow/3 list 容器/columnList)不拆" | §3.1 |
| `atom.id` 与 `PM attrs.id` 同步 | `atom.id == PM attrs.id`，双向 invariant；schema attrs 加 `id:{default:null}` | §4 |
| id 注入时机 | PM appendTransaction 拦截发现 null → 注新 ULID（`buildAutoBlockIdPlugin`） | §4.3 |
| split | 上半保留 id / 下半新生成 | §5.3 |
| paste | 全部新生成 id（携运语义留未来 sub-phase） | §5.2 |
| 边集 | `belongsToNote`（block→note，每 block 1）/ `nextSibling`（每 atom ≤1 outgoing）/ `childOf`（每 atom ≤1 outgoing） | §6 |
| childOf 跨层 | tableCell.childOf → table atom（跳过 tableRow）；listItem.childOf → 最近非结构性祖先 | §6.1 |
| 容器 block content | listItem/tableCell/callout/column/blockquote 的 PM `content=[]`；嵌套通过 childOf 边 | §3.4 / §6.3 |
| 叶子 block content | paragraph/heading/codeBlock 等 PM `content`=inline 数组（沿原形态） | §3.4 |
| 容器 atom payload | `{ type:'doc', content:[] }`（block 全拆出） | §6.3 |
| 缓存策略 | in-memory cache，v1 不 evict，留性能压测决定 | §13.4 |

**§3.1.4 字面冲突点**（重要、节 5 引用）：

> 100 行 × 10 列 table 的 atom 负载：
>   1 table atom（根容器，不拆）→ table.content = []
>   0 tableRow atom（不拆）
>   100×10 = 1000 tableCell atom

——同时 §3.1.2 表格行写 "table | 表格根容器 | 用户从不单独引用整表... | 不拆"。**§3.1.4 写 "1 table atom" 但 §3.1.2 写 "table 不拆"**，决议自身内部矛盾。

**§13 Open Questions 实际登记的条目**：13.1 id 字段命名 / 13.2 split-merge marks 归属 / 13.3 nextSibling 链断裂 / 13.4 cache 内存上限 / 13.5 多窗口同 note / 13.6 携运 / 13.7 **tableHeader** 拆 atom 最终确认 / 13.8 中间层重建机制集中化。**没有专门登记"tableCell 跨 row 拼装信息丢失"**（虽然代码 [assemble-pm-doc.ts:128-129](src/platform/main/note/assemble-pm-doc.ts#L128) 自陈"字面登记到 decision 026 §13 待补充"）。

### 4.2 `@semantic/types`

文件：[src/semantic/types/atom.ts](src/semantic/types/atom.ts)，[src/semantic/types/atom-entity.ts](src/semantic/types/atom-entity.ts)，[src/semantic/types/edge.ts](src/semantic/types/edge.ts)

| 类型 | 强制 | 假设 | 消费方 | 生产方 |
|---|---|---|---|---|
| `PmPayload` | `{ type:string; content?:PmPayload[]; attrs?:Record; marks?:Mark[]; text? }` ；**recursive** | — | dissect / assemble / capability-impl / Host serialize | createEmptyDoc / md-to-pm / atoms-to-pm / capability-impl.containerPayloadWithTitle / migration |
| `AtomDomain` | string union；含 `'pm' / 'rdf' / 'embedding' / 'three' / 'folder' / 'graph-canvas' / 'graph-instance' / 'ebook' / 'reading-state' / 'thought'` | — | storage schema / index `payload.domain` regex `^[a-z][a-z0-9-]*$` | 各 capability |
| `AtomEntity<D>` | `{ id, createdAt, updatedAt, createdBy, payload:Atom<D>, hasBeenReferenced? }` | storage 层填 id（ULID） | listAtoms / getAtom 返回 | putAtom 时 storage 补字段 |
| `Edge` | `{ predicate, subject:AtomRef, object:AtomRef|LiteralValue, attrs:EdgeAttrs }` | predicate 必须符合 `^(user|ai|sys):...` 命名规则（schema regex） | storage / capability | 各 capability |

### 4.3 SurrealDB schema 层

文件：[src/storage/surreal/schema.ts](src/storage/surreal/schema.ts)

- `atom` 表 SCHEMAFULL（1.0.0 base）→ 1.3.0 改 `payload.payload` 为 FLEXIBLE 允 domain 自由扩展。
- `edge` 表 SCHEMAFULL，predicate 强校验正则 `^(user|ai|sys):([a-z][a-zA-Z0-9-]*:)?[a-z][a-zA-Z0-9]*$`。
- 索引：`atom_domain` / `edge_predicate` / `edge_subject` / `edge_object` / `edge_subject_predicate`。
- schema_version 表 + `schema_version_unique` UNIQUE index（backup-restore.ts:300 注释提到此约束影响 restore 顺序）。

### 4.4 dissect / assemble 入参契约

#### dissectPmDoc

文件：[src/platform/main/note/dissect-pm-doc.ts](src/platform/main/note/dissect-pm-doc.ts)

**强制**：
- 每 block atom outgoing belongsToNote = 1（line 16-18）
- 每 block atom outgoing nextSibling ≤ 1
- 每 block atom outgoing childOf ≤ 1
- 结构性容器 `{table, tableRow, bulletList, orderedList, taskList, columnList}` **不**生成 atom（[dissect-pm-doc.ts:22](src/platform/main/note/dissect-pm-doc.ts#L22) 从 assemble-pm-doc 导入 STRUCTURAL_CONTAINER_TYPES）
- 非结构性 + 存在 `attrs.id` 字段 → 生成 atom（[dissect-pm-doc.ts:49-55 shouldGenerateAtom](src/platform/main/note/dissect-pm-doc.ts#L49)）

**假设输入已满足**：
- 调用方传入的 PmPayload 是 `type='doc'` 根节点（[dissect-pm-doc.ts:207-212](src/platform/main/note/dissect-pm-doc.ts#L207)）
- **所有 shouldGenerateAtom 命中的 block 必须带非空 `attrs.id`**（[dissect-pm-doc.ts:126-141](src/platform/main/note/dissect-pm-doc.ts#L126)）；null/空字符串 → throw `caller must run buildAutoBlockIdPlugin / migration first(decision 026 §5.1)`
- 同 doc 内 id 不能重复 → throw `duplicate block id`

**消费方**：[capability-impl.ts createNote/updateNote](src/platform/main/note/capability-impl.ts#L162) 通过 `fullCreateDiff / diffBlockTree`。

**生产方**（满足契约的入口）：

| 入口 | 是否带 id | 走哪条 id 注入路径 |
|---|---|---|
| 用户 PM 编辑（updateNote） | 全带 | buildAutoBlockIdPlugin（PM appendTransaction 实时） |
| createEmptyDoc | 单 paragraph，id=null | createNote 内 `injectIdsForCreate`（[capability-impl.ts:250](src/platform/main/note/capability-impl.ts#L250)）|
| markdown-import (markdownToProseMirror) | **不带 attrs.id 字段** | createNote 内 `injectIdsForCreate`（依靠 spec 字面 `'id' in specAttrs` 兜底；但 md-to-pm.ts 出的节点字面无 attrs 时，inject 走 `out.attrs.id = generateUlid()`，需要 attrs 存在且含 id 字段 ⚠ 实际机制看下文）|
| extraction-import (atomsToProseMirror) | **带 `attrs.id: null` 占位** | atoms-to-pm `ensureBlockAttrIdField` 出口归一化（[atoms-to-pm.ts:578-589](src/capabilities/text-editing/converters/atoms-to-pm.ts#L578)） + createNote injectIdsForCreate 补 ULID |
| paste（剪贴板） | 全带（源 doc 已有） | inject 内 if !out.attrs.id 不触发；新 note 与源共用 id（节 6 反模式之一） |
| ebook addReadingThoughtBlock | 手工 generateUlid 写 attrs.id | 不依赖 inject |

⚠ markdown-import 路径中 markdownToProseMirror 出的 PMNode **多数 case 没有 attrs 字段**（[md-to-pm.ts](src/capabilities/text-editing/converters/md-to-pm.ts) 各 case 大多不写 `attrs:`）。injectIdsForCreate 的判定是 `if (!STRUCTURAL.has(node.type) && out.attrs && 'id' in out.attrs)`——`out.attrs` 不存在则跳过！这意味着 markdown-import 生产出的 PM doc 字面**很多 block 不会被 injectIdsForCreate 注 id**，进入 dissect → 检测 `attrs === undefined → shouldGenerateAtom = false → skip`。
> 实际跑下来的具体结果取决于 PM schema 在 nodeFromJSON 时是否自动补 attrs.default：capability-impl 走的是**裸 PmPayload**（不过 PM schema），所以 `attrs` 字段不存在的 case 在 dissect 时就被 `shouldGenerateAtom` 判 false 跳过——**block 字面丢失**。这是 atoms-to-pm 历史 bug 同根（[atoms-to-pm.ts:540-555 历史 bug 注释](src/capabilities/text-editing/converters/atoms-to-pm.ts#L540) 详细描述）。markdown-import 路径是否已被这条 bug 覆盖、各 case attrs 是否齐全，**留实施时复 grep md-to-pm.ts 各 case attrs 字段**。

#### assemblePmDoc

文件：[src/platform/main/note/assemble-pm-doc.ts](src/platform/main/note/assemble-pm-doc.ts)

**强制**：
- 顶层 wrapper 重建：listItem / taskItem / column 序列要包成 bulletList / orderedList / taskList / columnList（line 70-115 wrapChildren 内 if-else 链）
- 容器型 block 的 storage `content` 应为 `[]`，非空 warn 并 ignore（line 264-270）
- nextSibling 链按拓扑排序；无 head fallback 字典序（line 162-233）

**假设输入已满足**：
- container atom 存在
- belongsToNote 边集合 + nextSibling 边 + childOf 边的 cardinality 与 dissect 出的一致
- block atom 的 `_assemblyHints.listType` 字段在 listItem 上正确写入（dissect 写、assemble 读）

**§6.1 Open Question 自陈**（[assemble-pm-doc.ts:117-128](src/platform/main/note/assemble-pm-doc.ts#L117)）：

> v1 简化：所有 cells 字面塞到单个 tableRow（等同 V1 数据迁前空 table 字面状态）...
> ⚠ 字面 Open Question（本期不深入）：tableCell 跨 row 拼装的真实信息丢失；字面登记到 decision 026 §13 待补充。

——但 decision 026 §13 实际**未登记此条**（只有 §13.7 tableHeader 拆 atom 一条，跟 row 信息无关）。即"代码声称登记到 §13"和"§13 字面登记内容"不对齐。

### 4.5 buildAutoBlockIdPlugin

文件：[src/drivers/text-editing-driver/plugins/build-auto-block-id-plugin.ts](src/drivers/text-editing-driver/plugins/build-auto-block-id-plugin.ts)

**强制**（line 78-83 `shouldHaveId`）：
- STRUCTURAL `{table, tableRow, bulletList, orderedList, taskList, columnList}` → 不该有 id
- node.type.spec.attrs 不含 `id` 字段 → 不该有 id
- 否则该有 id

**注入逻辑**（line 94-142 appendTransaction）：
- descendants 扫描全树
- attrs.id === null → 注新 ULID
- attrs.id 已存在但 doc 内重复 → 后出现的重生成（split / paste）
- 整批 tr setMeta `addToHistory:false` + `skipOnChange:true`（后者让 Host onChange 不发 IPC，冷启动幂等）

**生效范围**：**仅 PM editor 内部**。capability 层 createNote 走的是裸 PmPayload 路径，绕过 PM，需独立的 `injectIdsForCreate`（capability-impl.ts:250）。

### 4.6 NodeSpec attrs.id 字段声明

总数：`src/drivers/text-editing-driver/blocks/` 下 27 个 spec.ts。

- **含 `id:{default:null}`**：21 个（grep -l `id: { default: null }`）
  - paragraph / heading / codeBlock / mathBlock / mathVisual / image / fileBlock / video-block / audio-block / html-block / tweet-block / blockquote / callout / list-item / task-list (taskItem) / table-cell / table-header / column-list (column) / external-ref / hard-break? / horizontal-rule? (个别需逐一核实)
- **不含 id 字段**：6 个 spec — math-inline / ordered-list / file-link / bullet-list / note-link / hard-break

  其中：bulletList / orderedList 是结构性容器（无 id 一致）；mathInline / fileLink / noteLink / hardBreak 是 inline 节点（无 id 一致）。

- **table 自身**（[blocks/table/spec.ts:76-85 tableNodeSpec](src/drivers/text-editing-driver/blocks/table/spec.ts#L76)）：**完全不声明 attrs**——即 `table` 节点在 PM schema 内**无任何 attrs 字段**（含无 id）。决议 §3.1.4 写"1 table atom"但 schema 完全没给 table 留 id 字段位置 → 即便人为想生成 table atom，dissect 端 `'id' in node.attrs` 判定为 false。**schema 与决议不一致**。

### 4.7 contents/ 写库入口对契约的满足情况

| 入口 | 满足契约 | 不满足或漂的地方 |
|---|---|---|
| 用户编辑 updateNote | ✅ | — |
| createEmptyDoc + createNote | ✅ | inject 兜底；首段 attrs 字面只有 isTitle，没有 id 字段也能被 inject 补齐 |
| markdown-import + createNote | ⚠ 部分 | md-to-pm 各 case 大多无 attrs 字段；inject 不补；理论会触发"block 字面丢失"（与 atoms-to-pm 历史 bug 同根，未在仓库内显式 verify） |
| atoms-to-pm + createNote | ✅ | atoms-to-pm 出口 `ensureBlockAttrIdField` 占位 id:null + inject 补；已修历史 bug |
| paste + createNote | ⚠ | 全携源 doc id；与源 note 共用 block ULID — capability 层 inject 不重生成（plugin 才查重复），等同破坏"每 atom 唯一身份"假设 |
| ebook addReadingThoughtBlock + updateNote | ✅ | 手工 generateUlid |
| backup-restore | ✅（行级快照） | 不经契约转换 |

---

## 节 5：table 结构丢失 bug 根因层级定位

### 5.1 现象重述

GFM 表格 markdown → markdownToProseMirror → 顶层 `table > tableRow > tableCell` 三层嵌套 PM 子树 → createNote → dissect → DB 内：container atom 下挂一堆 tableHeader / tableCell **直接作为顶层 block**（belongsToNote 直挂 container），**无 table atom、无 tableRow atom**。重启后 assemble 拼出一堆顶层 cell，渲染塌陷。

### 5.2 dissect 端为什么 table / tableRow 没生成 atom

[dissect-pm-doc.ts:22](src/platform/main/note/dissect-pm-doc.ts#L22) 从 [assemble-pm-doc.ts:381](src/platform/main/note/assemble-pm-doc.ts#L381) 导入 `STRUCTURAL_CONTAINER_TYPES`：

```ts
new Set<string>(['table', 'tableRow', 'bulletList', 'orderedList', 'taskList', 'columnList']);
```

包括 **`'table'`**。`shouldGenerateAtom`（line 49-55）：

```ts
if (STRUCTURAL_CONTAINER_TYPES.has(node.type)) return false;
```

→ table 直接被判"不生成 atom"。`processChildren`（line 89-198）见到 table 走 isStructuralContainer 分支（line 101-118），**跳层**把 table 的 children（tableRow 们）以 grandchildren 形式 push 回外层 sibling 集合，drawSiblingChain=false 防双倍边。tableRow 同样是 STRUCTURAL → 再次跳层，把它的 tableCell / tableHeader push 回外层。

然后 tableCell / tableHeader 不是 STRUCTURAL，attrs.id 存在（spec 含 id 字段）→ shouldGenerateAtom=true → 生成 block atom。但此时 **parentAtomId = containerId（顶层）**，line 174 `if (parentAtomId !== ctx.containerId) ctx.result.childOfEdges.push(...)` 不触发 → tableCell **没有 childOf 边**，只有 belongsToNote（→ container）+ nextSibling 链（与其它 cells 之间）。

**直接结论**：dissect 把 table / tableRow 当结构性容器跳层，tableCell 直接挂到 note container。

### 5.3 assemble 端为什么拼不回

[assemble-pm-doc.ts:302 assemblePmDoc](src/platform/main/note/assemble-pm-doc.ts#L302)：

1. 拉所有 belongsToNote 边 → 拿 blockIds。
2. 拉 childOf 边 → 算 `hasChildOf` 集合（**tableCell 没有 childOf 出边，所以 hasChildOf 不含它们**）。
3. `topLevelIds = blockIds.filter(id => !hasChildOf.has(id))` → tableCell 全部进入 topLevelIds。
4. wrapChildren（line 61-115）逐个处理 topNodes：
   - listItem 段 → 包 bulletList / orderedList ✓
   - taskItem 段 → 包 taskList ✓
   - column 段 → 包 columnList ✓
   - **其它（含 tableCell / tableHeader）→ default 分支** `result.push(stripAssemblyHints(child)); i++`（line 110-111）

[assemble-pm-doc.ts:107-109](src/platform/main/note/assemble-pm-doc.ts#L107) 字面注释自陈：

> tableCell / tableHeader **不会出现在顶层 child 序列**（它们的 childOf 父是 table atom，由 assembleTableChildren 单独处理）

——但事实是：**dissect 端没有让 table 生成 atom**，所以 tableCell 的 childOf 父根本不存在 → cells 必然出现在顶层 child 序列 → 走 default 分支裸 push。assemble 端"假设 table atom 存在"的前提被 dissect 端违反，wrapTableCells 永远等不到被调用。

`wrapTableCells`（line 129-137）字面自陈：

```ts
// v1 简化：所有 cells 字面塞到单个 tableRow（等同 V1 数据迁前空 table 字面状态）
// ⚠ 字面 Open Question（本期不深入）：tableCell 跨 row 拼装的真实信息丢失；
//   字面登记到 decision 026 §13 待补充。
```

——即使 cells 走到 wrapTableCells（场景 = container 有 table atom 且 cells.childOf 指向它），**也无法重建 row 拆分**（rowIndex / colIndex 信息已在 dissect 期丢失）。这是 decision 026 §6.1 跳层规则的必然代价。

### 5.4 Decision 026 §6.1 自陈未完成的层级

**字面证据**：

- [decision 026 §3.1.4](docs/RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md) 写"1 table atom（根容器，不拆）→ table.content = []"。这一行**暗示 table 是 atom**——与 §3.1.2 表头"table | 表格根容器 | 不拆"矛盾。
- [decision 026 §3.4 例 3](docs/RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md) PM payload 字面写：
  ```ts
  { domain:'pm', payload:{ type:'table', attrs:{id:'<ULID>'}, content:[] } }
  ```
  ——再次暗示 table 有 atom + 有 attrs.id。
- [decision 026 §6.1](docs/RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md) 字面写："tableCell.childOf → table atom（跳过 tableRow）"——**要求 table 必须是 atom**，否则 childOf 无目标。
- 实施层：[table/spec.ts:76-85 tableNodeSpec](src/drivers/text-editing-driver/blocks/table/spec.ts#L76) **完全不声明 attrs**（包括无 id 字段）→ 即使想生成 table atom，dissect `'id' in node.attrs` 判 false 也不会生成。实施按 "table 不拆"路径走（STRUCTURAL 集合含 'table'）。
- 代码自陈：[assemble-pm-doc.ts:128](src/platform/main/note/assemble-pm-doc.ts#L128) 写"字面登记到 decision 026 §13 待补充"。
- 决议字面：[decision 026 §13.1-13.8](docs/RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md#L810) **没有"tableCell 跨 row 拼装信息丢失" 条目**。最接近的 §13.7 只问 tableHeader 是否拆 atom。

### 5.5 编辑路径会不会触发？验证

用户在 NoteView 编辑既有 note 时，updateNote 走 [diffBlockTree](src/platform/main/note/diff-block-tree.ts) → `dissectPmDoc(oldDoc, id)` + `dissectPmDoc(newDoc, id)` → **同一个 dissect**。所以编辑路径同样把 table / tableRow 压平，cells 同样无 childOf 直挂 container。

**为什么用户不见 bug**：updateNote 后 cache `pmDocCache.set(id, newDoc)`（[capability-impl.ts:457](src/platform/main/note/capability-impl.ts#L457)），cache 内仍是用户编辑器内完整 schema 的 newDoc（含 `table > tableRow > tableCell` 嵌套）；PM Host 内的 EditorState.doc 也是同一个；NavSide TOC 等 view 显示的是完整 doc。**只要不冷启动、不让 cache miss 走 assemble，用户就看不见塌陷**。

**重启或 cache 失效后**：`getNote` → cache miss → assemble → 拼出顶层一堆 tableCell（无 table 包裹）→ PM schema 校验失败（schema 要求 `table > tableRow > cell`，顶层不允许裸 tableCell）→ 渲染塌陷或丢内容。这条推测**确认成立**。

### 5.6 根因层级总结

```
设计层：decision 026 内部字面矛盾
  ├─ §3.1.2/§3.1 字面拍板"table 不拆 atom"
  ├─ §3.1.4/§3.4 又字面写"1 table atom" + "table.attrs.id=<ULID>"
  └─ §6.1 字面 "tableCell.childOf → table atom" 要求 table 是 atom

实施层：实施时按 §3.1.2 "table 不拆" 实施
  ├─ STRUCTURAL_CONTAINER_TYPES 含 'table'
  ├─ table/spec.ts tableNodeSpec 不声明 attrs.id（甚至无 attrs）
  └─ dissect 把 table 跳层 → tableCell 无 childOf → 直挂 container

后果链：
  ├─ DB 形态：container -[belongsToNote]→ tableCell × N（无 table atom、无 childOf）
  ├─ assemble.wrapTableCells 永远等不到被调用（cells 走 wrapChildren default 分支）
  └─ 重启后拼出顶层裸 tableCell → schema 违例 → 渲染塌陷

Open Question 自陈未完成
  ├─ assemble-pm-doc.ts:128 注释字面登记到 §13
  └─ §13 字面未登记（缺漏）

这是【dissect 设计假设违反 decision 026 §6.1 跳层规则】+
   【decision 026 §6.1 自陈未完成的设计登记缺失】两层叠加的 bug。
```

---

## 节 6：暴露的反模式 / 设计问题清单

### 6.1 `markdownToProseMirror` 同时被用作"view 渲染输入"和"存储输入"中间格式

- 文件：[capabilities/text-editing/converters/md-to-pm.ts:116](src/capabilities/text-editing/converters/md-to-pm.ts#L116)
- 定位本是 capability "text-editing"，输出 V2 PM schema 节点 JSON 给 view 渲染用
- 现实：markdown-import 路径直接拿它出的 PMNode[] 封信封 → createNote → dissect 入库（[markdown-import.ts:526](src/views/note/markdown-import.ts#L526)）
- 问题：md-to-pm 各 case 大量不写 `attrs` 字段（依赖 PM schema 在 nodeFromJSON 时按 default 补齐），但 capability 入库路径**不过 PM**——dissect 直接吃裸 PmPayload，attrs 缺失 → shouldGenerateAtom 判 false → 静默 skip block
- atoms-to-pm 历史 bug 注释（[atoms-to-pm.ts:540-555](src/capabilities/text-editing/converters/atoms-to-pm.ts#L540)）已为同类问题在 atoms-to-pm 出口加 `ensureBlockAttrIdField` 兜底；**md-to-pm 路径未加同类兜底**

### 6.2 dissect / assemble 的输入约束不文档化、import 路径在隐性违反

- dissect 要求"所有 shouldGenerateAtom 命中的 block 必须带非空 attrs.id"
- 文档：dissect-pm-doc.ts 顶部注释提到"caller must run buildAutoBlockIdPlugin / migration first"
- 现实：markdown-import / extraction-import 都不过 PM editor / plugin，绕开 buildAutoBlockIdPlugin
- 兜底：capability-impl.ts 补 `injectIdsForCreate`（[capability-impl.ts:250](src/platform/main/note/capability-impl.ts#L250)）和 atoms-to-pm 出口 `ensureBlockAttrIdField`
- 设计层问题：**约束在文档里只是注释，没有 type-level 表达**；import 路径每加一条都要手工记得"我可能要补 id"

### 6.3 三处 STRUCTURAL_CONTAINER_TYPES 物理分散

- 主源：[assemble-pm-doc.ts:381](src/platform/main/note/assemble-pm-doc.ts#L381)（含 6 类型）
- dissect 通过 import 复用：[dissect-pm-doc.ts:22](src/platform/main/note/dissect-pm-doc.ts#L22)（✓ 复用）
- 但同名集合**独立定义另两处**：
  - [build-auto-block-id-plugin.ts:54](src/drivers/text-editing-driver/plugins/build-auto-block-id-plugin.ts#L54)（PM 层）
  - [atoms-to-pm.ts:557](src/capabilities/text-editing/converters/atoms-to-pm.ts#L557)（atom→PM 转换）
- 未来加新结构性容器（grid / flexbox / layout）需要同步改 3 个文件；任何一处漏 → id 注入或 dissect 漂移
- 决议 §13.8 字面要求"集中可扩展位置"但实施未真正集中（只是注释字面说"STRUCTURAL_REBUILD_RULES 集中化提示"——grep 全仓没有此常量定义）

### 6.4 `injectIdsForCreate` 是补丁，补的是"capability 不过 PM"的洞

- 文件：[capability-impl.ts:250-278](src/platform/main/note/capability-impl.ts#L250)
- 注释自陈："Stage 1 已 commit 的 plugin 是 PM transaction 内运行；capability 层 createNote / migration 字面绕开 PM 层操作 PmPayload（纯 JSON），所以需独立一份 inject 逻辑"
- 这是设计层"逻辑双轨"：同一规则（哪些节点该有 id）写两份代码
- 风险：plugin 与 inject 字面发散后无人发现（plugin 的 paste 去重逻辑 inject 没有 — paste 入库时不重生成 id）

### 6.5 每个 import 入口自己实现一套 markdown → PM → atom

- markdown-import：MARKDOWN_IMPORT_RUN 推 ScannedFile[] → renderer markdownToProseMirror → createNote
- word-mammoth：docx → mammoth → turndown → markdown 字符串 → MARKDOWN_IMPORT_RUN（**共用 renderer 链路** ✓）
- word-pandoc：docx → pandoc → markdown 字符串 → MARKDOWN_IMPORT_RUN（**共用** ✓）
- extraction：KRIG_IMPORT atom JSON → EXTRACTION_NOTE_CREATE → atomsToProseMirror → createNote
- restore：surreal import shell 进程，atom + edge 行级
- ebook 标注：手工拼 PM block → updateNote
- paste：JSON.parse 深拷贝 → createNote

每个入口的"如何到达 capability"路径差异大；word-import 已经收敛到共用 markdown-import 链路是个对的方向，但 extraction / paste / ebook 还各自实现

### 6.6 应有但缺失的抽象层："markdown → atom 集合"作为 capability

- 现状：markdown → PM → dissect → atom（PM 是中间表征）
- 问题：PM 节点形态强约束（必须是 PM schema 合法树），与"atom + edge 图"的存储形态有 impedance mismatch；中间还得插 inject、ensureBlockAttrIdField 等兜底
- 反映：如果存在统一的"markdown → atom 集合"或"atom 集合 → atom 集合（修补）"capability，可避免每个入口自己拼 PM → 入库

### 6.7 Paste 入口的 id 重复风险

- [tree-operations.ts:183](src/views/note/tree-operations.ts#L183) `pasteNote`：`JSON.parse(JSON.stringify(src.doc))` → createNote
- 源 doc 已含全部 block ULID；createNote 内 injectIdsForCreate 检查 `if (!out.attrs.id)` 不触发重生成
- 决议 §5.2 字面要求"粘贴全部生成新 id"；plugin 走 PM 编辑路径时会重生成（descendants 重复检测）
- 但 capability paste 路径**不过 PM plugin**，等价 cross-note id 共享 — 违反决议 §5.2
- 后果未知：可能导致 cross-note belongsToNote 边混乱 / id 唯一性破坏 / 引用追踪错乱

### 6.8 决议 026 内部字面矛盾

- §3.1.2 表头"table | 不拆"
- §3.1.4/§3.4 例 3 "1 table atom" / "table.attrs.id=<ULID>"
- §6.1 跳层规则要求 table 是 atom
- 实施按 §3.1.2 落地，schema 没给 table 留 id 字段 → §6.1 跳层规则无法字面成立 → tableCell.childOf 字面无目标可指
- 决议自身从未明确"table 到底是不是 atom"——是节 5 bug 的设计层根因

### 6.9 §13 自陈未完成 — 代码声称登记，决议未真登记

- [assemble-pm-doc.ts:128](src/platform/main/note/assemble-pm-doc.ts#L128) 字面写"字面登记到 decision 026 §13 待补充"
- decision 026 §13 实际只登记了 13.1-13.8 八条，**无"tableCell 跨 row 拼装信息丢失"**条
- 含义：代码层认知到问题，决议层未承接 → 后续维护者无法从决议表上看见此问题，只能在读 code 时偶然发现

### 6.10 listNotes 在 import 路径冷启动雪崩

- [capability-impl.ts:280-325 listNotes](src/platform/main/note/capability-impl.ts#L280)：每篇 note 都要 assemblePmDoc（4 个全表 listEdges 各一次）
- [capability-impl.ts:298-321](src/platform/main/note/capability-impl.ts#L298) 注释自陈："Promise.all 92 路并发触发 NotAllowed auth crash"；改为串行
- 大批 import 后冷启动卡 30s+ → 加 attrs.title 缓存 + migration 023 backfill
- 反映：listNotes 设计未考虑大量 note 场景；缓存方案是 hot-fix
- import 路径的 `listNotes` 调用（如 [extraction-import.ts:90](src/views/note/extraction-import.ts#L90) 去重检查）成为性能负担；markdown-import 已切到 `listNoteTitles` 轻量 API（[markdown-import.ts:306](src/views/note/markdown-import.ts#L306)），**extraction-import 未切**

### 6.11 backup-restore 行级快照导致 schema 演化时不能 rebuild

- restore 路径走 `surreal import` 直接塞 atom + edge 行回新库
- 含义：若决议 026 的形态发生变化（如未来真把 table 也拆 atom），老备份内的"table 不是 atom" 形态会被原样恢复
- 修复需要在 migration 中扫数据库重 dissect — 但当前 migration 框架是 "schema 升级" 而非 "数据形态重整"
- 反模式：备份是 verbatim 而非 logical → 历史决议的 bug 形态会被永久 sealing 进备份

### 6.12 capability 写入路径的 broadcast 顺序耦合

- [handlers.ts:60-73 NOTE_UPDATE](src/platform/main/note/handlers.ts#L60)：先 DOC_CONTENT_CHANGED 后 LIST_CHANGED
- 注释说"顺序：先内容后元数据派生" — 但跨 broadcast 的 race 没在类型层保证
- 与 import 直接相关：大批 import 时 N 次 createNote 触发 N 次 LIST_CHANGED broadcast（NavSide 刷新 N 次）；无 batched 写入路径

---

## 节 7：给重做工作的输入清单（必须回答的问题）

不写方案，只列问题。

### 7.1 关于公共转换抽象层

1. **未来公共的"导入 → atom 集合"转换器，输入应该是 markdown 字符串、PM 树、还是某种独立 AST？** PM 树作为中间表征带来 schema 强约束，但好处是已与 view 渲染共用一套节点；如果不用 PM 树，又用什么表达 callout / column / mathVisual 等 V2 特有节点？

2. **atom 是否应该和 PM doc 完全脱钩，还是保留某种 1-1 映射方便 view 层渲染？** 当前是双轨：atom 端是图（belongsToNote + childOf + nextSibling），view 端拼回 PM 树。脱钩则 view 端要做大量"图→树"重建；不脱钩则 markdown → PM → atom 必经 PM schema 校验中间环节。

3. **"markdown → atom 集合"是否本应是个独立 capability（如 `markdown-import`）而非每个入口自己组装？** 当前 word-mammoth / word-pandoc / markdown 三入口已经共用 renderer 端 importMarkdownBatch，但 extraction / paste / ebook 各自实现；统一到何粒度？

### 7.2 关于 table 数据模型

4. **table 自身是否应该是 atom？** 决议 026 §3.1.2 说不拆，但 §3.1.4 / §6.1 又依赖它是 atom。两个选项的代价：
   - 如果"是 atom"：每张表多 1 atom + 1 belongsToNote 边 + N 条 tableCell.childOf → table；但 §6.1 跳层规则能字面成立；schema 要给 table.attrs 加 id 字段
   - 如果"不是 atom"：tableCell 必须自带 row/col 信息（attrs.rowIndex / colIndex 或 attrs.parentRowId），assemble 端能从 cells 重建 row 拆分；schema 改动小但 dissect 期 row 信息提取复杂

5. **tableRow 是否需要重新评估？** 决议 §3.1.2 说不拆，§13.7 又留 tableHeader 是否拆的 Open Question。如果 row 信息要靠 cells 自带，是否反过来说明 row 拆 atom 更经济？

6. **现有 DB 里已存在的"裸顶层 tableCell"数据**如何处理？migration、丢弃、还是兼容性 assemble fallback？

### 7.3 关于 STRUCTURAL 集合与中间层重建

7. **3 处 STRUCTURAL_CONTAINER_TYPES 是否应该收敛？收敛到哪一层？** semantic 层（@semantic/types）共享？还是各层独立定义但用编译期 invariant 校验等价？

8. **决议 026 §13.8 说的 STRUCTURAL_REBUILD_RULES 集中化常量应该长什么样？** 当前是 wrapChildren 内 if-else 链 + wrapTableCells 独立函数；要不要类似 `Map<containerType, (children) => wrapper>` 的可注册结构？

### 7.4 关于 id 注入与 paste 语义

9. **inject 逻辑（capability 层）与 buildAutoBlockIdPlugin（PM 层）应不应该共用一份代码？** 当前是双轨，paste 在 capability 路径不触发重生成 → cross-note id 共享。如果共用，capability 端怎么访问 PM schema？或者抽到纯 JSON 层（不依赖 PM schema）？

10. **paste 入口的 id 语义** — 决议 026 §5.2 "粘贴全部新 id"是否覆盖剪贴板 / drag-drop / API 移动三种场景？capability 层 paste 路径需要不要单独走 "导入时强制新 id" 模式？

### 7.5 关于 import 路径的契约统一

11. **JSON 导入契约**（[PDF-Note-Atom数据契约-v2.md](docs/10-business-design/ebook/PDF-Note-Atom数据契约-v2.md)）是否能作为统一输入格式？所有 import 路径（markdown / word / extraction / paste 等）先转成它再走单一 ingest pipeline？

12. **import 路径需不需要 batched createNote？** 当前每篇 1 次 createNote → N 次 storage.transaction → N 次 broadcast；大批量（如用户 import 1000 篇）触发 N 次 list refresh。需要一个 batched 写入 + 单次 broadcast 的 API？

13. **import 路径的 progressive vs all-or-nothing 语义**：当前是 fire-and-forget 单篇失败 console.warn 跳过；用户能不能 cancel？已写入的 note 怎么回滚？

### 7.6 关于决议 026 自身

14. **决议 026 §3.1.2 / §3.1.4 / §6.1 的字面冲突应该如何先解决？** 不解决决议层冲突，节 5 的 bug 修法会被反复"哪种修法符合决议"反复来回拉扯。

15. **§13 Open Questions 漏登的"tableCell 跨 row 拼装信息丢失"是否应该先补登？** 否则代码层自陈 vs 决议层登记永远不对齐。

16. **decision 026 §3.1.4 的容量估算"1 table atom"是否需要修正为符合实际实施"0 table atom"？** 估算文字会成为后人理解模型的依据，模糊会传染下游决议。

### 7.7 关于 backup-restore 与数据演化

17. **backup 是否应该保留"原始用户输入"（markdown / docx）副本？** 当前 backup 只存 dissect 后的 atom + edge 行；若未来决议改了 dissect 规则，老备份无法重新走新形态 import。

18. **migration 框架是否要扩展支持"数据形态重整"** (不只是 schema 升级)？例如新决议把 table 改成 atom，老备份恢复后要 scan 全库批量重 dissect。

---

*Survey · 2026-05-28 · 调研者：subagent · 不切分支 / 不 commit / 不连 DB*
