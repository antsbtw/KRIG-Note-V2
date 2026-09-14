/**
 * 缩放控件**真挂载**验证(jsdom)—— 纯函数断言验不到的那一半
 *
 * ⭐⭐ 这里守的两条,都是「看着能用、其实在骗人」的形态:
 * ① 打开一个存了 250% 的画板,**首帧**就得显示 250%。
 *    ⚠️ 病根在 Host:`onViewportChange` 只在**变化时**推,而 `loadDocument`
 *    恢复视口后不推 —— 只靠回调的话,toolbar 会一直显示 100% 直到用户随手拖一下。
 *    (这就是 Host 加 `getViewport()` 的原因。)
 * ② 卸载后订阅必须摘干净 —— 常驻监听没有停止调用就是泄漏。
 *
 * ⚠️ Host 未就绪时显示 `—` 而不是 100%:不要用「兜底成 1」把没有的数据装成有。
 */
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { zoomApi } from '@capabilities/canvas-rendering/interaction/zoom-levels';

// setup.ts 全局 mock 了 requireCapabilityApi 且只认 media-storage — 这里本地覆盖
vi.mock('@slot/capability-registry/get-capability-api', async () => {
  const { zoomApi: z } = await import(
    '@capabilities/canvas-rendering/interaction/zoom-levels'
  );
  return {
    getCapabilityApi: vi.fn(() => undefined),
    requireCapabilityApi: vi.fn((id: string) => {
      if (id === 'canvas-rendering') return { zoom: z };
      throw new Error(`[probe] capability '${id}' not stubbed`);
    }),
  };
});

const { GraphCanvasZoomControl } = await import(
  '@views/graph-canvas-view/GraphCanvasZoomControl'
);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeHost(initialZoom: number | null) {
  let zoom = initialZoom;
  const subs = new Set<() => void>();
  return {
    subs,
    getZoom: () => zoom,
    setZoom: (z: number) => { zoom = z; for (const f of subs) f(); },
    zoomTo: vi.fn((p: number) => { zoom = zoomApi.clamp(p) / 100; }),
    fitToContent: vi.fn(() => { zoom = 3.7; return true; }),
    subscribe: (fn: () => void) => { subs.add(fn); return () => subs.delete(fn); },
  };
}

function mount(host: ReturnType<typeof makeHost>) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => {
    root.render(
      createElement(GraphCanvasZoomControl, {
        getZoom: host.getZoom,
        zoomTo: host.zoomTo,
        fitToContent: host.fitToContent,
        subscribe: host.subscribe,
      }),
    );
  });
  const q = (sel: string) => el.querySelector(sel) as HTMLElement | null;
  const click = (e: HTMLElement | null) => act(() => { e?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  return { el, root, q, click, value: () => q('.krig-graph-canvas-zoom__value')?.textContent };
}

describe('⭐ 缩放控件真挂载', () => {
  it('打开存了 250% 的画板,首帧就显示 250%(不是 100%)', () => {
    const host = makeHost(2.5);
    const m = mount(host);
    expect(m.value()).toBe('250%');
    act(() => m.root.unmount());
  });

  it('滚轮改变缩放 → 显示跟着变', () => {
    const host = makeHost(1);
    const m = mount(host);
    expect(m.value()).toBe('100%');
    act(() => host.setZoom(1.374));
    expect(m.value()).toBe('137%');
    act(() => m.root.unmount());
  });

  it('点 + 跳下一档(137% → 150%)', () => {
    const host = makeHost(1.374);
    const m = mount(host);
    const plus = m.el.querySelectorAll('.krig-graph-canvas-zoom__btn')[1] as HTMLElement;
    m.click(plus);
    expect(host.zoomTo).toHaveBeenCalledWith(150);
    expect(m.value()).toBe('150%');
    act(() => m.root.unmount());
  });

  it('到上限后 + 置灰', () => {
    const host = makeHost(20);
    const m = mount(host);
    expect(m.value()).toBe('2000%');
    const plus = m.el.querySelectorAll('.krig-graph-canvas-zoom__btn')[1] as HTMLButtonElement;
    expect(plus.disabled).toBe(true);
    act(() => m.root.unmount());
  });

  it('下拉:适应窗口 → 调 fitToContent 且显示刷新', () => {
    const host = makeHost(1);
    const m = mount(host);
    m.click(m.q('.krig-graph-canvas-zoom__value'));
    const items = [...m.el.querySelectorAll('.krig-graph-canvas-zoom__item')] as HTMLElement[];
    expect(items[0].textContent).toBe('适应窗口');
    m.click(items[0]);
    expect(host.fitToContent).toHaveBeenCalled();
    expect(m.value()).toBe('370%');
    expect(m.q('.krig-graph-canvas-zoom__menu')).toBeNull();
    act(() => m.root.unmount());
  });

  it('⚠️ 卸载后订阅必须摘干净(常驻监听要有停止调用)', () => {
    const host = makeHost(1);
    const m = mount(host);
    expect(host.subs.size).toBe(1);
    act(() => m.root.unmount());
    expect(host.subs.size, '卸载后仍有订阅 = 泄漏').toBe(0);
  });

  it('⚠️ Host 还没挂时显示 — 而不是骗人的 100%', () => {
    const host = makeHost(null);
    const m = mount(host);
    expect(m.value()).toBe('—');
    act(() => m.root.unmount());
  });
});

/**
 * ⚠️ 注入验红台账(每条实跑过,2026-09-11)
 *
 * | 注入的违规 | 变红的断言 | 结果 |
 * |---|---|---|
 * | 挂载时不读 getViewport,只等回调 | 首帧 250% / 其余 3 条 | 红(4 条) |
 * | subscribe 的退订函数不返回 | 卸载后订阅摘干净 | 红 |
 * | Host 未就绪兜底成 `zoom ?? 1` | 显示 `—` 而非骗人的 100% | 红 |
 */
