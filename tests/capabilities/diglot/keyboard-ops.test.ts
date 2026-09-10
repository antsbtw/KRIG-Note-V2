/**
 * 键盘结构操作断言(01 §7.1,照搬 XMind 肌肉记忆)
 *
 * Enter=插兄弟 / Tab=插子节点 / Delete=删子树
 *
 * ⚠️ 本文件测模型层。键盘事件本身在 MindCanvas 的 capture 监听里
 * (要挡住画布的同名 Delete 处理),那部分要真机点。
 */
import { describe, it, expect } from 'vitest';
import { notImplementedEngine as engine } from '@capabilities/diglot-model/engine-contract';
import { emptyMindFile, fileToSnapshot } from '@capabilities/diglot-model/mind-file';
import { contentToText } from '@capabilities/diglot-model/mermaid-mindmap';

function snap() {
  const r = fileToSnapshot(emptyMindFile());
  if (!r.ok) throw new Error('夹具失败');
  return r.value;
}
const idOf = (s: ReturnType<typeof snap>['s'], label: string): string =>
  s.nodes.find((n) => contentToText(n.content) === label)!.id;

describe('Enter — 插入兄弟', () => {
  it('⭐ 新节点与锚点同父,且排在它之后', () => {
    const base = snap();
    const anchor = idOf(base.s, '叶子1');
    const parent = base.s.nodes.find((n) => n.id === anchor)!.parent;

    const after = engine.applyAction(base, {
      kind: 'canvas.insertSibling', afterId: anchor, text: '新兄弟',
    });
    const added = after.s.nodes.find((n) => contentToText(n.content) === '新兄弟')!;
    expect(added.parent, '同父').toBe(parent);

    const sibs = after.s.nodes
      .filter((n) => n.parent === parent)
      .sort((a, b) => a.order.localeCompare(b.order));
    const ai = sibs.findIndex((n) => n.id === anchor);
    const ni = sibs.findIndex((n) => n.id === added.id);
    expect(ni, '排在锚点之后').toBe(ai + 1);
    // ⭐ 且要排在原本的下一个兄弟(叶子2)之前
    const l2 = sibs.findIndex((n) => contentToText(n.content) === '叶子2');
    expect(ni).toBeLessThan(l2);
  });

  it('⭐ C5:新节点 G 层零条目', () => {
    const base = snap();
    const after = engine.applyAction(base, {
      kind: 'canvas.insertSibling', afterId: idOf(base.s, '叶子1'), text: 'x',
    });
    expect(after.g.size).toBe(0);
  });

  it('⚠️ root 没有兄弟位 → 退化为加子节点,不静默失败', () => {
    const base = snap();
    const root = base.s.nodes.find((n) => n.role === 'root')!;
    const after = engine.applyAction(base, {
      kind: 'canvas.insertSibling', afterId: root.id, text: '新的',
    });
    const added = after.s.nodes.find((n) => contentToText(n.content) === '新的')!;
    expect(added.parent, 'root 的"兄弟"退化成它的孩子').toBe(root.id);
  });
});

describe('Tab — 插入子节点', () => {
  it('⭐ 成为选中节点的孩子,排在末位', () => {
    const base = snap();
    const parent = idOf(base.s, '分支A');
    const after = engine.applyAction(base, {
      kind: 'canvas.insertChild', parentId: parent, text: '新孩子',
    });
    const added = after.s.nodes.find((n) => contentToText(n.content) === '新孩子')!;
    expect(added.parent).toBe(parent);

    const kids = after.s.nodes
      .filter((n) => n.parent === parent)
      .sort((a, b) => a.order.localeCompare(b.order));
    expect(kids[kids.length - 1].id, '排在末位').toBe(added.id);
  });
});

describe('Delete — 删子树', () => {
  it('⭐⭐ 删分支 → 它和它的后代一起消失', () => {
    const base = snap();
    const branch = idOf(base.s, '分支A');
    const kids = base.s.nodes.filter((n) => n.parent === branch).map((n) => n.id);
    expect(kids.length).toBeGreaterThanOrEqual(2);

    const after = engine.applyAction(base, { kind: 'canvas.deleteSubtree', id: branch });
    expect(after.s.nodes.some((n) => n.id === branch), '自己没了').toBe(false);
    for (const k of kids) {
      expect(after.s.nodes.some((n) => n.id === k), `后代 ${k} 也该没`).toBe(false);
    }
    // 别的分支不受影响
    expect(after.s.nodes.some((n) => contentToText(n.content) === '分支B')).toBe(true);
  });

  it('⭐ 连带清理 G 条目(不留孤儿)', () => {
    const base = snap();
    const branch = idOf(base.s, '分支A');
    const kid = base.s.nodes.find((n) => n.parent === branch)!.id;
    let s2 = engine.applyAction(base, { kind: 'canvas.dragNode', id: branch, x: 1, y: 2 });
    s2 = engine.applyAction(s2, { kind: 'canvas.dragNode', id: kid, x: 3, y: 4 });
    expect(s2.g.size).toBe(2);

    const after = engine.applyAction(s2, { kind: 'canvas.deleteSubtree', id: branch });
    expect(after.g.has(branch), '自己的 G 条目该清').toBe(false);
    expect(after.g.has(kid), '后代的 G 条目也该清').toBe(false);
  });

  it('⭐ 连带清理悬空 Edge', () => {
    const base = snap();
    const branch = idOf(base.s, '分支A');
    const other = idOf(base.s, '分支B');
    const linked = engine.applyAction(base, {
      kind: 'canvas.connect', source: branch, target: other,
    });
    expect(linked.s.edges.length).toBe(1);

    const after = engine.applyAction(linked, { kind: 'canvas.deleteSubtree', id: branch });
    expect(after.s.edges.length, '一端没了的边必须清掉').toBe(0);
  });

  it('⚠️ root 不可删 —— fail loud,不静默无视', () => {
    const base = snap();
    const root = base.s.nodes.find((n) => n.role === 'root')!;
    expect(() => engine.applyAction(base, { kind: 'canvas.deleteSubtree', id: root.id })).toThrow(
      /root/,
    );
  });
});
