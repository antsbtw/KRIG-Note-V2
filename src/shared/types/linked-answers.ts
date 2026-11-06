/**
 * 「提取题目 + 解答」main ↔ renderer 共用的数据形状与占位标记(单一来源)。
 *
 * main 在题目页 markdown 里把每题的「Solution」链接行换成占位行,并把抓来的解答放进
 * linkedAnswers[];renderer 按占位行把正文切段,在原位置插入折叠块。
 */

export interface LinkedAnswerSection {
  /** 解答页里的 `##` 标题,如「Solution 1」「Video Solution by …」 */
  heading: string;
  /** text = 解法正文;links = 只留链接的节(视频解答) */
  kind: 'text' | 'links';
  /** kind=text:这一节的 markdown 正文 */
  markdown: string;
  /** kind=links:这一节里的链接 */
  links: string[];
}

export interface LinkedAnswer {
  /** 占位行序号 */
  index: number;
  /** 所属题目标题,如「Problem 1」 */
  itemHeading: string;
  /** 原链接文字,如「Solution」 */
  label: string;
  /** 解答页网址(折叠块里给人点开原文) */
  sourceUrl: string;
  ok: boolean;
  /** ok=false 时的原因(写进折叠块,不静默留空) */
  why?: string;
  sections: LinkedAnswerSection[];
}

const MARKER_PREFIX = '@@KRIG_LINKED_ANSWER_';

/** 占位行(独占一行) */
export function linkedAnswerMarker(index: number): string {
  return `${MARKER_PREFIX}${index}@@`;
}

/** 这一行是占位行就返回序号,否则 null */
export function parseLinkedAnswerMarker(line: string): number | null {
  const m = line.trim().match(/^@@KRIG_LINKED_ANSWER_(\d+)@@$/);
  return m ? Number(m[1]) : null;
}
