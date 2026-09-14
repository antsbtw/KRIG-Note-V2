/**
 * `web.page` 身份模型 —— 本步最核心、也最容易做错的一块(`06` §1)
 *
 * 守的是**一个已经被证否过的方案不许复活**:
 *   初版 `pageId = ${windowId}:${wsId}:${slot}:${serviceId}`(`06` §8.1 已否决)。
 *   一个反例打穿:内置浏览器有 tab,同 ws 开三个标签页 → **三个 tab 算出同一个 id**。
 *
 * 所以下面这些用例不是「测功能」,是**钉死那个错误方案回不来**:
 * 只要有人把身份改回「拼维度」,`同 ws 三个 tab` 那条立刻红。
 *
 * 三条不变量(`06` §1.5):
 *   1. pageId 不透明 —— 应用不解析、不构造
 *   2. pageId 稳定,wcId 易变 —— webview 重挂后 wcId 变、pageId 不变
 *   3. 应用只见页面对象,永远拿不到 wcId / webContents
 */
import { describe, it, expect } from 'vitest';
import { PageRegistry } from '@platform/main/web-capability/page';
import { isOk, isFailed } from '@platform/main/web-capability/result';

function reg() {
  return new PageRegistry();
}

/** 一个典型的 X 页面 */
function xPage(over: Partial<Parameters<PageRegistry['register']>[0]> = {}) {
  return {
    window: 'win-1',
    ws: 'ws-1',
    slot: 'left' as const,
    partition: 'persist:webview-ws-1',
    owner: 'x-service',
    service: 'x',
    url: 'https://x.com/home',
    ...over,
  };
}

describe('身份分配 —— ⭐ 不由维度拼出(`06` §8.1 已否决拼维度)', () => {
  it('⭐⭐ 同 ws 三个 tab = 三个不同 pageId(初版方案死在这条)', () => {
    const r = reg();
    // 三个 tab:window / ws / slot / service 全一样,只有 tabId 不同
    const a = r.register(xPage({ tabId: 'tab-1' }));
    const b = r.register(xPage({ tabId: 'tab-2' }));
    const c = r.register(xPage({ tabId: 'tab-3' }));

    const ids = [a.pageId, b.pageId, c.pageId];
    expect(new Set(ids).size).toBe(3);
  });

  it('⭐ 连 tabId 都不给(维度完全相同)时,仍然是三个不同 id', () => {
    // 这条比上一条更狠:拼维度方案连 tabId 这一维都没有,必然算出同一个 id。
    // 判据(`06` §1.4):好的抽象不要求把维度全想全 —— 想漏了它也不塌。
    const r = reg();
    const ids = [r.register(xPage()), r.register(xPage()), r.register(xPage())]
      .map((f) => f.pageId);
    expect(new Set(ids).size).toBe(3);
  });

  it('pageId 里不含任何维度值(不透明 —— 应用无从解析)', () => {
    const r = reg();
    const facts = r.register(xPage({ window: 'win-7', ws: 'ws-9', tabId: 'tab-3' }));
    const id = String(facts.pageId);
    for (const dimension of ['win-7', 'ws-9', 'tab-3', 'x-service', 'left']) {
      expect(id).not.toContain(dimension);
    }
  });

  it('大量注册不发生 id 碰撞', () => {
    const r = reg();
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(String(r.register(xPage()).pageId));
    expect(ids.size).toBe(1000);
  });
});

describe('身份稳定性 —— ⭐ 位置变、身份不变(`06` §1.6)', () => {
  it('⭐ webview 重挂后 pageId 不变(wcId 变是常态,身份不该跟着变)', () => {
    const r = reg();
    const created = r.register(xPage({ url: 'https://x.com/home', state: 'complete' }));
    // 重挂 = 同一个浏览上下文,只是底层 wc 换了 → 走 update,不是 register
    const after = r.update(created.pageId, { state: 'loading' });
    expect(isOk(after)).toBe(true);
    if (!isOk(after)) throw new Error('unreachable');
    expect(after.value.pageId).toBe(created.pageId);
  });

  it('⭐ 换 slot(tab 从左栏拖到右栏)pageId 不变,slot 跟着变', () => {
    const r = reg();
    const created = r.register(xPage({ slot: 'left' }));
    const moved = r.update(created.pageId, { slot: 'right' });
    if (!isOk(moved)) throw new Error('update 应成功');
    expect(moved.value.pageId).toBe(created.pageId);
    expect(moved.value.slot).toBe('right');
  });

  it('⭐ 换 window pageId 不变', () => {
    const r = reg();
    const created = r.register(xPage({ window: 'win-1' }));
    const moved = r.update(created.pageId, { window: 'win-2' });
    if (!isOk(moved)) throw new Error('update 应成功');
    expect(moved.value.pageId).toBe(created.pageId);
    expect(moved.value.window).toBe('win-2');
  });

  it('换 ws pageId 不变', () => {
    const r = reg();
    const created = r.register(xPage({ ws: 'ws-1' }));
    const moved = r.update(created.pageId, { ws: 'ws-2' });
    if (!isOk(moved)) throw new Error('update 应成功');
    expect(moved.value.pageId).toBe(created.pageId);
    expect(moved.value.ws).toBe('ws-2');
  });

  it('⭐ 跨站导航(X → google)pageId 不变,service 跟着变', () => {
    // 跨站不换 id 的理由(`06` §1.6):否则「同一标签页里从 X 跳到 google」
    // 会在 trace 里断成两截,反而看不清经过。
    const r = reg();
    const created = r.register(xPage({ service: 'x', url: 'https://x.com/home' }));
    const navigated = r.update(created.pageId, {
      service: 'google',
      url: 'https://google.com/search?q=1',
    });
    if (!isOk(navigated)) throw new Error('update 应成功');
    expect(navigated.value.pageId).toBe(created.pageId);
    expect(navigated.value.service).toBe('google');
    expect(navigated.value.url).toBe('https://google.com/search?q=1');
  });

  it('SPA 导航(同站换路径)pageId 不变', () => {
    const r = reg();
    const created = r.register(xPage({ url: 'https://x.com/home' }));
    const navigated = r.update(created.pageId, { url: 'https://x.com/compose/post' });
    if (!isOk(navigated)) throw new Error('update 应成功');
    expect(navigated.value.pageId).toBe(created.pageId);
  });

  it('⭐ 一连串位置变化后 id 始终是同一个(累积不漂移)', () => {
    const r = reg();
    const id = r.register(xPage()).pageId;
    r.update(id, { slot: 'right' });
    r.update(id, { window: 'win-2' });
    r.update(id, { ws: 'ws-5' });
    r.update(id, { service: 'google', url: 'https://google.com' });
    r.update(id, { state: 'complete' });
    const finalFacts = r.facts(id);
    if (!isOk(finalFacts)) throw new Error('facts 应成功');
    expect(finalFacts.value.pageId).toBe(id);
    expect(finalFacts.value).toMatchObject({
      slot: 'right', window: 'win-2', ws: 'ws-5', service: 'google', state: 'complete',
    });
  });
});

describe('身份销毁 —— tab 关闭 / 新开 tab(`06` §1.6)', () => {
  it('destroy 后页面查不到,facts 返回 Failed(不是 null)', () => {
    const r = reg();
    const id = r.register(xPage()).pageId;
    expect(r.destroy(id)).toBe(true);
    const after = r.facts(id);
    expect(isFailed(after)).toBe(true);
  });

  it('销毁不存在的页面返回 false(如实说没删到,不假装成功)', () => {
    const r = reg();
    const id = r.register(xPage()).pageId;
    r.destroy(id);
    expect(r.destroy(id)).toBe(false);
  });

  it('⭐ 销毁后重新开 tab 是**新** pageId(不复用旧身份)', () => {
    const r = reg();
    const first = r.register(xPage({ tabId: 'tab-1' })).pageId;
    r.destroy(first);
    const second = r.register(xPage({ tabId: 'tab-1' })).pageId;
    expect(second).not.toBe(first);
  });
});

describe('身份不可变 —— update 改不动 pageId', () => {
  it('⭐ 即使强行把 pageId 塞进 patch,也改不动身份', () => {
    // 类型层面 PageFactsPatch 里没有 pageId;这里用 as any 模拟「有人绕过类型」,
    // 断言**运行时也守得住** —— 类型是第一道闸,不是唯一一道。
    const r = reg();
    const a = r.register(xPage());
    const b = r.register(xPage());
    const patched = r.update(a.pageId, { pageId: b.pageId } as never);
    if (!isOk(patched)) throw new Error('update 应成功');
    expect(patched.value.pageId).toBe(a.pageId);
    // b 也没被污染
    const bFacts = r.facts(b.pageId);
    if (!isOk(bFacts)) throw new Error('facts 应成功');
    expect(bFacts.value.pageId).toBe(b.pageId);
  });

  it('update 不存在的页面返回 Failed,不隐式创建', () => {
    const r = reg();
    const ghost = 'page_deadbeef' as never;
    const res = r.update(ghost, { slot: 'right' });
    expect(isFailed(res)).toBe(true);
    expect(r.list()).toHaveLength(0);
  });
});
