# graph-library-store capability

> v0.2 · 2026-05-12 · L5-G1 + L7-sub3a-1
>
> 配套:
> - [../../../docs/RefactorV2/v1-graph-migration-plan.md](../../../docs/RefactorV2/v1-graph-migration-plan.md) v0.2 § 3.4
> - [../../../docs/RefactorV2/stages/L5G1-graph-platform-and-skeleton-design.md](../../../docs/RefactorV2/stages/L5G1-graph-platform-and-skeleton-design.md) v0.1
> - [decision 014 sub-phase 3a-1](../../../docs/RefactorV2/data-model/persistence/decisions/014-sub-phase-3a-1-graph-canvas-instance-migration.md) — SurrealDB 切换 + Instance + ref + pm 双层
>
> **v0.2 变更**:JSON 磁盘后端 → SurrealDB Sidecar (sub-phase 3a-1 完成)

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

## 持久化路径 (v0.2 — sub-phase 3a-1 切 SurrealDB)

**新 (v0.2)** — SurrealDB Sidecar:

```
SurrealDB rocksdb at userData/krig-data/surreal/
├─ atom 表
│  ├─ graph-canvas domain — 画板容器 (title, variant, view, schemaVersion + 可选字段)
│  ├─ graph-instance domain — 画板内节点 (Instance + ref 模式,无 doc 字段)
│  ├─ pm domain — text-node 的 PM 内容 (sub-phase 2 已注册,本 sub-phase 复用)
│  └─ folder domain — 容器树 (sub-phase 2,graph + note 共享)
└─ edge 表
   ├─ user:krig:inFolder (canvas → folder atom)
   ├─ user:krig:inCanvas (instance → canvas atom) ← 本 sub-phase 新引入
   └─ user:krig:hasContent (text-node instance → pm atom) ← 本 sub-phase 新引入
```

**Instance + ref 模式** (sub-phase 3a-1 走 V2 substance 哲学,而非总纲推演的"每节点一 domain"):
- 所有节点共享 `graph-instance` 单 domain
- 通过 `payload.type` (shape/substance) + `payload.ref` (Library ShapeDef id) 区分形态
- text-node = `ref === 'krig.text.label'` 的特例

**单引用约束** (decision 013 §3.5.1.bis,本 sub-phase 临时态):
- 一段 pm content 只被 1 个 Instance 引用
- 浅引用 / 跨 view 复用留 3a-shared-ref (前置 Q-tx 必做)

**旧 (v0.1,已废弃)** — JSON 磁盘:

```
{userData}/krig-data/graph/      ← 启动时由 clearLegacyGraphStorage 清除
  canvases.json                  (sub-phase 3a-1 §3.6 选项 M)
  documents/{uuid}.json
```

V1 `src/main/storage/graph-store.ts` (SurrealDB,287 行) 在 V2 sub-phase 3a-1 启用后保留作参考。

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

## sub-phase 3a-1 后端切换记录 (decision 014)

| 维度 | v0.1 (JSON 磁盘) | v0.2 (SurrealDB Sidecar) |
|---|---|---|
| 物理后端 | `userData/krig-data/graph/*.json` | SurrealDB Sidecar (rocksdb) |
| Canvas 元数据 | `canvases.json.entries[]` | atom (domain='graph-canvas') |
| Canvas 内容 | `documents/{id}.json.instances[]` | atom (domain='graph-instance') × N + 边 |
| Folder 体系 | `canvases.json.folders[]` (graph 独占) | folder atom (graph + note 共享,sub-phase 2 引入) |
| folder_id 字段 | 直接外键 | 派生自 user:krig:inFolder 边 |
| text-node doc | Instance.doc 字段内嵌 | hasContent 边 + pm atom (view-agnostic) |
| 写入原子性 | atomic tmp+rename | Q-tx 退化无原子 (decision 011 + 014 §3.5.3.6) |
| 跨域 cascade | folder/canvas/instance 各自管 | storage.deleteAtom 应用层 cascade 边 |
| 接口签名 | 不变 (view 透明) | 不变 (view 透明) |

**graph + note + future ebook 共享同一 folder 树** (decision 014 §2.3 + §3.5.3):
- 用户视角:工作 folder 同时装 note 和 graph,不该被工具分裂
- 数据视角:folder 是 KRIG 通用容器,不绑具体内容类型
- 实施:graph 走 sub-phase 2 folder atom + folder-adapter 做字段映射 (parentId ↔ parent_id 等)

**Path Y cascade scope 扩展** (5.6.bis):
- sub-phase 2 deleteFolder 原 cascade 仅 pm domain (note)
- sub-phase 3a-1 扩展到 ['pm', 'graph-canvas'] (未来 ebook 接入再加)
- 删 folder X → 内含 note + canvas 全部 cascade 删

**hasBeenReferenced 单向 flag** (decision 014 §3.7):
- atom 顶层字段,DEFAULT false
- 单引用约束下本 sub-phase 恒 false
- 3a-shared-ref 阶段才会出现 true (前置 Q-tx 必做)

## 不做的事(G1 + sub-phase 3a-1 范围外)

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
