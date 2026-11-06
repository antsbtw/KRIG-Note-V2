/**
 * linked-answers 的两个纯函数(无 IO,单测直接喂真实页面的提取结果):
 *  - markLinkedItems:题目页 markdown 里找「每题下的解答链接行」,换成占位行
 *  - splitAnswerSections:解答页 markdown 按 `##` 切节,丢重复题干 / 导航,视频节只留链接
 */

import { linkedAnswerMarker, type LinkedAnswerSection } from '@shared/types/linked-answers';
import type { LinkedAnswerRule } from './rules';

export interface LinkedItem {
  index: number;
  itemHeading: string;
  label: string;
  /** 解答页绝对网址 */
  sourceUrl: string;
  /** MediaWiki 页面名(api.php?page=) */
  pageTitle: string;
}

/** 独占一行的 markdown 链接 `[文字](href "可选title")` */
const LINK_LINE_RE = /^\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/;

export function markLinkedItems(
  markdown: string,
  rule: LinkedAnswerRule,
  pageUrl: string,
): { markdown: string; items: LinkedItem[] } {
  const lines = markdown.split('\n');
  const items: LinkedItem[] = [];
  let current: string | null = null; // 当前所在题目标题;已挂过链接后置 null(每题只取第一条)
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^##\s+(.+?)\s*$/);
    if (h) {
      current = rule.itemHeading.test(h[1]) ? h[1] : null;
      continue;
    }
    if (current === null) continue;
    const m = lines[i].trim().match(LINK_LINE_RE);
    if (!m || !rule.linkText.test(m[1].trim())) continue;
    let abs: URL;
    try {
      abs = new URL(m[2], pageUrl);
    } catch {
      continue;
    }
    const pageTitle = abs.searchParams.get('title');
    if (!pageTitle) continue;
    const index = items.length;
    items.push({ index, itemHeading: current, label: m[1].trim(), sourceUrl: abs.href, pageTitle });
    lines[i] = linkedAnswerMarker(index);
    current = null;
  }
  return { markdown: lines.join('\n'), items };
}

/** markdown 链接与裸网址 */
function collectLinks(body: string): string[] {
  const out: string[] = [];
  const re = /\]\((https?:\/\/[^)\s]+)|(?:^|\s)(https?:\/\/[^\s)\]]+)/g;
  for (const m of body.matchAll(re)) {
    const u = m[1] ?? m[2];
    if (u && !out.includes(u)) out.push(u);
  }
  return out;
}

/** 去掉链接、裸网址、`~署名` 后没剩下文字 */
function isOnlyLinks(body: string): boolean {
  if (collectLinks(body).length === 0) return false;
  const rest = body
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/(^|\s)[~-]\S+/g, ' ');
  return !/[\p{L}\p{N}]/u.test(rest);
}

export function splitAnswerSections(markdown: string, rule: LinkedAnswerRule): LinkedAnswerSection[] {
  const sections: LinkedAnswerSection[] = [];
  let heading: string | null = null; // 第一个 `##` 之前是页首说明(「本题同时出现在 10A #1…」),丢掉
  let body: string[] = [];
  const flush = (): void => {
    if (heading === null || rule.dropSections.test(heading)) return;
    const text = body.join('\n').trim();
    // 标题不带 video 但正文只有链接 + 署名(如 AoPS「Easy Solution」只贴了一个 YouTube 链接)→ 同样只留链接
    if (rule.linkOnlySections.test(heading) || isOnlyLinks(text)) {
      const links = collectLinks(text);
      if (links.length > 0) sections.push({ heading, kind: 'links', markdown: '', links });
      return;
    }
    if (text) sections.push({ heading, kind: 'text', markdown: text, links: [] });
  };
  for (const line of markdown.split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      flush();
      heading = h[1];
      body = [];
    } else {
      body.push(line);
    }
  }
  flush();
  return sections;
}
