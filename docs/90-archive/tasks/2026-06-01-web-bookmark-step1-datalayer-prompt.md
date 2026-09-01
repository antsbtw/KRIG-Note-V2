# 书签 步骤1:数据层(bookmark capability + 扩 FolderViewType)

> web view 书签做成完整树形管理器(文件夹分类 / 拖拽 / 重命名 / Chrome 导入),**复用 folder capability + FolderTree**(照抄 ebook 书架,调研已确认完全可行)。
> 大工程分步:**步骤1=数据层(本包)→ 步骤2=树UI+按钮 → 步骤3=Chrome导入**。
> **在 `feat/web-downloads` 分支继续,不切新分支,不 merge/push。**

---

## 0. 工作纪律

1. cwd 敏感 Bash 必前缀 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`;Read 绝对路径。
2. memory(**重点**,本步涉 SurrealDB):`feedback_surrealdb_4x_no_type_thing`(新 SQL 形式必 grep 仓库 + 看现有用法 verify)、`feedback_sdk_version_binding_policy`、`feedback_surrealdb_inside_not_in`、`feedback_no_fallback_bandaid_fixes`、`feedback_merge_requires_explicit_ok`、`feedback_main_console_not_in_devtools`。
3. **⚠️ 严禁源码写字面控制字符(NUL `\0`)**。写完 `file <路径>` 确认 "UTF-8 text"。
4. sandbox 拦 npm start → 用户跑。typecheck/单测自己跑。命令:typecheck=`npm run typecheck`,test=`npm run test`,lint=`npm run lint`。
5. 做完 typecheck + 自测 + commit → STOP 汇报。

---

## 1. 用户已拍板决策

| 决策 | 选择 |
|---|---|
| 书签存储 | **SurrealDB,复用 folder capability**(跟 note/ebook 同栈,FolderTree 拖拽/重命名全复用) |
| 数据范围 | 全局共享(跟 ebook 书架、web-history 一致) |
| 推进 | 分步,本包只做**数据层** |

---

## 2. 模板:照抄 ebook 书架(先读这些)

书签数据层 = **ebook-library 的瘦身克隆**(book→bookmark,EBookInfo→BookmarkInfo)。**动手前先读这两个模板文件全文**:
- `src/capabilities/ebook-library/types.ts` — capability 对外 API 类型(`EBookLibraryApi`:add/list/rename/remove/moveToFolder/onListChanged 等)。书签照此瘦身。
- `src/platform/main/ebook/capability-impl.ts` — main 端实现:book = `domain='ebook'` atom payload,用 `user:krig:inFolder` 边挂 folder。书签照此:`domain='bookmark'` atom payload `{url, title}`,同样 inFolder 边挂 folder。
- `src/platform/main/ebook/library-handlers.ts` — IPC handler 注册模式(ipcMain.handle)。

folder 通用基建(book/bookmark 都挂它,**不改 folder 树本身**):
- `src/capabilities/folder/types.ts` — folder capability API(createFolder/listFolders/renameFolder/moveFolder/deleteFolder/onListChanged),`requireCapabilityApi<...>('folder')` 用。
- `src/platform/main/folder/capability-impl.ts` — folder = `domain='folder'` atom payload `{title}`,嵌套用 inFolder 边,view 归属用 `user:krig:folderForView` 边 + 字面标记 `__view__/<viewType>`。

---

## 3. ⚠️ 头号风险:扩 FolderViewType 必须同步改全部硬编码处

调研铁证:`FolderViewType` 加 `'web'` 时,`capability-impl.ts` 有**多处硬编码 viewType 分组**,**漏任一处 → web 文件夹不进 broadcast 分组 → UI 不刷新**(ebook 当年踩过同款 bug)。**必须全改**:

| 文件:行 | 改动 |
|---|---|
| [note-folder-types.ts:58](src/shared/ipc/note-folder-types.ts#L58) | `FolderViewType = 'note'｜'graph'｜'ebook'｜'thought'` → 加 `｜'web'` |
| [folder/capability-impl.ts:133](src/platform/main/folder/capability-impl.ts#L133) | `idsByView: Record<FolderViewType, Set<string>>` 初始化加 `web: new Set()` |
| [:139-142](src/platform/main/folder/capability-impl.ts#L139) | 加 `const WEB_MARKER = viewMarkerFor('web');` |
| [:148-157](src/platform/main/folder/capability-impl.ts#L148) | 分组 add 逻辑加 `else if (... === WEB_MARKER) idsByView.web.add(...)` |
| [:186-189](src/platform/main/folder/capability-impl.ts#L186) | 返回对象加 `web: buildInfos(idsByView.web)` |
| [:502](src/platform/main/folder/capability-impl.ts#L502) | `CASCADE_RESOURCE_DOMAINS` 加 `'bookmark'`(删文件夹时级联删该文件夹下书签 atom) |

**grep 兜底**:改完 `rg -n "FolderViewType|idsByView|viewMarkerFor\(|CASCADE_RESOURCE_DOMAINS" src/platform/main/folder/capability-impl.ts`,逐处核对 web 都覆盖了。**TypeScript 会帮你**:`Record<FolderViewType, ...>` 加 'web' 后,漏填的地方 tsc 会报 missing property —— typecheck 过 = record 类没漏(但分组 add 逻辑 :148 是 if-else 不受 tsc 保护,要人工核)。

---

## 4. 实现方案(数据层)

### 4.1 bookmark capability 类型

新建 `src/capabilities/bookmark/types.ts`(仿 ebook-library/types.ts 瘦身):
```ts
export interface BookmarkInfo {
  id: string;
  url: string;
  title: string;
  folderId: string | null;  // null = 根
  createdAt: number;
}
export interface BookmarkApi {
  add(url: string, title: string, folderId?: string | null): Promise<BookmarkInfo>;
  list(): Promise<BookmarkInfo[]>;        // 全部书签(扁平,UI 按 folderId 组树)
  rename(id: string, title: string): Promise<void>;
  remove(id: string): Promise<void>;
  moveToFolder(id: string, folderId: string | null): Promise<void>;
  onListChanged(cb: () => void): () => void;
}
```
(具体字段以 ebook 模板为准微调;url 必填、title 可空兜底用 url。)

### 4.2 main 端实现

新建 `src/platform/main/bookmark/capability-impl.ts`(仿 ebook capability-impl):
- `add`:建 `domain='bookmark'` atom,payload `{url, title, createdAt}`;若给 folderId,建 `user:krig:inFolder` 边挂该 folder。
- `list`:查所有 `domain='bookmark'` atom + 各自 inFolder 边算 folderId,返回 BookmarkInfo[]。
- `rename`/`remove`/`moveToFolder`:照 ebook 对应方法。
- `onListChanged`:broadcast 模式(照 ebook)。
- **SurrealDB SQL 形式**:照搬 ebook capability-impl 现有 SQL(别自创新 SQL 形式;若必须新形式,按 `feedback_surrealdb_4x_no_type_thing` 先 grep 仓库现有同款用法 verify)。

新建 `src/platform/main/bookmark/handlers.ts`(仿 library-handlers):ipcMain.handle 各方法 + channel-names 加 BOOKMARK_* channel。注册到 ipc-bus(initIpcBus)。

### 4.3 capability 注册(renderer 侧)

仿 ebook-library 的 capability 注册(`src/capabilities/ebook-library/index.ts`):新建 `src/capabilities/bookmark/index.ts`,把 IPC invoke 包成 BookmarkApi 注册到 capability registry(`requireCapabilityApi<BookmarkApi>('bookmark')` 可用)。grep ebook-library/index.ts 看注册套路。

### 4.4 本步不做 UI

数据层做完,**步骤2 才接 FolderTree UI + 按钮**。本步只保证:capability 能 add/list/rename/remove/moveToFolder,folder 树支持 viewType='web',typecheck + 测试过。

---

## 5. 文件清单(步骤1)

| 文件 | 改动 |
|---|---|
| `src/shared/ipc/note-folder-types.ts` | FolderViewType 加 'web' |
| `src/platform/main/folder/capability-impl.ts` | 6 处硬编码加 web(§3 表)+ CASCADE 加 'bookmark' |
| `src/capabilities/bookmark/types.ts` | **新增** BookmarkInfo + BookmarkApi |
| `src/platform/main/bookmark/capability-impl.ts` | **新增** main 实现(仿 ebook) |
| `src/platform/main/bookmark/handlers.ts` | **新增** IPC handler |
| `src/capabilities/bookmark/index.ts` | **新增** capability 注册 |
| `src/shared/ipc/channel-names.ts` | 加 BOOKMARK_* channel |
| `src/platform/main/ipc/ipc-bus.ts`(或主进程注册处) | 注册 bookmark handlers |
| preload + electron-api.d.ts(若 capability 走 electronAPI)| 按 ebook 模式 |
| `tests/...` | bookmark capability 单测(add/list/rename/remove/move)+ Chrome 解析留步骤3 |

**不动** FolderTree 组件、web view UI(步骤2)、data-model.ts、web-history.ts、web-download。

---

## 6. 坑清单

1. **FolderViewType 6 处硬编码必须全改**(§3)—— 头号坑,漏改 UI 不刷新。typecheck 帮查 Record,但 if-else 分组 :148 人工核。
2. **SurrealDB SQL 别自创**(`feedback_surrealdb_4x_no_type_thing`)—— 照搬 ebook 现有 SQL 形式。
3. **CASCADE_RESOURCE_DOMAINS 加 'bookmark'** —— 否则删文件夹后书签 atom 成孤儿。
4. **严禁字面控制字符**。
5. **inFolder 边方向**:照 ebook 的 moveToFolder(subject/object 方向别搞反,grep ebook 现有)。
6. **测试需 SurrealDB**:capability 单测若依赖真库,看项目现有 storage 测试怎么起(grep tests/storage 的 setup);若太重,至少做"SQL 形式 + 数据转换纯函数"的单测,集成验证留用户 npm start。

---

## 7. 不做的事
- ❌ 不接 FolderTree UI / 不加按钮(步骤2)。
- ❌ 不做 Chrome 导入(步骤3)。
- ❌ 不改 folder 树组件本身(只复用)。
- ❌ 不自创 SurrealDB SQL 形式。
- ❌ 不写字面控制字符。
- ❌ 不 merge/push。

---

## 8. 验收 + 汇报

commit 前:typecheck PASS(尤其 FolderViewType 加 web 后所有 Record 补全)/ 现有单测无回归 / bookmark capability 测试过 / lint 改动文件 PASS / `file` 确认无 null 字节。

手动验证(给用户,完全退出重跑 npm start)—— 数据层无 UI,验证靠:
- 主进程 log 或临时:能否 add 书签 + list 出来(可让用户在 devtools console 调 `window.electronAPI` 或 capability 试,或步骤2 接 UI 后一并验)。
- **本步主要靠 typecheck + capability 测试背书**;真实集成验证可并到步骤2(有 UI 后直观)。汇报里说清。

汇报模板:
```
书签步骤1 数据层(feat/web-downloads)完成:
一、产出(commit hash + 文件数)
二、实现要点(bookmark capability 仿 ebook / FolderViewType 加 web 的 6 处 / SurrealDB SQL 照搬 ebook / CASCADE 加 bookmark)
三、头号风险处理(FolderViewType 6 处硬编码逐一核对结果 + grep 兜底)
四、验收(typecheck/单测/lint/file 无 null 字节)
五、范围外/登记(UI/导入留步骤2/3;集成验证怎么安排)
六、等指挥:进步骤2(树 UI + 按钮)?
```

---

## 9. Self-Contained Check
- ✅ 用户决策(SurrealDB 复用 folder / 分步)
- ✅ ebook 模板文件清单(§2)+ folder 通用基建
- ✅ 头号风险 6 处硬编码行号(§3)
- ✅ bookmark capability 方案(§4)+ 文件清单(§5)
- ✅ 6 坑 + 不做的事(§6-7)
- ✅ 验收 + 汇报(§8)

**外部依赖**:用户 npm start 集成验证(或并到步骤2);指挥拍板进步骤2。SurrealDB SQL 照搬 ebook(实现时现场 grep verify)。

---

*书签步骤1 数据层 · 2026-06-01 · feat/web-downloads · bookmark capability 仿 ebook + 扩 FolderViewType('web')· 复用 folder capability,头号风险=6 处硬编码全改*
