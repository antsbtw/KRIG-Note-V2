/**
 * ⭐⭐ 布局尺寸与渲染尺寸必须**同源**(真机:自适应后的框压住兄弟、挡住连线)
 *
 * ⚠️ 两处都调 nodeSize,但**参数不同**:
 *   buildLayoutRequest  → nodeSize(label, fs)              ← 没传 extraBlocks
 *   projectToInstances  → nodeSize(label, fs, extraBlocks) ← 传了
 * → ELK 按「只有标题」排版,实际框却带着正文长得更大 → 重叠、挡线。
 *
 * ⭐ 这与「字号叠乘」「估算 vs 渲染」是同一形态:**同一份数据两处算,算法不一致**。
 */
import { describe, it, expect } from 'vitest';
import {
  buildLayoutRequest,
  projectToInstances,
  isTreeLineId,
  type LayoutAnswer,
} from '@capabilities/diglot-model/project-to-canvas';
import { noteDocToTree } from '@capabilities/diglot-model/note-projection';

/** 一个带正文(多块)的节点 —— 真机那个「分支Achang123 + 123 + 公式」 */
const richTree = () =>
  noteDocToTree({
    format: 'pm-doc-json', version: '0.1',
    payload: { type: 'doc', content: [
      { type: 'heading', attrs: { level: 1, id: 'root' }, content: [{ type: 'text', text: '主题' }] },
      { type: 'heading', attrs: { level: 2, id: 'm002' }, content: [{ type: 'text', text: '分支Achang123' }] },
      { type: 'paragraph', attrs: { id: 'b1' }, content: [{ type: 'text', text: '123' }] },
      { type: 'mathBlock', attrs: { id: 'b2' }, content: [{ type: 'text', text: 'x^2+1' }] },
      { type: 'heading', attrs: { level: 2, id: 'm003' }, content: [{ type: 'text', text: '分支B' }] },
    ] },
  });

const fakeLayout = (req: ReturnType<typeof buildLayoutRequest>): LayoutAnswer => ({
  nodes: req.nodes.map((n, i) => ({ id: n.id, x: i * 1000, y: i * 100 })),
});

describe('布局尺寸 == 渲染尺寸', () => {
  it('⭐⭐ 同一节点:ELK 拿到的尺寸与 instance 的尺寸**完全一致**', () => {
    const s = richTree();
    const g = new Map();
    const req = buildLayoutRequest(s, g);
    const inst = projectToInstances(s, g, fakeLayout(req)).filter((i) => !isTreeLineId(i.id));

    for (const r of req.nodes) {
      const i = inst.find((x) => x.id === r.id)!;
      expect(i.size!.h, `节点 ${r.id} 高度不一致:布局 ${r.height} vs 实际 ${i.size!.h}`).toBe(r.height);
      expect(i.size!.w, `节点 ${r.id} 宽度不一致:布局 ${r.width} vs 实际 ${i.size!.w}`).toBe(r.width);
    }
  });

  it('⭐⭐ 带正文的节点,布局高度必须**大于**只有标题的兄弟(否则 ELK 不给它留空间)', () => {
    const s = richTree();
    const req = buildLayoutRequest(s, new Map());
    const rich = req.nodes.find((n) => n.id === 'm002')!;
    const plain = req.nodes.find((n) => n.id === 'm003')!;
    expect(rich.height, '带正文的节点在 ELK 眼里和纯标题一样高 → 必然重叠').toBeGreaterThan(
      plain.height,
    );
  });
});

describe('宽度自适应', () => {
  it('⭐⭐ 正文比标题长时,宽度要按**最宽那一行**算', () => {
    const s = noteDocToTree({
      format: 'pm-doc-json', version: '0.1',
      payload: { type: 'doc', content: [
        { type: 'heading', attrs: { level: 1, id: 'root' }, content: [{ type: 'text', text: '短' }] },
        { type: 'paragraph', attrs: { id: 'b1' }, content: [{ type: 'text', text: '这一行正文比标题长得多得多得多' }] },
      ] },
    });
    const req = buildLayoutRequest(s, new Map());
    const inst = projectToInstances(s, new Map(), fakeLayout(req)).filter((i) => !isTreeLineId(i.id));
    const node = inst.find((i) => i.id === 'root')!;

    // 只按「短」算宽 → 会很窄;按最宽行算 → 明显更宽
    const narrowIfTitleOnly = 40 * 3;
    expect(node.size!.w, '宽度只按标题算 → 正文被硬折/溢出').toBeGreaterThan(narrowIfTitleOnly);
  });
});

/**
 * ⭐⭐ 同层级左对齐(用户 2026-09-11:「同一个级别的 shape,应该左边对齐」)
 *
 * ⚠️ 起因:自适应宽度上线后,同层一宽一窄 → 左边缘参差不齐,
 * 宽框向左"探出"压住父节点和连线(真机截图:分支B 盖在连线上)。
 *
 * ⚠️ 实测过 ELK 侧无解:`elk.alignment` 对 mrtree **完全没有效果**
 * (同层 x=176 vs x=306,加不加这个选项一模一样)。
 * ⭐ 故在**投影层**做一次对齐后处理 —— 那里可离线测,也不动共用的布局能力。
 */
describe('同层级左对齐', () => {
  /** 深度 → 该层所有节点的 x */
  const xsByDepth = (s: ReturnType<typeof noteDocToTree>, g: Map<string, never>) => {
    const req = buildLayoutRequest(s, g);
    // 故意给一个「同层 x 参差不齐」的布局结果(复刻 mrtree 的真实输出)
    const layout: LayoutAnswer = {
      nodes: req.nodes.map((n, i) => ({ id: n.id, x: i * 137, y: i * 80 })),
    };
    const inst = projectToInstances(s, g, layout).filter((i) => !isTreeLineId(i.id));
    const byId = new Map(s.nodes.map((n) => [n.id, n]));
    const depthOf = (id: string): number => {
      let d = 0;
      let c = byId.get(id)!;
      while (c.parent) { d++; c = byId.get(c.parent)!; }
      return d;
    };
    const map = new Map<number, number[]>();
    for (const i of inst) {
      const d = depthOf(i.id);
      map.set(d, [...(map.get(d) ?? []), i.position!.x]);
    }
    return map;
  };

  it('⭐⭐ 同一深度的节点 x 坐标必须相同', () => {
    const s = noteDocToTree({
      format: 'pm-doc-json', version: '0.1',
      payload: { type: 'doc', content: [
        { type: 'heading', attrs: { level: 1, id: 'root' }, content: [{ type: 'text', text: '主题' }] },
        { type: 'heading', attrs: { level: 2, id: 'a' }, content: [{ type: 'text', text: '很长很长的分支名字' }] },
        { type: 'heading', attrs: { level: 2, id: 'b' }, content: [{ type: 'text', text: '短' }] },
        { type: 'heading', attrs: { level: 2, id: 'c' }, content: [{ type: 'text', text: '中等长度' }] },
      ] },
    });
    for (const [depth, xs] of xsByDepth(s, new Map())) {
      const uniq = [...new Set(xs)];
      expect(uniq.length, `深度 ${depth} 的节点左边缘不齐:${xs.join(',')}`).toBe(1);
    }
  });

  it('⚠️ 被钉住(G 层有 pos)的节点**不参与**对齐 —— 用户摆的位置优先', () => {
    const s = noteDocToTree({
      format: 'pm-doc-json', version: '0.1',
      payload: { type: 'doc', content: [
        { type: 'heading', attrs: { level: 1, id: 'root' }, content: [{ type: 'text', text: '主题' }] },
        { type: 'heading', attrs: { level: 2, id: 'a' }, content: [{ type: 'text', text: 'A' }] },
        { type: 'heading', attrs: { level: 2, id: 'b' }, content: [{ type: 'text', text: 'B' }] },
      ] },
    });
    const g = new Map([['b', { pos: { x: 9999, y: 8888 } }]]) as never;
    const req = buildLayoutRequest(s, g);
    const layout: LayoutAnswer = { nodes: req.nodes.map((n, i) => ({ id: n.id, x: i * 137, y: i * 80 })) };
    const inst = projectToInstances(s, g, layout).filter((i) => !isTreeLineId(i.id));
    const b = inst.find((i) => i.id === 'b')!;
    expect(b.position, '用户钉的坐标被对齐覆盖了').toEqual({ x: 9999, y: 8888 });
  });
});
