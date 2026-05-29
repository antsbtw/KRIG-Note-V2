/**
 * dissect-pm-doc — L7 block atomization Stage 2 Step 2.2
 *
 * 把完整 PM doc 拆解为 block atom 集合 + 边集合(belongsToNote / nextSibling / childOf)。
 *
 * 实施依据:
 * - decision 026 §3 颗粒度边界(STRUCTURAL_CONTAINER_TYPES 不拆)
 * - decision 026 §6 边集设计
 * - decision 026 §6.1 跨层 childOf(tableCell.childOf → table atom,跳 tableRow;
 *   listItem.childOf → callout / 上层 listItem / note container,跳 bulletList)
 * - decision 026 §8.3 diff 路径前提:dissect 是确定性纯函数
 *
 * 关键不变量:
 * - 每 block atom outgoing belongsToNote = 1
 * - 每 block atom outgoing nextSibling ≤ 1
 * - 每 block atom outgoing childOf ≤ 1
 * - 结构性容器(table / tableRow / bulletList / orderedList / taskList / columnList)
 *   字面**不**生成 atom — 其 child 直接挂最近的非结构性祖先
 */

import type { PmPayload } from '@semantic/types';
import { STRUCTURAL_CONTAINER_TYPES } from '@semantic/types/structural';

/** dissect 输出 — 字面交给 capability 走 diff + storage transaction */
export interface DissectResult {
  /** block atoms — 字面 id 已就位(从 PM attrs.id 字面读;若 null 报错 caller 应保证 plugin 已注入)*/
  blocks: Array<{
    id: string;
    /** 字面写入 storage 的 atom payload(已剥 children 但保留 _assemblyHints)*/
    payload: PmPayload;
  }>;
  /** belongsToNote 边 — 每 block 1 条,object = containerId */
  belongsEdges: Array<{ subjectId: string; objectId: string }>;
  /** nextSibling 边 — sibling 间(同一 childOf 父 / 同一 belongsToNote 容器下)*/
  nextSiblingEdges: Array<{ subjectId: string; objectId: string }>;
  /** childOf 边 — 嵌套子 → 最近非结构性祖先(可能是 containerId)*/
  childOfEdges: Array<{ subjectId: string; objectId: string }>;
}

/**
 * 字面判断:此 PM 节点是否生成 block atom(decision 026 §3.1)。
 * - 结构性容器 → 否(由父容器透传 children)
 * - inline 节点(无 attrs.id 字段)→ 否
 * - 其它带 id 字段的 block → 是
 *
 * 注:决议 §3.1 字面拍板的 22 NodeSpec 全部加了 attrs.id 字段(Stage 1 实施),
 * 这里通过 "attrs.id 是否存在(即使 null)" 字面识别(更精确比 `group: 'block'` 字符串匹配)。
 */
function shouldGenerateAtom(node: PmPayload): boolean {
  if (STRUCTURAL_CONTAINER_TYPES.has(node.type)) return false;
  // inline 类型:text / hardBreak / fileLink(inline)/ noteLink / mathInline / 等
  // 它们字面无 attrs.id 字段(Stage 1 §3.1.3 字面拍板不加 id)
  if (node.attrs === undefined) return false;
  return 'id' in node.attrs;
}

/**
 * 字面判断:此节点是结构性容器(透传 children 给父)。
 */
function isStructuralContainer(node: PmPayload): boolean {
  return STRUCTURAL_CONTAINER_TYPES.has(node.type);
}

/**
 * dissect 期间的运行时上下文(in-process,递归态)。
 */
interface DissectContext {
  result: DissectResult;
  containerId: string;
  /** 出错累积位置信息(便于 caller 抛 duplicate id 等错时定位)*/
  duplicateIds: Set<string>;
}

/**
 * 递归处理 children 列表:
 * - 给每个生成 atom 的 child 加 belongsToNote(object = containerId)+ nextSibling 链 + childOf(指 parentAtomId)
 * - 结构性容器(bulletList / table / 等)字面**透传**其 children 给祖先(childOf 跳层)
 *
 * @param children — PM 节点列表(可能含结构性容器,需要展开)
 * @param parentAtomId — 最近的拆 atom 祖先 id(顶层时 = containerId,嵌入容器时 = 容器 atom.id)
 * @param parentListType — 若当前 children 来自 bulletList/orderedList/taskList,记录类型供 listItem dissect 写 _assemblyHints
 * @param drawSiblingChain — 是否在本层尾部画 nextSibling 链。**结构性容器递归调用时必须传
 *   false** — 因为容器内的 grandchildren 会被外层 `siblingAtomIds.push(...)` 接走,
 *   外层会统一在更大范围内画链;若内层也画一次,grandchildren 间会出现 2 倍 nextSibling
 *   边(嵌套结构性容器则 3 倍,以此类推)。**真子级递归(非结构性容器内部)传 true** —
 *   那是独立的 sibling chain。bug 2026-05-22 修(decision 026 §6 cardinality ≤1 违反)。
 * @returns ordered atom ids(本层生成的 block atom 序列,供 caller 拼 nextSibling 链)
 */
function processChildren(
  children: PmPayload[] | undefined,
  parentAtomId: string,
  parentListType: 'bullet' | 'ordered' | null,
  ctx: DissectContext,
  drawSiblingChain: boolean = true,
): string[] {
  if (!Array.isArray(children) || children.length === 0) return [];

  const siblingAtomIds: string[] = [];

  // 5B Stage 3 (Q2 选项 B) + 5A 拍板: tableRow 不是 atom, 但其在父 table 内的位置 = cells 的 rowIndex.
  // 这里维护一个 tableRow 计数器, 进 tableRow 分支时字面 ++; 注入到 cell.attrs.rowIndex.
  // 跨 children 序列只对当前一层 table 有效 (PM schema 不允许 table 嵌 table; tableRow 不会跨非
  // table 父).
  let pmTableRowIdx = 0;

  for (const child of children) {
    if (isStructuralContainer(child)) {
      // 字面跳层:结构性容器自身不生成 atom,把其 children 字面提升到 parent 层
      let childListType: 'bullet' | 'ordered' | null = null;
      if (child.type === 'bulletList') childListType = 'bullet';
      else if (child.type === 'orderedList') childListType = 'ordered';
      // taskList 字面其 child 是 taskItem(另一 NodeSpec)无歧义,childListType 为 null

      // 5B Stage 3: tableRow 跳层时, 字面给 cells 注入 rowIndex/colIndex
      // (Q2 选项 B: dissect 期注入, PM tree 内不实时维护; 决议 026 §6.1 / 5A §5.3).
      // 注: PM schema (tableRow > (tableCell | tableHeader)+) 保证 tableRow.content 都是 cell/header,
      // 但本算法字面不假设 — 字面只对带 attrs.id 字段的 child 注入 (非 cell/header 字面跳过, 算法安全).
      let injectedContent: PmPayload[] | undefined = child.content;
      if (child.type === 'tableRow' && Array.isArray(child.content)) {
        const rowIdx = pmTableRowIdx++;
        injectedContent = child.content.map((cell, colIdx) => {
          // 仅当 cell 有 attrs 且声明 id 字段 (即 tableCell/tableHeader, S1.3.2/S1.3.3 加的字段) 时注入
          if (cell.attrs === undefined || !('id' in cell.attrs)) return cell;
          return {
            ...cell,
            attrs: {
              ...cell.attrs,
              rowIndex: rowIdx,
              colIndex: colIdx,
            },
          };
        });
      }

      // drawSiblingChain=false:grandchildren 会被外层 push(...grandchildIds) 接走,
      // 外层会统一画链(含跨容器边界的 prev→A、C→next),内层不能再画一次否则双倍。
      const grandchildIds = processChildren(
        injectedContent,
        parentAtomId,
        childListType,
        ctx,
        false,
      );
      siblingAtomIds.push(...grandchildIds);
      continue;
    }

    if (!shouldGenerateAtom(child)) {
      // inline(理论上 children 里不会有 inline,PM schema 不允许 doc.content 含 inline)
      // 字面 skip(字面 console.warn 减负)
      continue;
    }

    const id = (child.attrs?.id as string | null | undefined) ?? null;
    if (!id) {
      throw new Error(
        `[dissect-pm-doc] block of type ${child.type} has no attrs.id; ` +
          `caller must run buildAutoBlockIdPlugin / migration first(decision 026 §5.1)`,
      );
    }
    if (ctx.duplicateIds.has(id)) {
      // dup id 字面**只应在 plugin 未执行 / 数据库坏 / migration bug 时**触发 —
      // 正常路径 buildAutoBlockIdPlugin 字面已在 PM appendTransaction 内一遍扫描去重
      // (split / paste 都覆盖,decision 026 §5.2 §5.3)。若仍触发,数据已坏,字面 throw。
      throw new Error(
        `[dissect-pm-doc] duplicate block id ${id} in same doc; ` +
          `buildAutoBlockIdPlugin 字面去重失效(或 caller 绕开 PM 路径直接 IPC)`,
      );
    }
    ctx.duplicateIds.add(id);

    // 生成 block atom payload:剥 children(由 childOf 边重建),保留 attrs(含 id)
    // 容器型 block 字面 content = [];叶子 block 字面 content = inline 数组(原样保留)
    const isContainerBlock = !!(
      child.content &&
      child.content.length > 0 &&
      // 叶子的 content 全是 inline(text / mathInline 等),字面无 attrs.id 字段
      child.content.some((c) => shouldGenerateAtom(c) || isStructuralContainer(c))
    );

    const payload: PmPayload = { type: child.type };
    if (child.attrs !== undefined) payload.attrs = child.attrs;
    if (child.marks !== undefined) payload.marks = child.marks;

    if (isContainerBlock) {
      // 容器:storage content = [];_assemblyHints 字面写入(listItem 用 listType)
      payload.content = [];
      if (child.type === 'listItem' && parentListType) {
        (payload as PmPayload & { _assemblyHints?: { listType: 'bullet' | 'ordered' } })
          ._assemblyHints = { listType: parentListType };
      }
    } else {
      // 叶子(text / 等 inline children)— 原样保留 content
      if (child.content !== undefined) payload.content = child.content;
      // listItem 即使叶子也写 listType 提示(罕见场景:listItem 内只 inline 字面不合法,字面跳过)
    }

    ctx.result.blocks.push({ id, payload });
    ctx.result.belongsEdges.push({ subjectId: id, objectId: ctx.containerId });
    siblingAtomIds.push(id);

    if (parentAtomId !== ctx.containerId) {
      ctx.result.childOfEdges.push({ subjectId: id, objectId: parentAtomId });
    }

    // 递归处理容器子内容(只对容器型 block;叶子 block 字面 content 是 inline,跳过)
    if (isContainerBlock && child.content) {
      // listItem 字面 children 通常是 [paragraph, bulletList, ...],
      // 处理时把 paragraph 这种叶子级 child 的 parentAtomId 设为本 atom(child.id)
      processChildren(child.content, id, null, ctx);
    }
  }

  // 字面生成 nextSibling 链(本层 atom id 序列)
  // drawSiblingChain=false:本层是结构性容器递归,grandchildren 交给外层画链(否则双倍)
  if (drawSiblingChain) {
    for (let i = 0; i < siblingAtomIds.length - 1; i++) {
      ctx.result.nextSiblingEdges.push({
        subjectId: siblingAtomIds[i],
        objectId: siblingAtomIds[i + 1],
      });
    }
  }

  return siblingAtomIds;
}

/**
 * 把完整 PM doc 字面拆解为 block atom + 边集合。
 *
 * @param containerId — note container atom id 或 reading-thought atom id(D-10:不区分)
 * @param doc — 完整 PmPayload(type='doc',content=[...])
 * @throws 若任何 block 缺 attrs.id 或字面重复 id 字面 throw
 */
export function dissectPmDoc(containerId: string, doc: PmPayload): DissectResult {
  if (doc.type !== 'doc') {
    throw new Error(
      `[dissect-pm-doc] root must be type='doc', got '${doc.type}'`,
    );
  }
  const ctx: DissectContext = {
    result: {
      blocks: [],
      belongsEdges: [],
      nextSiblingEdges: [],
      childOfEdges: [],
    },
    containerId,
    duplicateIds: new Set(),
  };
  processChildren(doc.content, containerId, null, ctx);
  return ctx.result;
}

/**
 * 空 container 的 payload(decision 026 §6.3:容器 atom payload.payload = empty doc)。
 */
export function emptyContainerPayload(): PmPayload {
  return { type: 'doc', content: [] };
}
