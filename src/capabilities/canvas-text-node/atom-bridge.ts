/**
 * atom-bridge — instance.doc → 序列化器 Atom[] (SVG 输入)
 *
 * V1 直迁简化(src/plugins/graph/canvas/edit/atom-bridge.ts:121 行):
 *
 * 项目里两种"Atom"概念:
 * 1. NoteView Atom(`@shared/types/atom-types`):{ id, type, content, parentId, ... }
 *    扁平存储,V1 instance.doc 字段就是这个
 * 2. 序列化器 Atom(`@lib/atom-serializers/types`):{ type, content?, attrs?, marks?, text? }
 *    嵌套 PM JSON,atomsToSvg 消费的形态
 *
 * V2 改动(路径 A,G4-2=B):
 * - instance.doc 新走 DriverSerialized(text-editing.Host onChange 直接 commit)
 *   形态:{ format:'pm-doc-json', version:'0.1', payload:{ type:'doc', content:[...] } }
 *   payload.content 就是序列化器 Atom[](同源 PM JSON children)
 * - 同时**兼容 V1 NoteView Atom[]**(走 text-editing.atomsToProseMirror 转 PM doc)
 *
 * 转换分支:
 *   DriverSerialized → payload.content(直接拆,O(1))
 *   NoteView Atom[]  → text-editing.atomsToProseMirror → PMNode[](异步)
 */

import type { Atom as SerializerAtom } from '../../lib/atom-serializers/svg';
import type { PMDocNode } from '@capabilities/text-editing/types';
// 5B Stage 6 拍板:走深路径 import(TextEditingApi 不再暴露 sanitizeAtoms /
// atomsToProseMirror 公开字段)。
// - sanitizeAtoms 归属 content-ingest capability(5B §7.1.3 单点副本)。
// - atomsToProseMirror 物理文件保留 text-editing/converters/(capability 内部工具),
//   canvas-text-node 通过深路径 import 复用 V1 Atom[] → PM doc 拼装逻辑。
// 5B Stage 7 重做(2026-05-29):V1 import 中间形态物理删, canvas-text-node 走
// V1NoteViewAtom(atoms-to-pm.ts 内部专用形态)— 同样深路径 import.
import { sanitizeAtoms } from '@capabilities/content-ingest/internal/sanitize-atoms';
import {
  atomsToProseMirror,
  type V1NoteViewAtom,
} from '@capabilities/text-editing/converters/atoms-to-pm';

/**
 * 展示态:instance.doc → 序列化器 Atom[](喂给 atomsToSvg)
 *
 * 输入空 / 形态不认 → 返回空数组,展示态显示空 mesh.
 */
export async function atomsToSvgInput(doc: unknown): Promise<SerializerAtom[]> {
  if (!doc) return [];

  // 分支 1:DriverSerialized 形态(text-editing.Host onChange 写入)
  if (isDriverSerialized(doc)) {
    const content = doc.payload?.content;
    if (!Array.isArray(content)) return [];
    return content as SerializerAtom[];
  }

  // 分支 2:V1 NoteView Atom[] 形态(向后兼容 V1 持久化)
  if (Array.isArray(doc) && doc.length > 0) {
    try {
      const sanitized = sanitizeAtoms(doc as V1NoteViewAtom[]);
      const nodes: PMDocNode[] = await atomsToProseMirror({ atoms: sanitized });
      // 滤掉硬补的 noteTitle 节点(画板节点没有 title)
      const filtered = stripNoteTitle(nodes);
      return filtered as unknown as SerializerAtom[];
    } catch (e) {
      console.warn('[canvas-text-node/atom-bridge] atomsToProseMirror failed', e);
      return [];
    }
  }

  return [];
}

/**
 * 给定一个 instance.doc(任意形态),返回 DriverSerialized.
 * 用于编辑态 enter 时把 instance.doc 转成 text-editing.Host 接受的 initial doc.
 *
 * - DriverSerialized → 剥 noteTitle 后透传(NoteView 持久化的 doc 复用到画板时
 *   可能带 isTitle,需剥;canvas-text-node 自己持久化的不带 isTitle)
 * - V1 NoteView Atom[] → 转 PMDocNode[] 后剥 noteTitle 封装
 * - 空 / 无效 → canvasEmptyDoc(paragraph isTitle:false,非 NoteView 全屏 title)
 */
export async function docToDriverSerialized(doc: unknown): Promise<unknown> {
  if (!doc) return canvasEmptyDoc();
  if (isDriverSerialized(doc)) {
    // 即使透传也剥一下 noteTitle(防 NoteView 同源 doc 复用到画板)
    const content = (doc.payload?.content ?? []) as PMDocNode[];
    const filtered = stripNoteTitle(content);
    if (filtered.length === 0) return canvasEmptyDoc();
    return {
      format: 'pm-doc-json',
      version: '0.1',
      payload: { type: 'doc', content: filtered },
    };
  }
  if (Array.isArray(doc) && doc.length > 0) {
    try {
      const sanitized = sanitizeAtoms(doc as V1NoteViewAtom[]);
      const nodes = await atomsToProseMirror({ atoms: sanitized });
      const filtered = stripNoteTitle(nodes);
      if (filtered.length === 0) return canvasEmptyDoc();
      return {
        format: 'pm-doc-json',
        version: '0.1',
        payload: { type: 'doc', content: filtered },
      };
    } catch (e) {
      console.warn('[canvas-text-node/atom-bridge] docToDriverSerialized failed', e);
      return canvasEmptyDoc();
    }
  }
  return canvasEmptyDoc();
}

/**
 * 画板文字节点的"空 doc" — 一个 isTitle=false 的空 paragraph.
 *
 * 不复用 text-editing.createEmptyDoc 因为那个版本首块 isTitle=true(NoteView 标题).
 * 画板节点没有 title 概念,首块就是普通段落.
 */
function canvasEmptyDoc(): { format: string; version: string; payload: { type: string; content: PMDocNode[] } } {
  return {
    format: 'pm-doc-json',
    version: '0.1',
    payload: {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { isTitle: false }, content: [] },
      ],
    },
  };
}

// isTextNodeRef 已删(L5-G6c 统一范式):文字 = 带 doc 的 shape,
// 消费方直接判 inst.doc !== undefined,不再有 ref === 'krig.text.label' 特判。

// ─────────────────────────────────────────────────────────
// 内部
// ─────────────────────────────────────────────────────────

interface DriverSerializedLite {
  format: string;
  version?: string;
  payload?: {
    type?: string;
    content?: unknown[];
  };
}

function isDriverSerialized(x: unknown): x is DriverSerializedLite {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return r.format === 'pm-doc-json' && typeof r.payload === 'object';
}

/**
 * 剥掉 atomsToProseMirror 硬补的 noteTitle 节点(画板节点没 title).
 * V2 schema noteTitle = paragraph(isTitle=true);非 paragraph 节点(heading 等)直接保留.
 */
function stripNoteTitle(nodes: PMDocNode[]): PMDocNode[] {
  return nodes.filter((n) => {
    if (n.type !== 'paragraph') return true;
    const isTitle = (n.attrs as { isTitle?: boolean } | undefined)?.isTitle;
    return !isTitle;
  });
}
