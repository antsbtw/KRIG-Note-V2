/**
 * ⚠️⚠️ 游标翻页**不是采人专用** —— 2026-09-22 用户实测追出来的一刀三处。
 *
 * ── 现象 ──
 * 采 @0xegorai 的长文,X 明说 `hasMore: true`,我们却只拿到 4 篇,
 * 而且「加大轮数/预算」根本没用 —— 因为**游标翻页压根没启动**。
 *
 * ── 真因:三处「只给采人页翻页」的假设 ──
 * ① 抄请求用 `isPeopleOp(op)` → `UserArticlesTweets` 不在名单里,请求从没抄下来
 * ② 翻页闸门用 `people.size > 0` → 纯推文页恒不成立
 * ③ 翻页刹车用「人数没涨就停」→ 长文页作者恒定,翻 3 页必误停
 *
 * ⭐⭐ 三处**任何一处退回去,长文都采不全**,而且现象都是「采到 4 篇然后停」——
 * 看着像「这个账号就 4 篇」,不像 bug。所以三处都要钉。
 *
 * ⚠️ `isPeopleOp` 自己的注释早就写着「⚠️⚠️ 生产代码不用它,也不该用」
 * 「按名字分派 = 静默失败」—— 禁令被违反了却没人发现。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPageDataOp } from '../../src/platform/main/x/x-people-harvester';

function strip(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLine = noBlock.replace(/(^|[^:])\/\/.*$/gm, '$1');
  if (noLine.includes('/*') || /(^|[^:])\/\//m.test(noLine)) {
    throw new Error('strip 自检失败:还有注释残留');
  }
  return noLine;
}

const harvester = strip(readFileSync(
  join(process.cwd(), 'src/platform/main/x/x-timeline-harvester.ts'), 'utf-8'));

/** 翻页循环那一段 —— 切出来再断言,整文件 toMatch 会被滚动循环的同名变量兜住 */
const pagingLoop = (() => {
  const i = harvester.indexOf('while (pagedRounds < budget');
  expect(i, '找不到翻页循环').toBeGreaterThan(0);
  const seg = harvester.slice(i, i + 4000);
  expect(seg.length, '翻页循环切出来是空的').toBeGreaterThan(500);
  return seg;
})();

describe('⭐⭐ 行为:isPageDataOp 认得主数据接口,挡得住杂项', () => {
  const vars = 'https://x.com/i/api/graphql/abc/UserArticlesTweets?variables=%7B%7D';

  it('⚠️⚠️ UserArticlesTweets 必须认 —— 它就是长文采不全的真因', () => {
    expect(isPageDataOp('UserArticlesTweets', vars),
      '长文页的主接口不被认 → 请求抄不下来 → 翻页永不启动 → 只拿到第一屏')
      .toBe(true);
  });

  it('⭐ 推文类接口都要认(不按名字白名单)', () => {
    for (const op of ['UserTweets', 'UserOriginalsTimeline', 'HomeTimeline',
      'SearchTimeline', 'TweetDetail', 'UserMedia']) {
      expect(isPageDataOp(op, vars.replace('UserArticlesTweets', op)),
        `${op} 不被认 —— X 改版出新接口时会静默采不全`).toBe(true);
    }
  });

  it('⭐ 人列表接口照样认(不能为了修推文页把采人弄坏)', () => {
    for (const op of ['Followers', 'Following', 'BlueVerifiedFollowers']) {
      expect(isPageDataOp(op, vars.replace('UserArticlesTweets', op)),
        `${op} 不被认 —— followers 采集那条已跑通的线会坏`).toBe(true);
    }
  });

  it('⚠️⚠️ 杂项必须挡住 —— 它们发生得最晚,会覆盖真请求导致 404', () => {
    for (const op of ['ViewerBadgeCounts', 'DataSaverMode',
      'CreatorStudioTabBarItemQuery', 'UserByScreenName']) {
      expect(isPageDataOp(op, vars.replace('UserArticlesTweets', op)),
        `${op} 没被挡住 —— 它会把真数据请求覆盖掉,翻页第 2 页 HTTP 404`)
        .toBe(false);
    }
  });

  it('⚠️ 没有 variables 的请求不认 —— 塞不进游标,抄了也白抄', () => {
    expect(isPageDataOp('UserTweets', 'https://x.com/i/api/graphql/abc/UserTweets'),
      '没有 variables 却认了 —— withCursor 会返回 null,还会顶掉能翻页的那条')
      .toBe(false);
  });
});

describe('⚠️ 源码:三处「只给采人页」的假设不许回来', () => {
  it('⚠️⚠️ ① 抄请求不许用 isPeopleOp 当闸门', () => {
    const i = harvester.indexOf('lastPeopleReq = {');
    expect(i, '找不到抄请求那一处').toBeGreaterThan(0);
    const blk = harvester.slice(Math.max(0, i - 400), i);
    expect(blk, '抄请求又退回 isPeopleOp —— 推文类页面的请求会抄不下来')
      .not.toMatch(/isPeopleOp\(/);
    expect(blk, '抄请求没用 isPageDataOp').toMatch(/isPageDataOp\(/);
  });

  it('⚠️⚠️ ② 翻页闸门不许只看「采到人」', () => {
    const i = harvester.indexOf('const gate = {');
    expect(i, '找不到翻页闸门').toBeGreaterThan(0);
    const blk = harvester.slice(i, i + 400);
    expect(blk, '闸门又退回「这页采到人」—— 纯推文页恒不成立,永远翻不了页')
      .not.toMatch(/people\.size > 0,/);
    expect(blk, '闸门没用「采到数据」判据').toMatch(/gotData/);
  });

  it('⚠️⚠️ ③ 翻页刹车必须人和推都看', () => {
    /**
     * ⚠️ 只看人的话:长文页每页作者都是同一个,人数恒不涨 →
     * 「连续 3 页没收获」必然成立 → 翻 3 页就停,
     * 而推文其实一直在增加。现象是「采了一点就停」,不报错。
     */
    expect(pagingLoop, '刹车又退回只数人 —— 长文页作者恒定,翻 3 页必误停')
      .not.toMatch(/if \(people\.size === peopleBefore\) \{/);
    expect(pagingLoop, '刹车没把推文数一起看')
      .toMatch(/tweets\.size === tweetsBefore/);
  });

  it('⚠️ 翻页循环必须解析推文(翻了不解 = 白翻,且看着像成功)', () => {
    expect(pagingLoop, '翻页循环没解析推文 —— 翻页拿回来的推会被整页丢掉')
      .toMatch(/extractTweetsFrom\(parsed, tweets\)/);
  });
});
