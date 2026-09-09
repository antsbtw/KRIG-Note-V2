/**
 * `web.page` find 契约 —— **底座不替调用方挑**(`06` §2)
 *
 * 这一条是本层唯一的铁律,也是**现有 bug 的根源**:
 *   `createWebviewServiceRegistry` 的「最后 navigate 胜出」是底座替应用做了选择,
 *   而它没资格做 —— 它不知道业务意图。
 *
 * 实测后果(`x-host-registry.ts` 注释原文):
 *   用户同时开了内置浏览器 X 和 AI-view X,发推注入会打到「最后 navigate 的」那个,
 *   内容落进了用户没在看的实例 → **「日志说注入成功,但右栏框是空的」**。
 *
 * 所以下面测的核心是:**有 2 个就返回 2 个**,绝不悄悄给 1 个。
 * 底座不保证「挑得对」,只保证「不替你挑」。
 */
import { describe, it, expect } from 'vitest';
import { PageRegistry } from '@platform/main/web-capability/page';

function reg() {
  return new PageRegistry();
}

const base = {
  window: 'win-1',
  ws: 'ws-1',
  slot: 'left' as const,
  partition: 'persist:webview-ws-1',
  owner: 'x-service',
  service: 'x',
  url: 'https://x.com/home',
};

describe('find —— ⭐ 多个候选时如实返回全部', () => {
  it('⭐⭐ 两个候选返回 2 条,不是 1 条(不许替调用方挑)', () => {
    const r = reg();
    // 复刻真实事故场景:AI view 的 X 和内置浏览器的 X 同时开着
    r.register({ ...base, owner: 'ai-service', slot: 'right' });
    r.register({ ...base, owner: 'browser', tabId: 'tab-1' });

    const hits = r.find({ service: 'x' });
    expect(hits).toHaveLength(2);
  });

  it('⭐ 三个同 ws 同 slot 的 tab 全部返回,不去重、不合并', () => {
    const r = reg();
    r.register({ ...base, tabId: 'tab-1' });
    r.register({ ...base, tabId: 'tab-2' });
    r.register({ ...base, tabId: 'tab-3' });

    const hits = r.find({ ws: 'ws-1', slot: 'left' });
    expect(hits).toHaveLength(3);
    expect(new Set(hits.map((h) => h.pageId)).size).toBe(3);
  });

  it('⭐ 「最后 navigate 胜出」不复活:后导航的页面不会挤掉先前的', () => {
    const r = reg();
    const first = r.register({ ...base, owner: 'ai-service' });
    const second = r.register({ ...base, owner: 'browser' });
    // 让 second 后导航一次 —— 旧 registry 就是在这里让它「胜出」的
    r.update(second.pageId, { url: 'https://x.com/compose/post' });

    const hits = r.find({ service: 'x' });
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.pageId).sort()).toEqual([first.pageId, second.pageId].sort());
  });
});

describe('find —— ⭐ 找不到时不兜底', () => {
  it('⭐ 零命中返回空数组,**不返回「随便一个」**', () => {
    const r = reg();
    r.register({ ...base, ws: 'ws-1' });
    r.register({ ...base, ws: 'ws-2' });

    const hits = r.find({ ws: 'ws-does-not-exist' });
    expect(hits).toEqual([]);
  });

  it('⭐ 条件完全不匹配时,不降级成「忽略这个条件」', () => {
    // 典型兜底反模式:「按 owner 找不到?那就忽略 owner 返回全部」。
    const r = reg();
    r.register({ ...base, owner: 'x-service' });
    r.register({ ...base, owner: 'ai-service' });

    expect(r.find({ owner: 'nobody-owns-this' })).toEqual([]);
  });

  it('空登记处返回空数组,不抛', () => {
    expect(reg().find({ ws: 'ws-1' })).toEqual([]);
  });
});

describe('find —— 条件是「与」关系,逐维精确匹配', () => {
  it('多个条件同时生效(全部满足才命中)', () => {
    const r = reg();
    const target = r.register({ ...base, ws: 'ws-1', slot: 'left', owner: 'x-service' });
    r.register({ ...base, ws: 'ws-1', slot: 'right', owner: 'x-service' });
    r.register({ ...base, ws: 'ws-2', slot: 'left', owner: 'x-service' });
    r.register({ ...base, ws: 'ws-1', slot: 'left', owner: 'ai-service' });

    const hits = r.find({ ws: 'ws-1', slot: 'left', owner: 'x-service' });
    expect(hits).toHaveLength(1);
    expect(hits[0].pageId).toBe(target.pageId);
  });

  it('无条件 find 返回全部', () => {
    const r = reg();
    r.register({ ...base });
    r.register({ ...base, ws: 'ws-2' });
    expect(r.find()).toHaveLength(2);
    expect(r.find({})).toHaveLength(2);
  });

  it('urlIncludes 是子串匹配', () => {
    const r = reg();
    r.register({ ...base, url: 'https://x.com/compose/post' });
    r.register({ ...base, url: 'https://x.com/home' });
    r.register({ ...base, url: 'https://google.com', service: 'google' });

    expect(r.find({ urlIncludes: 'x.com' })).toHaveLength(2);
    expect(r.find({ urlIncludes: 'compose' })).toHaveLength(1);
    expect(r.find({ urlIncludes: 'nope' })).toHaveLength(0);
  });

  it('⭐ owner 区分「X 服务的页面」和「浏览器里恰好停在 x.com 的 tab」', () => {
    // `06` §2.3 的原话:两者不是同一类东西,但**怎么用这个区分仍是应用的事**
    // (例:剪藏就是要操作浏览器 tab,那完全合理)。
    const r = reg();
    const xService = r.register({ ...base, owner: 'x-service' });
    const browserTab = r.register({ ...base, owner: 'browser', tabId: 'tab-1' });

    expect(r.find({ owner: 'x-service' }).map((h) => h.pageId)).toEqual([xService.pageId]);
    expect(r.find({ owner: 'browser' }).map((h) => h.pageId)).toEqual([browserTab.pageId]);
    // 但不加 owner 时两个都在 —— 底座如实说「有这些」,不替你分
    expect(r.find({ service: 'x' })).toHaveLength(2);
  });

  it('位置变化后 find 立刻按新位置命中(facts 是活的)', () => {
    const r = reg();
    const page = r.register({ ...base, slot: 'left' });
    expect(r.find({ slot: 'right' })).toHaveLength(0);

    r.update(page.pageId, { slot: 'right' });
    expect(r.find({ slot: 'right' })).toHaveLength(1);
    expect(r.find({ slot: 'left' })).toHaveLength(0);
  });

  it('销毁的页面不再被 find 命中', () => {
    const r = reg();
    const page = r.register({ ...base });
    r.register({ ...base, ws: 'ws-2' });
    r.destroy(page.pageId);
    expect(r.find({ service: 'x' })).toHaveLength(1);
  });
});

describe('find —— ⭐ 状态不参与身份(`06` §2.4)', () => {
  it('⭐ PageQuery 里没有 state 这一维:loading 的页面照样被 find 到', () => {
    // 理由(`06` §2.4):状态只影响「现在能不能做事」,不影响「是哪个」。
    // 否则页面一 loading 身份就变了,又回到老问题。
    // 能不能做事要问 ready(),不是把状态塞进 find。
    const r = reg();
    r.register({ ...base, state: 'loading' });
    r.register({ ...base, state: 'complete' });

    const hits = r.find({ service: 'x' });
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.state).sort()).toEqual(['complete', 'loading']);
  });
});

describe('find —— 返回值是快照,不是内部引用', () => {
  it('改动返回的数组不影响登记处', () => {
    const r = reg();
    r.register({ ...base });
    const hits = r.find();
    hits.length = 0;
    expect(r.find()).toHaveLength(1);
  });
});
