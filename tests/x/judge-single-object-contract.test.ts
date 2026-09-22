import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * ⭐⭐ 判断层必须**逐条问**(单条对象契约),不能一次把一批塞进去。
 *
 * ── 2026-09-21 实测现场 ──
 * 现象:x-ai-judge 反复空转(fetch failed / no verdict array),积压 3300 条清不动。
 * ⚠️ 真因**不是** Ollama 挂了 —— /api/tags 200、模型已加载、HTTP 全程 200、
 *    finish_reason=stop。是**数组契约下模型只答第一条就收尾**:
 *      25 条 → 0 条判断(completion_tokens 仅 83)
 *      10 条 → 0 条(ctok 89)
 *      15 条 → 15 条(ctok 1552)    ← 时好时坏,**不是**规模阈值
 *       5 条 → 四个切片里两个 0 条
 *    改单条对象契约后,同一个 0/5 的切片变成 5/5。
 *
 * ⚠️ 「把 batchSize 调小」**不是**修法(我一开始就这么误判,5 条那次纯属运气)——
 *    所以这条守卫钉的是**调用次数**,不是批大小。
 *
 * ⭐ 用行为测试(spy 数调用次数)而不是源码扫描:
 *    `toMatch(/for .* of batch/)` 这类文本断言看不出「有没有真的逐条调」。
 */

const callOllama = vi.fn();
const updateVerdict = vi.fn();
const markAiJudging = vi.fn();
const dbQuery = vi.fn();

vi.mock('../../src/platform/main/local-llm/ollama-client', () => ({
  callOllama: (...a: unknown[]) => callOllama(...a),
}));
vi.mock('../../src/platform/main/db/tweet-inbox-repo', () => ({
  queryPending: vi.fn(),
  markAiJudging: (...a: unknown[]) => markAiJudging(...a),
  updateVerdict: (...a: unknown[]) => updateVerdict(...a),
}));
vi.mock('@storage/surreal/client', () => ({
  getXDB: () => ({ query: (...a: unknown[]) => dbQuery(...a) }),
}));

const mkTweet = (id: string) => ({
  tweet_id: id, text: `tweet ${id}`, lang: 'zh',
}) as never;

const verdictFor = (id: string) => ({
  content: JSON.stringify({
    tweetId: id, worth: false, confidence: 0.9,
    reason: 'r', tags: [], suggestReply: false, translation: '',
  }),
});

describe('⭐⭐ x-ai-judge 单条对象契约', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbQuery.mockResolvedValue(undefined);
    markAiJudging.mockResolvedValue(undefined);
    updateVerdict.mockResolvedValue(undefined);
  });

  it('一批 N 条 → 必须调用模型 N 次(逐条),不是 1 次(整批)', async () => {
    const { judgeWithOllama } = await import('../../src/platform/main/x/x-ai-judge');
    const batch = ['a', 'b', 'c', 'd', 'e'].map(mkTweet);
    callOllama.mockImplementation((opts: { messages: Array<{ content: string }> }) =>
      Promise.resolve(verdictFor(JSON.parse(opts.messages[1].content).tweetId)));

    const r = await judgeWithOllama(batch, { model: 'm', ollamaEndpoint: 'e', timeoutMs: 1 } as never);

    expect(callOllama).toHaveBeenCalledTimes(5);   // ← 整批一次调用会变 1,红
    expect(r.judged).toBe(5);
  });

  it('送给模型的是**单个对象**,不是数组', async () => {
    const { judgeWithOllama } = await import('../../src/platform/main/x/x-ai-judge');
    callOllama.mockImplementation((opts: { messages: Array<{ content: string }> }) =>
      Promise.resolve(verdictFor(JSON.parse(opts.messages[1].content).tweetId)));

    await judgeWithOllama([mkTweet('a'), mkTweet('b')], { model: 'm' } as never);

    for (const call of callOllama.mock.calls) {
      const payload = JSON.parse((call[0] as { messages: Array<{ content: string }> }).messages[1].content);
      expect(Array.isArray(payload)).toBe(false);
      expect(payload.tweetId).toBeTruthy();
    }
  });

  it('⭐ 单条失败只赔那一条 —— 其余照常落库(旧形态是整批回退)', async () => {
    const { judgeWithOllama } = await import('../../src/platform/main/x/x-ai-judge');
    const batch = ['a', 'bad', 'c'].map(mkTweet);
    callOllama.mockImplementation((opts: { messages: Array<{ content: string }> }) => {
      const id = JSON.parse(opts.messages[1].content).tweetId;
      if (id === 'bad') return Promise.reject(new Error('模型抽风'));
      return Promise.resolve(verdictFor(id));
    });

    const r = await judgeWithOllama(batch, { model: 'm' } as never);

    expect(r.judged).toBe(2);                       // 好的两条照样判成
    expect(updateVerdict).toHaveBeenCalledTimes(2);
    // 坏的那条回退 pending(而不是三条一起退)
    const reverted = dbQuery.mock.calls.filter((c) => String(c[0]).includes("'pending'"));
    expect(reverted.length).toBe(1);
  });

  it('全批都失败才整体上抛(fail loud,不静默当空批)', async () => {
    const { judgeWithOllama } = await import('../../src/platform/main/x/x-ai-judge');
    callOllama.mockRejectedValue(new Error('Ollama 真挂了'));

    await expect(judgeWithOllama([mkTweet('a'), mkTweet('b')], { model: 'm' } as never))
      .rejects.toThrow(/全部失败/);
  });
});
