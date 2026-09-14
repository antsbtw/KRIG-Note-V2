/**
 * ⭐⭐ 文字内缩改为**固定 10px**(用户 2026-09-11:「固定边距离吧。先按照 10px 观察一下」)
 *
 * ⚠️ 原先内缩 = 圆角半径 `rad = 0.15 × min(w,h)` —— 一个参数管两件事,
 * 且**随框变大而变大**(实测 15.4 → 23.7px)。框越高文字离边越远,
 * 正文可用空间被越挤越小(用户:「占据的空间太大,导致介绍文字的表达空间了」)。
 *
 * ⭐ 固定内缩还顺带消灭了一个隐患:
 * 高度公式里那个 `h ≥ (contentH + 8) / 0.7` 的**自激**(insetY 依赖 h 自己)
 * 变成简单的 `h = contentH + 2×10 + 8` —— 不再需要解析解。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildLayoutRequest,
  projectToInstances,
  isTreeLineId,
  TEXT_INSET_PX,
  type LayoutAnswer,
} from '@capabilities/diglot-model/project-to-canvas';
import { noteDocToTree } from '@capabilities/diglot-model/note-projection';
import { BLOCK_VISUAL_SPEC, headingFontSize } from '../../../src/lib/visual-spec/block-visual-spec';

const LINE = BLOCK_VISUAL_SPEC.body.lineHeight;
const BODY = BLOCK_VISUAL_SPEC.body.fontSize;

const nodeWith = (bodyBlocks: number) => {
  const content: unknown[] = [
    { type: 'heading', attrs: { level: 1, id: 'root' }, content: [{ type: 'text', text: '主题' }] },
    { type: 'heading', attrs: { level: 2, id: 'a' }, content: [{ type: 'text', text: '分支Achang123' }] },
  ];
  for (let i = 0; i < bodyBlocks; i++) {
    content.push({ type: 'paragraph', attrs: { id: `b${i}` }, content: [{ type: 'text', text: '123' }] });
  }
  const s = noteDocToTree({ format: 'pm-doc-json', version: '0.1', payload: { type: 'doc', content } });
  const g = new Map();
  const req = buildLayoutRequest(s, g);
  const layout: LayoutAnswer = { nodes: req.nodes.map((n, i) => ({ id: n.id, x: i * 400, y: i * 300 })) };
  return projectToInstances(s, g, layout).filter((i) => !isTreeLineId(i.id)).find((i) => i.id === 'a')!;
};

describe('文字内缩固定 10px', () => {
  it('⭐ 常量就是 10', () => {
    expect(TEXT_INSET_PX).toBe(10);
  });

  it('⭐⭐ 节点必须声明 params 覆盖 shape 的圆角比例(否则仍走 0.15×min(w,h))', () => {
    const n = nodeWith(1);
    expect(n.params, '没传 params → textBox 仍按比例内缩,固定值不生效').toBeDefined();
  });

  it('⭐⭐ 内缩**不随框变大而变大**(原来 15.4→23.7px)', () => {
    const small = nodeWith(0);
    const big = nodeWith(3);
    expect(big.size!.h).toBeGreaterThan(small.size!.h); // 前提:确实变高了
    // 固定内缩 → 两者的 params 一致,渲染出的内缩也一致
    expect(big.params).toEqual(small.params);
  });

  for (const blocks of [0, 1, 2, 3]) {
    it(`⭐⭐ ${blocks} 块正文:高度 = 内容 + 2×10 + 撑高阈值(不再自激)`, () => {
      const n = nodeWith(blocks);
      const contentH =
        Math.round(headingFontSize(2) * LINE) + Math.round(BODY * LINE) * blocks;
      const need = contentH + 2 * TEXT_INSET_PX + 8;
      expect(n.size!.h, `估算 ${n.size!.h} < 需要 ${need} → 会触发撑高`).toBeGreaterThanOrEqual(need);
      // ⚠️ 也不该过度富余:固定内缩之后高度应该贴着需要走
      expect(n.size!.h, '高度富余过大 → 框仍然空旷').toBeLessThan(need + 30);
    });
  }
});

/**
 * ⭐⭐ 守「真实内缩」而不是「我传了什么参数」
 *
 * ⚠️ 注入验红抓到:把 MIND_CORNER_RATIO 改成 0.3、或把 shape 的 textBox 退回只用 rad,
 * 上面那些断言**照样绿** —— 因为它们只检查 `params` 传了没,
 * 不检查**这套参数经 shape 公式算出来的内缩到底是不是 10**。
 * ⭐ 守卫必须落在**最终效果**上。
 */
describe('真实内缩必须是 10px(算到底,不只看参数)', () => {
  const read = (p: string): string =>
    readFileSync(resolve(__dirname, '../../..', p), 'utf-8');

  /** 按 roundRect.json 的 guides 真算一遍 tpad */
  const actualInset = (w: number, h: number, params: Record<string, number>): number => {
    const def = JSON.parse(
      read('src/capabilities/shape-library/shapes/definitions/basic/roundRect.json'),
    ) as { guides: { name: string; op: string; args: (string | number)[] }[]; textBox: Record<string, string> };

    // ⚠️ textBox 必须真的引用 tpad —— 否则 textPad 传了也白传(注入④)
    expect(def.textBox.l, 'textBox 不再用 tpad → textPad 参数形同虚设').toBe('tpad');

    // ⭐ 按 formula-eval 的同一套 op 语义求值(*/、+-、min)
    const env: Record<string, number> = { ss: Math.min(w, h), w, h, ...params };
    for (const g of def.guides) {
      const a = g.args.map((x) => (typeof x === 'number' ? x : env[x] ?? 0));
      env[g.name] =
        g.op === '*/' ? (a[0] * a[1]) / a[2]
        : g.op === '+-' ? (a[0] + a[1]) - a[2]
        : g.op === 'min' ? Math.min(a[0], a[1])
        : g.op === 'max' ? Math.max(a[0], a[1])
        : NaN;
    }
    expect(Number.isFinite(env.tpad), 'guides 里出现了本守卫不认识的 op —— 需同步更新').toBe(true);
    return env.tpad;
  };

  it('⭐⭐ 各种尺寸下,算出来的内缩都恰好是 10', () => {
    const params = { textPad: TEXT_INSET_PX, r: 0.05 };
    for (const [w, h] of [[118, 76], [252, 130], [600, 400], [137, 93]]) {
      expect(
        actualInset(w, h, params),
        `w=${w} h=${h} 的真实内缩不是 ${TEXT_INSET_PX} —— 圆角比例过大会让 max 取 rad`,
      ).toBe(TEXT_INSET_PX);
    }
  });

  it('⭐⭐ 投影传的那套参数,真算出来也是 10', () => {
    const n = nodeWith(1);
    expect(actualInset(n.size!.w, n.size!.h, n.params as Record<string, number>)).toBe(TEXT_INSET_PX);
  });

  it('⚠️ 画板缺省(不传 textPad)仍等于圆角 —— 既有图元零变化', () => {
    const inset = actualInset(200, 120, { r: 0.15 });
    expect(inset, '缺省行为被改了 → 画板既有圆角矩形的文字位置会变').toBeCloseTo(0.15 * 120, 5);
  });
});
