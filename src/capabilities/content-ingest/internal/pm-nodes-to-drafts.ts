/**
 * pmNodeToDrafts — PM 节点序列 → PmAtomDraft[] 的标准拆解(所有导入共用)
 *
 * 统一抽象(2026-06-05):markdown / PDF / 未来其他导入,统一走
 *   源 → (markdownToProseMirror | atomsToProseMirror) → PM 节点 → pmNodeToDrafts → PmAtomDraft[]
 * 不再各写各的透传逻辑(原 krigBatchToAtoms 的 atom 透传漏了 noteTitle→paragraph 映射 +
 * 把 inline 文字塞进没人读的 legacyContent → deserializeDoc 崩 / 文字丢失)。
 *
 * 字面规则(从 markdown-to-atoms.ts 原样抽出):
 *   - STRUCTURAL_CONTAINER_TYPES(5 项):跳层,递归 children 用同 parentTmpId
 *   - table:特例,调 tableAdapter 展开为 table draft + cell drafts
 *   - 非 STRUCTURAL 非 table:产 draft;容器(含嵌套 block child)content=[],
 *     叶子(全 inline child)content=inline 原样;block 子节点递归 with parentTmpId=本 tmpId
 */

import type { PmPayload, PmAtomDraft, AtomFrom } from '@semantic/types';
import { STRUCTURAL_CONTAINER_TYPES } from '@semantic/types/structural';
import { tableAdapter } from './table-adapter';

/**
 * 是否为 block 节点(粗判:非已知 inline type)。
 * 已知 inline(对齐 md-to-pm.ts / atoms-to-pm.ts parseInline 产出):
 *   text / mathInline / hardBreak
 */
export function isBlockNode(node: PmPayload): boolean {
  const inlineTypes = new Set(['text', 'mathInline', 'hardBreak']);
  return !inlineTypes.has(node.type);
}

/**
 * 递归处理单个 PM 节点,产出 PmAtomDraft 写到 out 数组。
 */
export function pmNodeToDrafts(
  node: PmPayload,
  parentTmpId: string | undefined,
  out: PmAtomDraft[],
  allocTmpId: () => string,
  from: AtomFrom,
): void {
  // 结构性容器:跳层,递归 children 用同 parentTmpId
  if (STRUCTURAL_CONTAINER_TYPES.has(node.type)) {
    const children = Array.isArray(node.content) ? node.content : [];
    for (const child of children) {
      pmNodeToDrafts(child, parentTmpId, out, allocTmpId, from);
    }
    return;
  }

  // table:特例 — 调 tableAdapter
  if (node.type === 'table') {
    const tableTmpId = allocTmpId();
    const { tableDraft, cellDrafts } = tableAdapter({
      tablePmNode: node,
      tableTmpId,
      allocTmpId,
      from,
    });
    // tableDraft 顶层 parentTmpId 沿用 caller 传入(顶层 = undefined,嵌套 = 上层 atom.tmpId)
    if (parentTmpId !== undefined) {
      tableDraft.parentTmpId = parentTmpId;
    }
    out.push(tableDraft);
    for (const cd of cellDrafts) {
      out.push(cd);
    }
    return;
  }

  // 非 STRUCTURAL 非 table:产 draft
  const tmpId = allocTmpId();
  const children = Array.isArray(node.content) ? node.content : [];
  const hasBlockChild = children.some((c) => isBlockNode(c));

  // 字面构造 payload PmPayload
  const draftPmPayload: PmPayload = {
    type: node.type,
  };
  if (node.attrs !== undefined) draftPmPayload.attrs = { ...node.attrs };
  if (node.marks !== undefined) draftPmPayload.marks = node.marks;
  if (node.text !== undefined) draftPmPayload.text = node.text;

  if (hasBlockChild) {
    // 容器:content = [] (决议 026 §3.4)
    draftPmPayload.content = [];
  } else {
    // 叶子:content = inline 原样
    draftPmPayload.content = children;
  }

  const draft: PmAtomDraft = {
    tmpId,
    payload: {
      domain: 'pm',
      payload: draftPmPayload,
    },
    from,
  };
  if (parentTmpId !== undefined) {
    draft.parentTmpId = parentTmpId;
  }
  out.push(draft);

  // 递归 block 子节点 with parentTmpId = 本 draft.tmpId
  if (hasBlockChild) {
    for (const child of children) {
      if (isBlockNode(child)) {
        pmNodeToDrafts(child, tmpId, out, allocTmpId, from);
      }
      // inline child 不产 draft(已在 hasBlockChild 分支 content=[] fallback)
    }
  }
}
