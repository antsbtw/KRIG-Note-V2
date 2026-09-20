import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { countTimelineEntries } from '../../src/platform/main/x/x-people-harvester';

function strip(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLine = noBlock.replace(/(^|[^:])\/\/.*$/gm, '$1');
  if (noLine.includes('/*') || /(^|[^:])\/\//m.test(noLine)) {
    throw new Error('strip 自检失败:还有注释残留');
  }
  return noLine;
}

/**
 * ⭐⭐ 解析率 —— 「X 给的我都接住了吗」。
 *
 * 用户 2026-09-20:「要求每个页面都能够正确,完整的提取数据」。
 * 有四个页面(notifications/search/home/articles)**没有外部分母**,
 * 对它们这是唯一自给自足的完整性判据。
 */
describe('⭐⭐ 解析率(每个页面都要能答「完整吗」)', () => {
  const harvester = strip(readFileSync(
    join(process.cwd(), 'src/platform/main/x/x-timeline-harvester.ts'), 'utf-8'));

  it('⭐⭐⭐ 行为测试:游标条目不算进分母', () => {
    /**
     * ⚠️ 游标的 entryId 形如 `cursor-bottom-…`,算进分母会让解析率
     * **永远差那么一两条** —— 而「永远差一点」比「明显差很多」更难排查
     * (看着像正常损耗,其实是判据本身错了)。
     */
    const payload = { instructions: [{ entries: [
      { entryId: 'tweet-1', content: {} },
      { entryId: 'tweet-2', content: {} },
      { entryId: 'cursor-bottom-123', content: {} },
      { entryId: 'cursor-top-456', content: {} },
    ] }] };
    expect(
      countTimelineEntries(payload),
      '游标被算进了分母 —— 解析率会永远差一点,看着像损耗其实是判据错',
    ).toBe(2);
  });

  it('⭐⭐ 行为测试:模块容器数里面的叶子,不数容器本身', () => {
    const payload = { entries: [
      { entryId: 'who-to-follow-1', content: { items: [
        { entryId: 'user-1' }, { entryId: 'user-2' },
        { entryId: 'cursor-showmore-9' },
      ] } },
    ] };
    expect(
      countTimelineEntries(payload),
      '模块里的叶子没数对(应为 2:两个用户,游标不算)',
    ).toBe(2);
  });

  it('⭐⭐⭐ 行为测试:真实载荷 + 独立方法交叉验证', () => {
    /**
     * ⭐ 用 2026-09-06 的**真实通知载荷**量,并用**另一种方法**
     * (数 __typename)独立算一遍 —— 两法一致才可信。
     * ⚠️ 单一方法算出来的数**自己证明不了自己**。
     */
    const f = join(process.env.HOME ?? '',
      'Library/Application Support/KRIG Note V2/x-payload-survey',
      'notif-2026-09-06T22-48-48-200Z.json');
    let body: unknown;
    try { body = JSON.parse(readFileSync(f, 'utf-8')); } catch { return; }  // 样本不在就跳过

    const entries = countTimelineEntries(body);
    // 独立方法:数 TimelineTweet / TimelineNotification / TimelineUser
    const kinds: Record<string, number> = {};
    const walk = (n: unknown, d = 0): void => {
      if (d > 30 || n === null || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach((x) => walk(x, d + 1)); return; }
      const o = n as Record<string, unknown>;
      if (typeof o.__typename === 'string') kinds[o.__typename] = (kinds[o.__typename] ?? 0) + 1;
      Object.values(o).forEach((v) => walk(v, d + 1));
    };
    walk(body);
    const byType = (kinds.TimelineTweet ?? 0) + (kinds.TimelineNotification ?? 0)
      + (kinds.TimelineUser ?? 0);
    expect(entries, '真实载荷里一个条目都没数出来').toBeGreaterThan(0);
    expect(
      entries,
      `两种方法对不上:数 entryId=${entries},数 __typename=${byType}`,
    ).toBe(byType);
  });

  it('⭐⭐ 分母必须真的累加(两处解析都要数)', () => {
    /**
     * ⚠️ 滚动阶段和游标翻页阶段是**两条解析路径**,
     * 只在一处数会让翻页那部分的条目凭空消失 —— 解析率虚高。
     */
    const hits = harvester.match(/entriesSeen \+= countTimelineEntries\(/g) ?? [];
    expect(
      hits.length,
      `只在 ${hits.length} 处累加条目数 —— 滚动和游标翻页两条路径都要数,否则解析率虚高`,
    ).toBeGreaterThanOrEqual(2);
  });

  it('⭐⭐ entries=0 时不能编一个比例出来', () => {
    /**
     * 「没有数据」与「0%」含义相反:前者是没得算,后者是全漏了。
     * 本仓纪律:拿不到就**如实说没有**,不编数。
     */
    const assign = harvester.match(/rate: entriesSeen > 0[^,]*/)?.[0] ?? '';
    expect(assign, '找不到 rate 的计算').toBeTruthy();
    expect(
      assign,
      'entries=0 时仍算出一个比例 —— 「没得算」会被显示成「0%全漏了」',
    ).toMatch(/undefined/);
  });
});
