/**
 * ⭐⭐ 节点 = 标题 + 它的正文(规格 03 §5.5,用户 2026-09-10 拍板)
 *
 * 用户原话:「主题框可以映射多个 block,首行取自 hn,第二行以后,取自正文或其他。
 * 要默认它作为一个整体才行。」
 *
 * ⚠️ 这些断言**先于实现写**:本节最容易错的是「往返不收敛」——
 * 反向若把正文也当层级 emit,再正向读回来节点会一轮轮增殖。
 */
import { describe, it, expect } from 'vitest';
import { noteDocToTree, treeToNoteDoc } from '@capabilities/diglot-model/note-projection';

const doc = (blocks: unknown[]): unknown => ({
  format: 'pm-doc-json',
  version: '0.1',
  payload: { type: 'doc', content: blocks },
});
const h = (level: number, id: string, text: string): unknown => ({
  type: 'heading',
  attrs: { level, id },
  content: [{ type: 'text', text }],
});
const p = (id: string, text: string, indent?: number): unknown => ({
  type: 'paragraph',
  attrs: { id, ...(indent !== undefined ? { indent } : {}) },
  content: [{ type: 'text', text }],
});
const math = (id: string, latex: string): unknown => ({
  type: 'paragraph',
  attrs: { id },
  content: [{ type: 'mathInline', attrs: { latex } }],
});

/** 一个节点 content 里的块数 */
const blocksOf = (n: { content: unknown }): unknown[] =>
  ((n.content as { payload: { content: unknown[] } }).payload.content ?? []);

describe('节点 = 标题 + 它的正文', () => {
  it('⭐⭐ 标题后紧跟的无 indent 段落**并入该节点**,不再另开一个', () => {
    const s = noteDocToTree(doc([h(1, 'h1', '主题'), h(2, 'h2', '主题2'), math('p1', 'x^2+2')]));
    // 旧行为是 3 个节点(公式自成一个)—— 现在必须是 2 个
    expect(s.nodes.map((n) => n.id)).toEqual(['h1', 'h2']);
  });

  it('⭐ 并进来的正文**在第 2 块**,标题仍是首块', () => {
    const s = noteDocToTree(doc([h(2, 'h2', '主题2'), math('p1', 'x^2+2')]));
    const blocks = blocksOf(s.nodes[0]) as { content?: { type: string }[] }[];
    expect(blocks.length).toBe(2);
    expect(blocks[0].content?.[0]).toMatchObject({ type: 'text', text: '主题2' });
    expect(blocks[1].content?.[0]).toMatchObject({ type: 'mathInline' });
  });

  it('⭐⭐ 带 indent 的段落**仍是层级**(h6 之后),不能被当成正文吞掉', () => {
    const s = noteDocToTree(doc([h(1, 'h1', '主题'), p('p1', '第七层', 1)]));
    expect(s.nodes.map((n) => n.id)).toEqual(['h1', 'p1']);
    expect(s.nodes[1].parent).toBe('h1');
  });

  it('⚠️ 文档以无 indent 段落开头 → 无处可并,自成节点(否则内容凭空消失)', () => {
    const s = noteDocToTree(doc([p('p1', '开头就是正文')]));
    expect(s.nodes.map((n) => n.id)).toEqual(['p1']);
  });

  it('⭐⭐ 往返收敛:doc → 树 → doc → 树,**节点集不变**', () => {
    const d0 = doc([h(1, 'h1', '主题'), h(2, 'h2', '主题2'), math('p1', 'x^2+2'), h(2, 'h3', '分支B')]);
    const s1 = noteDocToTree(d0);
    const s2 = noteDocToTree(treeToNoteDoc(s1));
    // ⚠️ 反向若把正文也加 indent,这里节点会增殖 → 一轮轮变多
    expect(s2.nodes.map((n) => n.id)).toEqual(s1.nodes.map((n) => n.id));
    // 再走一轮仍不变(彻底收敛,不是恰好第二轮相等)
    const s3 = noteDocToTree(treeToNoteDoc(s2));
    expect(s3.nodes.map((n) => n.id)).toEqual(s1.nodes.map((n) => n.id));
  });

  it('⭐⭐ 往返后正文**还在**(不能因为并进节点就在回写时丢掉)', () => {
    const s1 = noteDocToTree(doc([h(2, 'h2', '主题2'), math('p1', 'x^2+2')]));
    const back = JSON.stringify(treeToNoteDoc(s1));
    expect(back).toContain('mathInline');
    expect(back).toContain('x^2+2');
  });

  it('⚠️ 回写时正文段落**不带 indent**(带了会被读回成层级 → 不收敛)', () => {
    const s1 = noteDocToTree(doc([h(2, 'h2', '主题2'), math('p1', 'x^2+2')]));
    const out = treeToNoteDoc(s1) as { payload: { content: { type: string; attrs?: { indent?: number } }[] } };
    const bodies = out.payload.content.filter((b) => b.type === 'paragraph');
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies) {
      expect(b.attrs?.indent ?? 0, '正文段落带了 indent → 会被当成层级').toBe(0);
    }
  });
});

/**
 * ⭐⭐ 首块保留 heading/level(用户 2026-09-10:
 * 「paragraph 应该是正文文字大小,而不应该和 hn 的文字一样大小」)
 *
 * ⚠️ 渲染层(textBlock.ts)**本来就按块给字号**:
 *   `fontSize = headingFontSize(atom.attrs.level) × (base/16)`。
 *   所以只要把 level 带上,标题大、正文小就自动成立 —— 不需要另算一套字号。
 *   之前把首块拍成裸 paragraph,level 丢了 → 整框被拉成一样大。
 */
describe('首块保留 heading/level', () => {
  it('⭐⭐ heading 进树后仍是 heading,且带 level', () => {
    const s = noteDocToTree(doc([h(2, 'h2', '主题2'), math('p1', 'x^2+1')]));
    const blocks = blocksOf(s.nodes[0]) as { type: string; attrs?: { level?: number } }[];
    expect(blocks[0].type, '首块丢了 heading → 渲染层无从区分标题与正文').toBe('heading');
    expect(blocks[0].attrs?.level).toBe(2);
  });

  it('⭐⭐ 并进来的正文**不带 level**(带了会被渲成标题大小)', () => {
    const s = noteDocToTree(doc([h(2, 'h2', '主题2'), math('p1', 'x^2+1')]));
    const blocks = blocksOf(s.nodes[0]) as { type: string; attrs?: { level?: number } }[];
    expect(blocks[1].type).toBe('paragraph');
    expect(blocks[1].attrs?.level).toBeUndefined();
  });

  it('⚠️ 无 heading 的节点(mermaid 来的)首块仍是 paragraph,不硬塞 level', () => {
    const s = noteDocToTree(doc([p('p1', '开头就是正文')]));
    const blocks = blocksOf(s.nodes[0]) as { type: string; attrs?: { level?: number } }[];
    expect(blocks[0].attrs?.level).toBeUndefined();
  });
});
