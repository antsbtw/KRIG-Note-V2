/**
 * linked-answers 站点规则 —— 「题目页里每题只挂一个链接,解答在另一页」的站点
 *
 * 规则是**数据**:加一个题库站点 = 加一条规则,编排代码(expand.ts)不认识任何站点。
 * 目前只有 MediaWiki 一种取页方式(AoPS wiki 前有 Cloudflare 人机验证,主进程直接请求
 * 只拿到「Just a moment...」页 —— 2026-11-05 实测;所以必须在网页里同源 fetch api.php,
 * 带着网页已过验证的 cookie)。
 */

export interface LinkedAnswerRule {
  /** 诊断 / 日志用 */
  id: string;
  /** 右键菜单项文字 */
  menuLabel: string;
  /** 网页地址命中才出现菜单项 */
  pageUrl: RegExp;
  /** 题目标题(提取出来的 markdown `## …` 行的文字) */
  itemHeading: RegExp;
  /** 题目下那条去往解答页的链接文字 */
  linkText: RegExp;
  /** 取解答页的方式 */
  fetch: { kind: 'mediawiki-parse'; apiPath: string };
  /** 解答页里整节丢掉的 `##` 节(重复的题干、导航) */
  dropSections: RegExp;
  /** 只留链接的节(视频解答) */
  linkOnlySections: RegExp;
}

export const LINKED_ANSWER_RULES: LinkedAnswerRule[] = [
  {
    id: 'aops-wiki',
    menuLabel: '📥 提取题目 + 解答到笔记',
    // AoPS wiki 的整卷题目页,如 ?title=2025_AMC_12A_Problems(单题页是 …_Problems/Problem_1,不命中)
    pageUrl: /^https:\/\/(www\.)?artofproblemsolving\.com\/wiki\/index\.php\?title=[^&#/]+_Problems(?:[&#]|$)/,
    itemHeading: /^Problem\s+\d+$/i,
    linkText: /^Solutions?$/i,
    fetch: { kind: 'mediawiki-parse', apiPath: '/wiki/api.php' },
    dropSections: /^(Problems?|See Also)$/i,
    linkOnlySections: /video/i,
  },
];

export function matchLinkedAnswerRule(url: string): LinkedAnswerRule | null {
  return LINKED_ANSWER_RULES.find((r) => r.pageUrl.test(url)) ?? null;
}
