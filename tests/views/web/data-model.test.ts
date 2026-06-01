/**
 * Unit test: web data-model(Phase 4 多 tab)
 *
 * 重点两块(实现包 §4 头号坑):
 *  1. 旧 schema(单 currentUrl)→ 新 schema(tabs[])迁移
 *  2. getWebWsState hydrate cache 深比 —— 数据没变必须返回**同一引用**
 *     (否则 useSyncExternalStore 死循环)。逐 tab 比 id+url。
 */
import { describe, it, expect } from 'vitest';
import type { WorkspaceState } from '@workspace/workspace-state/workspace-state';
import { hydrateWebState, getWebWsState } from '@views/web/data-model';
import { WEBVIEW_DEFAULT_URL } from '@shared/constants/webview';

/** 造一个最小 WorkspaceState(只 hydrate 路径用到的字段)*/
function ws(id: string, pluginStatesWeb: unknown): WorkspaceState {
  return {
    id,
    pluginStates: pluginStatesWeb === undefined ? {} : { web: pluginStatesWeb },
  } as unknown as WorkspaceState;
}

describe('hydrateWebState — 迁移', () => {
  it('旧 schema(单 currentUrl)→ 合成单 tab,activeTabId 指向它', () => {
    const out = hydrateWebState({ currentUrl: 'https://a.com', targetLang: 'ja' });
    expect(out.tabs).toHaveLength(1);
    expect(out.tabs[0].url).toBe('https://a.com');
    expect(out.activeTabId).toBe(out.tabs[0].id);
    expect(out.targetLang).toBe('ja');
    expect(out.tabs[0].id).toBeTruthy();
  });

  it('空持久化 → DEFAULT_URL 单 tab', () => {
    const out = hydrateWebState(undefined);
    expect(out.tabs).toHaveLength(1);
    expect(out.tabs[0].url).toBe(WEBVIEW_DEFAULT_URL);
    expect(out.activeTabId).toBe(out.tabs[0].id);
  });

  it('新 schema(有 tabs)→ 原样用,activeTabId 合法时保留', () => {
    const out = hydrateWebState({
      tabs: [
        { id: 't1', url: 'https://a.com' },
        { id: 't2', url: 'https://b.com' },
      ],
      activeTabId: 't2',
      targetLang: 'zh-CN',
    });
    expect(out.tabs).toEqual([
      { id: 't1', url: 'https://a.com' },
      { id: 't2', url: 'https://b.com' },
    ]);
    expect(out.activeTabId).toBe('t2');
    expect(out.targetLang).toBe('zh-CN');
  });

  it('activeTabId 不在 tabs 内 → 回退到第一个 tab', () => {
    const out = hydrateWebState({
      tabs: [{ id: 't1', url: 'https://a.com' }],
      activeTabId: 'gone',
    });
    expect(out.activeTabId).toBe('t1');
  });

  it('tabs 里有脏项(缺 id / url 非字符串)→ 过滤掉', () => {
    const out = hydrateWebState({
      tabs: [
        { id: 't1', url: 'https://a.com' },
        { id: '', url: 'https://x.com' } as never,
        { url: 'https://noid.com' } as never,
      ],
      activeTabId: 't1',
    });
    expect(out.tabs).toHaveLength(1);
    expect(out.tabs[0].id).toBe('t1');
  });

  it('tabs 全脏 / 空数组 → 回退迁移(空 → DEFAULT_URL)', () => {
    const out = hydrateWebState({ tabs: [] });
    expect(out.tabs).toHaveLength(1);
    expect(out.tabs[0].url).toBe(WEBVIEW_DEFAULT_URL);
  });
});

describe('getWebWsState — hydrate cache 深比(稳定引用)', () => {
  it('同一 ws 数据不变 → 返回同一对象引用(===)', () => {
    const a = ws('cache-ws-1', {
      tabs: [{ id: 't1', url: 'https://a.com' }],
      activeTabId: 't1',
      targetLang: 'en',
    });
    const r1 = getWebWsState(a);
    const r2 = getWebWsState(a);
    expect(r2).toBe(r1);
  });

  it('多 tab 全不变 → 仍返回同一引用(逐 tab 深比)', () => {
    const persisted = {
      tabs: [
        { id: 't1', url: 'https://a.com' },
        { id: 't2', url: 'https://b.com' },
      ],
      activeTabId: 't2',
      targetLang: 'en',
    };
    const r1 = getWebWsState(ws('cache-ws-2', persisted));
    // 新 ws 对象但内容相同(模拟 workspaceManager 重建 ws 对象)
    const r2 = getWebWsState(ws('cache-ws-2', {
      tabs: [
        { id: 't1', url: 'https://a.com' },
        { id: 't2', url: 'https://b.com' },
      ],
      activeTabId: 't2',
      targetLang: 'en',
    }));
    expect(r2).toBe(r1);
  });

  it('某 tab url 变 → 返回新引用', () => {
    const r1 = getWebWsState(ws('cache-ws-3', {
      tabs: [{ id: 't1', url: 'https://a.com' }],
      activeTabId: 't1',
      targetLang: 'en',
    }));
    const r2 = getWebWsState(ws('cache-ws-3', {
      tabs: [{ id: 't1', url: 'https://a-CHANGED.com' }],
      activeTabId: 't1',
      targetLang: 'en',
    }));
    expect(r2).not.toBe(r1);
    expect(r2.tabs[0].url).toBe('https://a-CHANGED.com');
  });

  it('tab 数量变(加 tab)→ 返回新引用', () => {
    const r1 = getWebWsState(ws('cache-ws-4', {
      tabs: [{ id: 't1', url: 'https://a.com' }],
      activeTabId: 't1',
      targetLang: 'en',
    }));
    const r2 = getWebWsState(ws('cache-ws-4', {
      tabs: [
        { id: 't1', url: 'https://a.com' },
        { id: 't2', url: 'https://b.com' },
      ],
      activeTabId: 't2',
      targetLang: 'en',
    }));
    expect(r2).not.toBe(r1);
    expect(r2.tabs).toHaveLength(2);
  });

  it('activeTabId 变(切 tab)→ 返回新引用', () => {
    const base = {
      tabs: [
        { id: 't1', url: 'https://a.com' },
        { id: 't2', url: 'https://b.com' },
      ],
      targetLang: 'en',
    };
    const r1 = getWebWsState(ws('cache-ws-5', { ...base, activeTabId: 't1' }));
    const r2 = getWebWsState(ws('cache-ws-5', { ...base, activeTabId: 't2' }));
    expect(r2).not.toBe(r1);
    expect(r2.activeTabId).toBe('t2');
  });

  it('targetLang 变 → 返回新引用', () => {
    const base = {
      tabs: [{ id: 't1', url: 'https://a.com' }],
      activeTabId: 't1',
    };
    const r1 = getWebWsState(ws('cache-ws-6', { ...base, targetLang: 'en' }));
    const r2 = getWebWsState(ws('cache-ws-6', { ...base, targetLang: 'ja' }));
    expect(r2).not.toBe(r1);
    expect(r2.targetLang).toBe('ja');
  });

  it('tab id 变(url 同)→ 返回新引用(深比含 id)', () => {
    const r1 = getWebWsState(ws('cache-ws-7', {
      tabs: [{ id: 't1', url: 'https://a.com' }],
      activeTabId: 't1',
      targetLang: 'en',
    }));
    const r2 = getWebWsState(ws('cache-ws-7', {
      tabs: [{ id: 't1-NEW', url: 'https://a.com' }],
      activeTabId: 't1-NEW',
      targetLang: 'en',
    }));
    expect(r2).not.toBe(r1);
  });
});
