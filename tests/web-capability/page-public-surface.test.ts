/**
 * ⭐ `web.page` 公开面守卫 —— 钉住「能力建好了必须调得到」
 *
 * ── 为什么有这个文件 ──
 * `01-contract.md` §15.1 第 3 条记着一笔债:`ready` / `scrollUntil`
 * **写完了、有测试,但 `page/index.ts` 压根没导出 `control.ts`** ——
 * 于是它们不在包的公开面上,X 想接线也调不到。
 *
 * ⚠️ 这类缺陷**不会让任何测试变红**:
 *  - `page-ready.test.ts` / `page-scroll-until.test.ts` 走的是**深路径**
 *    (`.../page/control`),绕过了 index,所以导出没了它们照样全绿;
 *  - 没有任何测试断言过这个包导出什么。
 * 也就是说,把 `control` 从 index 删掉,全仓 2153 条测试**一条都不会红** ——
 * 而那正是这笔债当初能悄悄躺 5 天的原因。
 *
 * ⭐ 本守卫从**包的公开面**(而不是深路径)取用,所以它红的唯一方式
 * 就是「能力掉出公开面」。写完后已按 `feedback-verify-guard-can-fail`
 * 注入验证过:把 index 的 control 导出删掉 → 本文件立刻红。
 */
import { describe, it, expect } from 'vitest';
import * as page from '@platform/main/web-capability/page';
import { page as pageNs } from '@platform/main/web-capability';
import { isFailed, isOk } from '@platform/main/web-capability';
import { FakeScrollPage, MapAnchors, MapScripts, PAGE } from './helpers/fake-scroll-page';

describe('⭐ web.page 公开面 —— ready / scrollUntil 必须调得到', () => {
  it('包的公开面上有 ControlEngine(§15.1 第 3 条)', () => {
    expect(
      typeof page.ControlEngine,
      'ControlEngine 掉出 web.page 公开面 —— 能力建好了却调不到,正是 §15.1 记的那笔债',
    ).toBe('function');
  });

  it('⭐ 从根命名空间 `web.page` 也拿得到(X 接线走的是这条路)', () => {
    // 接线方写的是 `import { page } from '.../web-capability'`,
    // 只钉子包 index 不够 —— 根 index 少转一层同样会让 X 调不到。
    expect(typeof pageNs.ControlEngine).toBe('function');
  });

  it('四个滚动默认值在公开面上(调用方要能读,不该各自抄一份魔数)', () => {
    expect(page.DEFAULT_STUCK_ROUNDS).toBe(3);
    expect(typeof page.DEFAULT_MAX_ROUNDS).toBe('number');
    expect(typeof page.DEFAULT_SETTLE_MS).toBe('number');
    expect(typeof page.DEFAULT_READY_TIMEOUT_MS).toBe('number');
  });

  it('⭐ 从公开面拿到的 ControlEngine 真能跑 scrollUntil(不是只导出了个名字)', async () => {
    // ⚠️ 只断言 `typeof === 'function'` 挡不住「导出了一个空壳」。
    // 这里真的滚一次:公开面拿到的必须是那个有血泪的实现。
    const host = new FakeScrollPage({ docHeight: 5000, viewport: 1000 });
    const engine = new page.ControlEngine(host, new MapAnchors({}), new MapScripts({}));

    const r = await engine.scrollUntil(PAGE, { kind: 'rounds', n: 2 }, { settleMs: 0 });

    expect(isOk(r) || isFailed(r)).toBe(true);
    if (!isOk(r)) throw new Error(`滚动应成功,实得: ${JSON.stringify(r)}`);
    expect(r.value.rounds).toBe(2);
    // 真滚过 → 位置必须前进(空壳实现给不出这个)
    expect(r.value.scrolledPx).toBeGreaterThan(0);
  });

  it('⭐ ready 同样是真实现(超时走 Failed,不是返 undefined 假装成功)', async () => {
    const host = new FakeScrollPage({ docHeight: 2000, viewport: 1000 });
    const engine = new page.ControlEngine(host, new MapAnchors({ ghost: '#nope' }), new MapScripts({}));

    const r = await engine.ready(
      PAGE,
      { kind: 'anchorAppears', anchor: 'ghost' as never },
      10,
    );

    expect(isFailed(r), '等不到就该 Failed —— 「返回空值假装成功」是本层明令禁止的第四态').toBe(true);
  });
});

describe('⚠️ 两个 ready 签名仍不一致 —— 本步有意不合并,别以为是漏改', () => {
  it('WebPage 接口仍是一份「零实现者」的声明', () => {
    // §15.1 第 3 条还写着「`WebPage.ready()` 的签名与 `ControlEngine.ready()` 不一致」。
    // 这一步只做「上公开面」,**没有**替两者选一个形状:
    //   · WebPage.ready      判据是不透明串,返 Result<PageFacts>,**无人实现、无人引用**
    //   · ControlEngine.ready 判据是四分支联合(含 anchorGone),返 Result<void>,已实现已测
    // 合并要么让接口降级丢掉 anchorGone(那是 x-article-driver 连环失败换来的分支),
    // 要么改写一份没人用的接口 —— 是设计决定,留给接线时连 goto/prepare 一起定。
    //
    // 本用例的作用:**如果将来有人实现了 WebPage,这里会提醒他顺带处理签名分歧**,
    // 而不是让两份 ready 长期并存却没人记得。
    const webPageSource = readSource('src/platform/main/web-capability/page/web-page.ts');
    expect(webPageSource).toMatch(/interface WebPage/);
    expect(
      webPageSource.includes('implements'),
      'WebPage 有实现者了 —— 请同时裁定它与 ControlEngine.ready 的签名分歧(§15.1 第 3 条)',
    ).toBe(false);
  });
});

function readSource(rel: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require('node:path') as typeof import('node:path');
  return readFileSync(join(process.cwd(), rel), 'utf-8');
}
