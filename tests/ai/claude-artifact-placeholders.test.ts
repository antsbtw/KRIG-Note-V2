/**
 * Claude Artifact 占位符行为快照 —— `claude-api-extractor.ts` 的纯函数族
 *
 * 同族文件说明见 `claude-conversation-query.test.ts`:为 Web 能力层重构钉安全网,
 * 只测行为(消息文本 + 抓到的素材 进 → 填好的 markdown 出),不测实现。
 *
 * 背景:Claude 服务端对非官方客户端一律回填占位符
 *   ```
 *   This block is not supported on your current device yet.
 *   ```
 * 真实 artifact 内容得从别的通道抓(postMessage hook / 版本 API / 拷贝按钮)再填回去。
 * **填回去时的下标对应关系**是这一族最容易在重构中漂掉的东西:
 *  - `fillArtifactPlaceholders` 是**倒序**配对(最新素材配最后一个占位符)
 *  - 其余三个 `fillArtifactPlaceholdersWith*` 是**正序**配对
 * 漂了不会抛异常,只会把 A 的代码填进 B 的位置 —— 典型「看着成功实际错了」。
 *
 * 另一条守的是 **project-markdown-import-unify**(AI 提取代码块丢失):
 * 填进去的源码必须逐字保留,尤其含嵌套 fence 的。
 */
import { describe, it, expect } from 'vitest';
import {
  CLAUDE_ARTIFACT_PLACEHOLDER,
  collapseAdjacentArtifactPlaceholders,
  countArtifactPlaceholders,
  trimLeadingArtifactPlaceholder,
  fillArtifactPlaceholders,
  fillArtifactPlaceholdersWithImages,
  fillArtifactPlaceholdersWithMarkdownPieces,
  fillArtifactPlaceholdersWithSparseMarkdownPieces,
  replaceArtifactPlaceholders,
  extractArtifactSourceFromPayload,
  collectArtifactSources,
  isClaudeConversationPage,
  extractConversationId,
} from '@platform/main/ai/extractors/claude-api-extractor';

/** 一个占位符块(与服务端真实回填形态一致) */
const PH = '```\n' + CLAUDE_ARTIFACT_PLACEHOLDER + '\n```';

describe('countArtifactPlaceholders —— 计数', () => {
  it('数出正文里的占位符个数', () => {
    expect(countArtifactPlaceholders('')).toBe(0);
    expect(countArtifactPlaceholders('只有文字')).toBe(0);
    expect(countArtifactPlaceholders(PH)).toBe(1);
    expect(countArtifactPlaceholders(`前\n\n${PH}\n\n中\n\n${PH}\n\n后`)).toBe(2);
  });

  it('相邻占位符先折叠再计数(连着 3 个只算 1 个)', () => {
    expect(countArtifactPlaceholders(`${PH}\n${PH}\n${PH}`)).toBe(1);
  });

  it('长得像但文案不同的代码块不算占位符', () => {
    expect(countArtifactPlaceholders('```\nThis block is fine.\n```')).toBe(0);
  });
});

describe('collapseAdjacentArtifactPlaceholders —— 相邻折叠', () => {
  it('连续多个折成一个,被文字隔开的不折', () => {
    expect(collapseAdjacentArtifactPlaceholders(`${PH}\n${PH}`)).toBe(PH);
    expect(collapseAdjacentArtifactPlaceholders(`${PH}\n\n文字\n\n${PH}`))
      .toBe(`${PH}\n\n文字\n\n${PH}`);
  });

  it('CRLF 载荷先归一成 LF', () => {
    const crlf = `${PH}\n${PH}`.replace(/\n/g, '\r\n');
    expect(collapseAdjacentArtifactPlaceholders(crlf)).toBe(PH);
  });

  it('空串原样返回', () => {
    expect(collapseAdjacentArtifactPlaceholders('')).toBe('');
  });
});

describe('trimLeadingArtifactPlaceholder —— 掐掉开头的野占位符', () => {
  it('开头的占位符被剥掉,正文保留', () => {
    expect(trimLeadingArtifactPlaceholder(`${PH}\n\n真正的回答`)).toBe('真正的回答');
  });

  it('⭐ 剥完啥都不剩时原样返回(不许把整条消息剥空)', () => {
    expect(trimLeadingArtifactPlaceholder(PH)).toBe(PH);
    expect(trimLeadingArtifactPlaceholder(`${PH}\n\n   \n`)).toBe(`${PH}\n\n   \n`);
  });

  it('不在开头的占位符不动', () => {
    const text = `正文在前\n\n${PH}`;
    expect(trimLeadingArtifactPlaceholder(text)).toBe(text);
  });
});

describe('fillArtifactPlaceholders —— ⭐ 倒序配对(最新素材 → 最后一个占位符)', () => {
  const long = (tag: string) => `<div class="${tag}">${'x'.repeat(60)}</div>`;

  it('单个占位符填进抓到的源码,包成 code fence', () => {
    const src = long('a');
    const { text, filled, remaining } = fillArtifactPlaceholders(`前\n\n${PH}\n\n后`, [src]);
    expect(filled).toBe(1);
    expect(remaining).toBe(0);
    expect(text).toBe('前\n\n```html\n' + src + '\n```\n\n后');
  });

  it('⭐ 两个占位符 + 两份素材(最新在前):最后一个占位符拿到最新那份', () => {
    const newest = long('newest');
    const older = long('older');
    const { text, filled } = fillArtifactPlaceholders(
      `A\n\n${PH}\n\nB\n\n${PH}\n\nC`,
      [newest, older],   // collectArtifactSources 的契约:newest first
    );
    expect(filled).toBe(2);
    const firstIdx = text.indexOf(older);
    const secondIdx = text.indexOf(newest);
    expect(firstIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(firstIdx); // older 在前、newest 在后
  });

  it('素材不够时,未填的占位符原样留下并计入 remaining', () => {
    const { text, filled, remaining } = fillArtifactPlaceholders(
      `A\n\n${PH}\n\nB\n\n${PH}`,
      [long('only')],
    );
    expect(filled).toBe(1);
    expect(remaining).toBe(1);
    expect(text).toContain(CLAUDE_ARTIFACT_PLACEHOLDER);
  });

  it('无素材时原样返回,remaining 报出真实待填数 —— 不静默当成功', () => {
    const input = `A\n\n${PH}`;
    const { text, filled, remaining } = fillArtifactPlaceholders(input, []);
    expect(text).toBe(input);
    expect(filled).toBe(0);
    expect(remaining).toBe(1);
  });

  it('SVG 源码走图片而不是 code fence', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
    const { text } = fillArtifactPlaceholders(PH, [svg]);
    expect(text.startsWith('![Claude Artifact](data:image/svg+xml;base64,')).toBe(true);
    const b64 = text.slice(text.indexOf('base64,') + 7, text.lastIndexOf(')'));
    expect(Buffer.from(b64, 'base64').toString('utf-8')).toBe(svg);
  });

  it('占位符的 info 串(```tsx)被保留成 fence 语言', () => {
    const src = long('t');
    const withInfo = '```tsx\n' + CLAUDE_ARTIFACT_PLACEHOLDER + '\n```';
    const { text } = fillArtifactPlaceholders(withInfo, [src]);
    expect(text.startsWith('```tsx\n')).toBe(true);
  });

  it('⭐ 代码块不被吃掉:填进去的嵌套 fence 源码逐字保留(project-markdown-import-unify)', () => {
    const src = '````markdown\n```ts\nconst a = 1;\n```\n````\n' + 'x'.repeat(60);
    const { text } = fillArtifactPlaceholders(PH, [src]);
    expect(text).toContain(src);
  });
});

describe('fillArtifactPlaceholdersWithImages / MarkdownPieces —— 正序配对', () => {
  it('⭐ 图片按文档顺序正序配对:第 1 个占位符拿 pieces[0]', () => {
    const { text, filled } = fillArtifactPlaceholdersWithImages(
      `A\n\n${PH}\n\nB\n\n${PH}`,
      ['data:image/png;base64,FIRST', 'data:image/png;base64,SECOND'],
    );
    expect(filled).toBe(2);
    expect(text.indexOf('FIRST')).toBeLessThan(text.indexOf('SECOND'));
  });

  it('markdown 片段同样正序配对,片段原样嵌入', () => {
    const { text, filled } = fillArtifactPlaceholdersWithMarkdownPieces(
      `${PH}\n\n中间\n\n${PH}`,
      ['```mermaid\ngraph TD;\n```', '![](media://abc)'],
    );
    expect(filled).toBe(2);
    expect(text).toBe('```mermaid\ngraph TD;\n```\n\n中间\n\n![](media://abc)');
  });

  it('⭐ sparse 版:中间那份缺失时,后面的**不前移**(位置不错位)', () => {
    const { text, filled, remaining } = fillArtifactPlaceholdersWithSparseMarkdownPieces(
      `${PH}\n\nA\n\n${PH}\n\nB\n\n${PH}`,
      ['第一份', null, '第三份'],
    );
    expect(filled).toBe(2);
    expect(remaining).toBe(1);
    expect(text).toBe(`第一份\n\nA\n\n${PH}\n\nB\n\n第三份`);
  });

  it('空素材列表时原样返回并报出 remaining', () => {
    const input = `A\n\n${PH}`;
    for (const fn of [fillArtifactPlaceholdersWithImages, fillArtifactPlaceholdersWithMarkdownPieces]) {
      const r = fn(input, []);
      expect(r).toEqual({ text: input, filled: 0, remaining: 1 });
    }
  });
});

describe('replaceArtifactPlaceholders —— 兜底 callout', () => {
  it('[!note] 独占第一行(ResultParser 的 callout 正则要求)', () => {
    const out = replaceArtifactPlaceholders(PH);
    expect(out.split('\n')[0]).toBe('> [!note]');
    expect(out).toContain('> 📥 此处图片请点击 Claude 页面的拷贝按钮');
    expect(out).not.toContain(CLAUDE_ARTIFACT_PLACEHOLDER);
  });

  it('给了对话 URL 就带上回看链接,没给就不带', () => {
    expect(replaceArtifactPlaceholders(PH, 'https://claude.ai/chat/abc'))
      .toContain('> [在 Claude 中查看原图](https://claude.ai/chat/abc)');
    expect(replaceArtifactPlaceholders(PH)).not.toContain('在 Claude 中查看原图');
  });

  it('⭐ 相邻多个占位符不产出重复 callout(用户不该看到两遍同样的提示)', () => {
    const out = replaceArtifactPlaceholders(`${PH}\n${PH}\n${PH}`);
    // 不用 `?? []` 兜底:match 返 null 时 `?? []` 会让「一个 callout 都没有」
    // 也算通过(长度 0 ≠ 1 才红,但 null 的成因被掩盖)。这里显式断言拿到数组。
    const callouts = out.match(/📥 此处图片请点击/g);
    expect(callouts).not.toBeNull();
    expect(callouts).toHaveLength(1);
  });

  it('正文里的普通文字原样保留', () => {
    const out = replaceArtifactPlaceholders(`回答开头\n\n${PH}\n\n回答结尾`);
    expect(out.startsWith('回答开头')).toBe(true);
    expect(out.endsWith('回答结尾')).toBe(true);
  });
});

describe('extractArtifactSourceFromPayload / collectArtifactSources', () => {
  const code = 'function render() { return 1; }' + ' '.repeat(30);

  it('从 { url, body } 形态的 hook 载荷里取源码', () => {
    expect(extractArtifactSourceFromPayload({ url: 'https://x/y', body: { source: code } })).toBe(code);
  });

  it('从 MCP resources/read 形态 { contents: [{ text }] } 取源码', () => {
    expect(extractArtifactSourceFromPayload({ contents: [{ uri: 'u', text: code }] })).toBe(code);
  });

  it('多个候选时取最长的那份', () => {
    const longer = code + 'x'.repeat(50);
    expect(extractArtifactSourceFromPayload({ a: { code }, b: { code: longer } })).toBe(longer);
  });

  it('已知噪音 method 直接返 null(不把握手消息当源码)', () => {
    expect(extractArtifactSourceFromPayload({ method: 'ui/notifications/initialized', params: { code } })).toBeNull();
    expect(extractArtifactSourceFromPayload({ method: 'ui/notifications/sandbox-proxy-ready', params: { code } })).toBeNull();
  });

  it('太短的串(<40)不当源码;null 载荷返 null', () => {
    expect(extractArtifactSourceFromPayload({ source: 'short' })).toBeNull();
    expect(extractArtifactSourceFromPayload(null)).toBeNull();
  });

  it('collectArtifactSources 返回**最新在前**且去重', () => {
    const a = code + 'AAA';
    const b = code + 'BBB';
    const sources = collectArtifactSources([
      { data: { source: a } }, { data: { source: b } }, { data: { source: b } },
    ] as Parameters<typeof collectArtifactSources>[0]);
    expect(sources).toEqual([b, a]);
  });
});

describe('URL 判定', () => {
  it('isClaudeConversationPage 只认 claude.ai/chat/{id}', () => {
    expect(isClaudeConversationPage('https://claude.ai/chat/0191aaaa-bbbb-cccc')).toBe(true);
    expect(isClaudeConversationPage('https://claude.ai/new')).toBe(false);
    expect(isClaudeConversationPage('https://evil.com/claude.ai/chat/abc')).toBe(false);
    expect(isClaudeConversationPage('')).toBe(false);
  });

  it('extractConversationId 从对话 URL 取 id,非对话页返 null', () => {
    // 必须是 36 字符 UUID —— 短 id 不认(防把 /chat/new 这类路径当对话)
    const uuid = '0191aaaa-bbbb-cccc-dddd-eeeeffff0000';
    expect(uuid).toHaveLength(36);
    expect(extractConversationId(`https://claude.ai/chat/${uuid}`)).toBe(uuid);
    expect(extractConversationId('https://claude.ai/chat/abc-123')).toBeNull();
    expect(extractConversationId('https://claude.ai/new')).toBeNull();
  });
});
