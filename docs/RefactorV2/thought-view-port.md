# Thought View — 横切思考层设计

**Branch**: `feature/thought-view`
**Status**: 设计中（**v0.5** — 等用户过签）
**Owner**: assistant + wenwu
**Created**: 2026-05-18
**Updated**: 2026-05-18（v0.5 收第三轮评审 3 项文档级一致性问题；v0.4 重大重定位：Thought 从"Note 附属"提升为"横切思考层"；ebook reading-thought 并入统一架构）

### v0.5 变更摘要（相对 v0.4）
1. **§5.1 channel-names 数字对齐**：原"9 个 channel"枚举不明确（evaluator 数为 10），改为"**9 个 channel-names 字面常量** = 8 invoke + 1 broadcast"，与 §5.3 "8 + 1 = 9 API 表面" 严格对齐。
2. **§16.3 高亮渲染示例补 TS 收窄**：原 `t.anchor.locator.cfi` 缺 discriminated union 收窄会编译错误。改为显式 4 层守门：`anchor != null` → `source === 'book'` → `resourceId === bookId` → `cfi && color` 非空。
3. **§8.3 孤儿语义统一**：原文 §8.3 与 §8.5 描述不一致（"anchor 仍指向 note" vs "解除依附"）。**正式定义两态**：`dangling-anchor`（anchor 元数据在但失效，UI ⚠️）vs `unanchored`（anchor === null 显式无依附）。§8.5 表 / 测试 #4/#29 / §13 Open Q #2 全部对齐这两个术语。

> **文件名说明**：保留 `thought-view-port.md` 文件名（"Thought View" 仍是合法 view，是横切层的"主舞台" NavSide tab；其他 view 通过 anchor 接入），但内容主体已是横切层设计。本文档自此为 Thought 系统主 SSOT，下属设计文档（ebook 迁移 / graph 接入等）将以本文档为引。

---

### v0.4 变更摘要（重大重定位，相对 v0.3）

1. **Thought 定位升级**（§0/§1/§2 重写）：从"V1 port + Note 附属 view"提升为**横切思考层（Cross-cutting Thought Layer）**。Thought 不依附任何单一 view，但能挂到任何 view 的任何资源上（note / book / graph / canvas / null=独立）。
2. **ebook reading-thought 并入**（§16 新增整章）：承认 V2 现有 `hasReadingThought` + 单 doc 多 block 模型是过渡形态，本期设计**统一吸收**进新 thought atom 体系。**实施分两期**：本期建 thought 体系 + Note source 接入 + ebook **双轨并存**（不破坏现状）；后续 sub-phase 把 ebook 现有 reading-thought block 迁成 thought atom。
3. **Anchor 模型升级为 multi-source**（§4 重写）：原 `anchor.noteId` → `anchor.source: 'note'|'book'|'graph'|'canvas'` + `anchor.resourceId` + `anchor.locator: NoteLocator | BookLocator | GraphLocator | CanvasLocator`。locator 是带 discriminator 的 union。
4. **Thought atom 字段扩展**（§4 重写）：吸收 ebook reading-thought 的 5 色 highlight 系统 + `thumbnail`（PDF 框选截图）；type enum 扩展为 9 种（V1 6 种 + ebook 3 种：highlight/underline/rect-frame）。
5. **Capability 重新定位**（§7 重写）：`thought` capability 是**横切 capability**（charter §1.4 line 196 "同一能力对所有 install 它的 view 完全一致"），install 它的 view 都获得相同的"加 thought / 查 thought / 列 thought"能力。
6. **保留所有 v0.2/v0.3 已收口决议**：requireCapabilityApi 硬约束、IPC 8+1 表面、thoughtCreate 单步原子、charter §1.4 体量目标、§15 偏离登记体系 — 全部保留并适配 multi-source。
7. **Phase 拆分调整**（§9 重写）：原 4 phase → 现 5 phase，Phase 1 为 multi-source 数据底座，Note source 在 Phase 2，**ebook 接入在 Phase 4**（与 AI/跨槽并列），ebook 老数据迁移作为可选 Phase 6（不阻塞主线 merge）。

---

## 0. 目的与范围（v0.4 重写）

**Thought 是 KRIG 的横切思考层。** 不依附任何单一 view，但能挂到任何 view 的任何资源上，也能独立存在。

**Thought 的本质**：用户在与任何资源交互时产生的"念头/批注/疑问/任务/AI 回应/高亮/划线"等思考活动的**统一表示**。每个 thought 是一个独立 atom；与源资源的关系通过 `thought_of` 边描述。

**Thought View** 是这一层的"主舞台"——NavSide 顶层 tab，按时间/类型/源类型聚合展示所有 thought；用户能在这里看到自己跨 view 的全部思考流。

**多 view 接入**：Note / eBook / Graph / Canvas 等 view 通过 install `thought` capability 获得"加 thought / 查 thought / 列 thought"能力，并在自身 UI 上呈现 thought 标记（mark / overlay / 框 / 角标）。

### 本期范围

| 范围内 | 范围外（后续 sub-phase） |
|---|---|
| Thought 横切数据模型（atom + 多 source anchor 边） | Thought 之间的 derived_from 引用网（v2 加） |
| Thought View（NavSide 主舞台 tab）+ folder + 9 种 type | Thought search / filter（capability layer 通用 search 时统一） |
| Note source 端到端（mark / block frame / node attr 三态 anchor） | Graph / Canvas source（接口预留，本期不实施） |
| eBook source 端到端（高亮 / 划线 / 框选三种 → thought atom） | eBook 现有 reading-thought 老数据迁移（独立 sub-phase） |
| AI response 状态机 + 跨槽 ViewMessage | 多人协作 / history / timeline |
| 兼容 ebook 双轨：新接口写新 atom，旧接口（hasReadingThought）读写老 doc 不动 | （迁移期统一） |

---

## 1. 用户对齐结论（含 v0.4 新增）

| 决议项 | 结论 | 来源 |
|---|---|---|
| Thought 定位 | **横切思考层**（不是 Note 附属 view） | 2026-05-18 v0.3→v0.4 |
| Thought 与 ebook reading-thought 关系 | **未来统一**；本期建新体系，ebook **并入设计**且**不回避** | 同上 |
| 数据存储 | thought atom（独立 domain）+ thought_of 多 source 边 | 同上 |
| 工作范围 | 端到端：底座 + Note source + ebook source + UI + AI + 测试清单 | 同上 |
| Folder 命名空间 | `FolderViewType` 加 `'thought'`（Thought View 主舞台用，多 source 不影响） | v0.1 |
| 类型 | 9 种 type（V1 6 + ebook 3） | v0.4 新 |
| Anchor 模型 | multi-source discriminated union | v0.4 新 |
| Editor 复用 | text-editing.Host（薄包装），thought.doc 可空（ebook 高亮场景） | v0.1 |
| Capability 调用约束 | view 一律 `requireCapabilityApi`，禁直 import 运行时值 | v0.2 |
| view 体量目标 | 主体 .tsx ≤ 100~150 行（Phase 5 收尾审计） | v0.3 |

---

## 2. V2 现有基建盘点（v0.4 扩展）

| 位置 | 现状 | 本期动作 |
|---|---|---|
| `text-editing-driver/schema-builder.ts:22` | 注释预留 `frameThoughtId` framework attr | 加 `frameThoughtId: { default: null }` |
| `text-editing-driver/blocks/image/spec.ts:46` | image attr `thoughtId: { default: null }` 已存在 | NodeView 加 outline 样式 + 点击发跨槽 |
| `text-editing-driver/blocks/_shared/book-anchor.ts` | BookAnchor 类型已定义（pageNum/rect/cfi/thumbnail/color/type） | **v0.4 起这是 `BookLocator` 的字面契约**，不重定义 |
| `capabilities/ebook-library` `getReadingThought/ensure/blockAdd/blockRemove/annotations` | 老 reading-thought API（一书一 doc + N block） | **保留不动**（双轨）；新 thought capability 提供并行接口；迁移走 sub-phase |
| `EBOOK_THOUGHT_*` IPC 通道（5 个） | 老 reading-thought 通道 | 保留；新增独立 `THOUGHT_*` 通道（不冲突） |
| `drivers/text-editing-driver/blocks/math-inline/spec.ts:13` | 注释「砍 V1 thoughtMark」 | 本期补 inline thoughtMark（不与 math-inline 节点冲突，mark 作用于 inline text） |
| `text-editing-driver/DESIGN.md:176` | `thought-view.pm` undoScope 已规划 | 本期落地 |

---

## 3. 整体架构图（v0.4 横切版）

```
                            ┌────────────────────────┐
                            │   NavSide Thought tab   │← 主舞台:跨 source 汇总
                            │ (Thought View 主组件)   │
                            └────────────┬───────────┘
                                         │
                                         ▼
                    ┌──────────────────────────────────────┐
                    │     thought capability(横切)         │
                    │  - createThought(info, anchor?)       │
                    │  - updateThought / updateAnchor      │
                    │  - deleteThought                     │
                    │  - listThoughts() / listBySource(...) │
                    │  - onListChanged                     │
                    └────────────┬─────────────────────────┘
                                 │ requireCapabilityApi
        ┌────────────────────────┼────────────────────────────────┐
        ▼                        ▼                                ▼
┌──────────────┐         ┌──────────────┐                  ┌──────────────┐
│  NoteView    │         │   EBookView  │                  │  GraphView   │
│ install:     │         │ install:     │                  │ install:     │
│  'thought'   │         │  'thought'   │                  │  'thought'   │
│              │         │              │                  │  (后续期)    │
│ 用 thought   │         │ 用 thought   │                  │              │
│ 在 PM doc 上 │         │ 在 PDF/EPUB  │                  │              │
│ 加 mark/frame│         │ 上加高亮/划线│                  │              │
│ /node attr   │         │ /框选        │                  │              │
└──────┬───────┘         └──────┬───────┘                  └──────────────┘
       │ source='note'            │ source='book'
       │ locator: NoteLocator     │ locator: BookLocator (= BookAnchor)
       │  { pmPos, anchorType }   │  { pageNum, rect?, cfi?, ... }
       │                          │
       └───────────┬──────────────┘
                   │  thoughtCreate(info, anchor)
                   ▼
        ┌──────────────────────────┐
        │ thought atom             │
        │   domain='thought'       │
        │   payload: ThoughtPayload│ ← 见 §4
        │                          │
        │ + 边 user:krig:thoughtOf │
        │   subject: thought atom  │
        │   object:  source atom   │ ← note/book/graph atom id
        │   attrs:                 │
        │     source: 'note'/'book'│
        │     locator: ...JSON...  │
        │     createdAt            │
        └──────────────────────────┘
```

**关键架构原则**：
- `thought` capability 是横切能力（charter §1.4 line 196 类型），**所有 install 它的 view 看到相同 API**。
- view 不直接管 thought 存储，只管"在自己的 UI 上呈现 thought + 通过 anchor 描述位置"。
- locator 的字面契约由 anchor.source 决定（discriminated union），新 source 接入时只加新 locator 类型，**不改 thought atom 本身**。
- thought 与源资源是**多对一**：一个 thought 必须有 0 或 1 个 source（独立 thought 是 0）；不存在一个 thought 挂到多个 source 的场景（如需"同一思考用在多处"，用 derived_from 边引用，是另一个 thought atom）。

---

## 4. 数据模型（v0.4 multi-source）

### 4.1 `ThoughtInfo`（view ↔ capability 边界类型）

```ts
// shared/ipc/thought-types.ts

export type ThoughtType =
  // V1 6 种
  | 'thought' | 'question' | 'important' | 'todo' | 'analysis' | 'ai-response'
  // ebook reading-thought 吸收 3 种
  | 'highlight' | 'underline' | 'rect-frame';

export const THOUGHT_TYPE_META: Record<ThoughtType, { icon: string; color: string; label: string }> = {
  thought:       { icon: '💭', color: '#4a9eff', label: '思考' },
  question:      { icon: '❓', color: '#ff5252', label: '疑问' },
  important:     { icon: '⭐', color: '#ffab40', label: '重要' },
  todo:          { icon: '☐', color: '#4caf50', label: '待办' },
  analysis:      { icon: '🔍', color: '#ab47bc', label: '分析' },
  'ai-response': { icon: '🤖', color: '#6366f1', label: 'AI 回复' },
  highlight:     { icon: '🖍️', color: '__from_payload_color__', label: '高亮' },
  underline:     { icon: '〰️', color: '__from_payload_color__', label: '划线' },
  'rect-frame':  { icon: '🔲', color: '__from_payload_color__', label: '框选' },
};

export interface ThoughtInfo {
  id: string;
  type: ThoughtType;
  resolved: boolean;
  pinned: boolean;
  /**
   * ebook 高亮场景:#ffd43b/#69db7c/#74c0fc/#b197fc/#ff6b6b (5 色)
   * 非 ebook 场景:可空,UI 按 type 取 THOUGHT_TYPE_META.color
   */
  color?: string;
  /** AI response 标识 (chatgpt/claude/gemini),仅 type='ai-response' 时填 */
  serviceId?: string;
  /** PDF 框选缩略图 base64,仅 type='rect-frame' 且 source='book' 时填 */
  thumbnail?: string;
  /**
   * 思考正文(可空 — ebook 高亮场景全部信息在 anchor,doc 留空)
   * format='pm-doc-json',version='0.1',结构与 NoteInfo.doc 一致(可复用 text-editing.Host)
   */
  doc: NoteDocEnvelope;
  /** Thought View folder 归属 (NavSide 主舞台用) */
  folderId: string | null;
  /** 锚点 (null = 独立 thought,无 source 依附) */
  anchor: ThoughtAnchor | null;
  createdAt: number;
  updatedAt: number;
}
```

### 4.2 `ThoughtAnchor`（discriminated union）

```ts
// shared/ipc/thought-types.ts

export type ThoughtSource = 'note' | 'book' | 'graph' | 'canvas';

/** Note 内锚点 (V1 3 态) */
export interface NoteLocator {
  /** PM doc 位置 (integer) — 用于排序 + 跳转 */
  pmPos: number;
  /** 三种 anchor 形态 */
  anchorType: 'inline' | 'block' | 'node';
  /** 冗余文本 (避免每次回读 PM doc) */
  text: string;
}

/** Book 内锚点 — 字面复用 BookAnchor (drivers/text-editing-driver/blocks/_shared/book-anchor.ts) */
export type BookLocator = import('@drivers/text-editing-driver/blocks/_shared/book-anchor').BookAnchor;

/** Graph 节点锚点 (本期预留,不实施) */
export interface GraphLocator {
  /** graph 内 node atom id */
  nodeId: string;
  /** 节点内 sub-position (如 label 内的字符位,预留) */
  subPos?: number;
  text?: string;
}

/** Canvas 图形锚点 (本期预留) */
export interface CanvasLocator {
  shapeId: string;
  text?: string;
}

export type ThoughtAnchor =
  | { source: 'note';   resourceId: string; locator: NoteLocator }
  | { source: 'book';   resourceId: string; locator: BookLocator }
  | { source: 'graph';  resourceId: string; locator: GraphLocator }
  | { source: 'canvas'; resourceId: string; locator: CanvasLocator };
```

### 4.3 存储模型

```
atom:
  id:        ULID
  domain:    'thought'
  payload:   ThoughtAtomPayload {
                 type, resolved, pinned, color?, serviceId?, thumbnail?,
                 doc: PmPayload (裸,不含 envelope — main 内部约定)
             }
  createdAt / updatedAt:  系统字段

边 user:krig:thoughtOf:
  subject:  atom (thought)
  object:   atom (note / book / graph / canvas atom — source atom)
            或 缺失（独立 thought）
  attrs:    {
                source:   'note' | 'book' | 'graph' | 'canvas'
                locator:  view-specific JSON
                createdAt
            }
```

**与 ebook 现有模型对比**：
| 项 | ebook 现有 reading-thought | 新 thought 体系 |
|---|---|---|
| atom 形态 | 一书一个 pm domain doc | 一思考一个 thought domain atom |
| anchor 表示 | PM block.attrs.bookAnchor | atom 外 edge.attrs.locator |
| 边谓词 | `user:krig:hasReadingThought`（书 → doc） | `user:krig:thoughtOf`（thought → 书/note/graph/...） |
| 删除粒度 | block 级（在 doc 内删 block） | atom 级（删 thought atom）|
| 跨书查询 | 困难（每本书一个 doc 各自存）| 容易（按 source filter 全 list）|

**双轨期约定**：
- 老 reading-thought API 保留，不动 ebook 老数据
- 新 thought API 平行存在，新建标注走新 API（**Phase 4 ebook view 改造时切换**）
- 老数据迁移走独立 sub-phase（"reading-thought migration" — 在 Phase 5+ 启动）

### 4.4 `thought_of` 边 — 不再需要单独类型

v0.3 的 `ThoughtOfEdge` 接口字段（anchor_type/anchor_pos/created_at）被 §4.2 ThoughtAnchor + edge 系统通用 attrs 取代。**v0.4 删除 ThoughtOfEdge 类型**。

---

## 5. 文件清单（v0.4 multi-source 适配）

### 5.1 共享类型层（`src/shared/`）

| 文件 | 状态 | 内容 |
|---|---|---|
| `shared/ipc/thought-types.ts` | **新增** | ThoughtType（9 种）、ThoughtSource、ThoughtInfo、ThoughtAnchor（discriminated union）、NoteLocator、GraphLocator、CanvasLocator、THOUGHT_TYPE_META、`THOUGHT_PROTOCOL = 'thought'` + `THOUGHT_ACTION` 协议常量（§5.9）；**BookLocator 复用 @drivers/...book-anchor**（不重定义） |
| `shared/ipc/note-folder-types.ts` | **改** | `FolderViewType` 加 `'thought'` |
| `shared/ipc/electron-api.d.ts` | **改** | 加 8 个 IPC 方法签名 + 1 个订阅（见 §5.3） |
| `shared/ipc/channel-names.ts` | **改** | 加 **9 个 channel-names 字面常量**：8 个 invoke channel（`THOUGHT_LIST / CREATE / GET / UPDATE / DELETE / LIST_BY_SOURCE / MOVE_TO_FOLDER / UPDATE_ANCHOR`，对应 §5.3 API #1–#8）+ 1 个 broadcast channel（`THOUGHT_LIST_CHANGED`，对应 §5.3 `onThoughtListChanged` 订阅）。**与 §5.3 "8 invoke + 1 订阅 = 9" 数字字面对齐**。 |

### 5.2 主进程层（`src/platform/main/`）

| 文件 | 状态 | 内容 |
|---|---|---|
| `platform/main/thought/capability-impl.ts` | **新增** | createThought / getThought / updateThought / deleteThought / listThoughts / listBySource / moveToFolder / updateAnchor —— atom + thought_of 边在 transaction 内事务处理 |
| `platform/main/thought/handlers.ts` | **新增** | 8 个 ipcMain.handle + 入参 type guard（仿 note/handlers.ts） |
| `platform/main/thought/broadcast.ts` | **新增** | `broadcastThoughtListChanged()` |
| `platform/main/thought/envelope.ts` | **新增** | `wrapThoughtDoc / unwrapThoughtDoc / emptyThoughtDoc`（thought 也可有 doc，envelope 与 note 共格式） |
| `platform/main/thought/index.ts` | **新增** | `registerThoughtHandlers()` 出口 |
| `platform/main/folder/handlers.ts` | **改** | viewType 校验放行 `'thought'`（无 schema 改动） |
| `platform/main/ipc/ipc-bus.ts` | **改** | initIpcBus 调 `registerThoughtHandlers()` |

### 5.3 IPC 接口（v0.4 multi-source 形态）

| # | API | 签名 | 用途 |
|---|---|---|---|
| 1 | `thoughtCreate` | `(info: Omit<ThoughtInfo,'id'\|'createdAt'\|'updatedAt'>) => Promise<ThoughtInfo>` | **原子**：建 thought atom；若 `info.anchor != null` 则同事务内建 thoughtOf 边（attrs 写 source/locator） |
| 2 | `thoughtList` | `() => Promise<ThoughtInfo[]>` | 全量（Thought View 主舞台） |
| 3 | `thoughtListBySource` | `(source: ThoughtSource, resourceId: string) => Promise<ThoughtInfo[]>` | 某资源的 thought（NoteView 右槽 / eBook 阅读时） |
| 4 | `thoughtGet` | `(id: string) => Promise<ThoughtInfo \| null>` | 单条 |
| 5 | `thoughtUpdate` | `(id: string, updates: Partial<Pick<ThoughtInfo,'doc'\|'type'\|'resolved'\|'pinned'\|'color'\|'thumbnail'\|'serviceId'>>) => Promise<ThoughtInfo \| null>` | 改 payload 内字段 |
| 6 | `thoughtDelete` | `(id: string) => Promise<void>` | 级联删 atom + 边 |
| 7 | `thoughtMoveToFolder` | `(thoughtId: string, folderId: string\|null) => Promise<void>` | NavSide 拖拽 |
| 8 | `thoughtUpdateAnchor` | `(thoughtId: string, anchor: ThoughtAnchor \| null) => Promise<void>` | 改/解 anchor（Note 撤销 mark / 高亮位置变） |
| — | `onThoughtListChanged` | `(cb) => () => void` | 列表广播订阅 |

**总表面：8 + 1 订阅 = 9**（与 §5.2 数字一致）。

### 5.4 Capability 层（`src/capabilities/thought/`）

| 文件 | 状态 | 内容 |
|---|---|---|
| `capabilities/thought/types.ts` | **新增** | `ThoughtCapabilityApi`；re-export ThoughtInfo / Anchor / Type / Source / Locator 等类型 |
| `capabilities/thought/index.ts` | **新增** | renderer 端薄包装：把 window.electronAPI.thoughtXxx 扁平驼峰 alias 为业务方法；注册到 capabilityRegistry |
| `capabilities/thought/DESIGN.md` | **新增** | 简短 v0.1 设计说明（横切定位 + 与 ebook reading-thought 双轨说明） |

### 5.5 text-editing capability 扩展（Note source 接入）

| 文件 | 状态 | 内容 |
|---|---|---|
| `drivers/text-editing-driver/marks/thought-mark.ts` | **新增** | PM MarkSpec：`thoughtMark` with attrs `{ thoughtId, thoughtType }`，渲染 `<span data-thought-id data-thought-type>`，下划线 + type 色 |
| `drivers/text-editing-driver/marks/index.ts` | **改** | 加 thoughtMark 进 MARKS 表 |
| `drivers/text-editing-driver/schema-builder.ts:22` | **改** | injectFrameworkAttrs 加 `frameThoughtId: { default: null }` |
| `drivers/text-editing-driver/blocks/image/node-view.ts` | **改** | thoughtId 非空时画 outline + 点击发跨槽 |
| `drivers/text-editing-driver/plugins/thought-anchor-plugin.ts` | **新增** | PM plugin：拦截 thoughtId 点击 → 调 capability → 发跨槽；按 frameThoughtId 画 block 外框 decoration |
| `capabilities/text-editing/types.ts` | **改** | 加 `addThoughtAnchor / removeThoughtAnchor / scrollToThoughtAnchor` 三个 API |
| `capabilities/text-editing/index.ts` | **改** | 实现上述 API |

### 5.6 ebook 接入（Phase 4 — v0.4 新增）

| 文件 | 状态 | 内容 |
|---|---|---|
| `capabilities/ebook-rendering/hooks/use-epub-annotation.ts` | **改** | 高亮创建路径切换：原 `lib.addReadingThoughtBlock(bookId, { type:'blockquote', bookAnchor, textContent })` → 新 `thoughtCapability.createThought({ type:'highlight', color, doc:emptyDoc, anchor:{ source:'book', resourceId:bookId, locator:bookAnchor } })`；旧路径**留 ENV gate**（默认走新路径，env=legacy 时回退老路径用于过渡期对照）|
| `capabilities/ebook-library/index.ts` | **改** | `getReadingThought / ensureReadingThought / addReadingThoughtBlock / removeReadingThoughtBlock / getReadingThoughtAnnotations` **保留不动**（兼容老数据），加注释"过渡期保留，新代码走 thought capability" |
| `platform/main/ebook/library-handlers.ts` | 不动 | 仅作老数据读取通道，未来迁移期再处理 |
| `views/ebook/EBookView.tsx` | **改** | onBookOpen 时除调 `loadOnBookOpen`（老）外，并行调 `thoughtCapability.listBySource('book', bookId)` 把新 atom 体系下的 highlight 也画到 EPUB host 上 |

### 5.7 View 层（`src/views/thought/`）—— Thought View 主舞台

| 文件 | 状态 | 目标行数（v0.3 体量预算） | 内容 |
|---|---|---|---|
| `views/thought/index.ts` | **新增** | ≤ 60 | registerView({ id:'thought-view', install:[selection, clipboard, undo-redo, text-editing, thought, folder, learning, math-rendering], navSideTab:{label:'Thought', icon:'💭', order:6}, ... }) + 子件注册 |
| `views/thought/ThoughtView.tsx` | **新增** | ≤ 100 | wsState 订阅 + 子组件编排；列表渲染 ThoughtList |
| `views/thought/ThoughtList.tsx` | **新增** | ≤ 80 | thought 列表布局（按 source / type / time 分组） |
| `views/thought/ThoughtCard.tsx` | **新增** | ≤ 150 | 卡片：header + ThoughtCardEditor + 类型菜单 + resolve + delete + (AI Copy)；展开/收起；高亮场景显 color/anchor.text 简化卡片 |
| `views/thought/ThoughtCardEditor.tsx` | **新增** | ≤ 80 | text-editing.Host 薄包装 |
| `views/thought/nav-side-content.tsx` | **新增** | ≤ 100 | FolderTreePanel + actions:[+ Thought, + Folder] |
| `views/thought/thought-commands.ts` | **新增** | ≤ 200 | thought-view.create / set-active / change-type / toggle-resolve / delete / create-folder / 等命令；**包含 add-from-note / add-from-book 跨 view 命令**（被 NoteView/EBookView 调） |
| `views/thought/data-model.ts` | **新增** | ≤ 100 | wsState：activeThoughtId / selectedIds / expandedFolders 等 |
| `views/thought/use-thoughts-folders.ts` | **新增** | ≤ 50 | useAllThoughts / useAllFolders('thought') hooks |
| `views/thought/tree-builder.ts` | **新增** | ≤ 80 | folder + thoughtList 构造 FolderTree |
| `views/thought/tree-operations.ts` | **新增** | ≤ 80 | drag-drop → thoughtMoveToFolder |
| `views/thought/note-bridge.ts` | **新增** | ≤ 150 | 跨槽 ViewMessage 处理（Note ↔ Thought 双向）|
| `views/thought/floating-toolbar-content.ts` | **新增** | ≤ 30 | 卡片内编辑 floating toolbar |
| `views/thought/thought.css` | **新增** | ≤ 200 | 卡片 / 列表样式 |
| `views/thought/DESIGN.md` | **新增** | — | 简短 v0.1 设计说明 |

**预算目标**：主体 .tsx 文件每个 ≤ 150 行；超过的 Phase 5 审计时给说明。

### 5.8 Note 侧集成

| 文件 | 状态 | 内容 |
|---|---|---|
| `views/note/floating-toolbar-content.ts` | **改** | 加 💭 按钮，command='thought-view.add-from-note' |
| `views/note/index.ts` | **改** | install 加 'thought'；keymap 加 mod+shift+m → thought-view.add-from-note |

### 5.9 跨槽通信

复用 V2 已有 `bus.slot.openRight` + `bus.slot.sendToOther`。

```ts
// shared/ipc/thought-types.ts
export const THOUGHT_PROTOCOL = 'thought';  // 跨槽通信协议名（v0.3 'note-thought' → v0.4 'thought',覆盖多 source）
export const THOUGHT_ACTION = {
  CREATE: 'create',                  // source view → Thought View
  ACTIVATE: 'activate',              // source view → Thought View
  DELETE: 'delete',                  // Thought View → source view (清 mark / 删高亮)
  SCROLL_TO_ANCHOR: 'scroll-to-anchor', // Thought View → source view (跳转)
  TYPE_CHANGE: 'type-change',        // 双向
  AI_RESPONSE_READY: 'ai-ready',
  AI_ERROR: 'ai-error',
} as const;
```

### 5.10 文档与 memory

| 文件 | 状态 | 内容 |
|---|---|---|
| `docs/RefactorV2/thought-view-port.md` | **本文档** | v0.4 设计 |
| `docs/RefactorV2/test-checklists/thought-view-test.md` | **新增**（Phase 5 前） | ≥ 30 项（含 ebook source） |
| memory: `feedback_thought_is_noteview_variant.md` | **修订** | V1 是 variant，V2 是横切层 |
| memory: `project_thought_view_v2_done.md` | **新增**（合 main 后）| 完成归档 |
| memory: `project_thought_cross_cutting_layer.md` | **新增**（v0.4 过签后立即） | 钉死"thought 是横切层"决议，避免未来重新发明轮子 |

---

## 6. AI Response 状态机（v0.3 不变）

详见 v0.3。多 source 不影响 AI 路径，AI thought 默认 source='note' 或 null（独立 AI 问答）。

---

## 7. Capability 注册图（v0.4 横切重定位）

```
thought capability install 它的 view:
  - note-view        (Phase 2 接入,3 态 anchor)
  - ebook-view       (Phase 4 接入,3 种 ebook anchor)
  - thought-view 本身 (主舞台)
  - graph-canvas-view (本期预留,不接入)
  - canvas-view      (本期预留,不接入)

thought-view install:
  - selection / clipboard / undo-redo (复用)
  - text-editing    (思考正文编辑)
  - thought         (本期新)
  - folder          ('thought' viewType)
  - learning        (卡片内查词)
  - math-rendering  (卡片内可写公式)
```

### 7.1 Capability 调用强约束（v0.3 落地，v0.4 不变）

所有 view → capability 调用必须 `requireCapabilityApi`，禁直 import 运行时值。详见 v0.3 §7.1 表（保留）。本期对 thought 的强约束加项：

| 场景 | ❌ | ✅ |
|---|---|---|
| ThoughtView / ThoughtCard 拿 text-editing Host | `import { textEditingCapability }` | `requireCapabilityApi<TextEditingApi>('text-editing').Host` |
| 任何 view 拿 thought | `import { thoughtCapability }` | `requireCapabilityApi<ThoughtCapabilityApi>('thought')` |
| EBookView use-epub-annotation 切到 thought | 直 import thoughtCapability | `requireCapabilityApi<ThoughtCapabilityApi>('thought').createThought({source:'book', ...})` |
| 类型 | — | `import type { ThoughtInfo, ThoughtAnchor } from '@capabilities/thought/types'` ✅ |

**Capability 之间互调禁止**（v0.3 落地，v0.4 仍生效）：thought capability 内**不**直接调 folder / note / ebook capability。folder 组合在 view 层。

---

## 8. 跨层契约（v0.4 更新）

### 8.1 `anchor === null` 的语义

NavSide Thought View 主舞台 "+ Thought" 创建的卡片，无 source 依附。`anchor: null`（不是 `anchor: { source:..., locator:... }` 字段全空）。

### 8.2 thoughtMark 与 inline math/code mark 共存

thoughtMark.excludes = ''（不互斥任何 mark），允许多 mark 叠加。

### 8.3 undo scope 隔离

NoteView 用 `note-view.pm`，ThoughtView 用 `thought-view.pm`；EBookView 不涉及 PM undo（高亮是命令式）。

**孤儿 thought 两态语义（v0.4 v2 修订 — 统一定义）**：

| 态 | anchor 字段 | 含义 | UI 表示 | 形成路径 |
|---|---|---|---|---|
| **anchored** | `{source, resourceId, locator}` 全部有效 + 源端真有对应位置 | 正常状态 | 卡片可点击跳转 | 创建时默认 |
| **dangling-anchor** | `{source, resourceId, locator}` 字段在，但**源端位置已失效**（如 Note 撤销 mark 后 pmPos 找不到、PDF 删了对应高亮、book atom 还在但 cfi 错位） | 锚点失效但 anchor 元数据保留 | 卡片显"⚠️ 锚点失效"角标，可点击仍尝试跳转 + 提示用户 | Note ⌘Z 撤销 mark；ebook 文件被替换；底层数据漂移 |
| **unanchored** | `anchor === null` | 显式无依附（独立 thought） | 卡片不显示 source 信息 | (a) NavSide Thought tab "+ Thought" 直接建；(b) 调 `thoughtUpdateAnchor(id, null)` 显式解依附 |

**关键差异**：dangling-anchor **不会**被自动转为 unanchored；两态是**正交的**——用户体感不同（"找不到了" vs "本来就不挂"），调用方语义不同。

**孤儿 GC**：本期不实施。两态都不自动删 thought atom（思考不应因 UI 失锚就蒸发）。dangling-anchor 由用户在 Thought tab 看到角标后决定手动解依附（→ unanchored）或删除。

### 8.4 frameThoughtId 与 frameColor 共存（v0.3 不变）

### 8.5 v0.4 新增：multi-source 同步关系

| 操作 | 影响 | 落到哪态 |
|---|---|---|
| 在 Note 内删一段含 thought mark 的文字 | thought atom + anchor 元数据保留，但 pmPos 找不到 mark | **dangling-anchor**（UI 角标 ⚠️） |
| Note 撤销 mark（⌘Z）但未删文字 | 同上 | **dangling-anchor** |
| 用户在 Thought tab 调 `thoughtUpdateAnchor(id, null)` | anchor 显式置 null | **unanchored**（解依附） |
| 删除一本书（ebook-library.remove） | 该 book atom 不在，但 thought.anchor.resourceId 仍指向已删的 book id | **dangling-anchor** + UI 额外显"源已删"（locator 仍在，只是 resource 无效） |
| 用户在 Thought tab 手动删 thought atom | thought 没了 | — |
| 重命名 / 移动 source | 不影响 thought（source 是 atom id 引用，不存路径）| **anchored**（不变） |

**孤儿处置**：本期不自动 GC；NavSide Thought tab "失效锚点"过滤器 v2 加。

---

## 9. Phase 拆分（v0.4 重排）

| Phase | 内容 | 验收点 |
|---|---|---|
| **1** | shared types + main IPC + thought capability + folder 'thought' viewType + **multi-source 数据底座** | npm start 无报错；devtools 能调 `electronAPI.thoughtCreate(...)` 落库；listBySource('note', 'xx') 返空数组 |
| **2** | ThoughtView 主舞台骨架 + folder tree + 卡片列表 + 新建/删除 + 9 种 type 切换 + resolved/pinned | NavSide 出 💭 tab；点 "+ Thought" 弹卡片；编辑文字落库；type 切换/resolved/pinned UI 完整 |
| **3** | Note source 接入：3 种 anchor + ⌘⇧M + floating toolbar 💭 + 跨槽 ViewMessage（Note ↔ Thought）+ image thoughtId | NoteView 选文字 ⌘⇧M → Thought tab 出现卡片 + Note 文字加下划线；点 Note 下划线 → Thought tab 滚到对应卡片；image 节点 attr 路径 PASS |
| **4** | eBook source 接入 + AI response 状态机 | 在 PDF 框选 / EPUB 高亮 / PDF 划线 → 卡片出现在 Thought tab；本书阅读时仍走高亮渲染（新旧双轨）；AI mock 路径 e2e PASS |
| **5** | charter §1.4 体量审计 + 测试清单 ≥ 30 项 + memory 更新 + merge to main | wc -l 审计 + 测试 PASS + 用户验收 |
| **6**（可选 / 不阻塞主线） | ebook 老 reading-thought 数据迁移到新 thought atom 体系 | 老 doc 内 N block 拆 N atom；老 IPC channel 标记 deprecated；保留兼容读取 |

---

## 10. 测试清单（v0.4 ≥ 30 项 — 新增 ebook + multi-source）

详见独立文件 `docs/RefactorV2/test-checklists/thought-view-test.md`（Phase 1 完工后创建）。预览：

**A. 存储/IPC（Phase 1）** —— 6 项
1. devtools 调 `thoughtCreate({type:'thought', resolved:false, pinned:false, doc:emptyDoc, anchor:null})` 返新 thought
2. 重启 app，thought 仍在
3. `thoughtListBySource('note', noteId)` 在 relate 状态下返回该 thought
4. `thoughtUpdateAnchor(id, null)` → 显式解依附（**anchored → unanchored**）→ listBySource('note', noteId) 不再返 / list() 仍返该 thought（anchor 字段=null）
5. `thoughtUpdate(id, { resolved: true })` 落库
6. `thoughtDelete(id)` 后 list/listBySource 都不返

**B. Thought tab 主舞台（Phase 2）** —— 6 项
7-12. tab 出现 / +Thought 新建 / 9 种 type / resolved/pinned / folder / 拖拽

**C. Note source（Phase 3）** —— 8 项
13. 选文字 ⌘⇧M → Note 文字加下划线 + Thought tab 出现卡片
14. 块选 ⌘⇧M → block frame 外框 + 卡片 (anchor.locator.anchorType='block')
15. image 节点 ⌘⇧M → image outline + 卡片 (anchorType='node')
16. 点 Note 下划线 → Thought tab 滚到对应卡片
17. 点卡片 anchor 文本 → Note 跳转并滚动
18. Note 内 ⌘Z 撤销 mark → mark 没了 thought 仍在 Thought tab
19. Note 改 thought type → mark 颜色变（跨槽 type-change）
20. Thought tab 删卡片 → Note mark 消失

**D. eBook source（Phase 4）** —— 6 项
21. PDF 框选 + 颜色 → 卡片 (type='rect-frame', thumbnail!=null)
22. EPUB 高亮 + 颜色 → 卡片 (type='highlight')
23. PDF 划线 → 卡片 (type='underline')
24. 重开书：新建的高亮仍画在 EPUB 上
25. 老 reading-thought block（迁移前老数据）仍能读出来不丢
26. Thought tab 切到 ebook 卡片，点击 anchor → 切回 EBookView 并跳到该页

**E. AI / 跨槽（Phase 4）** —— 4 项
27. 选 Note 文字 → 问 AI 按钮 → 立即出现 ai-response 卡片 spinner
28. mock 2s → spinner 消失内容填充
29. Note 撤销 mark 后 thought 进入 **dangling-anchor** 态 → Thought tab 卡片显 ⚠️ 角标；调 `thoughtUpdateAnchor(id, null)` 后 → **unanchored** 态 → ⚠️ 消失
30. 多 workspace 切换 thought selection 不互扰

---

## 11. 风险点（v0.4 更新）

| 风险 | 应对 |
|---|---|
| ~~thoughtRelate~~ ✅ v0.2 收口 | （保留历史）|
| **新旧 ebook reading-thought 双轨同步问题** | Phase 4 切到新 API 时，**老数据保持只读**；新建只走新 API；UI 显示时合并两个 source（先列新 atom，再列老 doc block，按 createdAt 排序，老 block 角标"legacy"） |
| **EBook EpubHost.addHighlight 接受的是 cfi，新 thought atom 不破坏该接口** | use-epub-annotation 内部把 thought.anchor.locator.cfi 转成 host.addHighlight(cfi, color)，与老路径形同（只换数据来源） |
| **Multi-source anchor 类型膨胀** | locator 是 discriminated union，新 source 只加 type，不改 atom/IPC 接口表面 |
| Cross-view capability lift 之前必须 sync 消费方 ([memory feedback]) | 本期不涉及"删通配机制"，仅"加新 capability"，无消费方破坏风险 |
| view 体量 charter §1.4 | Phase 5 审计 + 文件级硬上限（见 §5.7 表） |

---

## 12. 偏离记录（实施期出现时回填）

（待 Phase 1 开工后逐条登记）

---

## 13. Open Questions（v0.4 更新）

1. **跨 view 拖 thought**：Thought tab 拖一个 ebook source 的卡片到 Note tab —— 怎么处理？
   → **不允许跨 source 拖**（folder 隔离严格）。本期 v0.4 不实施；用户需手动 unanchor 再重 anchor。
2. **删除 source 时 thought atom 怎么办**：
   → 落到 **dangling-anchor** 态（§8.3 定义），保留 atom + 保留 anchor 元数据，UI 显 ⚠️ + "源已删"。本期不自动 GC，用户可在 Thought tab 手动解依附（→ unanchored）或删除。
3. **同一选区能创建多个 thought 吗**：
   → 允许（不同 type，如 question + analysis 同位置）。UI 显多重 mark 时下划线叠加。
4. **graph node anchor 何时接入**：
   → v0.4 仅类型预留，Phase 6+ 与 graph view 同步设计时实施。

---

## 14. 实施前 checklist

- [x] V1 调研完成
- [x] V2 View 体系调研完成
- [x] 用户对 6 项关键决议拍板
- [x] 分支 `feature/thought-view` 已建
- [x] 设计文档 v0.1 / v0.2 / v0.3
- [x] 第一/二轮评审 + v0.2/v0.3 修订
- [x] 在 Phase 1 实施前发现 ebook reading-thought 重叠 → 用户重定位 Thought 为横切层
- [x] 设计文档 v0.4 重写
- [x] 调研 ebook reading-thought 完整数据模型（BookAnchor + 5 API + 双轨方案）
- [x] 第三轮评审 + v0.5 修订（收 3 项文档一致性问题）
- [ ] **用户过签 v0.5** ← 待
- [ ] Phase 1 commit

---

## 15. 偏离登记（v0.3 主体保留，v0.4 增补）

### 15.1 已纳（8 项落地）

| 评审条目 | 处置 |
|---|---|
| R1-H2 view 必须 `requireCapabilityApi` | ✅ v0.2 §7.1 + v0.4 §7.1（新加 ebook 接入约束）|
| R1-M1 IPC 6 vs 8+1 不一致 | ✅ v0.2，v0.4 §5.3 接口表面仍 8+1 |
| R1-M2 thoughtRelate 摇摆 | ✅ v0.2 单步原子 |
| R2-P1.1 thoughtRelate 残留 | ✅ v0.3 全文清理 |
| R2-P1.2 §15.2 论据撤回 | ✅ v0.3 撤回 + 重新表态 |
| R3-1 channel-names 数字不一致（9 vs 10） | ✅ v0.5 §5.1 改为 "9 channel = 8 invoke + 1 broadcast"，与 §5.3 字面对齐 |
| R3-2 §16.3 高亮渲染示例缺 TS 空值收窄 | ✅ v0.5 §16.3 改为 4 层守门 discriminated union 收窄 |
| R3-3 孤儿语义前后冲突 | ✅ v0.5 §8.3 正式定义两态 dangling-anchor vs unanchored；§8.5 / 测试 #4 / 测试 #29 / §13 Open Q #2 全部对齐 |

### 15.2 view 体量（v0.3 表态保留，v0.4 §5.7 行数预算细化）

v0.3 决议保留：主体 .tsx 文件预算 ≤ 100~150 行，Phase 5 审计。

### 15.3 v0.4 新增：横切层重定位与 ebook 并入

**重定位起因**：Phase 1.1 调研中发现 V2 已有 `hasReadingThought` 边和 `getReadingThought / addReadingThoughtBlock` 系列 API（sub-phase 022 "annotation 概念消亡"产物）。用户回应"未来这两者应该是统一的，而不是分离的"，进一步明确"Thought 不仅服务于 note，也要服务于 eBook 还有 Graph"。

**重定位结论**：
- Thought 是横切思考层，不是任何单一 view 的附属
- ebook reading-thought 现状是过渡形态（"只是定义了数据模型而已"），本期一同设计但不动现有数据（双轨）
- anchor 模型升级为 discriminated multi-source union
- 未来 graph / canvas / 其他 source 沿同一接口接入

**双轨期承诺**（v0.4 钉死）：
- Phase 4 ebook 切到新 API 时，**老 reading-thought 数据保持读取通道开放**；UI 合并展示
- Phase 6（独立 sub-phase，不阻塞 thought-view merge）做老数据迁移
- ebook-library 老 5 个 API 进 deprecated 标记但保留至少 1 个版本

### 15.4 后续触发条件（v0.3 不变）

- charter §1.4 line 246 体量约束：见 v0.3 §15.3
- ebook reading-thought 老数据如何安全迁移：Phase 6 启动条件 = thought-view feature 合 main 且稳定 ≥ 1 周

---

## 16. ebook reading-thought 并入路线（v0.4 新章）

### 16.1 现状

V2 sub-phase 022（decision 022 §4.1.3 + §7.3）将原 annotation 概念消亡，转为：
- 每本书 `ebook atom` 通过 `user:krig:hasReadingThought` 边关联**一个 thought pm doc atom**（domain='pm'，与 note 同 domain）
- doc 内每个 block.attrs 加 optional `bookAnchor`（pageNum/rect/cfi/textContent/thumbnail/color/type/createdAt）
- block 字面 3 类：image（PDF 框选）/ blockquote（EPUB 高亮）/ paragraph（PDF 划线）

### 16.2 新模型映射

旧 `addReadingThoughtBlock(bookId, { type:'blockquote', bookAnchor, textContent })` → 新 `thoughtCreate({ type:'highlight', color:bookAnchor.color, doc: textContent ? wrapPara(textContent) : emptyDoc, anchor: { source:'book', resourceId:bookId, locator:bookAnchor } })`

| 旧 | 新 |
|---|---|
| block.attrs.bookAnchor.type='rect' | thought.type='rect-frame' + thought.thumbnail + anchor.locator |
| block.attrs.bookAnchor.type='underline' | thought.type='underline' + anchor.locator |
| block.attrs.bookAnchor.type='highlight' | thought.type='highlight' + anchor.locator + thought.doc=textContent 段落 |
| block.attrs.bookAnchor.color | thought.color |
| createdAt（block id）| thought.id（atom ULID）/ thought.createdAt |

### 16.3 双轨实施（Phase 4）

```ts
// capabilities/ebook-rendering/hooks/use-epub-annotation.ts (Phase 4 改动)
const createAnnotation = async (color: string) => {
  const thoughtApi = requireCapabilityApi<ThoughtCapabilityApi>('thought');
  const bookAnchor: BookAnchor = { ... };
  await thoughtApi.createThought({
    type: 'highlight',
    color,
    doc: emptyDoc,
    anchor: { source: 'book', resourceId: bookId, locator: bookAnchor },
    resolved: false, pinned: false,
  });
  await host.addHighlight(cfi, color);
};

const loadOnBookOpen = async (bookId: string) => {
  const thoughtApi = requireCapabilityApi<ThoughtCapabilityApi>('thought');
  // 新数据
  const newThoughts = await thoughtApi.listBySource('book', bookId);
  // 老数据(继续读老 channel,不写)
  const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
  const legacyAnchors = await lib.getReadingThoughtAnnotations(bookId);
  // 合并渲染 — 显式收窄 discriminated union: 必须 anchor 非空 + source='book' + locator.cfi 非空 + color 非空
  for (const t of newThoughts) {
    if (t.type !== 'highlight') continue;
    if (t.anchor === null) continue;             // 独立 thought 跳过(无 source)
    if (t.anchor.source !== 'book') continue;    // 这里 t.anchor.locator 收窄到 BookLocator
    if (t.anchor.resourceId !== bookId) continue;// 跨书 thought 不渲染到本书
    const cfi = t.anchor.locator.cfi;
    if (!cfi || !t.color) continue;              // EPUB highlight 必有 cfi + color
    host.addHighlight(cfi, t.color);
  }
  for (const a of legacyAnchors) host.addHighlight(a.cfi, a.color);
};
```

### 16.4 老数据迁移（Phase 6 — 独立）

- 入口：CLI 命令 / dev tools 调 `migrateLegacyReadingThoughts()`
- 算法：遍历所有 ebook atom → 找其 hasReadingThought 边 → 读 doc → 拆 block → 每 block 一个 thoughtCreate → 删 doc 内 block / 或保留 doc 但加 `migrated:true` 标记
- 安全：可重入；migrated:true 跳过；提供 rollback dry-run

### 16.5 删除老 API 计划（远期）

至少在 thought-view feature 合 main + 老数据迁移完成 + 稳定 1 release 之后。

---

**结束：等用户过签 v0.4 后 Phase 1 开工。**
