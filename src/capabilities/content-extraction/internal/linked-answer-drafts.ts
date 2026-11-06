/**
 * linked-answer-drafts —「提取题目 + 解答」的正文组装:按占位行把题目页切段,在原位置插入折叠块
 *
 * 形状(默认全折叠,做题时看不到答案):
 *   ▸ 💡 Solution(8 种解法 · 9 个视频)
 *       ▸ Solution 1          ← 每种解法一个折叠块
 *       ▸ Solution 2 …
 *       ▸ 🎬 视频解答(9)     ← 只留链接
 *       🔗 原文
 *   ▸ ⚠️ Solution 没抓到:<原因>   ← 失败写在标题行,折着也看得见
 *
 * 折叠块 = toggleList(attrs.open=false,第一个子块是标题行,对齐 wrap-ai-turns 先例)。
 * 每段 markdown 各自走一次 toAtoms(每次 tmpId 都从 tmp-0 起),所以这里统一重新编号,
 * 并把每段的顶层块挂到所在折叠块下(parentTmpId)。
 */

import type { PmAtomDraft, AtomFrom } from '@semantic/types';
import { parseLinkedAnswerMarker, type LinkedAnswer } from '@shared/types/linked-answers';

export interface LinkedAnswerDeps {
  /** 一段 markdown → drafts(生产 = 规整 + 图片本地化 + content-ingest.markdownToAtoms) */
  toAtoms(markdown: string): Promise<PmAtomDraft[]>;
  allocTmpId(): string;
  from: AtomFrom;
}

/** 把一段 drafts 重新编号后追加到 out;顶层块挂到 parent 下(parent 缺省 = 顶层) */
function appendRenumbered(out: PmAtomDraft[], drafts: PmAtomDraft[], parent: string | undefined, deps: LinkedAnswerDeps): void {
  const map = new Map<string, string>();
  for (const d of drafts) map.set(d.tmpId, deps.allocTmpId());
  for (const d of drafts) {
    const next: PmAtomDraft = { ...d, tmpId: map.get(d.tmpId)! };
    const p = d.parentTmpId !== undefined ? map.get(d.parentTmpId) : parent;
    if (p !== undefined) next.parentTmpId = p;
    else delete next.parentTmpId;
    out.push(next);
  }
}

function paragraph(text: string, parent: string | undefined, deps: LinkedAnswerDeps): PmAtomDraft {
  const d: PmAtomDraft = {
    tmpId: deps.allocTmpId(),
    payload: { domain: 'pm', payload: { type: 'paragraph', attrs: {}, content: [{ type: 'text', text }] } },
    from: deps.from,
  };
  if (parent !== undefined) d.parentTmpId = parent;
  return d;
}

/** 折叠块外壳(content=[],子块靠 parentTmpId 挂)+ 标题行 */
function toggle(label: string, parent: string | undefined, out: PmAtomDraft[], deps: LinkedAnswerDeps): string {
  const id = deps.allocTmpId();
  const d: PmAtomDraft = {
    tmpId: id,
    payload: { domain: 'pm', payload: { type: 'toggleList', attrs: { open: false }, content: [] } },
    from: deps.from,
  };
  if (parent !== undefined) d.parentTmpId = parent;
  out.push(d, paragraph(label, id, deps));
  return id;
}

async function appendMarkdown(out: PmAtomDraft[], markdown: string, parent: string | undefined, deps: LinkedAnswerDeps): Promise<void> {
  if (!markdown.trim()) return;
  appendRenumbered(out, await deps.toAtoms(markdown), parent, deps);
}

async function appendAnswer(out: PmAtomDraft[], a: LinkedAnswer, deps: LinkedAnswerDeps): Promise<void> {
  const texts = a.sections.filter((s) => s.kind === 'text');
  const videos = a.sections.filter((s) => s.kind === 'links');
  const label = a.ok
    ? `💡 ${a.label}(${texts.length} 种解法${videos.length ? ` · ${videos.length} 个视频` : ''})`
    : `⚠️ ${a.label} 没抓到:${a.why ?? '未知原因'}`;
  const outer = toggle(label, undefined, out, deps);
  for (const s of texts) {
    const inner = toggle(s.heading, outer, out, deps);
    await appendMarkdown(out, s.markdown, inner, deps);
  }
  if (videos.length > 0) {
    const inner = toggle(`🎬 视频解答(${videos.length})`, outer, out, deps);
    const list = videos.flatMap((v) => v.links.map((u) => `- [${v.heading.replace(/[[\]]/g, '')}](${u})`));
    await appendMarkdown(out, list.join('\n'), inner, deps);
  }
  await appendMarkdown(out, `🔗 [原文](${a.sourceUrl})`, outer, deps);
}

/**
 * 题目页 markdown(含占位行)+ 解答 → 正文 drafts。
 * 占位行找不到对应解答(不该发生)→ 记错误并在原位置放一行提示,不静默吞掉那题。
 */
export async function buildBodyWithAnswers(
  markdown: string,
  answers: LinkedAnswer[],
  deps: LinkedAnswerDeps,
): Promise<PmAtomDraft[]> {
  const out: PmAtomDraft[] = [];
  const byIndex = new Map(answers.map((a) => [a.index, a]));
  let chunk: string[] = [];
  for (const line of markdown.split('\n')) {
    const idx = parseLinkedAnswerMarker(line);
    if (idx === null) {
      chunk.push(line);
      continue;
    }
    await appendMarkdown(out, chunk.join('\n'), undefined, deps);
    chunk = [];
    const a = byIndex.get(idx);
    if (a) {
      await appendAnswer(out, a, deps);
    } else {
      console.error(`[content-extraction] 占位行 ${idx} 没有对应的解答数据`);
      out.push(paragraph('⚠️ 这里本该有解答,但数据缺失(看日志 [linked-answers])', undefined, deps));
    }
  }
  await appendMarkdown(out, chunk.join('\n'), undefined, deps);
  return out;
}

/** 笔记开头的汇总提示:全部抓到返回 null */
export function answersSummaryNotice(answers: LinkedAnswer[]): string | null {
  if (answers.length === 0) return '⚠️ 这页没找到解答链接,笔记里只有题目。';
  const failed = answers.filter((a) => !a.ok);
  if (failed.length === 0) return null;
  return `⚠️ 解答:${answers.length - failed.length}/${answers.length} 题抓到;没抓到:${failed.map((a) => a.itemHeading).join('、')}(原因写在各题的折叠块上)`;
}
