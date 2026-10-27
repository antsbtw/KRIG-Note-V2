/**
 * 发推能力 x.post.prepare(第①期,2026-10-27)—— 界面和 AI 走同一道关
 *
 * 用户 10-26:「note 调用接口就可以发推,要保持 AI 也同样能够调用这些功能。」
 * 钉:类别 input(只排版,AI 调不被拒)/ 界面给块数组直接排 / AI 只给 noteId 到库里读 / 参数不对 invalid / note 不存在 failed。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  note: null as null | { doc: unknown },
}));

vi.mock('@storage/surreal/client', () => ({
  getFlowDB: () => ({ query: async (sql: string, v: Record<string, unknown>) => { if (sql.includes('CREATE flow_step_run')) h.rows.push(v); return [[]]; } }),
  getXDB: () => ({ query: async () => [[]] }),
}));
vi.mock('@platform/main/note/capability-impl', () => ({ getNote: async () => h.note }));
vi.mock('@platform/main/note/envelope', () => ({ unwrapPmDoc: (d: unknown) => d }));

const { execute, listCapabilities } = await import('@platform/main/capability/capability');
const { registerXPostCapabilities } = await import('@modules/x/x-capabilities-post');
registerXPostCapabilities();

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

beforeEach(() => {
  h.rows.length = 0;
  h.note = null;
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});

describe('x.post.prepare', () => {
  it('在目录里,类别 input,说明给 AI 读得懂', () => {
    const c = listCapabilities().find((x) => x.id === 'x.post.prepare');
    expect(c?.kind).toBe('input');
    expect(c?.describe).toContain('不发');
    expect(Object.keys(c!.inputDoc)).toEqual(['content', 'noteId']);
  });

  it('界面给块数组:直接排,不读库', async () => {
    h.note = { doc: { content: [para('不该读到这个')] } };
    const r = await execute('x.post.prepare', { content: [para('今天读了一篇论文')] }, { caller: 'ui' });
    expect(r.ok).toBe(true);
    const plan = (r as { value: { suggested: string; options: Array<{ posts: Array<{ text: string }> }> } }).value;
    expect(plan.suggested).toBe('single');
    expect(plan.options[0].posts[0].text).toBe('今天读了一篇论文');
  });

  it('AI 只给 noteId:到库里读整篇,照样排(input 类不要人批复)', async () => {
    h.note = { doc: { type: 'doc', content: [para('库里的正文')] } };
    const r = await execute('x.post.prepare', { noteId: 'N1' }, { caller: 'ai' });
    expect(r.ok).toBe(true);
    expect((r as { value: { options: Array<{ posts: Array<{ text: string }> }> } }).value.options[0].posts[0].text).toBe('库里的正文');
    expect(h.rows.at(-1)?.subjectRef).toBe('note:N1');
    expect(h.rows.at(-1)?.caller).toBe('ai');
  });

  it('note 不存在:failed,说清楚', async () => {
    const r = await execute('x.post.prepare', { noteId: 'GONE' }, { caller: 'ai' });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.kind).toBe('failed');
    expect(r.ok === false && r.why).toContain('GONE');
  });

  it('参数不对:invalid', async () => {
    for (const bad of [{}, { content: 'x' }, { content: [{ text: '没有 type' }] }]) {
      const r = await execute('x.post.prepare', bad, { caller: 'ai' });
      expect(r.ok === false && r.kind, JSON.stringify(bad)).toBe('invalid');
    }
  });
});
