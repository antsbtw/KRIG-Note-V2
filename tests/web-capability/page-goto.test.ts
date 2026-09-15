/**
 * ⭐⭐ `goto` —— 语义导航(§9.3)**真调函数**
 *
 * ── 为什么每条都必须在 ──
 *
 * `goto` 是控制类最后一块,而它要内建的三条**全是本仓付过学费的**:
 *  ① `loadURL` 要 await —— 不等它,后面的注入会在旧文档拆卸时被拒
 *  ② 但 reject **不算失败** —— 站点自行接管导航时必 reject(X 的 ERR_ABORTED),
 *    页面照样到位。当成失败会让正常导航一律报错
 *  ③ ⭐ **落地校验是必须的** —— 2026-09-07 实测:被弹回首页时
 *    「页面上有推文」照样成立,于是把首页时间线当成搜索结果**整批入库**
 *
 * ⚠️ 这里用**假宿主真跑**:导航是记账 + 改 URL,注入是真求值判据脚本。
 * 只断言「源码里有 loadURL」对上面三条零区分力。
 */
import { describe, it, expect } from 'vitest';
import { ControlEngine } from '@platform/main/web-capability/page';
import type { ControlHost, AnchorResolver } from '@platform/main/web-capability/page';
import type { PageResolver, ReadyCriterion } from '@platform/main/web-capability/page/control-types';
import type { PageId } from '@platform/main/web-capability/page';
import { isOk, isFailed } from '@platform/main/web-capability';

const PAGE = 'page-goto-1' as PageId;

/** 假宿主:导航记账 + 可控落地 URL;注入只认「读 URL」这一个脚本 */
class FakeNavHost implements ControlHost {
  url: string;
  readonly navCalls: string[] = [];
  /** 设了就让 navigate 报 reject(模拟站点接管导航) */
  rejectWith?: string;
  /** 设了就让落地 URL 与请求的不同(模拟被弹回首页) */
  landsAt?: string;
  /** 设了就让 navigate 自己抛(模拟页面已关闭) */
  throwWith?: string;

  constructor(initial = 'https://x.com/home') { this.url = initial; }

  async navigate(_p: PageId, url: string): Promise<{ landedUrl: string; rejected?: string }> {
    this.navCalls.push(url);
    if (this.throwWith) throw new Error(this.throwWith);
    this.url = this.landsAt ?? url;
    return { landedUrl: this.url, rejected: this.rejectWith };
  }

  async evaluate(_p: PageId, script: string): Promise<unknown> {
    if (script.includes('location.href')) return this.url;
    // 判据脚本:urlIncludes 走的是读 URL 那条
    if (script.includes('href')) return this.url;
    throw new Error(`假宿主不认识这段脚本: ${script.slice(0, 50)}`);
  }

  async sleep(): Promise<void> { /* 立刻返回,不真等 */ }
}

const noAnchors: AnchorResolver = { resolve: () => null };

/** 假语义页面表 —— 只认两个页面 */
const fakePages: PageResolver = {
  resolve(name, params) {
    if (name === 'x.home') {
      return { url: 'https://x.com/home', arrival: { kind: 'urlIncludes', fragment: '/home' } as ReadyCriterion, describe: '首页' };
    }
    if (name === 'x.profile') {
      const h = params?.handle;
      if (!h) return null;   // ⚠️ 参数不全不兜底
      return { url: `https://x.com/${h}`, arrival: { kind: 'urlIncludes', fragment: `/${h}` } as ReadyCriterion, describe: `@${h} 主页` };
    }
    return null;
  },
  names: () => ['x.home', 'x.profile'],
};

const engineWith = (host: ControlHost, pages?: PageResolver) =>
  new ControlEngine(host, noAnchors, undefined, pages);

describe('⭐⭐ 语义导航:名字 → URL,业务方不碰 URL', () => {
  it('⭐ 语义名解析出 URL 并真的导航过去', async () => {
    const host = new FakeNavHost();
    const r = await engineWith(host, fakePages).goto(PAGE, { kind: 'semantic', name: 'x.home' });

    expect(isOk(r)).toBe(true);
    expect(host.navCalls).toEqual(['https://x.com/home']);
    if (!isOk(r)) return;
    expect(r.value.describe).toBe('首页');
    expect(r.value.landedUrl).toBe('https://x.com/home');
  });

  it('⭐ 带参数的语义页面(handle 进 URL 也进判据)', async () => {
    const host = new FakeNavHost();
    const r = await engineWith(host, fakePages)
      .goto(PAGE, { kind: 'semantic', name: 'x.profile', params: { handle: 'someone' } });

    expect(isOk(r)).toBe(true);
    expect(host.navCalls[0]).toBe('https://x.com/someone');
  });

  it('⭐⭐ 未登记的页面名 → Failed,且**列出可用的**', async () => {
    const host = new FakeNavHost();
    const r = await engineWith(host, fakePages).goto(PAGE, { kind: 'semantic', name: 'x.nope' });

    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) return;
    expect(r.reason).toContain('未登记');
    // ⭐ 报错要能自救:说出有哪些可用,而不是只说「没有」
    expect(r.reason).toContain('x.home');
    expect(host.navCalls, '没登记却已经导航出去了').toEqual([]);
  });

  it('⭐⭐ 参数不全 → Failed,**不拿默认值顶上**', async () => {
    // 空 handle 会导航到 x.com/(首页),然后被当成「那个人的主页」解析
    const host = new FakeNavHost();
    const r = await engineWith(host, fakePages).goto(PAGE, { kind: 'semantic', name: 'x.profile' });

    expect(isFailed(r)).toBe(true);
    expect(host.navCalls).toEqual([]);
  });

  it('⭐⭐ 没有语义页面表 → Failed(不退化成裸 URL)', async () => {
    const host = new FakeNavHost();
    const r = await engineWith(host).goto(PAGE, { kind: 'semantic', name: 'x.home' });

    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) return;
    expect(r.reason).toContain('没有语义页面表');
  });
});

describe('⭐⭐ 三条血泪必须内建', () => {
  it('⭐⭐ loadURL reject **不算失败** —— 站点接管导航是常态', async () => {
    const host = new FakeNavHost();
    host.rejectWith = 'ERR_ABORTED (-3)';
    const r = await engineWith(host, fakePages).goto(PAGE, { kind: 'semantic', name: 'x.home' });

    expect(isOk(r), 'reject 被当成失败 —— 正常导航会一律报错').toBe(true);
    if (!isOk(r)) return;
    // ⚠️ 但要留痕,否则「为什么慢」无从查起
    expect(r.value.loadRejected).toContain('ERR_ABORTED');
  });

  it('⭐⭐ 落地到别的页 → Failed(到位 ≠ 到对地方)', async () => {
    // 2026-09-07:被弹回首页时「页面上有推文」照样成立,于是整批入库
    const host = new FakeNavHost();
    host.landsAt = 'https://x.com/home';   // 请求 /someone,却落在 /home
    // ⚠️ 必须传短超时:`ready` 默认 6000ms > vitest 用例上限 5000ms,
    //    不传的话「落地校验会不会失败」这条**根本跑不完**(实测撞到过,
    //    与 collect-runner 那条 readyTimeoutMs 的教训同源)。
    const r = await engineWith(host, fakePages).goto(
      PAGE, { kind: 'semantic', name: 'x.profile', params: { handle: 'someone' } },
      { readyTimeoutMs: 80 },
    );

    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) return;
    /**
     * ⚠️ 初版写 `/没落在目标页|未到位/` —— **两种结果都放过**,
     * 于是「我另写的那段落地校验其实是死码」一直没被发现(探针才查出来)。
     * ⭐ 用 `|` 放过多种结果 = 假绿的又一种形态:断言必须钉**实际发生的那条**。
     *
     * 实际路径:落地 URL 不含判据片段 → `ready` 轮询到超时 → 「导航后未到位」。
     * 落地校验由**语义页面表给的 arrival 判据**承担(x.profile 的判据带 handle),
     * 不需要 goto 再比一次。
     */
    expect(r.reason).toContain('未到位');
    expect(r.reason, '没说清是哪条判据没满足').toContain('urlIncludes');
  });

  it('⭐ 宿主自己抛(页面已关闭)→ Failed,且可重试', async () => {
    const host = new FakeNavHost();
    host.throwWith = '页面 xxx 没有对应的渲染目标(已关闭?)';
    const r = await engineWith(host, fakePages).goto(PAGE, { kind: 'semantic', name: 'x.home' });

    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) return;
    expect(r.retryable).toBe(true);
  });

  it('⭐⭐ 宿主没有 navigate 接缝 → Failed(不静默什么也不做)', async () => {
    const noNav: ControlHost = {
      async evaluate() { return 'https://x.com/home'; },
      async sleep() { /* noop */ },
    };
    const r = await engineWith(noNav, fakePages).goto(PAGE, { kind: 'semantic', name: 'x.home' });

    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) return;
    expect(r.reason).toContain('navigate');
  });
});

describe('⭐ kind:url —— 仅 adapter 内部可用', () => {
  it('裸 URL 能导航,判据退化成 path', async () => {
    const host = new FakeNavHost();
    const r = await engineWith(host, fakePages)
      .goto(PAGE, { kind: 'url', url: 'https://x.com/explore' });

    expect(isOk(r)).toBe(true);
    expect(host.navCalls[0]).toBe('https://x.com/explore');
  });

  it('⭐ 裸 URL 落地到别处同样要失败(退化判据也是判据)', async () => {
    const host = new FakeNavHost();
    host.landsAt = 'https://x.com/home';
    const r = await engineWith(host, fakePages).goto(
      PAGE, { kind: 'url', url: 'https://x.com/explore' }, { readyTimeoutMs: 80 },
    );

    expect(isFailed(r)).toBe(true);
  });
});

describe('⭐ 报告返回事实,不是一个光秃秃的 ok', () => {
  it('带得出:请求的 / 落地的 / 耗时 / 描述', async () => {
    const host = new FakeNavHost();
    const r = await engineWith(host, fakePages).goto(PAGE, { kind: 'semantic', name: 'x.home' });

    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.requestedUrl).toBe('https://x.com/home');
    expect(r.value.landedUrl).toBe('https://x.com/home');
    expect(typeof r.value.elapsedMs).toBe('number');
    expect(r.value.describe).toBe('首页');
  });
});
