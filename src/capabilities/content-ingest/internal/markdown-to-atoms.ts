/**
 * markdownToAtoms — 5B Stage 5 §3.3 + §7.1.3 字面实施
 *
 * 算法(5B §7.1.3 第 4 点字面):
 *   1. 内部走现有 `markdownToProseMirror` 出 PMNode[]
 *      (import from `@capabilities/text-editing/converters/md-to-pm`)
 *   2. 字面执行 "PM → Atom" 局部转换(对齐 dissect 但**不写库**):
 *      - 顶层每 block → atom(attrs.id 字面 null 占位)
 *      - 容器型 block content = [](决议 026 §3.4)
 *      - 注入 from `{ extractionType:'markdown', extractedAt:Date.now() }`
 *        替代默认 'pdf'
 *   3. 表格节点字面走 `tableAdapter`(table-adapter.ts) 展开为扁平 cells + childOf 边
 *   4. 输出 `{ atoms: Atom[]; warnings: string[] }`
 *
 * 边界纪律:
 *   - 字面**不进** PM editor / 不调 noteCap.createNote(capability 边界)
 *   - 字面**只产 Atom**(不产 PM doc / PMNode[] / DriverSerialized)
 *   - pmToAtoms 字面**不依赖 main 进程 IPC** — content-ingest 跑 renderer,
 *     与 markdownToProseMirror 同进程(Q6 留下 sub-phase)
 *
 * 复用 Stage 1-4 单点:
 *   - STRUCTURAL_CONTAINER_TYPES from `@semantic/types/structural` — 字面 import 不重复定义
 */

import { markdownToProseMirror } from '@capabilities/text-editing/converters/md-to-pm';
import type { PmPayload } from '@semantic/types';
import { STRUCTURAL_CONTAINER_TYPES } from '@semantic/types/structural';
import { tableAdapter } from './table-adapter';
import type {
  Atom,
  AtomFrom,
  MarkdownToAtomsOptions,
  MarkdownToAtomsResult,
} from '../types';

/**
 * PmPayload 字面**仅在本文件内部**作为 "PM → Atom 局部转换中间表示".
 *
 * 字面**不导出**(types.ts / index.ts 不 re-export — 5B §3.3 字面禁止
 * 对外导出 PM doc / PMNode[] / DriverSerialized 形态的 API,
 * PmPayload 同属"PM 内部表示"系列;V3 grep 接受 PmPayload 仅本文件内部 OK).
 *
 * 类型语义:与 md-to-pm.ts 的 PMNode 字面同形(均是 `{ type, attrs?, content?, marks?, text? }`),
 * 取 @semantic/types 单点定义减少类型 drift. markdownToProseMirror 返回的 PMNode
 * 字面结构兼容 PmPayload(structural typing),无需 cast.
 */

/**
 * markdownToAtoms 入口.
 *
 * options:
 *   - titleHint:若给,首块字面替换为 `{ type:'noteTitle', content:{ children:[
 *     { type:'text', text:titleHint }] } }`(沿用 markdown-import.ts:492 当前逻辑).
 *     未给则原文首块(通常是 heading)保留.
 *   - from:覆盖默认 `{ extractionType:'markdown', extractedAt:Date.now() }`(浅合并).
 */
export async function markdownToAtoms(
  md: string,
  options?: MarkdownToAtomsOptions,
): Promise<MarkdownToAtomsResult> {
  const warnings: string[] = [];

  // 默认 from(可被 options.from 覆盖). extractedAt 字面在调用时取一次(同 batch 一致).
  const defaultFrom: AtomFrom = {
    extractionType: 'markdown',
    extractedAt: Date.now(),
  };
  const from: AtomFrom = { ...defaultFrom, ...(options?.from ?? {}) };

  // Step 1: markdown → PM 节点序列(复用 text-editing converters,字面不动 md-to-pm.ts)
  // markdownToProseMirror 返回 PMNode[](其私有内部类型),字面与 PmPayload 结构兼容.
  let pmNodes: PmPayload[];
  try {
    pmNodes = (await markdownToProseMirror(md)) as PmPayload[];
  } catch (err) {
    warnings.push(`markdownToProseMirror failed: ${String(err)}`);
    return { atoms: [], warnings };
  }

  // Step 2-3: PM → Atom 局部转换(顶层每 block → atom;table 走 tableAdapter)
  const atoms: Atom[] = [];

  // titleHint:若给,字面 prepend isTitle paragraph(对齐 view/note/markdown-import.ts
  // ensureLeadingTitle 行为;本期只产 atom,view 层自己再封 doc 信封).
  // 注:design 字面写 "强制首块 isTitle paragraph" — 用 paragraph + attrs.isTitle:true
  // 字面对齐 markdown-import.ts:493 的 PMDocNode shape.
  if (options?.titleHint && options.titleHint.trim()) {
    atoms.push({
      id: null,
      type: 'paragraph',
      attrs: { id: null, isTitle: true },
      content: {
        tiptapContent: [
          { type: 'text', text: options.titleHint.trim() } as unknown as Record<string, unknown>,
        ],
      },
      from,
    });
  }

  for (const pmNode of pmNodes) {
    if (pmNode.type === 'table') {
      // table:走 tableAdapter 展开为 table atom + cells + childOf
      // tableAdapter 入参 tiptapContent 是 PMNode[]:此处是 pmNode.content(tableRow 数组).
      const adapted = tableAdapter({
        tiptapContent: pmNode.content ?? [],
        tableAtomId: undefined, // id 待 inject(5B §7.3.1 第 5 项 injectIdsForCreate)
        from,
      });
      atoms.push(adapted.tableAtom);
      for (const cell of adapted.cellAtoms) {
        atoms.push(cell);
      }
      // 注:childOfEdges 字面在本 capability 不返回(API 契约只有 atoms[] + warnings[]).
      // 边集由 Stage 7 createNotesBatch 在写库前根据 tableAtomId 注入后字面重建.
      continue;
    }

    // 非 table 顶层 block → atom
    atoms.push(pmNodeToAtom(pmNode, from));
  }

  return { atoms, warnings };
}

/**
 * 单个 PMNode → Atom(顶层 block 用).
 *
 * 字面规则:
 *   - 容器型 block(STRUCTURAL_CONTAINER_TYPES + 任何带嵌套 block 的)→ content.tiptapContent = []
 *     (决议 026 §3.4 容器 storage content 空,assemble 时由边重建)
 *   - 叶子 block(text/inline children)→ content.tiptapContent = [...inline 原样]
 *   - attrs.id 字面 null 占位(由 capability 层 inject)
 *
 * 注:本期字面**不**复刻 dissect-pm-doc 的"跨层 childOf + 多 atom 产出"(那是写库时
 * 才需要的;markdownToAtoms 只产顶层 atom 序列,嵌套语义保留在 atom.content.tiptapContent
 * 内由 atomsToProseMirror 再 assemble).
 */
function pmNodeToAtom(node: PmPayload, from: AtomFrom): Atom {
  const isContainer = isContainerBlock(node);

  // attrs:透传原 attrs + 注入 id:null 占位
  const attrs: Record<string, unknown> = {
    id: null,
    ...(node.attrs ?? {}),
  };
  // attrs.id 字面强制 null(原 node.attrs.id 字面被覆盖 — 占位由 inject 阶段负责)
  attrs.id = null;

  if (isContainer) {
    // 容器:content.tiptapContent 字面空数组(决议 026 §3.4)
    return {
      id: null,
      type: node.type,
      content: { tiptapContent: [] },
      from,
      attrs,
    };
  }

  // 叶子:content.tiptapContent = inline 原样(text/mathInline/marks 等)
  // 字面保留 node.content;不展开成 children 形态(那是 atoms-to-pm.ts 的事).
  return {
    id: null,
    type: node.type,
    content: { tiptapContent: (node.content ?? []) as unknown as Record<string, unknown>[] },
    from,
    attrs,
  };
}

/**
 * 是否为容器型 block.
 *
 * 字面规则(对齐 dissect-pm-doc.ts:174 isContainerBlock):
 *   - 结构性容器(STRUCTURAL_CONTAINER_TYPES)→ true
 *   - content 含 block-level child(任何 type 在 STRUCTURAL_CONTAINER_TYPES 或不在
 *     已知 inline 列表的)→ true
 *   - 否则(叶子或 inline-only)→ false
 */
function isContainerBlock(node: PmPayload): boolean {
  if (STRUCTURAL_CONTAINER_TYPES.has(node.type)) return true;
  // table 字面是容器(content 全是 tableRow);本算法已在 markdownToAtoms 主循环
  // 单独 dispatch 到 tableAdapter,这里返回 true 是兜底语义(实际不走到这分支).
  if (node.type === 'table') return true;
  // listItem / blockquote / callout / toggleList:含 paragraph 等 block child → 容器
  // 字面判定:children 中是否有"非 inline"节点
  const children = node.content ?? [];
  for (const child of children) {
    if (isBlockNode(child)) return true;
  }
  return false;
}

/**
 * 是否为 block 节点(粗判:非已知 inline type).
 *
 * 字面已知 inline(对齐 md-to-pm.ts parseInline 产出):
 *   text / mathInline / 任何带 marks 的 text(marks 是 inline 标记不是节点 type)
 */
function isBlockNode(node: PmPayload): boolean {
  const inlineTypes = new Set(['text', 'mathInline', 'hardBreak']);
  return !inlineTypes.has(node.type);
}
