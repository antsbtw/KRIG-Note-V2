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
// 阶段 B1:heading/paragraph/hr/codeBlock(fence)/mathBlock/inline 改调唯一解析核
// markdown-core。② 保留自己的行级 loop + 媒体本地化外壳,非 B1 block(image/list/
// table/blockquote/attach…)仍走本文件旧逻辑,B2–B4 再逐类迁核。
import {
  parseInline as coreParseInline,
  buildHeadingNode,
  buildMathBlockNode,
  tryParseCodeBlock,
  buildTableNode,
  buildCalloutNode,
  calloutEmojiFor,
} from '@shared/markdown-core';

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

    // Code block (```) — B1:改调唯一解析核 markdown-core.tryParseCodeBlock。
    // fence 长度配对规则(嵌套 fence + 闭栏带残留两个坑)固化在核 fence.ts 内。
    const code = tryParseCodeBlock(lines, i);
    if (code) {
      content.push(code.node);
      i = code.nextIndex;
      continue;
    }

    // Math block ($$...$$) — B1:mathBlock 节点走核 buildMathBlockNode(canonical),
    // 但 $$ 边界扫描保留 ② 本地逻辑(空内容降级 unknownNode 是 ② 外壳的兜底,非核职责)。
    if (line.trim().startsWith('$$')) {
      const startLine = i;
      const first = line.trim().slice(2);
      const closeIdx = first.indexOf('$$');
      const buf: string[] = [];
      if (closeIdx >= 0) {
        const latex = first.slice(0, closeIdx).trim();
        if (latex) {
          content.push(buildMathBlockNode(latex));
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
        content.push(buildMathBlockNode(latex));
      } else {
        // 罕见:`$$...$$` 但内容空
        content.push(unknownNode('mathBlock', lines.slice(startLine, i).join('\n')));
      }
      continue;
    }

    // Block-level 链接图片 [![alt](img)](url) — 列表/卡片页常见(WSJ 栏目页等),
    // 一张可点击封面图。V2 image schema 无 link attr → 输出 image 节点(丢外层链接,
    // 图片是剪藏的主体)。必须在裸 block-image 之前判,否则 ![ 不匹配 [ 开头会落到
    // 默认 paragraph → parseInline 的链接正则被 [ ] ( ) 嵌套打乱产出断裂 ](url)。
    const linkedImg = line.trim().match(/^\[!\[([^\]]*)\]\(([^)]+)\)\]\(([^)]+)\)\s*$/);
    if (linkedImg) {
      const alt = linkedImg[1] || '';
      const rawSrc = linkedImg[2];
      const resolved = await resolvePMImageSrc(rawSrc);
      if (resolved.ok && resolved.url) {
        content.push({
          type: 'image',
          attrs: { src: resolved.url, alt },
          content: [{ type: 'paragraph' }],
        });
      } else {
        content.push(unknownNode('image', line, resolved.reason || 'mediaPutBase64 failed'));
      }
      i++;
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

    // Heading (# ~ ######) — B1:改调核 buildHeadingNode(canonical inline)
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      content.push(buildHeadingNode(headingMatch[1].length, headingMatch[2]));
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      content.push({ type: 'horizontalRule' });
      i++;
      continue;
    }

    // Blockquote（含 GitHub-style callout `> [!NOTE]` 识别）
    if (line.trimStart().startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith('> ')) {
        // 剥引用前缀:检测用 trimStart() 容忍行首缩进(如列表内 `   > 权衡…`),
        // 剥离也必须同样容忍前导空白 —— 否则锚在 col0 的 /^>\s?/ 对缩进行剥不掉,
        // 递归 markdownToProseMirror 会再判成 blockquote → 无限递归 → 栈溢出 →
        // markdownToAtoms 吞成 warning 产空 note(2026-06-30 relay-design-v2.md 导入空白根因)。
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      // B2:GitHub alert `> [!NOTE]`/`> [!WARNING]`… 首行单独一个 `[!TYPE]` → callout
      //（改调核 buildCalloutNode + calloutEmojiFor）。② 以前当普通 blockquote,现在认 callout
      // 是新增能力(非回归)。首行不是 alert 标记则仍走 blockquote(原行为不变)。
      const ghCalloutMatch = quoteLines[0]?.match(/^\[!(\w+)\]\s*$/);
      if (ghCalloutMatch) {
        const bodyText = quoteLines.slice(1).join('\n').trim();
        content.push(buildCalloutNode(calloutEmojiFor(ghCalloutMatch[1]), bodyText));
        continue;
      }
      const innerContent = await markdownToProseMirror(quoteLines.join('\n'));
      content.push({
        type: 'blockquote',
        content: innerContent.length > 0 ? innerContent : [{ type: 'paragraph' }],
      });
      continue;
    }

    // Task list — V2 schema:taskList > taskItem > paragraph
    // taskItem attrs.createdAt 字面持久化:不给的话 NodeView mount 时会自动补
    // (queueMicrotask + dispatch),导入 N 个 taskItem 会触发 N 次 IPC 引发 OCC 风暴。
    // 用导入时刻作为 createdAt(markdown 文件无创建时间字段;若未来上溯 ScannedFile.mtime
    // 可更准确,本期沿用导入时刻足够)。
    if (/^\s*[-*]\s+\[([ x])\]\s/.test(line)) {
      const items: PMNode[] = [];
      const createdAt = new Date().toISOString();
      while (i < lines.length && /^\s*[-*]\s+\[([ x])\]\s/.test(lines[i])) {
        const match = lines[i].match(/^\s*[-*]\s+\[([ x])\]\s(.*)/)!;
        items.push({
          type: 'taskItem',
          attrs: { checked: match[1] === 'x', createdAt },
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

    // Table (| ... |) — B2:cell → PM 结构改调唯一解析核 buildTableNode(canonical:
    // cell inline 走核 parseInline 递归嵌套 + strike、<br> 拆段、畸形零单元格行 fail-loud
    // warn、colwidth 留 null 由 NodeView 均分)。② 只保留行级定位(收集 `|` 行 + 跳分隔行 +
    // 切 cell),把 string[][] 交核构造;空 table 降级 unknown 仍是 ② 外壳兜底。
    if (line.trimStart().startsWith('|')) {
      const startLine = i;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trimStart().startsWith('|')) {
        const row = lines[i].trim();
        // Skip separator row (|---|---|)
        if (/^\|[\s\-:]+\|/.test(row) && row.includes('---')) {
          i++;
          continue;
        }
        rows.push(
          row
            .split('|')
            .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
            .map((c) => c.trim()),
        );
        i++;
      }
      // ② 历史语义:首个非分隔行恒为 header(hasHeader=true);buildTableNode 内做
      // 零单元格行 fail-loud warn + 跳过,全跳空则返 null → 降级 unknown(不产空 table)。
      const tableNode = buildTableNode(rows, true);
      if (tableNode) {
        content.push(tableNode);
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
 * 解析 inline:bold / italic / strike / code / link / inline math
 *
 * B1:实现已上收到唯一解析核 `@shared/markdown-core`(递归 mark 嵌套 + strike),
 * 本文件保留同名薄封装,call site(paragraph/list/task/table cell)不变。
 */
function parseInline(text: string): PMNode[] {
  return coreParseInline(text) as PMNode[];
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
