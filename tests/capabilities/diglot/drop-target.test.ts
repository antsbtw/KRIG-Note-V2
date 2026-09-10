/**
 * 落点归位断言(01 §7.2 v0.2:裸拖 = 改父/改序)
 *
 * ⚠️ 规格修订背景(2026-09-10,用户拍板):
 * v0.1 把「拖到空白 = 钉坐标」做成默认,真机实测**整张图立刻变丑** ——
 * pinned 的那个不动,其余仍按自动布局排,两套坐标混在一起。
 * ⭐ 根因是心智模型套错:**导图的位置是算出来的,不是摆出来的**。
 * 改为裸拖=改结构,自由摆位下沉为 Alt+拖。
 */
import { describe, it, expect } from 'vitest';
import { resolveDropTarget } from '@capabilities/diglot-model/project-to-canvas';
import { fileToSnapshot, emptyMindFile } from '@capabilities/diglot-model/mind-file';
import { contentToText } from '@capabilities/diglot-model/mermaid-mindmap';
import type { NodeId } from '@capabilities/diglot-model/types';

function fixture() {
  const r = fileToSnapshot(emptyMindFile());
  if (!r.ok) throw new Error('夹具解析失败');
  const s = r.value.s;
  const idOf = (label: string): NodeId =>
    s.nodes.find((n) => contentToText(n.content) === label)!.id;
  // 模拟一次三列布局的投影位置
  const pos = new Map<NodeId, { x: number; y: number; w: number; h: number }>([
    [idOf('主题'), { x: 20, y: 118, w: 60, h: 42 }],
    [idOf('分支A'), { x: 117, y: 59, w: 69, h: 42 }],
    [idOf('分支B'), { x: 117, y: 176, w: 69, h: 42 }],
    [idOf('叶子1'), { x: 222, y: 20, w: 69, h: 42 }],
    [idOf('叶子2'), { x: 222, y: 98, w: 69, h: 42 }],
    [idOf('叶子3'), { x: 222, y: 176, w: 69, h: 42 }],
  ]);
  return { s, g: r.value.g, idOf, pos };
}

describe('落点归位:裸拖 = 改父/改序', () => {
  it('⭐ 拖到某节点右侧 → 成为它的孩子', () => {
    const { s, g, idOf, pos } = fixture();
    // 把「叶子1」拖到「分支B」右边
    const t = resolveDropTarget(s, g, idOf('叶子1'), { x: 240, y: 180 }, pos);
    expect(t?.newParent, '落点左侧最近的是分支B').toBe(idOf('分支B'));
  });

  it('⭐ 拖到最左(root 左侧)→ 挂到 root', () => {
    const { s, g, idOf, pos } = fixture();
    const t = resolveDropTarget(s, g, idOf('叶子1'), { x: 0, y: 100 }, pos);
    expect(t?.newParent).toBe(idOf('主题'));
  });

  it('⭐⭐ 不许挂到自己的后代下(会成环)', () => {
    const { s, g, idOf, pos } = fixture();
    // 把「分支A」拖到它自己的孩子「叶子1」右边
    const t = resolveDropTarget(s, g, idOf('分支A'), { x: 300, y: 20 }, pos);
    // ⚠️ 叶子1/叶子2 在被拖子树内,不得成为父;应回落到更左的候选
    expect(t?.newParent).not.toBe(idOf('叶子1'));
    expect(t?.newParent).not.toBe(idOf('叶子2'));
  });

  it('⭐ 同父兄弟按落点 y 决定插到谁之前', () => {
    const { s, g, idOf, pos } = fixture();
    // 拖「叶子3」到分支A右侧、叶子1 上方 → 应插在叶子1 之前
    const t = resolveDropTarget(s, g, idOf('叶子3'), { x: 240, y: 10 }, pos);
    expect(t?.newParent).toBe(idOf('分支A'));
    expect(t?.beforeSibling, '落点在叶子1上方,应插它之前').toBe(idOf('叶子1'));
  });

  it('拖到该父下所有兄弟的下方 → 不带 beforeSibling(追加末位)', () => {
    const { s, g, idOf, pos } = fixture();
    // 叶子1(原属分支A)拖到分支B 右侧、叶子3 下方 → 归分支B 且追加末位
    const t = resolveDropTarget(s, g, idOf('叶子1'), { x: 240, y: 400 }, pos);
    expect(t?.newParent).toBe(idOf('分支B'));
    expect(t?.beforeSibling, '下方无兄弟可插之前 → 追加末位').toBeUndefined();
  });

  it('⚠️ 拖回原位(父没变、无插位)→ 返回 null,不产生无意义变更', () => {
    const { s, g, idOf, pos } = fixture();
    // 叶子3 本就是分支B 的唯一孩子;拖到分支B 右下方 = 还是原样
    const t = resolveDropTarget(s, g, idOf('叶子3'), { x: 240, y: 400 }, pos);
    expect(t, '归到原父且无插位 → null').toBeNull();
  });
});

/**
 * §注入台账 —— 见提交说明
 *
 * | 注入 | 期望 | 实测 |
 * |---|---|---|
 * | 不排除被拖子树 | 「不许挂到后代下」红 | ✅ |
 * | 忽略 y 只按 x 归位 | 「按 y 决定插位」红 | ✅ |
 *
 * ⚠️ 未覆盖(诚实记账):
 * - 落点在两列**之间**时的归属(现规则取"左侧最近",未验边界手感)
 * - 自由主题(role=floating)的落点语义 —— Shift+拖尚未接线
 */
