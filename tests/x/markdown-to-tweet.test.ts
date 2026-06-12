/**
 * markdown → X 推文纯文本 降级 单元测试(X 集成 阶段 2,写方向)
 *
 * 守的约束(总指挥拍板「去标记符保文字」):
 *   - 强调标记(粗斜/删除线/行内代码)去掉,文字保留
 *   - 链接保 URL(label != url 时 `label (url)`,否则仅 url)
 *   - 标题去 #、引用去 >、无序列表转 •、有序列表保序号、水平线删
 *   - 代码围栏去 ```,代码原文保留
 *   - 超长 fail-loud 校验(checkTweetLength,不截断)
 */

import { describe, it, expect } from 'vitest';
import {
  markdownToTweetText,
  checkTweetLength,
  TWEET_CHAR_LIMIT,
} from '@shared/x/markdown-to-tweet';

describe('markdownToTweetText — 强调标记去除', () => {
  it('粗体 **x** → x', () => {
    expect(markdownToTweetText('这是 **重点** 内容')).toBe('这是 重点 内容');
  });
  it('斜体 *x* / _x_ → x', () => {
    expect(markdownToTweetText('a *b* c')).toBe('a b c');
    expect(markdownToTweetText('a _b_ c')).toBe('a b c');
  });
  it('粗体内含斜体不串味', () => {
    expect(markdownToTweetText('**加粗**普通')).toBe('加粗普通');
  });
  it('删除线 ~~x~~ → x', () => {
    expect(markdownToTweetText('~~删掉~~保留')).toBe('删掉保留');
  });
  it('行内代码 `x` → x', () => {
    expect(markdownToTweetText('用 `npm run` 跑')).toBe('用 npm run 跑');
  });
  it('snake_case 中的下划线不被当斜体吃掉', () => {
    expect(markdownToTweetText('foo_bar_baz')).toBe('foo_bar_baz');
  });
});

describe('markdownToTweetText — 链接 / 图片', () => {
  it('[label](url) → label (url)', () => {
    expect(markdownToTweetText('see [docs](https://x.com/docs)')).toBe(
      'see docs (https://x.com/docs)',
    );
  });
  it('label 与 url 相同 → 仅 url', () => {
    expect(
      markdownToTweetText('[https://x.com](https://x.com)'),
    ).toBe('https://x.com');
  });
  it('空 label → 仅 url', () => {
    expect(markdownToTweetText('[](https://x.com)')).toBe('https://x.com');
  });
  it('http(s) 图片 ![alt](url) → url（外链图无法当附件，保留 URL）', () => {
    expect(markdownToTweetText('![cat](https://x.com/cat.png)')).toBe(
      'https://x.com/cat.png',
    );
  });
});

describe('markdownToTweetText — media:// 图片删除（阶段 2.5-b：图走附件，正文不留 URL）', () => {
  it('整行 media:// 图片 → 删（不留任何 URL 文本）', () => {
    expect(
      markdownToTweetText('![](media://images/img-abc123.jpeg)'),
    ).toBe('');
  });
  it('带 alt 的 media:// 图片整行 → 删', () => {
    expect(
      markdownToTweetText('![截图](media://images/x.png)'),
    ).toBe('');
  });
  it('文字 + 多张 media:// 图：只留文字，图全删（复现并锁死你报的 bug）', () => {
    const md = [
      '自己开发的app，做发图测试',
      '![](media://images/img-da448ea7ceb36355.jpeg)',
      '![](media://images/img-28e6998e60b21580.jpeg)',
      '![](media://images/img-8794724a830ff6ce.png)',
    ].join('\n');
    expect(markdownToTweetText(md)).toBe('自己开发的app，做发图测试');
  });
  it('行内混排 media:// 图 → 删图保文字', () => {
    expect(
      markdownToTweetText('看这张 ![](media://a.png) 不错'),
    ).toBe('看这张  不错');
  });
  it('media:// 图删除后不残留空行（与空行折叠协同）', () => {
    const md = '第一段\n![](media://a.png)\n第二段';
    expect(markdownToTweetText(md)).toBe('第一段\n第二段');
  });
});

describe('markdownToTweetText — 块级结构', () => {
  it('标题去 #', () => {
    expect(markdownToTweetText('# 大标题')).toBe('大标题');
    expect(markdownToTweetText('### 小标题')).toBe('小标题');
  });
  it('引用去 >', () => {
    expect(markdownToTweetText('> 引用一句')).toBe('引用一句');
  });
  it('无序列表 → •', () => {
    expect(markdownToTweetText('- 项目一\n- 项目二')).toBe('• 项目一\n• 项目二');
    expect(markdownToTweetText('* a\n+ b')).toBe('• a\n• b');
  });
  it('有序列表保留序号', () => {
    expect(markdownToTweetText('1. 第一\n2. 第二')).toBe('1. 第一\n2. 第二');
  });
  it('水平线删除(空行折叠为单换行)', () => {
    // 总指挥:多 block 发 X 行行相连不留空行 → 连续空行折叠成单换行
    expect(markdownToTweetText('上\n\n---\n\n下')).toBe('上\n下');
  });
  it('代码围栏去 ``` 保留代码', () => {
    expect(markdownToTweetText('```js\nconst a = 1;\n```')).toBe('const a = 1;');
  });
});

describe('markdownToTweetText — 收尾', () => {
  it('折叠所有连续空行为单换行并 trim(行行相连)', () => {
    // 总指挥拍板:多 block 发到 X 紧凑相连,block 间段落空行压成单换行
    expect(markdownToTweetText('\n\na\n\n\n\nb\n\n')).toBe('a\nb');
  });
  it('空输入 → 空串', () => {
    expect(markdownToTweetText('')).toBe('');
  });
});

describe('checkTweetLength — 超长校验(不截断)', () => {
  it('短文本 not overLimit', () => {
    const r = checkTweetLength('hello');
    expect(r.length).toBe(5);
    expect(r.overLimit).toBe(false);
    expect(r.limit).toBe(TWEET_CHAR_LIMIT);
  });
  it('正好 280 not overLimit,281 overLimit', () => {
    expect(checkTweetLength('a'.repeat(280)).overLimit).toBe(false);
    expect(checkTweetLength('a'.repeat(281)).overLimit).toBe(true);
  });
  it('emoji 按码点计数(不被算成 2)', () => {
    expect(checkTweetLength('😀😀😀').length).toBe(3);
  });
});
