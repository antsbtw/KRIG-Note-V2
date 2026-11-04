/**
 * X 加权字数(发推第①期,2026-10-27)—— 照 twitter-text v3 的算法,不引库(就这几条规则)
 *
 * - 码点在这几个区间里算 1:0–4351(拉丁 / 西里尔 / 希腊…)、8192–8205、8208–8223、8242–8247(空格 / 破折号 / 引号 / 撇号)
 * - 其余(中日韩、全角标点…)算 2
 * - emoji 按「一个看得见的字」算 2(👨‍👩‍👧 这种组合序列也只算一次)
 * - 链接一律算 23(X 会换成 t.co)
 * ⚠️ 链接只认 http(s):// 和 www. 开头;twitter-text 还认裸域名(example.com),这里不认 —— 裸域名会少算,
 *   确认窗以这里为准,X 那边若显示超了以 X 为准(第 ② 期填进 X 后能看到 X 自己的计数)。
 */
export const X_POST_LIMIT = 280;
const URL_WEIGHT = 23;
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"'「」（）()]+/gi;
const ONE_RANGES: ReadonlyArray<readonly [number, number]> = [[0, 4351], [8192, 8205], [8208, 8223], [8242, 8247]];
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

function codePointWeight(cp: number): number {
  return ONE_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi) ? 1 : 2;
}

function textWeight(s: string): number {
  let n = 0;
  for (const { segment } of segmenter.segment(s)) {
    if (EMOJI_RE.test(segment)) { n += 2; continue; }
    for (const ch of segment) n += codePointWeight(ch.codePointAt(0) as number);
  }
  return n;
}

export function xWeightedLength(text: string): number {
  const s = text.normalize('NFC');
  let n = 0;
  let last = 0;
  for (const m of s.matchAll(URL_RE)) {
    n += textWeight(s.slice(last, m.index)) + URL_WEIGHT;
    last = (m.index as number) + m[0].length;
  }
  return n + textWeight(s.slice(last));
}
