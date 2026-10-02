/**
 * 采集会话 —— ⭐⭐ **只管「收到了什么、够不够」**,不碰页面
 *
 * ── 用户 2026-10-02 ──
 * 「不要改变前面的逻辑,**控制是控制,采集是采集**。
 * 　你现在是简化了,但是**违背了逻辑**。控制/输出是分开的。」
 *
 * ⚠️ 本文件上一版钉的是「采够了就停滚」「真到底才停」——
 * 那些**全是控制的职责**,钉在采集层本身就是那个错误的固化。
 * ⭐ 现在钉的是分工:采集层**不许**出现任何页面动作。
 */

import { describe, it, expect, vi } from 'vitest';
import {
  startAcquire, peekAcquire, finishAcquire, awaitEnough,
} from '@platform/main/web-capability/acquire/acquire';
import type { AcquireDeps, AcquiredItem } from '@platform/main/web-capability/acquire/types';
import type { PageId } from '@platform/main/web-capability/page/types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PAGE = 'p1' as unknown as PageId;

const item = (url: string, from: AcquiredItem['from'] = 'cdp'): AcquiredItem => ({
  url, method: 'POST', status: 200, text: '{}', byteLength: 2,
  at: new Date().toISOString(), from,
});

function deps(plan: {
  pool?: AcquiredItem[];
  cdpAttached?: boolean;
  hookInstalled?: boolean;
  hookInjected?: boolean;
} = {}) {
  const pool: AcquiredItem[] = [...(plan.pool ?? [])];
  const calls = { start: 0, stop: 0 };
  let t = 0;
  const d: AcquireDeps = {
    async startAll() {
      calls.start += 1;
      return {
        cdpAttached: plan.cdpAttached ?? true,
        hookInstalled: plan.hookInstalled ?? true,
      };
    },
    stopAll() { calls.stop += 1; },
    snapshot() { return [...pool]; },
    legStats() { return { hookInjected: plan.hookInjected ?? true }; },
    now: () => { t += 100; return t; },
  };
  return { d, calls, pool };
}

describe('⭐⭐⭐ 采集层不许碰页面', () => {
  it('⭐⭐⭐ `AcquireDeps` 里**没有**任何页面动作', () => {
    /**
     * ⚠️ 这是本次重构的核心约束 —— 用户:「控制是控制,采集是采集」。
     * ⭐ 从**源码**钉:接口里出现 reload/scroll/navigate 就是把控制揉了回来。
     */
    const src = readFileSync(
      resolve(__dirname, '../../src/platform/main/web-capability/acquire/types.ts'), 'utf-8',
    );
    const iface = src.slice(src.indexOf('export interface AcquireDeps'));
    const body = iface.slice(0, iface.indexOf('\n}'));
    expect(body.length, '切出来的接口是空的 —— 断言会恒真').toBeGreaterThan(50);

    for (const bad of ['reload', 'scroll', 'navigate', 'goto', 'click']) {
      expect(body, `AcquireDeps 里出现了页面动作「${bad}」—— 控制又被揉进采集了`)
        .not.toMatch(new RegExp(`\\b${bad}`, 'i'));
    }
  });

  it('⭐⭐ 采集的实现里也不许调页面动作', () => {
    const src = readFileSync(
      resolve(__dirname, '../../src/platform/main/web-capability/acquire/acquire.ts'), 'utf-8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    /**
     * ⚠️ 注入验证抓到:我第一版找 `deps.reload` 这种**字面串**,
     * 而 `(deps as any).reload?.(pageId)` **绕过去了** —— 全绿。
     * ⭐ 改成按**动作名 + 调用括号**匹配,不管前面挂在谁身上。
     */
    for (const bad of ['reload', 'scrollOnce', 'navigate', 'loadURL']) {
      expect(
        src,
        `采集里调了页面动作「${bad}(」—— 页面该由**控制那栏**动`,
      ).not.toMatch(new RegExp(`\\b${bad}\\s*(\\?\\.)?\\s*\\(`));
    }
    // ⭐ 反向锁:确认这段源码真的读到了(空串会让上面恒绿)
    expect(src.length, '源码没读到 —— 断言恒真').toBeGreaterThan(500);
    expect(src, '读错文件了?').toContain('startAcquire');
  });

  it('⭐ 报告里**没有**轮次/滚动像素 —— 那是控制那栏的报告', () => {
    /** ⚠️ 两边各记一份会漂,而漂的表现是「两栏的数对不上」 */
    const src = readFileSync(
      resolve(__dirname, '../../src/platform/main/web-capability/acquire/types.ts'), 'utf-8',
    );
    const rep = src.slice(src.indexOf('export type AcquireReport'));
    const body = rep.slice(0, rep.indexOf('\n};'));
    expect(body).not.toMatch(/readonly rounds\s*:/);
    expect(body).not.toMatch(/readonly scrolledPx\s*:/);
  });
});

describe('⭐⭐ 开始收', () => {
  it('⭐ 把两条腿都装上,**立即返回**', async () => {
    const { d, calls } = deps();
    const r = await startAcquire(d, PAGE);
    expect(calls.start).toBe(1);
    expect(r.ok).toBe(true);
    expect(r.cdpAttached).toBe(true);
    expect(r.hookInstalled).toBe(true);
  });

  it('⭐⭐ 只有一条腿起来 → **仍算成功**(降级不是失败)', async () => {
    /** ⚠️ 少一条腿照样能收 —— 这正是多条腿的意义 */
    const { d } = deps({ hookInstalled: false });
    expect((await startAcquire(d, PAGE)).ok, '少一条腿被当成了失败').toBe(true);
  });

  it('⭐⭐ 两条都没起来 → 失败', async () => {
    const { d } = deps({ cdpAttached: false, hookInstalled: false });
    expect((await startAcquire(d, PAGE)).ok).toBe(false);
  });
});

describe('⭐ 查看进度:纯读', () => {
  it('⭐ peek 不停、不改任何状态', () => {
    const { d, calls } = deps({ pool: [item('https://x.com/api/1'), item('https://x.com/b', 'hook')] });
    const r = peekAcquire(d, PAGE, { wantUrlIncludes: ['/api/'] });
    expect(r.total).toBe(2);
    expect(r.wanted).toBe(1);
    expect(calls.stop, 'peek 把采集停了 —— 它该是纯读').toBe(0);
  });

  it('⭐ 各腿计数如实', () => {
    const { d } = deps({
      pool: [item('https://x.com/1', 'cdp'), item('https://x.com/2', 'hook'),
        item('https://x.com/3', 'both')],
    });
    const r = peekAcquire(d, PAGE);
    expect([r.cdp, r.hook, r.both]).toEqual([1, 1, 1]);
  });
});

describe('⭐⭐ 停止并报告:problems 空才算采全', () => {
  it('⭐ 停的时候真的把腿停了', () => {
    const { d, calls } = deps({ pool: [item('https://x.com/api/1')] });
    finishAcquire(d, PAGE, { wantUrlIncludes: ['/api/'] });
    expect(calls.stop, '没停 —— 会一直收').toBe(1);
  });

  it('⭐⭐ 一条都没收到 → 报问题,并**指向控制那栏**', () => {
    /** ⭐ 提示要能告诉人下一步做什么 —— 页面没动过是最常见的原因 */
    const { d } = deps({ pool: [] });
    const r = finishAcquire(d, PAGE);
    expect(r.ok).toBe(false);
    expect(r.problems.join(''), '没提示去控制那栏翻页').toContain('控制');
  });

  it('⭐⭐ 收到了但没一条命中目标 → 报问题(最误导的一种)', () => {
    /** ⚠️ 2026-10-02 实测:captured=72 而**一条推文都没有** */
    const { d } = deps({ pool: [item('https://video.twimg.com/a.m4s')] });
    const r = finishAcquire(d, PAGE, { wantUrlIncludes: ['/i/api/graphql/'] });
    expect(r.ok).toBe(false);
    expect(r.problems.join('')).toContain('没有一条');
    expect(r.items.length, '不完整就把数据丢了').toBe(1);
  });

  it('⭐⭐ 不足目标页数 → 报问题,并提示去多翻几页', () => {
    const { d } = deps({ pool: [item('https://x.com/i/api/graphql/HomeTimeline')] });
    const r = finishAcquire(d, PAGE, {
      wantUrlIncludes: ['/i/api/graphql/'], wantAtLeast: 2,
    });
    expect(r.ok).toBe(false);
    expect(r.problems.join(''), '没说清不足').toContain('不足目标');
    expect(r.problems.join(''), '没提示去控制那栏多翻几页').toContain('控制');
  });

  it('⭐⭐ `ok` 由 `problems` 算出,不是独立字段', () => {
    const { d } = deps({ pool: [item('https://x.com/api/1')] });
    const r = finishAcquire(d, PAGE, { wantUrlIncludes: ['/api/'] });
    expect(r.ok).toBe(r.problems.length === 0);
  });

  it('⭐ 各腿计数进报告 —— 它回答「为什么只收到这么点」', () => {
    const { d } = deps({
      pool: [item('https://x.com/1', 'cdp'), item('https://x.com/2', 'both')],
      hookInjected: false,
    });
    const r = finishAcquire(d, PAGE);
    expect(r.legs.cdp).toBe(1);
    expect(r.legs.both, 'both 是互证成功的直接证据').toBe(1);
    expect(r.legs.hookInjected, '注入状态没如实回报').toBe(false);
  });
});

describe('⚠️ awaitEnough:可选的便利函数,仍不碰页面', () => {
  it('⭐ 够了就返回', async () => {
    const pool = [item('https://x.com/i/api/graphql/A'), item('https://x.com/i/api/graphql/B')];
    const { d } = deps({ pool });
    const sleep = vi.fn(async () => undefined);
    const r = await awaitEnough(d, PAGE, {
      wantUrlIncludes: ['/i/api/graphql/'], wantAtLeast: 2, maxMs: 5000,
    }, sleep);
    expect(r.ok).toBe(true);
    expect(r.stopReason).toContain('已采够');
  });

  it('⭐⭐ 等不到就超时 —— **不无限等**', async () => {
    const { d } = deps({ pool: [] });
    const sleep = vi.fn(async () => undefined);
    const r = await awaitEnough(d, PAGE, { wantAtLeast: 5, maxMs: 500 }, sleep);
    expect(r.stopReason, '没超时就返回了?').toContain('超时');
    expect(r.ok, '什么都没收到却报采全').toBe(false);
  });
});
