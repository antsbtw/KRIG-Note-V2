/**
 * content-extraction import-pipeline 的 markdown 规整 helper 单测:
 *  - dedupeConsecutiveLines:折叠控件双份去重(WSJ Quick Summary 实例)+ 不误删
 *  - isolateInlineImages:内联图拆独立行
 */

import { describe, it, expect } from 'vitest';
import {
  dedupeConsecutiveLines,
  isolateInlineImages,
} from '@capabilities/content-extraction/internal/import-pipeline';

describe('dedupeConsecutiveLines', () => {
  it('折叠控件:3 要点 + AI 脚注 + 重复首条 + View more → 去掉重复条与 View more', () => {
    const md = [
      '- President Trump told aides he would end the ceasefire if Tehran kills troops.',
      '- The U.S. and Iran engaged in intense fighting this week.',
      '- Trump rejected Iran’s latest proposal for a memorandum of understanding.',
      '',
      'This summary was generated with AI and reviewed by an editor.',
      '',
      '- President Trump told aides he would end the ceasefire if Tehran kills troops.',
      '\tView more',
    ].join('\n');
    const out = dedupeConsecutiveLines(md);
    // 重复的首条要点只剩 1 次
    expect(out.split('President Trump told aides').length - 1).toBe(1);
    // View more 残留行被去掉
    expect(/view more/i.test(out)).toBe(false);
    // 三条要点 + 脚注都还在
    expect(out).toContain('intense fighting');
    expect(out).toContain('memorandum of understanding');
    expect(out).toContain('generated with AI');
  });

  it('相邻完全相同的长段落 → 去后一份', () => {
    const md = 'Some long paragraph sentence here.\nSome long paragraph sentence here.';
    const out = dedupeConsecutiveLines(md);
    expect(out).toBe('Some long paragraph sentence here.');
  });

  it('不误删:正文里正常的两个不同要点保留', () => {
    const md = ['- Apple is a fruit', '- Banana is a fruit'].join('\n');
    expect(dedupeConsecutiveLines(md)).toBe(md);
  });

  it('不误删:短行 / 标签 / 分隔线不参与去重', () => {
    const md = ['USMC', 'USMC', '---', '---'].join('\n');
    // 短行(<12 且非列表项)不去重;--- 也不去(非列表、长度<12)
    expect(dedupeConsecutiveLines(md)).toBe(md);
  });

  it('列表项全局去重:即使中间隔了非列表行', () => {
    const md = ['- dup item text here', 'middle paragraph long enough', '- dup item text here'].join('\n');
    const out = dedupeConsecutiveLines(md);
    expect(out.split('dup item text here').length - 1).toBe(1);
    expect(out).toContain('middle paragraph');
  });
});

describe('isolateInlineImages', () => {
  it('行内图片(与文字同行)拆到独立行', () => {
    const md = '![](https://x.test/a.jpg) The Fire TV app library is filled with options.';
    const out = isolateInlineImages(md);
    const lines = out.split('\n').filter((l) => l.trim());
    // 图片独占一行
    expect(lines.some((l) => /^!\[\]\(https:\/\/x\.test\/a\.jpg\)$/.test(l.trim()))).toBe(true);
    // 文字另起
    expect(out).toContain('The Fire TV app library');
  });

  it('已独占一行的图片不动', () => {
    const md = '![alt](https://x.test/a.jpg)';
    expect(isolateInlineImages(md).trim()).toBe(md);
  });
});
