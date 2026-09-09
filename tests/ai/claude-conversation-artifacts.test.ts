/**
 * Claude artifact 提取行为快照 —— `getConversationData` 的 artifact / contentParts 那一半
 *
 * 同 `claude-conversation-query.test.ts`:为 Web 能力层重构钉安全网,只测行为不测实现。
 *
 * 这里守的是**最容易在重构中悄悄漂掉**的三件事:
 *  1. `kind` 判定(image / widget / code / table / file / unknown)—— 判错了 Note 里就渲染成别的东西
 *  2. `contentParts` 的**原始顺序**(text 与 artifact 交错)—— 顺序错 = 图文错位
 *  3. `content` 的 payload 形态(widget_code / file_text / local_resource)
 *
 * 载荷结构按 render_all_tools=true 的实测形态手写合成,不含真实对话内容。
 */
import { describe, it, expect } from 'vitest';
import {
  getConversationData,
  type ConversationData,
  type MessageArtifact,
} from '@platform/main/ai/extractors/claude-conversation-query';

function parse(content: unknown[]): ConversationData {
  const data = getConversationData({
    uuid: 'conv-1',
    name: 'artifact 样本',
    chat_messages: [{ uuid: 'a1', sender: 'assistant', index: 0, content }],
  });
  expect(data).not.toBeNull();
  return data as ConversationData;
}

function artifactsOf(content: unknown[]): MessageArtifact[] {
  return parse(content).messages[0].artifacts;
}

const toolUse = (id: string, name: string, input: Record<string, unknown>) =>
  ({ type: 'tool_use', id, name, input });

const localResourceResult = (
  toolUseId: string,
  resources: Array<Record<string, unknown>>,
) => ({
  type: 'tool_result',
  tool_use_id: toolUseId,
  content: resources.map((r) => ({ type: 'local_resource', ...r })),
});

describe('artifact kind 判定 —— show_widget', () => {
  it('widget_code 含 <svg> → kind=image,mimeType 嗅成 image/svg+xml', () => {
    const [a] = artifactsOf([
      toolUse('t1', 'show_widget', { title: '图', widget_code: '<svg viewBox="0 0 1 1"></svg>' }),
    ]);
    expect(a.kind).toBe('image');
    expect(a.title).toBe('图');
    expect(a.content).toEqual({
      type: 'widget_code',
      code: '<svg viewBox="0 0 1 1"></svg>',
      mimeType: 'image/svg+xml',
    });
  });

  it('widget_code 是 HTML → kind=widget,mimeType=text/html', () => {
    const [a] = artifactsOf([
      toolUse('t1', 'show_widget', { title: 'W', widget_code: '<div class="x">hi</div>' }),
    ]);
    expect(a.kind).toBe('widget');
    expect(a.content).toEqual({
      type: 'widget_code',
      code: '<div class="x">hi</div>',
      mimeType: 'text/html',
    });
  });

  it('工具名只要**含** show_widget 就算(前缀变体不许漏判)', () => {
    const [a] = artifactsOf([
      toolUse('t1', 'artifacts_show_widget', { title: 'W', widget_code: '<div>x</div>' }),
    ]);
    expect(a.kind).toBe('widget');
  });
});

describe('artifact kind 判定 —— 文件类工具', () => {
  it('create_file → kind=file,content=file_text 保留完整源码与 path', () => {
    const code = 'export const a = 1;\n';
    const [a] = artifactsOf([
      toolUse('t1', 'create_file', { path: '/home/x/main.ts', file_text: code }),
    ]);
    expect(a.kind).toBe('file');
    expect(a.title).toBe('main.ts');           // 无 title 时取路径末段
    expect(a.content).toEqual({ type: 'file_text', text: code, path: '/home/x/main.ts' });
  });

  it('view → kind=file,title 强制用文件名(不用 input.title)', () => {
    const [a] = artifactsOf([
      toolUse('t1', 'view', { title: '不该被用', path: '/a/b/report.md', file_text: '# x' }),
    ]);
    expect(a.kind).toBe('file');
    expect(a.title).toBe('report.md');
  });

  it('present_files 无 local_resource 时 → kind=file,title 是文件名逗号连接', () => {
    const [a] = artifactsOf([
      toolUse('t1', 'present_files', { filepaths: ['/o/a.csv', '/o/b.png'] }),
    ]);
    expect(a.kind).toBe('file');
    expect(a.title).toBe('a.csv, b.png');
  });
});

describe('artifact kind 判定 —— local_resource 按 mime 分类', () => {
  const cases: Array<[string, string, MessageArtifact['kind']]> = [
    ['image/png', '/o/p.png', 'image'],
    ['image/svg+xml', '/o/s.svg', 'image'],
    ['text/html', '/o/w.html', 'widget'],
    ['application/json', '/o/d.json', 'code'],
    ['text/csv', '/o/t.csv', 'table'],
    ['application/octet-stream', '/o/f.bin', 'file'],
  ];

  for (const [mime, filePath, expected] of cases) {
    it(`${mime} → kind=${expected}`, () => {
      const [a] = artifactsOf([
        toolUse('t1', 'bash_tool', { command: 'echo' }),
        localResourceResult('t1', [{ file_path: filePath, name: filePath.split('/').pop(), mime_type: mime }]),
      ]);
      expect(a.kind).toBe(expected);
      expect(a.content).toEqual({
        type: 'local_resource',
        filePath,
        mimeType: mime,
        name: filePath.split('/').pop(),
        uuid: undefined,
      });
    });
  }

  it('mime 缺失时降级 application/octet-stream,name 缺失时取路径末段', () => {
    const [a] = artifactsOf([
      toolUse('t1', 'bash_tool', { command: 'echo' }),
      localResourceResult('t1', [{ file_path: '/o/nameless.dat' }]),
    ]);
    expect(a.kind).toBe('file');
    expect(a.content).toMatchObject({ mimeType: 'application/octet-stream', name: 'nameless.dat' });
  });
});

describe('artifact —— 不产 artifact 的工具调用被跳过', () => {
  it('普通工具(如 web_search)不产 artifact', () => {
    expect(artifactsOf([toolUse('t1', 'web_search', { query: 'x' })])).toEqual([]);
  });

  it('bash_tool 没有 local_resource 输出时不产 artifact', () => {
    expect(artifactsOf([toolUse('t1', 'bash_tool', { command: 'ls' })])).toEqual([]);
  });

  it('tool_use 没有 input 时不产 artifact,不抛', () => {
    expect(artifactsOf([{ type: 'tool_use', id: 't1', name: 'create_file' }])).toEqual([]);
  });
});

describe('contentParts —— 原始顺序(text 与 artifact 交错)', () => {
  it('⭐ text→artifact→text 的顺序原样保留', () => {
    const data = parse([
      { type: 'text', text: '先说明' },
      toolUse('t1', 'show_widget', { title: 'W', widget_code: '<div>x</div>' }),
      { type: 'text', text: '后总结' },
    ]);
    const parts = data.messages[0].contentParts;
    expect(parts.map((p) => p.type)).toEqual(['text', 'artifact', 'text']);
    expect(parts[0]).toEqual({ type: 'text', text: '先说明' });
    expect(parts[2]).toEqual({ type: 'text', text: '后总结' });
    expect(parts[1].type === 'artifact' && parts[1].artifact.title).toBe('W');
  });

  it('多个 artifact 按出现序排,不按 artifacts 数组重排', () => {
    const data = parse([
      toolUse('t1', 'show_widget', { title: 'A', widget_code: '<div>a</div>' }),
      { type: 'text', text: '中间' },
      toolUse('t2', 'show_widget', { title: 'B', widget_code: '<div>b</div>' }),
    ]);
    const parts = data.messages[0].contentParts;
    expect(parts.map((p) => (p.type === 'artifact' ? p.artifact.title : p.text)))
      .toEqual(['A', '中间', 'B']);
  });

  it('tool_result 与未知 part 不进 contentParts', () => {
    const data = parse([
      { type: 'text', text: '正文' },
      { type: 'tool_result', tool_use_id: 't0', content: [] },
      { type: 'thinking', thinking: '内部' },
    ]);
    expect(data.messages[0].contentParts).toEqual([{ type: 'text', text: '正文' }]);
  });

  it('空 text part 不进 contentParts(不产空块)', () => {
    const data = parse([{ type: 'text', text: '' }, { type: 'text', text: '有内容' }]);
    expect(data.messages[0].contentParts).toEqual([{ type: 'text', text: '有内容' }]);
  });

  it('human 消息只有 text part,不做 artifact 扫描', () => {
    const data = getConversationData({
      uuid: 'c1',
      chat_messages: [{
        uuid: 'h1', sender: 'human', text: '用户提问',
        content: [toolUse('t1', 'show_widget', { title: 'W', widget_code: '<div>x</div>' })],
      }],
    })!;
    expect(data.messages[0].artifacts).toEqual([]);
    expect(data.messages[0].contentParts).toEqual([{ type: 'text', text: '用户提问' }]);
  });

  it('human 消息内容全空白时不产 contentParts', () => {
    const data = getConversationData({
      uuid: 'c1',
      chat_messages: [{ uuid: 'h1', sender: 'human', text: '   \n  ' }],
    })!;
    expect(data.messages[0].contentParts).toEqual([]);
  });
});

describe('contentParts —— 边界', () => {
  it('content 为空数组时 artifacts / contentParts 均为空,不抛', () => {
    const data = parse([]);
    expect(data.messages[0].artifacts).toEqual([]);
    expect(data.messages[0].contentParts).toEqual([]);
    expect(data.messages[0].textContent).toBe('');
  });

  it('content 里混入 null / 字符串等非法项时被跳过,不抛', () => {
    const data = parse([null, 'plain string', 42, { type: 'text', text: '存活' }]);
    expect(data.messages[0].contentParts).toEqual([{ type: 'text', text: '存活' }]);
  });

  it('超长文本原样保留(不截断)', () => {
    const long = 'x'.repeat(200_000);
    const data = parse([{ type: 'text', text: long }]);
    expect(data.messages[0].textContent).toHaveLength(200_000);
  });
});
