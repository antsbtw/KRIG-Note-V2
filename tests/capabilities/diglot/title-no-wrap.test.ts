/**
 * ⭐⭐ 标题**绝不折行**(用户 2026-09-11:
 * 「主题框按照 H_n 的文字长度来渲染,**不要自动换行**」)
 *
 * ⚠️ 这条必须用**渲染层自己的度量口径**来断言,否则测试绿、真机照折:
 *   投影 measureText  → 西文 × **0.55**
 *   渲染 estimateAdvance → 西文 × **0.60**   ← 真正决定折不折行的是它
 * 实测「分支Achang123」:我算 195px、渲染 207px,而 textBox 可用宽仅 209px
 * → 只剩 2px 余量,估算再偏一点就折行(真机就是折的)。
 *
 * ⭐ 而且渲染层自己注释写明「估算误差 ±10%」,所以还必须留安全余量。
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

/** ⭐ 与渲染层 estimateAdvance **同一口径**(CJK×1.0 / 其余×0.6) */
const renderWidth = (text: string, fontSize: number): number => {
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    w += code >= 0x4e00 && code <= 0x9fff ? fontSize : fontSize * 0.6;
  }
  return w;
};

const TITLES = ['分支Achang123', '主题278910101次', 'AAAAAAAAAAAAAAAA', '很长很长很长很长的中文标题'];

const projectWith = (title: string, level: number) => {
  const s = noteDocToTree({
    format: 'pm-doc-json', version: '0.1',
    payload: { type: 'doc', content: [
      { type: 'heading', attrs: { level: 1, id: 'root' }, content: [{ type: 'text', text: '主题' }] },
      { type: 'heading', attrs: { level, id: 'a' }, content: [{ type: 'text', text: title }] },
      { type: 'paragraph', attrs: { id: 'b1' }, content: [{ type: 'text', text: '123' }] },
    ] },
  });
  const g = new Map();
  const req = buildLayoutRequest(s, g);
  const layout: LayoutAnswer = { nodes: req.nodes.map((n, i) => ({ id: n.id, x: i * 300, y: i * 200 })) };
  return projectToInstances(s, g, layout).filter((i) => !isTreeLineId(i.id)).find((i) => i.id === 'a')!;
};

describe('标题不折行', () => {
  for (const title of TITLES) {
    it(`⭐⭐ 「${title}」在 textBox 里一行装得下`, () => {
      const inst = projectWith(title, 2);
      // 渲染字号 = headingFontSize(level) × (text_size / 16)
      const fs = headingFontSize(2) * (inst.text_size! / BLOCK_VISUAL_SPEC.body.fontSize);
      // ⭐ 内缩已固定 10px(TEXT_INSET_PX,用户 2026-09-11),不再按 min(w,h) 比例
      const usable = inst.size!.w - 2 * TEXT_INSET_PX;
      const need = renderWidth(title, fs);
      expect(
        usable,
        `可用宽 ${Math.round(usable)} < 渲染实宽 ${Math.round(need)} → 标题会折行`,
      ).toBeGreaterThanOrEqual(need);
    });
  }

  it('⚠️ 还要留 ±10% 的估算误差余量(渲染层自述的误差)', () => {
    const inst = projectWith('分支Achang123', 2);
    const fs = headingFontSize(2) * (inst.text_size! / BLOCK_VISUAL_SPEC.body.fontSize);
    const usable = inst.size!.w - 2 * TEXT_INSET_PX;
    expect(usable, '余量不足 10% → 字体一变就折行').toBeGreaterThanOrEqual(
      renderWidth('分支Achang123', fs) * 1.1,
    );
  });
});

/**
 * ⚠️⚠️ 上面那组断言**挡不住度量漂移** —— 注入验红时抓到:
 * 把 LATIN_ADVANCE_RATIO 改回 0.55、或把误差余量去掉,断言**照样绿**,
 * 因为宽度里有 88px 富余,吸收得掉。
 * ⭐ 所以再钉两条**直接针对不变量**的守卫:度量口径必须同源、余量必须在。
 */
describe('度量必须与渲染层同源(防漂移)', () => {
  const read = (p: string): string =>
    readFileSync(resolve(__dirname, '../../..', p), 'utf-8')
      .split('\n')
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');

  it('⭐⭐ 投影的西文系数 == 渲染层 estimateAdvance 的系数', () => {
    const renderer = read('src/lib/atom-serializers/svg/blocks/textBlock.ts');
    const projection = read('src/capabilities/diglot-model/project-to-canvas.ts');

    // 渲染层里那个系数(estimateAdvance 中的 `fontSize * X`)
    const m = renderer.match(/w \+= fontSize \* ([\d.]+);/);
    expect(m, '渲染层的 estimateAdvance 形态变了,本守卫需同步更新').not.toBeNull();
    const rendererRatio = Number(m![1]);

    const p = projection.match(/const LATIN_ADVANCE_RATIO = ([\d.]+);/);
    expect(p, '投影层缺 LATIN_ADVANCE_RATIO').not.toBeNull();
    const projectionRatio = Number(p![1]);

    expect(
      projectionRatio,
      `度量不同源:投影 ${projectionRatio} vs 渲染 ${rendererRatio} → 测试绿、真机折行`,
    ).toBe(rendererRatio);
  });

  it('⭐ 估算误差余量必须 > 1(渲染层自述 ±10%)', () => {
    const projection = read('src/capabilities/diglot-model/project-to-canvas.ts');
    const m = projection.match(/const ESTIMATE_MARGIN = ([\d.]+);/);
    expect(m, '缺 ESTIMATE_MARGIN').not.toBeNull();
    expect(Number(m![1]), '余量去掉了 → 字体/字号一变就折行').toBeGreaterThan(1);
  });
});
