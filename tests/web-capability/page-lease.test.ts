/**
 * `web.page` 租约 —— 并发占用与回收(`06` §3.1;验收表 `07` §2.1 第 8 条)
 *
 * 守两件事:
 *  1. **不替应用做「谁该让谁」的判断**(`06` §0):被占用时返回 Failed,不排队不抢占
 *  2. **不泄漏**:页面销毁 / 租约到期,占用都要能回收 —— 否则一个已经不存在的页面
 *     会被永远占着,表现为「功能点了没反应」且不报错
 *
 * ⚠️ 实现上**没有照抄 V1 的 60s setInterval 扫描**,改成惰性回收(读时清)。
 * 理由:记忆 `project-graceful-shutdown` —— 常驻 timer 会吊住 Node 事件循环让进程
 * 不肯退,且本仓铁律要求每个常驻 timer 在 before-quit 有停止调用。
 * 惰性回收没有这个负担,行为等价(对外只看得到「过期后拿得到租约」)。
 */
import { describe, it, expect } from 'vitest';
import { PageRegistry } from '@platform/main/web-capability/page';
import { isOk, isFailed } from '@platform/main/web-capability/result';

/** 可控时钟:让「过期」这件事在测试里是确定的,不靠真等 */
function clockedRegistry() {
  let now = 1_000_000;
  const r = new PageRegistry(() => now);
  return {
    r,
    advance: (ms: number) => { now += ms; },
  };
}

const base = {
  window: 'win-1', ws: 'ws-1', slot: 'left' as const,
  partition: 'persist:webview-ws-1',
  owner: 'x-service', service: 'x', url: 'https://x.com/home',
};

describe('lease —— 互斥占用', () => {
  it('首个 lease 成功,带上 purpose 与 pageId', () => {
    const r = new PageRegistry();
    const page = r.register(base);
    const res = r.lease(page.pageId, '发推');
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) throw new Error('unreachable');
    expect(res.value.pageId).toBe(page.pageId);
    expect(res.value.purpose).toBe('发推');
  });

  it('⭐ 已被占用时返回 Failed(retryable=true),**不排队不抢占**', () => {
    const r = new PageRegistry();
    const page = r.register(base);
    r.lease(page.pageId, '发推');

    const second = r.lease(page.pageId, '采集');
    expect(isFailed(second)).toBe(true);
    if (!isFailed(second)) throw new Error('unreachable');
    // 可重试:对方 release 或到期后就能拿到
    expect(second.retryable).toBe(true);
    // 失败原因要能指认「谁占着」—— 否则排查时无从下手
    expect(second.reason).toContain('发推');
  });

  it('release 后别人才能拿到', () => {
    const r = new PageRegistry();
    const page = r.register(base);
    const first = r.lease(page.pageId, '发推');
    if (!isOk(first)) throw new Error('unreachable');

    expect(isFailed(r.lease(page.pageId, '采集'))).toBe(true);
    expect(isOk(r.release(first.value))).toBe(true);
    expect(isOk(r.lease(page.pageId, '采集'))).toBe(true);
  });

  it('不同页面的租约互不影响', () => {
    const r = new PageRegistry();
    const a = r.register(base);
    const b = r.register({ ...base, ws: 'ws-2' });
    expect(isOk(r.lease(a.pageId, '发推'))).toBe(true);
    expect(isOk(r.lease(b.pageId, '发推'))).toBe(true);
  });

  it('给不存在的页面上租约返回 Failed(不可重试)', () => {
    const r = new PageRegistry();
    const res = r.lease('page_ghost' as never, '发推');
    expect(isFailed(res)).toBe(true);
    if (!isFailed(res)) throw new Error('unreachable');
    expect(res.retryable).toBe(false);
  });

  it('purpose 为空时拒绝 —— 排查「谁占着」时唯一线索不许缺', () => {
    const r = new PageRegistry();
    const page = r.register(base);
    expect(isFailed(r.lease(page.pageId, ''))).toBe(true);
    expect(isFailed(r.lease(page.pageId, '   '))).toBe(true);
  });

  it('ttl 非正数时拒绝(0 / 负数会让租约「一生下来就过期」,是静默失效)', () => {
    const r = new PageRegistry();
    const page = r.register(base);
    expect(isFailed(r.lease(page.pageId, '发推', 0))).toBe(true);
    expect(isFailed(r.lease(page.pageId, '发推', -1))).toBe(true);
  });
});

describe('lease —— ⭐ 回收(造泄漏场景)', () => {
  it('⭐ 租约到期后自动可被再次获取(不需要谁来手动清)', () => {
    const { r, advance } = clockedRegistry();
    const page = r.register(base);
    const first = r.lease(page.pageId, '发推', 5_000);
    expect(isOk(first)).toBe(true);

    // 没到期:仍被占着
    advance(4_999);
    expect(isFailed(r.lease(page.pageId, '采集'))).toBe(true);

    // 到期:可以拿了
    advance(2);
    expect(isOk(r.lease(page.pageId, '采集'))).toBe(true);
  });

  it('⭐ 页面销毁时租约跟着回收 —— 不留「占着一个已不存在的页面」的孤儿', () => {
    const { r } = clockedRegistry();
    const page = r.register(base);
    r.lease(page.pageId, '发推', 60_000);
    expect(r.activeLeases()).toHaveLength(1);

    r.destroy(page.pageId);
    expect(r.activeLeases()).toHaveLength(0);
    expect(r.currentLease(page.pageId)).toBeNull();
  });

  it('⭐ 造泄漏:100 个页面各上租约后全部销毁 → 零残留', () => {
    const { r } = clockedRegistry();
    const ids = [];
    for (let i = 0; i < 100; i++) {
      const p = r.register({ ...base, ws: `ws-${i}` });
      r.lease(p.pageId, `任务-${i}`, 60_000);
      ids.push(p.pageId);
    }
    expect(r.activeLeases()).toHaveLength(100);
    for (const id of ids) r.destroy(id);
    expect(r.activeLeases()).toHaveLength(0);
    expect(r.list()).toHaveLength(0);
  });

  it('⭐ 造泄漏:大批到期租约在 activeLeases 时被清干净', () => {
    const { r, advance } = clockedRegistry();
    for (let i = 0; i < 50; i++) {
      const p = r.register({ ...base, ws: `ws-${i}` });
      r.lease(p.pageId, `任务-${i}`, 1_000);
    }
    expect(r.activeLeases()).toHaveLength(50);
    advance(1_001);
    expect(r.activeLeases()).toHaveLength(0);
  });

  it('无 ttl 的租约不会自己过期(必须显式 release)', () => {
    const { r, advance } = clockedRegistry();
    const page = r.register(base);
    r.lease(page.pageId, '长期占用');
    advance(10 * 60 * 60 * 1000);
    expect(r.currentLease(page.pageId)).not.toBeNull();
  });
});

describe('release —— ⭐ 不许顶掉别人的租约', () => {
  it('⭐ 用过期的旧 leaseId 去 release,不会删掉新持有者的租约', () => {
    // 这是一个真实的静默事故形态:A 的租约过期 → B 拿到 → A 迟来的 release
    // 把 B 的租约删了 → B 以为自己占着,实际没有。
    const { r, advance } = clockedRegistry();
    const page = r.register(base);
    const a = r.lease(page.pageId, 'A 的任务', 1_000);
    if (!isOk(a)) throw new Error('unreachable');

    advance(1_001);
    const b = r.lease(page.pageId, 'B 的任务', 60_000);
    if (!isOk(b)) throw new Error('unreachable');

    // A 迟来的 release
    const stale = r.release(a.value);
    expect(isFailed(stale)).toBe(true);

    // B 的租约必须还在
    const current = r.currentLease(page.pageId);
    expect(current?.leaseId).toBe(b.value.leaseId);
    expect(current?.purpose).toBe('B 的任务');
  });

  it('release 一个已释放的租约返回 Failed(不静默当成功)', () => {
    const r = new PageRegistry();
    const page = r.register(base);
    const lease = r.lease(page.pageId, '发推');
    if (!isOk(lease)) throw new Error('unreachable');
    expect(isOk(r.release(lease.value))).toBe(true);
    expect(isFailed(r.release(lease.value))).toBe(true);
  });
});
