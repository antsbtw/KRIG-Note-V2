/**
 * ⭐⭐ **⑤ 草稿点评** —— 用户 2026-09-26:
 *
 * > 「用户确定并发送，数据记录并进入学习环节」
 * > 「后期用户可以对已经发送的数据继续点评纠正，这样迭代工作。」
 *
 * ⚠️ 本文件钉的核心是**「回头还能不能改」** ——
 * 一旦把点评限制在 pending，「迭代」就变成了「一次性表态」，与用户要求相反。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf-8');
/** ⚠️ 行注释正则要躲开 `https://` 里的 `//` */
const strip = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const REPO = strip(read('src/platform/main/db/x-reply-draft-repo.ts'));
const HANDLERS = strip(read('src/platform/main/x/x-timeline-handlers.ts'));
const VIEW = read('src/views/x-workbench/XWorkbenchView.tsx');

describe('⭐⭐ 已处置的也要看得到（否则无从改起）', () => {
  it('⭐⭐ 回看查询不写死 pending', () => {
    const i = REPO.indexOf('export async function listDraftsForReview');
    expect(i, '找不到回看查询').toBeGreaterThan(0);
    const body = REPO.slice(i, REPO.indexOf('export async function listPendingDrafts'));
    expect(body.length, 'slice 空转').toBeGreaterThan(200);
    expect(
      /status = 'pending'/.test(body),
      '回看查询写死了 pending —— 已发送的看不到，「回头改点评」无从下手',
    ).toBe(false);
  });

  it('⭐⭐ 语境快照要一起取回（没有它点评是不公平的）', () => {
    /**
     * ⚠️ 人只凭正文判断，与模型当时的处境不同 ——
     * 模型可能根本没看到 bio 和上文。
     */
    const i = REPO.indexOf('export async function listDraftsForReview');
    const body = REPO.slice(i, REPO.indexOf('export async function listPendingDrafts'));
    for (const f of ['context_snapshot', 'user_edit_diff', 'review_count']) {
      expect(body, `回看没取 ${f} —— 点评时看不到关键信息`).toContain(f);
    }
  });

  it('⚠️ ORDER BY 的字段必须在 SELECT 里（SurrealDB 3.x）', () => {
    /** ⚠️ 否则 parse error，而且错误常被 catch 吞掉 —— 本仓踩过 */
    const i = REPO.indexOf('export async function listDraftsForReview');
    const body = REPO.slice(i, REPO.indexOf('export async function listPendingDrafts'));
    const order = body.match(/ORDER BY (\w+)/)?.[1];
    expect(order, '找不到 ORDER BY').toBeTruthy();
    const sel = body.slice(body.indexOf('SELECT'), body.indexOf('FROM'));
    expect(sel, `ORDER BY ${order} 但 SELECT 里没有它 —— parse error`).toContain(String(order));
  });
});

describe('⭐⭐ 补点评不许顺手改状态', () => {
  it('⭐⭐ X_REVIEW_DRAFT 不传 status', () => {
    /**
     * ⚠️ 这是「回头补一句评价」，不该把已发送的改成别的状态。
     */
    const i = HANDLERS.indexOf('X_REVIEW_DRAFT, async');
    expect(i, '找不到补点评 handler').toBeGreaterThan(0);
    const body = HANDLERS.slice(i, i + 900);
    expect(body.length, 'slice 空转').toBeGreaterThan(100);
    expect(body, '没调 reviewReplyDraft').toMatch(/reviewReplyDraft\(/);
    expect(
      /status:/.test(body),
      '补点评顺手改了状态 —— 已发送的会被改掉',
    ).toBe(false);
  });

  it('⭐ 一行都没更新要报失败（别让人以为记上了）', () => {
    const i = HANDLERS.indexOf('X_REVIEW_DRAFT, async');
    const body = HANDLERS.slice(i, i + 900);
    expect(body, '没判 updated === 0 —— 记不上也报成功')
      .toMatch(/updated === 0/);
  });
});

describe('⭐ 面板：点评长在人已经在看的地方', () => {
  it('⭐⭐ 有这个页，且 id 与标签都钉住', () => {
    /** ⚠️ 只钉一样的话，改了另一样就点不到了（本仓踩过） */
    expect(VIEW, "PaneId 里没有 'review'").toMatch(/\| 'review'/);
    const i = VIEW.indexOf("id: 'review' as const");
    expect(i, '左栏没有这个入口 —— 页写了也点不到').toBeGreaterThan(0);
    expect(VIEW.slice(i, VIEW.indexOf('\n', i)), '入口没有标签文字').toMatch(/草稿点评/);
    expect(VIEW, '没有渲染分支').toMatch(/pane === 'review' \?/);
  });

  it('⭐⭐ 语境要显示出来，缺了也要明说', () => {
    const i = VIEW.indexOf("pane === 'review' ?");
    const blk = VIEW.slice(i, VIEW.indexOf("pane === 'facts' ?", i));
    expect(blk.length, 'slice 空转').toBeGreaterThan(300);
    expect(blk, '没显示作者简介').toMatch(/ctx\.bio/);
    expect(blk, '没显示上文').toMatch(/ctx\.parentText/);
    expect(
      blk,
      '拟稿时没语境却不说 —— 人会拿「模型本可看到」的标准去评判它',
    ).toMatch(/没有语境/);
  });

  it('⭐⭐ 「人改成什么」要显示 —— 那是最强学习信号', () => {
    const i = VIEW.indexOf("pane === 'review' ?");
    const blk = VIEW.slice(i, VIEW.indexOf("pane === 'facts' ?", i));
    expect(blk, 'diff 没显示出来').toMatch(/user_edit_diff/);
    expect(blk, '没区分「改过」与「原样通过」').toMatch(/原样通过/);
  });

  it('⚠️ 记完要回读，不是只弹一句「成功」', () => {
    const i = VIEW.indexOf('const submitNote');
    expect(i, '找不到提交点评').toBeGreaterThan(0);
    const body = VIEW.slice(i, VIEW.indexOf('const saveFacts'));
    expect(body.length, 'slice 空转').toBeGreaterThan(100);
    expect(body, '记完没回读 —— review_count 不会当场变，看不出到底记上没')
      .toMatch(/await loadDrafts\(\)/);
  });

  it('⚠️ 空列表要说清楚是「还没有」不是「坏了」', () => {
    const i = VIEW.indexOf('const loadDrafts');
    const body = VIEW.slice(i, VIEW.indexOf('const submitNote'));
    expect(body, '读取失败没提示').toMatch(/读取失败/);
    expect(body, '空列表没说清原因 —— 人会以为功能坏了').toMatch(/还没有落库的草稿/);
  });
});
