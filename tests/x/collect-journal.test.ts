/**
 * ⭐⭐ 采集留痕守卫 —— 用户 2026-09-22 拍板的原则:
 *
 * > 「要做一个健康的系统,不仅仅是完成功能,还有对功能的维护很重要。」
 *
 * 起因:面板上一屏判断依据**只渲染一次、关掉就没**,核对只能反过来要用户截图。
 * ⚠️ 与可靠性纲领铁律③的区别:那趟采集**成功**,依据照样蒸发 ——
 * **成功路径也要留痕**。
 *
 * 这条守卫钉两件事:
 * ① `aggregateOps` 必须把同一接口合并(否则有数据也读不出接口间的差异)
 * ② 聚合**不得丢掉**长文深度 —— 那正是判断「哪个入口给得浅」的唯一依据
 */
import { describe, it, expect } from 'vitest';
import { aggregateOps } from '../../src/platform/main/x/x-collect-journal';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 实测形状:x.profile 一趟里 UserOriginalsTimeline 出现四次,各 19/20/20/20 篇长文、带正文全 0 */
const realProfileRun = [
  { op: 'UserOriginalsTimeline', bytes: 90 * 1024, articles: 19, articlesWithBody: 0 },
  { op: 'UserOriginalsTimeline', bytes: 86 * 1024, articles: 20, articlesWithBody: 0 },
  { op: 'UserOriginalsTimeline', bytes: 86 * 1024, articles: 20, articlesWithBody: 0 },
  { op: 'UserOriginalsTimeline', bytes: 86 * 1024, articles: 20, articlesWithBody: 0 },
  { op: 'ViewerBadgeCounts', bytes: 0 },
  { op: 'ViewerBadgeCounts', bytes: 0 },
];

describe('采集留痕:按接口聚合', () => {
  it('⭐ 同一接口的多个载荷合并成一行(面板曾刷四行)', () => {
    const ops = aggregateOps(realProfileRun);
    const timeline = ops.filter((o) => o.op === 'UserOriginalsTimeline');
    expect(timeline).toHaveLength(1);
    expect(timeline[0].count).toBe(4);
  });

  it('⭐⭐ 聚合不得丢长文深度 —— 它是判断「哪个入口给得浅」的唯一依据', () => {
    const t = aggregateOps(realProfileRun).find((o) => o.op === 'UserOriginalsTimeline')!;
    expect(t.articles).toBe(79);      // 19+20+20+20
    expect(t.articlesWithBody).toBe(0); // ⚠️ 实测:主页时间线也没有正文
  });

  it('⚠️ 没有长文的接口不许凭空长出 articles 字段', () => {
    const badge = aggregateOps(realProfileRun).find((o) => o.op === 'ViewerBadgeCounts')!;
    expect(badge.count).toBe(2);
    expect(badge.articles).toBeUndefined();
  });

  it('⭐ 带数据的接口排在杂项前面 —— 0KB 的 ViewerBadgeCounts 不该挡在最前', () => {
    expect(aggregateOps(realProfileRun)[0].op).toBe('UserOriginalsTimeline');
  });

  it('⭐ 深浅两个接口同时出现时,必须各自成行且深度不同', () => {
    const ops = aggregateOps([
      ...realProfileRun,
      { op: 'UserTweets', bytes: 50 * 1024, articles: 2, articlesWithBody: 2 },
    ]);
    const shallow = ops.find((o) => o.op === 'UserOriginalsTimeline')!;
    const deep = ops.find((o) => o.op === 'UserTweets')!;
    expect(shallow.articlesWithBody).toBe(0);
    expect(deep.articlesWithBody).toBe(2);
  });
});

describe('⚠️ 翻页证据必须进留痕(2026-09-22 实测漏掉)', () => {
  const collect = readFileSync(
    join(process.cwd(), 'src/platform/main/x/x-auto-collect.ts'), 'utf-8');

  /** ⚠️ 切到**写留痕**那一处再断言 —— 返回值里也有同名字段,整文件 toMatch 会假绿 */
  const journalCall = (() => {
    const i = collect.indexOf('writeJournal({');
    expect(i, '找不到 writeJournal 调用').toBeGreaterThan(0);
    const seg = collect.slice(i, collect.indexOf('});', i));
    expect(seg.length, '切出来是空的').toBeGreaterThan(200);
    return seg;
  })();

  /**
   * ⚠️⚠️ **这张清单不会自己长** —— 2026-09-23 实测踩到:
   * 昨天补了 hasMore/pagedRounds/pagingSkipped,**没连带补 failedUrl**,
   * 于是搜索页翻页 404 时,「发的是哪条 URL」关掉面板就查不到 ——
   * 只能猜「是 cursor 过期还是 URL 拼错」。
   * ⭐ 判据:凡是**报告里有、用来判断「为什么没采全」**的字段,留痕都要有。
   */
  /**
   * ⚠️⚠️ 2026-09-25 又加一项 `failedProbe` —— 「清单不会自己长」的第三次:
   * 上次补了 failedUrl,但只有 URL **仍然分不出**三种成因
   * (抄错请求 / 游标换坏 / queryId 过期)——
   * 要靠 **content-type + 响应体** 才分得开:
   * 「404 + 非 JSON」= 请求根本没进 GraphQL handler(先查 method)。
   */
  for (const f of ['hasMore', 'pagedRounds', 'pagingSkipped', 'failedUrl', 'failedProbe']) {
    it(`⭐⭐ ${f} 必须写进留痕 —— 面板有、留痕没有 = 关掉就查不到`, () => {
      /**
       * ⚠️ 这三样原来**只在面板和返回值里**,留痕里没有。
       * 后果实测过:我要判「这一页翻没翻页」,只能去读代码推断 ——
       * 而且推错了(以为推文页不会翻页,实际闸门恰好成立)。
       * ⭐ 「四种断法长得一模一样」正是 pagingSkipped 存在的理由,
       * 它自己却没留下来。
       */
      expect(journalCall, `留痕里没有 ${f} —— 「采完没有/翻没翻页」关掉面板就查不到`)
        .toMatch(new RegExp(`${f}:`));
    });
  }
});