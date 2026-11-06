/**
 * expandLinkedAnswers —— 题目页提取结果 + 逐题抓解答页 → result.content 换占位行、result.linkedAnswers
 *
 * 每题一行日志(成败、几种解法、耗时),最后一行汇总;某题失败不影响其他题,
 * 失败原因随 linkedAnswers 进笔记(折叠块里写明),不静默留空。
 */

import type { WebContents } from 'electron';
import type { LinkedAnswer } from '@shared/types/linked-answers';
import type { FullPageResult } from '../types';
import type { LinkedAnswerRule } from './rules';
import { markLinkedItems, splitAnswerSections } from './markdown';
import { generateMediaWikiFetchScript, type FetchedPage } from './fetch-script';

/** 两次请求之间的间隔:25 题一卷,别一口气打满对方站点 */
const GAP_MS = 400;
/** 单页上限(executeJavaScript 本身不能取消,超时只是不再等它) */
const PAGE_TIMEOUT_MS = 20_000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function fetchPage(guest: WebContents, rule: LinkedAnswerRule, pageTitle: string): Promise<FetchedPage> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([
      guest.executeJavaScript(generateMediaWikiFetchScript(rule, pageTitle)) as Promise<unknown>,
      new Promise<null>((r) => { timer = setTimeout(() => r(null), PAGE_TIMEOUT_MS); }),
    ]);
    if (raw === null) return { ok: false, why: `超过 ${PAGE_TIMEOUT_MS / 1000} 秒没返回` };
    return JSON.parse(String(raw)) as FetchedPage;
  } catch (err) {
    return { ok: false, why: (err as Error).message || String(err) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function expandLinkedAnswers(
  guest: WebContents,
  result: FullPageResult,
  rule: LinkedAnswerRule,
): Promise<FullPageResult> {
  const { markdown, items } = markLinkedItems(result.content || '', rule, result.url);
  if (items.length === 0) {
    console.warn(`[linked-answers] ${rule.id}: 这页没找到解答链接 —— 笔记里只有题目`);
    return { ...result, linkedAnswers: [] };
  }
  console.log(`[linked-answers] ${rule.id}: ${items.length} 题,开始逐题抓解答`);

  const answers: LinkedAnswer[] = [];
  const imageSizes: Record<string, [number, number]> = { ...(result.imageSizes ?? {}) };
  const startAll = Date.now();
  for (const item of items) {
    if (guest.isDestroyed()) {
      answers.push({ ...item, ok: false, why: '网页已关闭,没抓', sections: [] });
      continue;
    }
    if (answers.length > 0) await sleep(GAP_MS);
    const t0 = Date.now();
    const page = await fetchPage(guest, rule, item.pageTitle);
    const base = { index: item.index, itemHeading: item.itemHeading, label: item.label, sourceUrl: item.sourceUrl };
    if (!page.ok) {
      console.warn(`[linked-answers] ${item.itemHeading} ✗ ${page.why} (${item.pageTitle})`);
      answers.push({ ...base, ok: false, why: page.why ?? '未知原因', sections: [] });
      continue;
    }
    const sections = splitAnswerSections(page.markdown ?? '', rule);
    Object.assign(imageSizes, page.imageSizes ?? {});
    const nText = sections.filter((s) => s.kind === 'text').length;
    const nLinks = sections.length - nText;
    if (nText === 0) {
      // 页抓到了但没有一节文字解法 —— 当失败报,别做成一个空折叠块
      const why = `解答页里没找到文字解法(${nLinks} 个视频)`;
      console.warn(`[linked-answers] ${item.itemHeading} ✗ ${why} (${page.title})`);
      answers.push({ ...base, ok: false, why, sections });
      continue;
    }
    console.log(`[linked-answers] ${item.itemHeading} ✓ ${nText} 种解法 · ${nLinks} 个视频 (${page.title}, ${Date.now() - t0}ms)`);
    answers.push({ ...base, ok: true, sections });
  }

  const okCount = answers.filter((a) => a.ok).length;
  const failed = answers.filter((a) => !a.ok).map((a) => a.itemHeading);
  console.log(
    `[linked-answers] 完成:${okCount}/${answers.length} 题抓到解答,用时 ${Math.round((Date.now() - startAll) / 1000)}s` +
      (failed.length ? `;失败:${failed.join('、')}` : ''),
  );
  return { ...result, content: markdown, linkedAnswers: answers, imageSizes };
}
