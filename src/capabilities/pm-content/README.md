# pm-content capability

view-agnostic pm atom CRUD,由 decision 014 §3.4 引入 (sub-phase 3a-1)。

## 定位

graph 画板的 text-node (Instance with `ref === 'krig.text.label'`) 持有的 PM 内容通过
`user:krig:hasContent` 边指向独立 pm atom。本 capability 管理这种 pm atom 的生命周期:

- `createPmAtom(envelope)` — 新建独立 pm atom (graph-library-store 在 update 时调用)
- `getPmAtom(id)` — 读 (graph-library-store 在 load 时调用)
- `updatePmAtom(id, envelope)` — 更新 (graph-library-store 在 update text 时调用)

## 跟 noteCapability 的关系

| Capability | 职责 | 触达 storage |
|---|---|---|
| `noteCapability` | note view + folder 管理 (note = pm atom 1:1) | 间接通过自身 main 端 capability-impl |
| `pmContentCapability` | graph 端 pm atom CRUD (Instance.doc) | 间接通过自身 main 端 capability-impl |

**底层共享 pm atom domain,但 capability 互不调用**。sub-phase 3a-2.5 升级 noteCapability
时可考虑合并 (改为 noteCapability 内部调 pmContentCapability),本 sub-phase 不合并。

## 单引用约束 (decision 013 §3.5.1.bis)

本 sub-phase 实施**单引用模式**:一段 pm content 只能被 1 个 Instance 引用。
`PmAtomInfo.hasBeenReferenced` 字段恒 false。

浅引用 / 跨 view 复用留 3a-shared-ref 子任务,前置 Q-tx (storage.transaction 真原子性) 必做。

## 未来扩展 (3a-N+)

留待后续 sub-phase 实施的方法:

- `listOrphaned()` — 游离 pm atom 列表 (无任何引用边)
- `listReferences(id)` — 反查 pm atom 的引用 wrapper
- `deletePmAtom(id)` — "彻底删除内容"高级路径
- `forceDetachWrapper(nodeId)` — 强制断引用
- `getReferencedFlag(id)` — flag 查询 (本 sub-phase 单引用 = 永远 false)

## 边界

- view 通过 `requireCapabilityApi<PmContentCapabilityApi>('pm-content')` 取 api
- main 端 capability-impl 直接 import `@storage` (合规:capability 层调 storage)
- main 进程同模块直调:`import { ... } from '@platform/main/pm-content'`
