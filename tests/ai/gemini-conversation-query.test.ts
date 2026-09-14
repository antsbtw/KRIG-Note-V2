/**
 * Gemini 对话解析行为快照 —— `parseGeminiHistory(body, convId) → GeminiConversationData | null`
 *
 * 同族文件说明见 `claude-conversation-query.test.ts`:为 Web 能力层重构钉安全网,
 * 只测行为(batchexecute 响应体进 → 结构化 turn 出),不测实现。
 *
 * Gemini 这一支有两处**重构中特别容易漂掉**的行为:
 *  1. ⭐ **hNvQHb 是最新在前**,解析层负责倒成时间正序并重排 index。
 *     倒错 = 「最后一轮拿成第一轮」(与 project-chatgpt-extract-stale-cache 同一类事故)。
 *  2. batchexecute 的**帧格式**:`)]}'` 前缀 + 长度头 + JSON 帧,
 *     且注释明说「忽略声明的字节长度(UTF-8/16 不一致)」—— 含中文时长度头对不上是常态,
 *     解析必须仍然成功。
 *
 * 样本是手写的最小合成 batchexecute 响应,深层 path 按源码注释里抓包实测的 path 构造,
 * 不含真实对话内容。
 */
import { describe, it, expect } from 'vitest';
import { parseGeminiHistory } from '@platform/main/ai/extractors/gemini-conversation-query';

// ── 合成 batchexecute 响应 ──

/**
 * 造一个 turn 的原始数组。path 对齐源码注释:
 *   turn[0][0]=convId  turn[0][1]=respId  turn[2][0][0]=用户提问
 *   turn[3][0][0][1][0]=AI markdown   turn[3][0][0][37][0][0]=thinking
 *   turn[4][0]=创建时间(秒)
 */
function makeTurn(opts: {
  convId: string;
  respId: string;
  user: string;
  markdown: string;
  thinking?: string;
  createdAt?: number;
  imageUrls?: string[];
  groundings?: Array<{ title: string; url: string }>;
}) {
  const assistantInner: unknown[] = [];
  assistantInner[1] = [opts.markdown];
  if (opts.thinking !== undefined) {
    assistantInner[37] = [[opts.thinking]];
  }

  // assistant[12] 承载图组与 groundings 两条 path,共用 twelve[0][0] 这一层:
  //   图组:      assistant[12][0][0][0][9][0][0][0] —— 每 slot 的 [3] 是真实 URL
  //   grounding: assistant[12][0][0][14][12]        —— 每条 e[0][0][1] 下挂 title/url
  const twelve: unknown[] = [];
  const shared: unknown[] = [];   // = twelve[0][0]
  twelve[0] = [shared];
  if (opts.imageUrls) {
    const slots = opts.imageUrls.map((u) => { const s: unknown[] = []; s[3] = u; return s; });
    const nine: unknown[] = []; nine[9] = [[[slots]]];
    shared[0] = nine;
  }
  if (opts.groundings) {
    const entries = opts.groundings.map((g) => {
      // e[0][0][1][2] = title;  e[0][0][1][3][1][2][1][0] = url
      const urlLeaf: unknown[] = []; urlLeaf[1] = [g.url];
      const urlMid: unknown[] = []; urlMid[2] = urlLeaf;
      const urlBox: unknown[] = []; urlBox[1] = urlMid;
      const one: unknown[] = []; one[2] = g.title; one[3] = urlBox;
      const inner: unknown[] = []; inner[1] = one;
      return [[inner]];
    });
    const fourteen: unknown[] = []; fourteen[12] = entries;
    shared[14] = fourteen;
  }
  const assistant: unknown[] = [[assistantInner]];
  assistant[12] = twelve;

  const turn: unknown[] = [];
  turn[0] = [opts.convId, opts.respId];
  turn[2] = [[opts.user]];
  turn[3] = assistant;
  turn[4] = [opts.createdAt ?? 0];
  return turn;
}

/** 包成完整 batchexecute 响应体(帧长度故意按 UTF-16 长度写 —— 与真实响应一样对不上) */
function makeBody(turns: unknown[], rpcId = 'hNvQHb'): string {
  const inner = JSON.stringify([turns]);
  const frame = JSON.stringify([['wrb.fr', rpcId, inner, null, null, null, 'generic']]);
  return `)]}'\n\n${frame.length}\n${frame}\n`;
}

describe('parseGeminiHistory —— 帧解析与拒收', () => {
  it('解出 conversationId 与 turn 列表', () => {
    const body = makeBody([
      makeTurn({ convId: 'c_abc', respId: 'r1', user: '问', markdown: '答' }),
    ]);
    const data = parseGeminiHistory(body, 'c_abc');
    expect(data).not.toBeNull();
    expect(data!.conversationId).toBe('c_abc');
    expect(data!.turns).toHaveLength(1);
    expect(data!.turns[0]).toMatchObject({
      index: 0, conversationId: 'c_abc', responseId: 'r1', userMessage: '问', markdown: '答',
    });
  });

  it('⭐ 帧长度头与实际字节数不符时仍能解析(含中文,UTF-8/16 长度不一致)', () => {
    const turns = [makeTurn({ convId: 'c_1', respId: 'r1', user: '中文提问', markdown: '中文回答 🎉' })];
    const inner = JSON.stringify([turns]);
    const frame = JSON.stringify([['wrb.fr', 'hNvQHb', inner, null, null, null, 'generic']]);
    // 故意写一个**错误**的长度头 —— 真实响应就是这样
    const body = `)]}'\n\n1\n${frame}\n`;
    const data = parseGeminiHistory(body, 'c_1');
    expect(data).not.toBeNull();
    expect(data!.turns[0].userMessage).toBe('中文提问');
    expect(data!.turns[0].markdown).toBe('中文回答 🎉');
  });

  it('空 body / 非 batchexecute / 无 hNvQHb rpc → null,不抛也不兜底空对话', () => {
    expect(parseGeminiHistory('', 'c_1')).toBeNull();
    expect(parseGeminiHistory('not a batchexecute body', 'c_1')).toBeNull();
    // 帧里只有别的 rpcId
    expect(parseGeminiHistory(makeBody([makeTurn({ convId: 'c', respId: 'r', user: 'u', markdown: 'm' })], 'other'), 'c_1')).toBeNull();
  });

  it('rpc payload 不是 [turns[]] 形状 → null', () => {
    const frame = JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify({ not: 'an array' }), null, null, null, 'generic']]);
    expect(parseGeminiHistory(`)]}'\n\n${frame.length}\n${frame}\n`, 'c_1')).toBeNull();
  });

  it('turns 为空数组 → 返回空 turns(不是 null),conversationId 仍带出', () => {
    const data = parseGeminiHistory(makeBody([]), 'c_empty');
    expect(data).not.toBeNull();
    expect(data!.turns).toEqual([]);
    expect(data!.conversationId).toBe('c_empty');
  });
});

describe('parseGeminiHistory —— ⭐ 最新在前必须倒成时间正序', () => {
  // hNvQHb 返回最新在前。倒错 = 提取到的「最后一轮」其实是第一轮
  // (与 project-chatgpt-extract-stale-cache 同一类事故:轮次对不准)。
  const body = makeBody([
    makeTurn({ convId: 'c_1', respId: 'r3', user: '第三问', markdown: '第三答', createdAt: 300 }),
    makeTurn({ convId: 'c_1', respId: 'r2', user: '第二问', markdown: '第二答', createdAt: 200 }),
    makeTurn({ convId: 'c_1', respId: 'r1', user: '第一问', markdown: '第一答', createdAt: 100 }),
  ]);

  it('输出按时间正序:第一问在前,第三问在后', () => {
    const turns = parseGeminiHistory(body, 'c_1')!.turns;
    expect(turns.map((t) => t.userMessage)).toEqual(['第一问', '第二问', '第三问']);
    expect(turns.map((t) => t.markdown)).toEqual(['第一答', '第二答', '第三答']);
  });

  it('⭐ 最后一个 turn 是**最新那一轮**', () => {
    const turns = parseGeminiHistory(body, 'c_1')!.turns;
    const last = turns[turns.length - 1];
    expect(last.responseId).toBe('r3');
    expect(last.markdown).toBe('第三答');
    expect(last.createdAt).toBe(300);
  });

  it('index 在倒序后按 0..n-1 重排(不保留原始位置)', () => {
    const turns = parseGeminiHistory(body, 'c_1')!.turns;
    expect(turns.map((t) => t.index)).toEqual([0, 1, 2]);
  });

  it('user/markdown 与 responseId 同轮绑定,不串台', () => {
    const turns = parseGeminiHistory(body, 'c_1')!.turns;
    expect(turns.map((t) => [t.responseId, t.userMessage, t.markdown]))
      .toEqual([['r1', '第一问', '第一答'], ['r2', '第二问', '第二答'], ['r3', '第三问', '第三答']]);
  });
});

describe('parseGeminiHistory —— 缺字段降级', () => {
  it('缺 convId 或 respId 的 turn 被丢弃(其余 turn 不受影响)', () => {
    const bad: unknown[] = []; bad[0] = [null, null]; bad[2] = [['坏 turn']];
    const body = makeBody([bad, makeTurn({ convId: 'c_1', respId: 'r1', user: '好 turn', markdown: 'ok' })]);
    const turns = parseGeminiHistory(body, 'c_1')!.turns;
    expect(turns).toHaveLength(1);
    expect(turns[0].userMessage).toBe('好 turn');
  });

  it('缺 user / markdown 降级空串,缺 thinking 为 null,缺时间为 0', () => {
    const t: unknown[] = []; t[0] = ['c_1', 'r1'];
    const turns = parseGeminiHistory(makeBody([t]), 'c_1')!.turns;
    expect(turns[0]).toMatchObject({
      userMessage: '', markdown: '', thinking: null, createdAt: 0, imageUrls: [], groundings: [],
    });
  });

  it('thinking 存在时原样取出', () => {
    const body = makeBody([makeTurn({ convId: 'c_1', respId: 'r1', user: 'u', markdown: 'm', thinking: '思考过程' })]);
    expect(parseGeminiHistory(body, 'c_1')!.turns[0].thinking).toBe('思考过程');
  });
});

describe('parseGeminiHistory —— 图与 grounding', () => {
  it('只收 lh3. 开头的真实图 URL,占位/异常 slot 被过滤', () => {
    const body = makeBody([makeTurn({
      convId: 'c_1', respId: 'r1', user: 'u', markdown: 'm',
      imageUrls: ['https://lh3.googleusercontent.com/a', 'https://example.com/not-lh3', 'https://lh3.googleusercontent.com/b'],
    })]);
    expect(parseGeminiHistory(body, 'c_1')!.turns[0].imageUrls)
      .toEqual(['https://lh3.googleusercontent.com/a', 'https://lh3.googleusercontent.com/b']);
  });

  it('grounding 取出 title + url,非 http 的被过滤', () => {
    const body = makeBody([makeTurn({
      convId: 'c_1', respId: 'r1', user: 'u', markdown: 'm',
      groundings: [
        { title: '来源一', url: 'https://example.com/1' },
        { title: '坏的', url: 'javascript:void(0)' },
      ],
    })]);
    expect(parseGeminiHistory(body, 'c_1')!.turns[0].groundings)
      .toEqual([{ title: '来源一', url: 'https://example.com/1' }]);
  });
});

describe('parseGeminiHistory —— 代码块不被吃掉(project-markdown-import-unify)', () => {
  it('含嵌套 fence 的 markdown 逐字保留', () => {
    const nested = '说明:\n````markdown\n```ts\nconst a = 1;\n```\n````\n完。';
    const body = makeBody([makeTurn({ convId: 'c_1', respId: 'r1', user: 'u', markdown: nested })]);
    expect(parseGeminiHistory(body, 'c_1')!.turns[0].markdown).toBe(nested);
  });
});
