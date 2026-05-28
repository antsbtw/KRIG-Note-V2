/**
 * Markdown → ProseMirror JSON 转换器(V2)
 *
 * V1 来源:src/main/storage/md-to-pm.ts(行级解析,不依赖外部 Markdown 库)
 *
 * 改造路线(对应用户决议:不降级,反向驱动 schema 补齐):
 * - 输出**目标 V2 schema 节点名**,即使该节点 V2 暂未实现
 * - 缺失节点 → 输出 `{ type: 'unknown', attrs: { originalType, missing: true, raw }, ... }`
 *   占位,doc 能装,渲染时显示"暂未支持: <originalType>",**不偷偷降级丢内容**
 * - L5-B4.3.3 实测时 unknown 节点会暴露需要补的 schema 缺口,反向驱动 NoteEditor 补齐
 *
 * 节点命名约定(V2 驼峰):
 *   image / mathBlock / mathInline / fileBlock / externalRef / table / tableRow /
 *   tableHeader / tableCell
 *
 * 已实现节点(V2 schema 现成可用):
 *   paragraph / heading(level 1-6,CommonMark)/ codeBlock / blockquote / horizontalRule /
 *   bulletList > listItem / orderedList > listItem / taskList > taskItem
 *
 * 未实现节点(用 unknown 占位,触发 schema 补齐):
 *   image / mathBlock / mathInline / fileBlock / externalRef / table 系列
 *
 * mediaStore 集成:
 *   data:base64 图 / 附件 → mediaPutBase64 → media:// URL
 *   失败时占位节点 attrs.error 显示原因(不丢内容,doc 能装)
 *
 * 异步原因:base64 → mediaPutBase64 走 IPC。
 */

// W5.3:md-to-pm 通过 capability registry 间接拿 media-storage(capability 间不直 import,
// 同 view 端模式;运行时函数通过 string id 查 registry,charter § 1.2 注册原则路径)
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { MediaStorageApi } from '@capabilities/media-storage/types';

function mediaPutBase64(
  ...args: Parameters<MediaStorageApi['mediaPutBase64']>
): ReturnType<MediaStorageApi['mediaPutBase64']> {
  return requireCapabilityApi<MediaStorageApi>('media-storage').mediaPutBase64(...args);
}

interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

export type { PMNode };

/**
 * 已知节点 id 清单(给 schema 补齐工作做参考)
 *
 * 标记:
 * - ✅ V2 schema 已实现
 * - ❌ V2 schema 未实现 → 走 unknown 占位
 *
 * 升级 V2 schema 时,把对应 ❌ 改成 ✅,md-to-pm 不需要改,自动生效。
 */
export const PM_NODE_REGISTRY = {
  // block — 已实现
  paragraph: '✅',
  heading: '✅',
  codeBlock: '✅',
  blockquote: '✅',
  horizontalRule: '✅',
  bulletList: '✅',
  orderedList: '✅',
  listItem: '✅',
  taskList: '✅',
  taskItem: '✅',
  // L5-B3.5:image 已实现(NoteEditor schema 注册 imageSpec,md-to-pm 输出的
  //   `{ type: 'image', src: 'media://...', alt }` 直接渲染,无需走 unknown 占位)
  image: '✅',
  // L5-B3.6:mathBlock / mathInline 已实现(KaTeX 渲染,markdown $$...$$ / $...$
  //   产出的节点直接渲染,反向驱动证明 — md-to-pm 主体不动)
  mathBlock: '✅',
  mathInline: '✅',
  // L5-B3.7:table 系列 4 节点已实现(prosemirror-tables + 简版 NodeView,B+ 路线)
  //   markdown `| a | b |\n|---|---|\n| 1 | 2 |` 转出来的 table/tableRow/tableHeader/
  //   tableCell 节点直接渲染。Phase A 收官,反向驱动证明第三次 ✅
  table: '✅',
  tableRow: '✅',
  tableHeader: '✅',
  tableCell: '✅',
  // block — 未实现(L5-B4.3 闭环测试会触发,反向驱动补齐)
  fileBlock: '❌',
  externalRef: '❌',
} as const;

/**
 * 缺失节点占位:doc 能装,渲染时显示"暂未支持: <originalType>"
 *
 * attrs.originalType:目标节点名(如 'image' / 'mathBlock')
 * attrs.raw:原始 markdown 文本(便于调试 + 未来手动迁移)
 * attrs.error?:可选错误原因(如 mediaPutBase64 失败)
 */
function unknownNode(originalType: string, raw: string, error?: string): PMNode {
  return {
    type: 'unknown',
    attrs: {
      originalType,
      missing: true,
      raw,
      ...(error ? { error } : {}),
    },
  };
}

/**
 * Markdown → V2 PMNode[]
 *
 * 输出:V2 目标 schema 兼容的 block 节点数组(可直接塞 doc.content)。
 * 不包 doc / DriverSerialized 信封(L5-B4.3.3 包装层处理)。
 */
export async function markdownToProseMirror(md: string): Promise<PMNode[]> {
  const lines = md.split('\n');
  const content: PMNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行 → 跳过
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Code block (```) — V2 已实现
    if (line.trimStart().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      const textContent = codeLines.join('\n');
      content.push({
        type: 'codeBlock',
        attrs: lang ? { language: lang } : undefined,
        content: textContent ? [{ type: 'text', text: textContent }] : undefined,
      });
      continue;
    }

    // Math block ($$...$$) — V2 未实现 mathBlock,但输出目标节点名
    if (line.trim().startsWith('$$')) {
      const startLine = i;
      const first = line.trim().slice(2);
      const closeIdx = first.indexOf('$$');
      const buf: string[] = [];
      if (closeIdx >= 0) {
        const latex = first.slice(0, closeIdx).trim();
        if (latex) {
          content.push({
            type: 'mathBlock',
            content: [{ type: 'text', text: latex }],
          });
        }
        i++;
        continue;
      }
      if (first) buf.push(first);
      i++;
      while (i < lines.length) {
        const curr = lines[i];
        const end = curr.indexOf('$$');
        if (end >= 0) {
          const head = curr.slice(0, end).trimEnd();
          if (head) buf.push(head);
          i++;
          break;
        }
        buf.push(curr);
        i++;
      }
      const latex = buf.join('\n').trim();
      if (latex) {
        content.push({
          type: 'mathBlock',
          content: [{ type: 'text', text: latex }],
        });
      } else {
        // 罕见:`$$...$$` 但内容空
        content.push(unknownNode('mathBlock', lines.slice(startLine, i).join('\n')));
      }
      continue;
    }

    // Block-level image — V2 未实现 image,输出 image 节点(schema 补齐时直接生效)
    const imgMatch = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (imgMatch) {
      const alt = imgMatch[1] || '';
      const rawSrc = imgMatch[2];
      const resolved = await resolvePMImageSrc(rawSrc);
      if (resolved.ok && resolved.url) {
        // image schema content='block':必须含一个 caption(可空段落,paragraph)
        // alt 默认不当 caption(用户可能想自己写),空 caption 让用户后续编辑
        content.push({
          type: 'image',
          attrs: { src: resolved.url, alt },
          content: [{ type: 'paragraph' }],
        });
      } else {
        content.push(
          unknownNode('image', line, resolved.reason || 'mediaPutBase64 failed'),
        );
      }
      i++;
      continue;
    }

    // !attach[name](src) — V2 未实现 fileBlock
    const attachMatch = line.trim().match(/^!attach\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (attachMatch) {
      const filename = attachMatch[1] || 'attachment';
      const rawSrc = attachMatch[2];
      const resolved = await resolvePMAttachmentSrc(rawSrc, filename);
      content.push({
        type: 'fileBlock',
        attrs: {
          mediaId: resolved.mediaId,
          src: resolved.src,
          filename: resolved.filename,
          mimeType: resolved.mimeType,
          size: null,
          source: null,
        },
      });
      i++;
      continue;
    }

    // !file[title](path) — V2 未实现 externalRef
    const fileMatch = line.trim().match(/^!file\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (fileMatch) {
      const title = fileMatch[1] || '';
      const rawPath = fileMatch[2];
      content.push({
        type: 'externalRef',
        attrs: {
          kind: 'file',
          href: normalizePMFileHref(rawPath),
          title,
          mimeType: '',
          size: null,
          modifiedAt: null,
        },
      });
      i++;
      continue;
    }

    // Heading (# ~ ######) — V2 用 heading 节点(D2 level 1-6,CommonMark)
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      content.push({
        type: 'heading',
        attrs: { level },
        content: parseInline(headingMatch[2]),
      });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      content.push({ type: 'horizontalRule' });
      i++;
      continue;
    }

    // Blockquote
    if (line.trimStart().startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith('> ')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      const innerContent = await markdownToProseMirror(quoteLines.join('\n'));
      content.push({
        type: 'blockquote',
        content: innerContent.length > 0 ? innerContent : [{ type: 'paragraph' }],
      });
      continue;
    }

    // Task list — V2 schema:taskList > taskItem > paragraph
    if (/^\s*[-*]\s+\[([ x])\]\s/.test(line)) {
      const items: PMNode[] = [];
      while (i < lines.length && /^\s*[-*]\s+\[([ x])\]\s/.test(lines[i])) {
        const match = lines[i].match(/^\s*[-*]\s+\[([ x])\]\s(.*)/)!;
        items.push({
          type: 'taskItem',
          attrs: { checked: match[1] === 'x' },
          content: [{ type: 'paragraph', content: parseInline(match[2]) }],
        });
        i++;
      }
      content.push({ type: 'taskList', content: items });
      continue;
    }

    // Bullet list — V2 schema:bulletList > listItem > paragraph
    if (/^\s*[-*]\s+/.test(line) && !/^\s*[-*]\s+\[/.test(line)) {
      const items: PMNode[] = [];
      while (
        i < lines.length &&
        /^\s*[-*]\s+/.test(lines[i]) &&
        !/^\s*[-*]\s+\[/.test(lines[i])
      ) {
        const text = lines[i].replace(/^\s*[-*]\s+/, '');
        items.push({
          type: 'listItem',
          content: [{ type: 'paragraph', content: parseInline(text) }],
        });
        i++;
      }
      content.push({ type: 'bulletList', content: items });
      continue;
    }

    // Ordered list — V2 schema:orderedList > listItem > paragraph
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: PMNode[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const text = lines[i].replace(/^\s*\d+\.\s+/, '');
        items.push({
          type: 'listItem',
          content: [{ type: 'paragraph', content: parseInline(text) }],
        });
        i++;
      }
      content.push({ type: 'orderedList', content: items });
      continue;
    }

    // Table (| ... |) — V2 schema 已实现(L5-B3.7),直接 emit 完整嵌套结构
    if (line.trimStart().startsWith('|')) {
      const startLine = i;
      const tableRows: PMNode[] = [];
      let isFirst = true;
      while (i < lines.length && lines[i].trimStart().startsWith('|')) {
        const row = lines[i].trim();
        // Skip separator row (|---|---|)
        if (/^\|[\s\-:]+\|/.test(row) && row.includes('---')) {
          i++;
          continue;
        }
        const cells = row
          .split('|')
          .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
          .map((c) => c.trim());
        const cellType = isFirst ? 'tableHeader' : 'tableCell';
        // 默认 colwidth:V2 table CSS table-layout: fixed 需要 cell width
        // 才能算列宽,否则 fixed 退化只有第一列显示,其他列消失
        // (2026-05-28 反馈:pandoc 10 列大表只渲染序号一列)。
        // 给统一 120 px 默认值,用户可拖动 columnResizing 调整。
        const DEFAULT_COL_WIDTH = 120;
        tableRows.push({
          type: 'tableRow',
          content: cells.map((cell) => ({
            type: cellType,
            attrs: { colwidth: [DEFAULT_COL_WIDTH] },
            // cell 内允许 <br> 拆多段(2026-05-28 反馈:Word 导入硬件规格表
            //  cell 多段被压一行;word-import converter 已用 <br> 替换段间)。
            //  GFM 表格语法本身 cell 只能单行,<br> 是 V2 双方约定。
            content: splitCellOnBr(cell).map((seg) => ({
              type: 'paragraph',
              content: parseInline(seg),
            })),
          })),
        });
        isFirst = false;
        i++;
      }
      if (tableRows.length > 0) {
        content.push({ type: 'table', content: tableRows });
      } else {
        content.push(unknownNode('table', lines.slice(startLine, i).join('\n')));
      }
      continue;
    }

    // 默认 paragraph
    content.push({
      type: 'paragraph',
      content: parseInline(line),
    });
    i++;
  }

  return content;
}

/**
 * 拆 table cell 文本中的 <br> 为多段(2026-05-28 反馈)
 *
 * 容忍:<br> / <br/> / <br /> / <BR> / 大小写混合,跨多 br 视为一次切断。
 * 不命中任何 br → 返单段(保持原行为)。
 */
function splitCellOnBr(cell: string): string[] {
  const parts = cell.split(/<br\s*\/?\s*>/i).map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [cell];
}

/**
 * 解析 inline:bold / italic / code / link / inline math
 *
 * V2 已实现 marks:bold / italic / code / link / underline / strike / highlight
 * V2 未实现 inline node:mathInline → 输出 `{ type: 'mathInline', ... }`(等待 schema 补齐)
 */
function parseInline(text: string): PMNode[] {
  if (!text || !text.trim()) return [];

  const nodes: PMNode[] = [];
  const regex =
    /(\*\*([\s\S]+?)\*\*|~~([\s\S]+?)~~|\*([^\*\n]+?)\*|`([^`\n]+?)`|\[([^\]]+)\]\(([^)]+)\)|\$([^\s$][^$\n]*?[^\s$]|[^\s$])\$)/g;

  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }

    if (match[2] !== undefined) {
      nodes.push({ type: 'text', text: match[2], marks: [{ type: 'bold' }] });
    } else if (match[3] !== undefined) {
      nodes.push({ type: 'text', text: match[3], marks: [{ type: 'strike' }] });
    } else if (match[4] !== undefined) {
      nodes.push({ type: 'text', text: match[4], marks: [{ type: 'italic' }] });
    } else if (match[5] !== undefined) {
      nodes.push({ type: 'text', text: match[5], marks: [{ type: 'code' }] });
    } else if (match[6] && match[7]) {
      nodes.push({
        type: 'text',
        text: match[6],
        marks: [{ type: 'link', attrs: { href: match[7] } }],
      });
    } else if (match[8] !== undefined) {
      // V2 schema 未实现 mathInline → 输出目标节点名,等 schema 补齐
      nodes.push({ type: 'mathInline', attrs: { latex: match[8] } });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push({ type: 'text', text: text.slice(lastIndex) });
  }

  return nodes.length > 0 ? nodes : [{ type: 'text', text }];
}

/** PM image src 解析:base64 → mediaPutBase64;其他原样 */
async function resolvePMImageSrc(
  rawSrc: string,
): Promise<{ ok: boolean; url?: string; reason?: string }> {
  if (rawSrc.startsWith('data:') && rawSrc.includes(';base64,')) {
    try {
      const r = await mediaPutBase64(rawSrc);
      if (r.success && r.mediaUrl) return { ok: true, url: r.mediaUrl };
      return { ok: false, reason: r.error || 'putBase64 failed' };
    } catch (err) {
      return { ok: false, reason: String(err) };
    }
  }
  return { ok: true, url: rawSrc };
}

/** PM attachment src 解析(对齐 V1 mirror) */
async function resolvePMAttachmentSrc(
  rawSrc: string,
  filename: string,
): Promise<{ src: string; mediaId: string; filename: string; mimeType: string }> {
  if (rawSrc.startsWith('data:') && rawSrc.includes(';base64,')) {
    try {
      const mimeMatch = rawSrc.match(/^data:([^;]+);/);
      const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
      const r = await mediaPutBase64(rawSrc, mime, filename);
      if (r.success && r.mediaUrl) {
        return { src: r.mediaUrl, mediaId: r.mediaId || '', filename, mimeType: mime };
      }
    } catch {
      /* fall through */
    }
  }
  return { src: rawSrc, mediaId: '', filename, mimeType: '' };
}

/** file:// 路径 normalize(对齐 V1 mirror) */
function normalizePMFileHref(raw: string): string {
  if (raw.startsWith('file:')) return raw;
  if (raw.startsWith('/')) {
    const encoded = raw
      .split('/')
      .map((seg) => (seg ? encodeURIComponent(seg) : ''))
      .join('/');
    return `file://${encoded}`;
  }
  return raw;
}
