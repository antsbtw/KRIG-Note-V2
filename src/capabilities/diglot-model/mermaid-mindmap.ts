/**
 * diglot-model — mermaid `mindmap` 解析 / 序列化(步骤③)
 *
 * ⭐ 起步策略(00 §2,用户拍板):先兼容 mermaid 语法,拿社区图例当检验素材,
 * round-trip 是硬判据(导入→拖动→导出→再导入,图必须一致)。
 *
 * ⚠️ **语法依据来自实测 `node_modules/mermaid`,不是脑补**
 * (`mermaid ^11.15.0`,`dist/chunks/mermaid.esm/mindmap-definition-*.mjs`):
 *
 * - `MindmapDB.getParent(level)`:**倒序找最近一个 level 更小的节点** ——
 *   与本项目 `01-mind-spec.md` §4 规则 1 **完全一致**,故树推导直接对齐官方。
 * - `MindmapDB.getType(startStr,endStr)` 的分隔符映射(逐字抄自实现):
 *   `[`→RECT `(`+`)`→ROUNDED_RECT `(`+其它→CLOUD `((`→CIRCLE
 *   `)`→CLOUD `))`→BANG `{{`→HEXAGON
 * - 文法规则 27 是 `id[descr]` 形态:**分隔符前是 id,括号内是显示文本**;
 *   规则 25 无 id 时 id=descr。
 *
 * ⚠️⚠️ **一处刻意与 mermaid 不同(不是 bug)**:
 * mermaid 的 `addNode` 在找不到父且非首节点时 **throw**
 * (`There can be only one root`)。本项目 `01 §4` 规则 2/4 要求
 * **级别跳跃宽容解释、多个顶层节点合法(自由主题)**,故此处**不报错**,
 * 按就近父级归属;真正的顶层节点(除 root 外)role 记为 `floating`。
 * ⭐ 这是「不要为了塞进 mermaid 语法而扭曲模型」(00 §2.3)的具体落实。
 */

import type { ParseResult, DiglotError } from './engine-contract';
import type { NodeId, RichContent, SLayer, SNode } from './types';

// ─────────────────────────────────────────────────────────
// 1. 词法:一行 → { indent, id, label, shape }
// ─────────────────────────────────────────────────────────

/** mermaid 七种节点形状(实测自 `MindmapDB.nodeType`)。 */
export type MermaidShape =
  | 'default'
  | 'rect'
  | 'rounded-rect'
  | 'circle'
  | 'cloud'
  | 'bang'
  | 'hexagon';

/**
 * 分隔符 → 形状(逐字对齐 `getType`)。
 * ⚠️ **必须先试双字符**,否则 `((` 会被 `(` 抢先匹配成 ROUNDED_RECT/CLOUD。
 */
const DELIMS: readonly { open: string; close: string; shape: MermaidShape }[] = [
  { open: '((', close: '))', shape: 'circle' },
  { open: '))', close: '((', shape: 'bang' },
  { open: '{{', close: '}}', shape: 'hexagon' },
  { open: '(', close: ')', shape: 'rounded-rect' },
  { open: '[', close: ']', shape: 'rect' },
];

interface RawLine {
  readonly indent: number;
  readonly id: string | null;
  readonly label: string;
  readonly shape: MermaidShape;
  readonly lineNo: number;
}

/** 展开 tab 为空格,使 indent 可比较(mermaid 自身按字符数算缩进)。 */
function indentOf(raw: string): number {
  let n = 0;
  for (const ch of raw) {
    if (ch === ' ') n += 1;
    else if (ch === '\t') n += 4;
    else break;
  }
  return n;
}

/**
 * 解析一行的节点体。
 *
 * 形态(对齐文法规则 25/26/27):
 * - `文本`            → id=null, label=文本, shape=default
 * - `((文本))`        → id=null, label=文本, shape=circle
 * - `myid((文本))`    → id=myid, label=文本, shape=circle
 */
function parseNodeBody(body: string): { id: string | null; label: string; shape: MermaidShape } {
  for (const d of DELIMS) {
    const open = body.indexOf(d.open);
    if (open >= 0 && body.endsWith(d.close)) {
      const inner = body.slice(open + d.open.length, body.length - d.close.length);
      const idPart = body.slice(0, open).trim();
      return { id: idPart.length > 0 ? idPart : null, label: inner.trim(), shape: d.shape };
    }
  }
  return { id: null, label: body.trim(), shape: 'default' };
}

// ─────────────────────────────────────────────────────────
// 2. 内容信封 —— 与 note block 同一形态(03 §4 实测)
// ─────────────────────────────────────────────────────────

/**
 * 纯文本 → `DriverSerialized` 信封。
 * ⭐ 与 `text-editing.Host` 吃的是同一种 doc(canvas-text-node 复用同一 Host),
 * 故富文本 / 公式 / 图片将来天然可承载。
 */
export function textToContent(text: string): RichContent {
  return {
    format: 'pm-doc-json',
    payload: {
      type: 'doc',
      content: [
        text.length > 0
          ? { type: 'paragraph', content: [{ type: 'text', text }] }
          : { type: 'paragraph' },
      ],
    },
  };
}

/** 从信封取回首段纯文本(节点标签)。⚠️ 取不到时 fail loud,不静默返回空串。 */
export function contentToText(c: RichContent): string {
  const payload = c.payload as
    | { content?: { content?: { text?: string }[] }[] }
    | undefined;
  const first = payload?.content?.[0];
  if (!first) throw new Error('[diglot] content 信封缺少首段,无法取标签');
  const runs = first.content;
  if (!runs || runs.length === 0) return '';
  return runs.map((r) => r.text ?? '').join('');
}

// ─────────────────────────────────────────────────────────
// 3. 兄弟次序(order)
// ─────────────────────────────────────────────────────────

/**
 * ⚠️ **为什么不直接 import `@platform/main/note/lexrank`**:
 *
 * 那会让 **capability 层反向依赖 platform/main**,全仓**零先例**
 * (grep `@platform/main` 在 `src/capabilities/**` 的 .ts 里一处都没有,
 * 只有两处 README/DESIGN 提到「main 进程同模块直调」)。
 * 依据模块边界治理:capability 要能独立构建/部署,不该把 main 侧拖进来。
 *
 * ⭐ 且**本模块并不需要 lexrank 的核心能力**(O(1) 中插不动其它块)——
 * 解析是**一次性全量建树**,只要求同父兄弟间**单调递增且字典序可比**。
 *
 * 落库时真正写进 `attrs.order` 的仍是 note 既有的 lexrank
 * (由 dissect/updateNote 路径分配,见 03 §3.2)——
 * **两处不是同一个职责**:此处是解析产物的相对次序,那里是持久化排位键。
 * 接线时若发现需要统一,再把 lexrank 提到中立层(记账,不在本步做)。
 */
function siblingRanks(n: number): string[] {
  // base-62 定宽串:字典序 === 数值序(与 lexrank 的 DIGITS 顺序一致)
  const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    // ⚠️ 定宽 4 位:字典序比较不会因长度不同而错位('10' < '9' 那类坑)
    let v = i + 1;
    let sfx = '';
    for (let d = 0; d < 4; d++) {
      sfx = DIGITS[v % 62] + sfx;
      v = Math.floor(v / 62);
    }
    out.push(sfx);
  }
  return out;
}

// ─────────────────────────────────────────────────────────
// 4. 解析:mermaid 文本 → S 层树
// ─────────────────────────────────────────────────────────

/** 节点 id 生成:未显式命名时按序号分配,**确定性**(同一输入必得同一组 id)。 */
function autoId(index: number): NodeId {
  return `m${String(index + 1).padStart(3, '0')}`;
}

/**
 * ⭐ mermaid `mindmap` → S 层。
 *
 * 树推导严格按 `01 §4`:
 * 1. `parent(n)` = 序列中 n 之前、**级别小于 n 的最近节点**;不存在则为顶层
 * 2. ⭐ 级别跳跃**宽容解释**:h1 下直接出现 h3,按规则 1 归就近父级,**不报错**
 * 3. `order` = 同父兄弟间序列先后(lexrank 字典序串,复用 note 既有实现)
 * 4. 顶层节点中,**首个**为 root;其余为 `floating`(自由主题)
 * 5. 推导是**确定的纯函数**:同一序列必得同一棵树(M1)
 */
export function parseMermaidMindmap(text: string): ParseResult<SLayer> {
  const errors: DiglotError[] = [];
  const rawLines = text.split('\n');

  // ── 找 `mindmap` 头 ──
  let start = -1;
  for (let i = 0; i < rawLines.length; i++) {
    const t = rawLines[i].trim();
    if (t.length === 0) continue;
    if (t === 'mindmap' || t.startsWith('mindmap ')) {
      start = i;
      break;
    }
    // ⚠️ fail loud:第一个非空行不是 mindmap → 不是本图种,不猜、不兜底
    errors.push({ line: i + 1, message: `mindmap 图必须以 "mindmap" 开头,读到:${t}` });
    return { ok: false, errors };
  }
  if (start < 0) {
    return { ok: false, errors: [{ line: 1, message: '空输入:未找到 "mindmap" 头' }] };
  }

  // ── 逐行取节点 ──
  const lines: RawLine[] = [];
  for (let i = start + 1; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const body = raw.trim();
    if (body.length === 0) continue;
    // v0 不支持的装饰(icon/class)先原样当文本,不报错、不丢
    const { id, label, shape } = parseNodeBody(body);
    if (label.length === 0 && id === null) {
      errors.push({ line: i + 1, message: '空节点' });
      continue;
    }
    lines.push({ indent: indentOf(raw), id, label, shape, lineNo: i + 1 });
  }

  if (errors.length > 0) return { ok: false, errors };
  if (lines.length === 0) {
    return { ok: false, errors: [{ line: start + 1, message: 'mindmap 没有任何节点' }] };
  }

  // ── 树推导 ──
  // 栈保存 { indent, id },规则 1 = 弹到栈顶 indent < 当前 indent
  const stack: { indent: number; id: NodeId }[] = [];
  const parents: (NodeId | null)[] = [];
  const ids: NodeId[] = [];

  lines.forEach((l, idx) => {
    const id = l.id ?? autoId(idx);
    while (stack.length > 0 && stack[stack.length - 1].indent >= l.indent) stack.pop();
    parents.push(stack.length > 0 ? stack[stack.length - 1].id : null);
    ids.push(id);
    stack.push({ indent: l.indent, id });
  });

  // ── order:同父兄弟按出现顺序分配 lexrank ──
  const siblings = new Map<string, number[]>();
  parents.forEach((p, i) => {
    const key = p ?? ' root';
    const arr = siblings.get(key);
    if (arr) arr.push(i);
    else siblings.set(key, [i]);
  });
  const orders: string[] = new Array(lines.length);
  for (const group of siblings.values()) {
    const ranks = siblingRanks(group.length);
    group.forEach((lineIdx, k) => {
      orders[lineIdx] = ranks[k];
    });
  }

  // ── 组装 SNode ──
  // ⭐ 顶层节点中首个是 root,其余是 floating(自由主题)——
  //   mermaid 遇此会 throw,我们按 01 §4 规则 4 宽容处理。
  let rootSeen = false;
  const nodes: SNode[] = lines.map((l, i) => {
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
    return {
      id: ids[i],
      content: textToContent(l.label),
      parent: parents[i],
      order: orders[i],
      role,
    };
  });

  return { ok: true, value: { nodes, edges: [], spans: [] } };
}

// ─────────────────────────────────────────────────────────
// 5. 序列化:S 层 → mermaid 文本(C9 round-trip 回程)
// ─────────────────────────────────────────────────────────

/** 形状 → 分隔符对(root 默认圆形,对齐 mermaid 惯例 `root((主题))`)。 */
function wrap(label: string, shape: MermaidShape): string {
  switch (shape) {
    case 'circle':
      return `((${label}))`;
    case 'bang':
      return `))${label}((`;
    case 'hexagon':
      return `{{${label}}}`;
    case 'rounded-rect':
      return `(${label})`;
    case 'rect':
      return `[${label}]`;
    default:
      return label;
  }
}

/**
 * S 层 → mermaid `mindmap` 文本。
 *
 * ⚠️ **不承诺字节级还原用户原文** —— S 层不存缩进宽度/分隔符风格这些书写表面。
 * C9 验的是「**再解析回来图一致**」,不是字符串相等。
 * ⭐ 真正要保用户书写原貌的是 KRIG 投影(note block),不是这条导出路径。
 */
export function toMermaidMindmap(s: SLayer): string {
  const byParent = new Map<string, SNode[]>();
  for (const n of s.nodes) {
    const key = n.parent ?? ' root';
    const arr = byParent.get(key);
    if (arr) arr.push(n);
    else byParent.set(key, [n]);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.order.localeCompare(b.order));

  const out: string[] = ['mindmap'];
  const emit = (n: SNode, depth: number): void => {
    const label = contentToText(n.content);
    // root 用 mermaid 惯例的 `root((...))`;其余节点 v0 不带形状(形状归 G 层)
    const body = n.role === 'root' ? `root${wrap(label, 'circle')}` : label;
    out.push('  '.repeat(depth + 1) + body);
    for (const c of byParent.get(n.id) ?? []) emit(c, depth + 1);
  };
  for (const top of byParent.get(' root') ?? []) emit(top, 0);
  return out.join('\n');
}
