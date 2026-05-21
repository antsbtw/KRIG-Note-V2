/**
 * assemble-pm-doc — L7 block atomization Stage 2 Step 2.1
 *
 * 从 storage 内拆散的 block atom + 边集合,拼装回完整 PM doc。
 *
 * 实施依据:
 * - decision 026 §3 颗粒度边界(叶子 + 叶子级容器拆 atom;结构性容器不拆)
 * - decision 026 §6 嵌套与边集(belongsToNote / nextSibling / childOf)
 * - decision 026 §6.1 跨层 wrapper 重建(tableCell.childOf → table atom,
 *   跳过 tableRow;listItem 在 bulletList 内,childOf 跳过 bulletList → note)
 * - decision 026 §8.1 读时拼装
 * - decision 026 §13.8 STRUCTURAL_REBUILD_RULES 集中化提示
 *
 * 入参契约:
 * - containerId = note container atom id(可以有 hasNoteView 边 = 笔记,也可以无 = reading-thought,详 D-10)
 * - 假设 storage 已是拆 atom 形态(decision 026 §3 字面);
 *   旧整篇 1 atom 数据**不兼容**(Stage 6 migration 前清数据,详 D-11)
 *
 * 输出:完整 PmPayload(type='doc',content 含所有 top-level block,
 * 容器型 block 已通过 childOf 边展开 + 中间 wrapper 重建)。
 */

import { storage } from '@storage/index';
import type {
  AtomEntity,
  EdgeEntity,
  PmPayload,
} from '@semantic/types';

const BELONGS_TO_NOTE_PREDICATE = 'user:krig:belongsToNote';
const NEXT_SIBLING_PREDICATE = 'user:krig:nextSibling';
const CHILD_OF_PREDICATE = 'user:krig:childOf';

/**
 * 结构性容器重建规则(decision 026 §3.1.2 / §6.1)。
 *
 * 当 capability 层拼装时,需在拆 atom 父→子之间**重新插入**中间 wrapper,
 * 让输出的 PM doc 字面满足 schema 父→中间→子的嵌套约束。
 *
 * 字面规则:
 * - childType 是拆 atom 的子 block 节点类型
 * - wrapperBuilder 接受同质子集合(全是 childType)+ 上下文,返回中间 wrapper PM 节点
 *
 * ⚠ 同步提示(decision 026 §13.8):未来引入新结构性容器(如 grid / flexbox),
 * 必须在本表登记 wrapper 重建规则,并字面登记到 decision 026 §13.8 增补条目。
 */
type AssemblyHints = {
  /** listItem 用 — 区分 bulletList vs orderedList(taskItem 字面是另一 NodeSpec,无此歧义)*/
  listType?: 'bullet' | 'ordered';
};

/** payload 顶层非 PM schema 字段的辅助提示(dissect 写入 / assemble 读取后剥除)*/
interface BlockAtomPayload extends PmPayload {
  _assemblyHints?: AssemblyHints;
}

/**
 * 把同质子节点集合包成中间 wrapper(bulletList / orderedList / taskList / table tr / columnList)。
 * 输入字面假设 children 字面已按 nextSibling 链排好序。
 */
function wrapChildren(children: PmPayload[]): PmPayload[] {
  if (children.length === 0) return [];

  const result: PmPayload[] = [];
  let i = 0;

  while (i < children.length) {
    const child = children[i];
    const type = child.type;

    // listItem 连续段 → 按 _assemblyHints.listType 包 bulletList / orderedList
    if (type === 'listItem') {
      const group: PmPayload[] = [];
      let listType: 'bullet' | 'ordered' = 'bullet';
      while (i < children.length && children[i].type === 'listItem') {
        const hint = (children[i] as BlockAtomPayload)._assemblyHints?.listType;
        if (hint === 'ordered') listType = 'ordered';
        group.push(stripAssemblyHints(children[i]));
        i++;
      }
      const wrapType = listType === 'ordered' ? 'orderedList' : 'bulletList';
      result.push({ type: wrapType, content: group });
      continue;
    }

    // taskItem 连续段 → 包 taskList(无歧义)
    if (type === 'taskItem') {
      const group: PmPayload[] = [];
      while (i < children.length && children[i].type === 'taskItem') {
        group.push(stripAssemblyHints(children[i]));
        i++;
      }
      result.push({ type: 'taskList', content: group });
      continue;
    }

    // column 连续段 → 包 columnList(无歧义)
    if (type === 'column') {
      const group: PmPayload[] = [];
      while (i < children.length && children[i].type === 'column') {
        group.push(stripAssemblyHints(children[i]));
        i++;
      }
      result.push({ type: 'columnList', content: group });
      continue;
    }

    // tableCell / tableHeader 不会出现在顶层 child 序列(它们的 childOf 父是 table atom,
    // 由 assembleTableChildren 单独处理);其它叶子/叶子级容器原样保留
    result.push(stripAssemblyHints(child));
    i++;
  }

  return result;
}

/**
 * 把一组 tableCell / tableHeader 包装为 table.content = [tableRow, tableRow, ...]。
 *
 * 字面策略(decision 026 §6.1 字面拍板的简化):tableCell / tableHeader 集合在
 * storage 中只通过 childOf 边挂到 table atom 字面无 row 信息。重建时按 cells 的 colspan
 * 或一个**等长行**约定。当前 v1 实施 fallback:**所有 cell 字面单行 tableRow**(单行
 * 容纳全部 cell)— 字面登记为 Stage 2 暂行实施,Stage 7 测试 T7 / 性能测试时验证
 * 是否需补"按 attrs.rowIndex / colIndex 字面"信息(留 future commit + 决议字面)。
 *
 * ⚠ 字面 Open Question(本期不深入):tableCell 跨 row 拼装的真实信息丢失;字面登记到
 * decision 026 §13 待补充。
 */
function wrapTableCells(cells: PmPayload[]): PmPayload[] {
  if (cells.length === 0) return [];
  // v1 简化:所有 cells 字面塞到单个 tableRow(等同 V1 数据迁前空 table 字面状态)
  const row: PmPayload = {
    type: 'tableRow',
    content: cells.map(stripAssemblyHints),
  };
  return [row];
}

/**
 * 剥除非 PM schema 字段(_assemblyHints)。PM nodeFromJSON 字面也会 strip
 * 未声明字段,这里显式做,让输出 PmPayload 干净便于上层 diff / hash。
 */
function stripAssemblyHints(node: PmPayload): PmPayload {
  const result: PmPayload = { type: node.type };
  if (node.attrs !== undefined) result.attrs = node.attrs;
  if (node.content !== undefined) result.content = node.content;
  if (node.marks !== undefined) result.marks = node.marks;
  if (node.text !== undefined) result.text = node.text;
  return result;
}

/**
 * 在 atom 集合内按 nextSibling 链拓扑排序(只对 sibling 集合做)。
 *
 * 输入:atomIds = 同一 childOf 父 / 同一 belongsToNote 容器的 sibling 集合
 * 输出:按 nextSibling 链顺序的 atomId 数组
 *
 * 算法:
 * 1. 在 nextSibling 边集合中找 incoming = 0 的 atomId(链头)
 * 2. 从链头开始,逐步 follow nextSibling.object
 * 3. 链断裂 fallback:剩余按字典序 append(沿 decision 026 §13.3 临时默认)
 */
function topologicalSortSiblings(
  atomIds: string[],
  nextSiblingEdges: EdgeEntity[],
): string[] {
  if (atomIds.length === 0) return [];
  const idSet = new Set(atomIds);

  // 只看 subject + object 都在本 sibling 集合内的 nextSibling 边
  const nextMap = new Map<string, string>();
  const hasIncoming = new Set<string>();
  for (const e of nextSiblingEdges) {
    const subjId = e.subject.atomId;
    if (e.object.kind !== 'atom') continue;
    const objId = e.object.atomId;
    if (!idSet.has(subjId) || !idSet.has(objId)) continue;
    // 字面 cardinality:每 atom outgoing ≤ 1,这里取首条边(后续若有 dup 字面 console.warn)
    if (nextMap.has(subjId)) {
      console.warn(
        `[assemble-pm-doc] nextSibling duplicate outgoing on atom ${subjId}, ` +
          `dropping second edge(decision 026 §13.3 临时 fallback)`,
      );
      continue;
    }
    nextMap.set(subjId, objId);
    hasIncoming.add(objId);
  }

  // 链头:无 incoming 的 atomId
  const heads = atomIds.filter((id) => !hasIncoming.has(id));
  if (heads.length === 0 && atomIds.length > 0) {
    // 全循环字面(数据坏)— fallback 按字典序
    console.error(
      `[assemble-pm-doc] nextSibling chain has no head (all atoms have incoming), ` +
        `fallback to lexicographic order(decision 026 §13.3)`,
    );
    return [...atomIds].sort();
  }
  if (heads.length > 1) {
    // 多链头字面 — 字面 fallback:按字典序 append(链头先放,残余按字典序)
    console.warn(
      `[assemble-pm-doc] nextSibling chain has ${heads.length} heads, ` +
        `chain may be broken(decision 026 §13.3)`,
    );
  }

  // 从第 1 个链头沿链遍历;其它链头按字典序在尾部串接
  heads.sort();
  const visited = new Set<string>();
  const result: string[] = [];

  for (const head of heads) {
    let cursor: string | undefined = head;
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      result.push(cursor);
      cursor = nextMap.get(cursor);
    }
  }

  // 剩余未访问字面 fallback(数据异常)
  if (visited.size < atomIds.length) {
    const leftover = atomIds.filter((id) => !visited.has(id)).sort();
    console.error(
      `[assemble-pm-doc] ${leftover.length} atoms not reachable via nextSibling chain, ` +
        `appending in lexicographic order(decision 026 §13.3)`,
    );
    result.push(...leftover);
  }

  return result;
}

/**
 * 递归构造一个 block atom 的输出 PM 节点(含子内容展开)。
 *
 * - 叶子 block:直接返回 atom.payload(剥 _assemblyHints)
 * - 叶子级容器(callout / blockquote / listItem / taskItem / tableCell / tableHeader /
 *   column / toggleList / unknown):字面用 childOf 边查子 atoms,递归构造,
 *   再用 wrapChildren / wrapTableCells 重建中间 wrapper
 *
 * 容器型 block 的 atom payload.content 字面应是 [];若非空字面记 warn(数据可能未 dissect)
 */
function buildPmNode(
  atomId: string,
  blocksById: Map<string, AtomEntity<'pm'>>,
  childrenByParent: Map<string, string[]>,
  nextSiblingEdges: EdgeEntity[],
): PmPayload | null {
  const atom = blocksById.get(atomId);
  if (!atom) {
    console.warn(`[assemble-pm-doc] block atom ${atomId} not found, skipping`);
    return null;
  }
  const payload = atom.payload.payload as BlockAtomPayload;
  const childIds = childrenByParent.get(atomId);

  // 叶子(无子)→ 原样返回(剥 hints)
  if (!childIds || childIds.length === 0) {
    return stripAssemblyHints(payload);
  }

  // 字面拍板:容器型 block 的 storage content 应是 [] — 非空字面 warn 但不 fail
  if (Array.isArray(payload.content) && payload.content.length > 0) {
    console.warn(
      `[assemble-pm-doc] container atom ${atomId} (${payload.type}) has non-empty ` +
        `storage content;字面 ignore in favor of childOf 边展开(decision 026 §3.4)`,
    );
  }

  // 按 nextSibling 链排序子 atoms
  const orderedChildIds = topologicalSortSiblings(childIds, nextSiblingEdges);
  const childNodes: PmPayload[] = [];
  for (const cid of orderedChildIds) {
    const node = buildPmNode(cid, blocksById, childrenByParent, nextSiblingEdges);
    if (node) childNodes.push(node);
  }

  // 容器类型决定重建策略
  let content: PmPayload[];
  if (payload.type === 'table') {
    content = wrapTableCells(childNodes);
  } else {
    content = wrapChildren(childNodes);
  }

  // 字面输出:剥 hints + 替换 content
  const out: PmPayload = { type: payload.type };
  if (payload.attrs !== undefined) out.attrs = payload.attrs;
  out.content = content;
  if (payload.marks !== undefined) out.marks = payload.marks;
  return out;
}

/**
 * 从 storage 字面拼装一个 container atom 对应的完整 PM doc。
 *
 * @param containerId — note container atom id 或 reading-thought atom id(D-10:不要求 hasNoteView)
 * @returns 完整 PmPayload(type='doc');若 container atom 不存在,返回 null
 */
export async function assemblePmDoc(containerId: string): Promise<PmPayload | null> {
  // 1. 字面拉容器 atom
  const containerAtom = await storage.getAtom<'pm'>(containerId);
  if (!containerAtom) return null;

  // 2. 拉所有 belongsToNote 边(object = containerId)
  const belongsEdges = await storage.listEdges({
    predicate: BELONGS_TO_NOTE_PREDICATE,
    objectAtomId: containerId,
  });
  const blockIds = belongsEdges.map((e) => e.subject.atomId);

  // 3. 字面拉所有 block atoms(并行)
  const blockAtomEntries: Array<AtomEntity<'pm'> | null> = await Promise.all(
    blockIds.map((id) => storage.getAtom<'pm'>(id)),
  );
  const blocksById = new Map<string, AtomEntity<'pm'>>();
  for (let i = 0; i < blockIds.length; i++) {
    const e = blockAtomEntries[i];
    if (e) blocksById.set(blockIds[i], e);
  }

  // 4. 拉所有 nextSibling 边 + childOf 边(全局,按 subject 在 blockIds 过滤)
  const blockIdSet = new Set(blockIds);
  const [nextSiblingEdgesRaw, childOfEdgesRaw] = await Promise.all([
    storage.listEdges({ predicate: NEXT_SIBLING_PREDICATE }),
    storage.listEdges({ predicate: CHILD_OF_PREDICATE }),
  ]);
  const nextSiblingEdges = nextSiblingEdgesRaw.filter(
    (e) =>
      blockIdSet.has(e.subject.atomId) &&
      e.object.kind === 'atom' &&
      blockIdSet.has(e.object.atomId),
  );
  const childOfEdges = childOfEdgesRaw.filter(
    (e) =>
      blockIdSet.has(e.subject.atomId) &&
      e.object.kind === 'atom' &&
      (e.object.atomId === containerId || blockIdSet.has(e.object.atomId)),
  );

  // 5. childOf 索引:parent → children
  const childrenByParent = new Map<string, string[]>();
  const hasChildOf = new Set<string>(); // block ids 有 childOf 出边(说明是嵌套子,不是顶层)
  for (const e of childOfEdges) {
    if (e.object.kind !== 'atom') continue;
    const parent = e.object.atomId;
    const child = e.subject.atomId;
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
    childrenByParent.get(parent)!.push(child);
    hasChildOf.add(child);
  }

  // 6. 顶层 block = 在 blockIds 中但没有 childOf 出边的(即直接挂 note container)
  const topLevelIds = blockIds.filter((id) => !hasChildOf.has(id));

  // 7. 顶层 block 按 nextSibling 排序
  const orderedTopIds = topologicalSortSiblings(topLevelIds, nextSiblingEdges);

  // 8. 递归构造每个顶层 block 节点
  const topNodes: PmPayload[] = [];
  for (const id of orderedTopIds) {
    const node = buildPmNode(id, blocksById, childrenByParent, nextSiblingEdges);
    if (node) topNodes.push(node);
  }

  // 9. 顶层 wrapper 重建(listItem / taskItem / column 字面不能直接挂 doc.content,
  //    要包成 bulletList / taskList / columnList)
  const docContent = wrapChildren(topNodes);

  return {
    type: 'doc',
    content: docContent,
  };
}

/**
 * 辅助常量导出(给 dissect-pm-doc.ts 用)— 集中化结构性容器集合。
 */
export const STRUCTURAL_CONTAINER_TYPES = new Set<string>([
  'table',
  'tableRow',
  'bulletList',
  'orderedList',
  'taskList',
  'columnList',
]);

/** dissect 用:从 PM 节点字面读 list 类型(用于写入 _assemblyHints.listType)*/
export type ListWrapperType = 'bulletList' | 'orderedList' | 'taskList';
