/**
 * handle turn-into 从 listItem 出发的 lift + 递归 pos 数学回归守护。
 *
 * bug:无序列表项无法通过 handle 转成 h3 / 有序列表等 —— turnIntoAt 各分支都假设
 * 源节点是 paragraph/heading,源是 listItem 时静默 return。
 * 修法:源为 listItem/taskItem 时先把该项从 list 里 lift 出来解包成普通 block
 *      (只转当前项,其余留在原 list,list 按需拆分),再递归 turnInto 第一个子 block。
 *
 * 本测试锁住 lift + tr.mapping.map(pos, 1) 的 pos 数学与"只转当前 item"结构语义
 * (纯 doc 变换,不挂 EditorView)。
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { Fragment, type Schema } from 'prosemirror-model';
import { liftTarget } from 'prosemirror-transform';

// 深 no-op:吞掉 ENABLED_BLOCKS import 链顺带拉起的 learning vocab 集成的链式调用
// (它 lazy 调 requireCapabilityApi;shared setup.ts 对未 stub cap 抛错)。
const deepNoop: unknown = new Proxy(function () {} as object, {
  get: () => deepNoop,
  apply: () => deepNoop,
});
vi.mock('@slot/capability-registry/get-capability-api', () => ({
  getCapabilityApi: vi.fn(() => deepNoop),
  requireCapabilityApi: vi.fn(() => deepNoop),
}));

// 测试环境(node)无 IntersectionObserver / ResizeObserver / window — 补最小 stub,
// 让 ENABLED_BLOCKS import 链里的 node-view 模块能 eval(产品渲染进程原生有,非产品 bug)。
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

// 动态 import:确保上面的 stub 先于 driver 模块 eval(静态 import 会被提升)。
let schema: Schema;
beforeAll(async () => {
  const { buildSchema } = await import('@drivers/text-editing-driver/schema-builder');
  const { ENABLED_BLOCKS } = await import('@drivers/text-editing-driver/enabled-blocks');
  schema = buildSchema(ENABLED_BLOCKS);
});

function makeBulletList(items: string[]) {
  const listItems = items.map((t) =>
    schema.nodes.listItem.create(
      null,
      schema.nodes.paragraph.create(null, t ? schema.text(t) : undefined),
    ),
  );
  return schema.nodes.bulletList.create(null, Fragment.from(listItems));
}

/** 复刻 api.ts turnIntoAt 里 listItem 分支的 lift + 递归 pos 计算(不含视图) */
function liftItemAt(doc: import('prosemirror-model').Node, pos: number) {
  const node = doc.nodeAt(pos);
  expect(node).toBeTruthy();
  const range = doc.resolve(pos + 1).blockRange(doc.resolve(pos + node!.nodeSize - 1));
  const depth = range ? liftTarget(range) : null;
  expect(range).toBeTruthy();
  expect(depth).not.toBeNull();
  let state = EditorState.create({ doc, schema });
  const tr = state.tr.lift(range!, depth!);
  const innerPos = tr.mapping.map(pos + 2, 1);
  const $inner = tr.doc.resolve(innerPos);
  const newPos = $inner.before($inner.depth);
  state = state.apply(tr);
  return { doc: state.doc, newPos };
}

describe('listItem turn-into lift pos math', () => {
  it('单项 bullet list → lift 后 paragraph 落顶层,newPos 指向它', () => {
    const doc = schema.nodes.doc.create(null, makeBulletList(['hello']));
    const itemPos = 1; // bulletList@0, listItem@1
    expect(doc.nodeAt(itemPos)!.type.name).toBe('listItem');
    const { doc: out, newPos } = liftItemAt(doc, itemPos);
    expect(out.childCount).toBe(1);
    expect(out.child(0).type.name).toBe('paragraph');
    expect(out.child(0).textContent).toBe('hello');
    expect(out.nodeAt(newPos)!.type.name).toBe('paragraph');
    expect(out.nodeAt(newPos)!.textContent).toBe('hello');
  });

  it('多项 list 中间项 lift → 只该项出来,list 拆前后两段', () => {
    const doc = schema.nodes.doc.create(null, makeBulletList(['a', 'b', 'c']));
    let bPos = -1;
    doc.descendants((n, p) => {
      if (n.type.name === 'listItem' && n.textContent === 'b') bPos = p;
    });
    const { doc: out, newPos } = liftItemAt(doc, bPos);
    const kinds: string[] = [];
    out.forEach((n) => kinds.push(`${n.type.name}:${n.textContent}`));
    expect(kinds).toEqual(['bulletList:a', 'paragraph:b', 'bulletList:c']);
    expect(out.nodeAt(newPos)!.textContent).toBe('b');
  });

  it('首项 lift → paragraph 在前,其余留在 list', () => {
    const doc = schema.nodes.doc.create(null, makeBulletList(['a', 'b']));
    const { doc: out, newPos } = liftItemAt(doc, 1);
    const kinds: string[] = [];
    out.forEach((n) => kinds.push(`${n.type.name}:${n.textContent}`));
    expect(kinds).toEqual(['paragraph:a', 'bulletList:b']);
    expect(out.nodeAt(newPos)!.textContent).toBe('a');
  });
});
