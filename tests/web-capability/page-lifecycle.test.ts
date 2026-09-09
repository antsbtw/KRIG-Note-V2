/**
 * `web.page` 生命周期事件 —— 供 web.trace 消费(本步只发,不接消费者)
 *
 * 守的是**事件与身份的一致性**:trace 断不断,取决于同一个浏览上下文是不是
 * 始终用同一个 pageId 发事件(`06` §1.6)。
 *
 * 另守一条本仓吃过亏的:**一个坏监听器不许拖垮登记处,但必须留痕**
 * (可靠性纲领:反静默坍缩)。
 */
import { describe, it, expect, vi } from 'vitest';
import { PageRegistry } from '@platform/main/web-capability/page';
import type { PageLifecycleEvent } from '@platform/main/web-capability/page';

const base = {
  window: 'win-1', ws: 'ws-1', slot: 'left' as const,
  partition: 'persist:webview-ws-1',
  owner: 'x-service', service: 'x', url: 'https://x.com/home',
};

function collect() {
  const events: PageLifecycleEvent[] = [];
  const r = new PageRegistry();
  const unsubscribe = r.subscribeLifecycle((e) => { events.push(e); });
  return { r, events, unsubscribe };
}

describe('生命周期事件', () => {
  it('register 发 page-created,带完整 facts', () => {
    const { r, events } = collect();
    const page = r.register(base);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('page-created');
    expect(events[0].pageId).toBe(page.pageId);
  });

  it('destroy 发 page-destroyed;销毁不存在的页面不发事件', () => {
    const { r, events } = collect();
    const page = r.register(base);
    r.destroy(page.pageId);
    expect(events.map((e) => e.kind)).toEqual(['page-created', 'page-destroyed']);

    r.destroy(page.pageId);
    expect(events).toHaveLength(2);
  });

  it('url 变化发 page-navigated;url 没变不发', () => {
    const { r, events } = collect();
    const page = r.register({ ...base, url: 'https://x.com/home' });
    r.update(page.pageId, { url: 'https://x.com/compose/post' });
    r.update(page.pageId, { url: 'https://x.com/compose/post' });   // 同值,不该发
    r.update(page.pageId, { state: 'complete' });                    // 非 url,不该发

    const navigated = events.filter((e) => e.kind === 'page-navigated');
    expect(navigated).toHaveLength(1);
  });

  it('⭐ 跨站导航的事件仍挂在同一个 pageId 上(trace 不断成两截)', () => {
    const { r, events } = collect();
    const page = r.register({ ...base, service: 'x', url: 'https://x.com/home' });
    r.update(page.pageId, { service: 'google', url: 'https://google.com' });

    const navigated = events.find((e) => e.kind === 'page-navigated');
    expect(navigated?.pageId).toBe(page.pageId);
    if (navigated?.kind === 'page-navigated') {
      expect(navigated.service).toBe('google');
    }
  });

  it('换 slot / ws / window 发 page-moved', () => {
    const { r, events } = collect();
    const page = r.register(base);
    r.update(page.pageId, { slot: 'right' });
    r.update(page.pageId, { ws: 'ws-2' });
    r.update(page.pageId, { window: 'win-2' });
    r.update(page.pageId, { state: 'complete' });   // 非位置,不该发

    expect(events.filter((e) => e.kind === 'page-moved')).toHaveLength(3);
  });

  it('unsubscribe 之后不再收到事件', () => {
    const { r, events, unsubscribe } = collect();
    r.register(base);
    unsubscribe();
    r.register(base);
    expect(events).toHaveLength(1);
  });

  it('⭐ 一个监听器抛错不拖垮其它监听器,且留痕(不静默吞)', () => {
    const r = new PageRegistry();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const good: string[] = [];
    r.subscribeLifecycle(() => { throw new Error('坏监听器'); });
    r.subscribeLifecycle((e) => { good.push(e.kind); });

    expect(() => r.register(base)).not.toThrow();
    expect(good).toEqual(['page-created']);
    expect(warn).toHaveBeenCalled();   // ⭐ 必须留痕
    warn.mockRestore();
  });
});
