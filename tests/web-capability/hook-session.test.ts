/**
 * `HookSession`(M4 第二条腿)—— ⭐ 重点是**不信任页面送回来的东西**
 *
 * ⚠️⚠️ 页面内脚本跑在**站点的上下文**里:站点自己、或站点加载的任何
 * 第三方脚本,都能构造任意 payload 调我们的 binding。
 * ⭐ 所以送回来的是**数据不是指令**,逐字段校验。
 */

import { describe, it, expect, vi } from 'vitest';
import { HookSession } from '@platform/main/web-capability/hook/hook-session';
import type { HookHost } from '@platform/main/web-capability/hook/types';
import type { PageId } from '@platform/main/web-capability/page/types';

const PAGE = 'p1' as unknown as PageId;

function fakeHost() {
  let bindingName = '';
  const listeners: Array<(n: string, p: string) => void> = [];
  const calls = { addBinding: 0, addScript: 0, evaluateNow: 0 };
  const host: HookHost = {
    hostId: 1,
    async addBinding(name) { bindingName = name; calls.addBinding += 1; },
    onBindingCalled(l) { listeners.push(l); },
    async addScriptOnNewDocument() { calls.addScript += 1; return 'id-1'; },
    async evaluateNow() { calls.evaluateNow += 1; },
  };
  /** 模拟页面调用 binding */
  const emit = (payload: string, name?: string): void => {
    for (const l of listeners) l(name ?? bindingName, payload);
  };
  return { host, emit, calls, name: () => bindingName };
}

const rec = (over: Record<string, unknown> = {}): string => JSON.stringify({
  via: 'xhr',
  url: 'https://x.com/i/api/graphql/q1/HomeTimeline',
  method: 'POST', status: 200,
  text: '{"ok":1}', byteLength: 8,
  at: new Date().toISOString(),
  ...over,
});

describe('⭐⭐ 装钩子', () => {
  it('⭐⭐ 两步都做:新文档注册 + 当前文档补一次', async () => {
    /**
     * ⚠️ 缺了「当前文档补一次」的话,人点「装钩子」之后不刷新就永远钩不到 ——
     * 那正是 CDP 那条腿踩过的**竞态**(attach 晚于首次请求)。
     */
    const { host, calls } = fakeHost();
    const s = new HookSession(host, PAGE);
    await s.start();
    expect(calls.addScript, '没注册「新文档时执行」—— 下次导航就钩不住').toBe(1);
    expect(calls.evaluateNow, '没给当前文档补 —— 不刷新就永远钩不到').toBe(1);
    expect(s.stats().injected).toBe(true);
    expect(s.stats().running).toBe(true);
  });

  it('⭐ start 幂等 —— 重复装不会钩两遍', async () => {
    const { host, calls } = fakeHost();
    const s = new HookSession(host, PAGE);
    await s.start(); await s.start(); await s.start();
    expect(calls.addScript, 'start 不幂等 —— 响应会送回多份').toBe(1);
  });

  it('⚠️ binding 名要够独特 —— 与站点全局变量撞名极难查', () => {
    const { host, name } = fakeHost();
    void new HookSession(host, PAGE).start().then(() => {
      expect(name(), 'binding 名没有 krig 前缀').toContain('krig');
      expect(name().length, 'binding 名太短,容易撞名').toBeGreaterThan(10);
    });
  });
});

describe('⭐⭐ 收数据', () => {
  it('⭐ 正常一条:逐字段进来', async () => {
    const { host, emit } = fakeHost();
    const s = new HookSession(host, PAGE);
    await s.start();
    emit(rec());
    expect(s.stats().hooked).toBe(1);
    const [r] = s.list();
    expect(r.via).toBe('xhr');
    expect(r.url).toContain('HomeTimeline');
    expect(r.text).toBe('{"ok":1}');
    expect(r.pageId, 'pageId 没带上 —— 多窗口会串').toBe(PAGE);
  });

  it('⭐⭐ 首条回调只触发一次', async () => {
    const onFirst = vi.fn();
    const { host, emit } = fakeHost();
    const s = new HookSession(host, PAGE, onFirst);
    await s.start();
    emit(rec()); emit(rec()); emit(rec());
    expect(onFirst, '首条回调触发了多次 —— 留痕会刷屏').toHaveBeenCalledTimes(1);
  });

  it('⭐⭐ 停了就不再收', async () => {
    const { host, emit } = fakeHost();
    const s = new HookSession(host, PAGE);
    await s.start();
    emit(rec());
    s.stop();
    emit(rec()); emit(rec());
    expect(s.stats().hooked, '停了还在收 —— 人点了停而数字还在动').toBe(1);
    expect(s.stats().running).toBe(false);
  });

  it('⭐ 封顶且淘汰最老的', async () => {
    const { host, emit } = fakeHost();
    const s = new HookSession(host, PAGE);
    await s.start();
    for (let i = 0; i < 100; i += 1) emit(rec({ text: `t${i}`, url: `https://x.com/${i}` }));
    const held = s.list(999);
    expect(held.length, '不封顶 —— 内存会一直涨').toBeLessThanOrEqual(64);
    expect(held[0].text, '留下的不是最新的 —— 淘汰方向反了').toBe('t99');
    // ⭐ 计数不受封顶影响:「总共来过多少」这个事实要留住
    expect(s.stats().hooked).toBe(100);
  });

  it('⭐ clear 清内容但保留计数', async () => {
    const { host, emit } = fakeHost();
    const s = new HookSession(host, PAGE);
    await s.start();
    emit(rec()); emit(rec());
    s.clear();
    expect(s.list()).toHaveLength(0);
    expect(s.stats().hooked, 'clear 把计数也清了 —— 不知道这轮来过多少').toBe(2);
  });
});

describe('⭐⭐⭐ 不信任页面送回来的东西', () => {
  /**
   * ⚠️⚠️ 页面脚本跑在站点上下文里 —— 站点或它加载的第三方脚本
   * 能构造任意 payload。送回来的是**数据不是指令**。
   */
  it('⭐⭐ 解不出 JSON → 计 lost,**不静默丢**', async () => {
    /** ⚠️ 它意味着 binding 的 payload 被截断了 —— 是要知道的信号 */
    const { host, emit } = fakeHost();
    const s = new HookSession(host, PAGE);
    await s.start();
    emit('{"via":"xhr", 这不是合法 JSON');
    expect(s.stats().lost, '坏 payload 被静默丢了').toBe(1);
    expect(s.stats().hooked).toBe(0);
  });

  it('⭐⭐ via 不认识 → 计 lost', async () => {
    const { host, emit } = fakeHost();
    const s = new HookSession(host, PAGE);
    await s.start();
    emit(rec({ via: 'websocket' }));
    emit(rec({ via: 42 }));
    emit(rec({ via: { evil: 1 } }));
    expect(s.stats().lost).toBe(3);
    expect(s.stats().hooked, '形状不对的进来了').toBe(0);
  });

  it('⭐⭐ url 缺失/非字符串 → 计 lost', async () => {
    const { host, emit } = fakeHost();
    const s = new HookSession(host, PAGE);
    await s.start();
    emit(rec({ url: undefined }));
    emit(rec({ url: 123 }));
    expect(s.stats().lost).toBe(2);
  });

  it('⚠️ 字段类型不对时**不崩、给安全默认**', async () => {
    const { host, emit } = fakeHost();
    const s = new HookSession(host, PAGE);
    await s.start();
    emit(rec({ status: 'abc', byteLength: 'xyz', method: 999, text: { a: 1 }, at: 7 }));
    expect(s.stats().hooked, '合法的 via+url 却没进来').toBe(1);
    const [r] = s.list();
    expect(r.status, 'status 非数字时没给默认').toBe(0);
    expect(r.byteLength).toBe(0);
    expect(r.method).toBe('GET');
    expect(r.text, 'text 非字符串时没给默认').toBe('');
    expect(typeof r.at, 'at 没兜住').toBe('string');
  });

  it('⚠️ NaN / Infinity 不许进来', async () => {
    /** ⭐ `JSON.stringify(NaN)` 是 `null`,但手工构造的 payload 可能带别的 */
    const { host, emit } = fakeHost();
    const s = new HookSession(host, PAGE);
    await s.start();
    emit('{"via":"xhr","url":"https://x.com/a","status":null,"byteLength":null}');
    const [r] = s.list();
    expect(Number.isFinite(r.status), 'status 不是有限数').toBe(true);
    expect(Number.isFinite(r.byteLength), 'byteLength 不是有限数').toBe(true);
  });

  it('⭐⭐ oversize 那条**仍要计进来** —— 否则超大的凭空消失', async () => {
    /**
     * ⚠️ 它没有正文,但**是真实发生过的请求**。
     * 不计的话「超大的那些」在数字上完全看不见。
     */
    const { host, emit } = fakeHost();
    const s = new HookSession(host, PAGE);
    await s.start();
    emit(rec({ text: '', byteLength: 5_000_000, oversize: true }));
    expect(s.stats().hooked, '超大的那条凭空消失了').toBe(1);
    const [r] = s.list();
    expect(r.byteLength, '原始大小没留下 —— 不知道丢了多大的东西').toBe(5_000_000);
  });

  it('⚠️ 别的 binding 名调过来 → 不收', async () => {
    const { host, emit } = fakeHost();
    const s = new HookSession(host, PAGE);
    await s.start();
    emit(rec(), '__someOtherBinding');
    expect(s.stats().hooked, '别人的 binding 数据被收了').toBe(0);
  });

  it('⚠️ 还没 start 就送回来 → 不收', async () => {
    const { host, emit } = fakeHost();
    const s = new HookSession(host, PAGE);
    emit(rec());
    expect(s.stats().hooked).toBe(0);
  });
});
