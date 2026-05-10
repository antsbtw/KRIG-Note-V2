/**
 * sanitizeAtoms — 清洗后端 OCR 返回的 Atom 数据(L5-C6 PDF 提取)
 *
 * 契约:`docs/10-business-design/ebook/PDF-Note-Atom数据契约-v2.md` § 9
 *
 * 8 条容错规则:
 *   1. 过滤 v1 `document` root atom(v2 不再有 root 概念)
 *   2. v1 类型迁移:kebab-case → camelCase(math-block / code-block / ...)
 *      partTitle → noteTitle
 *   3. 清理指向 document root 的顶层 parentId(v1 历史残留)
 *   4. v1 `meta.sourcePages` → v2 `from.pdfPage` 迁移
 *   5. 过滤空 text 节点(`text === ''` 在 PM schema 非法)
 *   6. children 内 Tiptap 格式 mathInline → InlineElement math-inline 归一
 *   7. tiptapContent 递归过滤空 text 节点 + 段落空容器补占位
 *   8. children 全空时补占位空格(PM `text-block` 等容器至少一段非空)
 *
 * **跟 V1 差异**:V2 PM schema 含 `listItem`,所以 V1 那条
 * "listItem → paragraph 展开"的逻辑此处**不复制**(atoms-to-pm.ts 自己 tree builder)。
 *
 * **顺序**:`sanitizeAtoms(raw) → atomsToProseMirror({atoms})`。
 */

interface AtomLike {
  id: string;
  type: string;
  content?: Record<string, unknown>;
  parentId?: string;
  from?: { extractionType?: string; pdfPage?: number; extractedAt?: number };
  meta?: Record<string, unknown>;
}

// v1 kebab-case → v2 camelCase
const TYPE_MIGRATION: Record<string, string> = {
  'math-block': 'mathBlock',
  'code-block': 'codeBlock',
  'column-list': 'columnList',
  'horizontal-rule': 'horizontalRule',
  partTitle: 'noteTitle',
};

export function sanitizeAtoms(atoms: AtomLike[]): AtomLike[] {
  if (!Array.isArray(atoms)) return [];

  // 收集 document root id(给清理顶层 parentId 用)
  const docRootIds = new Set(
    atoms.filter((a) => a.type === 'document').map((a) => a.id),
  );

  return atoms
    // (1) 过滤 document root
    .filter((a) => a && a.type !== 'document')
    .map((atom) => {
      // (2) 类型迁移
      const migrated = TYPE_MIGRATION[atom.type];
      if (migrated) {
        atom.type = migrated;
      }

      // (3) 清理指向 document root 的 parentId
      if (atom.parentId && docRootIds.has(atom.parentId)) {
        delete atom.parentId;
      }

      // (4) v1 meta.sourcePages → v2 from.pdfPage
      const meta = atom.meta;
      const sourcePages = meta?.sourcePages as
        | { startPage?: number; endPage?: number }
        | undefined;
      if (sourcePages && !atom.from) {
        atom.from = {
          extractionType: 'pdf',
          pdfPage: sourcePages.startPage ?? 1,
          extractedAt:
            (meta?.createdAt as number | undefined) ?? Date.now(),
        };
      }
      if (meta && 'sourcePages' in meta) {
        delete meta.sourcePages;
      }

      // (5)(6)(8) 清洗 content.children
      const content = atom.content;
      if (content && Array.isArray(content.children)) {
        content.children = sanitizeChildren(
          content.children as Record<string, unknown>[],
        );
        if ((content.children as unknown[]).length === 0) {
          // 至少一个占位空格,避免 PM 容器 content 必填校验失败
          content.children = [{ type: 'text', text: ' ' }];
        }
      }

      // (7) 清洗 tiptapContent
      if (content && Array.isArray(content.tiptapContent)) {
        content.tiptapContent = sanitizeTiptapContent(
          content.tiptapContent as Record<string, unknown>[],
        );
      }

      return atom;
    });
}

/** 清洗 InlineElement children:Tiptap mathInline 归一 + 过滤空 text */
function sanitizeChildren(
  children: Record<string, unknown>[],
): Record<string, unknown>[] {
  return children
    .map((child) => {
      // Tiptap 格式 mathInline(camelCase + attrs.latex)→ InlineElement math-inline(扁平 latex)
      if (child.type === 'mathInline') {
        const attrs = child.attrs as Record<string, unknown> | undefined;
        const latex = (attrs?.latex as string) ?? (child.latex as string) ?? '';
        return { type: 'math-inline', latex };
      }
      return child;
    })
    .filter((child) => {
      if (child.type === 'text') {
        const text = child.text as string;
        return text != null && text.length > 0;
      }
      return true;
    });
}

/** 递归清洗 tiptapContent 内嵌空 text + 段落空容器补占位 */
function sanitizeTiptapContent(
  nodes: Record<string, unknown>[],
): Record<string, unknown>[] {
  return nodes
    .filter((node) => {
      if (node.type === 'text') {
        return node.text != null && (node.text as string).length > 0;
      }
      return true;
    })
    .map((node) => {
      if (Array.isArray(node.content)) {
        const cleaned = sanitizeTiptapContent(
          node.content as Record<string, unknown>[],
        );
        if (
          cleaned.length === 0 &&
          (node.type === 'paragraph' ||
            node.type === 'heading' ||
            node.type === 'text-block')
        ) {
          return { ...node, content: [{ type: 'text', text: ' ' }] };
        }
        return { ...node, content: cleaned };
      }
      return node;
    });
}
