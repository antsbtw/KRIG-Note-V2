import type { ExtractedBlock, ExtractedInline, ExtractedListItem } from './extraction-types';

/**
 * ResultParser — parses AI response text into ExtractedBlock[].
 *
 * Converts raw markdown/plain text from AI into the same ExtractedBlock[]
 * format used by the web extraction pipeline, so we can reuse
 * createAtomsFromExtracted() directly.
 *
 * Supports:
 *   - Headings (# ~ ######)
 *   - Blockquotes (>)
 *   - Bullet / Ordered lists
 *   - Code blocks (``` ... ```)
 *   - Math blocks ($$ ... $$)
 *   - Inline: bold (**), italic (*), code (`), math ($), links
 */
export class ResultParser {
  /**
   * Parse AI response text into ExtractedBlock[].
   * Auto-detects format (markdown vs plain text).
   */
  parse(text: string): ExtractedBlock[] {
    if (!text || !text.trim()) return [];

    let trimmed = text.trim();

    // Unwrap if AI wrapped entire output in a code block (```markdown ... ```)
    const codeBlockWrapMatch = trimmed.match(/^`{3,}\s*(markdown|md|text|)\s*\n([\s\S]*?)\n`{3,}\s*$/);
    if (codeBlockWrapMatch) {
      trimmed = codeBlockWrapMatch[2].trim();
    }

    // Try JSON first
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return this.parseJsonBlocks(parsed);
        }
      } catch {
        // Not JSON, fall through to markdown
      }
    }

    // Clean ChatGPT-specific genui widget markers
    trimmed = this.cleanChatGPTWidgets(trimmed);

    // Normalize LaTeX delimiters: \[...\] → $$...$$, \(...\) → $...$
    // ChatGPT uses these while our parser expects $ delimiters
    trimmed = this.normalizeLatexDelimiters(trimmed);

    // Parse as markdown (most common AI output format)
    return this.parseMarkdown(trimmed);
  }

  /**
   * Parse markdown text into ExtractedBlock[].
   */
  private parseMarkdown(text: string): ExtractedBlock[] {
    const blocks: ExtractedBlock[] = [];
    const lines = text.split('\n');
    let i = 0;


    while (i < lines.length) {
      const line = lines[i];

      // Skip empty lines
      if (!line.trim()) {
        i++;
        continue;
      }

      // Math block: $$ ... $$ (can span multiple lines)
      // Only match if the line is purely a math block opener (no trailing text after $$...$$)
      if (line.trim().startsWith('$$')) {
        const mathResult = this.collectMathBlock(lines, i);
        if (mathResult) {
          blocks.push(mathResult.block);
          i = mathResult.nextIndex;
          continue;
        }
        // Has trailing text after $$...$$ — fall through to paragraph/splitParagraph
      }

      // Heading: # ## ### etc.
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        blocks.push({
          type: 'heading',
          tag: `h${headingMatch[1].length}`,
          text: headingMatch[2].trim(),
          headingLevel: headingMatch[1].length,
          inlines: this.parseInlineMarkdown(headingMatch[2].trim()),
        });
        i++;
        continue;
      }

      // Horizontal rule: --- or *** or ___
      if (line.trim().match(/^(-{3,}|\*{3,}|_{3,})$/)) {
        blocks.push({
          type: 'paragraph' as any,  // No 'horizontalRule' in ExtractedBlock type — use marker
          tag: 'hr',
          text: '---',
          headingLevel: 0,
        });
        i++;
        continue;
      }

      // HTML Callout: <blockquote data-callout="warning">...</blockquote>
      const calloutMatch = line.match(/^<blockquote\s+data-callout=["']([^"']+)["'][^>]*>/i);
      if (calloutMatch) {
        const calloutResult = this.collectHtmlCallout(lines, i, calloutMatch[1]);
        blocks.push(calloutResult.block);
        i = calloutResult.nextIndex;
        continue;
      }

      // Blockquote: > text (also detect GitHub-style callouts: > [!NOTE], > [!WARNING] etc.)
      const quoteMatch = line.match(/^>\s*(.*)$/);
      if (quoteMatch) {
        // Collect multi-line blockquote
        const quoteLines: string[] = [quoteMatch[1]];
        while (i + 1 < lines.length && lines[i + 1].match(/^>\s*/)) {
          i++;
          quoteLines.push(lines[i].replace(/^>\s*/, ''));
        }
        const quoteText = quoteLines.join('\n');

        // Detect GitHub-style callout: > [!NOTE], > [!WARNING], > [!TIP], etc.
        const ghCalloutMatch = quoteLines[0].match(/^\[!(\w+)\]\s*$/);
        if (ghCalloutMatch) {
          const calloutType = ghCalloutMatch[1].toLowerCase();
          const bodyText = quoteLines.slice(1).join('\n').trim();
          blocks.push({
            type: 'callout',
            tag: 'blockquote',
            text: bodyText,
            headingLevel: 0,
            inlines: this.parseInlineMarkdown(bodyText),
            calloutType,
            calloutEmoji: ResultParser.CALLOUT_EMOJI_MAP[calloutType] || '💡',
          });
          i++;
          continue;
        }

        blocks.push({
          type: 'blockquote',
          tag: 'blockquote',
          text: quoteText,
          headingLevel: 0,
          inlines: this.parseInlineMarkdown(quoteText),
        });
        i++;
        continue;
      }

      // Unordered list: - or * or +
      if (line.match(/^(\s*)[-*+]\s+(.+)$/)) {
        const listResult = this.collectList(lines, i, 'bullet');
        blocks.push({
          type: 'bulletList',
          tag: 'ul',
          text: listResult.items.map(it => it.text).join('\n'),
          headingLevel: 0,
          items: listResult.items,
        });
        i = listResult.nextIndex;
        continue;
      }

      // Ordered list: 1. 2. etc.
      if (line.match(/^(\s*)\d+\.\s+(.+)$/)) {
        const listResult = this.collectList(lines, i, 'ordered');
        blocks.push({
          type: 'orderedList',
          tag: 'ol',
          text: listResult.items.map(it => it.text).join('\n'),
          headingLevel: 0,
          items: listResult.items,
        });
        i = listResult.nextIndex;
        continue;
      }

      // Code block: ```
      if (line.trim().startsWith('```')) {
        const codeResult = this.collectCodeBlock(lines, i);
        blocks.push(codeResult.block);
        i = codeResult.nextIndex;
        continue;
      }

      // Image placeholder: <<IMAGE:pageN|标注|描述>> format
      // Note: description may contain > characters (e.g. "f(x1)>f(x2)"), so match up to the closing >>
      const angleBracketMatch = line.trim().match(/^<<IMAGE:(page\d+(?:-\d+)?)\|([^|]*)\|(.*?)>>\s*$/);
      if (angleBracketMatch) {
        const pageRef = angleBracketMatch[1]; // e.g. "page19"
        const caption = angleBracketMatch[2].trim(); // e.g. "图 1-1"
        const desc = angleBracketMatch[3].trim(); // e.g. "函数y=f(x)的图形"
        const alt = caption ? `${caption} | ${desc}` : desc;
        blocks.push(this.buildImageBlock(alt, `image:${pageRef}`));
        i++;
        continue;
      }

      // Obsidian embed: ![[videoId]] → YouTube video block (Defuddle outputs this for YouTube iframes)
      const obsidianEmbedMatch = line.trim().match(/^!\[\[([a-zA-Z0-9_-]{6,})\]\]\s*$/);
      if (obsidianEmbedMatch) {
        const videoId = obsidianEmbedMatch[1];
        blocks.push({
          type: 'video', tag: 'iframe', text: 'YouTube Video',
          headingLevel: 0,
          src: `https://www.youtube.com/watch?v=${videoId}`,
        });
        i++;
        continue;
      }

      // HTML Block: !html[title](url)
      const htmlMatch = line.trim().match(/^!html\[([^\]]*)\]\(([^)]+)\)\s*$/);
      if (htmlMatch) {
        blocks.push({
          type: 'htmlBlock',
          tag: 'div',
          text: htmlMatch[1],
          src: htmlMatch[2],
          headingLevel: 0,
        });
        i++;
        continue;
      }

      // Image: ![alt](url) or ![alt](image:pageN:xA,yB,wC,hD)
      const imageMatch = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
      if (imageMatch) {
        blocks.push(this.buildImageBlock(imageMatch[1], imageMatch[2]));
        i++;
        continue;
      }

      // Attachment: !attach[filename](src)
      const attachMatch = line.trim().match(/^!attach\[([^\]]*)\]\(([^)]+)\)\s*$/);
      if (attachMatch) {
        const filename = (attachMatch[1] || 'attachment').trim();
        const rawSrc = attachMatch[2];
        blocks.push({
          type: 'file',
          tag: 'file',
          text: filename,
          headingLevel: 0,
          src: rawSrc,
          filename,
        });
        i++;
        continue;
      }

      // HTML media tags: <iframe>, <video>, <audio>
      const mediaBlock = this.tryParseMediaTag(line.trim());
      if (mediaBlock) {
        blocks.push(mediaBlock);
        i++;
        continue;
      }

      // HTML center tag: <center>text</center> → merge as caption of preceding image block
      const centerMatch = line.trim().match(/^<center>(.*?)<\/center>$/i);
      if (centerMatch) {
        const captionText = centerMatch[1].trim();
        if (captionText) {
          // Try to attach as caption to the last image block
          const lastBlock = blocks[blocks.length - 1];
          if (lastBlock && lastBlock.type === 'image') {
            lastBlock.caption = captionText;
          } else {
            // No preceding image — emit as regular paragraph
            blocks.push({
              type: 'paragraph',
              tag: 'p',
              text: captionText,
              headingLevel: 0,
              inlines: [{ type: 'text', text: captionText }],
            });
          }
        }
        i++;
        continue;
      }

      // Markdown table: lines with | separators
      // Support both standard (| cell | cell |) and bare (cell | cell | cell) formats
      if (this.looksLikeTableRow(line.trim()) && i + 1 < lines.length && this.looksLikeTableRow(lines[i + 1].trim())) {
        const tableResult = this.collectTable(lines, i);
        if (tableResult) {
          blocks.push(tableResult.block);
          i = tableResult.nextIndex;
          continue;
        }
      }

      // Regular paragraph: collect consecutive non-empty, non-special lines
      // But split out any inline images as separate image blocks
      const paraLines: string[] = [line];
      while (i + 1 < lines.length) {
        const next = lines[i + 1];
        if (!next.trim()) break;
        if (next.match(/^#{1,6}\s/) || next.match(/^>\s/) ||
            next.match(/^[-*+]\s/) || next.match(/^\d+\.\s/) ||
            next.trim().startsWith('```') || next.trim().startsWith('$$') ||
            next.trim().match(/^!html\[([^\]]*)\]\(([^)]+)\)\s*$/) ||
            next.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/) ||
            next.trim().match(/^<<IMAGE:/) ||
            next.trim().match(/^<center>.*<\/center>$/i) ||
            this.looksLikeTableRow(next.trim()) ||
            this.isMediaTag(next.trim())) break;
        paraLines.push(next);
        i++;
      }
      const paraText = paraLines.join('\n').trim();

      // Split paragraph by embedded elements: $$math$$, inline images, <<IMAGE:...>>
      this.splitParagraph(paraText, blocks);
      i++;
    }

    return blocks;
  }

  /**
   * Build an image ExtractedBlock from alt text and raw src.
   * Parses extended syntax: image:pageN:xA,yB,wC,hD
   */
  private buildImageBlock(alt: string, rawSrc: string): ExtractedBlock {
    let src = rawSrc;
    let pageRef: number | undefined;
    let bbox: { x: number; y: number; w: number; h: number } | undefined;

    // Support both page19 and page19-19 (from {{pageRange}} template)
    const extMatch = rawSrc.match(/^image(?::page(\d+)(?:-\d+)?)?(?::x([\d.]+),y([\d.]+),w([\d.]+),h([\d.]+))?$/i);
    if (extMatch) {
      src = 'image';
      if (extMatch[1]) pageRef = parseInt(extMatch[1], 10);
      if (extMatch[2]) {
        bbox = {
          x: parseFloat(extMatch[2]),
          y: parseFloat(extMatch[3]),
          w: parseFloat(extMatch[4]),
          h: parseFloat(extMatch[5]),
        };
      }
    }

    // Extract caption from "图 1-1 | 描述" or "Figure 2 | description" format
    let caption: string | undefined;
    let cleanAlt = alt || '';
    const captionMatch = cleanAlt.match(/^(.+?)\s*\|\s*(.+)$/);
    if (captionMatch) {
      caption = captionMatch[1].trim();
      cleanAlt = captionMatch[2].trim();
    }

    return {
      type: 'image',
      tag: 'img',
      text: cleanAlt,
      headingLevel: 0,
      alt: cleanAlt || undefined,
      caption,
      src,
      pageRef,
      bbox,
    };
  }

  // ── Block collection helpers (reused by parseMarkdown + collectList) ──

  /**
   * Collect a math block starting at lineIdx.
   * Returns null if the $$ line has trailing text (embedded math — should be handled by splitParagraph).
   */
  private collectMathBlock(
    lines: string[],
    lineIdx: number,
  ): { block: ExtractedBlock; nextIndex: number } | null {
    const trimmedLine = lines[lineIdx].trim();
    const afterOpener = trimmedLine.slice(2);

    // Case 1: Single-line $$...$$ with nothing else on the line
    if (afterOpener.endsWith('$$') && afterOpener.length > 2) {
      return {
        block: { type: 'math', tag: 'div', text: afterOpener.slice(0, -2).trim(), headingLevel: 0 },
        nextIndex: lineIdx + 1,
      };
    }

    // Case 2: $$...$$ on same line — check if trailing text exists
    const embeddedMatch = afterOpener.match(/^([\s\S]*?)\$\$/);
    if (embeddedMatch) {
      const afterClose = afterOpener.slice(embeddedMatch[0].length).trim();
      if (afterClose.length > 0) {
        // Has trailing text after $$...$$ — not a standalone math block
        return null;
      }
      // $$...$$ fills the entire line
      return {
        block: { type: 'math', tag: 'div', text: embeddedMatch[1].trim(), headingLevel: 0 },
        nextIndex: lineIdx + 1,
      };
    }

    // Case 3: Multi-line math block — no closing $$ on this line
    const mathLines: string[] = [];
    if (afterOpener.trim()) mathLines.push(afterOpener);
    let j = lineIdx + 1;
    while (j < lines.length && !lines[j].trim().endsWith('$$')) {
      mathLines.push(lines[j]);
      j++;
    }
    if (j < lines.length) {
      const lastLine = lines[j].trim();
      const content = lastLine.slice(0, -2).trim();
      if (content) mathLines.push(content);
    }
    return {
      block: { type: 'math', tag: 'div', text: mathLines.join('\n'), headingLevel: 0 },
      nextIndex: j < lines.length ? j + 1 : j,
    };
  }

  /**
   * Collect a code block starting at lineIdx (``` ... ```).
   */
  private collectCodeBlock(
    lines: string[],
    lineIdx: number,
  ): { block: ExtractedBlock; nextIndex: number } {
    // Extract language and optional title from opening fence:
    // ```python  or  ```javascript title="React Counter"
    const fenceLine = lines[lineIdx].trim();
    const langMatch = fenceLine.match(/^`{3,}(\w+)/);
    const language = langMatch ? langMatch[1] : undefined;
    // title="..." attribute on the fence line
    const titleMatch = fenceLine.match(/title="([^"]+)"/);
    const codeTitle = titleMatch ? titleMatch[1] : undefined;

    const codeLines: string[] = [];
    let j = lineIdx + 1;
    while (j < lines.length && !lines[j].trim().startsWith('```')) {
      codeLines.push(lines[j]);
      j++;
    }
    if (j < lines.length) j++; // skip closing ```
    return {
      block: { type: 'code', tag: 'pre', text: codeLines.join('\n'), headingLevel: 0, language, codeTitle },
      nextIndex: j,
    };
  }

  // ── List collection with multi-line / nested block support ──

  /** Regex for matching a list item marker */
  private static ORDERED_RE = /^(\s*)\d+\.\s+(.+)$/;
  private static BULLET_RE = /^(\s*)[-*+]\s+(.+)$/;

  /**
   * Collect a list (ordered or bullet) starting at startIndex.
   * Supports multi-line list items with interleaving block elements
   * (math blocks, code blocks, images, plain text paragraphs).
   */
  private collectList(
    lines: string[],
    startIndex: number,
    listType: 'ordered' | 'bullet',
  ): { items: ExtractedListItem[]; nextIndex: number } {
    const itemRe = listType === 'ordered' ? ResultParser.ORDERED_RE : ResultParser.BULLET_RE;
    const items: ExtractedListItem[] = [];
    let i = startIndex;

    while (i < lines.length) {
      const itemMatch = lines[i].match(itemRe);
      if (!itemMatch) break;

      const itemText = itemMatch[2].trim();
      const itemBlocks: ExtractedBlock[] = [];
      i++;

      // Collect subsequent content belonging to this list item
      i = this.collectListItemContent(lines, i, itemRe, itemBlocks);

      items.push({
        text: itemText,
        inlines: this.parseInlineMarkdown(itemText),
        blocks: itemBlocks.length > 0 ? itemBlocks : undefined,
      });
    }

    return { items, nextIndex: i };
  }

  /**
   * Collect block-level content following a list item's first line.
   * Stops when it encounters the next list item or a structural element (heading, HR).
   * Returns the updated line index.
   */
  private collectListItemContent(
    lines: string[],
    startIdx: number,
    itemRe: RegExp,
    itemBlocks: ExtractedBlock[],
  ): number {
    let i = startIdx;

    while (i < lines.length) {
      // Blank line: peek ahead. If the next non-blank line is another list
      // item of the same type, consume the blank(s) and keep going. Otherwise
      // the list has ended — return and let the outer parser handle the next
      // block as a sibling (paragraph, heading, new list, etc.).
      if (!lines[i].trim()) {
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j >= lines.length) return j;
        if (!lines[j].match(itemRe)) return i;
        i = j;
        continue;
      }

      // Next list item → end current item
      if (lines[i].match(itemRe)) break;

      // Heading or HR → end entire list
      if (lines[i].match(/^#{1,6}\s/) || lines[i].trim() === '---') break;

      // $$ math block
      if (lines[i].trim().startsWith('$$')) {
        const mathResult = this.collectMathBlock(lines, i);
        if (mathResult) {
          itemBlocks.push(mathResult.block);
          i = mathResult.nextIndex;
          continue;
        }
        // Embedded math with trailing text — fall through to paragraph
      }

      // ``` code block
      if (lines[i].trim().startsWith('```')) {
        const codeResult = this.collectCodeBlock(lines, i);
        itemBlocks.push(codeResult.block);
        i = codeResult.nextIndex;
        continue;
      }

      // Image: ![alt](url)
      const imageMatch = lines[i].trim().match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
      if (imageMatch) {
        itemBlocks.push(this.buildImageBlock(imageMatch[1], imageMatch[2]));
        i++;
        continue;
      }

      // Image placeholder: <<IMAGE:...>>
      const angleBracketMatch = lines[i].trim().match(/^<<IMAGE:(page\d+(?:-\d+)?)\|([^|]*)\|(.*?)>>\s*$/);
      if (angleBracketMatch) {
        const pageRef = angleBracketMatch[1];
        const caption = angleBracketMatch[2].trim();
        const desc = angleBracketMatch[3].trim();
        const alt = caption ? `${caption} | ${desc}` : desc;
        itemBlocks.push(this.buildImageBlock(alt, `image:${pageRef}`));
        i++;
        continue;
      }

      // <center>...</center> caption
      const centerMatch = lines[i].trim().match(/^<center>(.*?)<\/center>$/i);
      if (centerMatch) {
        const captionText = centerMatch[1].trim();
        if (captionText) {
          const lastBlock = itemBlocks[itemBlocks.length - 1];
          if (lastBlock && lastBlock.type === 'image') {
            lastBlock.caption = captionText;
          } else {
            itemBlocks.push({
              type: 'paragraph', tag: 'p', text: captionText, headingLevel: 0,
              inlines: [{ type: 'text', text: captionText }],
            });
          }
        }
        i++;
        continue;
      }

      // Media tags: <iframe>, <video>, <audio>
      const mediaBlock = this.tryParseMediaTag(lines[i].trim());
      if (mediaBlock) {
        itemBlocks.push(mediaBlock);
        i++;
        continue;
      }

      // Markdown table: |...|
      if (this.looksLikeTableRow(lines[i].trim()) && i + 1 < lines.length && this.looksLikeTableRow(lines[i + 1].trim())) {
        const tableResult = this.collectTable(lines, i);
        if (tableResult) {
          itemBlocks.push(tableResult.block);
          i = tableResult.nextIndex;
          continue;
        }
      }

      // Plain text lines → paragraph sub-block
      const paraLines: string[] = [lines[i]];
      i++;
      while (i < lines.length) {
        const next = lines[i];
        if (!next.trim()) break;
        if (next.match(itemRe)) break;
        if (next.match(/^#{1,6}\s/) || next.trim() === '---') break;
        if (next.trim().startsWith('$$') || next.trim().startsWith('```')) break;
        if (next.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/)) break;
        if (next.trim().match(/^<<IMAGE:/)) break;
        if (next.trim().match(/^<center>.*<\/center>$/i)) break;
        if (this.looksLikeTableRow(next.trim())) break;
        if (this.isMediaTag(next.trim())) break;
        paraLines.push(next);
        i++;
      }
      const paraText = paraLines.join('\n').trim();
      // Use splitParagraph to handle embedded $$math$$ within text
      this.splitParagraph(paraText, itemBlocks);
    }

    return i;
  }

  /**
   * Check if a line looks like a table row (has 2+ pipe separators).
   * Supports both `| cell | cell |` and `cell | cell | cell` formats.
   */
  private looksLikeTableRow(line: string): boolean {
    if (!line) return false;
    // Must have at least 2 pipe characters (meaning 3+ cells or 2 delimiters)
    const pipeCount = (line.match(/\|/g) || []).length;
    if (pipeCount < 2) return false;
    // Separator rows: | --- | --- | or --- | --- | ---
    if (line.match(/^[\s|:-]+$/) && line.includes('---')) return true;
    // Regular row: must have text content, not just pipes
    return line.replace(/\|/g, '').trim().length > 0;
  }

  /**
   * Collect a markdown table starting at lineIdx.
   * Returns null if not a valid table (< 2 rows).
   * Supports both `| cell | cell |` and `cell | cell | cell` formats.
   */
  private collectTable(
    lines: string[],
    lineIdx: number,
  ): { block: ExtractedBlock; nextIndex: number } | null {
    const tableLines: string[] = [lines[lineIdx]];
    let j = lineIdx;
    while (j + 1 < lines.length) {
      const next = lines[j + 1].trim();
      if (!this.looksLikeTableRow(next)) break;
      tableLines.push(lines[j + 1]);
      j++;
    }
    if (tableLines.length < 2) return null;

    const rows: string[][] = [];
    let hasHeader = false;
    for (const tl of tableLines) {
      const trimmed = tl.trim();
      // Separator row: | --- | --- | or --- | --- | ---
      if (trimmed.match(/^[\s|:-]+$/) && trimmed.includes('---')) {
        hasHeader = true;
        continue;
      }
      // Parse cells — handle both | cell | cell | and cell | cell | cell
      let cells: string[];
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        cells = trimmed.split('|').slice(1, -1).map(c => c.trim());
      } else {
        cells = trimmed.split('|').map(c => c.trim());
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length === 0) return null;

    return {
      block: {
        type: 'table', tag: 'table',
        text: rows.map(r => r.join(' | ')).join('\n'),
        headingLevel: 0,
        tableRows: rows,
        tableHasHeader: hasHeader,
      },
      nextIndex: j + 1,
    };
  }

  /**
   * Split paragraph text by embedded $$math$$ blocks and inline images,
   * emitting paragraph / math / image blocks alternately.
   */
  private splitParagraph(paraText: string, blocks: ExtractedBlock[]): void {
    // Unified regex: $$...$$  |  ![alt](url)  |  <<IMAGE:...>>
    // Note: description field uses .*? (not [^>]*) because it may contain > chars
    const splitRegex = /\$\$([\s\S]*?)\$\$|!\[([^\]]*)\]\(([^)]+)\)|<<IMAGE:(page\d+(?:-\d+)?)\|([^|]*)\|(.*?)>>/g;

    let lastIdx = 0;
    let match: RegExpExecArray | null;
    let hasSpecial = false;

    while ((match = splitRegex.exec(paraText)) !== null) {
      hasSpecial = true;
      // Text before this match → paragraph
      const before = paraText.slice(lastIdx, match.index).trim();
      if (before) {
        blocks.push({
          type: 'paragraph', tag: 'p', text: before, headingLevel: 0,
          inlines: this.parseInlineMarkdown(before),
        });
      }

      if (match[1] !== undefined) {
        // $$...$$ math block embedded in paragraph
        blocks.push({
          type: 'math', tag: 'div', text: match[1].trim(), headingLevel: 0,
        });
      } else if (match[2] !== undefined) {
        // ![alt](url) image
        blocks.push(this.buildImageBlock(match[2], match[3]));
      } else if (match[4] !== undefined) {
        // <<IMAGE:pageN|caption|desc>>
        const pageRef = match[4];
        const caption = (match[5] || '').trim();
        const desc = (match[6] || '').trim();
        const alt = caption ? `${caption} | ${desc}` : desc;
        blocks.push(this.buildImageBlock(alt, `image:${pageRef}`));
      }

      lastIdx = match.index + match[0].length;
    }

    if (!hasSpecial) {
      // No embedded elements — plain paragraph
      blocks.push({
        type: 'paragraph', tag: 'p', text: paraText, headingLevel: 0,
        inlines: this.parseInlineMarkdown(paraText),
      });
      return;
    }

    // Text after last match
    const after = paraText.slice(lastIdx).trim();
    if (after) {
      blocks.push({
        type: 'paragraph', tag: 'p', text: after, headingLevel: 0,
        inlines: this.parseInlineMarkdown(after),
      });
    }
  }

  /**
   * Parse inline markdown: links, inline math ($...$), code (`...`), bold (**...**), italic (*...*).
   */
  private parseInlineMarkdown(text: string): ExtractedInline[] {
    const inlines: ExtractedInline[] = [];

    // Unified regex to match inline elements in order of appearance:
    // 1. Links: [text](url)
    // 2. Inline math: $...$ (not $$)
    // 3. Inline code: `...`
    // 4. Bold: **...**
    // 5. Italic: *...*  (single asterisk, not preceded by *)
    const inlineRegex = /\[([^\]]+)\]\(([^)]+)\)|\$([^$\n]+)\$|`([^`\n]+)`|\*\*([^*]+)\*\*|\*([^*\n]+)\*/g;

    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = inlineRegex.exec(text)) !== null) {
      // Push text before this match
      if (match.index > lastIndex) {
        inlines.push({ type: 'text', text: text.slice(lastIndex, match.index) });
      }

      if (match[1] !== undefined) {
        // Link: [text](url) — media:// hrefs become file-link
        const href = match[2];
        if (href.startsWith('media://')) {
          inlines.push({ type: 'file-link', text: match[1], href });
        } else {
          inlines.push({ type: 'link', text: match[1], href });
        }
      } else if (match[3] !== undefined) {
        // Inline math: $...$
        inlines.push({ type: 'math-inline', text: match[3] });
      } else if (match[4] !== undefined) {
        // Inline code: `...`
        inlines.push({ type: 'code-inline', text: match[4] });
      } else if (match[5] !== undefined) {
        // Bold: **...**
        inlines.push({ type: 'bold', text: match[5] });
      } else if (match[6] !== undefined) {
        // Italic: *...*
        inlines.push({ type: 'italic', text: match[6] });
      }

      lastIndex = match.index + match[0].length;
    }

    // Remaining text
    if (lastIndex < text.length) {
      inlines.push({ type: 'text', text: text.slice(lastIndex) });
    }

    if (inlines.length === 0) {
      inlines.push({ type: 'text', text });
    }

    return inlines;
  }

  /**
   * Normalize LaTeX delimiters from \(...\) and \[...\] to $...$ and $$...$$.
   * ChatGPT commonly uses the former; our parser expects the latter.
   */
  /**
   * Clean ChatGPT-specific widget markers from copied text.
   * e.g. genui{"math_block_widget_always_prefetch_v2":{"content":"y = 2x + 1"}}
   * → converts to display math $$y = 2x + 1$$
   */
  private cleanChatGPTWidgets(text: string): string {
    // ChatGPT genui markers: genui{"type":{"content":"..."}} or similar
    // Extract math content and convert to display math block
    text = text.replace(/\u2581?genui\u2581?\{.*?"content"\s*:\s*"([^"]+)".*?\}\}?\u2581?/g, (_match, content) => {
      return `\n$$\n${content}\n$$\n`;
    });
    // Remove any remaining genui markers without parseable content
    text = text.replace(/\u2581?genui\u2581?\{.*?\}\}?\u2581?/g, '');
    return text;
  }

  private normalizeLatexDelimiters(text: string): string {
    // Handle display math \[...\] → $$...$$
    // Must be done before inline to avoid \[ being partially matched
    // \[...\] can span multiple lines
    text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_match, content) => {
      return `$$\n${content.trim()}\n$$`;
    });

    // Handle inline math \(...\) → $...$
    // Should NOT span multiple lines
    text = text.replace(/\\\(([^)]*?)\\\)/g, (_match, content) => {
      return `$${content}$`;
    });

    return text;
  }

  /**
   * Parse JSON-formatted blocks (less common but some AI outputs JSON).
   */
  private parseJsonBlocks(arr: unknown[]): ExtractedBlock[] {
    return arr
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map(item => ({
        type: (item.type as ExtractedBlock['type']) || 'paragraph',
        tag: (item.tag as string) || 'p',
        text: (item.text as string) || '',
        headingLevel: (item.headingLevel as number) || 0,
        inlines: item.text ? this.parseInlineMarkdown(item.text as string) : undefined,
      }));
  }

  // ── Media tag parsing (iframe/video/audio) ──

  /** Callout type → emoji mapping */
  private static CALLOUT_EMOJI_MAP: Record<string, string> = {
    note: '📝', info: 'ℹ️', tip: '💡', hint: '💡',
    warning: '⚠️', caution: '⚠️', danger: '🔴', error: '❌',
    success: '✅', check: '✅', example: '📋', quote: '💬',
    bug: '🐛', abstract: '📄', summary: '📄', tldr: '📄',
    question: '❓', faq: '❓', failure: '❌', fail: '❌',
    important: '🔥',
  };

  /** iframe src 必须是 https:// 协议（安全性兜底，不再维护域名白名单） */
  private static isValidIframeSrc(url: string): boolean {
    return url.startsWith('https://');
  }

  /** Quick check if a line starts with a media HTML tag */
  private isMediaTag(line: string): boolean {
    return /^<(iframe|video|audio)\s/i.test(line);
  }

  /**
   * Try to parse a media HTML tag (<iframe>, <video>, <audio>) into ExtractedBlock.
   * Returns null if the line is not a recognized media tag.
   */
  private tryParseMediaTag(line: string): ExtractedBlock | null {
    // <iframe src="..." ...> → video block (https only)
    const iframeMatch = line.match(/^<iframe\s[^>]*src=["']([^"']+)["'][^>]*>/i);
    if (iframeMatch) {
      const src = iframeMatch[0];
      const url = iframeMatch[1];
      if (!ResultParser.isValidIframeSrc(url)) return null;
      const title = this.extractHtmlAttr(src, 'title') || 'Video';
      const width = this.extractHtmlAttrNum(src, 'width');
      const height = this.extractHtmlAttrNum(src, 'height');
      return {
        type: 'video', tag: 'iframe', text: title, headingLevel: 0,
        src: url, width: width || undefined, height: height || undefined,
      };
    }

    // <video src="..." ...> or <video ...><source src="...">
    const videoMatch = line.match(/^<video\s[^>]*>/i);
    if (videoMatch) {
      const tag = videoMatch[0];
      let src = this.extractHtmlAttr(tag, 'src');
      if (!src) {
        // Try <source src="..."> within the same line
        const sourceMatch = line.match(/<source\s[^>]*src=["']([^"']+)["']/i);
        if (sourceMatch) src = sourceMatch[1];
      }
      if (!src) return null;
      const title = this.extractHtmlAttr(tag, 'title') || 'Video';
      const width = this.extractHtmlAttrNum(tag, 'width');
      const height = this.extractHtmlAttrNum(tag, 'height');
      const poster = this.extractHtmlAttr(tag, 'poster') || undefined;
      const description = this.extractHtmlAttr(tag, 'data-description') || undefined;
      const author = this.extractHtmlAttr(tag, 'data-author') || undefined;
      const publishedAt = this.extractHtmlAttr(tag, 'data-published') || undefined;
      const duration = this.extractHtmlAttrNum(tag, 'data-duration') || undefined;
      const domain = this.extractHtmlAttr(tag, 'data-domain') || undefined;
      return {
        type: 'video', tag: 'video', text: title, headingLevel: 0,
        src, width: width || undefined, height: height || undefined,
        poster, description, author, publishedAt, duration, domain,
      };
    }

    // <audio src="..." ...> or <audio ...><source src="...">
    const audioMatch = line.match(/^<audio\s[^>]*>/i);
    if (audioMatch) {
      const tag = audioMatch[0];
      let src = this.extractHtmlAttr(tag, 'src');
      if (!src) {
        const sourceMatch = line.match(/<source\s[^>]*src=["']([^"']+)["']/i);
        if (sourceMatch) src = sourceMatch[1];
      }
      if (!src) return null;
      const title = this.extractHtmlAttr(tag, 'title') || 'Audio';
      return {
        type: 'audio', tag: 'audio', text: title, headingLevel: 0,
        src,
      };
    }

    return null;
  }

  /**
   * Collect an HTML callout block: <blockquote data-callout="type">...</blockquote>
   * May span multiple lines.
   */
  private collectHtmlCallout(
    lines: string[],
    startIdx: number,
    calloutType: string,
  ): { block: ExtractedBlock; nextIndex: number } {
    // Collect everything between <blockquote ...> and </blockquote>
    const contentLines: string[] = [];
    let j = startIdx;

    // Remove the opening tag from the first line
    const firstLine = lines[j].replace(/<blockquote\s[^>]*>/i, '').trim();
    // Check if closing tag is on the same line
    const closeIdx = firstLine.indexOf('</blockquote>');
    if (closeIdx >= 0) {
      const text = firstLine.slice(0, closeIdx).trim();
      if (text) contentLines.push(text);
      j++;
    } else {
      if (firstLine) contentLines.push(firstLine);
      j++;
      while (j < lines.length) {
        const line = lines[j];
        const closeMatch = line.indexOf('</blockquote>');
        if (closeMatch >= 0) {
          const before = line.slice(0, closeMatch).trim();
          if (before) contentLines.push(before);
          j++;
          break;
        }
        contentLines.push(line);
        j++;
      }
    }

    const bodyText = contentLines.join('\n').trim();
    const type = calloutType.toLowerCase();
    const emoji = ResultParser.CALLOUT_EMOJI_MAP[type] || '💡';

    return {
      block: {
        type: 'callout',
        tag: 'blockquote',
        text: bodyText,
        headingLevel: 0,
        inlines: this.parseInlineMarkdown(bodyText),
        calloutType: type,
        calloutEmoji: emoji,
      },
      nextIndex: j,
    };
  }

  /** Extract an HTML attribute value from a tag string */
  private extractHtmlAttr(tag: string, attr: string): string | null {
    const re = new RegExp(`${attr}=["']([^"']+)["']`, 'i');
    const match = tag.match(re);
    return match ? match[1] : null;
  }

  /** Extract a numeric HTML attribute value */
  private extractHtmlAttrNum(tag: string, attr: string): number | null {
    const val = this.extractHtmlAttr(tag, attr);
    if (!val) return null;
    const num = parseInt(val, 10);
    return isNaN(num) ? null : num;
  }
}
