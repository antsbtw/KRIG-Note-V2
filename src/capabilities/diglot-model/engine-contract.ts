/**
 * diglot-model — 同步引擎契约(步骤②:断言先于交互代码)
 *
 * ⚠️ **本文件只定契约,不含实现。** 实现是步骤③-⑤的事。
 *
 * ⭐ **为什么契约必须先于断言存在**:
 * 断言要验「拖动 → G 层多一条、S 层零变更」,就必须有个**统一的动作入口**可发。
 * 否则测试只能自己去改模型再断言自己改的结果 —— 那是 HANDOFF §5 头号自证形态
 * (「同步引擎根本没跑,而测试自己写了那条,也会绿」)。
 *
 * ⭐⭐ **纪律**:测试**只发 `DiglotAction`,绝不自己写模型**。
 * 引擎缺席时 `applyAction` 抛 `NotImplemented` → 断言红。
 * **红是正确状态**,它是步骤③-⑤的验收闸门。
 */

import type { GLayer, GLayerText, NodeId, SLayer } from './types';
import {
  parseMermaidMindmap as parseMermaidMindmapImpl,
  toMermaidMindmap as toMermaidMindmapImpl,
} from './mermaid-mindmap';
import {
  parseGLayer as parseGLayerImpl,
  serializeGLayer as serializeGLayerImpl,
} from './g-layer';
import { applyAction as applyActionImpl } from './apply-action';

// ─────────────────────────────────────────────────────────
// 1. 三面快照
// ─────────────────────────────────────────────────────────

/**
 * 一张图的完整状态。
 *
 * ⚠️ **注意没有 `instances`** —— 画布运行态是**派生物**(S+G+布局算出来的),
 * 不是状态的一部分。把它放进来就等于承认「画布状态需要单独存」,
 * 而那正是 03 §1.1 警告的「把 G 层存成 Instance[]」。
 */
export interface DiglotSnapshot {
  readonly s: SLayer;
  readonly g: GLayer;
}

// ─────────────────────────────────────────────────────────
// 2. 动作(三面的唯一入口)
// ─────────────────────────────────────────────────────────

/**
 * ⭐ 用户动作 —— **三个面的改动一律经此**,不许绕过。
 *
 * 每个 action 的落笔归属由 `LANDING_MATRIX`(types.ts)裁定,
 * 测试直接引用那张表,避免「测试自己写一份期望值」而与规格漂移。
 */
export type DiglotAction =
  // ── 语义面(落 S) ──
  | { readonly kind: 'semantic.editLabel'; readonly id: NodeId; readonly text: string }
  /**
   * ⭐ 就地编辑落定:直接给**富文本 doc**,不是纯文本。
   *
   * ⚠️ 与 `editLabel` 分设而非复用:编辑器回传的是 `DriverSerialized` 信封,
   * 把它拍平成字符串会**丢掉公式/行内格式/图片** —— 而那正是
   * 「行内编辑器即 note block 编辑器」的全部价值(01 §7.3,对 XMind 的超越)。
   */
  | { readonly kind: 'semantic.editLabelDoc'; readonly id: NodeId; readonly doc: unknown }
  | { readonly kind: 'semantic.moveIndent'; readonly id: NodeId; readonly newParent: NodeId | null; readonly beforeSibling?: NodeId }
  /** ⭐ 斜杠手势:S 层零残留(C8),G 层恰好一条 */
  | { readonly kind: 'semantic.slashShape'; readonly id: NodeId; readonly shape: string }
  // ── 画布(分流落 S 或 G) ──
  /** ⭐ 拖到空白 = 钉住坐标(落 G) */
  | { readonly kind: 'canvas.dragNode'; readonly id: NodeId; readonly x: number; readonly y: number }
  /** ⭐ 拖到节点上/兄弟缝隙 = 改父改序(落 S)—— M2 三义之二 */
  | { readonly kind: 'canvas.dragReparent'; readonly id: NodeId; readonly newParent: NodeId; readonly beforeSibling?: NodeId }
  /** ⭐ Shift+拖到空白 = 转自由主题(S:role→float;G:pos)—— M2 三义之三 */
  | { readonly kind: 'canvas.dragToFloat'; readonly id: NodeId; readonly x: number; readonly y: number }
  | { readonly kind: 'canvas.createNode'; readonly parent: NodeId | null; readonly text: string }
  /** ⭐ `Enter`:在选中节点**之后**插入兄弟(01 §7.1) */
  | { readonly kind: 'canvas.insertSibling'; readonly afterId: NodeId; readonly text: string }
  /** ⭐ `Tab`:插入子节点(01 §7.1) */
  | { readonly kind: 'canvas.insertChild'; readonly parentId: NodeId; readonly text: string }
  /**
   * ⭐ `Delete`:删节点**及其整棵子树**(01 §7.1)。
   * ⚠️ 连带清理其 G 条目与悬空 Edge —— 否则会留下指向不存在节点的孤儿。
   */
  | { readonly kind: 'canvas.deleteSubtree'; readonly id: NodeId }
  | { readonly kind: 'canvas.connect'; readonly source: NodeId; readonly target: NodeId; readonly label?: string }
  /**
   * ⭐ 断开一条联系线 —— 与 `canvas.connect` **对称**(用户 2026-09-14 拍板「甲」)。
   *
   * ⚠️ 刻意用 `{source,target}` 而非 `{id}`:两者都要推出边 id,
   * 用两端让 id 推导**只有 `deterministicEdgeId` 一处**;
   * 给 id 则 view 侧要从 `rel:<edgeId>` instance id 剥前缀再传,
   * **id 在两侧各拼一次 = 迟早漂移**(本仓库已有同形教训)。
   *
   * ⚠️ 边不存在 = **无变更**(幂等),不报错 —— 重复删/删空图都不该炸。
   */
  | { readonly kind: 'canvas.disconnect'; readonly source: NodeId; readonly target: NodeId }
  // ── 图形面(落 G) ──
  | { readonly kind: 'graphic.editColor'; readonly id: NodeId; readonly color: string }
  /** ⭐ 删 pos 条目 → 回自动布局(C7 的画布入口) */
  | { readonly kind: 'graphic.deletePos'; readonly id: NodeId }
  /**
   * ⭐ 折叠/展开某节点的子树(01 §7.5)。
   *
   * ⚠️ 落 **G 层 V 类**且**持久**(规格 §3.1 明写)——
   * 与 note 侧「仅存 plugin state、重启即重置」的策略**刻意不同**:
   * 导图的折叠是**图的一部分**(我设计这张图时就想让它默认收着),
   * 不是「我这会儿不想看」的临时视图状态。
   */
  | { readonly kind: 'graphic.toggleCollapsed'; readonly id: NodeId }
  /**
   * ⭐ 全图恢复自动布局:清空**所有** pos 条目(01 §7.5「释放钉住」的整图版)。
   *
   * ⚠️ 为什么单独一个 action 而不是循环发 deletePos:
   * 循环发会产生 N 个可撤销事务,用户按一次 Cmd+Z 只弹回一个节点 ——
   * 而他心里那一步操作是「整图恢复自动」。**一次操作 = 一条事务**(00 §7)。
   */
  | { readonly kind: 'graphic.releaseAllPos' };

// ─────────────────────────────────────────────────────────
// 3. 引擎接口
// ─────────────────────────────────────────────────────────

/** 坏语法/坏行的定位信息(C6:错误定位到行)。 */
export interface DiglotError {
  readonly line: number;
  readonly message: string;
}

/**
 * 解析结果 —— ⚠️ **坏输入不污染模型**(C6)。
 *
 * `ok:false` 时 `errors` 非空且**不返回半个模型**;
 * 调用侧保持**上一有效状态**。
 */
export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly DiglotError[] };

/**
 * ⭐ 同步引擎 —— mind v0 要实现的全部对外行为。
 *
 * ⚠️ 实现缺席时,每个方法都必须 **throw**,不许返回空值兜底
 * (`feedback-fail-loud-no-fallback`:静默兜底掩盖真 bug)。
 */
export interface DiglotEngine {
  /** mermaid `mindmap` 文本 → S 层树(树推导规则见 01 §4)。 */
  parseMermaidMindmap(text: string): ParseResult<SLayer>;
  /** S 层 → mermaid 文本(C9 round-trip 的回程)。 */
  toMermaidMindmap(s: SLayer): string;

  /** G 层文本 → 稀疏条目(坏行不污染,C6)。 */
  parseGLayer(text: GLayerText): ParseResult<GLayer>;
  /** ⭐ G 层 → 规范形文本。**幂等**:对规范形再序列化字节级不变(C1)。 */
  serializeGLayer(g: GLayer): GLayerText;

  /** ⭐⭐ 唯一的状态迁移入口。测试只调这个,绝不自己写模型。 */
  applyAction(snapshot: DiglotSnapshot, action: DiglotAction): DiglotSnapshot;
}

/**
 * ⚠️ 引擎尚未实现的哨兵错误。
 *
 * 断言撞上它 = **红**,这正是步骤③-⑤的验收闸门:
 * 实现落地后这些红自动转绿,**不需要改测试**。
 * ⭐ 改测试让它绿 = 违规(HANDOFF §4)。
 */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(
      `[diglot] ${what} 尚未实现 —— 这是步骤②预置的验收闸门。\n` +
        `实现落地后本断言自动转绿。⚠️ 不许改测试让它绿。`,
    );
    this.name = 'NotImplementedError';
  }
}

/**
 * v0 占位引擎 —— **每个方法都 fail loud**。
 *
 * ⭐ 存在的意义:让断言**现在就能写、现在就能跑、现在就是红的**,
 * 而不是 `it.skip`(skip 会被忘掉,红不会)。
 */
export const notImplementedEngine: DiglotEngine = {
  // ⭐ 步骤③已落地 —— 这两条接真实现,对应断言(M1/C6-mermaid/C9 前半)自动转绿。
  parseMermaidMindmap: parseMermaidMindmapImpl,
  toMermaidMindmap: toMermaidMindmapImpl,
  // ⭐ 步骤④已落地 —— C1 / C6-G层 / C9 后半 自动转绿。
  parseGLayer: parseGLayerImpl,
  serializeGLayer: serializeGLayerImpl,
  // ⭐ 步骤⑤已落地 —— 双向同步全部断言自动转绿。
  applyAction: applyActionImpl,
};
