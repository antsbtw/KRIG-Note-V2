/**
 * ⭐ 草拟必须关掉思考(2026-10-21 真机:开着一条 30~80 秒、5 条里 3 条超时;关掉 1~2 秒)
 * 行为测试:mock 掉 Ollama 和库,看 draftAskReply 实际怎么调。
 */
import { describe, it, expect, vi } from 'vitest';

const calls: Array<Record<string, unknown>> = [];
vi.mock('@platform/main/local-llm/ollama-client', () => ({
  callOllamaChat: vi.fn(async (o: Record<string, unknown>) => { calls.push(o); return { content: '「说得对,互关一个!」' }; }),
  callOllama: vi.fn(async () => { throw new Error('草拟不该走 OpenAI 兼容接口(关不了思考)'); }),
}));
vi.mock('@storage/surreal/client', () => ({
  getXDB: () => ({ query: async () => [[{ tweet_text: '#蓝V互关', reply_text: '已关,互关互助!', at: '' }]] }),
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
