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
import { headingFontSize } from '../../../src/lib/visual-spec/block-visual-spec';

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
  it('⭐⭐ 宽度由**标题**决定,正文再长也在框内折行(用户 2026-09-11 拍板)', () => {
    // ⚠️ 本条原来断言的是「按最宽那一行(含正文)算」—— **已被用户推翻**:
    //   「应该按照 hn 的长度来确定主题框的长度,除非用户手动缩短。」
    // ⭐ 而且那条旧规则有害:一行长正文能把框撑得很宽,
    //   反过来标题装不下就折行 → 撑高 → 吃掉兄弟间距(真机 85px→11px)。
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

    // 标题是「短」一个字 → 框应贴着标题走,不被长正文撑开。
    // ⚠️ 此时生效的是**下限** minW = fontSize×3(防「空标签变成一条缝」),
    //    不是正文宽度 —— 断言按下限写,别按我手算的期望值写(手算过一次就错了)。
    const fs = 38; // h1
    const minW = Math.round(fs * 3);
    expect(node.size!.w, '正文把框撑宽了 —— 应由标题定宽').toBe(minW);
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

/**
 * ⭐⭐ 同层级**同宽**(用户 2026-09-11:
 * 「同一种类型的图元,使用不同的处理方法,是有问题的哦」)
 *
 * ⚠️ 只做左对齐不够:同层一个 240px、一个 116px,
 * **右边缘参差不齐**,连接点(E 磁吸在右边缘)也就一个在前一个在后,
 * 连线出发点忽左忽右 —— 看起来像"同一种图元被两套规则处理"。
 *
 * ⭐ 同层 = 同一种图元 = 同样的处理方法:**取该层最宽**,全层统一。
 * ⚠️ 高度不统一 —— 内容多的本来就该更高(那是内容差异,不是处理方法差异)。
 */
describe('同层级:规则一致,不是结果一致', () => {
  /**
   * ⚠️ 本组原本断言「同层必须同宽」—— **已被用户推翻**(2026-09-11):
   * 「不用强调所有同级的主题框都一样长吧?各自根据 hn 的文字长度就好了。」
   * ⭐ 「同一种图元用同一种处理方法」指的是**规则一致**(宽度都由 hn 决定),
   *    不是**结果一致**。把短标题硬撑长,反而是拿另一套规则去改它。
   */
  const tree = () =>
    noteDocToTree({
      format: 'pm-doc-json', version: '0.1',
      payload: { type: 'doc', content: [
        { type: 'heading', attrs: { level: 1, id: 'root' }, content: [{ type: 'text', text: '主题' }] },
        { type: 'heading', attrs: { level: 2, id: 'a' }, content: [{ type: 'text', text: '分支Achang123' }] },
        { type: 'paragraph', attrs: { id: 'b1' }, content: [{ type: 'text', text: '123' }] },
        { type: 'heading', attrs: { level: 2, id: 'b' }, content: [{ type: 'text', text: '分支B' }] },
      ] },
    });

  const project = () => {
    const s = tree();
    const g = new Map();
    const req = buildLayoutRequest(s, g);
    const layout: LayoutAnswer = { nodes: req.nodes.map((n, i) => ({ id: n.id, x: i * 137, y: i * 80 })) };
    return projectToInstances(s, g, layout).filter((i) => !isTreeLineId(i.id));
  };

  it('⭐⭐ 标题短的节点**就该窄**(不被同层最宽者撑长)', () => {
    const inst = project();
    const a = inst.find((i) => i.id === 'a')!; // 长标题
    const b = inst.find((i) => i.id === 'b')!; // 短标题
    expect(b.size!.w, '短标题被硬撑到与长标题同宽').toBeLessThan(a.size!.w);
  });

  it('⭐ 但规则一致:两者的宽度都由**各自的 hn** 推出', () => {
    const inst = project();
    const fs = headingFontSize(2);
    const need = (t: string): number => {
      let w = 0;
      for (const ch of t) {
        const c = ch.codePointAt(0) ?? 0;
        w += c >= 0x4e00 && c <= 0x9fff ? fs : fs * 0.6;
      }
      return w;
    };
    for (const [id, title] of [['a', '分支Achang123'], ['b', '分支B']] as const) {
      const n = inst.find((i) => i.id === id)!;
      const rad = 0.15 * Math.min(n.size!.w, n.size!.h);
      expect(n.size!.w - 2 * rad, `${id} 的可用宽装不下自己的标题`).toBeGreaterThanOrEqual(need(title));
    }
  });

  it('⚠️ 高度也各自按内容算(内容多的更高)', () => {
    const inst = project();
    const a = inst.find((i) => i.id === 'a')!;
    const b = inst.find((i) => i.id === 'b')!;
    expect(a.size!.h).toBeGreaterThan(b.size!.h);
  });
});
