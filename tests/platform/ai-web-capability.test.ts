/**
 * ⭐⭐⭐ 第 6 步:AI 网页一问一答登记成能力(Module5-04,2026-10-26)
 *
 *   ai.web.ask    给某个 workspace 开着的 AI 网页(claude / chatgpt / gemini)发一个问题,等完整回答带回来
 *   ai.web.pages  现在开着哪些 AI 网页(哪个 ws、哪个服务、wcId)—— 排查用
 *
 * 原来 askAI 只有 IPC 入口,要界面先查出本 ws 的 AI 网页 wcId 再传进来 —— 后台 / 收件箱 / AI 够不着。
 * 现在主进程自己按 ws 找:同一 ws 的网页共用一个浏览分区 `persist:webview-<ws>`,按分区 + 网址认。
 * 找不到 / 一个 ws 开着两个同服务的页(不知道问哪个)→ refused,不猜。问的那一下占着那个页(锁 ai:<wcId>)。
 *
 * 顺手修(交接文档 §4 第 6 步):ai.sse-status / ai.get-latest-response 两个 IPC 不传 wcId,
 * 下面一见没有 wcId 就返回空 —— 恒空。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  wcs: [] as Array<Record<string, unknown>>,
  sessions: new Map<string, object>(),
  asked: [] as unknown[][],
  /** askAI 那一刻,锁表里有什么 */
  locksDuring: [] as string[][],
  askRet: { success: true, markdown: '回答' } as Record<string, unknown>,
  handlers: new Map<string, (...a: unknown[]) => unknown>(),
  orch: [] as Array<[string, unknown[]]>,
}));

vi.mock('electron', () => ({
  webContents: { getAllWebContents: () => h.wcs, fromId: (id: number) => h.wcs.find((w) => w.id === id) ?? null },
  session: {
    fromPartition: (p: string) => { if (!h.sessions.has(p)) h.sessions.set(p, { p }); return h.sessions.get(p); },
  },
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => { h.handlers.set(ch, fn); } },
}));
vi.mock('@storage/surreal/client', () => ({ getFlowDB: () => ({ query: async () => [[]] }) }));
vi.mock('@platform/main/ai/ask-orchestrator', () => ({
  askAI: async (...a: unknown[]) => {
    const { listLocks } = await import('@platform/main/flow/resource-lock');
    h.asked.push(a);
    h.locksDuring.push(listLocks().map((l) => l.resource));
    return h.askRet;
  },
  getSSEStatus: async (...a: unknown[]) => { h.orch.push(['getSSEStatus', a]); return { count: 1, latestStreaming: false, hooked: true }; },
  getLatestCapturedResponse: async (...a: unknown[]) => { h.orch.push(['getLatestCapturedResponse', a]); return '最新回复'; },
  pasteAndSend: async () => ({ success: true }),
  extractFullConversation: async () => ({ success: true }),
  extractConversationTurn: async () => ({ success: true }),
}));
vi.mock('@platform/main/ai/ai-sync-orchestrator', () => ({ registerAISyncHandlers: () => undefined }));

const { execute } = await import('@platform/main/capability/capability');
const { _resetLocks, acquireLock, releaseLock } = await import('@platform/main/flow/resource-lock');
const { registerAICapabilities } = await import('@platform/main/ai/ai-capabilities');
registerAICapabilities();

const page = (id: number, ws: string, url: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, getType: () => 'webview', isDestroyed: () => false, getURL: () => url,
  session: (() => { const p = `persist:webview-${ws}`; if (!h.sessions.has(p)) h.sessions.set(p, { p }); return h.sessions.get(p); })(),
  ...extra,
});

beforeEach(() => {
  _resetLocks();
  h.wcs = []; h.asked.length = 0; h.locksDuring.length = 0; h.orch.length = 0;
  h.askRet = { success: true, markdown: '回答' };
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});

describe('ai.web.ask —— 主进程按 ws 找 AI 网页,问一句等完整回答', () => {
  it('⭐ 找到这个 ws 的 claude 页 → 问的那一下占着它(ai:<wcId>)→ 带回完整回答;问完放锁', async () => {
    h.wcs = [page(11, 'ws-1', 'https://claude.ai/new'), page(12, 'ws-2', 'https://claude.ai/chat/x'), page(13, 'ws-1', 'https://x.com/home')];
    const r = await execute('ai.web.ask', { wsId: 'ws-1', service: 'claude', prompt: '一句话说说你是谁' }, { caller: 'inbox' });
    expect(r).toMatchObject({ ok: true, value: { markdown: '回答', wcId: 11, service: 'claude' } });
    expect(h.asked).toEqual([['claude', '一句话说说你是谁', 11, 120_000]]);
    expect(h.locksDuring[0]).toContain('ai:11');
    const { listLocks } = await import('@platform/main/flow/resource-lock');
    expect(listLocks()).toEqual([]);
  });

  it('⭐ AI 能调(不是对外动作):caller ai 照样问', async () => {
    h.wcs = [page(11, 'ws-1', 'https://claude.ai/new')];
    expect(await execute('ai.web.ask', { wsId: 'ws-1', service: 'claude', prompt: 'hi' }, { caller: 'ai' })).toMatchObject({ ok: true });
  });

  it('这个 ws 没开这个服务的页 → refused(说清楚先开哪个),没问', async () => {
    h.wcs = [page(12, 'ws-2', 'https://claude.ai/new'), page(14, 'ws-1', 'https://chatgpt.com/')];
    const r = await execute('ai.web.ask', { wsId: 'ws-1', service: 'claude', prompt: 'hi' }, { caller: 'inbox' });
    expect(r).toMatchObject({ ok: false, kind: 'refused' });
    if (!r.ok) expect(r.why).toMatch(/ws-1.*没开.*claude/);
    expect(h.asked).toEqual([]);
  });

  it('⭐ 一个 ws 开着两个 claude 页 → refused(不知道问哪个,不猜);给了 wcId 就问那个', async () => {
    h.wcs = [page(11, 'ws-1', 'https://claude.ai/new'), page(15, 'ws-1', 'https://claude.ai/chat/y')];
    const r = await execute('ai.web.ask', { wsId: 'ws-1', service: 'claude', prompt: 'hi' }, { caller: 'inbox' });
    expect(r).toMatchObject({ ok: false, kind: 'refused' });
    if (!r.ok) expect(r.why).toMatch(/2 个.*wc#11.*wc#15/);
    expect(h.asked).toEqual([]);
    expect(await execute('ai.web.ask', { wsId: 'ws-1', service: 'claude', prompt: 'hi', wcId: 15 }, { caller: 'inbox' })).toMatchObject({ ok: true, value: { wcId: 15 } });
    /** 给的 wcId 不是这个 ws 的这个服务 → refused */
    expect(await execute('ai.web.ask', { wsId: 'ws-1', service: 'claude', prompt: 'hi', wcId: 99 }, { caller: 'inbox' })).toMatchObject({ ok: false, kind: 'refused' });
  });

  it('那个页正被占着(另一次问还没回来)→ refused,没问', async () => {
    h.wcs = [page(11, 'ws-1', 'https://claude.ai/new')];
    const other = acquireLock('ai:11', '问 AI:上一句', 'ui');
    if (!other.ok) throw new Error('应拿到');
    const r = await execute('ai.web.ask', { wsId: 'ws-1', service: 'claude', prompt: 'hi' }, { caller: 'inbox' });
    expect(r).toMatchObject({ ok: false, kind: 'refused' });
    expect(h.asked).toEqual([]);
    releaseLock(other.token);
  });

  it('没问成(粘不进 / 超时)→ failed 带原因;参数不对 → invalid', async () => {
    h.wcs = [page(11, 'ws-1', 'https://claude.ai/new')];
    h.askRet = { success: false, error: 'AI response timed out' };
    expect(await execute('ai.web.ask', { wsId: 'ws-1', service: 'claude', prompt: 'hi' }, { caller: 'inbox' })).toMatchObject({ ok: false, kind: 'failed', why: expect.stringMatching(/timed out/) });
    for (const bad of [
      { wsId: 'ws-1', service: 'bard', prompt: 'hi' },
      { wsId: 'ws-1', service: 'claude', prompt: '' },
      { service: 'claude', prompt: 'hi' },
      { wsId: 'ws-1', service: 'claude', prompt: 'hi', timeoutMs: 1 },
    ]) expect(await execute('ai.web.ask', bad, { caller: 'inbox' }), JSON.stringify(bad)).toMatchObject({ ok: false, kind: 'invalid' });
  });
});

describe('ai.web.pages —— 开着哪些 AI 网页', () => {
  it('只列 AI 服务的页,带服务 / wcId / 网址 / 分区', async () => {
    h.wcs = [page(11, 'ws-1', 'https://claude.ai/new'), page(13, 'ws-1', 'https://x.com/home'), page(14, 'ws-2', 'https://gemini.google.com/app')];
    const r = await execute('ai.web.pages', {}, { caller: 'inbox' });
    expect(r).toMatchObject({ ok: true, value: [
      { wcId: 11, service: 'claude', url: 'https://claude.ai/new' },
      { wcId: 14, service: 'gemini', url: 'https://gemini.google.com/app' },
    ] });
  });
});

describe('顺手修:两个 IPC 原来不传 wcId(恒空)', () => {
  it('⭐ ai.sse-status / ai.get-latest-response 把 targetWcId 传下去', async () => {
    const { registerAIHandlers } = await import('@platform/main/ai/handlers');
    const { IPC_CHANNELS } = await import('@shared/ipc/channel-names');
    registerAIHandlers();
    await h.handlers.get(IPC_CHANNELS.AI_SSE_STATUS)!({}, { targetWcId: 11 });
    await h.handlers.get(IPC_CHANNELS.AI_GET_LATEST_RESPONSE)!({}, { targetWcId: 11 });
    expect(h.orch).toEqual([['getSSEStatus', [11]], ['getLatestCapturedResponse', [11]]]);
  });
});
