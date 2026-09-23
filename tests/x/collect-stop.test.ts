/**
 * ⭐⭐ 采集的「停」—— 用户 2026-09-22:「是否有一个暂停操作键?」
 *
 * ── 起因(实测)──
 * 采 @KA594594 主页:287 条推里 **261 篇长文**,逐篇进详情页补正文
 * 每篇约 10 秒 → **43 分钟**,而这期间**没有任何办法停下来**。
 * 关掉 app 也不行 —— 那样留痕不落盘,「跑到哪儿了」全部丢失。
 *
 * ⭐ 语义:停 = 「到此为止,把已有的收好」,不是「作废」。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  requestAbort, isAborted, clearAbort, abortedAt,
} from '../../src/platform/main/x/x-collect-abort';

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const read = (f: string) => strip(readFileSync(join(process.cwd(), f), 'utf-8'));

describe('⭐⭐ 行为:停止标志按 ws 分,不互相误伤', () => {
  beforeEach(() => { clearAbort('ws-1'); clearAbort('ws-2'); clearAbort(); });

  it('⭐ 按了停就是停', () => {
    expect(isAborted('ws-1')).toBe(false);
    requestAbort('ws-1');
    expect(isAborted('ws-1'), '按了停却读不到 —— 按钮是摆设').toBe(true);
  });

  it('⚠️⚠️ 停 A 绝不能把 B 也停掉', () => {
    /** ⚠️ 全局一个布尔会让 B「莫名其妙就不采了」,极难定位 */
    requestAbort('ws-1');
    expect(isAborted('ws-2'), '停 ws-1 把 ws-2 也停了 —— 另一个窗口会莫名其妙中断')
      .toBe(false);
  });

  it('⚠️⚠️ 每趟开始必须能清掉 —— 否则下一趟一开始就是「已停」', () => {
    /**
     * ⚠️ 不清的话现象是:点采集**立刻结束、什么也没采**,而报告说「已停止」
     * —— 人会以为自己又按到了什么。
     */
    requestAbort('ws-1');
    clearAbort('ws-1');
    expect(isAborted('ws-1'), '清不掉 —— 下一趟点采集会立刻结束').toBe(false);
  });

  it('⭐ 要记下按的时刻(留痕里写清「什么时候停的」)', () => {
    requestAbort('ws-1');
    expect(abortedAt('ws-1'), '没记时刻 —— 留痕里说不清是什么时候停的').toBeTruthy();
  });
});

describe('⚠️⚠️ 接线:每个长循环都要能停(只在开头问一次 = 没有暂停键)', () => {
  const harvester = read('src/platform/main/x/x-timeline-harvester.ts');
  const backfill = read('src/platform/main/x/x-article-backfill.ts');
  const collect = read('src/platform/main/x/x-auto-collect.ts');
  const view = read('src/views/web-console/WebConsoleView.tsx');

  it('⭐⭐ 补正文循环**每一篇**之前都要检查(43 分钟的大头在这)', () => {
    const i = backfill.indexOf('for (let i = 0; i < batch.length; i++)');
    expect(i, '找不到补正文循环').toBeGreaterThan(0);
    const body = backfill.slice(i, i + 700);
    expect(body, '补正文循环里没有停止检查 —— 按了停还要等半小时,那按钮就是摆设')
      .toMatch(/isAborted\(/);
  });

  it('⭐⭐ 滚动循环每轮都要检查(留空 = 5000 轮)', () => {
    const i = harvester.indexOf('for (let i = 1; i <= maxRounds; i++)');
    expect(i, '找不到滚动循环').toBeGreaterThan(0);
    const body = harvester.slice(i, i + 800);
    expect(body, '滚动循环里没有停止检查 —— 轮数留空时等于 5000 轮停不下来')
      .toMatch(/isAborted\(/);
  });

  it('⭐ 翻页循环也要能停', () => {
    const i = harvester.indexOf('while (pagedRounds < budget');
    expect(i, '找不到翻页循环').toBeGreaterThan(0);
    const body = harvester.slice(i, i + 600);
    expect(body, '翻页循环里没有停止检查').toMatch(/isAborted\(/);
  });

  it('⚠️⚠️ 每趟采集开始必须 clearAbort', () => {
    expect(collect, 'autoCollect 没清上一趟的停止标志 —— 下一趟会立刻结束')
      .toMatch(/clearAbort\(/);
  });

  it('⭐⭐ 「人停的」与「采完了」在报告里绝不能长得一样', () => {
    /**
     * ⚠️ 这是本仓最忌的形态:才补了 80/261 却报「这一页补完了」。
     */
    expect(backfill, '被人停下时没有如实标注 —— 会被当成补完了')
      .toMatch(/被人停下/);
    expect(harvester, '滚动被停时 stopReason 没说明是人停的')
      .toMatch(/人工停止/);
  });

  it('⭐ 面板上要有停止按钮,且只在跑的时候出现', () => {
    expect(view, '面板没有停止按钮').toMatch(/stopCollect\(/);
    const i = view.indexOf('stopCollect(');
    const blk = view.slice(Math.max(0, i - 400), i);
    expect(blk, '停止按钮没有「正在跑才显示」的门控 —— 不跑时按不动的按钮是噪音')
      .toMatch(/busy !== null \?/);
  });
});

describe('⚠️⚠️ 实例没了要能自救(实测连败 32 篇)', () => {
  const backfill = read('src/platform/main/x/x-article-backfill.ts');

  it('⭐⭐ 连续失败要提前停,别白跑几十篇', () => {
    /**
     * ── 2026-09-22 实测 ──
     * 补正文跑到一半 wc#4 被销毁(人切了 tab),于是**连着 32 篇**
     * 全报「指定的 X 实例不存在或已销毁」,每篇还照样等 2.5~4.5 秒。
     */
    expect(backfill, '没有连续失败计数 —— 链路断了会一路白跑到底')
      .toMatch(/consecutiveFailures/);
    const i = backfill.indexOf('consecutiveFailures >= 3');
    expect(i, '没有「连续失败就停」的判据').toBeGreaterThan(0);
  });

  it('⚠️⚠️ 判据必须是「连续」不是「累计」—— 成功一篇要清零', () => {
    /** ⚠️ 用累计的话,一趟里零星失败几篇也会误停(而链路明明是好的) */
    expect(backfill, '成功后没有清零 —— 零星失败会被误判成链路断了')
      .toMatch(/if \(item\.saved\) consecutiveFailures = 0;/);
  });

  it('⭐⭐ 失败后要重新找一个实例(页面还在就能接着跑)', () => {
    const i = backfill.indexOf('backfillOne(t.tweetId');
    expect(i, '找不到补正文调用').toBeGreaterThan(0);
    const blk = backfill.slice(i, i + 700);
    /** ⭐ resolveXWebContents(undefined) 会自己找一个还活着的 X 实例 */
    expect(blk, '实例失效后没重试 —— 人切个 tab 就全线失败')
      .toMatch(/backfillOne\(t\.tweetId, t\.authorHandle, undefined/);
  });

  it('⚠️ 重试失败要保留**原始**错误,别把真因换掉', () => {
    const i = backfill.indexOf('const retry = await backfillOne');
    expect(i, '找不到重试').toBeGreaterThan(0);
    const blk = backfill.slice(i, i + 300);
    expect(blk, '无条件用重试结果覆盖 —— 真因会被换成重试的错误')
      .toMatch(/if \(!retry\.error\) r = retry;/);
  });

  it('⭐⭐ 三种停法在报告里必须分得开', () => {
    /**
     * ⚠️ 「人停的」「链路断了」「补完了」—— 三者长得一样的话,
     * 人会把「才补了 80/262」当成「这一页补完了」。
     */
    for (const [k, why] of [
      ['被人停下', '人停的'],
      ['链路断了提前停', '链路断了'],
    ] as const) {
      expect(backfill, `报告里分不出「${why}」这种停法`).toContain(k);
    }
  });
});

describe('⚠️⚠️ 「翻页」框:实测生效,不许再藏起来', () => {
  const view = read('src/views/web-console/WebConsoleView.tsx');

  it('⭐⭐ 翻页框必须显示 —— 它对推文页同样生效(实测 pagedRounds=10)', () => {
    /**
     * ── 我在这件事上判断错了,记下来免得再犯 ──
     *
     * 用户说「10 页这个参数不生效,就不应该列出来」,我照办**把它藏了**。
     * ⚠️ 但同日实测采 @KA594594 主页(x.profile):
     *   `pagedRounds: 10` / `pagingSkipped: null`,
     *   停止原因明写「游标翻页:达到翻页上限 10 页」
     * —— **它就是靠这个参数停的**,藏错了。
     *
     * ⭐ 真因:我当天刚把翻页闸门从 `people.size > 0` 改成 `gotData`,
     * 推文页从此也能翻页了,而我**没意识到自己已经修好了**,
     * 还拿修好之前的认知去改 UI。
     *
     * ⭐⭐ 教训:**「这个参数生不生效」看留痕的 pagedRounds,别靠读代码推断** ——
     * 我连着推断错两次,两次都是留痕一查就打脸。
     */
    const i = view.indexOf('setAcPages(e.target.value)');
    expect(i, '找不到翻页输入框 —— 它被删掉或藏起来了?').toBeGreaterThan(0);
    const blk = view.slice(Math.max(0, i - 1200), i);
    expect(blk, '翻页框又被按页面门控藏起来了 —— 实测它在推文页生效(pagedRounds=10)')
      .not.toMatch(/peoplePages\.includes\(acPage\) \? \(\s*<label/);
  });
});
