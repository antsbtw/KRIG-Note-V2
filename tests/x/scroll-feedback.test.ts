import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function strip(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLine = noBlock.replace(/(^|[^:])\/\/.*$/gm, '$1');
  if (noLine.includes('/*')) throw new Error('strip 自检失败');
  return noLine;
}

/**
 * ⭐⭐ 用户 2026-09-19 定的原则:
 * 「要把函数做的健壮,就必须是正反馈的 ——
 *   执行没有?执行结果是什么?能够执行下一步了吗?」
 */
describe('⭐⭐ 滚动必须是闭环(执行→校验→决定)', () => {
  const src = strip(readFileSync(
    join(process.cwd(), 'src/platform/main/x/x-timeline-harvester.ts'), 'utf-8'));
  const loop = (() => {
    const i = src.indexOf('for (let i = 1; i <= maxRounds');
    const j = src.indexOf('⭐⭐ **游标翻页**', i);
    const body = src.slice(i, j > i ? j : i + 9000);
    if (body.length < 500) throw new Error('切不出滚动循环');
    return body;
  })();

  it('⭐⭐ 回读要数 UserCell —— 采人页数 tweet 恒为 0 等于没在看', () => {
    /**
     * ⚠️ 钉**赋值本身** —— 整块 toMatch 会被「换位置」那段里的
     * 同名选择器兜住(实测:把 cells 改成 0,守卫仍全绿 = 假绿)。
     */
    const assign = loop.match(/var cells\s*=\s*([^;]+);/)?.[1] ?? '';
    expect(assign, '找不到 cells 的赋值').toBeTruthy();
    expect(
      assign,
      '回读没真数 UserCell —— 采关注者时恒为 0,「执行结果是什么」无从回答',
    ).toMatch(/querySelectorAll.*UserCell/);
  });

  it('⭐⭐ 滚动进度要看内层容器 —— X 常用内层 div 滚动', () => {
    expect(loop, '没有回读内层滚动容器位置').toMatch(/inner/);
    expect(
      loop,
      '卡住判据只看 window.scrollY —— 内层滚动的页面会被误判成到底',
    ).toMatch(/lastPosKey/);
  });

  it('⭐⭐ 滚不动要**换位置**,不是干等到上限就放弃', () => {
    const i = loop.indexOf('stuck >= 2');
    expect(i, '没有「卡住就换策略」的分支 —— 虚拟列表下会提前截断').toBeGreaterThan(0);
    const blk = loop.slice(i, i + 700);
    expect(
      blk,
      '换位置没用 scrollIntoView —— 盲目 scrollBy 在虚拟列表下不可靠',
    ).toMatch(/scrollIntoView/);
  });

  it('⭐⭐ 停止由**数据**决定,不由人预先猜轮数(PDCA)', () => {
    /**
     * 用户 2026-09-19:「必须有判断--执行--再判断--再执行这样的 PDCA 环」
     *
     * 实测代价:600 轮那跑轮 341 就拿完了,之后 **259 轮零新增**(43% 空转),
     * 程序毫不知情跑到上限。而「该填多少轮」要人查表估算,换账号就不准。
     */
    expect(
      loop,
      '没有「连续 N 轮零新增就停」的判据 —— 只能靠人预先猜轮数',
    ).toMatch(/noGainRounds/);
    const i = loop.indexOf('noGainRounds >=');
    expect(i, '零新增计数没有被用作停止条件').toBeGreaterThan(0);
    const blk = loop.slice(i, i + 400);
    expect(blk, '到底了却不 break').toMatch(/break;/);

    /**
     * ⚠️ 阈值必须**远大于一页的轮间隔**(实测正常最大 7 轮),
     * 否则会在两页之间的正常间隔里误停 —— 那会静默少采。
     */
    const lim = Number(src.match(/NO_GAIN_LIMIT\s*=\s*(\d+)/)?.[1] ?? 0);
    expect(lim, '找不到 NO_GAIN_LIMIT').toBeGreaterThan(0);
    expect(
      lim,
      `阈值 ${lim} 太小 —— 实测页间正常间隔最大 7 轮,小于 20 会在正常间隔里误停`,
    ).toBeGreaterThanOrEqual(20);
  });

  it('⭐ 轮数是安全网不是目标 —— 默认值必须大到走不到', () => {
    const def = Number(src.match(/maxRounds = (\d+)/)?.[1] ?? 0);
    expect(def, '找不到 maxRounds 默认值').toBeGreaterThan(0);
    expect(
      def,
      `默认 ${def} 轮 —— 实测 400 轮才采 2462 人,小于 1000 等于把上限当目标`,
    ).toBeGreaterThanOrEqual(1000);
    const ac = strip(readFileSync(
      join(process.cwd(), 'src/platform/main/x/x-auto-collect.ts'), 'utf-8'));
    expect(
      ac,
      'autoCollect 还在传死轮数 —— 会盖掉「采到底」的默认行为',
    ).not.toMatch(/opts\.maxRounds \?\? \d+/);
  });

  it('⭐⭐ 每轮必须落盘 —— 否则「滚没滚、滚几轮」查不到', () => {
    expect(
      loop,
      '每轮状态没落盘 —— 排查时只能问用户或靠猜(今天为此猜错五次)',
    ).toMatch(/x-scroll\.log/);
    // 必须记录关键三项
    const i = loop.indexOf('x-scroll.log');
    const blk = loop.slice(Math.max(0, i - 500), i + 400);
    expect(blk, '没记录轮次').toMatch(/轮:/);
    expect(blk, '没记录本轮新增').toMatch(/本轮新增人/);
  });
});
