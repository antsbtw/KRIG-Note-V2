/**
 * diglot-model capability — 四面投影的类型真源(mind v0)
 *
 * ⭐ 本文件与 docs/10-business-design/diglot/03-projection-map.md 是**一体两份**:
 * 文档给人审,本文件给编译器守。**冲突时以本文件为准。**
 *
 * ⚠️ 纪律:本文件里「稀疏」「零边」这类承诺,凡是编译器能检查的,
 * 一律用类型表达(`?:` / `readonly` / 联合类型),**不许只写在注释里**
 * —— 注释骗得过人,骗不过 `tsc`。凡编译器检查不了的(如「拖动只落 G 一条」),
 * 归断言测试守,本文件只标注哪条断言守它。
 *
 * ⚠️ 树假设(parent/order)是 **mind 专属**,见 §5。公共层不得假设「单父」,
 * 否则 bpmn(02-bpmn-spec.md,S 层是有向图)开工要拆。
 */

// ─────────────────────────────────────────────────────────
// 0. 共享:id 是四面唯一 join 键
// ─────────────────────────────────────────────────────────

/**
 * 节点 id — ⭐ S / G / DB / Instance 四面之间**唯一**的 join 键(00 §6)。
 *
 * KRIG 投影 = block id;平文本投影 = `^id`。
 * ⚠️ M3 的全部依据:**id 配对,绝不删旧建新**。
 */
export type NodeId = string;

/** 联系线 id — 显式命名以便外部挂靠(01 §3.2「想连线,先命名」)。 */
export type EdgeId = string;

// ─────────────────────────────────────────────────────────
// 1. S 层 — 语义面:图「是什么」
//    ⭐ 用户书写,**机器不改写**(保注释、保书写顺序、保用户个性)
// ─────────────────────────────────────────────────────────

/** 节点角色(01 §3.1)。`root` = 文档标题;`floating` = 自由主题(父为 Document)。 */
export type NodeRole = 'root' | 'branch' | 'floating';

/**
 * 受控标记(01 §3.1 markers)—— ⭐ **枚举词表,可排序可比较可过滤**。
 * ⚠️ 与自由文本 `labels` **分设**:合并会丢掉枚举语义。
 */
export type MarkerKind =
  | `priority-${1 | 2 | 3 | 4 | 5 | 6}`
  | `progress-${0 | 25 | 50 | 75 | 100}`
  | 'flag';

/**
 * 富文本内容信封 —— ⭐ 与 note block **同一形态**(实测,见 03 §4)。
 *
 * `src/capabilities/canvas-text-node/index.ts` 复用 `text-editing.Host`;
 * `src/views/note/NoteView.tsx:209` 用的是同一个 Host。
 * 故公式 / 行内格式 / 图片 / 超链接**整类白送**(对 XMind 的原生超越)。
 *
 * ⭐ 首段 = 节点标签(图上显示);其余 = 备注(01 §3.1)。
 */
export type RichContent = {
  readonly format: 'pm-doc-json';
  /**
   * ⚠️⚠️ **必填** —— driver 的 `deserializeDoc` 对 `version !== '0.1'` **返回 null**,
   * 编辑器于是渲染成空白且**不报错**(真机实测:note tab 一片空白)。
   * 缺这个字段在画布路径上不暴露(那条走 atomsToSvgInput 不经 deserialize),
   * 只有喂给 note 编辑器时才炸 —— 典型的「一条路没走过就没发现」。
   */
  readonly version: '0.1';
  readonly payload: unknown;
};

/**
 * S 层节点。
 *
 * ⚠️ **注意这里没有 `pos` / `color` / `shape` / `collapsed`** ——
 * 那些是 G 层的,混进来即违反分层(C4:画布拖动 → S 层**零变更**)。
 */
export interface SNode {
  readonly id: NodeId;
  /** 必填(01 §3.1)。首段=标签,余部=备注。 */
  readonly content: RichContent;
  /**
   * ⭐ **真相是父子关系,不是层级数字**(01 §4)。
   * `null` = 顶层(父为 Document)。层级数字**永不落库**。
   */
  readonly parent: NodeId | null;
  /**
   * 兄弟间次序 —— lexrank 字典序串(复用 note 既有 `order`)。
   * ⭐ 中插只写 1 块,不动其它(见 src/platform/main/note/lexrank.ts)。
   */
  readonly order: string;
  readonly role: NodeRole;
  /** 外部引用:content 为 `[[ref]]` 时指向另一文档/块。钻取由此实现。 */
  readonly ref?: string;
  /** 自由文本标注(XMind label)。缺省空。 */
  readonly labels?: readonly string[];
  /** ⭐ 受控标记,与 labels 分设。缺省空。 */
  readonly markers?: readonly MarkerKind[];
  /**
   * ⭐⭐ def 块的**原始行**(`00 §2.5` / `01 §7.7`)—— 逐字节往返的载体。
   *
   * ⚠️ 存 `raw` 而非解析结果,是为了 §7.7.3 的收敛判据:
   * 注释行(`#`)与**不认识的行**必须**原样吐回**(`04 §0.6.3` 分区原则③),
   * 否则往返不收敛 —— 那正是「正文存盘即丢」「节点增殖」两个坑的共同根因。
   *
   * ⚠️ 这是 note 投影的专用载体:mermaid 投影没有它(mermaid 装不下),
   * 缺省 `undefined` = 该节点没有 def 块,写回时**不 emit 空块**。
   */
  readonly defLines?: readonly string[];
}

/**
 * 联系线 —— ⚠️ **树之外的附加关系**,与 bpmn 的序列流性质**完全不同**(01 §3.2)。
 * ⭐ 模型统一存**有向**;无向语义由渲染**弱化箭头**表达。
 */
export interface SEdge {
  readonly id: EdgeId;
  readonly source: NodeId;
  readonly target: NodeId;
  readonly label?: string;
}

/** 区间引用 kind(01 §3.3):summary=框住并挂结论;boundary=仅框住。 */
export type SpanKind = 'summary' | 'boundary';

/**
 * 区间引用(概要 / 边界)。
 * ⭐ `from`/`to` **锚在 id 上** —— 节点移动/更名不破坏区间(M4 的依据)。
 */
export interface SSpan {
  readonly id: string;
  readonly kind: SpanKind;
  readonly from: NodeId;
  readonly to: NodeId;
  /** 概要的结论节点:本身是 Node,父挂 Span。boundary 无。 */
  readonly topic?: NodeId;
}

/**
 * S 层完整快照 —— ⭐ **这就是「文档本体」,零边**(03 §3)。
 *
 * ⚠️ `edges` 虽在此结构内,落库时是唯一走 `relates` 边的东西(03 §3.3);
 * **M5 要求:edges 整批丢失,nodes/spans 必须完好。**
 */
export interface SLayer {
  readonly nodes: readonly SNode[];
  readonly edges: readonly SEdge[];
  readonly spans: readonly SSpan[];
}

// ─────────────────────────────────────────────────────────
// 2. G 层 — 图形面:图「长什么样」
//    ⭐⭐ **稀疏**:缺省即自动,只有被碰过的才有条目
// ─────────────────────────────────────────────────────────

/**
 * 布局结构词表(01 §3.1)。方向变体是**参数**不是独立词条。
 * ⭐ v0 只实现 `map` 与 `logic`;其余**登记名称,布局算法后续实现**。
 */
export type StructureKind =
  | 'map'
  | 'logic'
  | 'brace'
  | 'org'
  | 'tree'
  | 'timeline'
  | 'fishbone'
  | 'tree-table'
  | 'matrix';

/** 坐标 —— ⭐ **量化为整数**,杜绝浮点噪声(00 §4 规范化纪律)。 */
export interface GPos {
  readonly x: number;
  readonly y: number;
}

/**
 * ⭐⭐ G 层单条条目 —— **全部字段可选**。
 *
 * 这不是随手写的 `?:`,是**稀疏纪律的类型表达**(00 §1.3):
 * - 缺席 = auto(**不写缺省值**)
 * - ⭐ `pos` **存在即 pinned**:写入即钉住,删除即释放(C7)
 *
 * ⚠️ 一个 id 若无任何被触碰的属性,**根本不该有 GEntry**(见 GLayer 注释)。
 */
export interface GEntry {
  /** ⭐ 存在即 pinned;删除即回自动布局(C7 的全部依据)。 */
  readonly pos?: GPos;
  readonly color?: string;
  readonly shape?: string;
  /** 该节点**子树**的布局算法,可挂任意节点、**向下继承**。 */
  readonly structure?: StructureKind;
  /** structure 的方向等参数(如 fishbone dir=left)。 */
  readonly structureParams?: Readonly<Record<string, string>>;
  /** V 类(视图属性):折叠是**属性不是类型**,一切节点天然可折叠。**持久**。 */
  readonly collapsed?: boolean;
  /** 自由主题标记(role=floating 的 G 侧投影)。 */
  readonly float?: boolean;
  /**
   * ⚠️ **未知记号原样透传** —— round-trip 不破坏(00 §2.3 / C9)。
   * 即便将来加了自己的语法,读到不认识的东西也**不许丢**。
   */
  readonly unknown?: Readonly<Record<string, string>>;
}

/**
 * ⭐⭐ G 层 = **对自动布局的稀疏覆盖层**,不是画布状态的存档。
 *
 * ```
 * S 层(树) ──推导──┐
 *                  ├─→ ELK 自动布局(全量坐标) ─→ Instance[]
 * G 层(稀疏 pos) ──┘   有条目的覆盖自动值;没条目的用算出来的
 * ```
 *
 * ⚠️⚠️ **绝不可存成 `Instance[]`** —— `Instance.position` 是全量的
 * (没坐标画不出来),那会当场违反稀疏纪律,**C5 / C7 全废**。
 *
 * ⚠️ 不变量(C5,由断言守,类型守不住):
 * **画布新建节点 → 此 map 中该 id 恰好不存在。**
 */
export type GLayer = ReadonlyMap<NodeId | EdgeId, GEntry>;

/**
 * G 层的**序列化形态** —— ⭐ C1 幂等验的是**字节**,所以真源是字符串。
 *
 * 落于 note 内单独一个 block,包裹 HTML 注释(00 §4 / 03 §3.4):
 * ```
 * <!-- diglot
 * ^arch pos=420,180
 * ^root structure=logic
 * -->
 * ```
 * 规范形:条目按 id 字典序;条目内键按固定序;坐标整数;**不写缺省值**。
 * ⭐ **规范化幂等**:对规范形再序列化,**字节级不变**(C1)。
 */
export type GLayerText = string;

// ─────────────────────────────────────────────────────────
// 3. DB 层 — 落库(03 §3:文档本体零边)
// ─────────────────────────────────────────────────────────

/**
 * 树骨架落库形态 —— ⭐ **零边,纯属性**,复用 note 既有字段。
 *
 * 实测对齐 `src/platform/main/note/assemble-pm-doc.ts:readStructAttrs`:
 * `parentId: string | null` / `order: string`。
 *
 * ⚠️ **Decision 028 的教训**:曾用 `belongsToNote`/`childOf`/`nextSibling`
 * 三类边表达结构 → 几百条边必须全对,任一条坏则整篇坏,且 `putEdge` 不幂等
 * → **损坏累积、不可逆**(真实事故:长笔记重启后块顺序错乱)。
 */
export interface DbStructAttrs {
  readonly noteId: string;
  /** 顶层为 null。 */
  readonly parentId: string | null;
  /** lexrank 字典序串。 */
  readonly order: string;
}

/**
 * ⚠️ **唯一真用边的地方**(03 §3.3):联系线 = 业务关系(用户意志、持久、显式删除)。
 *
 * ⚠️ **确定性 id**:`putEdge` 无 id 时每次 CREATE 新行(028 §1.2),
 * 「拖一下多一条边」。故此处 id **必须**由两端 + 语义确定性导出,
 * 使重复写同一条逻辑边 = **覆盖而非新增**。
 * → 债 3(03 §6):v0 做掉 or 记账,待拍。
 */
export interface DbRelatesEdge {
  readonly id: EdgeId;
  readonly source: NodeId;
  readonly target: NodeId;
  readonly label?: string;
}

// ─────────────────────────────────────────────────────────
// 4. 落笔矩阵 — 交互层验收标准(01 §6)
//    ⚠️ 类型守不住「落几条」,由断言守。此处把矩阵编码成**可被测试引用的常量类型**,
//       使测试断言与规格同源,而不是各写各的。
// ─────────────────────────────────────────────────────────

/** 一次操作在某一面的落笔量。`zero` 是**硬承诺**,不是「大概不动」。 */
export type LandingCount = 'zero' | 'one' | 'many';

/** 一次操作的三面落笔归属。 */
export interface Landing {
  readonly s: LandingCount;
  readonly g: LandingCount;
}

/**
 * ⭐ 落笔矩阵(01 §6 逐行编码)。测试直接引用本常量,
 * 避免「测试自己写一份期望值」而与规格漂移。
 */
export const LANDING_MATRIX = {
  /** 语义面改标签 → S 一处 update,G 零 */
  'semantic.editLabel': { s: 'one', g: 'zero' },
  /** 语义面移动缩进块 → parent/order 变更,⭐ G 零(布局属性存活,M3) */
  'semantic.moveIndent': { s: 'one', g: 'zero' },
  /** 语义面键入 /三角形 → ⭐ S 零残留(手势消解,C8),G 一条 shape */
  'semantic.slashShape': { s: 'zero', g: 'one' },
  /** ⭐ 画布拖动节点 → S 零,G 一条 pos(C4) */
  'canvas.dragNode': { s: 'zero', g: 'one' },
  /** ⭐ 画布新建节点 → S 一处插入,G 零(缺省即自动,C5) */
  'canvas.createNode': { s: 'one', g: 'zero' },
  /** 画布连线 → S 一条关系,G 零 */
  'canvas.connect': { s: 'one', g: 'zero' },
  /** G 面改 color → S 零,G 该条目更新 */
  'graphic.editColor': { s: 'zero', g: 'one' },
  /** ⭐ G 面删除 pos 条目 → S 零,G 条目消失,节点回自动布局(C7) */
  'graphic.deletePos': { s: 'zero', g: 'one' },
} as const satisfies Record<string, Landing>;

export type LandingOp = keyof typeof LANDING_MATRIX;

// ─────────────────────────────────────────────────────────
// 5. ⚠️ 图种边界 — 别把树假设焊进公共层
// ─────────────────────────────────────────────────────────

/**
 * ⚠️⚠️ 本文件中 **`SNode.parent` / `SNode.order` 是 mind 专属**。
 *
 * `02-bpmn-spec.md` 的 S 层是**有向图**(有汇合、有回边):
 * 一个节点**可以有多个前驱**。公共层(G 层 `^id key=value`、规范化、
 * 同步引擎、撤销栈)**不得假设「每个节点只有一个父」**,否则 bpmn 开工要拆。
 *
 * 判据(00 §5):共用的是 **G 层与同步机制**,**不是 S 层模型**。
 * 故 `GEntry` / `GLayer` / `GLayerText` 刻意**不含任何树语义** ——
 * 它们只认 id,不认父子。
 */
export type MindOnly<T> = T;

/** 文档类型 = ⭐ 解释器选择(01 §3.4)。同一 blocks 数据可按大纲或导图解释。 */
export type DiglotDocType = 'mind' | 'bpmn';


// ─────────────────────────────────────────────────────────
// 6. Capability API(view 通过 requireCapabilityApi 取,不直接 import 运行时值)
// ─────────────────────────────────────────────────────────

/**
 * ⭐ diglot-model 对外 API。
 *
 * ⚠️ view 层**不得直接 import 本 capability 的运行时值**(eslint 守着):
 * 走 `requireCapabilityApi<DiglotModelApi>('diglot-model')` 间接路由;
 * 类型走 `import type ... from '@capabilities/diglot-model/types'`(W5 设计 §5)。
 */
export interface DiglotModelApi {
  /** mind 文件 → {S,G} 快照;坏档 fail loud,不返回半个模型 */
  readonly fileToSnapshot: (raw: unknown) => import('./engine-contract').ParseResult<
    import('./engine-contract').DiglotSnapshot
  >;
  /** {S,G} 快照 → mind 文件(两段纯文本) */
  readonly snapshotToFile: (snap: import('./engine-contract').DiglotSnapshot) => unknown;
  /** 新建 mind 的初始内容(带模板,G 层为空) */
  readonly emptyMindFile: () => unknown;
  /** 该快照里有多少个被钉住(有 pos)的节点 —— UI 用来决定按钮是否可用 */
  readonly pinnedCount: (snap: import('./engine-contract').DiglotSnapshot) => number;
  /** ⭐ 唯一的状态迁移入口 —— 三面改动一律经此 */
  readonly applyAction: (
    snap: import('./engine-contract').DiglotSnapshot,
    action: import('./engine-contract').DiglotAction,
  ) => import('./engine-contract').DiglotSnapshot;
  /** S 层 → ELK 布局输入(树的父子在此才变成 edges,仅算法输入) */
  readonly buildLayoutRequest: (
    s: SLayer,
    g: GLayer,
  ) => import('./project-to-canvas').LayoutRequest;
  /** ⭐ S 层树 → note block 序列(层级用 h1~hn 表达,block 带稳定 id) */
  readonly treeToNoteDoc: (s: SLayer) => import('./note-projection').NoteDoc;
  /** 某节点是否折叠(读 G 层 collapsed) */
  readonly isCollapsed: (
    snap: import('./engine-contract').DiglotSnapshot,
    id: NodeId,
  ) => boolean;
  /**
   * ⭐⭐ mermaid 导入合并:结构/标签用新的,**正文块从旧快照接回来**。
   *
   * ⚠️ mermaid 一个节点只有一行标签,解析结果没有正文 ——
   * 整份替换会把全图正文删光(规格 03 §5.6 硬约束)。
   */
  /**
   * ⭐ S 层 → mermaid 文本(**有损投影**:只保住层级 + 标题纯文本)。
   * mermaid tab 显示用 —— v1 的 semantic 是 note doc JSON,不能直接给人看。
   */
  readonly toMermaidMindmap: (s: import('./types').SLayer) => string;
  /** ⭐ 从 semantic 内容判断格式版本(mind_doc 不存 format) */
  readonly detectMindFormat: (semantic: string) => string;
  readonly mergeKeepingBodies: (
    prev: import('./engine-contract').DiglotSnapshot,
    incoming: import('./engine-contract').DiglotSnapshot,
  ) => import('./engine-contract').DiglotSnapshot;
  /** ⭐ root 节点的文字 = 文档标题(01 §3.4「标题即 root」);无 root 或空则 null */
  readonly rootTitleOf: (s: SLayer) => string | null;
  /** ⭐ note block 序列 → S 层树(id 优先取 block 自带的) */
  readonly noteDocToTree: (doc: unknown) => SLayer;
  /** 判断某 instance id 是否为树连线(派生物,不对应 S 层节点) */
  readonly isTreeLineId: (id: string) => boolean;
  /**
   * ⭐ 落点 → 结构归位(01 §7.2 v0.2:裸拖=改父/改序)。
   * 返回 null = 不该改(拖回原位 / 无合法父),调用侧据此不发 action。
   */
  readonly resolveDropTarget: (
    s: SLayer,
    g: GLayer,
    draggedId: NodeId,
    drop: { x: number; y: number },
    positions: ReadonlyMap<NodeId, { x: number; y: number; w: number; h: number }>,
  ) => { newParent: NodeId; beforeSibling?: NodeId } | null;
  /** ⭐⭐ S + G + 布局 → Instance[](稀疏覆盖全量) */
  readonly projectToInstances: (
    s: SLayer,
    g: GLayer,
    layout: import('./project-to-canvas').LayoutAnswer,
  ) => import('./project-to-canvas').ProjectedInstance[];
}
