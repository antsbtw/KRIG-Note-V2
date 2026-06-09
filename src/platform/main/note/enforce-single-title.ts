/**
 * enforce-single-title — note 文档硬不变量:**一篇 note 至多一个 isTitle 块,且为首块**
 *
 * 收口层(2026-06-09 拍板):放在 note **写库必经处**(capability 层),而非散在各导入链路。
 * 任何来源(PDF / AI / markdown / 剪藏 / 编辑器 / 未来新入口)的 doc 落库前都过这一关 ——
 * 单点强制,自动覆盖所有路径。
 *
 * 处理策略(用户拍板,对齐 [[feedback-fail-loud-no-fallback]]):
 * - 发现「首块以外的 isTitle 块」或「首块不是 isTitle 却存在多个 isTitle」→ **降级为正文**
 *   (paragraph 保留文本,仅去 isTitle 标记)—— 不丢数据。
 * - 同时 **大声 warn**(console.warn)—— 不静默兜底,暴露源头 bug 便于追。
 *
 * 为何「降级」而非「丢弃 / throw」:
 * - 丢弃会丢文本(重复标题往往携带正文语义);
 * - 生产 throw 会让一次坏导入炸掉整篇;
 * - 降级 + warn 兼顾「不崩」与「可见」。
 *
 * 两种形态(对应两条写库路径):
 * - enforceSingleTitleInDoc:updateNote 收到的**树形 PM doc**(顶层 doc.content[])
 * - enforceSingleTitleInDrafts:createNotesBatch 的**扁平 draft 列表**(root 级 draft)
 */

import type { PmPayload, PmAtomDraft } from '@semantic/types';

function isTitleBlock(node: { type?: string; attrs?: Record<string, unknown> | null } | undefined): boolean {
  return !!node && node.type === 'paragraph' && node.attrs?.isTitle === true;
}

/** 把一个 isTitle paragraph 降级为正文 paragraph(去 isTitle,保留其余 attrs + content)。 */
function demoteAttrs(attrs: Record<string, unknown> | undefined): Record<string, unknown> {
  const next = { ...(attrs ?? {}) };
  next.isTitle = false;
  return next;
}

/**
 * 树形 PM doc:保留**首个** isTitle 首块,其余 isTitle 一律降级为正文。
 * 仅扫 doc 顶层 content(title 语义只在顶层第一块;嵌套块不应带 isTitle)。
 * 返回新 doc(不原地改输入);无多余 title 时返回原引用。
 */
export function enforceSingleTitleInDoc(doc: PmPayload): PmPayload {
  const content = Array.isArray(doc.content) ? doc.content : null;
  if (!content || content.length === 0) return doc;

  let kept = false;
  let demoted = 0;
  const nextContent = content.map((block, idx) => {
    if (!isTitleBlock(block as PmPayload)) return block;
    // 首块 isTitle 且尚未保留过 → 保留(权威 title)
    if (idx === 0 && !kept) {
      kept = true;
      return block;
    }
    // 其余 isTitle(非首块,或首块已是 isTitle 后又出现)→ 降级
    demoted++;
    return { ...(block as PmPayload), attrs: demoteAttrs((block as PmPayload).attrs) };
  });

  if (demoted === 0) return doc;
  console.warn(
    `[enforce-single-title] doc 内 ${demoted} 个多余 isTitle 块已降级为正文段落 ` +
      `(一篇 note 仅保留 1 个标题且须为首块)`,
  );
  return { ...doc, content: nextContent };
}

/**
 * 扁平 draft 列表(createNotesBatch):保留**首个** root 级 isTitle draft,其余降级。
 * root 级 = parentTmpId 为空(顶层块);嵌套 draft 不参与 title 判定。
 * 原地改 draft.payload.payload.attrs 的副本(返回新数组,元素按需替换)。
 */
export function enforceSingleTitleInDrafts(drafts: PmAtomDraft[]): PmAtomDraft[] {
  let kept = false;
  let demoted = 0;
  const next = drafts.map((draft) => {
    const isRoot = !draft.parentTmpId;
    const payload = draft.payload.payload as PmPayload;
    if (!isRoot || !isTitleBlock(payload)) return draft;
    if (!kept) {
      kept = true;
      return draft;
    }
    demoted++;
    return {
      ...draft,
      payload: {
        ...draft.payload,
        payload: { ...payload, attrs: demoteAttrs(payload.attrs) },
      },
    } as PmAtomDraft;
  });

  if (demoted === 0) return drafts;
  console.warn(
    `[enforce-single-title] drafts 内 ${demoted} 个多余 isTitle 块已降级为正文段落 ` +
      `(一篇 note 仅保留 1 个标题)`,
  );
  return next;
}
