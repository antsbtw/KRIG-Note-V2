/**
 * diglot-model — S + G → 画布 `Instance[]`(mind 渲染器的纯逻辑层)
 *
 * ⭐⭐ **这是 03 §1.1 那张关系图的代码化**:
 * ```
 * S 层(树) ──推导──┐
 *                  ├─→ ELK 自动布局(全量坐标) ─→ Instance[](喂画布)
 * G 层(稀疏 pos) ──┘   ⭐ 有条目的覆盖自动值;没条目的用算出来的
 * ```
 *
 * ⚠️⚠️ **G 层不是画布状态的存档**:
 * `Instance.position` 是**全量**的(没坐标画不出来),
 * G 层是**稀疏**的(只有被碰过的才有条目)。
 * 本文件就是那道「稀疏覆盖全量」的闸 —— 写错这里,C5/C7 的语义就没了。
 *
 * ⚠️ **本文件不碰渲染**:纯数据进、纯数据出,可离线测。
 * Three.js / React 都在 canvas-rendering 那边。
 */

import type { GLayer, NodeId, SLayer, SNode } from './types';
import { BLOCK_VISUAL_SPEC } from '../../lib/visual-spec/block-visual-spec';

// ─────────────────────────────────────────────────────────
// 1. 与 canvas-rendering / graph-layout 的契约(结构性对齐,不跨层 import)
// ─────────────────────────────────────────────────────────

/**
 * ⚠️ 刻意**不** import `@capabilities/canvas-rendering/types` 的 `Instance`:
 * 那会让 diglot-model 依赖渲染层(它 import three)。
 * 此处只声明**本模块产出的字段子集**,由 view 侧做结构性适配 ——
 * 形状一致即可,不需要类型同源(对齐仓库既有 "IPC 边界两侧形状一致" 做法)。
 */
export interface ProjectedInstance {
  readonly id: string;
  readonly type: 'shape';
  readonly ref: string;
  /** line 实例走 endpoints 磁吸,不带 position/size */
  readonly position?: { x: number; y: number };
  readonly size?: { w: number; h: number };
  /** DriverSerialized 信封 —— 与 note block 同一形态(line 无 doc) */
  readonly doc?: unknown;
  /** ⭐ 字号(pt)—— 按树深度取 h1~hn,与 note 标题层级同一套 */
  readonly text_size?: number;
  /**
   * ⭐ shape 参数覆盖(覆盖 ShapeDef.params 的 default)。
   * 导图用它把文字内缩钉成固定 10px,见 TEXT_INSET_PX。
   */
  readonly params?: Readonly<Record<string, number>>;
  /**
   * ⭐ 样式覆盖(canvas-rendering `Instance.style_overrides` 的结构性镜像)。
   *
   * ⚠️⚠️ **漏声明的字段会被静默丢掉**(TS 结构类型不报错)—— 与下面 magnetActions
   * 同一个坑:`dashType` / `arrow` 起初没声明,联系线的虚线与箭头**写了也传不过去**。
   * ⭐ 加字段时对照 `canvas-rendering/types.ts` 的 `Instance.style_overrides`。
   */
  readonly style_overrides?: {
    fill?: { color?: string };
    line?: { color?: string; width?: number; dashType?: string };
    /** 两端端形(`none`/`arrow`/`triangle`/`stealth`/`diamond`/`oval`)。 */
    arrow?: { begin?: string; end?: string };
  };
  /**
   * ⭐ 连接点操作点(canvas-rendering 的 `Instance.magnetActions`):
   * 有子节点的节点在 `E`(右侧连接点,也正是树连线出发的那个点)挂一个圆,
   * 点它折叠/展开 —— 规格 §7.5「徽标点击」的那一半(键盘那一半已由 `-`/`+` 落地)。
   *
   * ⚠️ 图标反映**当前状态下点它会发生什么**:已折叠挂 `plus`(点了展开),
   * 展开挂 `minus`(点了折叠)。与 `-`/`+` 两键各司其职的语义一致。
   *
   * ⭐ `count` = 圆圈里显示的数字(折叠了几个直接子节点),**只在折叠态给**。
   * ⚠️ 这个字段必须在这里声明 —— 本类型是与 canvas-rendering 的**结构性镜像**,
   * 漏声明的字段会在 view 侧适配时被**静默丢掉**(TS 结构类型不会报错)。
   */
  readonly magnetActions?: ReadonlyArray<{
    magnet: string;
    icon: 'plus' | 'minus' | 'dot';
    count?: number;
  }>;
  /**
   * ⭐ 树连线的两端(父 → 子)。
   * 走 magnet 而非固定坐标 —— 这样**拖动节点时线自动跟随**,
   * 不需要我们在拖动回调里重算走线(那正是画板 rewire 已经解决的问题,白用)。
   */
  readonly endpoints?: readonly [
    { instance: string; magnet: string },
    { instance: string; magnet: string },
  ];
}

/** graph-layout 的输入形态(`LayoutNodeInput` / `LayoutEdgeInput` 结构性对齐)。 */
export interface LayoutRequest {
  readonly nodes: { id: string; width: number; height: number }[];
  readonly edges: { id: string; source: string; target: string }[];
}

/** graph-layout 的输出形态(`LayoutResult` 子集)。 */
export interface LayoutAnswer {
  readonly nodes: readonly { id: string; x: number; y: number }[];
}

// ─────────────────────────────────────────────────────────
// 2. 节点尺寸估算
// ─────────────────────────────────────────────────────────

/**
 * ⭐ 按内容估算节点尺寸 —— **节点大小跟着文字走**,不是一刀切。
 *
 * ⚠️ 上一版把下限设成 120,结果六个短标签(主题/分支A/叶子1…)**全部撞到下限**,
 * 于是每个节点都是 120×52 一模一样(真机实测,用户指出)。
 * 一刀切既不好看,也让树的层次感消失 —— 长标题和短叶子应当一眼看出差别。
 *
 * 估算依据(对齐渲染实参,不是拍脑袋):
 * - 字号 16px = `BLOCK_VISUAL_SPEC.body.fontSize`,即 NodeRenderer 的 baseFontSize 兜底值
 * - CJK 按全宽 ≈ 1em = 16px;ASCII 按 ≈ 0.55em ≈ 9px
 * - 左右内边距 2×14(roundRect 的 textBox 按圆角内缩,取近似)
 *
 * ⚠️ 仍是**估算**:精确尺寸要等文字层 measure 后回填(canvas-text-node 的
 * adaptTextNodeSizeToContent 走的就是那条路)。此处只求"比例对、不撞下限"。
 */
/**
 * ⭐⭐ 节点字号按**树深度**取 h1~hn —— 与 note 的标题层级同一套(用户拍板 2026-09-10)。
 *
 * ⭐ 数值**逐字取自 `BLOCK_VISUAL_SPEC`**,不另立一套:
 * h1=38 / h2=28 / h3=22 / body=16(它们本就对应 pm-host.css 的真实样式)。
 * 这样导图的「主题→分支→叶子」和 note 的「h1→h2→h3→正文」**看起来是同一个东西** ——
 * 这正是「同一 blocks 数据可按大纲或导图解释」(01 §3.4)在视觉上的兑现。
 *
 * ⚠️ 深度超过 h3 一律用正文号(note 也只定义到 h3),不再往下缩 ——
 * 无限缩小会让深层节点不可读。
 */
const DEPTH_FONT_SIZE: readonly number[] = [
  BLOCK_VISUAL_SPEC.headings.h1.fontSize, // 深度 0:root(主题)
  BLOCK_VISUAL_SPEC.headings.h2.fontSize, // 深度 1:分支
  BLOCK_VISUAL_SPEC.headings.h3.fontSize, // 深度 2
];

/** 某深度用多大字号。⚠️ 超出 h3 一律正文号,不继续缩。 */
export function fontSizeForDepth(depth: number): number {
  return DEPTH_FONT_SIZE[depth] ?? BLOCK_VISUAL_SPEC.body.fontSize;
}

/** 内边距随字号缩放 —— 大字号配大留白,否则 h1 节点会显得挤。 */
function paddingFor(fontSize: number): { x: number; y: number } {
  return { x: Math.round(fontSize * 1.6), y: Math.round(fontSize * 1.0) };
}

/**
 * ⭐⭐ 西文字符的宽度系数 —— **必须与渲染层 `estimateAdvance` 一致**。
 *
 * ⚠️ 真机踩过:这里曾是 `0.55`,而 textBlock.ts 的 `estimateAdvance` 是 **0.6**。
 * 「分支Achang123」差 13px —— 我算 195、渲染 207,而 textBox 可用宽只有 209,
 * 只剩 2px 余量 → **测试绿、真机照折行**。
 * ⭐ 度量不同源,就等于没度量。
 */
const LATIN_ADVANCE_RATIO = 0.6;

function measureText(text: string, fontSize: number): { w: number; h: number } {
  const lineH = Math.round(fontSize * 1.4);
  if (text.length === 0) return { w: Math.round(fontSize * 2.5), h: lineH };
  let w = 0;
  for (const ch of text) {
    // ⚠️ 判据也要与渲染层同口径:它只认 U+4E00–9FFF 为全宽
    const code = ch.codePointAt(0) ?? 0;
    w += code >= 0x4e00 && code <= 0x9fff ? fontSize : fontSize * LATIN_ADVANCE_RATIO;
  }
  return { w: Math.round(w), h: lineH };
}

/**
 * 节点尺寸:**给 ELK 的初始估算**,不是最终尺寸。
 *
 * ⭐⭐ **真实高度由渲染层撑**(NodeRenderer.adaptTextNodeSizeToContent):
 * 那里量的是**真正渲染出来的内容**(atomsToSvg 的 bbox),行内公式、折行、
 * 将来任何新 inline 类型都天然算得进去。
 *
 * ⚠️ 所以本函数**故意不追求精确** —— 它只需要给 ELK 一个同量级的同步初值
 * (布局是同步的,拿不到异步渲染结果)。想在这里把公式宽度也算对,
 * 等于在 diglot 里维护第二套文字测量 —— 那正是「主题2 + 公式」溢出的根因:
 * 测量端看不见公式(contentToText 对 mathInline 返回 ''),渲染端照画。
 *
 * ⭐ 估算宽了/窄了不会错位:撑高会回写真实高度。
 * ⚠️ 但**宽度**不会被回写(撑高只管高),所以宽度估算仍要合理 ——
 * 超过 maxW 的长文本走换行,高度随之增长,由渲染层撑开。
 */

/**
 * ⭐⭐ content 信封里**每一块的纯文本**(首块=标题,其余=正文)。
 * ⚠️ 宽度要按**最宽那一行**算 —— 只量首块会让正文被硬折或溢出(真机踩过)。
 */
function blockTextsOf(content: { payload?: unknown } | undefined): string[] {
  const payload = content?.payload as { content?: unknown[] } | undefined;
  const blocks = (payload?.content ?? []) as { content?: { text?: string }[] }[];
  return blocks.map((b) => (b.content ?? []).map((r) => r.text ?? '').join(''));
}

/**
 * ⭐⭐ 节点尺寸的**唯一入口** —— 布局与渲染都必须走它。
 *
 * ⚠️⚠️ 曾经有两个调用点参数不同:
 *   buildLayoutRequest → nodeSize(label, fs)              ← 漏了正文
 *   projectToInstances → nodeSize(label, fs, extraBlocks)
 * → ELK 按「只有标题」排版,实际框却带正文长得更大 →
 *   **压住兄弟节点、挡住连线**(真机截图)。
 * ⭐ 现在统一走 `nodeSizeOf(node)`,两处同源,不可能再漂移。
 */
function nodeSizeOf(
  content: { payload?: unknown } | undefined,
  fontSize: number,
): { w: number; h: number } {
  const texts = blockTextsOf(content);
  const head = texts[0] ?? '';
  const bodies = texts.slice(1);
  return nodeSize(head, fontSize, bodies.length);
}

/**
 * ⭐⭐ 整张图的节点尺寸表 —— **布局与渲染的唯一来源**。
 *
 * ⭐ 宽度**各自按自己的 hn 文字长度**算(用户 2026-09-11:
 * 「不用强调所有同级的主题框都一样长吧?各自根据 hn 的文字长度就好了」)。
 *
 * ⚠️ 我一度做成「同层取最宽者」,是**把用户的话理解窄了** ——
 * 「同一种图元用同一种处理方法」指的是**规则一致**(宽度都由 hn 决定),
 * 不是**结果一致**(都一样宽)。把短标题硬撑到最宽者那么长,
 * 反而是拿另一套规则去改它(真机:分支B 被无谓拉长)。
 *
 * ⚠️ 高度同理:内容多的本来就该更高,那是**内容差异**。
 *
 * ⭐ 本函数存在的真正价值是**单一来源**:布局端(buildLayoutRequest)与
 * 渲染端(projectToInstances)读同一张表,杜绝「两处各算一次、算法还不一样」
 * 那类漂移(踩过:ELK 按只有标题排版、实际框带正文更大 → 重叠挡线)。
 */
function sizeTable(
  vis: readonly SNode[],
  depths: ReadonlyMap<NodeId, number>,
): Map<NodeId, { w: number; h: number }> {
  const out = new Map<NodeId, { w: number; h: number }>();
  for (const n of vis) {
    const d = depths.get(n.id) ?? 0;
    out.set(n.id, nodeSizeOf(n.content, fontSizeForDepth(d)));
  }
  return out;
}

function nodeSize(
  text: string,
  fontSize: number,
  extraBlocks = 0,
): { w: number; h: number } {
  const m = measureText(text, fontSize);
  const pad = paddingFor(fontSize);
  const minW = Math.round(fontSize * 3);

  // ⭐⭐ 宽度**只由标题(hn)那一行决定**(用户 2026-09-11 拍板):
  //   「应该按照 hn 的长度来确定主题框的长度,除非用户手动缩短。」
  //
  // ⚠️ 先前写成「取最宽那一行(含正文)」—— 方向就不对:
  //   一行长正文就能把框撑得很宽,而正文本来就该**在框内折行**。
  // ⭐ 反过来,标题**必须一行装下**:装不下就会折行 → 框比 ELK 的估算更高
  //   → 渲染层撑高 → **把兄弟间距吃掉**(真机实测:同层间距 85px 只剩 11px)。
  //   所以这条规则不只是好看,它是**布局稳定的前提**。
  const widest = m.w;

  // ⭐ 上限不是「排版宽度」,而是**防失控的兜底** —— 有人粘一整段进来时,
  //   不至于把图横向撑到几千像素;到那个长度才折行是合理的。
  //
  // ⚠️⚠️ 真机那次「标题被强行折行」**不是这里夹的**(实测:「主题278910101次」
  //   在 h1 只需 363px,而 16 字上限是 608px,任何层级都没碰到过)。
  //   真凶是 text_size 与块 level **叠乘**把字撑到 90px(见 text_size 处注释)。
  //   ⭐ 记这一笔是因为我当时改宽了上限、症状却还在 —— **改错地方而症状仍在**,
  //   说明「看起来相关」不等于「就是它」。上限保持 16 字宽不动。
  const maxW = Math.round(fontSize * 16);
  // ⭐⭐ 标题**不许折行**(用户 2026-09-11)。要装下它,框宽必须同时覆盖:
  //   ① 文字本身(按渲染层口径算)
  //   ② roundRect 的 textBox **左右内缩** —— 渲染层按内缩后的宽折行
  //   ③ 渲染层自述的 **±10% 估算误差**余量
  //
  // ⚠️⚠️ 内缩公式是 `rad = 0.15 × **min(w, h)**`(见 roundRect.json 的 guides),
  //   基准是**宽高里较小的那个**。我先前按 `need/(1−2×0.15)` 反解,
  //   等于假设内缩 = 0.3×**w** —— 而节点通常 h < w,真实内缩只有 0.3×h。
  //   后果:白白多留一大截空白(实测框宽 326、文字仅 207、右侧富余 88px),
  //   ⭐ 而且框被撑得过宽会**盖住父节点连过来的曲线**(用户:「分支A 怎么看不到连线了」)。
  //
  // ⭐⭐ **与渲染层同一条公式**(textBlock.ts:`fontSize × 1.7`),
  //   标题行按本级字号、正文行按正文号 —— 因为首块保留了 level 之后,
  //   渲染层就是这么分别算的。
  // ⚠️ 估算与渲染不同源正是本轮一连串毛病的根源;这里对齐,ELK 才能
  //   预留出接近真实的高度,撑高时不至于长出一大截压到兄弟节点(重叠)。
  // ⭐ 先算高度。标题**通常**一行(本函数就是为此定宽),
  //   ⚠️ 但标题长到超过 maxW 时仍会被夹住 → 那时真的会折行,高度必须跟上,
  //     否则第二行溢出框外(踩过)。所以行数按「被 maxW 夹住后的可用宽」算。
  const cappedW = Math.max(minW, Math.min(maxW, widest + pad.x));
  const headLines = Math.max(1, Math.ceil(m.w / Math.max(1, cappedW - pad.x)));

  const LINE_RATIO = BLOCK_VISUAL_SPEC.body.lineHeight;
  const bodyFs = BLOCK_VISUAL_SPEC.body.fontSize;

  // ⭐ 渲染层真正产出的内容高(textBlock.ts:每块 fontSize × 1.7 累加)
  const contentH =
    Math.round(fontSize * LINE_RATIO) * headLines +
    Math.round(bodyFs * LINE_RATIO) * extraBlocks;

  // ⭐⭐ 高度必须**连 textBox 的上下内缩一起覆盖**(真机日志定位)。
  //
  // ⚠️⚠️ 内缩 `insetY = 2 × 0.15 × min(w, h)` —— 注意它**依赖 h 自己**:
  //   h 涨一点 → insetY 跟着涨 → 需要的 h 又涨 → **自激**。
  //   真机日志实测撑了 3 轮才收敛(130→138→140),每轮都是一次全节点重渲。
  // ⭐ 解析解(h < w 时 min 取 h):
  //     h ≥ contentH + 0.3·h + ADAPT_PADDING  ⟹  h ≥ (contentH + PADDING) / 0.7
  //   一次到位,撑高**根本不触发**,自激自然不存在。
  //
  // ⚠️ 我先前只给了 `pad.y = fontSize × 1.0`(≈28),而实测 insetY ≈ 42 —— 不够。
  //   **宽度那边算了左右内缩,高度这边却忘了上下内缩**,是同一个疏忽的两半。
  // ⭐⭐ 内缩现在是**常量 10px**(TEXT_INSET_PX),不再依赖 h ——
  //   先前 `insetY = 0.3×min(w,h)` 依赖 h 自己,导致**自激**
  //   (真机日志:撑了 3 轮才收敛),需要解析解 `(contentH+8)/0.7`。
  // ⭐ 固定之后退化成简单加法,一次到位。
  const ADAPT_PADDING = 8; // 与 NodeRenderer.adaptTextNodeSizeToContent 一致
  const h = contentH + 2 * TEXT_INSET_PX + ADAPT_PADDING;

  // ⭐ 内缩以 **min(w, h)** 为基准,而节点通常 h < w → 用 h 算即可;
  //   ⚠️ 若 w 反而更小(极短标题),真实内缩只会更小 → 更宽松,不会折行。
  const ESTIMATE_MARGIN = 1.1;
  const needed = widest * ESTIMATE_MARGIN;
  const forNoWrap = Math.ceil(needed + 2 * TEXT_INSET_PX);
  const w = Math.max(minW, Math.min(maxW, Math.max(widest + pad.x, forNoWrap)));

  return { w, h };
}

/**
 * ⭐ 折叠裁剪:`collapsed` 的节点,其**整棵子树不出现在 instances 里**。
 *
 * 依据 03 §2 对照表:`collapsed` 在 Instance 侧是「子树不出现」,
 * 不是某个字段 —— 折叠是**渲染时裁剪**,不是模型删除。
 */
/** 每个节点到 root 的深度(root=0)。⭐ 字号按它取 h1~hn。 */
function depthMap(s: SLayer): Map<NodeId, number> {
  const byId = new Map(s.nodes.map((n) => [n.id, n]));
  const cache = new Map<NodeId, number>();
  const depthOf = (id: NodeId, guard = 0): number => {
    const hit = cache.get(id);
    if (hit !== undefined) return hit;
    const n = byId.get(id);
    // ⚠️ guard 防成环:数据坏了也不能让 UI 卡死(可靠性纲领)
    if (!n || n.parent === null || guard > 64) {
      cache.set(id, 0);
      return 0;
    }
    const d = depthOf(n.parent, guard + 1) + 1;
    cache.set(id, d);
    return d;
  };
  for (const n of s.nodes) depthOf(n.id);
  return cache;
}

function visibleNodes(s: SLayer, g: GLayer): SNode[] {
  const byParent = new Map<string, SNode[]>();
  for (const n of s.nodes) {
    const k = n.parent ?? '\0root';
    const arr = byParent.get(k);
    if (arr) arr.push(n);
    else byParent.set(k, [n]);
  }
  const out: SNode[] = [];
  const walk = (n: SNode): void => {
    out.push(n);
    // ⚠️ 自身折叠 → 后代全部跳过(但自身仍然可见)
    if (g.get(n.id)?.collapsed === true) return;
    for (const c of byParent.get(n.id) ?? []) walk(c);
  };
  for (const top of byParent.get('\0root') ?? []) walk(top);
  return out;
}

// ─────────────────────────────────────────────────────────
// 3. 布局请求
// ─────────────────────────────────────────────────────────

/**
 * S 层 → ELK 布局输入。
 *
 * ⚠️ **树的父子在这里才变成 edges** —— 那是**布局算法的输入格式要求**,
 * 不是数据模型(03 §3:文档本体零边,parent 是节点自身属性)。
 * 两者别混:这些 edge 活不过本函数的调用栈。
 */
export function buildLayoutRequest(s: SLayer, g: GLayer): LayoutRequest {
  const vis = visibleNodes(s, g);
  const visIds = new Set(vis.map((n) => n.id));
  const depths = depthMap(s);
  // ⭐ 与 projectToInstances **同一张表**,不可能再漂移
  const sizes = sizeTable(vis, depths);
  return {
    nodes: vis.map((n) => {
      const sz = sizes.get(n.id)!;
      return { id: n.id, width: sz.w, height: sz.h };
    }),
    edges: vis
      .filter((n) => n.parent !== null && visIds.has(n.parent))
      .map((n) => ({ id: `layout-${n.id}`, source: n.parent!, target: n.id })),
  };
}

// ─────────────────────────────────────────────────────────
// 4. ⭐⭐ 稀疏覆盖全量
// ─────────────────────────────────────────────────────────

/**
 * ⭐⭐ 形状 → shape-library ref:**直通**,不是白名单。
 *
 * 用户拍板:「mind 应该可以调用画板的任何 shape」—— mind 只是画板的一个应用,
 * 不该自带一份形状清单。所以:
 *
 * - 已经是完整 ref(含 `.`,如 `krig.basic.ellipse` / 将来的 `krig.flow.decision`)
 *   → **原样透传**,shape 库新增任何形状 mind 立即可用,本文件零改动
 * - 短名(`rect` / `circle` …)→ 查别名表,纯为 mermaid 语法和手写方便
 * - 没给 → 默认圆角矩形
 *
 * ⚠️ **本函数不校验 ref 是否真的存在** —— 校验要查 ShapeRegistry,
 * 而它的 bootstrap 用 `import.meta.glob`(Vite 专属)且是顶层副作用,
 * 一 import 就把 diglot-model 从「node 纯环境可离线测」拖进 Vite 依赖
 * (vitest.config 是 `environment: 'node'`,当场就跑不起来)。
 * ⭐ 校验放在 **view 侧**(投影结果喂给画布前),那里本来就有 registry。
 *
 * ⚠️ 旧版是四条目 switch + `default` 静默回落成矩形 —— 用户写了库里没有的形状,
 * 图上默默给个圆角矩形**不吭声**。那是静默兜底(违反可靠性纲领),已废。
 */
const SHAPE_ALIASES: Readonly<Record<string, string>> = {
  text: 'krig.basic.text',
  ellipse: 'krig.basic.ellipse',
  circle: 'krig.basic.ellipse',
  rect: 'krig.basic.rect',
  roundRect: 'krig.basic.roundRect',
};

/**
 * ⭐⭐ 导图节点的**固定文字内缩**(用户 2026-09-11:「固定边距离吧,先按照 10px」)。
 *
 * ⚠️ 原先内缩 = 圆角半径 `rad = 0.15 × min(w,h)` —— 一个参数管两件事,
 * 且**随框变大而变大**(实测 15.4 → 23.7px):框越高文字离边越远,
 * 正文可用空间被越挤越小。
 *
 * ⭐ 改法**不动共用 shape 的缺省行为**:roundRect 新增 px 参数 `textPad`,
 * `tpad = max(textPad, rad)`,缺省 textPad=0 → 仍等于 rad(画板既有图元零变化)。
 * mind 传 `textPad=10` 且把 `r` 调小(使 rad ≤ 10)→ 内缩恒为 10px。
 */
export const TEXT_INSET_PX = 10;

/**
 * ⭐ 导图节点的圆角比例。
 *
 * ⚠️ 早期版本必须把它压到 0.05 才能让固定内缩成立(那时 `tpad = max(textPad, rad)`,
 * 节点一大 rad 就反超 10)。现在 shape 的 guides 已让 **textPad 无条件胜出**,
 * 圆角与文字内缩**彻底解耦** —— 所以这里可以用正常弧度,不必为内缩牺牲外观。
 */
const MIND_CORNER_RATIO = 0.12;

/** 没给形状时的默认 —— 导图节点是圆角矩形。 */
export const DEFAULT_MIND_SHAPE_REF = 'krig.basic.roundRect';

export function refForShape(shape: string | undefined): string {
  if (!shape) return DEFAULT_MIND_SHAPE_REF;
  // ⭐ 完整 ref 直通:库里有什么就能用什么
  if (shape.includes('.')) return shape;
  return SHAPE_ALIASES[shape] ?? shape;
}

/**
 * ⭐⭐ S + G + 布局结果 → `Instance[]`。
 *
 * **覆盖顺序(这就是全部要义)**:
 * 1. 自动布局给出**全量**坐标
 * 2. ⭐ G 层有 `pos` 的**覆盖**它(pos 存在即 pinned)
 * 3. G 层没条目的,原样用算出来的(缺省即自动)
 *
 * ⚠️ 布局结果缺某个可见节点 → **fail loud**,不静默给 (0,0)
 * (否则一堆节点叠在原点,看起来像"渲染坏了",查起来极费劲)。
 */
export function projectToInstances(
  s: SLayer,
  g: GLayer,
  layout: LayoutAnswer,
  lineStyle?: TreeLineStyle,
): ProjectedInstance[] {
  const vis = visibleNodes(s, g);
  const pos = new Map(layout.nodes.map((n) => [n.id, n]));
  const depths = depthMap(s);

  // ⭐⭐ **同层级左对齐**(用户 2026-09-11:「同一个级别的 shape,应该左边对齐」)。
  //
  // ⚠️ 起因:自适应宽度上线后,同层一宽一窄 → 左边缘参差不齐,
  //   宽框向左"探出"压住父节点和连线(真机截图:分支B 盖在连线上)。
  // ⚠️ ELK 侧无解 —— 实测 `elk.alignment` 对 mrtree **完全没有效果**
  //   (同层 x=176 vs x=306,加不加一模一样),所以在这里做一次后处理。
  // ⭐ 取该层**最小 x**:向左对齐,不会把任何节点往右推出原本的走廊。
  // ⚠️ 被钉住的节点(G 层有 pos)**不参与** —— 用户摆的位置优先(C7)。
  const sizes = sizeTable(vis, depths);

  const alignX = new Map<number, number>();
  for (const n of vis) {
    if (g.get(n.id)?.pos) continue; // 钉住的不参与统计
    const p = pos.get(n.id);
    if (!p) continue;
    const d = depths.get(n.id) ?? 0;
    const cur = alignX.get(d);
    if (cur === undefined || p.x < cur) alignX.set(d, p.x);
  }

  const nodes: ProjectedInstance[] = vis.map((n) => {
    const entry = g.get(n.id);
    const auto = pos.get(n.id);
    // ⭐ 稀疏覆盖:G 层有 pos 就用它,否则用自动布局
    // ⭐ 自动布局的坐标先做同层对齐;G 层有 pos 的直接用 pos(不对齐)
    const aligned =
      auto === undefined
        ? undefined
        : { x: alignX.get(depths.get(n.id) ?? 0) ?? auto.x, y: auto.y };
    const p = entry?.pos ?? aligned;
    if (!p) {
      throw new Error(
        `[diglot] 节点 ${n.id} 既无 G 层 pos 也不在布局结果里 —— ` +
          `布局输入与可见节点集不一致(不静默兜底,见可靠性纲领)`,
      );
    }
    // ⭐ 折叠的节点在画布上**与叶子长得一样** —— 看不出「下面还有东西」。
    //   解法:折叠时把**子节点数显示在连接点圆圈里**(magnetActions.count),
    //   用户一眼看到「点开有几个分支」。
    //
    // ⚠️⚠️ 曾经的做法是**在标签后缀 `（N）`**,已废弃,别改回去 —— 两个理由:
    //   ① 数字进圆圈后,后缀是**重复信息**,还把节点撑宽、改变布局;
    //   ② 后缀必须走 `textToContent(shown)` 重造文本 doc,
    //      **折叠期间富文本(公式/格式/图片)会被拍平成纯文本**。
    //   现在 doc 原样透传,折叠不再损失任何内容。
    //
    // ⚠️ 圆圈里的数字**不受打包字体字形缺失影响**(当年 `⊕` 渲染成空白那个坑):
    //   它走 canvas fillText → CanvasTexture,用的是**系统字体**,不是那套打包字体。
    const kidCount = s.nodes.filter((x) => x.parent === n.id).length;
    const isCollapsed = entry?.collapsed === true && kidCount > 0;
    return {
      id: n.id,
      type: 'shape' as const,
      ref: refForShape(entry?.shape),
      // ⚠️ 坐标量化为整数(00 §4);G 层来的本已是整数,自动布局的可能带小数
      position: { x: Math.round(p.x), y: Math.round(p.y) },
      // ⭐ 估算要算上并进该节点的正文块数(规格 03 §5.5:节点 = 标题 + 正文),
      //   否则 ELK 按「只有标题」排版,撑高后容易和兄弟节点压到一起。
      //   ⚠️ 仍只是**初值**:真实高度由渲染层撑(见 nodeSize 注释)。
      size: sizes.get(n.id)!,
      // ⭐ 固定 10px 文字内缩(见 TEXT_INSET_PX):textPad 生效的前提是 rad ≤ 它
      params: { textPad: TEXT_INSET_PX, r: MIND_CORNER_RATIO },
      // ⭐⭐ 字号透传给渲染层。
      //
      // ⚠️⚠️ **这里必须传正文号(16),不能传该深度的标题号**:
      //   渲染层的公式是 `fontSize = headingFontSize(level) × (text_size / 16)`
      //   —— 它**自己会按块的 level 放大**。若这里再传 38(h1),
      //   首块会被渲成 `38 × (38/16) = 90px`(实测),是估算宽度的 2.4 倍
      //   → 文字装不下 → **被强行折行**(真机现象,一度以为是 maxW 夹的)。
      //
      // ⭐ 深度→字号的映射现在由 **note-projection 写在块的 level 上**
      //   (首块保留 heading/level),渲染层照 level 取字号,标题大、正文小,
      //   与 note 完全一致 —— 这正是「用回公共层那套」的意思。
      text_size: BLOCK_VISUAL_SPEC.body.fontSize,
      // ⭐ 原样透传富文本 —— 折叠与否都不动内容(公式/格式/图片保住)
      doc: n.content,
      ...(entry?.color ? { style_overrides: { fill: { color: entry.color } } } : {}),
      // ⭐ 有子节点才挂操作点 —— 叶子没得折,挂了会骗人
      // ⚠️ `count` **只在折叠态给**:展开时子节点自己就在画布上,再标数字是噪音
      ...(kidCount > 0
        ? {
            magnetActions: [
              {
                magnet: 'E',
                icon: isCollapsed ? ('plus' as const) : ('minus' as const),
                ...(isCollapsed ? { count: kidCount } : {}),
              },
            ],
          }
        : {}),
    };
  });

  return [
    ...nodes,
    ...projectTreeLines(vis, lineStyle),
    // ⭐ 传**最终**中心点(已含 G 层 pos 覆盖与同层对齐)—— 选磁吸点要按真实位置,
    //   不能用布局原始坐标,否则钉住/对齐过的节点会选错边。
    ...projectRelationLines(
      s,
      vis,
      new Map(
        nodes.map((n) => [
          n.id,
          { x: n.position!.x + n.size!.w / 2, y: n.position!.y + n.size!.h / 2 },
        ]),
      ),
    ),
  ];
}

/**
 * ⭐⭐ S 层 `edges`(联系线)→ 画布 instance。
 *
 * ⚠️ 此前 `projectToInstances` **完全不碰 `s.edges`**(grep 零命中)——
 * 于是 def 块里写的 `A -.支撑.-> C` 存得住、读得回,**画布上却什么都没有**。
 * 那正是 `00 §2.5.1` 修完「存不住」之后剩下的另一半:**看不见**。
 *
 * ⭐ **一端不可见就不画**(用户 2026-09-14 拍板丙):
 * 折叠会把整棵子树裁掉(`visibleNodes`),此时端点 instance 根本不存在 ——
 * 照画就是**指向不存在 instance 的悬空线**(树连线那条早有同款断言钉着)。
 * ⏳ 「折叠里面还有线」的提示标记**本轮不做**:用户要先在真机上看见联系线,
 * 才好判断那个提示值不值得加(且 E 磁吸点已被折叠数字占满,见 magnet-actions)。
 *
 * ⚠️ **走 magnet 不走固定坐标** —— 与树连线同一个理由:拖动节点时画布会
 * 自动重算端点(rewire 是画板既有能力,白用)。写死坐标就得自己维护。
 */
function projectRelationLines(
  s: SLayer,
  vis: readonly SNode[],
  centers: ReadonlyMap<NodeId, { x: number; y: number }>,
): ProjectedInstance[] {
  if (s.edges.length === 0) return [];
  const visIds = new Set(vis.map((n) => n.id));
  const out: ProjectedInstance[] = [];
  for (const e of s.edges) {
    // ⭐ 一端被折叠裁掉 → 不画(不留悬空线)
    if (!visIds.has(e.source) || !visIds.has(e.target)) continue;
    const a = centers.get(e.source);
    const b = centers.get(e.target);
    // ⚠️ 可见却没有中心点 = 上游算漏了,fail loud 不静默兜底(可靠性纲领)
    if (!a || !b) {
      throw new Error(
        `[diglot] 联系线 ${e.id} 的端点可见却拿不到中心点(source=${e.source} target=${e.target})`,
      );
    }
    const magnets = pickRelationMagnets(a, b);
    out.push({
      id: `${RELATION_LINE_PREFIX}${e.id}`,
      type: 'shape',
      ref: DEFAULT_RELATION_LINE.ref,
      // ⭐ 按相对位置选点(见 pickRelationMagnets):联系线连**任意两点**,
      //   写死 E→W 会让「目标在左」的线掉头横穿画布(真机实测过)。
      endpoints: [
        { instance: e.source, magnet: magnets[0] },
        { instance: e.target, magnet: magnets[1] },
      ],
      style_overrides: {
        line: {
          color: DEFAULT_RELATION_LINE.color,
          width: DEFAULT_RELATION_LINE.width,
          dashType: DEFAULT_RELATION_LINE.dashType,
        },
        // ⭐ 终点箭头 = 方向的唯一视觉表达(模型统一存有向,`01 §3.2`)
        arrow: { end: 'triangle' },
      },
    });
  }
  return out;
}

/** 树连线 instance 的 id 前缀 —— ⭐ 与节点 id 命名空间隔离,避免撞。 */
const TREE_LINE_PREFIX = 'tline:';

/**
 * ⭐ 树连线的可调参数(渲染观感)。
 *
 * 实测可调项就这几个 —— 画布的 line 渲染只吃 `ref`(决定几何)+ `LineStyle`
 * (color / width / dashType),再多的就要改渲染层了。
 *
 * | 参数 | 可选值 | 说明 |
 * |---|---|---|
 * | `ref` | `krig.line.curved` / `elbow` / `straight` | ⭐ 几何形态,观感差别最大 |
 * | `color` | 任意色值 | |
 * | `width` | 数字(屏幕像素) | |
 * | `dashType` | `solid` / `dash` / `dot` … | |
 *
 * ⚠️ 默认改成 **curved**(三次贝塞尔,控制点水平伸出)——
 * 这是思维导图的惯用形态,elbow 的直角折线在树上显得生硬(用户实测反馈)。
 */
export interface TreeLineStyle {
  readonly ref?: string;
  readonly color?: string;
  readonly width?: number;
  readonly dashType?: string;
}

export const DEFAULT_TREE_LINE: Required<Omit<TreeLineStyle, 'dashType'>> & {
  dashType: string;
} = {
  // ⭐ 曲线连接器:renderer 早就支持 krig.line.curved,只是**没有 shape 定义**
  //    (definitions/line/ 下只有 elbow/straight)—— 已补 curved.json。
  ref: 'krig.line.curved',
  color: '#5B8FC7',
  width: 1.5,
  dashType: 'solid',
};

/** 某个 instance id 是不是树连线(view 侧过滤拖动回调时要用)。 */
export function isTreeLineId(id: string): boolean {
  return id.startsWith(TREE_LINE_PREFIX);
}

/**
 * ⭐ 联系线 instance 的 id 前缀 —— ⚠️ **与树连线刻意分开**。
 *
 * 两者性质完全不同,判据混用会出两种反向的错:
 * - 树连线是**派生物**(每次由树重算),view 的拖动/删除回调一律跳过它;
 * - ⭐ 联系线是**用户数据**(S 层 `edges`),将来要能选中、能删 ——
 *   若被 `isTreeLineId` 认领就会被静默跳过(`03 §5.9.2` 记的「拖端点静默失败」同形)。
 */
const RELATION_LINE_PREFIX = 'rel:';

/** 某个 instance id 是不是联系线(树之外的附加关系,`01 §3.2`)。 */
export function isRelationLineId(id: string): boolean {
  return id.startsWith(RELATION_LINE_PREFIX);
}

/**
 * ⭐⭐ 按两端**相对位置**选磁吸点 —— 纯函数,可单测。
 *
 * ⚠️⚠️ **起因是真机 bug**(用户 2026-09-14 截图):此前写死 `源 E → 目标 W`,
 * 当目标在源**左边**时,线从右侧甩出去、掉头**横穿整张画布**再从左侧扎进来。
 * ⭐ 我当时的注释还写着「统一 E→W 视觉最不意外」—— **那句判断是错的**,
 * 它防的是另一种情形,而「目标在左」恰恰是它造成绕远的那种。
 *
 * ⭐ 探针还证否了第二个猜测:那条线**不是退化成直线**
 * (反向弯曲度 20.4 > 树连线 10.7)——**是跨度太大把弧度稀释了**。
 * 即:吸附点选错 → 线被迫横穿 → 看着像直线。**一个病根,两个症状。**
 *
 * 规则(简单可解释,优于聪明难预期):**谁的差值大就走哪个轴**
 * - |dx| ≥ |dy| → 水平:目标在右 `E→W`,在左 `W→E`
 * - |dx| < |dy| → 垂直:目标在下 `S→N`,在上 `N→S`
 *
 * ⚠️ 两点重合(dx=dy=0)→ 落 `E→W` 默认,**不产出空值**。
 */
export function pickRelationMagnets(
  from: { x: number; y: number },
  to: { x: number; y: number },
): [string, string] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['E', 'W'] : ['W', 'E'];
  return dy >= 0 ? ['S', 'N'] : ['N', 'S'];
}

/**
 * ⭐ 联系线的默认观感 —— ⚠️ **与树连线一眼区分**(规格 `01 §7.7.2`:
 * 「`B -.支撑.-> C` 虚线箭头 + 标签 = 联系线」)。
 *
 * | | 树连线 | ⭐ 联系线 |
 * |---|---|---|
 * | 线型 | 实线 | **虚线** |
 * | 箭头 | 无 | ⭐ **终点实心三角**(方向敏感:A→B 与 B→A 是两条边) |
 * | 颜色 | `#5B8FC7`(蓝) | 偏紫,避免与树连线混 |
 *
 * ⚠️ 箭头能画出来是因为刚补了画板的箭头渲染(`00 §9.1`);
 * 在那之前这里写 arrow 也是死字段。
 */
const DEFAULT_RELATION_LINE = {
  ref: 'krig.line.curved',
  color: '#9B7FD4',
  width: 1.5,
  dashType: 'dash',
} as const;

/**
 * ⭐ 由树的父子关系生成连线 instance。
 *
 * ⚠️⚠️ **这些线是纯派生物,不进任何模型**:
 * - S 层的 `edges` 是**联系线**(树之外的附加关系,01 §3.2),与此无关
 * - G 层不为它们存任何条目(它们没有"被用户触碰过"这回事)
 * ⭐ 每次投影按 parent 重新算 —— 树变了线自然跟着变,不需要维护。
 *
 * ⭐ **走 magnet 而非固定坐标**:父 E(右) → 子 W(左),
 * 左→右布局下这是最自然的接法;且拖动节点时画布会**自动重算端点**
 * (endpoints 跟随是画板既有能力,白用)。
 */
function projectTreeLines(
  vis: readonly SNode[],
  style?: TreeLineStyle,
): ProjectedInstance[] {
  const visIds = new Set(vis.map((n) => n.id));
  const s = { ...DEFAULT_TREE_LINE, ...style };
  const out: ProjectedInstance[] = [];
  for (const n of vis) {
    // 顶层节点(root / 自由主题)没有父,不画线
    if (n.parent === null || !visIds.has(n.parent)) continue;
    out.push({
      id: `${TREE_LINE_PREFIX}${n.id}`,
      type: 'shape',
      ref: s.ref,
      endpoints: [
        { instance: n.parent, magnet: 'E' },
        { instance: n.id, magnet: 'W' },
      ],
      style_overrides: { line: { color: s.color, width: s.width } },
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────
// 5. 反向:画布坐标 → 动作(拖动落笔的入口)
// ─────────────────────────────────────────────────────────

/**
 * ⭐⭐ 落点 → 结构归位:算出「拖到这个坐标,应该成为谁的孩子」。
 *
 * ⚠️ **v0.2(01 §7.2 修订)**:裸拖不再钉坐标,而是**改结构**。
 * 导图的位置是**算出来的**,不是摆出来的 —— 用户拖动表达的是
 * 「我要把这枝挂到那边去」,而不是「我要它停在这个像素」。
 *
 * 判定规则(简单但可解释,优于聪明但难预期):
 * 1. 候选 = 所有**可见且不在被拖子树内**的节点(不能挂到自己的后代下)
 * 2. 取落点**左侧**、水平距离最近的那个作父 —— 左→右布局下,父总在左边
 * 3. 左侧没有候选(拖到了最左)→ 挂到 root
 * 4. ⭐ 同父兄弟按落点 y 排序决定 order:落点在谁上方就排谁前面
 *
 * ⚠️ 返回 `null` = 不该改(拖回原位 / 没有合法父)——
 * 调用侧据此**不发 action**,避免产生一次无意义的变更。
 */
export function resolveDropTarget(
  s: SLayer,
  g: GLayer,
  draggedId: NodeId,
  drop: { x: number; y: number },
  positions: ReadonlyMap<NodeId, { x: number; y: number; w: number; h: number }>,
): { newParent: NodeId; beforeSibling?: NodeId } | null {
  const vis = visibleNodes(s, g);
  const byId = new Map(s.nodes.map((n) => [n.id, n]));

  // 被拖子树:自己 + 全部后代(不能挂到自己的后代下 —— 会成环)
  const inSubtree = new Set<NodeId>([draggedId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of s.nodes) {
      if (n.parent && inSubtree.has(n.parent) && !inSubtree.has(n.id)) {
        inSubtree.add(n.id);
        grew = true;
      }
    }
  }

  // 候选父:可见、不在被拖子树内
  const candidates = vis.filter((n) => !inSubtree.has(n.id));
  if (candidates.length === 0) return null;

  const root = s.nodes.find((n) => n.role === 'root');

  // 取落点左侧、**最近**的节点作父。
  // ⚠️ 必须同时看 y:左→右布局下同一层的节点 x 完全相同(分支A / 分支B 都在 x=117),
  //    只比 x 的话永远取到数组里靠前的那个 —— 拖到分支B 旁边却归给了分支A(实测)。
  //    故:先按"离落点最近的一列"筛,再在该列里按 y 距离取最近。
  let best: { id: NodeId; dx: number; dy: number } | null = null;
  for (const c of candidates) {
    const p = positions.get(c.id);
    if (!p) continue;
    const right = p.x + p.w;
    if (right > drop.x) continue; // 只认落点左侧的
    const dx = drop.x - right;
    const dy = Math.abs(drop.y - (p.y + p.h / 2));
    if (!best) {
      best = { id: c.id, dx, dy };
      continue;
    }
    // 更靠右的一列优先;同列(dx 相近)则取 y 更近的
    if (dx < best.dx - 1 || (Math.abs(dx - best.dx) <= 1 && dy < best.dy)) {
      best = { id: c.id, dx, dy };
    }
  }
  const newParent = best?.id ?? root?.id;
  if (!newParent) return null;

  // ⭐ 同父兄弟按落点 y 决定插到谁之前
  const sibs = s.nodes
    .filter((n) => n.parent === newParent && !inSubtree.has(n.id))
    .map((n) => ({ n, p: positions.get(n.id) }))
    .filter((e): e is { n: SNode; p: { x: number; y: number; w: number; h: number } } => !!e.p)
    .sort((a, b) => a.p.y - b.p.y);
  const before = sibs.find((e) => drop.y < e.p.y + e.p.h / 2);

  const dragged = byId.get(draggedId);
  // 父没变且位置没变 → 不产生变更(避免"拖回原位"也写一笔)
  if (dragged && dragged.parent === newParent && !before) return null;

  return before
    ? { newParent, beforeSibling: before.n.id }
    : { newParent };
}
