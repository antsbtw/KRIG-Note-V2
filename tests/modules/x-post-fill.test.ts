/**
 * ⭐⭐ 发推第②期:填进 X 发推框(不发)/ 撤回 / 查草稿(2026-10-27)—— 设计 x-posting-design.md §2 / §5.2
 *
 * 用户 10-26:「发推后,发到 x 上再确定如何?多一个确认环节」→ fill 只填不发,网页一直占着等人确认或取消。
 * 钉:
 *  · fill 成了:框里是排好的字(读回核对过)、网页锁还占着(锁上写着在等确认)、有一份待发草稿
 *  · 占着时别人(采集 / 第二次 fill)拿不到网页
 *  · cancel:清框 → 回首页 → 放锁 → 草稿没了、记下怎么结束的
 *  · 10 分钟没确认:走执行器的 cancel(caller timer),和人点取消一样留痕
 *  · 没成的都不留锁:框里有残字 / 读回对不上(并清掉)/ 这种发法本期不能填 / 带图
 *  · AI 调 fill 被拒(对外动作,P3 前要人批复);AI 调 cancel / pending 可以
 *  · 网页没了(锁被收回)→ 草稿当没有
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  /** X 发推框里现在的字;null = 弹窗不在 */
  box: '' as string | null,
  /** 贴进去时 X 实际显示成什么(模拟对不上);null = 照原样 */
  landsAs: null as string | null,
  clearFails: false,
  goto: [] as string[],
  typed: [] as string[],
}));

vi.mock('@storage/surreal/client', () => ({
  getFlowDB: () => ({ query: async (sql: string, v: Record<string, unknown>) => { if (sql.includes('CREATE flow_step_run')) h.rows.push(v); return [[]]; } }),
  getXDB: () => ({ query: async () => [[]] }),
}));
vi.mock('@platform/main/web-capability/wiring/runtime', () => ({
  traceRecorder: { lifecycle: () => undefined },
  inputEngine: {
    type: async (_p: string, input: { text: string }) => {
      h.typed.push(input.text);
      h.box = (h.box ?? '') + (h.landsAs ?? input.text);
      return { status: 'ok', value: { checked: false, landed: false, attempts: 1 } };
    },
  },
}));
vi.mock('@platform/main/web-capability/wiring/web-collect-engine', () => ({ resolve: () => ({ pageId: 'p7' }) }));
vi.mock('@modules/x/x-host-registry', () => ({ getXHostState: () => ({ wcId: 7, url: '' }), listXHostStates: () => new Map([['ws-1', { wcId: 7, url: '' }]]) }));
vi.mock('@modules/x/x-account-repo', () => ({ readWsAccount: async () => ({ wsId: 'ws-1', handle: 'me', restId: 'ME' }) }));
vi.mock('@modules/x/x-collect-ports', () => ({
  webviewPorts: () => ({
    goto: async (name: string) => { h.goto.push(name); return { ok: true }; },
    runScript: async (id: string) => {
      if (id === 'x.composeBoxState') return h.box === null ? { found: false } : { found: true, count: 1, text: h.box.trim() };
      if (id === 'x.composeClear') {
        if (h.box === null) return { state: 'no-box' };
        if (h.box === '') return { state: 'empty' };
        if (h.clearFails) return { state: 'not-cleared', left: h.box.slice(0, 40) };
        h.box = '';
        return { state: 'cleared', via: 'backspace' };
      }
      throw new Error(`没想到的脚本 ${id}`);
    },
  }),
}));

const { execute } = await import('@platform/main/capability/capability');
const { registerXPostCapabilities } = await import('@modules/x/x-capabilities-post');
const lock = await import('@platform/main/flow/resource-lock');
const { DRAFT_TTL_MS, stopPostDraftTimers } = await import('@modules/x/x-post-draft');
registerXPostCapabilities();

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const fillIn = (text = '今天读了一篇论文', extra: Record<string, unknown> = {}) => ({ wsId: 'ws-1', form: 'single', content: [para(text)], ...extra });
const pending = async () => ((await execute('x.post.pending', { wsId: 'ws-1' }, { caller: 'ui' })) as { value: { pending: { draftId: string } | null; ended: { why: string; cleared: boolean } | null } }).value;

beforeEach(() => {
  h.rows.length = 0; h.goto.length = 0; h.typed.length = 0;
  h.box = ''; h.landsAs = null; h.clearFails = false;
  lock._resetLocks();
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});
afterEach(() => { stopPostDraftTimers(); vi.useRealTimers(); });

describe('x.post.fill 填进 X(不发)', () => {
  it('⭐ 成了:框里是排好的字,网页还占着(写着等确认),有一份待发草稿', async () => {
    const r = await execute('x.post.fill', fillIn(), { caller: 'ui' });
    expect(r).toMatchObject({ ok: true, value: { text: '今天读了一篇论文', handle: 'me', form: 'single' } });
    expect(h.goto).toEqual(['x.compose']);
    expect(h.box).toBe('今天读了一篇论文');
    expect(lock.lockHolder('page:7')?.purpose).toContain('等你在 X 上确认');
    expect((await pending()).pending?.draftId).toBe((r as { value: { draftId: string } }).value.draftId);
    /** 结果里不带锁 token(界面 / AI 拿不到别人的锁) */
    expect(JSON.stringify(r)).not.toContain('page:7#');
  });

  it('⭐ 占着时别人拿不到网页;第二次 fill 被拒且说清楚', async () => {
    await execute('x.post.fill', fillIn(), { caller: 'ui' });
    expect(lock.acquireLock('page:7', '任务:查回关', 'timer').ok).toBe(false);
    const again = await execute('x.post.fill', fillIn('另一条'), { caller: 'ui' });
    expect(again).toMatchObject({ ok: false, kind: 'refused' });
    expect(!again.ok && again.why).toContain('已经有一份待发草稿');
    expect(h.typed).toEqual(['今天读了一篇论文']);
  });

  it('框里已经有字 → 不往里贴,不留锁', async () => {
    h.box = 'X 留着的上一次';
    const r = await execute('x.post.fill', fillIn(), { caller: 'ui' });
    expect(r).toMatchObject({ ok: false, kind: 'failed' });
    expect(!r.ok && r.why).toContain('已经有字');
    expect(h.typed).toEqual([]);
    expect(lock.lockHolder('page:7')).toBeNull();
    expect((await pending()).pending).toBeNull();
  });

  it('⭐ 读回对不上 → 清掉、failed、不留锁(只贴一次,不换路再贴)', async () => {
    h.landsAs = '今天读了一篇';
    const r = await execute('x.post.fill', fillIn(), { caller: 'ui' });
    expect(r).toMatchObject({ ok: false, kind: 'failed' });
    expect(!r.ok && r.why).toContain('对不上');
    expect(!r.ok && r.why).toContain('已清掉');
    expect(h.typed).toHaveLength(1);
    expect(h.box).toBe('');
    expect(lock.lockHolder('page:7')).toBeNull();
  }, 10_000);

  it('本期不能填的发法 / 带图 → refused,网页一下没碰', async () => {
    const thread = await execute('x.post.fill', fillIn('x', { form: 'thread' }), { caller: 'ui' });
    expect(thread).toMatchObject({ ok: false, kind: 'refused' });
    expect(!thread.ok && thread.why).toContain('第⑤期');
    const img = await execute('x.post.fill', { wsId: 'ws-1', form: 'single', content: [para('配图'), { type: 'image', attrs: { src: 'media://a.png' } }] }, { caller: 'ui' });
    expect(img).toMatchObject({ ok: false, kind: 'refused' });
    expect(!img.ok && img.why).toContain('第④期');
    expect(h.goto).toEqual([]);
    expect(lock.lockHolder('page:7')).toBeNull();
  });

  it('⭐ AI 调 fill:refused 要人批复(P3 前);记录里 caller=ai', async () => {
    const r = await execute('x.post.fill', fillIn(), { caller: 'ai' });
    expect(r).toMatchObject({ ok: false, kind: 'refused' });
    expect(!r.ok && r.why).toContain('批复');
    expect(h.goto).toEqual([]);
    expect(h.rows.at(-1)?.caller).toBe('ai');
  });
});

describe('x.post.cancel 撤回', () => {
  it('⭐ 清框 → 回首页 → 放锁 → 草稿没了,记下是人点的取消', async () => {
    const f = await execute('x.post.fill', fillIn(), { caller: 'ui' });
    const draftId = (f as { value: { draftId: string } }).value.draftId;
    const r = await execute('x.post.cancel', { wsId: 'ws-1', draftId }, { caller: 'ui' });
    expect(r).toMatchObject({ ok: true });
    expect(h.box).toBe('');
    expect(h.goto).toEqual(['x.compose', 'x.home']);
    expect(lock.lockHolder('page:7')).toBeNull();
    expect(await pending()).toMatchObject({ pending: null, ended: { why: 'user', cleared: true } });
  });

  it('草稿 id 不对 / 已经撤过 → refused,锁不动', async () => {
    const f = await execute('x.post.fill', fillIn(), { caller: 'ui' });
    expect(await execute('x.post.cancel', { wsId: 'ws-1', draftId: 'draft_假的' }, { caller: 'ui' })).toMatchObject({ ok: false, kind: 'refused' });
    expect(lock.lockHolder('page:7')).not.toBeNull();
    const draftId = (f as { value: { draftId: string } }).value.draftId;
    await execute('x.post.cancel', { wsId: 'ws-1', draftId }, { caller: 'ui' });
    expect(await execute('x.post.cancel', { wsId: 'ws-1', draftId }, { caller: 'ui' })).toMatchObject({ ok: false, kind: 'refused' });
  });

  it('清不掉 → failed 说清楚(请手动删),但网页照样放开、不再导航', async () => {
    const f = await execute('x.post.fill', fillIn(), { caller: 'ui' });
    h.clearFails = true;
    const r = await execute('x.post.cancel', { wsId: 'ws-1', draftId: (f as { value: { draftId: string } }).value.draftId }, { caller: 'ui' });
    expect(r).toMatchObject({ ok: false, kind: 'failed' });
    expect(!r.ok && r.why).toContain('手动删');
    expect(h.goto).toEqual(['x.compose']);
    expect(lock.lockHolder('page:7')).toBeNull();
    expect((await pending()).ended).toMatchObject({ cleared: false });
  });

  it('AI 可以撤回(control 类,不对外)', async () => {
    const f = await execute('x.post.fill', fillIn(), { caller: 'ui' });
    expect(await execute('x.post.cancel', { wsId: 'ws-1', draftId: (f as { value: { draftId: string } }).value.draftId }, { caller: 'ai' })).toMatchObject({ ok: true });
  });
});

describe('超时 / 网页没了', () => {
  it('⭐ 10 分钟没确认:定时器走 x.post.cancel(caller timer),框清了、锁放了', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    const f = execute('x.post.fill', fillIn(), { caller: 'ui' });
    await vi.runAllTimersAsync();
    expect(await f).toMatchObject({ ok: true });
    await vi.advanceTimersByTimeAsync(DRAFT_TTL_MS + 1000);
    expect(h.rows.some((r) => r.capability === 'x.post.cancel' && r.caller === 'timer' && r.status === 'ok')).toBe(true);
    expect(h.box).toBe('');
    expect(lock.lockHolder('page:7')).toBeNull();
    expect((await pending()).ended).toMatchObject({ why: 'timeout' });
  });

  it('网页销毁(锁被收回)→ 草稿当没有', async () => {
    await execute('x.post.fill', fillIn(), { caller: 'ui' });
    lock.revokeLocks((x) => x.resource === 'page:7', '测试:网页销毁');
    expect((await pending()).pending).toBeNull();
    expect(await execute('x.post.fill', fillIn('再来'), { caller: 'ui' })).toMatchObject({ ok: false, kind: 'failed' });
  });
});
