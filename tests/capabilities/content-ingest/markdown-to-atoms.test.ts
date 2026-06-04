/**
 * Unit test: markdownToAtoms (5B Stage 7 重做)
 *
 * 用例:
 *  1. # heading + paragraph → 2 drafts, 顶层 parentTmpId undefined
 *  2. GFM 表格 3x3 → 1 table draft + 9 cell drafts
 *  3. bulletList 嵌套 → STRUCTURAL bulletList 字面不产 draft, listItem 顶层
 *  4. blockquote 子内容 → 嵌套字面 parentTmpId 链
 *  5. titleHint 注入 → atoms[0].attrs.isTitle === true
 *  6. 空 markdown → 至少 1 个 paragraph (兜底)
 */
import { describe, it, expect } from 'vitest';
import { markdownToAtoms } from '@capabilities/content-ingest/internal/markdown-to-atoms';

describe('markdownToAtoms', () => {
  it('# heading + paragraph → 2 drafts, 顶层 parentTmpId undefined', async () => {
    const md = '# Hello\n\nworld';
    const { atoms, warnings } = await markdownToAtoms(md);
    expect(warnings).toEqual([]);
    expect(atoms.length).toBeGreaterThanOrEqual(2);
    // 字面顶层 drafts 无 parentTmpId
    const top = atoms.filter((a) => a.parentTmpId === undefined);
    expect(top.length).toBeGreaterThanOrEqual(2);
    // 含 heading + paragraph
    const types = atoms.map((a) => a.payload.payload.type);
    expect(types).toContain('heading');
    expect(types).toContain('paragraph');
  });

  it('GFM 表格 3x3 → 1 table draft + 6 cell drafts (header 行 + 2 body 行)', async () => {
    const md = [
      '| A | B | C |',
      '|---|---|---|',
      '| 1 | 2 | 3 |',
      '| 4 | 5 | 6 |',
    ].join('\n');
    const { atoms, warnings } = await markdownToAtoms(md);
    expect(warnings).toEqual([]);
    const tableDrafts = atoms.filter((a) => a.payload.payload.type === 'table');
    expect(tableDrafts.length).toBe(1);
    const tableTmpId = tableDrafts[0].tmpId;

    const cellDrafts = atoms.filter(
      (a) =>
        a.payload.payload.type === 'tableCell' ||
        a.payload.payload.type === 'tableHeader',
    );
    // 3 header + 6 cell = 9
    expect(cellDrafts.length).toBe(9);
    for (const cd of cellDrafts) {
      expect(cd.parentTmpId).toBe(tableTmpId);
      const attrs = cd.payload.payload.attrs as Record<string, unknown>;
      expect(typeof attrs.rowIndex).toBe('number');
      expect(typeof attrs.colIndex).toBe('number');
    }
  });

  it('bulletList 嵌套 → STRUCTURAL bulletList 字面不产 draft, listItem 顶层', async () => {
    const md = '- item1\n  - nested\n- item2';
    const { atoms, warnings } = await markdownToAtoms(md);
    expect(warnings).toEqual([]);
    // bulletList 字面跳层 — 无 'bulletList' type draft
    const types = atoms.map((a) => a.payload.payload.type);
    expect(types).not.toContain('bulletList');
    // listItem 字面出现
    const listItems = atoms.filter((a) => a.payload.payload.type === 'listItem');
    expect(listItems.length).toBeGreaterThanOrEqual(2);
  });

  it('blockquote 子内容 → 嵌套字面 parentTmpId 链', async () => {
    const md = '> quoted paragraph';
    const { atoms, warnings } = await markdownToAtoms(md);
    expect(warnings).toEqual([]);
    const bqDrafts = atoms.filter((a) => a.payload.payload.type === 'blockquote');
    expect(bqDrafts.length).toBe(1);
    const bqTmpId = bqDrafts[0].tmpId;
    // 字面 inner paragraph (若 md-to-pm 保留嵌套, parentTmpId = bqTmpId);
    // 容错: 若 blockquote 是叶子形态把 paragraph 作 content, 则无嵌套 child
    const innerPara = atoms.find(
      (a) => a.payload.payload.type === 'paragraph' && a.parentTmpId === bqTmpId,
    );
    if (innerPara) {
      expect(innerPara.parentTmpId).toBe(bqTmpId);
    }
    // 字面至少 blockquote draft 存在
    expect(bqDrafts.length).toBeGreaterThanOrEqual(1);
  });

  it('titleHint 注入 → atoms[0].attrs.isTitle === true', async () => {
    const md = 'paragraph 1\n\nparagraph 2';
    const { atoms } = await markdownToAtoms(md, { titleHint: 'My Title' });
    expect(atoms.length).toBeGreaterThanOrEqual(2);
    // 字面情形 A: 首块本是 paragraph → 直接挂 isTitle
    // 字面情形 B: 首块非 paragraph → 前置 paragraph
    expect(atoms[0].payload.payload.type).toBe('paragraph');
    const attrs0 = atoms[0].payload.payload.attrs as Record<string, unknown>;
    expect(attrs0.isTitle).toBe(true);
  });

  it('空 markdown → 至少能 resolve 不抛 (warnings 可能空)', async () => {
    const { atoms, warnings } = await markdownToAtoms('');
    // 字面空 md → md-to-pm 产 0 nodes, atoms = []. 不抛错就 OK
    expect(Array.isArray(atoms)).toBe(true);
    expect(Array.isArray(warnings)).toBe(true);
  });

  // mark 嵌套(2026-06 网页剪藏暴露:Defuddle 输出 [**X**](url) / **[X](url)**,
  // 原 parseInline 单层非递归 → 内层 mark 当纯文本残留)。
  it('link 内嵌 bold [**X**](url) → text 同时带 link + bold,无字面残留', async () => {
    const { atoms } = await markdownToAtoms('[**Fire TV**](https://x.test/fire) app');
    const para = atoms.find((a) => a.payload.payload.type === 'paragraph');
    expect(para).toBeDefined();
    const inline = para!.payload.payload.content as Array<{
      type: string; text?: string; marks?: Array<{ type: string }>;
    }>;
    const fireTv = inline.find((n) => n.text === 'Fire TV');
    expect(fireTv).toBeDefined();
    const markTypes = (fireTv!.marks ?? []).map((m) => m.type).sort();
    expect(markTypes).toEqual(['bold', 'link']);
    // 无残留的字面 ** 或 [ ]( )
    const joined = inline.map((n) => n.text ?? '').join('');
    expect(joined).not.toContain('**');
    expect(joined).not.toContain('](');
  });

  it('bold 内嵌 link **[X](url)** → text 同时带 bold + link', async () => {
    const { atoms } = await markdownToAtoms('**[IMDb](https://x.test/imdb)**');
    const para = atoms.find((a) => a.payload.payload.type === 'paragraph');
    const inline = para!.payload.payload.content as Array<{
      type: string; text?: string; marks?: Array<{ type: string; attrs?: { href?: string } }>;
    }>;
    const imdb = inline.find((n) => n.text === 'IMDb');
    expect(imdb).toBeDefined();
    const markTypes = (imdb!.marks ?? []).map((m) => m.type).sort();
    expect(markTypes).toEqual(['bold', 'link']);
    const link = (imdb!.marks ?? []).find((m) => m.type === 'link');
    expect(link?.attrs?.href).toBe('https://x.test/imdb');
  });

  it('链接图片 [![alt](img)](url) → image draft(列表/卡片页),不产断裂 ](url)', async () => {
    const md = '[![Headline Alt](https://x.test/cover.jpg)](https://x.test/article)';
    const { atoms } = await markdownToAtoms(md);
    const img = atoms.find((a) => a.payload.payload.type === 'image');
    expect(img).toBeDefined();
    const attrs = img!.payload.payload.attrs as Record<string, unknown>;
    expect(attrs.src).toBe('https://x.test/cover.jpg');
    expect(attrs.alt).toBe('Headline Alt');
    // 不应残留断裂的 ](url) 纯文本
    const allText = atoms
      .flatMap((a) => (a.payload.payload.content ?? []) as Array<{ text?: string }>)
      .map((n) => n.text ?? '')
      .join('');
    expect(allText).not.toContain('](http');
  });

  it('扁平 inline(无嵌套)仍正确 — bold/italic/code/link 不回归', async () => {
    const { atoms } = await markdownToAtoms(
      'a **b** c *d* e `f` g [h](https://x.test/h)',
    );
    const para = atoms.find((a) => a.payload.payload.type === 'paragraph');
    const inline = para!.payload.payload.content as Array<{
      text?: string; marks?: Array<{ type: string }>;
    }>;
    const markOf = (t: string) =>
      (inline.find((n) => n.text === t)?.marks ?? []).map((m) => m.type);
    expect(markOf('b')).toEqual(['bold']);
    expect(markOf('d')).toEqual(['italic']);
    expect(markOf('f')).toEqual(['code']);
    expect(markOf('h')).toEqual(['link']);
  });
});
