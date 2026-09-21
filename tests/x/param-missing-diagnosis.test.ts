import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function strip(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLine = noBlock.replace(/(^|[^:])\/\/.*$/gm, '$1');
  if (noLine.includes('/*') || /(^|[^:])\/\//m.test(noLine)) {
    throw new Error('strip 自检失败:还有注释残留');
  }
  return noLine;
}

/**
 * ⭐⭐ 「参数不全」不能报成「页面名未登记」。
 *
 * ── 用户 2026-09-20 实测 ──
 * 选 x.status 没填 tweetId,报:
 *   「未登记的页面名『x.status』—— 可用:…, x.status, …」
 * **同一句话说它未登记、又把它列进可用清单** —— 自相矛盾。
 *
 * ⚠️ 同一个坑 2026-09-18 踩过一次(verifiedFollowers 没传 handle),
 * 那次只修了参数框渲染、**没修消息本身**,换个页面又踩一遍。
 */
describe('⭐⭐ 参数不全 vs 页面名不认识:两种原因要分开', () => {
  const handler = strip(readFileSync(
    join(process.cwd(), 'src/platform/main/ipc/web-console-handler.ts'), 'utf-8'));
  const control = strip(readFileSync(
    join(process.cwd(), 'src/platform/main/web-capability/page/control.ts'), 'utf-8'));
  const ui = strip(readFileSync(
    join(process.cwd(), 'src/views/web-console/WebConsoleView.tsx'), 'utf-8'));

  it('⭐⭐⭐ autoCollect:名字在表里就不能说「未登记」', () => {
    const i = handler.indexOf('if (!resolved) {');
    expect(i, '找不到解析失败的处理').toBeGreaterThan(0);
    const blk = handler.slice(i, i + 1400);
    expect(
      blk,
      '解析失败时没有区分「名字不认识」和「参数不全」—— '
      + '会报出「未登记 x.status」而清单里就有 x.status 的自相矛盾消息',
    ).toMatch(/known\.includes\(pageName\)/);
    /** ⚠️ 钉**真的算了缺哪个**,不是「提了一嘴参数」 */
    const assign = blk.match(/const missing\s*=\s*([^;]+);/)?.[1] ?? '';
    expect(assign, '找不到 missing 的计算').toBeTruthy();
    expect(assign, '没有真的算出缺哪个参数').toMatch(/need\.filter/);
  });

  it('⭐⭐⭐ goto:同一处矛盾也要修(两条路径都会撞)', () => {
    const i = control.indexOf('if (!hit) {');
    expect(i, '找不到 goto 的解析失败处理').toBeGreaterThan(0);
    const blk = control.slice(i, i + 1400);
    expect(
      blk,
      'goto 解析失败时没区分两种原因 —— 用户点「跳过去」会看到同样的矛盾消息',
    ).toMatch(/names\.includes\(target\.name\)/);
    expect(blk, '没说清是参数的问题').toMatch(/参数/);
  });

  it('⭐⭐ 面板:参数没填就该**拦住**,不是点完才报错', () => {
    const assign = ui.match(/const missing\s*=\s*([^;]+);/)?.[1] ?? '';
    expect(assign, '面板没有算缺哪些参数').toBeTruthy();
    expect(assign, '缺参数的判断不是从真表来的').toMatch(/need\.filter/);
    /** ⚠️ 钉**按钮真的被禁用**,不是只显示个提示 */
    const disabled = (ui.match(/disabled=\{busy !== null \|\| blocked\}/g) ?? []).length;
    expect(
      disabled,
      `只有 ${disabled} 个按钮在缺参数时禁用 —— 跳过去/采集/快速增量三个都该拦`,
    ).toBeGreaterThanOrEqual(3);
  });

  it('⭐ 有默认值的参数不算缺(搜索的 f)', () => {
    /**
     * ⚠️ x.search 的 `f` 有默认值,把它算成「缺」会让搜索页永远点不了 ——
     * 那是**过度拦截**,比不拦更糟(功能直接没了)。
     */
    const assign = ui.match(/const missing\s*=\s*([^;]+);/)?.[1] ?? '';
    expect(
      assign,
      '没有排除有默认值的参数 —— 搜索页会被误拦成「缺参数」永远点不了',
    ).toMatch(/'f'/);
  });
});

/**
 * ⭐⭐ 失败那次的入参必须查得到 —— 最需要诊断的偏偏是它。
 */
describe('⭐⭐ 失败路径的可诊断性', () => {
  const handler = strip(readFileSync(
    join(process.cwd(), 'src/platform/main/ipc/web-console-handler.ts'), 'utf-8'));

  it('⭐⭐⭐ failFast 必须能记入参(写死 {} 会让失败那次查不到)', () => {
    /**
     * ⚠️ 用户 2026-09-20 实测:x.status 报「参数不全」,留痕里却没有 params,
     * 我据此推断「参数没传到后端」—— **那个推断是错的**,参数传了,
     * 只是 failFast 把入参写死成 `{}`。
     * ⭐ 最需要诊断的恰恰是失败那次,而它偏偏留痕最空。
     */
    const i = handler.indexOf('function failFast');
    expect(i, '找不到 failFast').toBeGreaterThan(0);
    const sig = handler.slice(i, handler.indexOf('{', handler.indexOf(')', i)));
    expect(
      sig,
      'failFast 没有入参形参 —— 失败那次的入参永远查不到',
    ).toMatch(/input/);
    const body = handler.slice(i, i + 500);
    expect(
      body,
      'failFast 仍把入参写死成 {} —— 等于没记',
    ).toMatch(/recordRun\(fn, input/);
  });

  it('⭐⭐⭐ 参数解析失败要交出**收到的实际值**,不能只说「不合法」', () => {
    /**
     * ⚠️ 报「参数都有,但值不合法」却不说是哪个值、长什么样 ——
     * 排查者只能回去猜(我为此查了解析器/preload/面板传参四处,全是对的,
     * 因为真值根本没进视野)。
     * ⭐ 必须用 JSON.stringify:空串/纯空格/零宽字符/类型不对
     * 在肉眼下长得一模一样,只有 repr 分得开。
     */
    const i = handler.indexOf('const shown =');
    expect(i, '诊断消息没有交出实际收到的值').toBeGreaterThan(0);
    const line = handler.slice(i, i + 200);
    expect(
      line,
      '实际值没有用 JSON.stringify —— 空串/空格/零宽字符肉眼分不出',
    ).toMatch(/JSON\.stringify/);
  });
});
