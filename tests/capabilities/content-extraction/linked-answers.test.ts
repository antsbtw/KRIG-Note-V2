/**
 * 「提取题目 + 解答」+ 公式图还原 —— 用 2026-11-05 存档的 AoPS 真实页面跑**真注入脚本**
 *
 * 钉住的坑:
 *  - Defuddle 先删 <33px 的小图再识别公式 → 行内公式图(14px 高)全丢,「at , traveling」
 *  - 提取不能改动用户正在看的网页(公式图要换回来)
 *  - 解答页:重复题干 / See Also 导航丢掉,视频节(含「只贴了链接」的节)只留链接
 *  - 折叠块组装:各段 tmpId 重新编号不撞号,子块都挂在已出现的父块下
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { describe, it, expect, vi } from 'vitest';

const ROOT = join(__dirname, '../../..');
vi.mock('@platform/main/content-extraction/defuddle-bundle', () => ({
  getDefuddleBundle: () => readFileSync(join(ROOT, 'node_modules/defuddle/dist/index.full.js'), 'utf8'),
}));

import { generateDefuddleScript } from '@platform/main/content-extraction/defuddle-script';
import { generateMediaWikiFetchScript } from '@platform/main/content-extraction/linked-answers/fetch-script';
import { markLinkedItems, splitAnswerSections } from '@platform/main/content-extraction/linked-answers/markdown';
import { LINKED_ANSWER_RULES, matchLinkedAnswerRule } from '@platform/main/content-extraction/linked-answers/rules';
import { buildBodyWithAnswers, answersSummaryNotice } from '@capabilities/content-extraction/internal/linked-answer-drafts';
import { applyImageSizes } from '@capabilities/content-extraction/internal/import-pipeline';
import { markdownToAtoms } from '@capabilities/content-ingest/internal/markdown-to-atoms';
import type { LinkedAnswer } from '@shared/types/linked-answers';
import type { PmAtomDraft } from '@semantic/types';

const FIX = join(ROOT, 'tests/fixtures/content-extraction');
const PAGE_URL = 'https://artofproblemsolving.com/wiki/index.php?title=2025_AMC_12A_Problems';
const rule = LINKED_ANSWER_RULES[0];

function guestDom(html: string): JSDOM {
  return new JSDOM(html, { url: PAGE_URL, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
}

function extractProblemsPage(): { markdown: string; dom: JSDOM; imageSizes: Record<string, [number, number]> } {
  const dom = guestDom(readFileSync(join(FIX, 'aops-problems-excerpt.html'), 'utf8'));
  const out = JSON.parse(dom.window.eval(generateDefuddleScript()) as string);
  expect(out.success).toBe(true);
  return { markdown: out.content as string, dom, imageSizes: out.imageSizes };
}

describe('公式图 → LaTeX(整页提取真脚本)', () => {
  it('行内公式、选项行、asy 图都留下来', () => {
    const { markdown } = extractProblemsPage();
    expect(markdown).toContain('on his bicycle at $1{:}30$, traveling due north at a steady $8$ miles per hour');
    expect(markdown).toContain('$\\textbf{(A) } 3{:}30 \\qquad\\textbf{(B) } 3{:}45');
    expect(markdown).not.toContain('at , traveling');
    // asy 图保留成图片,绘图源码不进笔记
    expect(markdown).toMatch(/!\[figure\]\(https:\/\/latex\.artofproblemsolving\.com\/[^)]+\.png\)/);
    expect(markdown).not.toContain('[asy]');
  });

  it('绘图带出网页上的显示尺寸(文件是 2 倍图),导入时写进 image 块', () => {
    const { imageSizes } = extractProblemsPage();
    const fig = 'https://latex.artofproblemsolving.com/3/3/9/3392e6bfecea1f87a1d14a4ee83d0d9d96bca345.png';
    expect(imageSizes[fig]).toEqual([285, 285]);

    const draft = (src: string, width: number | null = null): PmAtomDraft => ({
      tmpId: src, payload: { domain: 'pm', payload: { type: 'image', attrs: { src, alt: 'figure', width }, content: [] } },
    });
    const atoms = [draft('media://abc'), draft(fig), draft('media://resized', 120), draft('media://other')];
    applyImageSizes(atoms, imageSizes, new Map([['media://abc', fig], ['media://resized', fig]]));
    const attrs = atoms.map((a) => a.payload.payload.attrs as { width: number | null; height?: number });
    expect(attrs[0]).toMatchObject({ width: 285, height: 285 }); // 本地化后的地址按原地址查到
    expect(attrs[1]).toMatchObject({ width: 285 });                // 没本地化(下载失败)按原地址查
    expect(attrs[2].width).toBe(120);                              // 已有宽度不动
    expect(attrs[3].width).toBeNull();                             // 查不到不动
  });

  it('提取后网页里的公式图原样换回来', () => {
    const html = readFileSync(join(FIX, 'aops-problems-excerpt.html'), 'utf8');
    const before = new JSDOM(html).window.document.querySelectorAll('img.latex, img.latexcenter').length;
    const { dom } = extractProblemsPage();
    const doc = dom.window.document;
    expect(before).toBeGreaterThan(20);
    expect(doc.querySelectorAll('img.latex, img.latexcenter').length).toBe(before);
    expect(doc.querySelectorAll('[data-latex]').length).toBe(0);
    expect([...doc.querySelectorAll('img.latexcenter')].some((i) => i.getAttribute('alt') === 'figure')).toBe(false);
  });
});

describe('题目页:找每题的解答链接', () => {
  it('只在整卷题目页出现菜单项', () => {
    expect(matchLinkedAnswerRule(PAGE_URL)).toBe(rule);
    expect(matchLinkedAnswerRule(PAGE_URL + '/Problem_1')).toBeNull();
    expect(matchLinkedAnswerRule('https://artofproblemsolving.com/wiki/index.php?title=2025_AMC_12A')).toBeNull();
  });

  it('每题一条,链接行换成占位行,重定向的题取链接上的页面名', () => {
    const { markdown } = extractProblemsPage();
    const { markdown: marked, items } = markLinkedItems(markdown, rule, PAGE_URL);
    expect(items.map((i) => i.itemHeading)).toEqual(['Problem 1', 'Problem 2', 'Problem 3', 'Problem 4', 'Problem 5']);
    expect(items[0].pageTitle).toBe('2025_AMC_12A_Problems/Problem_1');
    expect(items[4].pageTitle).toBe('2025_AMC_10A_Problems/Problem_13');
    expect(items[4].sourceUrl).toBe('https://artofproblemsolving.com/wiki/index.php?title=2025_AMC_10A_Problems/Problem_13');
    expect(marked).not.toMatch(/^\[Solution\]/m);
    expect(marked.match(/^@@KRIG_LINKED_ANSWER_\d+@@$/gm)).toHaveLength(5);
  });
});

describe('解答页:网页内同源抓取(真脚本)+ 切节', () => {
  async function fetchWith(body: string): Promise<{ ok: boolean; why?: string; title?: string; markdown?: string }> {
    const dom = guestDom('<!doctype html><html><body><p>live page</p></body></html>');
    dom.window.fetch = (async () => ({ ok: true, status: 200, text: async () => body })) as unknown as typeof fetch;
    const out = JSON.parse((await dom.window.eval(generateMediaWikiFetchScript(rule, '2025_AMC_12A_Problems/Problem_1'))) as string);
    expect(dom.window.document.body.innerHTML).toBe('<p>live page</p>');
    return out;
  }

  it('8 种文字解法带公式;题干 / See Also 丢掉;视频和只贴链接的节只留链接', async () => {
    const html = readFileSync(join(FIX, 'aops-solution-problem1.parse.html'), 'utf8');
    const page = await fetchWith(JSON.stringify({ parse: { title: '2025 AMC 10A Problems/Problem 1', text: { '*': html } } }));
    expect(page.ok).toBe(true);
    // 这页没有 asy 绘图;公式图都已转成 LaTeX,不该留在尺寸表里
    expect((page as { imageSizes?: object }).imageSizes).toEqual({});
    const sections = splitAnswerSections(page.markdown!, rule);
    const texts = sections.filter((s) => s.kind === 'text');
    const links = sections.filter((s) => s.kind === 'links');
    expect(texts.map((s) => s.heading)).toEqual([
      'Solution 1', 'Solution 2', 'Solution 3', 'Solution 4', 'Solution 5', 'Solution 6',
      'Solution 7 (Calculus Overkill)', 'Solution 8 (Easy to understand, fast)',
    ]);
    expect(texts[0].markdown).toContain('$\\boxed{\\textbf{(E) } 4{:}30}$');
    expect(texts[3].markdown).toMatch(/\$\$\n2\{:\}30 \+ 2\{:\}00 = \\boxed/);
    expect(links).toHaveLength(10);
    expect(links.map((s) => s.heading)).toContain('Easy Solution');
    expect(links.every((s) => s.links.length > 0 && s.links.every((u) => /^https?:\/\//.test(u)))).toBe(true);
    expect(sections.some((s) => /^(Problem|See Also)$/i.test(s.heading))).toBe(false);
  });

  it('被人机验证拦下(返回 HTML)→ 失败并说明,不当成空解答', async () => {
    const page = await fetchWith('<!DOCTYPE html><html><head><title>Just a moment...</title>');
    expect(page.ok).toBe(false);
    expect(page.why).toContain('不是 JSON');
  });

  it('api 报错 → 失败带原因', async () => {
    const page = await fetchWith(JSON.stringify({ error: { code: 'missingtitle', info: "The page you specified doesn't exist." } }));
    expect(page.ok).toBe(false);
    expect(page.why).toContain('missingtitle');
  });
});

describe('折叠块组装', () => {
  const text = (d: PmAtomDraft): string =>
    ((d.payload.payload.content ?? []) as Array<{ text?: string }>).map((c) => c.text ?? '').join('');

  async function build(answers: LinkedAnswer[]): Promise<PmAtomDraft[]> {
    let n = 0;
    return buildBodyWithAnswers(
      '## Problem 1\n\nWhat is $1+1$?\n\n@@KRIG_LINKED_ANSWER_0@@\n\n## Problem 2\n\nNext.\n\n@@KRIG_LINKED_ANSWER_1@@\n',
      answers,
      { toAtoms: async (md) => (await markdownToAtoms(md)).atoms, allocTmpId: () => `tmp-${n++}`, from: { extractionType: 'web-clip', extractedAt: 0 } },
    );
  }

  const ok: LinkedAnswer = {
    index: 0, itemHeading: 'Problem 1', label: 'Solution', sourceUrl: 'https://x.test/p1', ok: true,
    sections: [
      { heading: 'Solution 1', kind: 'text', markdown: 'It is $2$.\n\n- a\n- b', links: [] },
      { heading: 'Solution 2', kind: 'text', markdown: 'Count.', links: [] },
      { heading: 'Video Solution', kind: 'links', markdown: '', links: ['https://youtu.be/abc'] },
    ],
  };
  const bad: LinkedAnswer = { index: 1, itemHeading: 'Problem 2', label: 'Solution', sourceUrl: 'https://x.test/p2', ok: false, why: 'HTTP 503', sections: [] };

  it('题目原位插入折叠块;默认折叠;tmpId 不撞号、父块都在前面', async () => {
    const atoms = await build([ok, bad]);
    const ids = atoms.map((a) => a.tmpId);
    expect(new Set(ids).size).toBe(ids.length);
    const seen = new Set<string>();
    for (const a of atoms) {
      if (a.parentTmpId !== undefined) expect(seen.has(a.parentTmpId)).toBe(true);
      seen.add(a.tmpId);
    }
    const toggles = atoms.filter((a) => a.payload.payload.type === 'toggleList');
    expect(toggles.every((t) => (t.payload.payload.attrs as { open: boolean }).open === false)).toBe(true);

    const top = atoms.filter((a) => a.parentTmpId === undefined);
    const topTypes = top.map((a) => a.payload.payload.type);
    // Problem 1 标题 / 题干 / 折叠块 / Problem 2 标题 / 题干 / 折叠块
    expect(topTypes).toEqual(['heading', 'paragraph', 'toggleList', 'heading', 'paragraph', 'toggleList']);

    const outer = top[2];
    const kids = atoms.filter((a) => a.parentTmpId === outer.tmpId);
    expect(text(kids[0])).toBe('💡 Solution(2 种解法 · 1 个视频)');
    expect(kids.slice(1, 4).map((k) => k.payload.payload.type)).toEqual(['toggleList', 'toggleList', 'toggleList']);
    const sol1 = atoms.filter((a) => a.parentTmpId === kids[1].tmpId);
    expect(text(sol1[0])).toBe('Solution 1');
    expect(sol1.length).toBeGreaterThan(2); // 标题行 + 正文 + 列表
    const video = atoms.filter((a) => a.parentTmpId === kids[3].tmpId);
    expect(text(video[0])).toBe('🎬 视频解答(1)');

    const failKids = atoms.filter((a) => a.parentTmpId === top[5].tmpId);
    expect(text(failKids[0])).toBe('⚠️ Solution 没抓到:HTTP 503');
  });

  it('汇总提示:全抓到不提示;有失败点名;整页没链接也说', () => {
    expect(answersSummaryNotice([ok])).toBeNull();
    expect(answersSummaryNotice([ok, bad])).toContain('1/2 题抓到;没抓到:Problem 2');
    expect(answersSummaryNotice([])).toContain('没找到解答链接');
  });
});
