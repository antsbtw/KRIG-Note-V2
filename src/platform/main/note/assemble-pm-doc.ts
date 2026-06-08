/**
 * assemble-pm-doc — 从 storage 内拆散的 block atom 拼装回完整 PM doc。
 *
 * Decision 028 Phase 4:**纯属性路径,零结构边**。
 *  - 按 noteId 一次拉本笔记所有 block atom
 *  - 按 parentId 建树(顶层 = parentId null;跨结构容器跳层语义沿用)
 *  - 同级按 order 字典序升序排
 *  - 用 applyRebuildRules / assembleTable 重建中间结构容器壳(逻辑不变,026 §6.1)
 *
 * 入参契约:
 * - containerId = note container atom id(D-10:也可是 reading-thought,不要求 hasNoteView)
 * - 数据须已迁移成属性形态(migration 028)。若仍是旧边形态(0 属性块 + belongsToNote 边),
 *   **fail loud 抛错**(边 fallback 已移除,不静默返回空 doc 丢内容)。
 *
 * 输出:完整 PmPayload(type='doc')。container 不存在 → null。
 */

import { storage } from '@storage/index';
import type {
  AtomEntity,
  PmPayload,
} from '@semantic/types';
import { applyRebuildRules } from './structural-rebuild-rules';
import { assembleTable } from './assemble-table';
import { stripAssemblyHints, type BlockAtomPayload } from './assemble-pm-doc-helpers';

// Decision 028 Phase 4:assemble 纯属性路径。belongsToNote 仅用于"未迁移 note" fail-loud 检测。
const BELONGS_TO_NOTE_PREDICATE = 'user:krig:belongsToNote';

// 5B Stage 4 重构 (§7.3.2):
// - 原 wrapChildren / wrapTableCells / stripAssemblyHints 拆出三处:
//   - 通用 grouping (list/taskList/columnList) -> structural-rebuild-rules.ts
//   - table 重建 (按 rowIndex/colIndex 分组排序) -> assemble-table.ts
//   - 共享小工具 (stripAssemblyHints + BlockAtomPayload) -> assemble-pm-doc-helpers.ts

/**
 * 递归构造一个 block atom 的输出 PM 节点(含子内容展开)。
 *
 * - 叶子 block:直接返回 atom.payload(剥 _assemblyHints)
 * - 叶子级容器(callout / blockquote / listItem / taskItem / tableCell / tableHeader /
 *   column / toggleList / unknown):字面用 childOf 边查子 atoms,递归构造,
 *   再用 applyRebuildRules / assembleTable 重建中间 wrapper (5B Stage 4)
 *
 * 容器型 block 的 atom payload.content 字面应是 [];若非空字面记 warn(数据可能未 dissect)
 *
 * export:migration 028(legacy 边读取)复用同一节点构造逻辑,只换 childrenByParent /
 * sortSiblings 的来源(边 vs 属性)。生产 assemble 只走属性。
 */
export function buildPmNode(
  atomId: string,
  blocksById: Map<string, AtomEntity<'pm'>>,
  childrenByParent: Map<string, string[]>,
  sortSiblings: (ids: string[]) => string[],
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
    // table 无 cell 子 atom → 空 table(content:[])违反 schema `tableRow+`,
    // 落 doc 后打开时 setNodeMarkup 重校验崩溃。丢弃这个孤立 table atom
    // (2026-05-29 长 docx 导入崩溃:读侧救存量坏数据,write 侧 md-to-pm 已防新增)。
    if (payload.type === 'table') {
      console.warn(
        `[assemble-pm-doc] table atom ${atomId} has no cell children; ` +
          `dropping(空 table 违反 schema tableRow+,会致 setNodeMarkup 崩溃)`,
      );
      return null;
    }
    return stripAssemblyHints(payload);
  }

  // 字面拍板:容器型 block 的 storage content 应是 [] — 非空字面 warn 但不 fail
  if (Array.isArray(payload.content) && payload.content.length > 0) {
    console.warn(
      `[assemble-pm-doc] container atom ${atomId} (${payload.type}) has non-empty ` +
        `storage content;字面 ignore in favor of childOf 边展开(decision 026 §3.4)`,
    );
  }

  // 按提供的排序策略排序子 atoms(属性路径=order 升序;边路径=nextSibling 拓扑排序)
  const orderedChildIds = sortSiblings(childIds);
  const childNodes: PmPayload[] = [];
  for (const cid of orderedChildIds) {
    const node = buildPmNode(cid, blocksById, childrenByParent, sortSiblings);
    if (node) childNodes.push(node);
  }

  // 容器类型决定重建策略 (5B Stage 4):
  // - table: 字面走 assembleTable (按 cell.attrs.rowIndex/colIndex 分组排序重建 tableRow)
  // - 其它容器: 字面走 applyRebuildRules (list/taskList/columnList 注册式 grouping)
  let content: PmPayload[];
  if (payload.type === 'table') {
    content = assembleTable(childNodes);
    // assembleTable 可能因 cell 全退化返回 [](或全空行被 assembleTable 内丢)。
    // 空 table content 违反 schema `tableRow+` → setNodeMarkup 崩溃,丢弃整 table。
    if (content.length === 0) {
      console.warn(
        `[assemble-pm-doc] table atom ${atomId} reassembled to 0 rows; ` +
          `dropping(空 table 违反 schema tableRow+)`,
      );
      return null;
    }
  } else {
    content = applyRebuildRules(childNodes);
  }

  // 字面输出:剥 hints + 替换 content
  const out: PmPayload = { type: payload.type };
  if (payload.attrs !== undefined) out.attrs = payload.attrs;
  out.content = content;
  if (payload.marks !== undefined) out.marks = payload.marks;
  return out;
}

/**
 * Decision 028:读取 block atom 的结构属性(noteId/parentId/order)。
 * payload.attrs 是 FLEXIBLE 自由字段,这里窄化读取。
 */
function readStructAttrs(atom: AtomEntity<'pm'>): {
  parentId: string | null;
  order: string | undefined;
} {
  const attrs = (atom.payload.payload as PmPayload).attrs;
  const parentId =
    attrs && typeof attrs.parentId === 'string' ? attrs.parentId : null;
  const order =
    attrs && typeof attrs.order === 'string' ? attrs.order : undefined;
  return { parentId, order };
}

/**
 * Decision 028:本批 block atom 是否全部带 order 属性。
 * 任一缺 → 数据未迁移 / 半迁移,assemblePmDoc 抛错(Phase 4 已无边 fallback)。
 */
function allHaveOrder(atoms: AtomEntity[]): boolean {
  for (const a of atoms) {
    if (readStructAttrs(a as AtomEntity<'pm'>).order === undefined) return false;
  }
  return true;
}

/**
 * Decision 028 Phase 1 — 纯属性拼装(零结构边遍历)。
 *
 * 输入:本笔记所有 block atom(已按 noteId 拉好,且全部带 order/parentId 属性)。
 * 算法:
 *  1. 按 parentId 建 parent→children 映射(parentId=null 即顶层)
 *  2. 同级按 order 字典序升序排
 *  3. 复用 buildPmNode + applyRebuildRules/assembleTable 重建中间容器壳(逻辑不变,
 *     只是排序/分组的输入从边变属性)
 */
function assembleViaAttrs(blockAtoms: AtomEntity<'pm'>[]): PmPayload {
  const blocksById = new Map<string, AtomEntity<'pm'>>();
  for (const a of blockAtoms) blocksById.set(a.id, a);

  // parentId → children ids(null 父归为顶层 key）
  const TOP = '__top__';
  const childrenByParent = new Map<string, string[]>();
  const orderById = new Map<string, string>();
  for (const a of blockAtoms) {
    const { parentId, order } = readStructAttrs(a);
    orderById.set(a.id, order ?? '');
    const key = parentId ?? TOP;
    const arr = childrenByParent.get(key);
    if (arr) arr.push(a.id);
    else childrenByParent.set(key, [a.id]);
  }

  // 同级按 order 字典序升序(稳定:order 相同时按 id 兜底,正常数据 order 互异)
  const sortByOrder = (ids: string[]): string[] =>
    [...ids].sort((x, y) => {
      const ox = orderById.get(x) ?? '';
      const oy = orderById.get(y) ?? '';
      if (ox < oy) return -1;
      if (ox > oy) return 1;
      return x < y ? -1 : x > y ? 1 : 0;
    });

  // buildPmNode 的 childrenByParent 用 atom id 做 key,顶层用 TOP —— 但 buildPmNode
  // 递归时用 atomId(真实 id)查 children,顶层不经 buildPmNode(直接遍历 TOP 组),
  // 故 childrenByParent 的非顶层 key 必须是真实 parent atom id(上面已如此)。
  const topIds = sortByOrder(childrenByParent.get(TOP) ?? []);
  const topNodes: PmPayload[] = [];
  for (const id of topIds) {
    const node = buildPmNode(id, blocksById, childrenByParent, sortByOrder);
    if (node) topNodes.push(node);
  }

  const docContent = applyRebuildRules(topNodes);
  return { type: 'doc', content: docContent };
}

/**
 * 从 storage 字面拼装一个 container atom 对应的完整 PM doc。
 *
 * @param containerId — note container atom id 或 reading-thought atom id(D-10:不要求 hasNoteView)
 * @returns 完整 PmPayload(type='doc');若 container atom 不存在,返回 null
 */
export async function assemblePmDoc(containerId: string): Promise<PmPayload | null> {
  // 1. 拉容器 atom
  const containerAtom = await storage.getAtom<'pm'>(containerId);
  if (!containerAtom) return null;

  // Decision 028 Phase 4:纯属性路径(无边 fallback)。按 noteId 一次拉本笔记所有 block atom。
  const attrBlocks = await storage.listAtoms({ domain: 'pm', noteId: containerId });

  if (attrBlocks.length === 0) {
    // 0 block:可能是(a)真空 note,或(b)未迁移的老 note(结构仍在边上)。
    // fail loud 区分:若仍存在 belongsToNote 结构边 → 该 note 未迁移,**抛错**而非
    // 静默返回空 doc 丢内容(沿 §6 排查规范 / 028 Phase 4 边 fallback 已删)。
    const staleEdges = await storage.listEdges({
      predicate: BELONGS_TO_NOTE_PREDICATE,
      objectAtomId: containerId,
      limit: 1,
    });
    if (staleEdges.length > 0) {
      throw new Error(
        `[assemble-pm-doc] note ${containerId} 仍有 belongsToNote 结构边但无 noteId 属性块 —— ` +
          `migration 028 未完成。边 fallback 已在 Phase 4 移除,拒绝静默返回空 doc(会丢内容)。` +
          `请确认 migration-028 已跑完(flag 文件)。`,
      );
    }
    // 真空 note
    return { type: 'doc', content: [] };
  }

  // fail loud:有块但缺 order 属性(半迁移 / 脏数据)—— 不静默乱序,抛错暴露。
  if (!allHaveOrder(attrBlocks)) {
    throw new Error(
      `[assemble-pm-doc] note ${containerId} 的 block atom 缺 order 属性(半迁移?)。` +
        `边 fallback 已移除,拒绝无序拼装。请重跑 migration 028。`,
    );
  }

  return assembleViaAttrs(attrBlocks as AtomEntity<'pm'>[]);
}

/**
 * 5B §7.3.1 拍板: STRUCTURAL_CONTAINER_TYPES 收敛到 semantic 层单点 export
 * (5A 拍板 table 是 atom, 集合从 6 项降为 5 项).
 * 本文件保留 re-export 以维持既有 import 链路向后兼容;
 * 新代码字面应直接 `import { STRUCTURAL_CONTAINER_TYPES } from '@semantic/types/structural'`.
 */
export { STRUCTURAL_CONTAINER_TYPES } from '@semantic/types/structural';

/** dissect 用:从 PM 节点字面读 list 类型(用于写入 _assemblyHints.listType)*/
export type ListWrapperType = 'bulletList' | 'orderedList' | 'taskList';
