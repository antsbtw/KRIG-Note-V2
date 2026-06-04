/**
 * draft-builders 形态验证(Stage 1 spike 的非交互替身)
 *
 * 验证 image/video/audio block 的 PmAtomDraft 经 createNotesBatch → assemble-pm-doc
 * 拼回后,能通过 PM Schema 校验(即 NoteView 打开时 PMNode.fromJSON().check() 不崩)。
 *
 * 关键点(本测试要守的硬约束):
 *   - image  content:'block?'  → 叶子可无 caption
 *   - video  content:'block'   → **必须 1 个 caption block**,缺则 schema 校验崩
 *   - audio  content:'block'   → 同 video
 *
 * 本测试用 inline NodeSpec 复刻三种 block 的 schema 相关字段(content/group/attrs),
 * 不 import 真 spec.ts(后者拉 DOM node-view,node 测试环境跑不动);并用真
 * draft-builders + 真 assemble 算法(childOf 边 → content 展开)拼 doc。
 */

import { describe, it, expect } from 'vitest';
import { Schema, Node as PMNode, type NodeSpec } from 'prosemirror-model';
import type { PmAtomDraft, PmPayload, AtomFrom } from '@semantic/types';
import {
  buildImageBlockDraft,
  buildVideoBlockDrafts,
  buildAudioBlockDrafts,
} from '@capabilities/content-extraction/internal/draft-builders';

// ── inline schema:复刻三种 block + paragraph/doc/text 的 schema 相关字段 ──
const baseBlockAttrs = (extra: Record<string, { default: unknown }>): NodeSpec['attrs'] => ({
  indent: { default: 0 },
  frameThoughtId: { default: null },
  frameColor: { default: null },
  frameStyle: { default: null },
  frameGroupId: { default: null },
  ...extra,
});

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      attrs: baseBlockAttrs({ isTitle: { default: false } }),
    },
    image: {
      group: 'block',
      content: 'block?',
      attrs: baseBlockAttrs({
        src: { default: null }, alt: { default: '' }, title: { default: '' },
        width: { default: null }, height: { default: null }, alignment: { default: 'center' },
        id: { default: null }, sourcePages: { default: null },
        thoughtId: { default: null }, bookAnchor: { default: null },
      }),
    },
    videoBlock: {
      group: 'block',
      content: 'block',
      attrs: baseBlockAttrs({
        src: { default: null }, embedType: { default: null }, title: { default: 'Video' },
        mimeType: { default: null }, duration: { default: null }, id: { default: null },
        activeTab: { default: 'play' }, transcriptText: { default: null },
        translationTexts: { default: null }, segmentDuration: { default: 60 },
        memoryLastStep: { default: 0 }, localFilePath: { default: null }, bookAnchor: { default: null },
      }),
    },
    audioBlock: {
      group: 'block',
      content: 'block',
      attrs: baseBlockAttrs({
        src: { default: null }, title: { default: 'Audio' }, mimeType: { default: null },
        duration: { default: null }, id: { default: null }, bookAnchor: { default: null },
      }),
    },
  },
});

/**
 * 模拟 assemble-pm-doc:顶层 draft(无 parentTmpId)→ doc.content;
 * 子 draft(有 parentTmpId)→ 挂到父的 content。复刻 buildPmNode 的 childOf 展开。
 */
function assembleDocJSON(atoms: PmAtomDraft[]): unknown {
  const byTmp = new Map<string, PmAtomDraft>();
  const childrenOf = new Map<string, PmAtomDraft[]>();
  for (const a of atoms) {
    byTmp.set(a.tmpId, a);
    if (a.parentTmpId) {
      if (!childrenOf.has(a.parentTmpId)) childrenOf.set(a.parentTmpId, []);
      childrenOf.get(a.parentTmpId)!.push(a);
    }
  }
  const toNode = (draft: PmAtomDraft): PmPayload => {
    const p = draft.payload.payload;
    const kids = childrenOf.get(draft.tmpId) ?? [];
    const content = kids.length > 0 ? kids.map(toNode) : (p.content ?? []);
    const node: PmPayload = { type: p.type };
    if (p.attrs) node.attrs = p.attrs;
    if (p.text !== undefined) node.text = p.text;
    if (p.marks) node.marks = p.marks;
    if (content.length > 0 || p.type !== 'text') node.content = content;
    return node;
  };
  const top = atoms.filter((a) => !a.parentTmpId);
  return { type: 'doc', content: top.map(toNode) };
}

const from: AtomFrom = { extractionType: 'web-clip-test', extractedAt: 0 };

describe('content-extraction draft-builders', () => {
  it('image draft assembles to a schema-valid doc (no caption needed)', () => {
    let n = 0;
    const alloc = (): string => `tmp-${n++}`;
    const atoms = [buildImageBlockDraft({ src: 'https://x/y.jpg', alt: 'a' }, alloc, from)];
    const docJSON = assembleDocJSON(atoms);
    const doc = PMNode.fromJSON(schema, docJSON as Parameters<typeof PMNode.fromJSON>[1]);
    expect(() => doc.check()).not.toThrow();
    expect(doc.firstChild?.type.name).toBe('image');
    expect(doc.firstChild?.attrs.src).toBe('https://x/y.jpg');
  });

  it('video draft assembles WITH required caption → schema-valid', () => {
    let n = 0;
    const alloc = (): string => `tmp-${n++}`;
    const atoms = buildVideoBlockDrafts(
      { src: 'https://youtube.com/watch?v=x', embedType: 'youtube', transcriptText: '[]' },
      alloc, from,
    );
    expect(atoms.length).toBe(2); // block + caption
    expect(atoms[1].parentTmpId).toBe(atoms[0].tmpId);
    const doc = PMNode.fromJSON(schema, assembleDocJSON(atoms) as Parameters<typeof PMNode.fromJSON>[1]);
    expect(() => doc.check()).not.toThrow();
    const video = doc.firstChild!;
    expect(video.type.name).toBe('videoBlock');
    expect(video.childCount).toBe(1); // caption paragraph
    expect(video.attrs.transcriptText).toBe('[]');
  });

  it('audio draft assembles WITH required caption → schema-valid', () => {
    let n = 0;
    const alloc = (): string => `tmp-${n++}`;
    const atoms = buildAudioBlockDrafts({ src: 'https://x/y.ogg', title: 'A' }, alloc, from);
    expect(atoms.length).toBe(2);
    const doc = PMNode.fromJSON(schema, assembleDocJSON(atoms) as Parameters<typeof PMNode.fromJSON>[1]);
    expect(() => doc.check()).not.toThrow();
    expect(doc.firstChild?.type.name).toBe('audioBlock');
    expect(doc.firstChild?.childCount).toBe(1);
  });

  it('CONTROL: a video block WITHOUT caption fails schema check (proves caption is required)', () => {
    // 反证:手搓一个无 caption 的 videoBlock,doc.check() 必须抛 —— 证明 caption 子 draft 非冗余
    const bad = { type: 'doc', content: [{ type: 'videoBlock', attrs: {}, content: [] }] };
    expect(() =>
      PMNode.fromJSON(schema, bad as Parameters<typeof PMNode.fromJSON>[1]).check(),
    ).toThrow();
  });

  it('full mix (title + paragraph + image + video + audio) assembles valid', () => {
    let n = 0;
    const alloc = (): string => `tmp-${n++}`;
    const atoms: PmAtomDraft[] = [
      { tmpId: alloc(), payload: { domain: 'pm', payload: { type: 'paragraph', attrs: { isTitle: true }, content: [{ type: 'text', text: 'T' }] } }, from },
      { tmpId: alloc(), payload: { domain: 'pm', payload: { type: 'paragraph', attrs: {}, content: [{ type: 'text', text: 'body' }] } }, from },
      buildImageBlockDraft({ src: 'https://x/y.jpg' }, alloc, from),
      ...buildVideoBlockDrafts({ src: 'https://youtube.com/watch?v=x', embedType: 'youtube' }, alloc, from),
      ...buildAudioBlockDrafts({ src: 'https://x/y.ogg' }, alloc, from),
    ];
    const doc = PMNode.fromJSON(schema, assembleDocJSON(atoms) as Parameters<typeof PMNode.fromJSON>[1]);
    expect(() => doc.check()).not.toThrow();
    const types = [] as string[];
    doc.forEach((c) => types.push(c.type.name));
    expect(types).toEqual(['paragraph', 'paragraph', 'image', 'videoBlock', 'audioBlock']);
  });
});
