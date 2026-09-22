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

describe('⚠️ 不生效的参数不该显示(用户:「10 页这个参数不生效,就不应该列出来」)', () => {
  const view = read('src/views/web-console/WebConsoleView.tsx');

  it('⭐⭐ 「翻页」框只在采人的页面显示', () => {
    /**
     * ⚠️ 实测踩到:在 x.profile 填「翻页 10」跑了 30+ 分钟,
     * 人以为设的是「只取 10 页」,而它对推文页**根本不生效**
     * (游标翻页只在采人页启动)。
     */
    /**
     * ⚠️⚠️ 锚点不能用 `setAcPages` —— 它**第一处出现是 useState 声明**
     * (文件开头),切出来的是一段无关代码,守卫会假红/假绿。
     * ⭐ 用 `onChange={(e) => setAcPages` —— 它只在输入框那一段出现。
     * (今天第三次栽在 indexOf 命中错位置上,见 feedback-guard-scope-to-the-branch)
     */
    const i = view.indexOf('setAcPages(e.target.value)');
    expect(i, '找不到翻页输入框').toBeGreaterThan(0);
    const blk = view.slice(Math.max(0, i - 900), i);
    expect(blk, '翻页框没有页面门控 —— 在不生效的页面上显示会误导人设错预期')
      .toMatch(/peoplePages\.includes\(acPage\)/);
  });
});
