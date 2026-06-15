/**
 * PM doc/slice → Markdown 序列化
 *
 * 用途:Ask AI / Thought 导出 / Markdown copy 等场景把 PM 选区无损转 Markdown。
 *
 * V1 源:src/plugins/note/commands/selection-to-markdown.ts(436 行,适配 V2)
 *
 * V2 适配差异:
 * - V1 textBlock(heading + paragraph 合一) → V2 heading(level 1-6) + paragraph 拆开
 * - V1 用 computeSliceForClipboard(含 blockSelection plugin 兼容)→ V2 简化:
 *   只走 state.selection.content(),不处理 block-selection plugin(V2 选区机制不同)
 * - 其他 block / mark 类型字面对齐 V1
 *
 * 注意:
 * - serializer 是纯函数 + 仅依赖 prosemirror-model,无 view 副作用
 * - 输出 markdown 给 AI 看,优先可读性;不追求 PM doc 100% 还原(图片 src/code lang/
 *   math latex/list 缩进 等 attrs 都保留,但 inline mark 顺序等细节可能丢失)
 */

import type { Mark, Node as PMNode, Slice } from 'prosemirror-model';

export interface SerializeResult {
  markdown: string;
  /** 选区内所有 image src 列表(供 multimodal AI 使用) */
  images: string[];
}

/**
 * 序列化一个 Slice 到 Markdown。
 *
 * @param slice PM Slice(state.selection.content() 取)
 */
export function sliceToMarkdown(slice: Slice): SerializeResult {
  if (!slice || slice.size === 0) return { markdown: '', images: [] };

  const images: string[] = [];
  const lines: string[] = [];

  // open slice(部分选区在单个 textBlock 内)— openStart > 0 时第一层是 inline 节点而非 block
  if (slice.openStart > 0) {
    const inlineParts: string[] = [];
    slice.content.forEach((node) => {
      if (node.isBlock) {
        const md = serializeBlock(node, 0, images);
        if (md !== null) lines.push(md);
      } else {
        inlineParts.push(serializeInlineNode(node));
      }
    });
    if (inlineParts.length > 0) lines.unshift(inlineParts.join(''));
  } else {
    // closed slice:每个顶层节点都是完整 block
    slice.content.forEach((node) => {
      const blockMd = serializeBlock(node, 0, images);
      if (blockMd !== null) lines.push(blockMd);
    });
  }

  return {
    markdown: lines.join('\n\n'),
    images,
  };
}

/**
 * 序列化一个完整的 PM doc Node 到 Markdown。
 *
 * 内部:doc → top-level children 逐 block 序列化。
 */
export function docNodeToMarkdown(doc: PMNode): SerializeResult {
  const images: string[] = [];
  const lines: string[] = [];
  doc.forEach((child) => {
    const md = serializeBlock(child, 0, images);
    if (md !== null) lines.push(md);
  });
  return { markdown: lines.join('\n\n'), images };
}

// ─── Block 序列化(V1 字面对齐 + V2 textBlock 拆分适配)──────────

function serializeBlock(node: PMNode, indent: number, images: string[]): string | null {
  const prefix = '  '.repeat(indent);
  switch (node.type.name) {
    // V2 拆分 paragraph + heading;V1 合一 textBlock
    case 'paragraph':
      return `${prefix}${serializeInlineContent(node)}`;

    case 'heading': {
      const level = (node.attrs.level as number) || 1;
      const headingPrefix = '#'.repeat(level) + ' ';
      return `${prefix}${headingPrefix}${serializeInlineContent(node)}`;
    }

    case 'codeBlock':
      return serializeCodeBlock(node, prefix);

    case 'mathBlock':
      return serializeMathBlock(node, prefix);

    case 'image':
      return serializeImage(node, prefix, images);

    case 'horizontalRule':
      return `${prefix}---`;

    case 'blockquote':
      return serializeContainer(node, '> ', indent, images);

    case 'callout':
      return serializeCallout(node, indent, images);

    case 'bulletList':
      return serializeList(node, 'bullet', indent, images);

    case 'orderedList':
      return serializeList(node, 'ordered', indent, images);

    case 'taskList':
      return serializeTaskList(node, indent, images);

    case 'toggleList':
      return serializeToggleList(node, indent, images);

    case 'table':
      return serializeTable(node, prefix);

    case 'columnList':
      return serializeColumnList(node, indent, images);

    case 'videoBlock':
      return serializeMediaPlaceholder(node, prefix, 'Video');

    case 'audioBlock':
      return serializeMediaPlaceholder(node, prefix, 'Audio');

    case 'htmlBlock':
      return serializeMediaPlaceholder(node, prefix, 'HTML');

    case 'fileBlock':
      return `${prefix}[📎 ${(node.attrs.filename as string) || 'File'}]`;

    case 'externalRef':
      return `${prefix}[🔗 ${(node.attrs.title as string) || (node.attrs.href as string) || 'Link'}](${(node.attrs.href as string) || ''})`;

    case 'tweetBlock':
      return serializeTweet(node, prefix);

    case 'frameBlock':
      return serializeContainer(node, '', indent, images);

    default: {
      // fallback:纯文本(V2 未来加新 block 时 graceful degrade)
      const text = node.textContent;
      return text ? `${prefix}${text}` : null;
    }
  }
}

// ─── Inline ────────────────────────────────────────────────────────

function serializeInlineNode(node: PMNode): string {
  if (node.isText) return wrapWithMarks(node.text || '', node.marks);
  if (node.type.name === 'mathInline') return `$${(node.attrs.latex as string) || ''}$`;
  if (node.type.name === 'hardBreak') return '  \n';
  if (node.type.name === 'noteLink') {
    const label = (node.attrs.label as string) || (node.attrs.noteId as string) || '';
    return `[[${label}]]`;
  }
  return node.textContent;
}

function serializeInlineContent(node: PMNode): string {
  return serializeInlineRange(node, 0, node.content.size);
}

function serializeInlineRange(node: PMNode, startOffset: number, endOffset: number): string {
  const parts: string[] = [];

  node.forEach((child, offset) => {
    const childEnd = offset + child.nodeSize;
    if (childEnd <= startOffset || offset >= endOffset) return;

    if (child.isText) {
      let text = child.text || '';
      const clipStart = Math.max(0, startOffset - offset);
      const clipEnd = Math.min(text.length, endOffset - offset);
      text = text.slice(clipStart, clipEnd);
      parts.push(wrapWithMarks(text, child.marks));
    } else if (child.type.name === 'mathInline') {
      parts.push(`$${(child.attrs.latex as string) || ''}$`);
    } else if (child.type.name === 'hardBreak') {
      parts.push('  \n');
    } else if (child.type.name === 'noteLink') {
      const label = (child.attrs.label as string) || (child.attrs.noteId as string) || '';
      parts.push(`[[${label}]]`);
    } else {
      parts.push(child.textContent);
    }
  });

  return parts.join('');
}

function wrapWithMarks(text: string, marks: readonly Mark[]): string {
  if (!text || marks.length === 0) return text;
  let result = text;
  for (const mark of marks) {
    switch (mark.type.name) {
      case 'bold':
        result = `**${result}**`;
        break;
      case 'italic':
        result = `*${result}*`;
        break;
      case 'code':
        result = `\`${result}\``;
        break;
      case 'strike':
        result = `~~${result}~~`;
        break;
      case 'underline':
        result = `<u>${result}</u>`;
        break;
      case 'link':
        result = `[${result}](${(mark.attrs.href as string) || ''})`;
        break;
      case 'highlight':
        result = `==${result}==`;
        break;
      // thought / textStyle — 不影响语义,跳过
    }
  }
  return result;
}

// ─── Code Block ────────────────────────────────────────────────────

function serializeCodeBlock(node: PMNode, prefix: string): string {
  const lang = (node.attrs.language as string) || '';
  const code = node.textContent;
  return `${prefix}\`\`\`${lang}\n${code}\n${prefix}\`\`\``;
}

// ─── Math Block ────────────────────────────────────────────────────

function serializeMathBlock(node: PMNode, prefix: string): string {
  // V2 mathBlock 的 latex 可能存 attrs.latex 也可能存 textContent — 兼容两者
  const latex = (node.attrs.latex as string) || node.textContent;
  return `${prefix}$$\n${prefix}${latex}\n${prefix}$$`;
}

// ─── Image ─────────────────────────────────────────────────────────

function serializeImage(node: PMNode, prefix: string, images: string[]): string {
  const src = (node.attrs.src as string) || '';
  const alt = (node.attrs.alt as string) || '';
  if (src) images.push(src);

  let caption = '';
  if (node.firstChild) {
    caption = serializeInlineContent(node.firstChild);
  }
  const altText = alt || caption || 'image';
  return `${prefix}![${altText}](${src})`;
}

// ─── Container blocks ──────────────────────────────────────────────

function serializeContainer(
  node: PMNode,
  linePrefix: string,
  indent: number,
  images: string[],
): string {
  const childLines: string[] = [];
  node.forEach((child) => {
    const md = serializeBlock(child, indent, images);
    if (md !== null) childLines.push(md);
  });
  if (linePrefix) {
    return childLines.map((l) => linePrefix + l).join('\n');
  }
  return childLines.join('\n\n');
}

function serializeCallout(node: PMNode, indent: number, images: string[]): string {
  const emoji = (node.attrs.emoji as string) || '💡';
  const childLines: string[] = [];
  node.forEach((child) => {
    const md = serializeBlock(child, indent, images);
    if (md !== null) childLines.push(md);
  });
  const body = childLines.join('\n> ');
  return `> ${emoji} ${body}`;
}

// ─── Lists ─────────────────────────────────────────────────────────

function serializeList(
  node: PMNode,
  kind: 'bullet' | 'ordered',
  indent: number,
  images: string[],
): string {
  const items: string[] = [];
  const startNum = (node.attrs.start as number) || 1;

  let idx = 0;
  node.forEach((child) => {
    const marker = kind === 'bullet' ? '-' : `${startNum + idx}.`;
    const itemLines: string[] = [];
    child.forEach((grandchild) => {
      const md = serializeBlock(grandchild, 0, images);
      if (md !== null) itemLines.push(md);
    });
    const prefix = '  '.repeat(indent);
    if (itemLines.length > 0) {
      items.push(`${prefix}${marker} ${itemLines[0]}`);
      const continuation = ' '.repeat(marker.length + 1);
      for (let i = 1; i < itemLines.length; i++) {
        items.push(`${prefix}${continuation}${itemLines[i]}`);
      }
    }
    idx++;
  });
  return items.join('\n');
}

function serializeTaskList(node: PMNode, indent: number, images: string[]): string {
  const items: string[] = [];
  const prefix = '  '.repeat(indent);

  node.forEach((taskItem) => {
    const checked = taskItem.attrs.checked ? 'x' : ' ';
    const itemLines: string[] = [];
    taskItem.forEach((child) => {
      const md = serializeBlock(child, 0, images);
      if (md !== null) itemLines.push(md);
    });
    if (itemLines.length > 0) {
      items.push(`${prefix}- [${checked}] ${itemLines.join(' ')}`);
    }
  });
  return items.join('\n');
}

function serializeToggleList(node: PMNode, indent: number, images: string[]): string {
  const childLines: string[] = [];
  let first = true;
  node.forEach((child) => {
    const md = serializeBlock(child, indent, images);
    if (md !== null) {
      if (first) {
        childLines.push(`<details>\n<summary>${md}</summary>\n`);
        first = false;
      } else {
        childLines.push(md);
      }
    }
  });
  childLines.push('</details>');
  return childLines.join('\n\n');
}

// ─── Table ─────────────────────────────────────────────────────────

/**
 * 表格 node → markdown 表格字符串(公开入口)。
 *
 * X Articles 终态发布(2026-06-13)：X Table 模态 placeholder "Add markdown here"，
 * 实测就吃这种 `| a | b |` + `| --- |` 的 markdown 表格 —— 驱动器直接填本函数产物。
 * 内部复用 serializeTable（与选区/整篇 markdown 序列化同一套，零分叉），prefix 空。
 */
export function serializeTableToMarkdown(node: PMNode): string {
  return serializeTable(node, '');
}

function serializeTable(node: PMNode, prefix: string): string {
  const rows: string[][] = [];

  node.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => {
      const cellParts: string[] = [];
      cell.forEach((child) => {
        const md = serializeBlock(child, 0, []);
        if (md !== null) cellParts.push(md);
      });
      cells.push(cellParts.join(' '));
    });
    rows.push(cells);
  });

  if (rows.length === 0) return '';

  const colCount = Math.max(...rows.map((r) => r.length));
  const lines: string[] = [];

  rows.forEach((row, i) => {
    while (row.length < colCount) row.push('');
    lines.push(`${prefix}| ${row.join(' | ')} |`);

    if (i === 0) {
      const sep = row.map(() => '---').join(' | ');
      lines.push(`${prefix}| ${sep} |`);
    }
  });

  return lines.join('\n');
}

// ─── Column Layout ─────────────────────────────────────────────────

function serializeColumnList(node: PMNode, indent: number, images: string[]): string {
  const columns: string[] = [];
  let colIdx = 0;
  node.forEach((column) => {
    colIdx++;
    const childLines: string[] = [];
    column.forEach((child) => {
      const md = serializeBlock(child, indent, images);
      if (md !== null) childLines.push(md);
    });
    columns.push(`**[Column ${colIdx}]**\n\n${childLines.join('\n\n')}`);
  });
  return columns.join('\n\n---\n\n');
}

// ─── Media Placeholder ─────────────────────────────────────────────

function serializeMediaPlaceholder(node: PMNode, prefix: string, kind: string): string {
  const title = (node.attrs.title as string) || '';
  return `${prefix}[${kind}: ${title}]`.trim();
}

// ─── Tweet ─────────────────────────────────────────────────────────

function serializeTweet(node: PMNode, prefix: string): string {
  const author = (node.attrs.authorName as string) || (node.attrs.authorHandle as string) || '';
  const text = (node.attrs.text as string) || '';
  const url = (node.attrs.tweetUrl as string) || '';
  return `${prefix}> **${author}**: ${text}\n${prefix}> — [Tweet](${url})`;
}
