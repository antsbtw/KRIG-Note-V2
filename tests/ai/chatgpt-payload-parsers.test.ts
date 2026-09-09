/**
 * ⭐⭐ 步 4 还债 —— ChatGPT 载荷解析的纯函数(`08` §6.5.1 记的两笔账)
 *
 * 步 0 补 AI 测试时留下两个缺口,当时的原因是**这些函数未导出、够不着**:
 *
 *   债① 「多轮取最后一轮」没有网。总指挥实测:把 `walkMapping` 的
 *        `children[children.length-1]` 改成 `children[0]`
 *        (**正是 project-chatgpt-extract-stale-cache 那次事故的形态**)
 *        → `tests/ai/` 120 条**一条不红**。
 *
 *   债② 「私用区 marker widget 还原」没有网。不还原,Note 里就会露出
 *        `▤url▤标题▤href▤` 乱码方块(▤ 即未渲染的 U+E200 系 marker)。
 *
 * 步 4 把「取数」与「解析」拆开后,它们**自然落在可测位置** ——
 * 不是给它们加 export 了事(那是把测试需求泄漏进产品)。
 *
 * ⚠️ 本文件测的是**行为**,不是实现。样本全部手写合成,不含真实对话内容。
 */
import { describe, it, expect } from 'vitest';
import {
  walkMapping,
  unwrapWidgets,
  isImageGroupWidget,
  widgetFieldsToMarkdown,
  chartWidgetToMarkdown,
  normalizeMessage,
  extractConversationId,
  sniffMimeFromBase64,
  fileIdFromAssetPointer,
  fileIdFromEstuaryUrl,
} from '@platform/main/ai/parsers/chatgpt-payload';

// ── 私用区 marker(ChatGPT 的内联 widget 编码)──
const START = String.fromCharCode(0xe200);
const END = String.fromCharCode(0xe201);
const SEP = String.fromCharCode(0xe202);

describe('⭐⭐ 债① walkMapping —— 多轮必须取**最后一轮**', () => {
  /**
   * ChatGPT 的对话树:每个节点有 children[]。**重新生成回答会产生兄弟分支**,
   * 最新那次在数组末尾。取 children[0] = 永远拿到第一次生成的旧回答
   * —— 这正是 project-chatgpt-extract-stale-cache 那次「轮次对不准」的形态。
   */
  function tree(nodes: Record<string, { parent?: string | null; children?: string[]; message?: unknown }>) {
    return nodes;
  }

  it('⭐⭐ 有分支时走**最后一个** child(不是第一个)', () => {
    const ordered = walkMapping(tree({
      root: { parent: null, children: ['m1'] },
      m1: { parent: 'root', children: ['old', 'newest'], message: { id: 'm1' } },
      old: { parent: 'm1', children: [], message: { id: 'OLD-第一次生成' } },
      newest: { parent: 'm1', children: [], message: { id: 'NEWEST-重新生成' } },
    }));
    const ids = ordered.map((m) => (m as { id: string }).id);
    expect(ids).toContain('NEWEST-重新生成');
    expect(ids).not.toContain('OLD-第一次生成');
  });

  it('⭐ 多层分支每层都取最后一个', () => {
    const ordered = walkMapping(tree({
      root: { parent: null, children: ['a'] },
      a: { parent: 'root', children: ['b-old', 'b-new'], message: { id: 'a' } },
      'b-old': { parent: 'a', children: [], message: { id: 'b-old' } },
      'b-new': { parent: 'a', children: ['c-old', 'c-new'], message: { id: 'b-new' } },
      'c-old': { parent: 'b-new', children: [], message: { id: 'c-old' } },
      'c-new': { parent: 'b-new', children: [], message: { id: 'c-new' } },
    }));
    const ids = ordered.map((m) => (m as { id: string }).id);
    expect(ids).toEqual(['a', 'b-new', 'c-new']);
  });

  it('线性对话按根→叶顺序返回(最后一条是最新的)', () => {
    const ordered = walkMapping(tree({
      root: { parent: null, children: ['m1'] },
      m1: { parent: 'root', children: ['m2'], message: { id: '第一轮' } },
      m2: { parent: 'm1', children: ['m3'], message: { id: '第二轮' } },
      m3: { parent: 'm2', children: [], message: { id: '第三轮' } },
    }));
    const ids = ordered.map((m) => (m as { id: string }).id);
    expect(ids).toEqual(['第一轮', '第二轮', '第三轮']);
    expect(ids[ids.length - 1]).toBe('第三轮');
  });

  it('无 message 的节点被跳过(root 通常没有)', () => {
    const ordered = walkMapping(tree({
      root: { parent: null, children: ['m1'] },
      m1: { parent: 'root', children: [], message: { id: 'only' } },
    }));
    expect(ordered).toHaveLength(1);
  });

  it('空 mapping / 无根节点不抛', () => {
    expect(walkMapping({})).toEqual([]);
  });
});

describe('⭐⭐ 债② 私用区 marker widget 还原 —— 防 ▤url▤ 乱码进 Note', () => {
  it('⭐⭐ url widget 还原成 markdown 链接', () => {
    // 实测真实样例:<U+E200>url<U+E202>IPinfo<U+E202>https://ipinfo.io<U+E201>
    const text = `前文${START}url${SEP}IPinfo${SEP}https://ipinfo.io${END}后文`;
    expect(unwrapWidgets(text)).toBe('前文[IPinfo](https://ipinfo.io)后文');
  });

  it('⭐⭐ 游离的 marker 被剥掉 —— 绝不让乱码方块进 Note', () => {
    // 不剥就会在 Note 里露出 ▤ 方块
    const text = `正文${SEP}中间${END}结尾`;
    const out = unwrapWidgets(text);
    expect(out).toBe('正文中间结尾');
    for (let i = 0; i < out.length; i++) {
      const c = out.charCodeAt(i);
      expect(c < 0xe000 || c > 0xf8ff, `位置 ${i} 残留私用区字符`).toBe(true);
    }
  });

  it('⭐ 没配对到 END 时跳过起始 marker,不输出乱码', () => {
    const text = `前${START}url${SEP}标题`;
    const out = unwrapWidgets(text);
    expect(out).not.toContain(START);
    expect(out).not.toContain(SEP);
  });

  it('⭐ 嵌套异常(又遇到 START)放弃本段,不吞掉后文', () => {
    const text = `${START}url${SEP}a${START}url${SEP}b${SEP}https://x.com${END}`;
    const out = unwrapWidgets(text);
    expect(out).not.toContain(START);
    expect(out).not.toContain(END);
  });

  it('无 marker 的普通文本原样返回(快速路径)', () => {
    const text = '就是一段普通文字,含 emoji 🎉 和代码 `x`';
    expect(unwrapWidgets(text)).toBe(text);
  });

  it('⭐ image_group 换成位置占位符(保留它在原文的位置)', () => {
    const json = JSON.stringify({ layout: 'carousel', query: ['cat'] });
    const text = `前${START}image_group${SEP}${json}${END}后`;
    const out = unwrapWidgets(text);
    expect(out).toContain('{{IMAGE_GROUP_0}}');
    expect(out.indexOf('前')).toBeLessThan(out.indexOf('{{IMAGE_GROUP_0}}'));
    expect(out.indexOf('{{IMAGE_GROUP_0}}')).toBeLessThan(out.indexOf('后'));
  });

  it('⭐ 多个 image_group 按出现序编号(与 buildChatGPTMessageBody 的插图对应)', () => {
    const json = JSON.stringify({ layout: 'carousel' });
    const text = `${START}image_group${SEP}${json}${END}中${START}image_group${SEP}${json}${END}`;
    const out = unwrapWidgets(text);
    expect(out).toContain('{{IMAGE_GROUP_0}}');
    expect(out).toContain('{{IMAGE_GROUP_1}}');
    expect(out.indexOf('{{IMAGE_GROUP_0}}')).toBeLessThan(out.indexOf('{{IMAGE_GROUP_1}}'));
  });

  it('代码块里的内容不受影响(project-markdown-import-unify)', () => {
    const code = '```ts\nconst a = 1;\n```';
    expect(unwrapWidgets(code)).toBe(code);
  });
});

describe('widget 分类与渲染', () => {
  it('isImageGroupWidget:按类型名或 JSON 特征识别', () => {
    expect(isImageGroupWidget('image_group', [])).toBe(true);
    expect(isImageGroupWidget('IMAGE_GROUP', [])).toBe(true);
    expect(isImageGroupWidget('genui', [JSON.stringify({ layout: 'carousel' })])).toBe(true);
    expect(isImageGroupWidget('genui', [JSON.stringify({ query: ['a'] })])).toBe(true);
    expect(isImageGroupWidget('url', ['标题', 'https://x.com'])).toBe(false);
  });

  it('url widget:字段顺序为 [标题, href];只给 href 时用 href 当标题', () => {
    expect(widgetFieldsToMarkdown('url', ['IPinfo', 'https://ipinfo.io']))
      .toBe('[IPinfo](https://ipinfo.io)');
    expect(widgetFieldsToMarkdown('url', ['https://only.io']))
      .toBe('[https://only.io](https://only.io)');
  });

  it('⭐ 未知类型:剥掉 JSON 字段只留可读文本;全 JSON 则返空(不污染正文)', () => {
    expect(widgetFieldsToMarkdown('unknown', ['可读文本', '{"a":1}'])).toBe('可读文本');
    expect(widgetFieldsToMarkdown('unknown', ['{"a":1}'])).toBe('');
  });

  it('charts_widget_v2 → markdown 表格,列名用 series.label 美化', () => {
    const md = chartWidgetToMarkdown({
      meta: { title: '组合价值', description: '按年' },
      series: [{ dataKey: 'value', label: 'Portfolio Value' }],
      data: [{ year: '0', value: 1000 }, { year: '1', value: 1100 }],
    });
    expect(md).toContain('**组合价值**');
    expect(md).toContain('| year | Portfolio Value |');
    expect(md).toContain('| 0 | 1000 |');
  });

  it('chart 无数据时返 null(不产空表格)', () => {
    expect(chartWidgetToMarkdown({ data: [] })).toBeNull();
    expect(chartWidgetToMarkdown({})).toBeNull();
  });
});

describe('normalizeMessage —— 消息归一', () => {
  it('parts 里的字符串拼成正文,并做 widget 还原', () => {
    const msg = normalizeMessage({
      id: 'm1', author: { role: 'assistant' },
      content: { parts: ['前', `${START}url${SEP}T${SEP}https://x.com${END}`] },
    });
    expect(msg.role).toBe('assistant');
    expect(msg.text).toContain('[T](https://x.com)');
  });

  it('asset_pointer / attachments / aggregate_result 的 fileId 都收集且去重', () => {
    const msg = normalizeMessage({
      id: 'm1', author: { role: 'assistant' },
      content: { parts: [{ asset_pointer: 'file-service://file_AAA' }] },
      metadata: {
        attachments: [{ id: 'file_AAA' }, { id: 'file_BBB' }],
        aggregate_result: { messages: [{ image_url: 'file_CCC' }] },
      },
    });
    expect(msg.fileRefs.sort()).toEqual(['file_AAA', 'file_BBB', 'file_CCC']);
  });

  it('⭐ image_group 的真实 URL 按组收集(顺序对应 {{IMAGE_GROUP_N}})', () => {
    const msg = normalizeMessage({
      id: 'm1', author: { role: 'assistant' }, content: { parts: [] },
      metadata: {
        content_references: [
          { type: 'image_group', images: [{ image_result: { content_url: 'https://i/1.png' } }] },
          { type: 'other', images: [{ image_result: { content_url: 'https://i/skip.png' } }] },
          { type: 'image_group', images: [{ image_result: { content_url: 'https://i/2.png' } }] },
        ],
      },
    });
    expect(msg.imageGroups).toEqual([['https://i/1.png'], ['https://i/2.png']]);
  });

  it('未知 role 归 system;hidden 标记透传', () => {
    expect(normalizeMessage({ id: 'm', author: { role: 'weird' }, content: { parts: [] } }).role).toBe('system');
    expect(normalizeMessage({
      id: 'm', author: { role: 'user' }, content: { parts: [] },
      metadata: { is_visually_hidden_from_conversation: true },
    }).hidden).toBe(true);
  });

  it('缺字段时不抛(载荷形状变了也不崩)', () => {
    const msg = normalizeMessage({});
    expect(msg.role).toBe('system');
    expect(msg.text).toBe('');
    expect(msg.fileRefs).toEqual([]);
  });
});

describe('URL / ID helpers', () => {
  it('extractConversationId 只认 /c/{36位uuid}', () => {
    const uuid = '0191aaaa-bbbb-cccc-dddd-eeeeffff0000';
    expect(extractConversationId(`https://chatgpt.com/c/${uuid}`)).toBe(uuid);
    expect(extractConversationId('https://chatgpt.com/')).toBeNull();
    expect(extractConversationId('https://chatgpt.com/c/short')).toBeNull();
  });

  it('sniffMimeFromBase64 按魔数识别常见类型', () => {
    expect(sniffMimeFromBase64('iVBORw0KGgo=')).toBe('image/png');
    expect(sniffMimeFromBase64('/9j/4AAQ')).toBe('image/jpeg');
    expect(sniffMimeFromBase64('R0lGODlhAQ')).toBe('image/gif');
    expect(sniffMimeFromBase64('JVBERi0x')).toBe('application/pdf');
    expect(sniffMimeFromBase64('unknown-data')).toBeNull();
    expect(sniffMimeFromBase64(null)).toBeNull();
  });

  it('fileId 从 asset_pointer / estuary URL 提取', () => {
    expect(fileIdFromAssetPointer('file-service://file_ABC123')).toBe('file_ABC123');
    expect(fileIdFromAssetPointer(null)).toBeNull();
    expect(fileIdFromEstuaryUrl('/backend-api/estuary/content?id=file_XYZ&x=1')).toBe('file_XYZ');
    expect(fileIdFromEstuaryUrl('/backend-api/estuary/content')).toBeNull();
  });
});
