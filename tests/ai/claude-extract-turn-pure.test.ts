/**
 * Claude 单条/整页提取的**纯函数**行为快照 —— `prepareSvgForDom` / `buildFullMarkdownFromExtracted`
 *
 * 同族文件说明见 `claude-conversation-query.test.ts`:为 Web 能力层重构钉安全网,只测行为。
 *
 * ⚠️ 为什么这里有一个 vi.mock:
 *   `claude-extract-turn.ts` 顶层 `import { mediaStore } from '../../media/media-store-impl'`,
 *   而 media-store-impl **在模块加载时**就调 `app.getPath('userData')` —— vitest 无 Electron
 *   app,整个模块加载即炸(与存量的 scenario-6/7/9/11 同一失败家族)。
 *   本文件测的两个函数**完全不碰 mediaStore**(它只被 async 的 downloadLocalResource 用),
 *   所以这里把该模块 mock 成 noop 只是为了让 import 链路能解析,不改变被测行为。
 *   ⭐ 铁律:不为测试改产品代码 —— 所以是 mock,不是给产品代码加懒加载。
 *   这条 Electron 耦合本身是重构时该处理的债,已在交付报告里单列。
 *
 * `prepareSvgForDom` 守的是**安全 + 可渲染**:
 *   Claude 页面的 SVG 带 onclick/onmouseover 等事件 attr,Note 端是 innerHTML 直渲染,
 *   事件 attr 必须被剥掉(防 XSS)。这条漏了不会报错,只会留一个可执行的洞。
 */
import { describe, it, expect, vi } from 'vitest';

// ⚠️ hoisted:必须在 import 被测模块之前生效
vi.mock('../../src/platform/main/media/media-store-impl', () => ({
  mediaStore: {
    putBase64: vi.fn(async () => { throw new Error('[test] mediaStore 不该被这两个纯函数调用'); }),
  },
}));

import {
  prepareSvgForDom,
  buildFullMarkdownFromExtracted,
  type ExtractedConversation,
} from '@platform/main/ai/extractors/claude-extract-turn';

describe('prepareSvgForDom —— ⭐ 事件 attr 必须被剥掉(Note 端 innerHTML 直渲染)', () => {
  it('onclick 被删,图形内容保留', () => {
    const out = prepareSvgForDom('<svg><rect onclick="alert(1)" width="10"/></svg>');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('alert(1)');
    expect(out).toContain('<rect');
  });

  it('多行 SVG 里逐行的事件 attr 也被剥(onmouseover / onload)', () => {
    const raw = [
      '<svg>',
      '  <rect onmouseover="steal()" width="10"/>',
      '  <circle onload="boom()" r="5"/>',
      '</svg>',
    ].join('\n');
    const out = prepareSvgForDom(raw);
    expect(out).not.toMatch(/ on\w+=/);
    expect(out).not.toContain('steal()');
    expect(out).not.toContain('boom()');
  });

  it('单引号写法的事件 attr 同样被剥', () => {
    const out = prepareSvgForDom("<svg><rect onclick='alert(1)' width='10'/></svg>");
    expect(out).not.toContain('onclick');
  });
});

describe('prepareSvgForDom —— 自包含化', () => {
  it('缺 xmlns 时补齐', () => {
    expect(prepareSvgForDom('<svg viewBox="0 0 1 1"></svg>'))
      .toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('已有 xmlns 时不重复添加', () => {
    const out = prepareSvgForDom('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(out.match(/xmlns=/g)).toHaveLength(1);
  });

  it('CSS 变量替换成具体色值(Note 里没有 Claude 的 :root 变量)', () => {
    const out = prepareSvgForDom('<svg><rect fill="var(--color-bg-primary)"/></svg>');
    expect(out).not.toContain('var(--color-bg-primary)');
    expect(out).toContain('rgb(43,43,40)');
  });

  it('同一个 CSS 变量出现多次时全部被替换(不是只换第一个)', () => {
    const out = prepareSvgForDom(
      '<svg><rect fill="var(--color-bg-primary)"/><circle fill="var(--color-bg-primary)"/></svg>',
    );
    expect(out).not.toContain('var(--color-bg-primary)');
    expect(out.match(/rgb\(43,43,40\)/g)).toHaveLength(2);
  });

  it('SVG 无自带 <style> 时注入样式表', () => {
    const out = prepareSvgForDom('<svg viewBox="0 0 1 1"><rect/></svg>');
    expect(out).toContain('<style>');
    expect(out).toContain('font-family');
  });

  it('SVG 已有 <style> 时不重复注入', () => {
    const out = prepareSvgForDom('<svg><style>.a{fill:red}</style><rect/></svg>');
    expect(out.match(/<style>/g)).toHaveLength(1);
    expect(out).toContain('.a{fill:red}');
  });
});

describe('buildFullMarkdownFromExtracted —— 整页拼接', () => {
  const conv = (over: Partial<ExtractedConversation> = {}): ExtractedConversation => ({
    title: '对话标题',
    model: 'Claude Opus',
    turns: [],
    ...over,
  });

  it('标题 / 模型 / 消息数进 header', () => {
    const md = buildFullMarkdownFromExtracted(conv({
      turns: [{ index: 0, userMessage: '问', markdown: '答', artifactCount: 0 }],
    }));
    expect(md.startsWith('# 对话标题\n\n> 模型: `Claude Opus`\n\n> 共 2 条消息')).toBe(true);
  });

  it('没有 model 时不产模型行,AI header 降级成 Claude', () => {
    const md = buildFullMarkdownFromExtracted({
      title: 'T', turns: [{ index: 0, userMessage: '问', markdown: '答', artifactCount: 0 }],
    });
    expect(md).not.toContain('> 模型:');
    expect(md).toContain('## 🤖 AI (Claude)');
  });

  it('⭐ 多轮按顺序拼接,每轮 用户/AI 配对不串台', () => {
    const md = buildFullMarkdownFromExtracted(conv({
      turns: [
        { index: 0, userMessage: '第一问', markdown: '第一答', artifactCount: 0 },
        { index: 1, userMessage: '第二问', markdown: '第二答', artifactCount: 0 },
      ],
    }));
    const order = ['第一问', '第一答', '第二问', '第二答']
      .map((s) => md.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('用户消息为空的轮次只出 AI 块(不产空的用户块)', () => {
    const md = buildFullMarkdownFromExtracted(conv({
      turns: [{ index: 0, userMessage: '   ', markdown: '只有回答', artifactCount: 0 }],
    }));
    expect(md).not.toContain('## 👤 用户');
    expect(md).toContain('## 🤖 AI (Claude Opus)\n\n只有回答');
  });

  it('轮次之间用 --- 分隔', () => {
    const md = buildFullMarkdownFromExtracted(conv({
      turns: [
        { index: 0, userMessage: 'a', markdown: 'A', artifactCount: 0 },
        { index: 1, userMessage: 'b', markdown: 'B', artifactCount: 0 },
      ],
    }));
    expect(md.match(/\n\n---\n\n/g)).toHaveLength(3); // 用户|AI|用户|AI 之间三处
  });

  it('零轮次时只有 header,不抛', () => {
    const md = buildFullMarkdownFromExtracted(conv({ turns: [] }));
    expect(md).toBe('# 对话标题\n\n> 模型: `Claude Opus`\n\n> 共 0 条消息\n\n');
  });

  it('⭐ 代码块不被吃掉:markdown 逐字进入产物(project-markdown-import-unify)', () => {
    const nested = '````markdown\n```ts\nconst a = 1;\n```\n````';
    const md = buildFullMarkdownFromExtracted(conv({
      turns: [{ index: 0, userMessage: '问', markdown: nested, artifactCount: 0 }],
    }));
    expect(md).toContain(nested);
  });
});
