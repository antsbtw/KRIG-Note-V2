/**
 * heading-collapse 行内三角(▸/▾)—— 折叠范围 / 可折叠判据守护
 *
 * 三角的行为完全由两条纯逻辑决定,DOM 只是它们的投影:
 *   1. hasCollapsibleContent(doc, pos) → 决定「显不显三角」
 *   2. headingCollapseRange(doc, pos)  → 决定「点下去藏哪一段」
 * 这里锁住这两条(node 环境无 DOM,widget 渲染本身由真机验)。
 *
 * ⚠️ 折叠状态仅存活在 plugin state(不写 attrs、不持久化)—— 用户明确决议,
 * 本测试不假设任何持久化行为。
 */
import { describe, it, expect } from 'vitest';
import { Schema, Node as PMNode } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import {
  headingCollapseRange,
  hasCollapsibleContent,
  buildHeadingCollapsePlugin,
  headingCollapseKey,
  isHeadingCollapsed,
} from '@drivers/text-editing-driver/plugins/build-heading-collapse-plugin';

// 最小 schema:只要 heading(带 level)+ paragraph,足以锁住范围推导语义。
// 不拉全 ENABLED_BLOCKS —— 折叠范围只看顶层 node 的 type/level,与具体块种类无关。
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] },
    heading: {
      group: 'block',
      content: 'inline*',
      attrs: { level: { default: 1 } },
      toDOM: (n) => [`h${n.attrs.level as number}`, 0],
    },
    text: { group: 'inline' },
  },
});

function h(level: number, text: string) {
  return { type: 'heading', attrs: { level }, content: [{ type: 'text', text }] };
}
function p(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}
function makeDoc(content: unknown[]): PMNode {
  return PMNode.fromJSON(schema, { type: 'doc', content } as never);
}

/** 取第 index 个顶层 block 的 pos */
function topPos(doc: PMNode, index: number): number {
  let found = -1;
  let i = 0;
  doc.forEach((_node, offset) => {
    if (i === index) found = offset;
    i += 1;
  });
  if (found < 0) throw new Error(`no top-level block at index ${index}`);
  return found;
}

/** 把 range 换算成「被藏起来的顶层 block 文本」,让断言读起来是语义而非数字 */
function hiddenTexts(doc: PMNode, pos: number): string[] | null {
  const range = headingCollapseRange(doc, pos);
  if (!range) return null;
  const texts: string[] = [];
  doc.forEach((node, offset) => {
    if (offset >= range.from && offset + node.nodeSize <= range.to) {
      texts.push(node.textContent);
    }
  });
  return texts;
}

describe('headingCollapseRange —— 折叠范围推导', () => {
  it('H1 藏到下一个 H1 为止(中间的 H2/正文全进范围)', () => {
    const doc = makeDoc([h(1, 'A'), p('a1'), h(2, 'A.1'), p('a2'), h(1, 'B'), p('b1')]);
    expect(hiddenTexts(doc, topPos(doc, 0))).toEqual(['a1', 'A.1', 'a2']);
  });

  it('H2 只藏到下一个 H2 为止,不越过同级', () => {
    const doc = makeDoc([h(2, 'A'), p('a1'), h(2, 'B'), p('b1')]);
    expect(hiddenTexts(doc, topPos(doc, 0))).toEqual(['a1']);
  });

  it('H2 遇到更高级的 H1 也停下(不吃掉别人的章节)', () => {
    const doc = makeDoc([h(2, 'A'), p('a1'), h(1, 'TOP'), p('t1')]);
    expect(hiddenTexts(doc, topPos(doc, 0))).toEqual(['a1']);
  });

  it('H1 藏到文末(后面没有同级/更高级 heading)', () => {
    const doc = makeDoc([h(1, 'A'), p('a1'), h(3, 'A.1.1'), p('a2')]);
    expect(hiddenTexts(doc, topPos(doc, 0))).toEqual(['a1', 'A.1.1', 'a2']);
  });

  it('h4~h6 同样成立(不是只有 h1~h3 有折叠)', () => {
    const doc = makeDoc([h(5, 'A'), p('a1'), h(6, 'A.1'), p('a2'), h(5, 'B')]);
    expect(hiddenTexts(doc, topPos(doc, 0))).toEqual(['a1', 'A.1', 'a2']);
    // h6 只到下一个 h5(它自己下面只有 a2)
    expect(hiddenTexts(doc, topPos(doc, 2))).toEqual(['a2']);
  });

  it('非 heading 的 pos 返回 null', () => {
    const doc = makeDoc([p('just text'), h(1, 'A'), p('a1')]);
    expect(headingCollapseRange(doc, topPos(doc, 0))).toBeNull();
  });
});

describe('hasCollapsibleContent —— 有内容才显三角', () => {
  it('下面有正文 → 有三角', () => {
    const doc = makeDoc([h(1, 'A'), p('a1')]);
    expect(hasCollapsibleContent(doc, topPos(doc, 0))).toBe(true);
  });

  it('紧跟同级 heading、下面空无一物 → 没三角(显了是骗人)', () => {
    const doc = makeDoc([h(1, 'A'), h(1, 'B'), p('b1')]);
    expect(hasCollapsibleContent(doc, topPos(doc, 0))).toBe(false);
  });

  it('紧跟更高级 heading → 没三角', () => {
    const doc = makeDoc([h(3, 'A'), h(1, 'TOP'), p('t1')]);
    expect(hasCollapsibleContent(doc, topPos(doc, 0))).toBe(false);
  });

  it('文档最后一个 block 就是它自己 → 没三角', () => {
    const doc = makeDoc([p('x'), h(2, 'LAST')]);
    expect(hasCollapsibleContent(doc, topPos(doc, 1))).toBe(false);
  });

  it('下面只跟着更低级 heading(无正文)→ 有三角(那个子标题就是内容)', () => {
    const doc = makeDoc([h(1, 'A'), h(2, 'A.1'), p('a')]);
    expect(hasCollapsibleContent(doc, topPos(doc, 0))).toBe(true);
  });
});

describe('折叠状态切换 —— plugin state 语义', () => {
  function makeState(content: unknown[]) {
    return EditorState.create({
      doc: makeDoc(content),
      plugins: [buildHeadingCollapsePlugin()],
    });
  }

  /** 无 EditorView 的 headless 切换:直接下 meta(toggleHeadingCollapse 的内核) */
  function applyToggle(state: EditorState, pos: number): EditorState {
    const cur = headingCollapseKey.getState(state);
    if (!cur) throw new Error('plugin state missing');
    const next = new Set(cur.collapsed);
    if (next.has(pos)) next.delete(pos);
    else next.add(pos);
    return state.apply(state.tr.setMeta(headingCollapseKey, { collapsed: next }));
  }

  it('初始全展开', () => {
    const state = makeState([h(1, 'A'), p('a1')]);
    expect(isHeadingCollapsed(state, topPos(state.doc, 0))).toBe(false);
  });

  it('切一次 → 折叠;再切一次 → 回到展开', () => {
    let state = makeState([h(1, 'A'), p('a1')]);
    const pos = topPos(state.doc, 0);
    state = applyToggle(state, pos);
    expect(isHeadingCollapsed(state, pos)).toBe(true);
    state = applyToggle(state, pos);
    expect(isHeadingCollapsed(state, pos)).toBe(false);
  });

  it('折叠后 hiddenRanges 覆盖该标题名下的内容,且不动别的章节', () => {
    let state = makeState([h(1, 'A'), p('a1'), h(1, 'B'), p('b1')]);
    const posA = topPos(state.doc, 0);
    state = applyToggle(state, posA);
    const s = headingCollapseKey.getState(state)!;
    expect(s.hiddenRanges).toEqual([[headingCollapseRange(state.doc, posA)!.from,
                                     headingCollapseRange(state.doc, posA)!.to]]);
    // B 没被折叠 —— 它的正文不在隐藏区
    const bBodyPos = topPos(state.doc, 3);
    expect(s.hiddenRanges.some(([f, t]) => bBodyPos >= f && bBodyPos < t)).toBe(false);
  });

  it('折叠只影响自己,兄弟标题状态不变', () => {
    let state = makeState([h(1, 'A'), p('a1'), h(1, 'B'), p('b1')]);
    const posA = topPos(state.doc, 0);
    const posB = topPos(state.doc, 2);
    state = applyToggle(state, posA);
    expect(isHeadingCollapsed(state, posA)).toBe(true);
    expect(isHeadingCollapsed(state, posB)).toBe(false);
  });
});
