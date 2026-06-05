/**
 * block-selection × codeBlock 回归守护
 *
 * 背景(2026-06-05 排查):用户报"ESC 选块无法包含代码块"。本测试用真实
 * block-selection keymap 命令驱动验证 —— 选择**逻辑**对 codeBlock 完全正常
 * (ESC 选中 / Shift+Arrow 扩选都把 codeBlock 纳入 MultipleNodeSelection)。
 *
 * 真正的 bug 是**纯 CSS**:codeBlock 的 NodeView wrapper(div.krig-code-block)
 * 有实底背景 #1e1e1e,把 .krig-block-selected 的半透明蓝底盖掉 → 看起来没选上。
 * 已在 pm-host.css 用 background-image 叠层修复。本测试锁住逻辑层不回归。
 */
import { describe, it, expect } from 'vitest';
import { Schema } from 'prosemirror-model';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { MultipleNodeSelection } from '@drivers/text-editing-driver/plugins/_shared/multiple-node-selection';
import { buildBlockSelectionKeymap } from '@drivers/text-editing-driver/plugins/build-block-selection-keymap';

// 最小 schema:doc > (paragraph | codeBlock)+
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: { content: 'inline*', group: 'block', toDOM: () => ['p', 0] },
    codeBlock: {
      content: 'text*',
      marks: '',
      group: 'block',
      code: true,
      defining: true,
      toDOM: () => ['pre', ['code', 0]],
    },
  },
  marks: {},
});

function makeDoc() {
  const { paragraph, codeBlock } = schema.nodes;
  return schema.node('doc', null, [
    paragraph.create(null, schema.text('hello')),
    codeBlock.create(null, schema.text('const x = 1\nconst y = 2')),
    paragraph.create(null, schema.text('world')),
  ]);
}

// 取真实 keymap plugin 的 handleKeyDown,用 fake view 驱动真实命令
const keymapPlugin = buildBlockSelectionKeymap();
const handleKeyDown = keymapPlugin.props.handleKeyDown!;

function press(state: EditorState, key: string, shift = false): EditorState {
  let next = state;
  const fakeView = {
    state,
    dispatch: (tr: Transaction) => {
      next = state.apply(tr);
    },
  };
  const event = {
    key,
    shiftKey: shift,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    preventDefault() {},
    stopPropagation() {},
  } as unknown as KeyboardEvent;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleKeyDown(fakeView as any, event);
  return next;
}

function selNames(state: EditorState): string[] {
  const sel = state.selection;
  if (sel instanceof MultipleNodeSelection) return sel.nodes.map((n) => n.type.name);
  return [`<${sel.constructor.name}>`];
}

function posInside(doc: ReturnType<typeof makeDoc>, typeName: string): number {
  let p = -1;
  doc.descendants((node, pos) => {
    if (node.type.name === typeName && p < 0) p = pos + 1;
    return true;
  });
  return p;
}

describe('codeBlock block-selection — real keymap commands', () => {
  it('ESC while cursor inside paragraph → selects paragraph', () => {
    const doc = makeDoc();
    let state = EditorState.create({ doc });
    state = state.apply(state.tr.setSelection(TextSelection.create(doc, posInside(doc, 'paragraph'))));
    state = press(state, 'Escape');
    expect(selNames(state)).toEqual(['paragraph']);
  });

  it('ESC on first paragraph → Shift-ArrowDown → should include codeBlock', () => {
    const doc = makeDoc();
    let state = EditorState.create({ doc });
    state = state.apply(state.tr.setSelection(TextSelection.create(doc, posInside(doc, 'paragraph'))));
    state = press(state, 'Escape');
    expect(selNames(state)).toEqual(['paragraph']);
    state = press(state, 'ArrowDown', true); // Shift-ArrowDown
    expect(selNames(state)).toEqual(['paragraph', 'codeBlock']);
  });

  it('ESC while cursor INSIDE codeBlock → selects codeBlock', () => {
    const doc = makeDoc();
    let state = EditorState.create({ doc });
    state = state.apply(state.tr.setSelection(TextSelection.create(doc, posInside(doc, 'codeBlock'))));
    state = press(state, 'Escape');
    expect(selNames(state)).toEqual(['codeBlock']);
  });

  it('ESC on codeBlock → Shift-ArrowDown → should include next paragraph', () => {
    const doc = makeDoc();
    let state = EditorState.create({ doc });
    state = state.apply(state.tr.setSelection(TextSelection.create(doc, posInside(doc, 'codeBlock'))));
    state = press(state, 'Escape');
    expect(selNames(state)).toEqual(['codeBlock']);
    state = press(state, 'ArrowDown', true);
    expect(selNames(state)).toEqual(['codeBlock', 'paragraph']);
  });

  it('Shift-ArrowDown from plain cursor in paragraph (no prior block sel) → enters block sel including codeBlock', () => {
    const doc = makeDoc();
    let state = EditorState.create({ doc });
    state = state.apply(state.tr.setSelection(TextSelection.create(doc, posInside(doc, 'paragraph'))));
    // 直接 Shift-ArrowDown(没先 ESC):extendBlockSelection 会先选当前块再扩
    state = press(state, 'ArrowDown', true);
    expect(selNames(state)).toEqual(['paragraph', 'codeBlock']);
  });
});
