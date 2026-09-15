/**
 * ⭐⭐ 盯人采集守卫(`x-watchlist-collect.ts` + 调度器接线)
 *
 * 守的是 §8 那半个还没被证明的判据:
 *
 * > 「拿 `author-watch` 当第二个实现,**只有第二个接进来时零改动**,
 * >   『可插拔』才算被证明。」
 *
 * 前半(能注册/能取/能生成三个答案)已由 `collect-strategy-registry.test.ts` 钉住;
 * 本文件钉后半:**它真的被调用了,而且没有另写一套滚动**。
 *
 * ⚠️ 全是扫源码断言 —— 真跑一轮需要活的 X webview,属 D 类真机验证,CI 够不着。
 * 所以这里守的是「结构上不可能退化成旧形态」,不是「跑起来对不对」。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf-8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const COLLECT = read('src/platform/main/x/x-watchlist-collect.ts');
const COLLECT_CODE = stripComments(COLLECT);
const SCHED = read('src/platform/main/x/x-search-scheduler.ts');
const SCHED_CODE = stripComments(SCHED);
const TYPES = read('src/shared/types/x-timeline-types.ts');

describe('⭐⭐ 盯人采集真的接上了(§8 的后半个证明)', () => {
  it('⭐⭐ 调度器**真的调**了 collectWatchlist —— 不是建好没人用', () => {
    expect(SCHED_CODE, '调度器没 import 盯人采集').toContain('collectWatchlist');
    expect(SCHED_CODE, '有 import 但没调用 = 「四层齐了唯独采集循环不存在」原样复发')
      .toMatch(/await\s+collectWatchlist\(/);
  });

  it('⭐⭐ 有常驻 timer,且**必须**在 stopScheduler 里停(graceful-shutdown 铁律)', () => {
    expect(SCHED_CODE).toMatch(/watchlistTimer\s*=\s*setInterval/);
    const stopBody = SCHED_CODE.slice(SCHED_CODE.indexOf('export function stopScheduler'));
    expect(
      stopBody,
      '常驻 timer 没有停止调用 —— before-quit 走不完,Ctrl+C 退不掉(踩过)',
    ).toMatch(/clearInterval\(watchlistTimer\)/);
    expect(stopBody).toMatch(/watchlistTimer\s*=\s*null/);
  });

  it('⭐ 盯人周期与配方采集**错开**(共用同一个 webview,频率相近会互相顶掉)', () => {
    const m = SCHED_CODE.match(/watchlistTimer\s*=\s*setInterval\([\s\S]{0,400}?\},\s*([\d_*\s]+)\)/);
    expect(m, '找不到 watchlistTimer 的周期').toBeTruthy();
    // 配方是 60_000;盯人必须明显更长
    expect(m![1]).toContain('60_000');
    expect(m![1], '周期应是「N * 60_000」的形式,与 60s 轮询错开').toMatch(/\d+\s*\*\s*60_000/);
  });
});

describe('⭐⭐ 复用执行器,绝不另写一套滚动', () => {
  it('⭐⭐ 零处导航 / 滚动 / 等待代码', () => {
    // 「同一 bug 修三遍」的根因就是每个策略各写一遍滚动
    for (const banned of [/loadURL/, /scrollBy/, /scrollTop/, /window\.scrollY/, /stuckRounds/]) {
      expect(COLLECT_CODE, `盯人采集自己写了 ${banned} —— 必须走执行器`).not.toMatch(banned);
    }
  });

  it('⭐ 走 runCollectStrategy + authorWatchStrategy', () => {
    expect(COLLECT_CODE).toMatch(/runCollectStrategy\(\s*[\s\S]{0,40}authorWatchStrategy/);
  });

  it('⭐⭐ 提取复用同一份 extractVisibleTweets,不复制第二份', () => {
    expect(COLLECT_CODE).toContain('extractVisibleTweets');
    // 复制一份出去,那条「连续注入失败才说不是导航撞车」的教训就只在其中一份里
    expect(COLLECT_CODE, '盯人采集自带了提取脚本 = 第二份实现').not.toContain('TWEET_SCRAPE_FN_BODY');
  });
});

describe('⭐⭐ watchlist 推文不进 AI 判断队列(schema 那条规则)', () => {
  it('⭐⭐ status 用 collected,**绝不是** pending', () => {
    expect(COLLECT_CODE).toMatch(/status:\s*'collected'/);
    expect(
      COLLECT_CODE,
      "置 pending 会刷爆 Gemma 队列、污染待处理收件箱(schema x-schema.ts:97)",
    ).not.toMatch(/status:\s*'pending'/);
  });

  it('⭐ collected 是正式状态,不是随手塞的字符串', () => {
    expect(TYPES, "TweetInboxStatus 里没有 'collected'").toMatch(/\|\s*'collected'/);
  });

  it('⭐⭐ 但**照样入库** —— 措辞纪律:「不进判断队列」≠「不采」', () => {
    // 用户 2026-09-03 已定:采集层无条件全采全存,
    // 「原先在采集层就把推荐流丢掉,结果是丢掉的永远查不回来」
    expect(COLLECT_CODE).toMatch(/await\s+upsertTweet\(/);
    expect(COLLECT_CODE).toMatch(/source:\s*'watchlist'/);
  });

  it('⭐ 回过的 collected 必须能流转走,不留僵尸行', () => {
    const REL = stripComments(read('src/platform/main/db/x-reply-relation-repo.ts'));
    const move = REL.match(/UPDATE x_tweet SET status = 'replied'[\s\S]{0,200}?;/);
    expect(move, '找不到挪走语句').toBeTruthy();
    expect(move![0], "collected 没被挪走 —— 这批行更隐蔽,它们本来就不在「待判」里")
      .toContain("'collected'");
  });
});

describe('⭐ 采集纪律', () => {
  it('⭐⭐ 被屏蔽的人不采(屏蔽优先于追踪)', () => {
    expect(COLLECT_CODE).toMatch(/accountBlacklist\.includes\(/);
  });

  it('⭐⭐ 单人失败不中止整批,但必须记进 failures(不静默)', () => {
    /**
     * ⚠️ 2026-09-14 改写:初稿用 `indexOf('result.elapsedMs = Date.now()')`
     * 当循环末尾的锚点 —— 但 `elapsedMs` 在**接口声明**里就出现过一次,
     * `indexOf` 取的是**第一次**(文件顶部),于是判据恒假(3987 < 1541 不成立)。
     * ⭐ 找代码位置别用可能在别处同名的字符串,更别用 indexOf 取「最后一处」。
     */
    expect(COLLECT_CODE).toMatch(/failures\.push\(/);

    const loopStart = COLLECT_CODE.indexOf('for (const w of watched)');
    expect(loopStart, '找不到名单循环').toBeGreaterThan(0);
    // 收尾赋值是**最后**一次出现(接口声明里也有同名字段)
    const loopEnd = COLLECT_CODE.lastIndexOf('result.elapsedMs = Date.now()');
    expect(loopEnd, '找不到循环后的收尾').toBeGreaterThan(loopStart);

    const catchPos = COLLECT_CODE.indexOf('failures.push(');
    expect(catchPos, 'catch 不在循环内 —— 一个人失败会让整批停下').toBeGreaterThan(loopStart);
    expect(catchPos, '同上:catch 跑到循环外面去了').toBeLessThan(loopEnd);
  });

  it('⭐⭐ 只收这个人自己的推(/with_replies 上也有他回复的别人原推)', () => {
    expect(
      COLLECT_CODE,
      '不校验作者就会把名单外的人也采进来',
    ).toMatch(/normalizeHandle\(t\.authorHandle[\s\S]{0,30}!==\s*handle/);
  });

  it('⭐⭐ 计数集合是**每人局部**,不是模块级共享', () => {
    // 模块级会让上一个人的条数算进下一个人的进度 → 第二个人一轮就被判「收够了」;
    // 多 ws 并发时两边计数互相污染,而两边都不报错
    const decl = COLLECT_CODE.match(/const perAuthorSeen = new Set<string>\(\);/g) ?? [];
    expect(decl.length, 'perAuthorSeen 应恰好声明一次').toBe(1);
    const declPos = COLLECT_CODE.indexOf('const perAuthorSeen');
    const loopPos = COLLECT_CODE.indexOf('for (const w of watched)');
    expect(declPos, 'perAuthorSeen 声明在循环外 = 模块级/整批共享').toBeGreaterThan(loopPos);
  });

  it('⭐ 中止标志与配方采集各用各的(互不干扰)', () => {
    expect(COLLECT_CODE).toMatch(/watchAbortMap/);
    expect(COLLECT_CODE, '复用 scanAbortMap 会让停一个连带停另一个').not.toMatch(/scanAbortMap/);
  });
});
