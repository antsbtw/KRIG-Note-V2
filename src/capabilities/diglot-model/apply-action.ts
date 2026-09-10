/**
 * diglot-model — 双向同步:动作落笔(步骤⑤)
 *
 * ⭐⭐ **这是内核**:「语义描述」⇄「图形描述」双向一致的落点。
 * 与 mermaid 的差别就在这里 —— mermaid 只能文本→图,这里**图→文本也成立**。
 *
 * ⭐ **分流规则**(00 §3,两个图种通用):
 * | 操作类 | 落哪 |
 * |---|---|
 * | 结构操作(新建、连线、删除、改名、改层级) | **S 面** |
 * | 布局与样式操作(拖动、改色、折叠) | **G 面** |
 *
 * ⚠️⚠️ **落笔矩阵是硬承诺,不是"大概不动"**(01 §6):
 * 「零」意味着那一面**一个字节都不许变**。测试比对前后快照,串了就红。
 *
 * ⭐ **稀疏纪律贯穿全文件**:
 * 只有被触碰过的元素才有 G 条目;`graphic.deletePos` 删空后**整条移除**,
 * 不留空壳(否则 C5「新建节点 G 层零条目」与 C7「删条目回自动」都会被架空)。
 */

import type { DiglotAction, DiglotSnapshot } from './engine-contract';
import { deterministicEdgeId } from './edge-id';
import { textToContent } from './mermaid-mindmap';
import type { GEntry, GLayer, NodeId, SEdge, SLayer, SNode } from './types';

// ─────────────────────────────────────────────────────────
// 1. 不可变小工具 —— ⚠️ 一律返回新对象,绝不就地改
// ─────────────────────────────────────────────────────────

/**
 * ⚠️ 就地改会让「比对前后快照」失效(前后是同一个对象,永远相等) ——
 * 那正是 HANDOFF §5 说的自证形态:测试看起来在验,其实什么都没验。
 */
function withNode(s: SLayer, id: NodeId, patch: Partial<SNode>): SLayer {
  let hit = false;
  const nodes = s.nodes.map((n) => {
    if (n.id !== id) return n;
    hit = true;
    return { ...n, ...patch };
  });
  // ⚠️ fail loud:改一个不存在的节点是调用侧的 bug,不许静默无视
  if (!hit) throw new Error(`[diglot] applyAction:节点不存在 id=${id}`);
  return { ...s, nodes };
}

/** 写一条 G 条目(合并),返回新 Map。 */
function setG(g: GLayer, id: string, patch: Partial<GEntry>): GLayer {
  const next = new Map(g);
  next.set(id, { ...(next.get(id) ?? {}), ...patch });
  return next;
}

/**
 * 删 G 条目里的某个字段。
 * ⭐ 删空后**整条移除** —— 稀疏纪律:没有被触碰的属性就不该有条目(C7)。
 */
function unsetG(g: GLayer, id: string, key: keyof GEntry): GLayer {
  const cur = g.get(id);
  if (!cur) return g;
  const rest: Record<string, unknown> = { ...cur };
  delete rest[key as string];
  const next = new Map(g);
  if (Object.keys(rest).length === 0) next.delete(id);
  else next.set(id, rest as GEntry);
  return next;
}

/** 坐标量化为整数(00 §4 杜绝浮点噪声)。⭐ 写入这一关就挡住,不让浮点进模型。 */
function quantize(x: number, y: number): { x: number; y: number } {
  return { x: Math.round(x), y: Math.round(y) };
}

// ─────────────────────────────────────────────────────────
// 2. order:在同父兄弟中取位
// ─────────────────────────────────────────────────────────

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * 取同父兄弟的末位之后的 order。
 *
 * ⚠️ 与 `mermaid-mindmap.ts` 的 `siblingRanks` 同为**定宽 base-62**,
 * 保证两处产出的串可直接字典序比较(混用不会错位)。
 * 落库时写 `attrs.order` 的仍是 note 既有 lexrank(03 §3.2),职责不同。
 */
function orderAfterLast(s: SLayer, parent: NodeId | null): string {
  const sibs = s.nodes.filter((n) => n.parent === parent);
  let max = 0;
  for (const n of sibs) {
    let v = 0;
    for (const ch of n.order) v = v * 62 + Math.max(0, DIGITS.indexOf(ch));
    if (v > max) max = v;
  }
  let v = max + 1;
  let out = '';
  for (let d = 0; d < 4; d++) {
    out = DIGITS[v % 62] + out;
    v = Math.floor(v / 62);
  }
  return out;
}

/**
 * ⭐ 取「插到某个兄弟之前」的 order —— v0.2 裸拖改序要用。
 *
 * ⚠️ 之前只实现了 `orderAfterLast`(追加末位),`beforeSibling` 是契约里有、
 * 实现没做的债。裸拖改成「改父/改序」后它上了主路径,必须补。
 *
 * 取法:目标兄弟的 order 与其**前一个**兄弟的 order 之间取中点。
 * ⚠️ 定宽 base-62 串在中点取不出新值时(相邻已无空隙),**退化为在末尾追加一位**
 * —— 与 lexrank 同样的思路,字符串变长但永不撞、永不退化。
 */
function orderBefore(s: SLayer, parent: NodeId | null, beforeId: NodeId): string {
  const sibs = s.nodes
    .filter((n) => n.parent === parent)
    .sort((a, b) => a.order.localeCompare(b.order));
  const idx = sibs.findIndex((n) => n.id === beforeId);
  if (idx < 0) return orderAfterLast(s, parent);
  const hi = sibs[idx].order;
  const lo = idx > 0 ? sibs[idx - 1].order : null;
  return orderBetween(lo, hi);
}

/** 两个 order 之间取一个新 order(定宽 base-62 中点法,退化时追加一位)。 */
function orderBetween(lo: string | null, hi: string): string {
  const val = (str: string): number => {
    let v = 0;
    for (const ch of str) v = v * 62 + Math.max(0, DIGITS.indexOf(ch));
    return v;
  };
  const enc = (v: number): string => {
    let out = '';
    let x = v;
    for (let d = 0; d < 4; d++) {
      out = DIGITS[x % 62] + out;
      x = Math.floor(x / 62);
    }
    return out;
  };
  const hiV = val(hi.slice(0, 4));
  const loV = lo ? val(lo.slice(0, 4)) : 0;
  if (hiV - loV >= 2) return enc(Math.floor((loV + hiV) / 2));
  // ⚠️ 无空隙:在下界串后追加一位中点数字(字符串加长,但永不撞)
  const base = lo ?? enc(0);
  return base + DIGITS[Math.floor(62 / 2)];
}

/** 新节点 id:确定性递增,不撞既有 id。 */
function freshNodeId(s: SLayer): NodeId {
  let i = s.nodes.length + 1;
  const used = new Set(s.nodes.map((n) => n.id));
  let id = `n${String(i).padStart(3, '0')}`;
  while (used.has(id)) {
    i += 1;
    id = `n${String(i).padStart(3, '0')}`;
  }
  return id;
}

// ─────────────────────────────────────────────────────────
// 3. ⭐⭐ 落笔
// ─────────────────────────────────────────────────────────

/**
 * ⭐ 唯一的状态迁移入口。
 *
 * ⚠️ **每个分支只碰它该碰的那一面** —— 落笔矩阵(01 §6)是验收标准:
 * - `canvas.dragNode` → **只动 G**(C4:S 层零变更)
 * - `canvas.dragReparent` → **只动 S**(M2:不许顺手钉坐标)
 * - `canvas.createNode` → **只动 S**(C5:G 层零条目,缺省即自动)
 * - `semantic.slashShape` → **只动 G**(C8:S 层零残留,手势消解)
 *
 * ⭐ **M3 天然成立**:所有改结构的分支都只改 `parent`/`order`,
 * **绝不删旧建新** —— id 不变,G 层按 id 配对,pos 当然存活。
 */
export function applyAction(snapshot: DiglotSnapshot, action: DiglotAction): DiglotSnapshot {
  const { s, g } = snapshot;

  switch (action.kind) {
    // ── 语义面:只动 S ──────────────────────────────────
    case 'semantic.editLabel': {
      // ⚠️ 只换 content,不碰 parent/order/role,更不碰 G(C3)
      return { s: withNode(s, action.id, { content: textToContent(action.text) }), g };
    }

    case 'semantic.editLabelDoc': {
      // ⭐ 富文本原样写回 —— 不经 textToContent 拍平,保住公式/格式/图片
      // ⚠️ 只换 content,不碰 parent/order/role,更不碰 G(C3)
      return {
        s: withNode(s, action.id, { content: action.doc as SNode['content'] }),
        g,
      };
    }

    case 'semantic.moveIndent': {
      // ⭐ 改层级 = 改一条 parent 引用;后代无需重编号(01 §4)
      // ⭐ G 层零变更 —— 布局属性存活(M3)
      const order = action.beforeSibling
        ? orderBefore(s, action.newParent, action.beforeSibling)
        : orderAfterLast(s, action.newParent);
      return {
        s: withNode(s, action.id, { parent: action.newParent, order }),
        g,
      };
    }

    // ── 语义面手势:消解为 G 条目,S 零残留(C8) ──────────
    case 'semantic.slashShape': {
      // ⭐ 语义面百分之百为语义服务:斜杠词落定后转成 G 属性,
      //   **语义面本身不留属性 token**(00 §3)
      return { s, g: setG(g, action.id, { shape: action.shape }) };
    }

    // ── 画布拖动三义(01 §7.2)—— ⚠️ 三者互斥,不许串 ──────
    case 'canvas.dragNode': {
      // 落点①空白处 = 钉住坐标(父子不变)。⭐ pos 存在即 pinned
      return { s, g: setG(g, action.id, { pos: quantize(action.x, action.y) }) };
    }

    case 'canvas.dragReparent': {
      // ⭐ v0.2:裸拖走这里(改父/改序),不再钉坐标
      // ⚠️⚠️ **绝不顺手写 pos** —— 串了就是 M2 失败,且会把用户的自动布局意图钉死
      const order = action.beforeSibling
        ? orderBefore(s, action.newParent, action.beforeSibling)
        : orderAfterLast(s, action.newParent);
      return { s: withNode(s, action.id, { parent: action.newParent, order }), g };
    }

    case 'canvas.dragToFloat': {
      // 落点③Shift+空白 = 转自由主题:S(role→floating,父为 Document)+ G(pos)
      // ⚠️ 这是三义中**唯一**同时落两面的,依据 01 §7.2 表格
      return {
        s: withNode(s, action.id, { role: 'floating', parent: null }),
        g: setG(g, action.id, { pos: quantize(action.x, action.y), float: true }),
      };
    }

    // ── 画布结构操作:只动 S ────────────────────────────
    case 'canvas.createNode': {
      // ⭐⭐ C5 缺省即自动:S 层恰好一处插入,**G 层零条目**
      //    新节点的位置由自动布局算,不写 pos —— 这正是「稀疏覆盖」的起点
      const id = freshNodeId(s);
      const node: SNode = {
        id,
        content: textToContent(action.text),
        parent: action.parent,
        order: orderAfterLast(s, action.parent),
        role: 'branch',
      };
      return { s: { ...s, nodes: [...s.nodes, node] }, g };
    }

    case 'canvas.insertSibling': {
      // ⭐ Enter:同父,排在 afterId 之后
      const anchor = s.nodes.find((n) => n.id === action.afterId);
      if (!anchor) throw new Error(`[diglot] insertSibling:锚点不存在 ${action.afterId}`);
      // ⚠️ root 没有兄弟位(它是文档标题)——退化为给它加子节点,而不是静默失败
      const parent = anchor.role === 'root' ? anchor.id : anchor.parent;
      const sibs = s.nodes
        .filter((n) => n.parent === parent)
        .sort((a, b) => a.order.localeCompare(b.order));
      const idx = sibs.findIndex((n) => n.id === action.afterId);
      const next = idx >= 0 ? sibs[idx + 1] : undefined;
      const id = freshNodeId(s);
      const node: SNode = {
        id,
        content: textToContent(action.text),
        parent,
        order: next ? orderBefore(s, parent, next.id) : orderAfterLast(s, parent),
        role: 'branch',
      };
      // ⭐ C5:新节点 G 层零条目(位置由自动布局算)
      return { s: { ...s, nodes: [...s.nodes, node] }, g };
    }

    case 'canvas.insertChild': {
      // ⭐ Tab:成为选中节点的最后一个孩子
      const id = freshNodeId(s);
      const node: SNode = {
        id,
        content: textToContent(action.text),
        parent: action.parentId,
        order: orderAfterLast(s, action.parentId),
        role: 'branch',
      };
      return { s: { ...s, nodes: [...s.nodes, node] }, g };
    }

    case 'canvas.deleteSubtree': {
      // 收集自己 + 全部后代
      const doomed = new Set<NodeId>([action.id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const n of s.nodes) {
          if (n.parent && doomed.has(n.parent) && !doomed.has(n.id)) {
            doomed.add(n.id);
            grew = true;
          }
        }
      }
      // ⚠️ root 不可删(它是文档标题)—— fail loud,别让用户以为删了
      const target = s.nodes.find((n) => n.id === action.id);
      if (target?.role === 'root') {
        throw new Error('[diglot] 不能删除 root(它是文档标题;改标题请编辑它的文字)');
      }
      // ⭐ 连带清理:G 条目 + 悬空 Edge/Span(01 §7.1 明写)
      const nextG = new Map(g);
      for (const id of doomed) nextG.delete(id);
      return {
        s: {
          nodes: s.nodes.filter((n) => !doomed.has(n.id)),
          edges: s.edges.filter((e) => !doomed.has(e.source) && !doomed.has(e.target)),
          spans: s.spans.filter(
            (p) => !doomed.has(p.from) && !doomed.has(p.to) && !(p.topic && doomed.has(p.topic)),
          ),
        },
        g: nextG,
      };
    }

    case 'canvas.connect': {
      // ⭐ 联系线是**树之外的附加关系**(01 §3.2),也是唯一真用边的地方。
      // ⚠️ id 走确定性导出 —— 重复连同一对端点 = 覆盖而非新增(债 3)
      const id = deterministicEdgeId(action.source, action.target);
      const edge: SEdge = {
        id,
        source: action.source,
        target: action.target,
        ...(action.label === undefined ? {} : { label: action.label }),
      };
      const existing = s.edges.findIndex((e) => e.id === id);
      const edges =
        existing >= 0
          ? s.edges.map((e, i) => (i === existing ? edge : e))
          : [...s.edges, edge];
      return { s: { ...s, edges }, g };
    }

    // ── 图形面:只动 G ──────────────────────────────────
    case 'graphic.editColor': {
      return { s, g: setG(g, action.id, { color: action.color }) };
    }

    case 'graphic.toggleCollapsed': {
      const cur = g.get(action.id)?.collapsed === true;
      // ⭐ 展开 = 删掉该字段(稀疏纪律:false 是缺省,不写缺省值)
      //   条目删空则整条移除,与 deletePos 同款处理。
      return { s, g: cur ? unsetG(g, action.id, 'collapsed') : setG(g, action.id, { collapsed: true }) };
    }

    case 'graphic.releaseAllPos': {
      // ⭐ 整图回自动布局。⚠️ **只删 pos**,不碰 color/shape/collapsed ——
      //    那些是用户另外表达的意图,不该被「恢复布局」顺手抹掉。
      const next = new Map<string, GEntry>();
      for (const [id, e] of g) {
        const rest: Record<string, unknown> = { ...e };
        delete rest.pos;
        delete rest.float; // float 的位置意义随 pos 一起释放
        // 稀疏纪律:删空的条目整条移除,不留空壳
        if (Object.keys(rest).length > 0) next.set(id, rest as GEntry);
      }
      return { s, g: next };
    }

    case 'graphic.deletePos': {
      // ⭐⭐ C7 释放语义:删条目 → 该元素**回自动布局**,其余一切不变
      //    删空后整条移除(不留空壳),这就是「删除条目即释放回自动」
      return { s, g: unsetG(g, action.id, 'pos') };
    }
  }
}


/**
 * ⭐ 数一数有多少节点被钉住(G 层有 pos)。
 *
 * UI 用它决定「恢复自动布局」按钮是否可用 —— 一个都没钉住时按钮该是灰的,
 * 否则用户点了没反应会以为坏了(⚠️ 有开关没接线是最劝退的形态)。
 */
export function pinnedCount(snapshot: DiglotSnapshot): number {
  let n = 0;
  for (const e of snapshot.g.values()) if (e.pos) n += 1;
  return n;
}


/** 某节点是否折叠(读 G 层 `collapsed`)。⭐ 与画布裁剪、note 三角共用同一真源。 */
export function isCollapsed(snapshot: DiglotSnapshot, id: NodeId): boolean {
  return snapshot.g.get(id)?.collapsed === true;
}
