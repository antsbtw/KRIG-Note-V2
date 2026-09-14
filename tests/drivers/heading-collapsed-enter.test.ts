/**
 * 折叠标题上按 Enter → 产出**同级新标题**(不是正文段)
 *
 * 用户口径(2026-09-10):
 *   「收起来时的回车,开一个新的对等的 h;展开回车就是正文。」
 *
 * 语义依据:折叠态下这一行代表的是**整个章节**,不是一行文字。回车理应产出下一个
 * 对等章节;若照常 splitBlock,光标会落进**被折叠因而看不见**的内容里 —— 用户视角
 * 就是"敲了回车什么都没发生 / 光标消失"。
 * 与既有 toggleList 收起态回车(insertSiblingToggleAfter)同源。
 *
 * ⚠️ 折叠状态只活在 plugin state(不写 attrs、不持久化 —— 用户明确决议),
 * 故这里必须**挂上折叠 plugin 并下 meta** 来造折叠态,不能改 node.attrs 造假。
 */
import { describe, it, expect } from 'vitest';
import { Schema, Node as PMNode } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { buildEnterCommand } from '@drivers/text-editing-driver/keyboard/enter-decision';
import {
  buildHeadingCollapsePlugin,
  headingCollapseKey,
} from '@drivers/text-editing-driver/plugins/build-heading-collapse-plugin';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      attrs: { indent: { default: 0 } },
      toDOM: () => ['p', 0],
    },
    heading: {
      group: 'block',
      content: 'inline*',
      attrs: { level: { default: 1 }, indent: { default: 0 } },
      // ⚠️ 必须与真实 spec 一致(blocks/heading/spec.ts):defining 决定 split 行为。
      // 漏了它,标题中间回车的产物会与产品不同 —— 测试就测的不是真东西了。
      // (indent 不在 heading/spec.ts 里,但 schema-builder.injectFrameworkAttrs
      //  给每个 group='block' 统一注入,故这里显式声明以对齐运行时。)
      defining: true,
      toDOM: (n) => [`h${n.attrs.level as number}`, 0],
    },
    text: { group: 'inline' },
  },
});

function h(level: number, text: string, indent = 0) {
  return { type: 'heading', attrs: { level, indent }, content: [{ type: 'text', text }] };
}
function p(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

/** metaLookup:本测试的 schema 没有 code/caption/container 语义,一律返回 undefined */
const noMeta = () => undefined;

function makeState(content: unknown[]): EditorState {
  return EditorState.create({
    doc: PMNode.fromJSON(schema, { type: 'doc', content } as never),
    plugins: [buildHeadingCollapsePlugin()],
  });
}

function topPos(doc: PMNode, index: number): number {
  let found = -1;
  let i = 0;
  doc.forEach((_n, offset) => {
    if (i === index) found = offset;
    i += 1;
  });
  if (found < 0) throw new Error(`no block at ${index}`);
  return found;
}

/** 真实地折叠某标题(下 plugin meta,与 toggleHeadingCollapse 内核一致) */
function collapse(state: EditorState, pos: number): EditorState {
  const cur = headingCollapseKey.getState(state);
  if (!cur) throw new Error('collapse plugin missing');
  const next = new Set(cur.collapsed);
  next.add(pos);
  return state.apply(state.tr.setMeta(headingCollapseKey, { collapsed: next }));
}

/** 把光标放到某 block 末尾 */
function cursorAtEndOf(state: EditorState, pos: number): EditorState {
  const node = state.doc.nodeAt(pos)!;
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, pos + 1 + node.content.size)),
  );
}

/** 跑 Enter,返回 { handled, newState } */
function pressEnter(state: EditorState) {
  const cmd = buildEnterCommand(noMeta);
  let next: EditorState | null = null;
  const handled = cmd(state, (tr) => { next = state.apply(tr); });
  return { handled, state: (next ?? state) as EditorState };
}

/** 顶层块的 [type, level|null, text] 摘要 */
function outline(doc: PMNode): [string, number | null, string][] {
  const out: [string, number | null, string][] = [];
  doc.forEach((n) => {
    out.push([n.type.name, (n.attrs.level as number) ?? null, n.textContent]);
  });
  return out;
}

describe('折叠标题上的 Enter', () => {
  it('折叠的 H2 上回车 → 产出同级 H2(不是 paragraph)', () => {
    let state = makeState([h(2, 'A'), p('a1'), p('a2'), h(2, 'B')]);
    const posA = topPos(state.doc, 0);
    state = collapse(state, posA);
    state = cursorAtEndOf(state, posA);

    const { handled, state: after } = pressEnter(state);
    expect(handled).toBe(true);

    const created = outline(after.doc).find((r, i) => i === 3);
    expect(created?.[0], '新块应是 heading').toBe('heading');
    expect(created?.[1], '新标题应与原标题同级').toBe(2);
  });

  it('新标题插在**折叠范围之后** —— 否则会被藏进折叠区看不见', () => {
    let state = makeState([h(2, 'A'), p('a1'), p('a2'), h(2, 'B')]);
    const posA = topPos(state.doc, 0);
    state = collapse(state, posA);
    state = cursorAtEndOf(state, posA);
    const { state: after } = pressEnter(state);

    // 期望顺序:A / a1 / a2 / <新 H2> / B
    expect(outline(after.doc)).toEqual([
      ['heading', 2, 'A'],
      ['paragraph', null, 'a1'],
      ['paragraph', null, 'a2'],
      ['heading', 2, ''],
      ['heading', 2, 'B'],
    ]);
  });

  it('光标落在新标题内(可以直接打字)', () => {
    let state = makeState([h(2, 'A'), p('a1'), h(2, 'B')]);
    const posA = topPos(state.doc, 0);
    state = collapse(state, posA);
    state = cursorAtEndOf(state, posA);
    const { state: after } = pressEnter(state);

    const $cursor = after.selection.$from;
    expect($cursor.parent.type.name).toBe('heading');
    expect($cursor.parent.attrs.level).toBe(2);
    expect($cursor.parent.textContent).toBe('');
  });

  it('新标题继承 indent', () => {
    let state = makeState([h(3, 'A', 2), p('a1'), h(3, 'B', 2)]);
    const posA = topPos(state.doc, 0);
    state = collapse(state, posA);
    state = cursorAtEndOf(state, posA);
    const { state: after } = pressEnter(state);
    const created = after.doc.child(2);
    expect(created.type.name).toBe('heading');
    expect(created.attrs.indent).toBe(2);
  });

  it('折叠范围到文末时,新标题追加到文末', () => {
    let state = makeState([h(1, 'A'), p('a1'), p('a2')]);
    const posA = topPos(state.doc, 0);
    state = collapse(state, posA);
    state = cursorAtEndOf(state, posA);
    const { state: after } = pressEnter(state);
    expect(outline(after.doc)).toEqual([
      ['heading', 1, 'A'],
      ['paragraph', null, 'a1'],
      ['paragraph', null, 'a2'],
      ['heading', 1, ''],
    ]);
  });

  it('⭐ 折叠内容一个都没动(回车不该改动被折叠的正文)', () => {
    let state = makeState([h(2, 'A'), p('a1'), p('a2'), h(2, 'B')]);
    const posA = topPos(state.doc, 0);
    state = collapse(state, posA);
    state = cursorAtEndOf(state, posA);
    const { state: after } = pressEnter(state);
    expect(after.doc.child(0).textContent).toBe('A');
    expect(after.doc.child(1).textContent).toBe('a1');
    expect(after.doc.child(2).textContent).toBe('a2');
  });
});

describe('展开态的 Enter —— 不受本改动影响', () => {
  it('未折叠的标题上回车:决策链**不接管**(交给通用 split → 正文段)', () => {
    let state = makeState([h(2, 'A'), p('a1'), h(2, 'B')]);
    const posA = topPos(state.doc, 0);
    state = cursorAtEndOf(state, posA); // 不 collapse
    const cmd = buildEnterCommand(noMeta);
    // dispatch 传 undefined 只探测"是否命中折叠分支"—— 展开态应落到 step 6
    // (step 6 的 splitBlockInheritFormat 也会返回 true,故这里断言产物而非返回值)
    const { state: after } = pressEnter(state);
    const created = after.doc.child(1);
    expect(created.type.name, '展开态回车应产出 paragraph,不是 heading').toBe('paragraph');
    void cmd;
  });

  it('展开态标题**中间**回车:拆成两个标题(PM defining 标准行为,本改动没碰)', () => {
    let state = makeState([h(2, 'ABCD'), p('x')]);
    const posA = topPos(state.doc, 0);
    // 光标放在 AB|CD
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, posA + 3)));
    const { state: after } = pressEnter(state);
    expect(after.doc.child(0).textContent).toBe('AB');
    // heading spec 是 defining:true → 中间拆分保留块类型(两个 h2),
    // 这与"末尾回车产出正文段"并不矛盾:末尾走的是 defaultBlockAt 路径。
    expect(after.doc.child(1).type.name).toBe('heading');
    expect(after.doc.child(1).textContent).toBe('CD');
  });

  it('普通段落上回车不受影响', () => {
    let state = makeState([p('hello'), p('world')]);
    state = cursorAtEndOf(state, topPos(state.doc, 0));
    const { state: after } = pressEnter(state);
    expect(after.doc.child(1).type.name).toBe('paragraph');
  });
});
