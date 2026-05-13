# pm-content capability

> v0.1 · 2026-05-12 · L7-sub3a-1
>
> 配套:[decision 014 sub-phase 3a-1](../../../docs/RefactorV2/data-model/persistence/decisions/014-sub-phase-3a-1-graph-canvas-instance-migration.md) §3.4

## 定位

**view-agnostic pm atom CRUD** — graph 画板 text-node Instance 持有的 PM 内容
通过 `user:krig:hasContent` 边指向独立 pm atom,本 capability 管理这种 pm atom
的生命周期。

跟 `noteCapability` (sub-phase 2) 共享底层 `pm` atom domain 但**互不调用**:

| Capability | 职责 | 触达 storage |
|---|---|---|
| noteCapability | note view + folder 管理 (note = pm atom 1:1) | 自身 main 端 capability-impl |
| pmContentCapability | graph 端 Instance.doc 的 pm atom CRUD | 自身 main 端 capability-impl |

## 实现位置

| 层 | 路径 | 备注 |
|---|---|---|
| Renderer 入口 | `src/capabilities/pm-content/index.ts` | IPC 封装 + Registry 注册 |
| 类型 | `src/capabilities/pm-content/types.ts` | re-export from `@shared/ipc/pm-content-types` |
| Shared IPC 类型 | `src/shared/ipc/pm-content-types.ts` | `PmAtomInfo` + `PmDocEnvelope` |
| Main 实施 | `src/platform/main/pm-content/` | capability-impl + handlers + index |
| IPC channel | `src/shared/ipc/channel-names.ts` 新增 3 条 `PM_CONTENT_*` | — |
| preload 暴露 | `src/platform/main/preload/main-window-preload.ts` 末尾追加 | 3 个 bridge |
| electron-api 类型 | `src/shared/ipc/electron-api.d.ts` 末尾追加 | 3 个签名 |

## API 形状

```ts
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { PmContentCapabilityApi } from '@capabilities/pm-content/types';

const pm = requireCapabilityApi<PmContentCapabilityApi>('pm-content');

// 创建独立 pm atom (graph-library-store update 时为 text-node 调用)
const info = await pm.createPmAtom({
  format: 'pm-doc-json',
  version: '0.1',
  payload: { type: 'doc', content: [/* PM nodes */] },
});

// 读 pm atom
const got = await pm.getPmAtom(info.id);

// 更新内容
const upd = await pm.updatePmAtom(info.id, newEnvelope);
```

返回的 `PmAtomInfo`:

```ts
{
  id: string;
  doc: PmDocEnvelope;       // DriverSerialized 等价体
  hasBeenReferenced: boolean; // 3a-1 单引用约束下恒 false
  createdAt: number;
  updatedAt: number;
}
```

## 单引用约束 (decision 013 §3.5.1.bis)

本 sub-phase 实施**单引用模式**:一段 pm content 只被 1 个 Instance 引用。

**capability 内严守**:
- `createPmAtom` 永远创建新 atom (新 ULID)
- `updatePmAtom` 仅替换内容,不改 `hasBeenReferenced`
- 无任何接口创建"第 2 条 hasContent 边指向同 pm atom"的路径

**hasContent 边写路径** (`src/platform/main/graph/canvas-store.ts`):
- `createInstance` text-node 分支 — 总是新 pm atom + 第 1 条 hasContent 边
- `updateInstance` text-node + 无 pm 分支 — instance 之前必无 hasContent 边,新建仍是第 1 条
- 两个写路径都不会产生"第 2 条边指向同 pm atom"

**hasBeenReferenced flag**:
- 本 sub-phase capability 永远不置 true (浅引用 / 跨 view 复用是 3a-shared-ref 才引入)
- atom 顶层字段,schema DEFAULT false 兜底
- 单向 flag,永不复位 (decision 013 §3.5.1)

## 未来扩展 (3a-N+)

留待后续 sub-phase 实施的方法 (本 sub-phase 暂不实施):

| 方法 | 用途 | 触发 sub-phase |
|---|---|---|
| `listOrphaned()` | 游离 pm atom 列表 (无任何引用边) | 3a-N+ 内容管理入口 |
| `listReferences(id)` | 反查 pm atom 的引用 wrapper | 3a-shared-ref (前置 Q-tx) |
| `deletePmAtom(id)` | "彻底删除内容"高级路径 | 3a-N+ 内容管理入口 |
| `forceDetachWrapper(nodeId)` | 强制断引用 | 3a-shared-ref |
| `getReferencedFlag(id)` | flag 查询 | 3a-shared-ref (本 sub-phase 恒 false 不必查) |

## 进程边界

- main 端 capability-impl 直接 `import { storage } from '@storage/index'`
- 不引入 capability 互调 (pm-content ↮ note,见 decision 014 §3.4)
- main 端模块同进程直调走 `import { ... } from '@platform/main/pm-content'`

## W5 严格态边界

- **View 侧 (强制)**:走 `requireCapabilityApi('pm-content')` 间接路由
- **Driver/slot 侧 (允许)**:可直 import `pmContentCapability` 单例兜底 (临时允许项)
- 模块级 export 同时挂 (双导出),对齐 V2 既有 capability 现行写法

## 跟 noteCapability 的关系 (明确不合并)

| 维度 | noteCapability | pmContentCapability |
|---|---|---|
| Atom domain | 'pm' (sub-phase 2 注册) | 'pm' (复用,本 sub-phase 不重注册) |
| 业务对象 | note 视图 + folder 管理 | text-node Instance.doc |
| 信封 | `NoteDocEnvelope` (含 derive title) | `PmDocEnvelope` (等价 envelope,无 title 派生) |
| Folder 关联 | 直接走 inFolder 边 | 不关联 folder (由 graph instance 间接归属画板再归属 folder) |

**已知问题** (留 3a-2.5 解决):

`noteCapability.listNotes()` 扫所有 `'pm'` atom → graph text-node 的独立 pm atom
会被误列在 note view 列表里。这是 sub-phase 2 + 3a-1 共同设计的隐含问题,
decision 014 §3.4 注释明确"sub-phase 3a-2.5 升级 noteCapability 时可考虑合并",
暗示当前共享 pm domain 是有意设计。

修复路径 (3a-2.5):
- 方案 A:noteCapability 内部加 hasContent 反查,过滤掉被 hasContent 引用的 pm atom
- 方案 B:note 用独立 atom domain (如 'note-pm') 而非共享 'pm'
- 方案 C:noteCapability 重构为内部调 pmContentCapability,统一管理路径
