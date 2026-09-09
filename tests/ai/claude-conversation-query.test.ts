/**
 * Claude 对话解析行为快照 —— `getConversationData(raw) → ConversationData | null`
 *
 * ⚠️ 这不是「测新代码」,是给 **Web 能力层重构**(docs/10-business-design/web/capability-layer/)
 * 钉一层安全网:AI 提取链路要从「自己 attach CDP」迁到 `web.net.subscribe`,
 * 迁移前后**行为必须一致**。没有这层测试,「迁移后没坏」只能靠人工点几下,不可回归。
 *
 * 因此本文件只测**行为**(载荷进 → 结构化对话出),不测实现:
 * 不断言内部调了哪个函数、走了哪个分支 —— 迁移后实现会变,测试不该跟着改。
 * 测试跟着改 = 安全网失效。
 *
 * 样本全部是**手写最小合成载荷**(无真实对话内容,无隐私),
 * 结构按 `/api/organizations/{org}/chat_conversations/{id}?render_all_tools=true` 的实测形态。
 */
import { describe, it, expect } from 'vitest';
import {
  getConversationData,
  type ConversationData,
} from '@platform/main/ai/extractors/claude-conversation-query';

// ── 合成载荷构件(最小、可读、无隐私)──

function humanMsg(uuid: string, text: string, index: number) {
  return { uuid, sender: 'human', index, text, content: [{ type: 'text', text }] };
}

function assistantMsg(uuid: string, index: number, content: unknown[]) {
  return { uuid, sender: 'assistant', index, content };
}

function conversation(messages: unknown[], extra: Record<string, unknown> = {}) {
  return {
    uuid: 'conv-uuid-1',
    name: '合成对话',
    model: 'claude-test',
    current_leaf_message_uuid: 'leaf-1',
    chat_messages: messages,
    ...extra,
  };
}

/** 非空断言:让 TS 收窄,同时**测试自己也是一道断言** —— 返 null 直接红 */
function parse(raw: Record<string, unknown>): ConversationData {
  const data = getConversationData(raw);
  expect(data).not.toBeNull();
  return data as ConversationData;
}

describe('getConversationData —— 顶层字段与拒收', () => {
  it('把 raw 顶层字段映射到 ConversationData', () => {
    const data = parse(conversation([]));
    expect(data.uuid).toBe('conv-uuid-1');
    expect(data.name).toBe('合成对话');
    expect(data.model).toBe('claude-test');
    expect(data.currentLeafMessageUuid).toBe('leaf-1');
    expect(data.messages).toEqual([]);
  });

  it('没有 uuid 的载荷返 null —— 不许兜底造一个假 id', () => {
    expect(getConversationData({ name: 'x', chat_messages: [] })).toBeNull();
    expect(getConversationData({ uuid: '', chat_messages: [] })).toBeNull();
    expect(getConversationData({})).toBeNull();
  });

  it('name 缺失降级为空串,model / leaf 缺失为 undefined(不是 null)', () => {
    const data = parse({ uuid: 'u1', chat_messages: [] });
    expect(data.name).toBe('');
    expect(data.model).toBeUndefined();
    expect(data.currentLeafMessageUuid).toBeUndefined();
  });

  it('chat_messages 不是数组时当空处理,不抛', () => {
    expect(parse({ uuid: 'u1', chat_messages: null }).messages).toEqual([]);
    expect(parse({ uuid: 'u1' }).messages).toEqual([]);
  });

  it('单条消息缺 uuid 被跳过,不影响其它消息', () => {
    const data = parse(conversation([
      { sender: 'human', index: 0, text: '没有 uuid' },
      humanMsg('m2', '有 uuid', 1),
    ]));
    expect(data.messages.map((m) => m.uuid)).toEqual(['m2']);
  });
});

describe('getConversationData —— 多轮对话顺序(project-chatgpt-extract-stale-cache 同族)', () => {
  // 历史事故:提取多轮对话时重复拿到**旧的最后一轮**(缓存冻结)。
  // 那个 bug 在 ChatGPT 侧的取数层,但「最后一轮必须是最后一轮」这条不变量
  // 三家共用 —— Claude 侧在这里钉死。
  const raw = conversation([
    humanMsg('h1', '第一问', 0),
    assistantMsg('a1', 1, [{ type: 'text', text: '第一答' }]),
    humanMsg('h2', '第二问', 2),
    assistantMsg('a2', 3, [{ type: 'text', text: '第二答' }]),
    humanMsg('h3', '第三问', 4),
    assistantMsg('a3', 5, [{ type: 'text', text: '第三答' }]),
  ]);

  it('保留全部轮次,顺序与 chat_messages 一致', () => {
    const data = parse(raw);
    expect(data.messages).toHaveLength(6);
    expect(data.messages.map((m) => m.uuid)).toEqual(['h1', 'a1', 'h2', 'a2', 'h3', 'a3']);
  });

  it('⭐ 最后一条 assistant 是**最新那一轮**,不是第一轮', () => {
    const data = parse(raw);
    const assistants = data.messages.filter((m) => m.sender === 'assistant');
    expect(assistants).toHaveLength(3);
    expect(assistants[assistants.length - 1].textContent).toBe('第三答');
    expect(assistants[assistants.length - 1].uuid).toBe('a3');
  });

  it('每轮内容互不串台(第 N 轮拿到的是第 N 轮的文本)', () => {
    const data = parse(raw);
    expect(data.messages.map((m) => m.textContent)).toEqual([
      '第一问', '第一答', '第二问', '第二答', '第三问', '第三答',
    ]);
  });

  it('index 用载荷给的值;载荷没给则按出现序补位', () => {
    const withIndex = parse(raw);
    expect(withIndex.messages.map((m) => m.index)).toEqual([0, 1, 2, 3, 4, 5]);

    const noIndex = parse(conversation([
      { uuid: 'x1', sender: 'human', text: 'a' },
      { uuid: 'x2', sender: 'human', text: 'b' },
    ]));
    expect(noIndex.messages.map((m) => m.index)).toEqual([0, 1]);
  });
});

describe('getConversationData —— sender 归类', () => {
  it('human / assistant 原样保留,其余一律归 system', () => {
    const data = parse(conversation([
      { uuid: 'm1', sender: 'human', text: 'h' },
      { uuid: 'm2', sender: 'assistant', content: [{ type: 'text', text: 'a' }] },
      { uuid: 'm3', sender: 'system', text: 's' },
      { uuid: 'm4', sender: 'weird-new-role', text: 'w' },
      { uuid: 'm5', text: 'no sender' },
    ]));
    expect(data.messages.map((m) => m.sender)).toEqual([
      'human', 'assistant', 'system', 'system', 'system',
    ]);
  });
});

describe('getConversationData —— textContent 来源', () => {
  it('顶层 text 优先于 content[] 拼接', () => {
    const data = parse(conversation([
      { uuid: 'm1', sender: 'human', text: '顶层文本', content: [{ type: 'text', text: '数组文本' }] },
    ]));
    expect(data.messages[0].textContent).toBe('顶层文本');
  });

  it('无顶层 text 时,由 content[] 的 text part 用空行拼接', () => {
    const data = parse(conversation([
      assistantMsg('a1', 0, [
        { type: 'text', text: '第一段' },
        { type: 'text', text: '第二段' },
      ]),
    ]));
    expect(data.messages[0].textContent).toBe('第一段\n\n第二段');
  });

  it('非 text 类型的 part 不进 textContent', () => {
    const data = parse(conversation([
      assistantMsg('a1', 0, [
        { type: 'text', text: '正文' },
        { type: 'tool_result', tool_use_id: 't1', content: [] },
        { type: 'thinking', thinking: '不该出现' },
      ]),
    ]));
    expect(data.messages[0].textContent).toBe('正文');
  });
});

describe('getConversationData —— 代码块不被吃掉(project-markdown-import-unify)', () => {
  // 历史事故:AI 提取代码块丢失(嵌套 fence 被按错配对吃掉)。
  // 解析层的职责是**原样端出**,任何裁剪/重排都是 bug。
  it('含嵌套 fence 的代码块逐字保留', () => {
    const nested = [
      '这是说明:',
      '````markdown',
      '内层示例:',
      '```ts',
      'const a = 1;',
      '```',
      '````',
      '结束。',
    ].join('\n');

    const data = parse(conversation([assistantMsg('a1', 0, [{ type: 'text', text: nested }])]));
    expect(data.messages[0].textContent).toBe(nested);
    expect(data.messages[0].contentParts).toEqual([{ type: 'text', text: nested }]);
  });

  it('代码块里的 markdown 标记 / 反引号数量原样保留', () => {
    const tricky = '```\n``` 三个反引号在正文里\n`单反引号`\n```';
    const data = parse(conversation([assistantMsg('a1', 0, [{ type: 'text', text: tricky }])]));
    expect(data.messages[0].textContent).toBe(tricky);
  });
});
