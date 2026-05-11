# Atom 字段权威定义（V2 spec）

> 本文件定义 V2 Atom 的核心接口、字段语义、约束条件。代码以本文件为准。
>
> 参考起点：V1 `src/shared/types/atom-types.ts` + V2 `docs/00-architecture/three-layer.md` §2.2 + `docs/00-architecture/vision.md` + `docs/00-architecture/charter.md`。
>
> 与 V1 的差异详见 [`decisions/002-v1-fields-migration.md`](decisions/002-v1-fields-migration.md)。
> 命名与"属性走边"决议详见 [`decisions/003-naming-conventions.md`](decisions/003-naming-conventions.md)。

---

## 0. Atom 是什么

**Atom = V2 语义层的最小实体。** 它的核心特性：

1. **承载数据本体，不承载语义解释**：atom 只保留所属 domain 的"数据形态本身"，所有领域解释 / 视图绑定 / 来源 / 链接 / 派生关系等通过**边**表达。
2. **按 domain 分类**：4 个初始 domain（pm / rdf / embedding / three），每个 domain 用该领域最成熟的数据模型。
3. **跨 domain 通过边连接**：Atom 内部不嵌套跨 domain 引用，所有关联走 SurrealDB RELATE 边（边也是一等公民）。
4. **视图无关**：Atom 不知道任何视图存在；视图特性（位置 / 颜色 / frame 等） —— 几何属性归 three domain payload，**非几何视图属性**挂视图自己的索引格式。

> 与 three-layer.md §2.2 的关系：架构文档当前把 atom 定义为 "PM node JSON 形态"，本文件**进一步泛化** —— PM node JSON 是 **pm domain** 的具体形态，是 V2 第一个落地的 domain。其他 domain 启动时按需扩展，不影响已有定义。

---

## 1. Atom 通用接口

```ts
/**
 * V2 语义层最小实体。
 * 按 domain 分类，每个 domain 有自己的 payload 形态。
 */
export interface Atom<D extends AtomDomain = AtomDomain> {
  /** Domain 分类 —— 决定 payload 的形状 */
  domain: D;

  /** Domain 特定的数据载荷（按 domain 分派） */
  payload: AtomPayloadOf<D>;
}

/**
 * Atom Domain —— 开放注册体系（不是封闭枚举）。
 *
 * V2 第一波初始 domain（封闭 4 个）：
 *   - 'pm'        ProseMirror node JSON（可编辑内容）
 *   - 'rdf'       SPO 三元组（客观关系 / 推理）
 *   - 'embedding' 向量（语义相似度）
 *   - 'three'     几何（点 / 线 / 面 / 体）
 *
 * 运行时由 atom-domain-registry 校验。未来扩展（如 markdown-ast / json-schema /
 * musicxml）通过注册新 domain 加入，已有 atom 不受影响。
 */
export type AtomDomain = string;

/** 按 domain 分派 payload 类型（运行时由 registry 提供形状校验） */
export type AtomPayloadOf<D extends AtomDomain> =
  D extends 'pm'        ? PmPayload :
  D extends 'rdf'       ? RdfPayload :
  D extends 'embedding' ? EmbeddingPayload :
  D extends 'three'     ? ThreePayload :
  unknown;
```

**关键设计意图**：
- `Atom` 是泛型 —— 函数签名可以精确表达"只接受 pm atom"或"只接受 three atom"。
- `domain` 字段是分派标签，运行时和类型层都用它判断 payload 形状。
- 每个 domain 的 payload 是该领域成熟的数据模型，互不干扰。

### 1.1 Domain 注册治理

Domain 是开放注册体系，但注册需遵循以下规则：

**命名规则**：
- kebab-case（小写 + 连字符），长度 2-32 字符。
- 优先用业界标准 / 主要数据模型标签（不是"承载内容"描述）。例：`pm` 而非 `content`，`rdf` 而非 `kg-triple`。
- 新 domain 命名理由记录在该 domain 的 `atom/domains/<domain>.md` 顶部。

**版本规则**：
- Domain payload schema 变更走"加法"原则 —— **新增字段无需版本号**，**删除 / 修改既有字段才需升版**。
- 版本以 SemVer 表达，记录在该 domain 文档顶部。

**迁移规则**：
- 不同版本的 payload 在存储层并存，按 atom 创建时间映射到对应版本读取器。
- 升级路径在 `atom/domains/<domain>/migrations/` 下登记（Phase N 视需要展开）。

**兼容性规则**：
- 新增 domain 不影响已有 domain（已写入数据不动）。
- 跨 domain converter（如 pm ↔ lexical）由 capability 层提供，不在 atom spec 内定义。
- 切换底层实现（如 PM → Lexical / Three.js → Babylon）= **注册新 domain，旧 domain 保留可读**。这是 charter.md §1.3 屏障原则的延伸。

**注册流程**：
1. 在 `atom/domains/<domain>.md` 登记 payload 完整 schema + 命名理由 + 版本号。
2. 在 `atom/spec.md` §3 加一行索引。
3. 注册到 `atom-domain-registry`（capability 层）。

### 1.2 Atom 数据 vs Atom 实体

本接口定义的是 **atom 数据形态**（语义层的数据形状）。

**atom 实体** = atom 数据 + 存储层包裹的元属性（id / 时间戳等）。元属性的具体形态留到 `persistence/` 阶段决议，不在本文件展开。

**示意**（仅示意，最终形态待 persistence 决议）：

```ts
// 存储层视角（不属于 spec，仅说明边界）
{
  id: 'atom:xxx',
  created_at: ...,
  updated_at: ...,
  payload: <Atom>{ domain, payload },  // 这才是本 spec 定义的部分
}
```

→ Spec 关心**数据形状**；存储 schema 关心**实体落表**。两者分离。

---

## 2. pm Domain（NoteView 用，Phase 1 完整定义）

### 2.1 PmPayload — PM node JSON 形态

```ts
/**
 * pm atom 的数据载荷 —— ProseMirror node JSON 形态。
 *
 * 嵌套通过 content 字段（PM 风格），不使用 V1 的 parentId / order。
 */
export interface PmPayload {
  /** Block / Inline 类型（如 'textBlock', 'mathBlock', 'text', 'mathInline'） */
  type: string;

  /** 子节点数组（嵌套通过此字段实现，PM node JSON 风格） */
  content?: PmPayload[];

  /** 节点属性（按 type 决定具体字段，参见 Block 注册） */
  attrs?: Record<string, unknown>;

  /** Mark 列表（仅 inline node 适用） */
  marks?: Mark[];

  /** 文本内容（仅 text node 适用） */
  text?: string;
}
```

**约束**：
- 5 字段全部为可选（除 `type`）。具体哪些字段出现，由 `type` 决定（参见 Block 注册）。
- `content` / `marks` / `text` 互斥规则按 PM schema 约束：
  - `text` 节点必有 `text`，可有 `marks`，不能有 `content`。
  - 非 text 节点有 `content`（容器）或无 `content`（叶子），可有 `attrs`。

### 2.2 Block —— pm Atom 的语义组合类型

按 V2 charter.md §4：

- **pm atom** = 最小单元（如 `{ type: 'text', text: 'hello' }`）。
- **block** = pm atom 的组合形态（如 `textBlock` / `mathBlock` / `bulletList`）。Block 自身可嵌套 block。

**Block 是 pm domain 内部的语义分类**，不是新的 atom domain。每种 block 类型通过 **Block 注册表**（由 `capability.text-editing` 提供）定义：

- `type` 名称（如 `'textBlock'` / `'bulletList'`）。
- `attrs` schema（该 block 允许哪些属性）。
- 允许的 `content` 子节点类型（PM schema 风格）。

→ **Block 类型清单**在 `relations/pm-note.md`（Phase 2）展开，包含 textBlock / headingBlock / mathBlock / codeBlock / bulletList / orderedList / taskList / blockquote / callout / table / image / fileBlock / externalRef / htmlBlock 等。

### 2.3 Inline 元素

Inline 元素是 pm atom 的子节点（位于 `content[]` 里），形态同样是 PmPayload，但 `type` 限定为 inline 类：

```
'text' | 'mathInline' | 'codeInline' | 'noteLink' | 'fileLink' | 'mention'
```

Inline 元素自身可承载 `marks`，表达加粗 / 斜体 / 高亮 / 链接等修饰。

### 2.4 Mark

```ts
export type Mark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'underline' }
  | { type: 'strike' }
  | { type: 'code' }
  | { type: 'highlight'; attrs?: { color?: string } }
  | { type: 'textStyle'; attrs?: { color?: string } }
  | { type: 'link'; attrs: { href: string; title?: string } };
```

> V1 中的 `thought` mark（思考标注）—— V2 是否引入 Thought 系统留待 Phase 2 决议。当前 Phase 1 暂不包含。

### 2.5 V2 当前实现对齐说明

V2 现有的 `src/capabilities/text-editing/types.ts:65-81` 已有两个类型：

| V2 现有 | 与本 spec 对齐结论 |
|---|---|
| `AtomInput`（line 65-72）—— 宽松输入类型，PDF 提取契约用 | **应统一到 `Atom<'pm'>`**。但 `parentId` 字段需迁移到 PM 嵌套（content 字段），`from / meta` 字段处置见 §4。 |
| `PMDocNode`（line 75-81） | **结构等同 `PmPayload`**。可保留 `PMDocNode` 作为本地别名，但 spec 命名以 `PmPayload` 为权威。 |

→ Phase 2 实施时统一类型命名，类型迁移见 decision 文件。

---

## 3. 其他 Domain（占位，Phase N 展开）

### 3.1 rdf Domain（占位）

**职责**：承载客观知识图谱关系（vision.md §2.1 描述的"机器可推理"层），W3C RDF 标准 SPO 形态。

**初步形态**（待 Graph view 业务启动时细化）：

```ts
export interface RdfPayload {
  subject: string;
  predicate: string;
  object: string;
  // 其他字段待 Layer 1 关系语义化时定（如 dataType / lang / context）
}
```

**与其他 domain 的关系**：通常通过 `*:krig:represents` 边关联到 pm atom（"这段内容表达的客观关系是哪个三元组"）。

### 3.2 embedding Domain（占位）

**职责**：承载语义相似度索引（embedding 向量），供 RAG / 语义检索使用。

**初步形态**（待对应能力启动时细化）：

```ts
export interface EmbeddingPayload {
  vector: number[];        // 向量数据
  dim: number;             // 维度
  model: string;           // 生成模型标识（如 'openai-ada-002'）
  // 其他字段待 Layer 2（vision.md §4）启动时定
}
```

**与其他 domain 的关系**：通常通过 `sys:krig:embeddedBy` 边关联到某个源 atom（"这个 vector 是哪段内容 / 哪个 atom 的嵌入"）。

### 3.3 three Domain（占位）

**职责**：承载视觉空间布局的几何身份。

**初步形态**（待画板视图启动时细化）：

```ts
export interface ThreePayload {
  /**
   * 几何原语类型 —— V2 第一波三类落地：
   *   - 'node'  点（图节点）
   *   - 'edge'  线（图边 / 连线）
   *   - 'face'  面（封闭区域 / swim-lane / pool）
   * 'volume' 留作开放注册扩展（3D 场景，V2 短期未启用）。
   */
  kind: 'node' | 'edge' | 'face';

  /**
   * 几何属性（仅本体必需的几何身份信息）：
   *   - position / shape / size / transform 等"是几何就需要"的字段
   *
   * ⚠️ 非几何属性（如 family-tree 的 gender / birthDate、BPMN 的 nodeType 等
   * **领域语义解释**）**不进 payload**，全部走边（详见 §4 + decision 003）。
   */
  position?: { x: number; y: number; z?: number };
  shape?: string;        // 形状标识（'circle' / 'rect' / 'substance:xxx'）
  size?: { w: number; h: number; d?: number };
  // 其他几何字段（rotation / scale / 等）待画板视图启动时细化
}
```

**与其他 domain 的关系**：

- **领域语义解释通过命名空间边叠加**：family-tree / bpmn / mind-map / state-machine / org-chart 等都不是 domain，是**该 three atom 在某个 vocabulary 下的语义解释**。
- 例：一个 family-tree 中的 person 节点 = `three atom (kind='node', position, shape='rect')` + 一系列 `user:family-tree:*` 命名空间下的边（hasGender / hasBirthDate / isParentOf / ...）。
- 通用渲染 / 通用交互 / 通用图查询 **由 capability + library 共享提供**，不在 three domain 里。详见 `docs/00-architecture/charter.md` §1.3 + §4。

> ⚠️ **此处特别强调** —— V2 不设"family-tree domain" / "bpmn domain" / "mind-map domain"。它们都是 three domain + 对应命名空间边的组合。理由详见 [`decisions/003-naming-conventions.md`](decisions/003-naming-conventions.md) §"为什么领域解释不做成 domain"。

---

## 4. 跨 Atom 关系（边一等公民）

V2 把"边"提升为跟 atom 同级的语义层一等公民。**Atom 之间的关系不写在 atom 字段里**，全部走 SurrealDB RELATE 边。

### 4.1 走法 B：所有属性走边

参见 [`decisions/003-naming-conventions.md`](decisions/003-naming-conventions.md) "走法 B" 节。

简要：atom 本体只保留 domain 数据模型自身必需的字段，**所有非本体属性（语义解释 / 来源 / 链接 / 派生关系 / 嵌入引用 / 视图绑定 / ...）全部走边**。构建时叠加（叠加是构造性的，不是替换性的），检索 / 推理通过子图索引切片实现。

### 4.2 边命名：三段式 `<source>:<vocabulary>:<edge-name>`

| 段 | 取值 | 含义 |
|---|---|---|
| **source** | `user` / `ai` / `sys` | 谁创建的（按 vision.md §8 "AI 写入必须可被用户确认 / 撤销") |
| **vocabulary** | `family-tree` / `bpmn` / `mind-map` / `prov` / `owl` / `skos` / `krig` / ... | 语义命名空间（标准对齐 / 领域解释） |
| **edge-name** | `isParentOf` / `flowsTo` / `wasDerivedFrom` / ... | 具体边名 |

某些约定俗成边可省略 vocabulary 段（如 `user:linksTo`）。

每条边的 `attrs` 必带：

```ts
{
  createdBy: string;        // agentId (如 user-wenwu / ai-gpt4 / sys-auto-embed)
  createdAt: number;
  confidence?: number;      // ai / sys 创建时必填
  confirmedAt?: number;     // 用户确认时间戳（若有）
  confirmedBy?: string;     // 用户 agentId
}
```

### 4.3 V2 第一波核心边集（Phase 1 登记）

**派生关系**（用户主动 commit、git-style）：

| 边 | 用途 |
|---|---|
| `user:prov:wasDerivedFrom` | pm atom → pm atom，用户主动派生新版本（vision.md §2.4 闭环 + 卡片盒精神） |

**来源追溯**（AI / 系统自动追溯）：

| 边 | 用途 |
|---|---|
| `ai:prov:wasInformedBy` | pm atom → ebook/web/etc，AI 提取笔记时自动追溯来源 |
| `user:prov:wasInformedBy` | 同上，用户手动标注 |

**跨 domain 关联**（KRIG 自有命名空间）：

| 边 | 用途 |
|---|---|
| `sys:krig:embeddedBy` | 任意 atom → embedding atom，系统自动生成的向量索引 |
| `*:krig:represents` | pm atom → rdf atom，"这段内容表达的客观关系是哪条三元组" |
| `*:krig:shownIn` | 任意 atom → three atom，"这个 atom 在画板上的呈现节点" |

**约定俗成**（无 vocabulary 段）：

| 边 | 用途 |
|---|---|
| `user:linksTo` | atom → atom，wiki-style 引用（用户主动建链） |

→ 完整边目录在 Phase 2+ 的 `relations/` 下展开，本节仅登记 Phase 1 已知的核心边。

### 4.4 子图索引（推理 / 检索机制）

边数量随业务增长一定爆炸，**通过子图索引切片解决**：

| 索引类型 | 形态 | 用途 |
|---|---|---|
| **命名空间索引** | 按 `<source>:<vocabulary>` 切片 | family-tree 推理引擎只查 `user:family-tree:%` 子图 |
| **实体邻居索引** | atom id → 出边 / 入边列表 | 读单个 atom 所有属性边 → O(度数) |
| **物化视图** | 按高频查询模式预计算 | 跨多条边的常见组合查询（如 person → name + gender + birthDate） |

→ 索引机制属于 **storage 层 / capability.graph-query** 的职责，本 spec 仅声明"子图索引是 V2 推理 / 检索的标准机制"，具体实现留到 persistence + capability 阶段决议。

---

## 5. 语义层边界判定

按 `docs/00-architecture/three-layer.md` 原则 1（语义层不知道可视化层），下列字段**绝对不在 atom 数据里**：

- ❌ **非几何视图属性**（color / style / frame / 边框 / 字号 / 选中态 / 焦点态）→ 视图局部状态或视图索引格式。
- ❌ **渲染状态**（nodeIds / dirty）→ 视图局部状态。
- ❌ **视图编辑器内部态**（光标位置 / 选区 / 滚动位置）→ 视图局部状态，不持久化。
- ❌ **领域语义解释**（family-tree 的 gender / BPMN 的 nodeType / mind-map 的 isRoot 等）→ 命名空间边。

**Three domain payload 例外**：几何身份本身需要的字段（position / shape / size / transform）属于 atom 本体，**不算视图特性**。判定规则：

> "脱掉这个字段，atom 还是同一个几何身份吗？"
> 是 → 属于视图特性，剥离。
> 否 → 属于几何身份，留在 payload。

V1 atom 上的 `frame` 字段（color / style / groupId / thoughtId）就是错误示例 —— 全部应剥离。详见 [`decisions/002-v1-fields-migration.md`](decisions/002-v1-fields-migration.md)。

---

## 6. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| Q1 | `prov:wasInformedBy` 是否要拆 user 主动 / AI 自动两条？还是只用 source 段区分？ | **只用 source 段区分**（user:prov:wasInformedBy / ai:prov:wasInformedBy），不拆边名 | Phase 2 `relations/pm-source.md` 决议 |
| Q2 | "用户确认 AI 边"的具体机制：改 source 段（数据迁移）还是加 confirmedBy attrs（轻量）？ | **加 confirmedBy attrs**（轻量方案，不动 source 段）。保留 AI 创建痕迹用于审计 / 回溯，attrs 标记"用户已确认" | Phase 2 决议 |
| Q3 | Atom 实体的元属性（id / 时间戳 / 等）由谁负责？属于 atom 数据还是存储层包裹？ | 暂归存储层包裹（不进 atom 数据） | Phase 3 `persistence/` |
| Q4 | Thought 系统是否引入 V2？影响 Mark 类型清单 | Phase 1 暂不引入 | Phase 2 |
| Q5 | three domain 中 `volume`（3D 体）何时启用？需要新视图先行立项 | Phase 1 仅登记 node/edge/face 三类 | Phase N，按需 |
| Q6 | 边 attrs 的 `confidence` 在不同 vocabulary 下含义可能不同（embedding 的余弦相似度 vs AI 推断的可信度），是否需要标准化？ | 不强制统一 —— vocabulary 在自己 schema 里说明 confidence 语义（参见 `relations/spec.md` §3.2） | Phase 2 |

**临时默认值的意义**：实施代码必须有个默认行为，避免"等 Phase 2 决议"期间各自解读。临时默认 = Phase 2 决议前生效的默认行为，Phase 2 决议时可被推翻。

---

## 7. 影响清单（Phase 1 完成后）

如本 spec 获批，下一步要做：

1. **Phase 2 推进** —— 写 `relations/pm-note.md`（block 类型清单 + note 如何组装 pm atom）。
2. **V2 现有代码对齐** —— `src/capabilities/text-editing/types.ts:65-72` 的 `AtomInput` 应改名为 `Atom<'pm'>`，但**实施留到 Phase 2 之后**（先文档稳定，再动代码）。
3. **架构文档反向更新** —— 等 Atom Domain 概念稳定运行 N 个 phase 后，反向更新 `docs/00-architecture/three-layer.md` §2.2，把"PM node JSON 形态"扩展为"按 domain 分派 + 走法 B（属性走边）"。
4. **暂不创建** `src/semantic/` 目录（charter.md §2.1 提到的语义层目录） —— 留到 Phase 2 实施时建。
