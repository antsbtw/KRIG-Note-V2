/**
 * ⭐⭐ 折叠隐藏样式必须住在 driver 层,且压得住行内块
 *
 * 真机现象(2026-09-10):note 里标题收起了、虚线也出来了,**公式却没收起来**。
 *
 * 两个叠在一起的毛病:
 *  ① 隐藏规则原本只写在 `src/views/note/toc/toc.css` —— note 的**私有样式**,
 *    却服务于 driver 层的折叠能力。别的 view(如导图语义面)用同一个 plugin,
 *    要靠「NoteView 恰好挂过、CSS 已进全局 bundle」才生效 = 隐式依赖。
 *  ② 特异度输了:`.ProseMirror .heading-collapsed-hidden` 是 0,2,0,
 *    而 `.krig-pm-host .ProseMirror .krig-math-inline{display:inline-block}`
 *    是 0,3,0 → **公式把自己显示回来**。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const css = readFileSync(resolve(ROOT, 'src/drivers/text-editing-driver/pm-host.css'), 'utf-8');

describe('折叠隐藏样式', () => {
  it('⭐⭐ 隐藏规则必须在 driver 的 pm-host.css(不能只靠 note 的私有样式)', () => {
    expect(
      css,
      '折叠能力在 driver 层,样式却不在 → 别的 view 用同一 plugin 会藏不住内容',
    ).toContain('.heading-collapsed-hidden');
  });

  it('⭐⭐ 必须 !important —— 否则行内公式(特异度更高)会把自己显示回来', () => {
    const idx = css.indexOf('.heading-collapsed-hidden');
    const block = css.slice(idx, idx + 400);
    expect(block, '缺 !important → 公式 display:inline-block(0,3,0)赢过隐藏规则').toMatch(
      /display:\s*none\s*!important/,
    );
  });

  it('⭐ 要连**后代**一起藏(NodeView 渲出来的内层元素也可能自带 display)', () => {
    const idx = css.indexOf('.heading-collapsed-hidden');
    const block = css.slice(idx - 200, idx + 400);
    expect(block).toMatch(/\.heading-collapsed-hidden\s*\*/);
  });

  it('⚠️ 公式那条规则仍在(没有为了让折叠生效而把它删掉)', () => {
    expect(css).toContain('.krig-math-inline');
    expect(css).toMatch(/\.krig-math-inline\s*\{[^}]*display:\s*inline-block/);
  });
});
