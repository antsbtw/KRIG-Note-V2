/**
 * diglot-model — KRIG 投影:树 ⇄ note block 序列(01 §5 的第二列)
 *
 * ⭐⭐ 规格 §5 的投影对照表本来就是**两列**:
 * ```
 * 概念        平文本 DSL          KRIG block
 * 层级        缩进                ⭐ h1~hn 序列
 * Node.id     ^id(要手写)       ⭐ block id(天然存在)
 * 标签+备注   内容行 + > 引用行   block 首段 + 余部
 * ```
 * 之前只实现了左列(mermaid)。本文件是右列。
 *
 * ⭐ 规格 §4 明写两者**同构**:
 * 「输入是扁平序列:KRIG 为『带 h 级别的 block 序列』,平文本为『带缩进的行序列』,
 *   两者同构,推导规则唯一」。
 * 所以树推导逻辑不用重写 —— 只是把「缩进深度」换成「h 级别」。
 *
 * ⭐⭐ **这条投影顺手解决债 6**(03 §8):
 * mermaid 侧的 id 按行序分配,用户增删行后 G 条目会错位;
 * 而 note block **自带稳定 id**,增删行不影响其它块 —— 债 6 在这条路上不存在。
 */

import type { NodeId, RichContent, SEdge, SLayer, SNode } from './types';
import { contentToText, textToContent } from './mermaid-mindmap';
import { deterministicEdgeId } from './edge-id';
// ⭐ 词法归 note(00 §2.5.9:def 是 note 的能力),本模块只做**词表与含义**。
// ⚠️ 分层依据 module-boundary-governance §1.3:`capabilities/L4 → drivers` 是
//   既有合法边(四处违规 V1–V4 不含它);违规的是**反方向** shared→drivers(V3)。
//   故此处直接 import driver 的词法模块,不把纯函数包成 capability 运行时依赖
//   —— diglot 至今零 capability 依赖,加一个是朝「震中」方向走。
import {
  parseDefText,
  defValue,
  defRelations,
} from '@drivers/text-editing-driver/blocks/def-block/lexicon';

/**
 * ⭐⭐ **层级对应关系(单一真源)** —— 用户拍板 2026-09-10。
 *
 * ```
 * 树深度   0    1    2    3    4    5    6      7+
 * note    h1   h2   h3   h4   h5   h6   段落   段落 + indent 逐级递增
 * ```
 *
 * ⭐ 两条原则:
 * 1. **能用 heading 就用 heading** —— note schema 本就支持 level 1-6
 *    (CommonMark,decision 005 D2),此前样式只到 h3 是渲染层的欠账,已补齐。
 * 2. **h6 之后用 indent 递进** —— 段落 + `indent` attr(note 的 Tab 就是改它),
 *    正好接上 note 既有的缩进机制,不发明新东西。
 *
 * ⚠️ **定义好对应关系,两边怎么变都对得上** —— 这是本文件存在的全部理由:
 * 深度 ↔ 表现形式是一张**双向查得到**的表,不是两处各写一套规则。
 */
const MAX_HEADING_LEVEL = 6;

/** 树深度 → note 表现形式。 */
export function noteFormForDepth(depth: number): {
  type: 'heading' | 'paragraph';
  level?: number;
  indent?: number;
} {
  if (depth < MAX_HEADING_LEVEL) return { type: 'heading', level: depth + 1 };
  // ⭐ h6 之后:段落 + indent 递进(indent 从 1 开始,对应深度 6)
  return { type: 'paragraph', indent: depth - MAX_HEADING_LEVEL + 1 };
}

/** note 表现形式 → 树深度(上表的**逆向**,两者必须严格互逆)。 */
export function depthForNoteForm(node: {
  type: string;
  attrs?: Record<string, unknown>;
}): number {
  if (node.type === 'heading') {
    const lv = node.attrs?.level;
    const level = typeof lv === 'number' ? lv : 1;
    return Math.max(0, Math.min(MAX_HEADING_LEVEL, level) - 1);
  }
  // 段落:按 indent 续接在 h6 之后
  const ind = node.attrs?.indent;
  const indent = typeof ind === 'number' ? ind : 0;
  return MAX_HEADING_LEVEL + Math.max(0, indent - 1);
}

/** PM doc 的最小结构(只取本模块用到的部分,不 import 编辑器类型)。 */
interface PmNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  text?: string;
  marks?: unknown[];
}

/** DriverSerialized 信封 —— 与 note block 同一形态。 */
export interface NoteDoc {
  readonly format: 'pm-doc-json';
  readonly version: '0.1';
  readonly payload: { readonly type: 'doc'; readonly content: readonly PmNode[] };
}

// ─────────────────────────────────────────────────────────
// 树 → block 序列
// ─────────────────────────────────────────────────────────

/** 取 content 首段的 inline 内容(标签本体),保住 marks/公式等富内容。 */
function inlineOf(content: RichContent): PmNode[] {
  const payload = content.payload as { content?: PmNode[] } | undefined;
  const first = payload?.content?.[0];
  return (first?.content ?? []) as PmNode[];
}

/**
 * ⭐ S 层树 → note block 序列(扁平,层级靠 h1~hn 表达)。
 *
 * ⚠️ 每个 block 带 `attrs.id = 节点 id` —— ⭐ 这就是「block id 天然存在」的落实,
 * 也是债 6 的解:用户增删行时,其它块的 id **不变**,G 条目照样配得上。
 */
export function treeToNoteDoc(s: SLayer): NoteDoc {
  const byParent = new Map<string, SNode[]>();
  for (const n of s.nodes) {
    const k = n.parent ?? '\0root';
    const arr = byParent.get(k);
    if (arr) arr.push(n);
    else byParent.set(k, [n]);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.order.localeCompare(b.order));

  const out: PmNode[] = [];
  const emit = (n: SNode, depth: number): void => {
    const inline = inlineOf(n.content);
    const form = noteFormForDepth(depth);
    out.push({
      type: form.type,
      attrs: {
        id: n.id, // ⭐ 稳定 id 落在 block 上,不在文字里
        ...(form.level !== undefined ? { level: form.level } : {}),
        ...(form.indent !== undefined ? { indent: form.indent } : {}),
      },
      ...(inline.length > 0 ? { content: inline } : {}),
    });

    // ⭐ def 块原样吐回,**紧跟在标题之后**(00 §2.5:hn 之后)——
    //   ⚠️ 位置必须与正向摘出时一致,否则往返不收敛(甲靠位置约定认归属)。
    //   ⚠️ 逐字节原样:注释行、不认识的行、非规范空格都不许「顺手规范化」。
    //   ⚠️ 无 def **不 emit 空块**(否则往返多出一段,01 §7.7.3 反向第 3 条)。
    for (const d of (n.defs ?? []) as PmNode[]) {
      out.push({
        type: d.type,
        ...(d.attrs ? { attrs: { ...d.attrs } } : {}),
        ...(d.content?.length ? { content: d.content } : {}),
      });
    }

    // ⭐⭐ 首块之后的块 = 并进来的正文,**原样 emit 成无 indent 的 paragraph**。
    //
    // ⚠️⚠️ 这里是本节最容易写错的地方:正文若也按深度加 indent,
    // 正向读回来就会被当成**层级** → 节点一轮轮增殖,往返不收敛。
    // (note-block-grouping.test.ts 的「往返收敛」断言钉的就是这条。)
    for (const extra of bodyBlocksOf(n.content)) {
      // ⭐⭐ 原样吐回**块类型 + attrs**:mathBlock 还是 mathBlock。
      // ⚠️ 但**不许带 indent** —— 带了会被正向读成层级 → 节点增殖、往返不收敛。
      const { indent: _drop, ...attrs } = (extra.attrs ?? {}) as Record<string, unknown>;
      out.push({
        type: extra.type,
        ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
        ...(extra.content?.length ? { content: extra.content } : {}),
      });
    }

    for (const c of byParent.get(n.id) ?? []) emit(c, depth + 1);
  };
  for (const top of byParent.get('\0root') ?? []) emit(top, 0);

  // ⚠️ PM doc 不能为空 —— 空树给一个空段落,否则编辑器报错
  return {
    format: 'pm-doc-json',
    // ⚠️ 必填,否则 deserializeDoc 返 null → 编辑器空白且不报错
    version: '0.1',
    payload: { type: 'doc', content: out.length > 0 ? out : [{ type: 'paragraph' }] },
  };
}

// ─────────────────────────────────────────────────────────
// block 序列 → 树
// ─────────────────────────────────────────────────────────

/**
 * block → 该块的「级别」(用于树推导的比较)。
 * ⭐ 直接复用 `depthForNoteForm` —— **同一张对应表,不另写一套规则**。
 */
function levelOf(node: PmNode): number {
  return depthForNoteForm(node);
}

/**
 * ⭐ content 信封里**首块之后**的块 = 并进该节点的正文(规格 03 §5.5)。
 * ⚠️ 首块是标签本体(inlineOf 取的就是它),不在此列。
 */
function bodyBlocksOf(content: RichContent): PmNode[] {
  const payload = content.payload as { content?: PmNode[] } | undefined;
  return (payload?.content ?? []).slice(1) as PmNode[];
}

/** 该块的纯文本(用于回落到 content 信封)。 */
function textOf(node: PmNode): string {
  return (node.content ?? []).map((c) => c.text ?? '').join('');
}

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function rankAt(i: number): string {
  let v = i + 1;
  let out = '';
  for (let d = 0; d < 4; d++) {
    out = DIGITS[v % 62] + out;
    v = Math.floor(v / 62);
  }
  return out;
}

/**
 * ⭐ note block 序列 → S 层树。
 *
 * 树推导**完全照搬规格 §4**(与 mermaid 侧同一套规则,只是「级别」来源不同):
 * 1. `parent(n)` = 序列中 n 之前、级别小于 n 的**最近**节点
 * 2. 级别跳跃**宽容解释**(h1 下直接 h3 → 归就近父级,不报错)
 * 3. `order` = 同父兄弟间的序列先后
 * 4. 首个顶层为 root,其余为 floating
 *
 * ⭐ **id 优先取 block 自带的 `attrs.id`** —— 这是债 6 的解:
 * 用户增删块时,其它块的 id 不变,G 条目照样配得上。
 */
export function noteDocToTree(doc: unknown): SLayer {
  const d = doc as { payload?: { content?: PmNode[] } } | undefined;
  // ⚠️⚠️ **不过滤块类型** —— 曾经这里是
  //   `.filter(b => b.type === 'heading' || b.type === 'paragraph')`,
  //   于是 mathBlock / codeBlock / 列表 / 引用 / callout **全被静默丢弃**。
  // ⭐ 真机日志铁证:用户把正文变成块级公式的那一刻 ——
  //   treeCommit 收到 `heading,heading,mathBlock,...` → 存盘 len 退回模板 628,
  //   **用户内容当场消失**。
  // ⭐ 渲染层 RENDERABLE_ATOM_TYPES 有 13 种块,投影只认 2 种 = 其余全丢;
  //   这正违反分区原则推论③「不认识的一律原样保留」(04 §0.6.3)。
  const raw = d?.payload?.content ?? [];

  // ⭐⭐ 节点 = 标题 + 它的正文(规格 03 §5.5,用户拍板:「要默认它作为一个整体」)。
  //
  // ⚠️ 旧版把 heading / paragraph **一视同仁**当树节点 → 标题下写一行正文就
  // 凭空多一个节点(真机现象:公式看着像从主题框溢出,其实它自己就是个框)。
  //
  // 归属规则:
  //   heading                  → 开新节点(首行)
  //   paragraph 带 indent >= 1 → 开新节点(h6 之后的层级)
  //   paragraph 无 indent      → ⭐ 并入上一个节点,当正文
  //
  // ⭐ 两条不冲突:noteFormForDepth 产出的层级段落**永远带 indent >= 1**
  //   (depth 6 → indent 1 …),从不产出无 indent 段落 —— 那个形态是空出来的。
  const groups: { head: PmNode; body: PmNode[]; defs: PmNode[] }[] = [];
  // ⭐ def 块与它「定义谁」的配对(甲=紧挨前面那个块;乙=attrs.for 定向)。
  //   ⚠️ 乙的目标可能**还没出现**(def 写在前、块在后),故先记录待解,全扫完再配。
  const pendingDefs: { def: PmNode; forId: string | null; groupIndex: number }[] = [];
  // ⚠️ 绑不上任何块的 def(for 指向不存在 / 文档以 def 开头)——
  //   ⭐ **不许丢**(方案丙:不删不改)。挂到第一个节点尾部原样吐回;
  //   ⚠️ 它的别名不入表,故引用它的关系行成为悬空 —— 那是**正确**的结果:
  //     绑不上块的定义,本来就没有「定义了谁」可言。
  const orphanDefs: PmNode[] = [];
  for (const b of raw) {
    // ⭐⭐ def 块**摘出正文**(00 §2.5 / 01 §7.7.3 正向第 2 条)——
    //   ⚠️ 不摘就会按 §5.5「无 indent 的块并入上一节点当正文」被并进去,
    //     画布主题框当场显示 `id: A` 这种鬼东西(探针实测过)。
    if (b.type === 'defBlock') {
      const forAttr = b.attrs?.for;
      pendingDefs.push({
        def: b,
        forId: typeof forAttr === 'string' && forAttr.length > 0 ? forAttr : null,
        groupIndex: groups.length - 1, // 甲:紧挨它前面那个块所在的组
      });
      continue;
    }
    const ind = b.attrs?.indent;
    // ⭐ 只有 heading、以及带 indent 的 paragraph(h6 之后的层级)开新节点;
    //   **其余一切块类型**(mathBlock/codeBlock/列表/…)都并入上一个节点当正文。
    const startsNode =
      b.type === 'heading' || (b.type === 'paragraph' && typeof ind === 'number' && ind >= 1);
    // ⚠️ 文档以无 indent 段落开头 → 没有「上一个节点」可并,自成节点,
    //    否则这段内容会凭空消失。
    if (startsNode || groups.length === 0) groups.push({ head: b, body: [], defs: [] });
    else groups[groups.length - 1].body.push(b);
  }
  const blocks = groups.map((g) => g.head);

  const stack: { level: number; id: NodeId }[] = [];
  const parents: (NodeId | null)[] = [];
  const ids: NodeId[] = [];

  blocks.forEach((b, i) => {
    const level = levelOf(b);
    const rawId = b.attrs?.id;
    // ⭐ 优先用 block 自带 id(稳定);没有才按序号造
    const id = typeof rawId === 'string' && rawId.length > 0 ? rawId : `b${i + 1}`;
    while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
    parents.push(stack.length > 0 ? stack[stack.length - 1].id : null);
    ids.push(id);
    stack.push({ level, id });
  });

  // order:同父兄弟按出现顺序
  const siblings = new Map<string, number[]>();
  parents.forEach((p, i) => {
    const k = p ?? '\0root';
    const arr = siblings.get(k);
    if (arr) arr.push(i);
    else siblings.set(k, [i]);
  });
  const orders: string[] = new Array(blocks.length);
  for (const group of siblings.values()) {
    group.forEach((idx, k) => {
      orders[idx] = rankAt(k);
    });
  }

  // ─────────────────────────────────────────────────────
  // ⭐ def 块归属 → 别名表 → 关系行(词表与含义归 mind,词法调 lexicon)
  // ─────────────────────────────────────────────────────

  // ⭐ 甲为主 + 乙可选(用户 2026-09-13 拍板):
  //   for=null    → 定义**紧挨它前面那个块**(位置约定)
  //   for=<blockId> → 定向绑定,不受位置影响(挪动不失联)
  // ⚠️ 绑不上的(for 指向不存在的块 / 文档以 def 开头没有上一个块)→ **不绑**,
  //   它声明的别名就不入表 → 引用它的关系行成为悬空(方案丙:不造边、原文照留)。
  const indexOfBlockId = new Map<string, number>();
  ids.forEach((id, i) => indexOfBlockId.set(id, i));
  for (const pd of pendingDefs) {
    let owner = -1;
    if (pd.forId !== null) {
      // 乙:定向绑定 —— ⚠️ 目标不存在就是不存在,不回落到「上一个块」
      //   (静默回落 = 把「写错了」变成「悄悄绑到别处」,比不绑更难查)
      owner = indexOfBlockId.get(pd.forId) ?? -1;
    } else {
      owner = pd.groupIndex; // 甲:紧挨它前面那个块
    }
    if (owner >= 0 && owner < groups.length) groups[owner].defs.push(pd.def);
    else orphanDefs.push(pd.def);
  }

  // ⭐ 别名表:`id: X` → NodeId。⚠️ 撞车**自动加序号**不报错拒绝(00 §2.5.4 方案丙)
  //   —— 一次手滑不该让整张图的连线全废。
  const aliasToNode = new Map<string, NodeId>();
  groups.forEach((g, i) => {
    for (const d of g.defs) {
      const alias = defValue(parseDefText(textOf(d)), 'id');
      if (!alias) continue;
      if (!aliasToNode.has(alias)) {
        aliasToNode.set(alias, ids[i]);
        continue;
      }
      // 撞车:A → A2 → A3 …(⚠️ 不塌成重复,否则关系行会指向错节点)
      for (let n = 2; n < 1000; n += 1) {
        const candidate = `${alias}${n}`;
        if (!aliasToNode.has(candidate)) {
          aliasToNode.set(candidate, ids[i]);
          break;
        }
      }
    }
  });

  // ⭐ 关系行 → SEdge。⚠️ **含义归 mind**:`-.->` 在 mind 是**联系线**(树之外的
  //   附加关系,不改父子);bpmn 里同样的记号是骨架本身 —— 词法共用,含义不共用
  //   (00 §2.5.5)。
  // ⭐ 确定性 id:重复连同一对 = **覆盖非新增**(债 3;用 Map 去重)。
  // ⚠️ 悬空引用(别名不在表里)→ **丢弃这条边,但原文照留在 def 块里**(方案丙)。
  const edgeMap = new Map<string, SEdge>();
  for (const g of groups) {
    for (const d of g.defs) {
      for (const rel of defRelations(parseDefText(textOf(d)))) {
        const source = aliasToNode.get(rel.source);
        const target = aliasToNode.get(rel.target);
        if (!source || !target) continue; // 悬空:不造边(原文在 def 块里原样保留)
        const id = deterministicEdgeId(source, target);
        edgeMap.set(id, { id, source, target, ...(rel.label ? { label: rel.label } : {}) });
      }
    }
  }
  const edges: SEdge[] = [...edgeMap.values()];

  let rootSeen = false;
  const nodes: SNode[] = blocks.map((b, i) => {
    const isTop = parents[i] === null;
    let role: SNode['role'] = 'branch';
    if (isTop) {
      if (!rootSeen) {
        role = 'root';
        rootSeen = true;
      } else {
        role = 'floating';
      }
    }
    // ⭐ `role:` **显式优先**,不写才落隐式规则(01 §7.7.7;向后兼容老文档)。
    // ⚠️ 这是**含义层**判断,归 mind:`role` 是什么词、认哪几个值,note 不管。
    // ⚠️ rootSeen 已在上面按隐式规则推进过 —— 显式声明只改**本节点**的 role,
    //   不回溯改别人(否则「第二个顶层显式写 root」会把第一个挤成 floating,
    //   用户没让它动的东西不该动)。
    for (const d of groups[i].defs) {
      const explicit = defValue(parseDefText(textOf(d)), 'role');
      if (explicit === 'root' || explicit === 'branch' || explicit === 'floating') {
        role = explicit;
      }
    }
    // ⭐ 富内容原样保住:有 inline 就包回信封,不经纯文本拍平
    // ⭐⭐ content 现在可装**多块**:首块 = 标题本身,其后 = 并进来的正文。
    //    ⚠️ inlineOf / contentToText 只取首块 —— 那仍然正确(标签 = 首行)。
    // ⭐⭐ **保留原块类型**(不再一律拍成 paragraph):
    //   mathBlock 拍成 paragraph = 公式降级成纯文本,用户的东西照样毁。
    const bodyBlocks = groups[i].body.map((x) => ({
      type: x.type,
      ...(x.content?.length ? { content: x.content } : {}),
      ...(x.attrs ? { attrs: { ...x.attrs } } : {}),
    })) as PmNode[];
    // ⭐⭐ 首块**保留 heading/level**(用户:「paragraph 应该是正文文字大小」)。
    //
    // ⚠️ 渲染层(textBlock.ts)**本来就按块给字号**:
    //   `fontSize = headingFontSize(atom.attrs.level) × (base/16)`,
    //   paragraph 没有 level → 正文号。所以只要把 level 带上,标题大、正文小
    //   就自动成立 —— **不需要我另算一套字号**。
    // ⚠️ 之前把首块拍成裸 paragraph,level 丢了 → 渲染层无从区分,
    //   整框被节点级 text_size 拉成一样大(真机现象:正文和标题一样大)。
    const headBlock: PmNode = {
      // ⭐ 首块保留自己的类型(heading 保 heading;文档以 mathBlock 开头就保 mathBlock)
      type: b.type,
      ...(b.attrs?.level !== undefined ? { attrs: { level: b.attrs.level } } : {}),
      content: (b.content?.length ?? 0) > 0 ? b.content : [{ type: 'text', text: textOf(b) }],
    };
    const content: RichContent = {
      format: 'pm-doc-json',
      version: '0.1',
      payload: { type: 'doc', content: [headBlock, ...bodyBlocks] },
    };
    // ⭐ def 块**原样保管**在 defs 格,不进 content(否则画布主题框显示 `id: A`)。
    // ⚠️ 孤儿 def(绑不上任何块)挂到第一个节点尾部 —— 只为**不丢**,
    //   它的别名不入表,不参与任何语义。
    const defBlocks: PmNode[] = [
      ...groups[i].defs,
      ...(i === 0 ? orphanDefs : []),
    ].map((x) => ({
      type: x.type,
      ...(x.attrs ? { attrs: { ...x.attrs } } : {}),
      ...(x.content?.length ? { content: x.content } : {}),
    }));
    return {
      id: ids[i],
      content,
      parent: parents[i],
      order: orders[i],
      role,
      ...(defBlocks.length > 0 ? { defs: defBlocks } : {}),
    };
  });

  return { nodes, edges, spans: [] };
}



export { contentToText };

/**
 * ⭐ 取 root 节点的文本 —— **它就是文档标题**(01 §3.4「标题即 root」)。
 *
 * ⚠️ 规格三处都写了这条(§3.1 role、§3.4 title、§5 投影表),
 * 但实现里 `mind_doc.title` 与 root 节点是**两份数据** —— 改一个另一个不动。
 * 本函数是收口点:保存时用它把 title 同步成 root 的文字,**不再各存各的**。
 */
export function rootTitleOf(s: SLayer): string | null {
  const root = s.nodes.find((n) => n.role === 'root');
  if (!root) return null;
  const t = contentToText(root.content).trim();
  return t.length > 0 ? t : null;
}
