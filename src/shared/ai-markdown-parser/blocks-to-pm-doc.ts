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
// 阶段 B1:heading/paragraph/hr/code/math 的 PMNode 构造改调唯一解析核 markdown-core
// 的 canonical 构造器(B1 拍板:① 也吃规范形 —— inline 升级为递归嵌套 + strike,
// codeBlock/mathBlock 形态与 ② 对齐)。非 B1 block(callout/list/table/image/…)不动。
import {
  buildHeadingNode,
  buildParagraphNode,
  buildCodeBlockNode,
  buildMathBlockNode,
  buildTableNode,
  buildCalloutNode,
  buildImageNode,
  buildHtmlBlockNode,
  buildBlockquoteNode,
  buildListItemNode,
  buildBulletListNode,
  buildOrderedListNode,
  buildTaskItemNode,
  buildTaskListNode,
} from '@shared/markdown-core';

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
      // B1:heading 走核 buildHeadingNode。level 仍经 clampLevel(核不 clamp,
      // ① 侧 headingLevel 来源为 markdown `#` 数已 1-6,clamp 保持历史兜底)。
      // content 用 canonical inline(核对 block.text 重解析,升级为递归嵌套 + strike)。
      return [
        {
          ...buildHeadingNode(clampLevel(block.headingLevel), block.text || ''),
        },
      ];

    case 'paragraph':
      // ResultParser 把 markdown 的 "---" / "***" / "___" 标成
      // {type:'paragraph', tag:'hr', text:'---'}(因为 ExtractedBlock 没正式 hr 类型);
      // 转 PM 时还原为真 horizontalRule 节点,而不是含 "---" 文本的 paragraph。
      if (block.tag === 'hr') {
        return [{ type: 'horizontalRule' }];
      }
      // B1:paragraph 走核 buildParagraphNode(canonical inline)。
      return [{ ...buildParagraphNode(block.text || '') }];

    case 'blockquote':
      // B4a:blockquote 采「② 递归任意 block」改调核 buildBlockquoteNode。内层由 result-parser
      // 递归 parseMarkdown 产 block.blocks（纯文本引用=单 paragraph，输出不变；`>` 内含
      // code/math 时产真子块=能力增强）。旧数据/极端无 blocks 时兜底单 paragraph（text/inlines）。
      if (block.blocks && block.blocks.length > 0) {
        return [buildBlockquoteNode(block.blocks.flatMap(blockToNodes))];
      }
      return [
        buildBlockquoteNode([
          { type: 'paragraph', content: inlinesToContent(block.inlines, block.text) },
        ]),
      ];

    case 'callout':
      // B2:callout 改调核 buildCalloutNode(canonical:body 走核 parseInline 递归嵌套 +
      // strike)。emoji 仍用 result-parser 算好的 block.calloutEmoji(经核 CALLOUT_EMOJI_MAP
      // 移植,映射结果不变),仅 body inline 升级 —— 回归护栏:emoji 输出不变。
      return [buildCalloutNode(block.calloutEmoji || '💡', block.text || '')];

    case 'code':
      // B1:codeBlock 走核 buildCodeBlockNode(canonical:有 lang 才带 attrs,
      // 空内容省 content)。注:① 侧 codeTitle 目前 blocks-to-pm-doc 本就丢弃,B1 不变。
      return [{ ...buildCodeBlockNode(block.language || '', block.text || '') }];

    case 'math': {
      // B1:mathBlock 走核 buildMathBlockNode(canonical:content=[text])。
      // 保留 ① 历史行为:空 latex 时不产 content(核恒带,故空 latex 单独兜底)。
      const latex = block.text || '';
      if (latex.length === 0) {
        return [{ type: 'mathBlock' }];
      }
      return [{ ...buildMathBlockNode(latex) }];
    }

    case 'image':
      // B3:image 改调核 buildImageNode(src 原样,core 不本地化)。① 无 async 本地化 ——
      // src 进 result-parser 时已是 URL/`image:pageN` 占位,原样带出。caption→title(空则
      // 省 title,与 schema default '' 等价)。
      // 注:① 的 pageRef/bbox(image:pageN:x,y,w,h)迁移前就在此处被丢弃(未映射进 attrs);
      // image schema 无 bbox/pageRef attr(方言规范:bbox 已是死数据),指挥拍板保持丢弃 +
      // 留 TODO(见 markdown-core/media-blocks.ts parseImageSrc)。
      return [buildImageNode(block.src || '', block.alt || '', block.caption)];

    case 'htmlBlock':
      // B3:htmlBlock 改调核 buildHtmlBlockNode(src 原样)。AI 提取 HTML artifact 走这条
      // (extract-turn.ts 输出 !html[title](media://...))。text→title。
      return [buildHtmlBlockNode(block.src || null, block.text || '')];

    case 'video':
    case 'audio':
    case 'file':
      // V2 当前 ai-response thought 不接复杂媒体 block,降级 paragraph 占位。
      // B3:① 此降级行为**保持不变**(验收准则#5:① video/audio 输出结构不变) ——
      // 媒体节点识别/构造进核只供 ② 补齐用;① 若将来要产真节点另立项。
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
      // B4a:改调核 buildBulletListNode + buildListItemNode（item 内嵌 block 保持 ① 强项）。
      return [buildBulletListNode(listItemsToNodes(block.items))];

    case 'orderedList':
      return [buildOrderedListNode(listItemsToNodes(block.items))];

    case 'taskList':
      // B4a 新增能力：① 现认 task list（`- [ ]`）→ taskList > taskItem。createdAt 用导入时刻
      //（markdown 无创建时间；不给则 NodeView mount 自动补触发 OCC 风暴）。checked 由 item 带。
      return [buildTaskListNode(taskItemsToNodes(block.items))];

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

/** 一个 list item 的内层 block：首 paragraph（inlines/text）+ 子 blocks 嵌套（① 强项）。 */
function listItemContent(item: ExtractedListItem): PMNode[] {
  const itemContent: PMNode[] = [
    { type: 'paragraph', content: inlinesToContent(item.inlines, item.text) },
  ];
  if (item.blocks && item.blocks.length > 0) {
    for (const sub of item.blocks) {
      for (const n of blockToNodes(sub)) itemContent.push(n);
    }
  }
  return itemContent;
}

function listItemsToNodes(items: ExtractedListItem[] | undefined): PMNode[] {
  // B4a:改调核 buildListItemNode（空 item 兜底空 paragraph 收口在核）。
  if (!items || items.length === 0) return [buildListItemNode([])];
  return items.map((item) => buildListItemNode(listItemContent(item)));
}

/** B4a：task items → taskItem[]（checked 由 item 带；createdAt 用导入时刻）。 */
function taskItemsToNodes(items: ExtractedListItem[] | undefined): PMNode[] {
  const createdAt = new Date().toISOString();
  if (!items || items.length === 0) return [buildTaskItemNode(false, createdAt, [])];
  return items.map((item) =>
    buildTaskItemNode(item.checked === true, createdAt, listItemContent(item)),
  );
}

// ─── Table ─────────────────────────────────────────────────────────

function tableToNode(block: ExtractedBlock): PMNode {
  // B2:table 改调核 buildTableNode(canonical:cell inline 走核 parseInline 递归嵌套 +
  // strike、<br> 拆段、畸形零单元格行 fail-loud warn)。升级了 ① 旧的弱 parseInlineMarkdownString
  //（不支持嵌套 mark/strike/<br>）。result-parser.collectTable 已滤零单元格行,正常不返 null;
  // 万一全空(降级路径)兜底空 paragraph,不产 content:[] 空 table。
  const rows = block.tableRows || [];
  const hasHeader = block.tableHasHeader ?? true;
  const node = buildTableNode(rows, hasHeader);
  return node ?? { type: 'paragraph' };
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

function clampLevel(level: number | undefined): number {
  if (typeof level !== 'number' || level < 1) return 1;
  if (level > 6) return 6;
  return Math.floor(level);
}
