# L5-G1 设计 — Graph 平台基座 + graph-library-store + view 骨架

> v0.2 · 2026-05-10 · 实施后用户 P2 复审(文档内部数字一致性修订)
>
> 配套:
> - [v1-graph-migration-plan.md](../v1-graph-migration-plan.md) v0.2 — 上游迁移设计(15 决策点 + 5 段切片)
> - [v1-ebook-migration-plan.md](../v1-ebook-migration-plan.md) v0.4 — 同位参考(C1 是本段直接复制茨本)
> - [stages/L5C1-ebook-platform-base-completion.md](./L5C1-ebook-platform-base-completion.md) — C1 完成报告(实施模板)
>
> **本段定位**:Graph 迁移 5 段切片(G1~G5)的第一段。**只做基础设施 + 空壳 view**,Three.js 渲染 / Library / 文字节点全部留 G2~G4。

---

## 0. 一句话目标

打开 V2 → NavSide 出现"画板"Tab → 能创建文件夹 / 创建画板 / 看到画板列表 / 重命名 / 删除 / 移动 — 但点击画板项左 slot 显占位"画板加载中(G3 才填)"。

完整对应 v0.2 plan § 5 G1 段验收清单:

> npm start → 切 graph-canvas-view view → NavSide 显「画板」+「+ 文件夹 / + 画板」→ 创建画板见列表更新 → 点击画板项左 slot 显「Loading」(G2 才填)

---

## 1. 范围(In/Out)

### 1.1 本段做(In)

- [x] **platform/main/graph/** 全套:`canvas-store` / `folder-store` / `library-handlers` / `index.ts`(JSON atomic write,模板对齐 `learning/vocab-store.ts` + `ebook/bookshelf-store.ts`)
- [x] **shared/ipc/channel-names** 加 `GRAPH_*` **14 条**(plan v0.2 § 3.7 列 20 条;决策 G1-8 / G1-9 砍 6 条,详见 § 4)
- [x] **platform/main/preload + electron-api.d.ts** 加 graph* invoke + on* 订阅(对齐 ebook 模板)
- [x] **platform/main/ipc/ipc-bus.ts** 接入 `registerGraphHandlers()`
- [x] **capabilities/graph-library-store/** 全套:`client.ts` + `types.ts` + `index.ts`(双导出 + capabilityRegistry.register)+ `DESIGN.md`
- [x] **views/graph-canvas-view/**(对齐 D-1=A 命名):
  - `index.ts` self-register(install: ['graph-library-store'],其他 3 个 capability G2~G4 加)
  - `GraphCanvasView.tsx` 占位空壳(显「画板加载中(G3 才填)」)
  - `data-model.ts` pluginStates['graph-canvas-view'](activeGraphId / expandedFolders / selectedIds — 对齐 ebook data-model)
  - `nav-side-content.tsx` 完整画板列表(FolderTree + 拖拽 + 右键菜单 + 重命名 + 创建文件夹 dialog;**直迁 V1 GraphPanel + useGraphOperations + useGraphSync 共 ~430 行,改写到 V2 框架**)
  - `canvas-commands.ts` `graph-canvas-view.*` 命令注册
  - `graph-canvas-view.css` 壳样式
- [x] **renderer/index.tsx** 加 `import '@capabilities/graph-library-store'` + `import '@views/graph-canvas-view'`
- [x] **alive 自检**:`reportInstallCoverage()` 启动时显示 `graph-canvas-view × ['graph-library-store']` 无 missing

### 1.2 本段不做(Out)

- ❌ `npm install three`(G1 不引入 three,严格版屏障 P1-1 — three 只允许 G3 加;G1 是"基础设施 + 空壳",不需要 three)
- ❌ `capabilities/shape-library/`(G2)
- ❌ `capabilities/canvas-rendering/`(G3 + G4)
- ❌ `capabilities/canvas-text-node/`(G4)
- ❌ Three.js Scene / NodeRenderer / interaction(全部 G3 + G4)
- ❌ Library Picker / Inspector / Combine 对话框(G4)
- ❌ Toolbar 注册到 toolbarRegistry(G5)
- ❌ undo-redo / clipboard 接 V2 capability(D-13=B / D-14=B,留 V1 自管)
- ❌ Canvas API(被 family-tree 调,D-8=A 不实施)

---

## 2. 决策清单(本段细化,与 v0.2 plan § 4 互补)

| # | 决策点 | A(默认) | B(替代) | 推荐 |
|---|---|---|---|---|
| **G1-1** | view id 字面值 | **`graph-canvas-view`**(用户拍板 D-1=A,2026-05-10) | `graph-canvas` / `graph` | A — 已落定 |
| **G1-2** | nav-side tab 顺序 | **order=4**(Note=1 / eBook=2 / Web=3 / **Graph=4**) | order=5(留 Web translate variant 占 4) | A — 简单递增 |
| **G1-3** | nav-side tab 图标 | **`🎨`**(对齐 V1 main/register.ts icon) | 其他 | A — 与 V1 一致 |
| **G1-4** | 持久化文件路径 | **`{userData}/krig-data/graph/`** + `canvases.json` 元数据 + `documents/{id}.json` 每画板一文件 | 单 `canvases.json` 含全部 doc_content(V1 SurrealDB 等价) | **A**(B 不可:画板 doc_content 可能很大,几百节点 Canvas Document JSON 几百 KB,放一个 JSON 文件每次 save 全文重写有成本)。**A 路径**:`canvases.json` 只存 list 元数据(id / title / variant / folder_id / created_at / updated_at);doc_content 走每画板一文件 `documents/{id}.json`(对齐 ebook `library/{id}.{ext}` 模式) |
| **G1-5** | folders 存哪 | **同 `canvases.json`**(folders 数量少,内嵌)| 单独 `folders.json` | **A**(对齐 ebook `bookshelf-store.ts` 把 entries + folders 内嵌一个 JSON 模式)|
| **G1-6** | 画板 doc_content 在 list 的形态 | **不返回 list 时**(只返 GraphCanvasListItem 元数据,需要时单独 load)| list 也返 doc_content | **A** — list 用作 NavSide 列表显示,doc_content 占大头不该带 |
| **G1-7** | activeGraphId 落 main 还是 renderer | **renderer pluginStates**(D-2=A) — 沿用 ebook activeBookId 模式,不存 main `WorkspaceState` | main 持 | A — D-2 已落定 |
| **G1-8** | 启动恢复入口 | **getActiveId() IPC fallback**(对齐 V1 GRAPH_GET_ACTIVE) | 仅从 pluginStates 恢复 | **B**(简化):pluginStates['graph-canvas-view'].activeGraphId 由 workspaceState 自动持久化,启动 view mount 时直接读;**不**保留 GRAPH_GET_ACTIVE / GRAPH_SET_ACTIVE 两条 IPC(v0.2 plan § 3.7 的 fallback 设想取消,理由:ebook 也没用,实际用不上) |
| **G1-9** | onGraphOpenInView 推流是否本段做 | **A 做** — 对齐 V1 GRAPH_OPEN_IN_VIEW(NavSide 单击书项 / 命令 → 推 view 端打开) | 暂不做,view 端订阅 onGraphListChanged 自己判断 | **B**(简化):G1 不做跨 slot 推流,view 端通过 commandRegistry.execute('graph-canvas-view.open-canvas', id) 同 renderer 内同步切;`GRAPH_OPEN_IN_VIEW` IPC 不做。**对齐 ebook 模式**(ebook 也是命令路由,不走 main 推流) |
| **G1-10** | duplicate 是否本段实现 | **A 实现** | B 留后续 | **A** — V1 已实现,迁移成本低,且 NavSide 右键菜单需要 |
| **G1-11** | rename 是否本段实现 | **A 实现** | B 留后续 | **A** — V1 已实现,NavSide rename 需要 |
| **G1-12** | nav-side 列表是否分组(按 variant 分组) | A 分组(canvas / family-tree / knowledge / mindmap 各一节) | **B 平铺**(v1 只 canvas,平铺无歧义,family-tree 接入时再看是否分组) | **B** — 简化,family-tree 接入时再决定 |

---

## 3. 文件清单(物理路径 + LOC)

### 3.1 新增 — design 估算 vs 实际(实施后回填,2026-05-10)

```
src/platform/main/graph/
├── canvas-store.ts             估 ~260 / 实 366 行(JSON 实现 + folder ops 合并,见 G1-5;
│                                +106 实测高于估算:atomic write helpers + load/save/
│                                deleteDocument 工具 + sanity guards + emptyDocument
│                                兜底,V1 287 行 SurrealDB 版本基础上的"原子保证 + 类型守卫"
│                                额外开销)
├── library-handlers.ts         估 ~150 / 实 149 行(IPC handler 14 条 — 决策 G1-8 / G1-9
│                                砍 6 条(plan 20 - 14 = 6);对齐 ebook library-handlers.ts
│                                307 行精简版,因为 graph 没 pickFile / getData / annotation 等)
└── index.ts                    估 ~30  / 实 16  行(轻量 re-export,initGraphPlatform 入口)

src/capabilities/graph-library-store/
├── types.ts                    估 ~80  / 实 85  行(GraphCanvasRecord / GraphCanvasListItem /
│                                GraphFolderRecord / GraphVariant / GraphLibraryStoreApi)
├── index.ts                    估 ~180 / 实 171 行(client + 双导出 + capabilityRegistry.register;
│                                估算从 ~250 调下来,因为没有 ebook getData / annotation /
│                                bookmark 等额外路径)
└── DESIGN.md                   估 ~100 / 实 122 行(对齐 ebook-library DESIGN 模板 +
                                与 ebook-library 对照差异表)

src/views/graph-canvas-view/
├── index.ts                    估 ~40  / 实 48  行(self-register + 3 个 register* 触发)
├── GraphCanvasView.tsx         估 ~80  / 实 66  行(占位空壳 — empty + placeholder 双态)
├── GraphCanvasToolbar.tsx      估 ~50  / 实 67  行(占位 — title 显示 + onGraphListChanged 订阅)
├── data-model.ts               估 ~140 / 实 148 行(pluginStates + 持久化 + transient selectedIds,
│                                对齐 ebook 161 行)
├── nav-side-content.tsx        估 ~450 / 实 418 行(FolderTree + 重命名 + 拖拽 + 右键 + 命令路由,
│                                对齐 ebook 640 行精简 35% — 删 ImportModal / pickFile /
│                                relocate / transferToManaged / openFailed toast)
├── canvas-commands.ts          估 ~150 / 实 161 行(commandRegistry 注册 8 条 + 3 个 trigger
│                                桥 + tree id encode/decode)
└── graph-canvas-view.css       估 ~80  / 实 85  行(壳样式)

合计:driver 估 ~1610 / 实 1780 行(+11% 实测偏差,canvas-store 单文件高估;其他文件估算精准)
      DESIGN  估 ~100  / 实 122 行
      CSS     估 ~80   / 实 85  行
```

> **G1-5 决策修订**:design v0.1 § 3.1 原写"folder-store.ts ~80 行(从 canvas-store 内分离)"
> 加注脚"G1-5=A 决策合并"。本表归并到 canvas-store.ts 一行,canvas-store 估算从 180 调整为 260
> (180 + 80)。实施时实测 366 行,主要溢出在 atomic write 辅助 + 类型守卫 + 兜底逻辑。

### 3.2 修改

```
src/shared/ipc/channel-names.ts                 + 14 条 GRAPH_* 常量(v0.2 plan 19 - 砍 5,详见 § 4)
src/shared/ipc/electron-api.d.ts                + graph* 方法签名 14 条
src/platform/main/preload/main-window-preload.ts + graph* invoke / on* 实现 14 条
src/platform/main/ipc/ipc-bus.ts                + registerGraphHandlers() 调用
src/platform/renderer/index.tsx                  + 2 行(@capabilities/graph-library-store + @views/graph-canvas-view)
```

### 3.3 与 v0.2 plan § 5 G1 段对照

| v0.2 plan G1 项 | G1 design 对应 |
|---|---|
| platform/main/graph/(全套) | § 3.1 第一组 |
| shared/ipc/channel-names 加 GRAPH_* 14 条(plan 19 砍 5)| § 3.2 + § 4 |
| platform/main/preload | § 3.2 |
| capabilities/graph-library-store/ | § 3.1 第二组 |
| views/graph-canvas-view/ | § 3.1 第三组 |
| 安装 npm `three`(锁版本) | **本段不做(G1-Out)** — 留 G3 引入,白名单只 canvas-rendering;G1 暂不需 |

> ⚠️ v0.2 plan § 5 G1 表格里写"安装 npm three(锁版本)"是合并 G1 + G3 前置的笔误。实际 G3 才需要 three,G1 完全不引。本段 G1-Out 明确这一点。

---

## 4. IPC channel 完整清单(GRAPH_* 14 条)

完全对齐 v0.2 plan § 3.7。本段全部实施 + 注册 handler。`GRAPH_SET_ACTIVE` / `GRAPH_GET_ACTIVE` / `GRAPH_OPEN_IN_VIEW` 三条**取消**(决策 G1-8 / G1-9):

```ts
// ── graph 画板 CRUD ──
GRAPH_LIST: 'graph.list',
GRAPH_LOAD: 'graph.load',
GRAPH_CREATE: 'graph.create',
GRAPH_SAVE: 'graph.save',
GRAPH_DELETE: 'graph.delete',
GRAPH_RENAME: 'graph.rename',
GRAPH_MOVE_TO_FOLDER: 'graph.move-to-folder',
GRAPH_DUPLICATE: 'graph.duplicate',
GRAPH_LIST_CHANGED: 'graph.list-changed',         // main → renderer 推送

// ── graph 文件夹 ──
GRAPH_FOLDER_LIST: 'graph.folder-list',
GRAPH_FOLDER_CREATE: 'graph.folder-create',
GRAPH_FOLDER_RENAME: 'graph.folder-rename',
GRAPH_FOLDER_DELETE: 'graph.folder-delete',
GRAPH_FOLDER_MOVE: 'graph.folder-move',
```

合计 **14 条**(plan v0.2 § 3.7 列 20 条 — 决策 G1-8 / G1-9 砍 6 条:GRAPH_PENDING_OPEN /
GRAPH_OPEN_IN_VIEW / GRAPH_DELETED / GRAPH_TITLE_CHANGED / GRAPH_SET_ACTIVE /
GRAPH_GET_ACTIVE;统一走 GRAPH_LIST_CHANGED 一条推送通道替代多条专用 — 列表 / 重命名 /
删除变更 view 端订阅同一 channel 自己 diff)。

> **对照 ebook**:ebook 用 28 条,graph 用 14 条 — graph 不需要 PICK_FILE / GET_DATA / LOADED / RELOCATE / TRANSFER / SAVE_PROGRESS / BOOKMARK_* / CFI_* / ANNOTATION_*;只剩 list/CRUD/folder/changed-broadcast。

---

## 5. capabilityRegistry api 形状

**graph-library-store** 完整 API(对齐 v0.2 plan § 3.4,但删除 G1-8/G1-9 取消的 4 条):

```ts
export interface GraphLibraryStoreApi {
  // 画板 CRUD
  list(): Promise<GraphCanvasListItem[]>;
  load(id: string): Promise<GraphCanvasRecord | null>;
  create(title: string, variant: GraphVariant, folderId?: string | null): Promise<GraphCanvasRecord | null>;
  save(id: string, docContent: unknown, title: string): Promise<void>;
  delete(id: string): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  moveToFolder(id: string, folderId: string | null): Promise<void>;
  duplicate(id: string, targetFolderId?: string | null): Promise<GraphCanvasRecord | null>;

  // 文件夹 CRUD
  folderList(): Promise<GraphFolderRecord[]>;
  folderCreate(title: string, parentId?: string | null): Promise<GraphFolderRecord | null>;
  folderRename(id: string, title: string): Promise<void>;
  folderDelete(id: string): Promise<void>;
  folderMove(id: string, parentId: string | null): Promise<void>;

  // 推送
  onGraphListChanged(cb: (list: GraphCanvasListItem[]) => void): () => void;
}
```

---

## 6. 持久化文件结构(决策 G1-4 + G1-5)

```
{userData}/krig-data/graph/
├── canvases.json                  metadata + folders 合一
│                                  形态:{ version: '1', entries: [...], folders: [...] }
│                                  entries 是 GraphCanvasListItem(无 doc_content)
└── documents/
    ├── {id1}.json                 GraphCanvasRecord.doc_content(每画板一文件)
    ├── {id2}.json
    └── ...
```

**save 时**:写 `documents/{id}.json` + 更新 `canvases.json` 中 entry.updated_at + atomic write 两个文件。

**load 时**:读 `documents/{id}.json`(metadata 已在内存)。

**list 时**:返回内存 entries(不读 documents/)。

**delete 时**:从 entries 移除 + 删 documents/{id}.json(失败忽略)。

> 这与 ebook `library/{id}.{ext}` 直接复制 PDF/EPUB 文件的模式一致,但 graph 是 JSON(渲染层产生的结构化文档),不是用户上传的二进制文件。

---

## 7. NavSide 重命名 + 创建文件夹 + 拖拽 + 右键 — 直迁路径

**完全复用 ebook nav-side-content.tsx 模板**(640 行 → graph 版 ~450 行,简化掉 ImportModal / pickFile 流程,因为画板创建不需选文件):

| ebook 功能 | graph 对应 |
|---|---|
| pickFile + ImportModal | **删除** — graph 创建直接调 `library.create('Untitled Canvas', 'canvas', null)` |
| `📕` icon | `🎨` |
| FILE_ICONS(pdf/epub/djvu/cbz) | 暂时统一 `🎨`(v1 只 canvas variant,family-tree 接入时再加 VARIANT_ICONS — v0.2 plan 已规划) |
| relocate / transferToManaged 右键项 | **删除** — graph 不需(画板没文件丢失场景) |
| openFailedTrigger | **删除** |
| FolderTree onClick → 命令 `ebook-view.open-book` | onClick → 命令 `graph-canvas-view.open-canvas` |
| 重命名 inline | **保留** |
| 创建文件夹 / 子文件夹 | **保留** |
| 删除单项 / 删文件夹 | **保留** |
| 拖拽到文件夹 | **保留** |
| 右键菜单(rename / delete / move) | **保留** + 加 duplicate |

---

## 8. data-model 形状(对齐 ebook,简化字段)

```ts
// pluginStates['graph-canvas-view'] 持久化形态
interface PersistedGraphCanvasWsState {
  activeGraphId: string | null;
  expandedFolders: string[];          // Set 序列化为 string[]
}

// 内存形态(hydrate 后)
interface GraphCanvasWorkspaceState {
  activeGraphId: string | null;
  expandedFolders: Set<string>;
  selectedIds: Set<string>;           // transient — 不持久化(对齐 ebook Q8=B)
}
```

**G1 不含**:viewport / inspectorOpen / addModeKey 等画板内交互状态(留 G3 接 canvas-rendering Host 时加)。

---

## 9. GraphCanvasView 占位形态(G1 暂用)

```tsx
export function GraphCanvasView({ workspaceId }: GraphCanvasViewProps) {
  const wsState = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => {
      const ws = workspaceManager.get(workspaceId);
      return ws ? getGraphCanvasWsState(ws) : null;
    },
  );
  const activeGraphId = wsState?.activeGraphId ?? null;

  return (
    <div className="krig-graph-canvas-view">
      <GraphCanvasToolbar activeGraphId={activeGraphId} />
      <div className="krig-graph-canvas-view__body">
        {activeGraphId == null ? (
          <div className="krig-graph-canvas-view__empty">
            从左侧选择画板,或点 NavSide 「+ 画板」新建
          </div>
        ) : (
          <div className="krig-graph-canvas-view__placeholder">
            画板加载中(Three.js 渲染留 G3 段)
            <div className="krig-graph-canvas-view__graph-id">
              activeGraphId: {activeGraphId}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

> G3 会把 `__placeholder` 替换成 `<Host ref={hostRef} ... />`;G1 不实施任何渲染管线。

---

## 10. 命令清单(commandRegistry 注册)

| 命令 id | G1 触发点 | 行为 |
|---|---|---|
| `graph-canvas-view.create-canvas` | NavSide actions [+ 画板] | `library.create('Untitled Canvas', 'canvas', null)` + 自动 setActiveGraphId(创建即打开) + 进重命名态 |
| `graph-canvas-view.create-folder` | NavSide actions [+ 文件夹] | `library.folderCreate('新建文件夹', null)` + 进重命名态 |
| `graph-canvas-view.create-folder-in` | 文件夹右键 | `library.folderCreate('新建文件夹', parentId)` + 父自动展开 |
| `graph-canvas-view.open-canvas` | 单击书项 / NavSide tree onClick | `setActiveGraphId(wsId, graphId)`(view 端 useEffect 接管 load) |
| `graph-canvas-view.rename` | 右键菜单 / 双击 | 触发 inline rename(rename trigger 桥) |
| `graph-canvas-view.delete` | 右键菜单 / Delete 键 | `library.delete(id)` 或 `library.folderDelete(id)`(decodeTreeId 区分) |
| `graph-canvas-view.duplicate` | 右键菜单 | `library.duplicate(id)` |
| `graph-canvas-view.move-to-folder` | 拖拽 | `library.moveToFolder(canvasId, folderId)` |

---

## 11. 自我诊断(charter § 5)

启动时 console 应显示:

```
[Capability] alive | registered: [..., 'graph-library-store']
[L5] View alive | active: '...', registered views: [..., 'graph-canvas-view']
[install-coverage] graph-canvas-view × ['graph-library-store']  ✓
```

健康检查 IPC `health.platform` 返回值含 `graph-library-store` 已挂(由 ipc-bus 注册时计数)。

---

## 12. 完成判据(charter § 6.3)

| 项 | 标准 |
|---|---|
| ✅ npm start 跑得起来 | 无报错,window 出来 |
| ✅ 用户能看到该层功能 | NavSide 显「画板」Tab + 「+ 文件夹」「+ 画板」按钮 |
| ✅ console 打印 alive 行 | `[Capability] alive` 含 `graph-library-store`;`[L5] alive` 含 `graph-canvas-view` |
| ✅ 上一层 alive 行也在 | L0~L4 alive 行无回归 |
| ✅ install-coverage 0 missing | dev 模式启动显示 graph-canvas-view × 1 capability,无 missing |
| ✅ typecheck 0 error | tsc --noEmit |
| ✅ lint 0 warn | eslint . |

---

## 13. 用户验收清单

按此顺序手测:

1. **启动**:`npm run dev` → 出窗口 → console 显 graph-canvas-view alive 行
2. **切 view**:WorkspaceBar 按 + → 选 graph-canvas-view(或在 ws 创建时选)→ NavSide 显「画板」Tab + 「+ 文件夹」「+ 画板」按钮
3. **创建文件夹**:点 + 文件夹 → 「新建文件夹」出现 + 自动进重命名态 → 输「测试文件夹」回车 → 持久化到 canvases.json
4. **创建画板**:点 + 画板 → 「Untitled Canvas」出现在根级 + 自动进重命名态 → 输「测试画板」回车 → 持久化到 canvases.json + documents/{id}.json
5. **打开画板**:单击「测试画板」→ 主 slot 显「画板加载中(G3)」+ activeGraphId 显示在 placeholder
6. **重启恢复**:关 app → 重启 → 上次活跃 ws 自动打开「测试画板」(activeGraphId 通过 pluginStates 恢复)
7. **重命名**:右键画板项 → 重命名 → 「测试画板 v2」→ NavSide 列表更新
8. **复制**:右键画板项 → 复制 → 「测试画板 v2 (副本)」出现
9. **移动**:拖「测试画板 v2」到「测试文件夹」→ 文件夹下显示画板
10. **删除画板**:右键 → 删除 → 列表移除 + documents/{id}.json 删除
11. **删除文件夹**:右键文件夹 → 删除 → 子画板回根级
12. **多 workspace 隔离**:开两个 ws → 各自看到同一书架(全局共享) + 各自 activeGraphId 独立(per-ws)

---

## 14. 风险登记

| 风险 | 缓解 |
|---|---|
| nav-side-content 直迁 ebook 模板时,ebook 特有的 ImportModal / pickFile 路径如果删错会触发空 trigger | 编译期类型确认 + 运行时只测必要路径(create-canvas / create-folder / rename / delete / move / duplicate) |
| activeGraphId 持久化与 ebook activeBookId 同模式但不同 key,容易复制粘贴不改 STORE_KEY | 单独 const STORE_KEY = 'graph-canvas-view' + grep 验证 |
| canvases.json + documents/{id}.json 双文件 atomic write 不是真正的原子(两步操作中间挂掉会留孤儿)| save 顺序:先写 documents/{id}.json → 再更新 canvases.json(metadata 是真理之源,孤儿 documents/ 文件可后期 GC);**G1 不做 GC**,留 v1.5+ |
| WorkspaceState 字段没有 expandedFolders → 无法持久化展开状态(对齐 ebook 的 Set ↔ string[] 序列化路径)| 完全复用 ebook data-model 的 hydrate / writePersistent 模式 |
| commit 拆分时 Commit 1(platform)单独跑会因为 view 还没注册而 install-coverage 抱怨 | 容忍,Commit 2 接上后 0 missing |

---

## 15. 实施分 commit

按 ebook C1 的"双 commit"模式:

### Commit 1 — platform 层(估 ~600 / 实 628 行 + 0 warn 0 error)
- `src/platform/main/graph/canvas-store.ts` + `library-handlers.ts` + `index.ts`(366+149+16=531)
- `src/shared/ipc/channel-names.ts` 加 GRAPH_* 14 条(+17 行)
- `src/shared/ipc/electron-api.d.ts` + `src/platform/main/preload/main-window-preload.ts`(+22+56=78 行)
- `src/platform/main/ipc/ipc-bus.ts` 接入 `registerGraphHandlers()`(+2 行)
- 验证:typecheck 0 + lint 0 warn

### Commit 2 — capability + view(估 ~1100 / 实 1373 行 + 0 warn 0 error)
- `src/capabilities/graph-library-store/types.ts` + `index.ts` + `DESIGN.md`(85+171+122=378)
- `src/views/graph-canvas-view/`(7 文件,GraphCanvasView 66 / Toolbar 67 / data-model 148 /
  nav-side 418 / commands 161 / index 48 / CSS 85 = 993)
- `src/platform/renderer/index.tsx` + 2 行
- 验证:§ 13 用户验收 12 项全过

> 顺序:Commit 1 → Commit 2 → 用户验收 → 用户拍板"通过"才合并 main。

> **实测偏差说明**(2026-05-10):Commit 1 接近估算(+5%);Commit 2 高于估算(+25%),主要在
> nav-side-content + canvas-commands + DESIGN.md 三处微涨。屏障 grep 自检 0 命中(view 0 import three
> / view 0 运行时 import @capabilities)。

---

## 16. 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-05-10 | v0.1 | 初稿;G1 范围 + 12 决策点 + 文件清单 + IPC 14 条 + nav-side 直迁 ebook 模板路径 + 12 项验收清单 + 双 commit 拆分 |
| 2026-05-10 | v0.2 | 实施后用户 P2 复审 — 文档内部数字一致性修订:① § 3.1 文件清单 LOC 改为"估算 vs 实际"双列(实施 commit 466021f + 2521466 后回填),发现 canvas-store.ts 估 ~180 / 实 366 行(folder ops 合并 + atomic write helpers + 类型守卫 + 兜底逻辑共溢出 ~106 行);② § 1.1 / § 3.2 / § 3.3 / § 4 标题 "GRAPH_* 19 条"全文统一为 "14 条"(v0.1 沿用 plan v0.2 § 3.7 笔误,plan 实际列 20 条 — 决策 G1-8 / G1-9 砍 6 条 = 14);③ § 4 末尾"砍 5 / 共 6 条"算术矛盾改写为"砍 6 条";④ § 15 双 commit 估算改"估 vs 实"双列(Commit 1 估 ~600 / 实 628;Commit 2 估 ~1100 / 实 1373 — 主要在 nav-side / commands / DESIGN 三处微涨);⑤ 加"实测偏差说明"段 + 屏障 grep 自检 0 命中佐证 |
