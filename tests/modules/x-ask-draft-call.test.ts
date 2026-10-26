/**
 * ⭐ 草拟必须关掉思考(2026-10-21 真机:开着一条 30~80 秒、5 条里 3 条超时;关掉 1~2 秒)
 * 行为测试:mock 掉 Ollama 和库,看 draftAskReply 实际怎么调。
 */
import { describe, it, expect, vi } from 'vitest';

const calls: Array<Record<string, unknown>> = [];
let reply = '「说得对,互关一个!」';
let translated: string | null = '他那表情太绝了';
vi.mock('@platform/main/learning/providers/google-translate', () => ({
  googleTranslate: vi.fn(async () => (translated === null ? null : { text: translated, sourceLang: 'en', targetLang: 'zh-CN' })),
}));
vi.mock('@platform/main/local-llm/ollama-client', () => ({
  callOllamaChat: vi.fn(async (o: Record<string, unknown>) => { calls.push(o); return { content: reply }; }),
  callOllama: vi.fn(async () => { throw new Error('草拟不该走 OpenAI 兼容接口(关不了思考)'); }),
}));
const notes: Array<Record<string, unknown>> = [];
vi.mock('@storage/surreal/client', () => ({
  getXDB: () => ({ query: async (sql: string, vars: Record<string, unknown>) => {
    if (sql.startsWith('CREATE x_draft_note')) { notes.push(vars); return [[{ id: 'n' }]]; }
    if (sql.includes('FROM x_draft_note')) return [notes.filter((n) => n.keep === true).map((n, i) => ({ id: String(i), note: n.note, at: '' }))];
    return [[{ tweet_text: '#蓝V互关', reply_text: '已关,互关互助!', at: '' }]];
  } }),
}));

import { draftAskReply, ASK_DRAFT_MODEL } from '@modules/x/x-ask-draft';

describe('草拟怎么调模型', () => {
  it('Gemma 4 12B · think=false · 范例进了提示词 · 收拾后的文本回来', async () => {
    const r = await draftAskReply({ account: 'ME', tweet: '新人报到 #蓝V互关', person: {} });
    expect(r).toMatchObject({ ok: true, text: '说得对,互关一个!', examples: 1 });
    expect(calls[0]).toMatchObject({ model: ASK_DRAFT_MODEL, think: false });
    expect(ASK_DRAFT_MODEL).toBe('gemma4:12b');
    expect(JSON.stringify(calls[0].messages)).toContain('已关,互关互助!');
  });
});

describe('⭐ 点评怎么落库、怎么用(用户 10-22)', () => {
  it('勾「以后都这样」→ 先记成长期要求,这一次就带上;只改这一次 → 记改前 / 点评 / 改后,不成长期要求', async () => {
    calls.length = 0; notes.length = 0;
    await draftAskReply({ account: 'ME', tweet: 't', person: {}, revise: { previous: '加油', note: '别说教', keep: true } });
    expect(notes).toEqual([expect.objectContaining({ note: '别说教', keep: true, b: '加油', af: '说得对,互关一个!' })]);
    expect(JSON.stringify(calls[0].messages)).toContain('1. 别说教');
    await draftAskReply({ account: 'ME', tweet: 't', person: {}, revise: { previous: '加油', note: '短一点', keep: false } });
    expect(notes[1]).toMatchObject({ note: '短一点', keep: false, b: '加油', af: '说得对,互关一个!' });
    expect(JSON.stringify(calls[1].messages)).not.toContain('1. 短一点');
    expect(JSON.stringify(calls[1].messages)).toContain('他对上一版的点评(照着改):短一点');
  });
});

describe('⭐ 草稿没成 → 长期要求不记(10-22 真机:先记后拟,被拒后人又点两次 → 三条长期要求)', () => {
  it('Gemma 回的不合格 → 一条都不记', async () => {
    notes.length = 0;
    reply = '好'.repeat(80);
    const r = await draftAskReply({ account: 'ME', tweet: 't', person: {}, revise: { previous: '加油', note: '换成英文', keep: true } });
    expect(r.ok).toBe(false);
    expect(notes).toEqual([]);
    reply = '「说得对,互关一个!」';
  });
});

describe('⭐ 外语草稿必须回译(记忆 project-x-multilang-reply-risk;用户 10-22 要英文回复)', () => {
  it('英文草稿照给,带上中文意思;回译失败要说出来;中文草稿不回译', async () => {
    reply = 'That face is priceless, he totally forgot how to dog!';
    translated = '他那表情太绝了';
    expect(await draftAskReply({ account: 'ME', tweet: 't', person: {}, mode: 'engage' })).toMatchObject({ ok: true, text: reply, meaning: '他那表情太绝了' });
    translated = null;
    const r = await draftAskReply({ account: 'ME', tweet: 't', person: {}, mode: 'engage' });
    expect(r).toMatchObject({ ok: true, text: reply });
    expect(r.ok && r.meaningProblem).toContain('没回译成中文');
    reply = '说得对';
    const z = await draftAskReply({ account: 'ME', tweet: 't', person: {} });
    expect(z.ok && z.meaning).toBeUndefined();
    reply = '「说得对,互关一个!」';
  });
});
