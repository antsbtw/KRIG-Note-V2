/**
 * column 内 Backspace 守卫(用户 2026-11-03 报:栏内行首一个退格就把分栏删了;前面是空格也一样)
 *
 * 根因(探针实测):栏内首段行首时,集中退格链 / column-list keymap / baseKeymap 全返回 false,
 * 退格落到浏览器原生删除 → 两栏 DOM 被并掉 → 分栏解散。所以判据 = 命令是否**接管**(true),
 * 以及接管后文档是否还是两栏。
 *
 * ⚠️ 注入验红:把 backspace-decision 的 column 硬墙改回 `break` → 前两条变红;
 *    删掉第 0 步空白接管 → 第三条变红。
 *
 * 环境 stub 照 def-block.test.ts。
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Schema, Node as PMNode } from 'prosemirror-model';

// 全 ENABLED_BLOCKS import 链顺带拉起 learning vocab 集成,它 lazy 调
// requireCapabilityApi('text-editing');深 no-op 吞掉链式调用(与本测试无关)。
const deepNoop: unknown = new Proxy(function () {} as object, {
  get: () => deepNoop,
  apply: () => deepNoop,
});
vi.mock('@slot/capability-registry/get-capability-api', () => ({
  getCapabilityApi: vi.fn(() => deepNoop),
  requireCapabilityApi: vi.fn(() => deepNoop),
}));

class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): unknown[] {
    return [];
  }
}
const g = globalThis as unknown as Record<string, unknown>;
g.IntersectionObserver ??= NoopObserver;
g.ResizeObserver ??= NoopObserver;
g.window ??= g;
const win = g.window as Record<string, unknown>;
win.electronAPI ??= { learningVocabList: () => Promise.resolve([]) };
win.addEventListener ??= () => {};
win.removeEventListener ??= () => {};

let schema: Schema;
let ENABLED_BLOCKS: typeof import('@drivers/text-editing-driver/enabled-blocks').ENABLED_BLOCKS;
let buildBackspaceCommand: typeof import('@drivers/text-editing-driver/keyboard/backspace-decision').buildBackspaceCommand;
let buildKeyboardMetaLookup: typeof import('@drivers/text-editing-driver/keyboard/build-keyboard-keymap').buildKeyboardMetaLookup;

beforeAll(async () => {
  const { buildSchema } = await import('@drivers/text-editing-driver/schema-builder');
  ({ ENABLED_BLOCKS } = await import('@drivers/text-editing-driver/enabled-blocks'));
  ({ buildBackspaceCommand } = await import('@drivers/text-editing-driver/keyboard/backspace-decision'));
  ({ buildKeyboardMetaLookup } = await import('@drivers/text-editing-driver/keyboard/build-keyboard-keymap'));
  schema = buildSchema(ENABLED_BLOCKS);
});

const p = (t: string) => schema.nodes.paragraph.create(null, t ? schema.text(t) : undefined);

/** 两栏;左栏可指定,光标放在右栏第 paraIndex 段、段内 offset 处,按一次 Backspace */
function press(left: PMNode[], right: PMNode[], side: 'left' | 'right', paraIndex: number, offset: number) {
  const doc = schema.node('doc', null, [
    schema.nodes.columnList.create({ columns: 2 }, [
      schema.nodes.column.create(null, left),
      schema.nodes.column.create(null, right),
    ]),
  ]);
  const paras = side === 'left' ? left : right;
  let pos = 1 + (side === 'right' ? doc.child(0).child(0).nodeSize : 0) + 1; // 该栏内容起点
  for (let i = 0; i < paraIndex; i++) pos += paras[i].nodeSize;
  pos += 1 + offset;
  let state = EditorState.create({ schema, doc });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
  expect(state.selection.$from.parentOffset).toBe(offset);
  const cmd = buildBackspaceCommand(buildKeyboardMetaLookup(ENABLED_BLOCKS));
  const handled = cmd(state, (tr) => {
    state = state.apply(tr);
  }, undefined as never);
  return { handled, state };
}

describe('column · Backspace 不再一下删掉分栏', () => {
  it('⭐ 右栏首段行首(有字)→ 接管且什么都不做:仍是两栏、文字不动', () => {
    const { handled, state } = press([p('123')], [p('123')], 'right', 0, 0);
    expect(handled).toBe(true);
    expect(state.doc.child(0).type.name).toBe('columnList');
    expect(state.doc.child(0).childCount).toBe(2);
    expect(state.doc.child(0).child(1).textContent).toBe('123');
  });

  it('⭐ 左栏首段行首同样是硬墙', () => {
    const { handled, state } = press([p('abc')], [p('123')], 'left', 0, 0);
    expect(handled).toBe(true);
    expect(state.doc.child(0).childCount).toBe(2);
  });

  it('⭐ 紧接着第 2 次退格 → 解散分栏,当前行接到另一栏末尾(abc|123)', () => {
    const doc = schema.node('doc', null, [
      schema.nodes.columnList.create({ columns: 2 }, [
        schema.nodes.column.create(null, [p('abc')]),
        schema.nodes.column.create(null, [p('123')]),
      ]),
    ]);
    let state = EditorState.create({ schema, doc });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1 + doc.child(0).child(0).nodeSize + 2)));
    const cmd = buildBackspaceCommand(buildKeyboardMetaLookup(ENABLED_BLOCKS));
    const run = () => cmd(state, (tr) => { state = state.apply(tr); }, undefined as never);
    expect(run()).toBe(true);
    expect(state.doc.child(0).type.name).toBe('columnList'); // 第 1 次:不动
    expect(run()).toBe(true);
    // 按删除顺序:当前行接到另一栏末尾 → abc|123
    expect(state.doc.content.content.map((n) => n.textContent)).toEqual(['abc123']);
    expect(state.doc.child(0).type.name).toBe('paragraph');
    expect(state.selection.$from.parent.textContent).toBe('abc123');
    expect(state.selection.$from.parentOffset).toBe(3);
  });

  it('左栏行首第 2 次 → 解散但不合并(前面没有别的栏),光标留在段首', () => {
    const doc = schema.node('doc', null, [
      schema.nodes.columnList.create({ columns: 2 }, [
        schema.nodes.column.create(null, [p('abc')]),
        schema.nodes.column.create(null, [p('123')]),
      ]),
    ]);
    let state = EditorState.create({ schema, doc });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)));
    const cmd = buildBackspaceCommand(buildKeyboardMetaLookup(ENABLED_BLOCKS));
    const run = () => cmd(state, (tr) => { state = state.apply(tr); }, undefined as never);
    run();
    run();
    expect(state.doc.content.content.map((n) => n.textContent)).toEqual(['abc', '123']);
    expect(state.selection.$from.parent.textContent).toBe('abc');
    expect(state.selection.$from.parentOffset).toBe(0);
  });

  it('不许误伤:两次退格之间打过字/动过光标 → 重新算第 1 次', () => {
    const doc = schema.node('doc', null, [
      schema.nodes.columnList.create({ columns: 2 }, [
        schema.nodes.column.create(null, [p('abc')]),
        schema.nodes.column.create(null, [p('123')]),
      ]),
    ]);
    let state = EditorState.create({ schema, doc });
    const start = 1 + doc.child(0).child(0).nodeSize + 2;
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, start)));
    const cmd = buildBackspaceCommand(buildKeyboardMetaLookup(ENABLED_BLOCKS));
    const run = () => cmd(state, (tr) => { state = state.apply(tr); }, undefined as never);
    expect(run()).toBe(true);
    // 打一个字再删掉,光标回到段首(文档内容一样,但已不是同一次)
    state = state.apply(state.tr.insertText('x', start));
    const del = state.tr.delete(start, start + 1);
    state = state.apply(del.setSelection(TextSelection.create(del.doc, start)));
    expect(run()).toBe(true);
    expect(state.doc.child(0).type.name).toBe('columnList');
  });

  it('⭐ 光标前是空格 → 只删这个空格,不交给浏览器', () => {
    const { handled, state } = press([p('123')], [p(' 123')], 'right', 0, 1);
    expect(handled).toBe(true);
    expect(state.doc.child(0).childCount).toBe(2);
    expect(state.doc.child(0).child(1).textContent).toBe('123');
  });

  it('不许误伤:栏内第二段行首仍与上一段合并', () => {
    const { handled, state } = press([p('123')], [p('a'), p('b')], 'right', 1, 0);
    expect(handled).toBe(true);
    expect(state.doc.child(0).child(1).textContent).toBe('ab');
  });

  it('不许误伤:只剩一个空段的栏仍放行(交给 column-list keymap 删该栏)', () => {
    const { handled } = press([p('123')], [p('')], 'right', 0, 0);
    expect(handled).toBe(false);
  });

  it('不许误伤:光标前是普通字符时不接管(该删字符照旧删)', () => {
    const { handled } = press([p('123')], [p('123')], 'right', 0, 2);
    expect(handled).toBe(false);
  });
});

describe('column · 删空一栏不立刻删栏(用户 2026-11-03:删完首字符再按一次才删 column)', () => {
  async function setup(right: string, cursorInRight: boolean) {
    const { columnCollapsePlugin } = await import('@drivers/text-editing-driver/blocks/column-list/column-collapse-plugin');
    const { columnListKeymapPlugin } = await import('@drivers/text-editing-driver/blocks/column-list/keymap');
    const doc = schema.node('doc', null, [
      schema.nodes.columnList.create({ columns: 2 }, [
        schema.nodes.column.create(null, [p('123')]),
        schema.nodes.column.create(null, [p(right)]),
      ]),
      p('下文'),
    ]);
    const keymapPlugin = columnListKeymapPlugin();
    let state = EditorState.create({ schema, doc, plugins: [keymapPlugin, columnCollapsePlugin()] });
    const rightTextStart = 1 + doc.child(0).child(0).nodeSize + 2;
    const cursor = cursorInRight ? rightTextStart + right.length : doc.content.size - 1;
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, cursor)));
    // 模拟删掉右栏全部文字(浏览器原生删字符 / 选中删除都落成这个 tr)
    state = state.applyTransaction(state.tr.delete(rightTextStart, rightTextStart + right.length)).state;
    const backspace = (): boolean => {
      const handle = keymapPlugin.props.handleKeyDown as unknown as (v: unknown, e: unknown) => boolean;
      const view = { state, dispatch: (tr: import('prosemirror-state').Transaction) => { state = state.applyTransaction(tr).state; } };
      return handle(view, new (class { key = 'Backspace'; keyCode = 8; altKey = false; ctrlKey = false; metaKey = false; shiftKey = false; })());
    };
    return { get state() { return state; }, backspace };
  }

  it('⭐ 光标在栏里,删掉唯一的字 → 分栏还在,该栏留成空段', async () => {
    const t = await setup('1', true);
    expect(t.state.doc.child(0).type.name).toBe('columnList');
    expect(t.state.doc.child(0).childCount).toBe(2);
    expect(t.state.doc.child(0).child(1).textContent).toBe('');
  });

  it('⭐ 空栏里再按一次 Backspace → 才删该栏(两栏解散成左栏内容)', async () => {
    const t = await setup('1', true);
    expect(t.backspace()).toBe(true);
    expect(t.state.doc.child(0).type.name).toBe('paragraph');
    expect(t.state.doc.child(0).textContent).toBe('123');
  });

  it('不许误伤:光标不在该栏(如块被拖出栏)→ 照旧立刻收缩', async () => {
    const t = await setup('1', false);
    expect(t.state.doc.child(0).type.name).toBe('paragraph');
    expect(t.state.doc.child(0).textContent).toBe('123');
  });
});
