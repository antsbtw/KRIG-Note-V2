# graph-library-store capability

> v0.1 · 2026-05-10 · L5-G1
>
> 配套:[../../../docs/RefactorV2/v1-graph-migration-plan.md](../../../docs/RefactorV2/v1-graph-migration-plan.md) v0.2 § 3.4 +
> [../../../docs/RefactorV2/stages/L5G1-graph-platform-and-skeleton-design.md](../../../docs/RefactorV2/stages/L5G1-graph-platform-and-skeleton-design.md) v0.1

## 职责

把 main 进程的 graph 持久化能力(画板 + 文件夹)封装成 renderer 端 API。

view + 后续 canvas-rendering capability 都通过此 capability 读写,**view 不直触 storage**(audit § R5 闭环)。

形态完全对齐 ebook-library — graph 是 ebook 的"轻量同位姐妹"(没有渲染引擎二进制 buffer / 没有 pickFile / 没有标注;只有列表 + CRUD + 推送)。

## 实现位置

| 层 | 路径 | LOC | 备注 |
|---|---|---|---|
| Renderer 入口 | `src/capabilities/graph-library-store/index.ts` | ~150 | IPC 调用封装 + Registry 注册 |
| 类型 | `src/capabilities/graph-library-store/types.ts` | ~80 | 与 IPC 边界两侧形状对齐 |
| Main 实现 | `src/platform/main/graph/` | ~480 | canvas-store + library-handlers |
| IPC channel | `src/shared/ipc/channel-names.ts` 新增 14 条 `GRAPH_*` | ~17 | |
| preload 暴露 | `src/platform/main/preload/main-window-preload.ts` 末尾追加 | ~55 | |
| electron-api 类型 | `src/shared/ipc/electron-api.d.ts` 末尾追加 | ~22 | |

## 持久化路径(D-3=B JSON 起步)

```
{userData}/krig-data/graph/
  canvases.json               ← 元数据 + folders 合一(version='1' + entries[] + folders[])
                                  entries 是 GraphCanvasListItem(无 doc_content)
  documents/
    {uuid}.json               ← GraphCanvasRecord.doc_content(每画板一文件)
```

**save 顺序**:先写 `documents/{id}.json` → 再更新 `canvases.json`(metadata 是真理之源,
中途挂掉留孤儿 documents/ 文件可后期 GC,G1 不做 GC)。

写入策略:atomic — `*.tmp` → `fs.renameSync`(POSIX 保证原子);防"写一半挂掉损坏旧数据"。
对齐 V2 既有 `learning/vocab-store.ts` / `ebook/bookshelf-store.ts` 模式。

## 退出条件(对齐 v0.2 D-4)

C5 / G5 验收 + 稳定 ≥2 周 + 独立 SurrealDB 客户端 epic(候选 W6)落地 → 整体迁
`src/storage/graph/` + 升 SurrealDB 实现。V1 `src/main/storage/graph-store.ts`
(SurrealDB,287 行)保留作 W6 起点参考,不删。

## API 形状

详见 `types.ts` 的 `GraphLibraryStoreApi` 接口。

扁平化方法,对齐 ebook-library / ytdlp / learning 风格:

```ts
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { GraphLibraryStoreApi } from '@capabilities/graph-library-store/types';

const library = requireCapabilityApi<GraphLibraryStoreApi>('graph-library-store');

// 列画板
const canvases = await library.list();

// 订阅列表变化(create / save / rename / delete / move / duplicate / folder ops 全广播)
useEffect(() => library.onGraphListChanged(setCanvases), []);

// 创建画板(自动分配 id,默认空 doc_content)
const record = await library.create('Untitled Canvas', 'canvas', null);

// 加载画板
const full = await library.load(canvasId);   // 含 doc_content

// 保存画板内容(view 防抖 1s 调一次)
await library.save(canvasId, docJson, title);
```

## 与 ebook-library 的对照差异

| 维度 | ebook-library | graph-library-store |
|---|---|---|
| 业务对象 | 用户上传的 PDF/EPUB(二进制) | 用户创作的画板 JSON |
| 文件结构 | `bookshelf.json` + `library/{id}.{ext}`(原文件副本)+ `annotations/{bookId}.json` | `canvases.json` + `documents/{id}.json`(画板内容) |
| 加载路径 | `pickFile + add` 选文件 → main 内存 buffer → `getData()` | `create` 直接生成空画板 → `load(id)` 拿 doc_content |
| 标注 | `annotation-*` 系列 IPC | 不需要(画板 substance 嵌入 doc_content) |
| 进度 | `saveProgress + bookmark + cfiBookmark` | 不需要(画板视口在 doc_content 内) |
| IPC channel 数 | 28 条 | 14 条 |

## W5 严格态边界(audit § 5.2 A)

- **View 侧(强制)**:走 `requireCapabilityApi('graph-library-store')` 间接路由,
  不直 import `@capabilities/graph-library-store` 运行时值
- **Driver/slot 侧(允许)**:可直 import 单例 export 兜底(临时允许项,B/C
  达成时统一改造)
- 模块级 export 同时挂(双导出),对齐 V2 既有 capability 现行写法

## 装配关系(charter § 1.3 表格)

- graph-library-store 内部依赖:**仅** `@slot/capability-registry`(注册自身)
- graph-library-store 不依赖 driver(本 capability 无 driver 层)
- graph-library-store 不依赖 canvas-rendering / shape-library / canvas-text-node
  (底层数据能力,被这三者反向消费)

## 零业务 npm import

本 capability 是纯 IPC 客户端,**仅** import:
- `@slot/capability-registry/capability-registry`(Registry 注册)
- 相对路径 `./types`(纯类型)

`window.electronAPI.graph*` 由 preload 注入,不算 npm import。

## 不做的事(G1 范围外)

| 不做 | 说明 |
|---|---|
| Three.js 画板渲染 | 留 G3 canvas-rendering capability(`three` 屏障核心) |
| Shape / Substance 资源仓库 | 留 G2 shape-library capability(0 import three) |
| 文字节点 PM 桥接 | 留 G4 canvas-text-node capability |
| activeGraphId 等 per-ws 状态 | 在 view 端走 pluginStates(D-2=A) |
| Canvas 调用 API(family-tree 等用) | D-8=A 不实施,API 形状 v0.2 plan § 3.4 已预留 |
| Toolbar 注册到 toolbarRegistry | 留 G5(D-12=A) |
| 画板 undo/redo 接 V2 capability | D-13=B 留 V1 自管 |
| 画板剪贴板接 V2 capability | D-14=B 留 V1 自管 |
