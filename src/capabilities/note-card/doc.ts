/**
 * ① 内容:note doc 信封与纯文字互转(纯函数,单测直接跑)
 * 2026-11-06 从 math-visual(blocks/math-visual/shapes.ts)搬来。
 */

import type { NoteDoc, NoteNode } from './types';

/** 空卡片:一个空段落;首段 isTitle:false(卡片不是 note,没有标题) */
export function emptyDoc(): NoteDoc {
  return fromPlainText('');
}

/** 纯文字 → doc:一行一段 */
export function fromPlainText(text: string | undefined): NoteDoc {
  const lines = (text ?? '').split('\n');
  return {
    format: 'pm-doc-json',
    version: '0.1',
    payload: {
      type: 'doc',
      content: lines.map((line) => ({
        type: 'paragraph',
        attrs: { isTitle: false },
        content: line ? [{ type: 'text', text: line }] : [],
      })),
    },
  };
}

/** 卡片内容;空 doc(只有一个空段落)视为没有内容 */
export function contentOf(doc: NoteDoc | undefined): NoteNode[] | null {
  const content = doc?.payload?.content;
  if (!Array.isArray(content) || content.length === 0) return null;
  const empty = content.length === 1 && content[0].type === 'paragraph' && !(content[0].content?.length);
  return empty ? null : content;
}

/** doc → 纯文字(块之间换行;公式取 LaTeX 源码) */
export function toPlainText(doc: NoteDoc | undefined): string {
  const lines: string[] = [];
  const inline = (n: NoteNode): string => {
    if (n.type === 'text') return n.text ?? '';
    if (n.type === 'mathInline' || n.type === 'mathBlock') {
      return (n.attrs?.latex as string | undefined) ?? (n.content ?? []).map(inline).join('');
    }
    return (n.content ?? []).map(inline).join('');
  };
  const walk = (n: NoteNode) => {
    const kids = n.content ?? [];
    const leaf = kids.length === 0 || kids.every((k) => k.type === 'text' || k.type === 'mathInline' || k.type === 'hardBreak');
    if (leaf) lines.push(inline(n));
    else kids.forEach(walk);
  };
  (doc?.payload?.content ?? []).forEach(walk);
  return lines.join('\n').trim();
}
