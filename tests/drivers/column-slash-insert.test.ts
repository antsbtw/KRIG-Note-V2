/**
 * 回归守护:在分栏(2 Columns)的空栏里用 slash 插图片,分栏不能塌回一栏。
 *
 * bug(用户 2026-10-28 实测):空栏里打「/图片」→ 选 Image → 分栏消失、整篇回到单栏。
 * 根因:slash 选中后先单独 dispatch 一次「删掉 /图片」(clearSlashTrigger),
 * 这一刻那栏「有字 → 空」,columnCollapsePlugin 判它「刚变空」→ 删栏;只剩一栏有内容 → 解散分栏。
 * 随后图片插进的已是平铺后的文档。所有 slash 项(标题/列表…)在空栏里都会这样。
 *
 * 本测试用真实 schema + 真实 slash/塌栏插件离线重放这一串。
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';

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

/* eslint-disable @typescript-eslint/no-explicit-any */
let schema: any, buildSlashPlugin: any, clearSlashTrigger: any, columnCollapsePlugin: any;

beforeAll(async () => {
  const sb = await import('@drivers/text-editing-driver/schema-builder');
  const eb = await import('@drivers/text-editing-driver/enabled-blocks');
  const sl = await import('@drivers/text-editing-driver/plugins/build-slash-plugin');
  const cc = await import('@drivers/text-editing-driver/blocks/column-list/column-collapse-plugin');
  schema = sb.buildSchema(eb.ENABLED_BLOCKS);
  buildSlashPlugin = sl.buildSlashPlugin;
  clearSlashTrigger = sl.clearSlashTrigger;
  columnCollapsePlugin = cc.columnCollapsePlugin;
});

/** 最小 EditorView 替身:只要 state + dispatch(clearSlashTrigger 只用这两样) */
function fakeView(state: EditorState) {
  const v = {
    state,
    dispatch(tr: any) {
      v.state = v.state.apply(tr);
    },
  };
  return v;
}

/** 左栏有字,右栏空;光标在右栏 → 打一个 `/` 再打「图片」 */
function typedSlashInRightColumn() {
  const p = (text?: string) => schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
  const doc = schema.nodes.doc.create(null, [
    p('前面'),
    schema.nodes.columnList.create({ columns: 2 }, [
      schema.nodes.column.create(null, p('左栏内容')),
      schema.nodes.column.create(null, p()),
    ]),
  ]);
  let state = EditorState.create({ doc, plugins: [buildSlashPlugin('t'), columnCollapsePlugin()] });
  /** 右栏空段落的内容起点 */
  let pos = -1;
  state.doc.descendants((n: any, at: number) => {
    if (pos < 0 && n.type.name === 'column' && n.textContent === '') pos = at + 2;
  });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
  state = state.apply(state.tr.insertText('/'));
  state = state.apply(state.tr.insertText('图片'));
  return state;
}

const columnCount = (state: EditorState): number | null => {
  let n: number | null = null;
  state.doc.forEach((node: any) => {
    if (node.type.name === 'columnList') n = node.childCount;
  });
  return n;
};

describe('分栏 × slash 插入', () => {
  it('前提:slash 在右栏激活了', async () => {
    const state = typedSlashInRightColumn();
    const { slashPluginKey } = await import('@drivers/text-editing-driver/plugins/build-slash-plugin');
    expect(slashPluginKey.getState(state)?.active).toBe(true);
    expect(columnCount(state)).toBe(2);
  });

  it('选中 slash 项先删 /图片 —— 分栏还在,光标还在右栏', () => {
    const view = fakeView(typedSlashInRightColumn());
    expect(clearSlashTrigger(view)).toBe(true);
    expect(columnCount(view.state)).toBe(2);
    expect(view.state.selection.$from.node(view.state.selection.$from.depth - 1).type.name).toBe('column');
  });

  it('塌栏本职不受影响:用户自己把一栏的字删光,照样塌', () => {
    const p = (text?: string) => schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.columnList.create({ columns: 2 }, [
        schema.nodes.column.create(null, p('左')),
        schema.nodes.column.create(null, p('右')),
      ]),
    ]);
    const state = EditorState.create({ doc, plugins: [columnCollapsePlugin()] });
    let at = -1;
    state.doc.descendants((n: any, pos: number) => {
      if (n.isText && n.text === '右') at = pos;
    });
    const next = state.applyTransaction(state.tr.delete(at, at + 1)).state;
    expect(columnCount(next)).toBe(null);
  });
});
