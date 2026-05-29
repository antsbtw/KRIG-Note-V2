/**
 * Atom JSON → ProseMirror Doc JSON 转换器(L5-C6)
 *
 * 输入契约:`docs/10-business-design/ebook/PDF-Note-Atom数据契约-v2.md`
 * KRIG Knowledge Platform 后端 OCR 输出的 Atom JSON。
 *
 * 输出:V2 PM doc JSON(可直接装 doc.content 数组),封 DriverSerialized 信封后
 * 走 noteCapability.createNote / updateNote (L7-sub2:SurrealDB 持久化)。
 *
 * 13 种 Atom type 映射到 V2 schema:
 *
 * | Atom type | V2 PM node | 备注 |
 * |---|---|---|
 * | noteTitle | paragraph(attrs.isTitle=true) | 文档第一块 |
 * | heading | heading(attrs.level=1-6) | level 范围 1-6 (CommonMark) |
 * | paragraph | paragraph(attrs.isTitle=false) | 段落 |
 * | mathBlock | mathBlock(text* content) | LaTeX 装 text 子节点 |
 * | codeBlock | codeBlock(text* content + attrs.language) | code 装 text 子节点 |
 * | image | image(attrs.src + caption=paragraph) | base64 → media:// |
 * | table | table(tiptapContent 直接装载) | content 已是 PM 子树 |
 * | blockquote | blockquote(block+ content) | children → paragraph;tiptapContent → 直装 |
 * | bulletList | bulletList(listItem+ content) | flat + parentId → nested |
 * | orderedList | orderedList(listItem+ content) | 同上 |
 * | listItem | listItem(block+ content) | children → paragraph 包一层 |
 * | horizontalRule | horizontalRule | 无 content |
 * | callout | callout(block+ content,attrs.emoji + attrs.iconName) | tiptapContent 直装;D023 §4.3 iconName 可选 |
 * | columnList | unknown(V2 schema 未实现) | 留 unknown 占位 |
 *
 * InlineElement(children[] 内,kebab-case + 扁平字段)→ PM inline:
 *
 * | InlineElement | PM inline |
 * |---|---|
 * | text + marks | text + marks(直接结构对齐)|
 * | text + marks[type=bold/italic/code/...] | text + marks[type=...](V2 schema 同名)|
 * | link | (用 marks 包 text — V2 PM link 是 mark 不是 node)|
 * | math-inline + latex | mathInline + attrs.latex |
 * | code-inline | text + marks[code](契约写"code mark") |
 *
 * sanitizeAtoms 8 条容错(契约 § 9):见 sanitize-atoms.ts。
 *
 * **路径**:capability/text-editing/converters/(对齐 md-to-pm.ts 同位)。
 * **执行环境**:renderer process(view 端,跟 md-to-pm 一致)— main 不调,
 * main 把 raw atom JSON 通过 EXTRACTION_NOTE_CREATE 推给 view,view 调本转换器。
 *
 * **不依赖 PM schema**:输出纯 JSON,目标节点名按契约表;V2 schema 未实现的
 * 节点(columnList 等)走 unknown 占位,对齐 md-to-pm.ts 路线。
 */

import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { MediaStorageApi } from '@capabilities/media-storage/types';
import type { PMNode } from './md-to-pm';
import { STRUCTURAL_CONTAINER_TYPES } from '@semantic/types/structural';

export type { PMNode };

// ── Atom 输入类型(契约 § 三)──

/**
 * V1 NoteView 持久化形态 — canvas-text-node 兼容专用,**不在 V2 规范范围**.
 *
 * 上下文(2026-05-29 5B Stage 7 重做):
 *  - V1 NoteView 持久化的 doc 字面是 Array<V1NoteViewAtom>(无 atom domain 概念,
 *    扁平 + parentId 链),canvas-text-node 仍要消费此形态.
 *  - 与 V2 规范定义的 Atom<D> + AtomEntity<D> 不一致(V1 没有 domain 分类).
 *  - 仅 atoms-to-pm.ts(canvas 反向 atom → PM 拼装)+ canvas-text-node/atom-bridge.ts
 *    使用,**禁止其它代码新引用**.
 *  - 未来 V1 数据迁移完成后字面物理删除.
 */
export interface V1NoteViewAtom {
  id?: string;
  type: string;
  content?: Record<string, unknown>;
  parentId?: string;
  from?: { extractionType?: string; pdfPage?: number; extractedAt?: number };
  meta?: Record<string, unknown>;
}

interface InlineElement {
  type: string; // 'text' / 'link' / 'math-inline' / 'code-inline'
  text?: string;
  latex?: string;
  href?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  children?: InlineElement[]; // link 才有
}

function mediaPutBase64(
  ...args: Parameters<MediaStorageApi['mediaPutBase64']>
): ReturnType<MediaStorageApi['mediaPutBase64']> {
  return requireCapabilityApi<MediaStorageApi>('media-storage').mediaPutBase64(...args);
}

/** unknown 占位(契约 columnList / 未知 type 用)*/
function unknownNode(originalType: string, raw?: unknown, error?: string): PMNode {
  return {
    type: 'unknown',
    attrs: {
      originalType,
      missing: true,
      raw: typeof raw === 'string' ? raw : JSON.stringify(raw ?? null),
      ...(error ? { error } : {}),
    },
  };
}

/** 空 paragraph(占位,确保 PM doc 不空 / 容器至少一段)*/
function emptyParagraph(): PMNode {
  return { type: 'paragraph' };
}

/** 把 Atom.from 字段塞到 PMNode.attrs.from(view 端可读,以后 graph 关系可用)*/
function attachFrom(node: PMNode, from?: V1NoteViewAtom['from']): PMNode {
  if (!from) return node;
  const next: PMNode = { ...node };
  next.attrs = { ...(next.attrs ?? {}), from };
  return next;
}

// ── InlineElement → PM inline ──

function convertInline(el: InlineElement): PMNode | null {
  // 纯文本(可带 marks)
  if (el.type === 'text') {
    const text = el.text ?? '';
    if (!text) return null; // 契约 § 5.1:text 不得为空
    const node: PMNode = { type: 'text', text };
    if (el.marks && el.marks.length > 0) {
      node.marks = el.marks.map((m) => ({
        type: m.type,
        ...(m.attrs ? { attrs: m.attrs } : {}),
      }));
    }
    return node;
  }

  // link → 用 link mark 包 text(V2 link 是 mark 不是 node)
  if (el.type === 'link' && el.children) {
    // 把 children 内的 text 节点全部加 link mark
    // 多个 children 应该被渲染为一段连续文本带 link mark — 简化为取首个 text
    const inner = el.children.find((c) => c.type === 'text');
    const text = inner?.text ?? '';
    if (!text) return null;
    const linkMark = { type: 'link', attrs: { href: el.href ?? '' } };
    const existingMarks = inner?.marks ?? [];
    return {
      type: 'text',
      text,
      marks: [...existingMarks, linkMark],
    };
  }

  // math-inline → mathInline(契约 § 5.4 kebab-case in children;V2 PM 用 camelCase)
  if (el.type === 'math-inline') {
    return {
      type: 'mathInline',
      attrs: { latex: el.latex ?? '' },
    };
  }

  // code-inline(契约不直接列举,但提到 code mark — code-inline 当作 text + code mark)
  if (el.type === 'code-inline') {
    const text = el.text ?? el.latex ?? '';
    if (!text) return null;
    return {
      type: 'text',
      text,
      marks: [{ type: 'code' }],
    };
  }

  return null;
}

/** 转一组 InlineElement → PM inline content 数组,过滤 null + 空 text */
function convertInlineList(children: InlineElement[] | undefined): PMNode[] {
  if (!Array.isArray(children)) return [];
  const out: PMNode[] = [];
  for (const el of children) {
    const node = convertInline(el);
    if (node) out.push(node);
  }
  return out;
}

// ── tiptapContent 直装(契约 § 4.7 / 4.8 / 4.12 / 4.13)──

/**
 * tiptapContent 已是 PM JSON(camelCase + attrs 包裹)— 直接当 PMNode[] 装入。
 * 仅做一遍递归 sanitize:过滤空 text 节点(避免 PM schema 拒绝)。
 */
function convertTiptapContent(content: unknown): PMNode[] {
  if (!Array.isArray(content)) return [];
  return (content as PMNode[])
    .map((node) => sanitizeTiptapNode(node))
    .filter((node): node is PMNode => node !== null);
}

/**
 * V2 PM schema 节点名归一(L6 拆分后):
 * - V2 schema 原生支持 paragraph / heading 节点,tiptap-style 数据直接保留
 * - heading.level 钳到 1-6 (CommonMark 范围;旧数据可能有越界值)
 * - 其他 type 保留原样(orderedList / bulletList / listItem / table / 等)
 */
function normalizeNodeType(node: PMNode): PMNode {
  if (node.type === 'heading') {
    const rawLevel = (node.attrs as { level?: unknown } | undefined)?.level;
    const level =
      typeof rawLevel === 'number' ? Math.max(1, Math.min(6, rawLevel)) : 1;
    return {
      ...node,
      attrs: { ...(node.attrs ?? {}), level },
    };
  }
  return node;
}

function sanitizeTiptapNode(node: PMNode | undefined): PMNode | null {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'text') {
    if (!node.text) return null;
    return node;
  }

  // 归一(heading level 钳位等),再递归 content
  const normalized = normalizeNodeType(node);

  if (Array.isArray(normalized.content)) {
    const cleaned = normalized.content
      .map((c) => sanitizeTiptapNode(c))
      .filter((c): c is PMNode => c !== null);
    // 空内容容器:补占位(V2 paragraph 容器内允许空,设 content: undefined)
    if (cleaned.length === 0 && normalized.type === 'paragraph') {
      return { ...normalized, content: undefined };
    }
    return { ...normalized, content: cleaned };
  }
  return normalized;
}

// ── 单 Atom → PMNode(顶层,异步因 image 可能转 media://)──

async function convertAtom(atom: V1NoteViewAtom): Promise<PMNode | null> {
  const c = (atom.content ?? {}) as Record<string, unknown>;

  switch (atom.type) {
    // 4.1 noteTitle → paragraph(attrs.isTitle=true)
    case 'noteTitle': {
      const inline = convertInlineList(c.children as InlineElement[] | undefined);
      const node: PMNode = {
        type: 'paragraph',
        attrs: { isTitle: true },
        content: inline.length > 0 ? inline : undefined,
      };
      return attachFrom(node, atom.from);
    }

    // 4.2 heading → heading(attrs.level=1-6,CommonMark)
    case 'heading': {
      const level = typeof c.level === 'number' ? Math.max(1, Math.min(6, c.level)) : 1;
      const inline = convertInlineList(c.children as InlineElement[] | undefined);
      return attachFrom(
        {
          type: 'heading',
          attrs: { level },
          content: inline.length > 0 ? inline : undefined,
        },
        atom.from,
      );
    }

    // 4.3 paragraph → paragraph(attrs.isTitle=false)
    case 'paragraph': {
      const inline = convertInlineList(c.children as InlineElement[] | undefined);
      return attachFrom(
        {
          type: 'paragraph',
          attrs: { isTitle: false },
          content: inline.length > 0 ? inline : undefined,
        },
        atom.from,
      );
    }

    // 4.4 mathBlock → mathBlock(content text*,latex 装 text 子节点)
    case 'mathBlock': {
      const latex = (c.latex as string) ?? '';
      return attachFrom(
        {
          type: 'mathBlock',
          content: latex ? [{ type: 'text', text: latex }] : undefined,
        },
        atom.from,
      );
    }

    // 4.5 codeBlock → codeBlock(content text*,code 装 text 子节点)
    case 'codeBlock': {
      const code = (c.code as string) ?? '';
      const language = (c.language as string) ?? '';
      return attachFrom(
        {
          type: 'codeBlock',
          attrs: language ? { language } : undefined,
          content: code ? [{ type: 'text', text: code }] : undefined,
        },
        atom.from,
      );
    }

    // 4.6 image → image(content paragraph caption;src 走 mediaPutBase64)
    case 'image': {
      const rawSrc = (c.src as string) ?? '';
      const alt = (c.alt as string) ?? '';
      const captionText = (c.caption as string) ?? '';

      let resolvedSrc = rawSrc;
      // base64 → media:// (对齐 md-to-pm 模式)
      if (rawSrc.startsWith('data:')) {
        try {
          const result = await mediaPutBase64(rawSrc, undefined, alt || 'extracted-image');
          if (result.success && result.mediaUrl) {
            resolvedSrc = result.mediaUrl;
          } else {
            return unknownNode('image', rawSrc, result.error || 'mediaPutBase64 failed');
          }
        } catch (err) {
          return unknownNode('image', rawSrc, String(err));
        }
      }

      // caption(可空)
      const caption: PMNode = captionText
        ? {
            type: 'paragraph',
            content: [{ type: 'text', text: captionText }],
          }
        : { type: 'paragraph' };

      return attachFrom(
        {
          type: 'image',
          attrs: { src: resolvedSrc, alt },
          content: [caption],
        },
        atom.from,
      );
    }

    // 4.7 table → table(tiptapContent 直接装)
    case 'table': {
      const tiptap = convertTiptapContent(c.tiptapContent);
      if (tiptap.length === 0) return unknownNode('table', atom, 'no tiptapContent');
      return attachFrom({ type: 'table', content: tiptap }, atom.from);
    }

    // 4.8 blockquote → blockquote(content block+)
    case 'blockquote': {
      // 支持两种 content:children(单段)或 tiptapContent(多段)
      if (Array.isArray(c.tiptapContent)) {
        const inner = convertTiptapContent(c.tiptapContent);
        return attachFrom(
          {
            type: 'blockquote',
            content: inner.length > 0 ? inner : [emptyParagraph()],
          },
          atom.from,
        );
      }
      const inline = convertInlineList(c.children as InlineElement[] | undefined);
      return attachFrom(
        {
          type: 'blockquote',
          content: [
            {
              type: 'paragraph',
              content: inline.length > 0 ? inline : undefined,
            },
          ],
        },
        atom.from,
      );
    }

    // 4.9 bulletList / orderedList → list 容器(content listItem+);listItem 由 tree 阶段填充
    case 'bulletList':
      return attachFrom({ type: 'bulletList', content: [] }, atom.from);
    case 'orderedList':
      return attachFrom({ type: 'orderedList', content: [] }, atom.from);

    // 4.10 listItem → listItem(content block+,把 children 包成 paragraph)
    case 'listItem': {
      const inline = convertInlineList(c.children as InlineElement[] | undefined);
      return attachFrom(
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: inline.length > 0 ? inline : undefined,
            },
          ],
        },
        atom.from,
      );
    }

    // 4.11 horizontalRule
    case 'horizontalRule':
      return attachFrom({ type: 'horizontalRule' }, atom.from);

    // 4.12 callout → callout(attrs.emoji + iconName + imageSrc + content block+)
    // D023 §4.3: iconName 字面可选,旧 atom 字面无该字段时 ?? null 兜底,
    // PM schema default null 字面再次兜底(双层保险)。
    // D024 §4.3: imageSrc 字面可选,同上双层兜底。
    case 'callout': {
      const emoji = (c.emoji as string) ?? '💡';
      const iconName = (c.iconName as string | null | undefined) ?? null;
      const imageSrc = (c.imageSrc as string | null | undefined) ?? null;
      const inner = convertTiptapContent(c.tiptapContent);
      return attachFrom(
        {
          type: 'callout',
          attrs: { emoji, iconName, imageSrc },
          content: inner.length > 0 ? inner : [emptyParagraph()],
        },
        atom.from,
      );
    }

    // 4.13 columnList → V2 schema 已实现(columnList + column 两层)
    // V1 atom 把 column 内容存在 tiptapContent(契约 § 4.13 直装路径);
    // tiptapContent 顶层是 column 节点数组,每个 column 内 content 已是 PM JSON。
    case 'columnList': {
      const columns = ((c as { columns?: unknown }).columns as number) || 2;
      const tiptap = convertTiptapContent(c.tiptapContent);
      // 过滤出 type='column' 的子节点(防御:跳过其他 noise)
      const columnNodes = tiptap.filter((n): n is PMNode => n.type === 'column');
      if (columnNodes.length < 2) {
        // schema 强约束 column{2,3};不足时 unknown 占位避免 PM 拒绝整 doc
        return unknownNode('columnList', atom, 'column count < 2');
      }
      // 钳到 [2,3](schema 上限);超出截断 + warn
      const kept = columnNodes.slice(0, 3);
      // 每个 column 必须有 content(空 column 补 emptyParagraph,对齐 column.content='block+')
      const safeColumns = kept.map((col) => {
        if (!Array.isArray(col.content) || col.content.length === 0) {
          return { ...col, content: [emptyParagraph()] };
        }
        return col;
      });
      return attachFrom(
        {
          type: 'columnList',
          attrs: { columns: Math.min(Math.max(columns, 2), 3) },
          content: safeColumns,
        },
        atom.from,
      );
    }

    default:
      return unknownNode(atom.type, atom, 'unknown atom type');
  }
}

// ── List tree builder(flat + parentId → nested)──

/**
 * 把 flat Atom[] 中的 listItem 按 parentId 收拢到对应的 list 容器内。
 *
 * 算法:
 * 1. 第一遍:转所有 atom → PM,留一份 atom→pmNode 映射 + 顺序数组
 * 2. 第二遍:对每个 listItem(原 atom 有 parentId 指向 list 容器),把转好的
 *    PM listItem 节点 push 进对应 list 容器的 content;并标记 listItem 自己
 *    "已被吞并",从顶层结果中移除
 * 3. 最后:list 容器的 content 不为空才保留(空 list 是非法 PM)
 */
async function buildTopLevelNodes(atoms: V1NoteViewAtom[]): Promise<PMNode[]> {
  // pass 1:转换全部 atom
  const converted: Array<{
    atom: V1NoteViewAtom;
    node: PMNode | null;
    consumed: boolean;
  }> = [];
  for (const atom of atoms) {
    const node = await convertAtom(atom);
    converted.push({ atom, node, consumed: false });
  }

  // 索引:atom.id → 转换条目(给 list parent 查找用)
  const idToEntry = new Map<string, (typeof converted)[number]>();
  for (const entry of converted) {
    if (entry.atom.id) idToEntry.set(entry.atom.id, entry);
  }

  // pass 2:listItem 收拢
  for (const entry of converted) {
    if (entry.atom.type !== 'listItem') continue;
    const parentId = entry.atom.parentId;
    if (!parentId || !entry.node) continue;
    const parent = idToEntry.get(parentId);
    if (
      !parent ||
      !parent.node ||
      (parent.atom.type !== 'bulletList' && parent.atom.type !== 'orderedList')
    ) {
      continue; // 无效 parentId,留 listItem 在顶层(后续被过滤为非法节点)
    }
    if (!parent.node.content) parent.node.content = [];
    parent.node.content.push(entry.node);
    entry.consumed = true;
  }

  // pass 3:收集顶层结果(过滤已 consumed 的 listItem + null + 空 list 容器)
  const result: PMNode[] = [];
  for (const entry of converted) {
    if (entry.consumed || !entry.node) continue;
    if (entry.node.type === 'bulletList' || entry.node.type === 'orderedList') {
      // 空 list 容器跳过(PM schema content listItem+ 不允许空)
      if (!entry.node.content || entry.node.content.length === 0) continue;
    }
    result.push(entry.node);
  }
  return result;
}

// ── 公开 API ──

export interface AtomsToPmInput {
  /** 单页或多页合并的 atom 数组(已 sanitize)*/
  atoms: V1NoteViewAtom[];
}

/**
 * Atom JSON → PM doc content 数组。
 *
 * 输出可直接装 doc.content(再封 DriverSerialized 信封):
 *   { format: 'pm-doc-json', version: '0.1', payload: { type: 'doc', content: 输出 } }
 *
 * 输出至少含一个 block(空文档兜底加 paragraph)。
 */
export async function atomsToProseMirror(input: AtomsToPmInput): Promise<PMNode[]> {
  const nodes = await buildTopLevelNodes(input.atoms);
  if (nodes.length === 0) return [emptyParagraph()];
  return nodes.map(ensureBlockAttrIdField);
}

/**
 * 把 PM JSON node 树字面归一化:对每个**非结构性 + 非 inline** block 节点
 * ensure `attrs.id` 字段存在(值仍为 null,由 injectIdsForCreate / buildAutoBlockIdPlugin
 * 字面填充真 ULID)。
 *
 * 历史 bug(2026-05-21 PDF extraction 导入触发):
 * - convertAtom 字面手工拼 PM JSON,部分 case(listItem / blockquote / horizontalRule
 *   / mathBlock 等)不给 attrs 字段。
 * - dissect-pm-doc 字面用 `'id' in attrs` 判定该 node 是否"该生成 atom",
 *   attrs 不存在 / id 字段不存在 → false → 整个 block 字面**被跳过不写 storage**。
 * - 结果:extraction 导入完 createNote 成功(因 dissect 跳过所有 block),
 *   storage 字面只有 container atom,**全部内容字面丢失**;
 *   renderer 端 PM schema load doc 时用默认值补 attrs.id = null → 用户编辑触发
 *   updateNote → dissect 此时 'id' in attrs = true → 取值 null → throw。
 *
 * 修复:atomsToProseMirror 字面在出口归一化 — 给所有应有 id 的 block 加 `attrs.id: null`
 * 占位,字面对齐 PM schema load 默认值行为。
 *
 * 与 plugin / capability injectIdsForCreate / dissect shouldGenerateAtom 同源,
 * 共同遵循 decision 026 §3.1.3 字面拍板(STRUCTURAL_CONTAINER_TYPES + inline 类型外的全部 block)。
 */
// 5B §7.3.1 拍板: STRUCTURAL_CONTAINER_TYPES 收敛到 semantic 层单点 export
// (本文件顶部 import). 5A 拍板 table 是 atom -> 集合从 6 项降为 5 项;
// atomsToProseMirror 归一化字面会给 table 也补 attrs.id 占位
// (table.spec.attrs 已加 id 字段, 5B Stage 1 S1.3.1).
// 5B §节 4 Stage 6 字面规划: 本文件未来会迁到 content-ingest capability;
// 本 Stage 不迁移, 先就地改 import. Stage 6 移路径后 import 仍然有效.

/**
 * inline 节点类型(group='inline')— 字面无 attrs.id 字段,不归一化。
 * 来源:driver/blocks 各 spec.ts 中 group:'inline' 或字面用在 mark/inline 位置的类型。
 */
const INLINE_TYPES = new Set([
  'text',
  'hardBreak',
  'fileLink',
  'noteLink',
  'mathInline',
]);

function ensureBlockAttrIdField(node: PMNode): PMNode {
  const out: PMNode = { ...node };
  if (Array.isArray(node.content)) {
    out.content = node.content.map(ensureBlockAttrIdField);
  }
  if (!STRUCTURAL_CONTAINER_TYPES.has(node.type) && !INLINE_TYPES.has(node.type)) {
    const attrs = out.attrs ?? {};
    if (!('id' in attrs)) {
      out.attrs = { ...attrs, id: null };
    }
  }
  return out;
}
