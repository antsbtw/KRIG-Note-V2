/**
 * markdownToAtoms — 5B Stage 7 重做(2026-05-29 规范字面对齐)
 *
 * 算法字面:
 *   1. markdown → markdownToProseMirror(md) → PMNode[]
 *      (renderer 端已处理 media:// 等)
 *   2. 遍历 PMNode[] 顶层,每 node 走 pmNodeToDrafts:
 *      - 跳过 STRUCTURAL_CONTAINER_TYPES (5 项,from @semantic/types/structural)
 *        其 children 用本 parentTmpId 继续递归
 *      - 非 STRUCTURAL:分配新 tmpId (tmp-${counter++}),产 PmAtomDraft
 *        其 children 递归 with parentTmpId = 本 draft's tmpId
 *      - 叶子 (content 全 inline):payload.payload.content = inline 数组原样
 *      - 容器:payload.payload.content = [] (决议 026 §3.4)
 *   3. table 节点字面调 tableAdapter
 *   4. titleHint:若 atoms[0].payload.payload.type === 'paragraph' 字面在其 attrs
 *      上设 isTitle = true;否则前置一个 paragraph atom
 *   5. 每个 draft 字面携 from:{ extractionType:'markdown', extractedAt: now }
 *      (除非 options.from 覆盖)
 *
 * 边界纪律:
 *   - 字面**不**复用 dissectPmDoc (PM editor 端 user-edit 后专用,平行路径)
 *   - 字面**必须** import STRUCTURAL_CONTAINER_TYPES from @semantic/types/structural
 *   - 字面**不进** PM editor / 不调 noteCap / 不预设 atom.id (PE4)
 *
 * 规范依据:
 *   - Atom<'pm'> = { domain:'pm', payload: PmPayload } (atom/spec.md §1)
 *   - PmAtomDraft.tmpId 是 draft 阶段专用 (storage 写入后丢弃)
 */

import { markdownToProseMirror } from '@capabilities/text-editing/converters/md-to-pm';
import type { PmPayload, PmAtomDraft, AtomFrom } from '@semantic/types';
import { pmNodeToDrafts } from './pm-nodes-to-drafts';
import type {
  MarkdownToAtomsOptions,
  MarkdownToAtomsResult,
} from '../types';

/**
 * markdownToAtoms 入口.
 *
 * options:
 *   - titleHint:若给,首块字面设 attrs.isTitle = true (paragraph) 或前置一个;
 *     未给则原文首块原样保留 (不强加 title).
 *   - from:覆盖默认 { extractionType:'markdown', extractedAt: Date.now() } (浅合并).
 */
export async function markdownToAtoms(
  md: string,
  options?: MarkdownToAtomsOptions,
): Promise<MarkdownToAtomsResult> {
  const warnings: string[] = [];

  // 默认 from (可被 options.from 覆盖). extractedAt 字面在调用时取一次.
  const defaultFrom: AtomFrom = {
    extractionType: 'markdown',
    extractedAt: Date.now(),
  };
  const from: AtomFrom = { ...defaultFrom, ...(options?.from ?? {}) };

  // Step 1: markdown → PM 节点序列
  let pmNodes: PmPayload[];
  try {
    pmNodes = (await markdownToProseMirror(md)) as PmPayload[];
  } catch (err) {
    warnings.push(`markdownToProseMirror failed: ${String(err)}`);
    return { atoms: [], warnings };
  }

  // tmpId 分配器(本批 atoms 内唯一)
  let counter = 0;
  const allocTmpId = (): string => `tmp-${counter++}`;

  const atoms: PmAtomDraft[] = [];

  // Step 2-3: 顶层遍历 PMNode[]
  for (const pmNode of pmNodes) {
    pmNodeToDrafts(pmNode, undefined, atoms, allocTmpId, from);
  }

  // Step 4: titleHint 处理(字面)
  if (options?.titleHint && options.titleHint.trim()) {
    const hint = options.titleHint.trim();
    if (
      atoms.length > 0 &&
      atoms[0].payload.payload.type === 'paragraph' &&
      atoms[0].parentTmpId === undefined
    ) {
      // 首块字面是顶层 paragraph — 在其 attrs 上设 isTitle = true
      const firstAttrs = (atoms[0].payload.payload.attrs ?? {}) as Record<string, unknown>;
      atoms[0].payload.payload.attrs = { ...firstAttrs, isTitle: true };
    } else {
      // 前置一个 paragraph atom 字面表达 title
      const titleDraft: PmAtomDraft = {
        tmpId: allocTmpId(),
        payload: {
          domain: 'pm',
          payload: {
            type: 'paragraph',
            attrs: { isTitle: true },
            content: [{ type: 'text', text: hint }],
          },
        },
        from,
      };
      atoms.unshift(titleDraft);
    }
  }

  return { atoms, warnings };
}

// pmNodeToDrafts / isBlockNode 已抽到 ./pm-nodes-to-drafts(markdown + PDF 共用)。
