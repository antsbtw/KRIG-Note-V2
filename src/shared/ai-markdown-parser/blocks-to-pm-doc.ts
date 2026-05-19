/**
 * ExtractedBlock[] → ProseMirror doc JSON 转换器
 *
 * 设计:V2 thought.doc 是 PM doc JSON(NoteDocEnvelope.payload),thought capability
 * 直接吃这个格式 + text-editing capability 用同款 schema 渲染。本模块替代 V1
 * 的 content-to-atoms.ts(V1 走 Atom 中间层 — V2 不需要 Atom 层,直 ExtractedBlock
 * → PM doc 即可)。
 *
 * 输出节点对齐 V2 PM schema(@drivers/text-editing-driver/blocks/):
 *   ExtractedBlock.type → PM nodeType
 *   ---------------------------------
 *   'paragraph'      → 'paragraph' + isTitle=false + indent=0
 *   'heading'        → 'heading' + level=headingLevel
 *   'blockquote'     → 'blockquote' 包 paragraph
 *   'callout'        → 'callout' { emoji } 包 paragraph
 *   'code'           → 'codeBlock' { language } textContent=text
 *   'math'           → 'mathBlock' textContent=text(LaTeX 源)
 *   'image'          → 'image' { src, alt, title }
 *   'video'/'audio'  → 'paragraph' (V1 也走 placeholder,V2 暂同)
 *   'bulletList'     → 'bulletList' > 'listItem' > 'paragraph'
 *   'orderedList'    → 'orderedList' > 'listItem' > 'paragraph'
 *   'table'          → 'table' > 'tableRow' > 'tableHeader'/'tableCell' > 'paragraph'
 *   'htmlBlock'    → 'htmlBlock' { src, title } 包空 paragraph(caption,留空)
 *   'file'         → 'paragraph' placeholder(V2 ai-response 不接 file block)
 *
 * Inline 元素(ExtractedInline → PM inline):
 *   'text'         → text node + marks
 *   'bold'         → text node + bold mark
 *   'italic'       → text node + italic mark
 *   'code-inline'  → text node + code mark
 *   'math-inline'  → mathInline node { latex }
 *   'link'         → text node + link mark { href }
 *   'file-link'    → text node + link mark(媒体 fallback 当链接)
 */

import type {
  ExtractedBlock,
  ExtractedInline,
  ExtractedListItem,
} from './extraction-types';

// ProseMirror JSON 节点形式(纯数据,不依赖 prosemirror-model)
interface PMTextNode {
  type: 'text';
  text: string;
  marks?: PMMark[];
}

interface PMMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Array<PMNode | PMTextNode>;
  text?: string;
  marks?: PMMark[];
}

interface PMDoc {
  type: 'doc';
  content: PMNode[];
}

// ─── 入口 ───────────────────────────────────────────────────────────

export function extractedBlocksToPmDoc(blocks: ExtractedBlock[]): PMDoc {
  const content: PMNode[] = [];
  for (const block of blocks) {
    const nodes = blockToNodes(block);
    for (const n of nodes) content.push(n);
  }
  // 兜底:空 doc 也得有一个 paragraph(PM doc 不能空)
  if (content.length === 0) {
    content.push({ type: 'paragraph' });
  }
  return { type: 'doc', content };
}

// ─── Block 转换 ─────────────────────────────────────────────────────

function blockToNodes(block: ExtractedBlock): PMNode[] {
  switch (block.type) {
    case 'heading':
      return [
        {
          type: 'heading',
          attrs: { level: clampLevel(block.headingLevel) },
          content: inlinesToContent(block.inlines, block.text),
        },
      ];

    case 'paragraph':
      // ResultParser 把 markdown 的 "---" / "***" / "___" 标成
      // {type:'paragraph', tag:'hr', text:'---'}(因为 ExtractedBlock 没正式 hr 类型);
      // 转 PM 时还原为真 horizontalRule 节点,而不是含 "---" 文本的 paragraph。
      if (block.tag === 'hr') {
        return [{ type: 'horizontalRule' }];
      }
      return [
        {
          type: 'paragraph',
          content: inlinesToContent(block.inlines, block.text),
        },
      ];

    case 'blockquote':
      return [
        {
          type: 'blockquote',
          content: [
            {
              type: 'paragraph',
              content: inlinesToContent(block.inlines, block.text),
            },
          ],
        },
      ];

    case 'callout':
      return [
        {
          type: 'callout',
          attrs: {
            emoji: block.calloutEmoji || '💡',
          },
          content: [
            {
              type: 'paragraph',
              content: inlinesToContent(block.inlines, block.text),
            },
          ],
        },
      ];

    case 'code': {
      const text = block.text || '';
      return [
        {
          type: 'codeBlock',
          attrs: { language: block.language || '' },
          // codeBlock content 是 text*,直接放 text node(empty 时不放 content,避免 PM 报错)
          ...(text.length > 0
            ? { content: [{ type: 'text', text } as PMTextNode] }
            : {}),
        },
      ];
    }

    case 'math': {
      const latex = block.text || '';
      return [
        {
          type: 'mathBlock',
          ...(latex.length > 0
            ? { content: [{ type: 'text', text: latex } as PMTextNode] }
            : {}),
        },
      ];
    }

    case 'image':
      // V2 image PM spec content='block' 必须有一个 child block(caption),
      // 不加 content 时 PM.nodeFromJSON 会抛 RangeError(失败 fence 走默认 fallback)。
      // 用空 paragraph 占位即可,用户可后续手填 caption。
      return [
        {
          type: 'image',
          attrs: {
            src: block.src || '',
            alt: block.alt || '',
            title: block.caption || '',
          },
          content: [{ type: 'paragraph' }],
        },
      ];

    case 'htmlBlock':
      // V2 htmlBlock spec: content='block' 单 caption + attrs.src(media:// URL)
      // AI 提取 HTML artifact 走这条路径(extract-turn.ts 输出 !html[title](media://...))
      return [
        {
          type: 'htmlBlock',
          attrs: {
            src: block.src || null,
            title: block.text || '',
          },
          content: [{ type: 'paragraph' }],
        },
      ];

    case 'video':
    case 'audio':
    case 'file':
      // V2 当前 ai-response thought 不接复杂媒体 block,降级 paragraph 占位
      return [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: `[${block.type}: ${block.text || block.src || block.filename || ''}]`,
            },
          ],
        },
      ];

    case 'bulletList':
      return [
        {
          type: 'bulletList',
          content: listItemsToNodes(block.items),
        },
      ];

    case 'orderedList':
      return [
        {
          type: 'orderedList',
          content: listItemsToNodes(block.items),
        },
      ];

    case 'table':
      return [tableToNode(block)];

    default:
      // 未知 type — 降级 paragraph 保留文字(防丢失)
      return [
        {
          type: 'paragraph',
          content: inlinesToContent(block.inlines, block.text),
        },
      ];
  }
}

// ─── List ──────────────────────────────────────────────────────────

function listItemsToNodes(items: ExtractedListItem[] | undefined): PMNode[] {
  if (!items || items.length === 0) {
    return [{ type: 'listItem', content: [{ type: 'paragraph' }] }];
  }
  return items.map((item): PMNode => {
    // 每个 listItem 内容 = 一个 paragraph(用 item.inlines / text)+ 子 blocks 嵌套
    const itemContent: PMNode[] = [
      {
        type: 'paragraph',
        content: inlinesToContent(item.inlines, item.text),
      },
    ];
    if (item.blocks && item.blocks.length > 0) {
      for (const sub of item.blocks) {
        const subNodes = blockToNodes(sub);
        for (const n of subNodes) itemContent.push(n);
      }
    }
    return { type: 'listItem', content: itemContent };
  });
}

// ─── Table ─────────────────────────────────────────────────────────

function tableToNode(block: ExtractedBlock): PMNode {
  const rows = block.tableRows || [];
  const hasHeader = block.tableHasHeader ?? true;
  const tableContent: PMNode[] = rows.map((row, rowIdx): PMNode => {
    const cellType = hasHeader && rowIdx === 0 ? 'tableHeader' : 'tableCell';
    const cells: PMNode[] = row.map((cellText): PMNode => ({
      type: cellType,
      content: [
        {
          type: 'paragraph',
          content: parseInlineMarkdownString(cellText),
        },
      ],
    }));
    return { type: 'tableRow', content: cells };
  });
  return { type: 'table', content: tableContent };
}

// ─── Inline ────────────────────────────────────────────────────────

function inlinesToContent(
  inlines: ExtractedInline[] | undefined,
  fallbackText: string,
): Array<PMNode | PMTextNode> | undefined {
  if (!inlines || inlines.length === 0) {
    const t = fallbackText || '';
    if (!t) return undefined;
    return [{ type: 'text', text: t }];
  }

  const result: Array<PMNode | PMTextNode> = [];
  for (const inline of inlines) {
    const node = inlineToNode(inline);
    if (node) result.push(node);
  }
  if (result.length === 0) return undefined;
  return result;
}

function inlineToNode(inline: ExtractedInline): PMNode | PMTextNode | null {
  switch (inline.type) {
    case 'text':
      return { type: 'text', text: inline.text };
    case 'bold':
      return {
        type: 'text',
        text: inline.text,
        marks: [{ type: 'bold' }],
      };
    case 'italic':
      return {
        type: 'text',
        text: inline.text,
        marks: [{ type: 'italic' }],
      };
    case 'code-inline':
      return {
        type: 'text',
        text: inline.text,
        marks: [{ type: 'code' }],
      };
    case 'math-inline':
      // V2 mathInline 是 inline node + attrs.latex
      return {
        type: 'mathInline',
        attrs: { latex: inline.text },
      };
    case 'link':
      return {
        type: 'text',
        text: inline.text,
        marks: [{ type: 'link', attrs: { href: inline.href || '' } }],
      };
    case 'file-link':
      // V2 暂无 file-link inline node;降级 link mark
      return {
        type: 'text',
        text: inline.text,
        marks: [{ type: 'link', attrs: { href: inline.href || '' } }],
      };
    default:
      return null;
  }
}

/**
 * 表格单元格内复用 inline 解析(简化版):
 *
 * 表格 markdown 解析时 V1 ResultParser 把 cell 文本作为纯字符串放到 tableRows[][],
 * 没经过 parseInlineMarkdown。这里在 PM 转换阶段补一遍 inline 解析,让 cell 里的
 * **bold** / *italic* / `code` / $math$ / [link]() 也正确渲染。
 *
 * 注:full V1 ResultParser.parseInlineMarkdown 在 result-parser.ts 内是 private,
 * 这里用一个轻量再实现(覆盖最常用 4 种 mark + 链接 + inline math)。复杂场景
 * (嵌套 mark / nested link)允许降级为纯文本。
 */
function parseInlineMarkdownString(text: string): Array<PMNode | PMTextNode> {
  if (!text) return [];
  const result: Array<PMNode | PMTextNode> = [];
  let pos = 0;

  while (pos < text.length) {
    // ── inline math $...$(不在 \$ 转义内) ──
    const mathStart = text.indexOf('$', pos);
    if (mathStart !== -1 && (mathStart === 0 || text[mathStart - 1] !== '\\')) {
      const mathEnd = text.indexOf('$', mathStart + 1);
      if (mathEnd !== -1 && mathEnd > mathStart + 1) {
        // 提交 mathStart 之前的纯文本(可能含其他 marks)
        if (mathStart > pos) {
          pushTextWithMarks(result, text.slice(pos, mathStart));
        }
        result.push({
          type: 'mathInline',
          attrs: { latex: text.slice(mathStart + 1, mathEnd) },
        });
        pos = mathEnd + 1;
        continue;
      }
    }

    // 后续无 $,把剩余整体走 pushTextWithMarks
    pushTextWithMarks(result, text.slice(pos));
    break;
  }

  return result;
}

/**
 * 把一段不含 inline math 的字符串拆成 text + marks(bold/italic/code/link)。
 * 用最小 tokenizer 处理 **bold** / *italic* / `code` / [text](href)。
 */
function pushTextWithMarks(
  out: Array<PMNode | PMTextNode>,
  text: string,
): void {
  if (!text) return;

  // 优先按 [text](href) 切
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(text)) !== null) {
    if (m.index > lastIndex) {
      pushPlainWithMarks(out, text.slice(lastIndex, m.index));
    }
    out.push({
      type: 'text',
      text: m[1],
      marks: [{ type: 'link', attrs: { href: m[2] } }],
    });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    pushPlainWithMarks(out, text.slice(lastIndex));
  }
}

function pushPlainWithMarks(
  out: Array<PMNode | PMTextNode>,
  text: string,
): void {
  if (!text) return;

  // bold 优先匹配 `**...**`,然后 italic `*...*`,然后 code `` `...` ``
  const tokens = tokenizeMarks(text);
  for (const tok of tokens) {
    if (!tok.text) continue;
    const node: PMTextNode = { type: 'text', text: tok.text };
    if (tok.marks.length > 0) {
      node.marks = tok.marks.map((m) => ({ type: m }));
    }
    out.push(node);
  }
}

/**
 * tokenize text 处理 **bold** / *italic* / `code`(简化:不支持嵌套 mark)。
 */
function tokenizeMarks(text: string): Array<{ text: string; marks: string[] }> {
  const tokens: Array<{ text: string; marks: string[] }> = [];
  let i = 0;
  let buf = '';
  const flush = (marks: string[] = []): void => {
    if (buf) {
      tokens.push({ text: buf, marks });
      buf = '';
    }
  };

  while (i < text.length) {
    // **bold**
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2);
      if (end !== -1 && end > i + 2) {
        flush();
        tokens.push({ text: text.slice(i + 2, end), marks: ['bold'] });
        i = end + 2;
        continue;
      }
    }
    // *italic*(避免与 **bold** 冲突;前面已优先 **)
    if (text[i] === '*' && !text.startsWith('**', i)) {
      const end = text.indexOf('*', i + 1);
      if (end !== -1 && end > i + 1 && text[end + 1] !== '*') {
        flush();
        tokens.push({ text: text.slice(i + 1, end), marks: ['italic'] });
        i = end + 1;
        continue;
      }
    }
    // `code`
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1 && end > i + 1) {
        flush();
        tokens.push({ text: text.slice(i + 1, end), marks: ['code'] });
        i = end + 1;
        continue;
      }
    }
    buf += text[i];
    i++;
  }
  flush();
  return tokens;
}

function clampLevel(level: number | undefined): number {
  if (typeof level !== 'number' || level < 1) return 1;
  if (level > 6) return 6;
  return Math.floor(level);
}
