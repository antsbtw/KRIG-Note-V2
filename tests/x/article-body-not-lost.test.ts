/**
 * ⭐⭐ 长文(Article)正文不能丢 —— **真实载荷驱动的行为测试**
 *
 * ── 用户 2026-09-21 实测发现 ──
 *
 * 同一次采集、同一页:长推取到 957 字,两篇**长文各只存进 23 字**
 * (`text = 'https://t.co/e5H5321Vh9'`)—— 标题和几千字正文全丢。
 *
 * 真因:长文的 `legacy.full_text` 只有一个 t.co 短链,正文在
 * `article.article_results.result.content_state.blocks[]`(DraftJS),
 * 而解析器原本只走 `note_tweet ?? full_text`,`article` 零处理。
 *
 * ⚠️ 本测试的载荷**抄自真实诊断日志**(tweet 2102084427903860755),
 * 不是我编的形状 —— 编的形状只能证明「代码按我想的跑」,
 * 证明不了「它接得住 X 真给的东西」。
 *
 * ⚠️ 这是**行为测试**不是源码扫描:源码扫描看不见「会不会执行」
 * (`void 0 && parse(...)` 也能让 toMatch 全绿)。
 */
import { describe, it, expect } from 'vitest';
import { extractTweetsFrom, type HarvestedTweet } from '../../src/platform/main/x/x-timeline-harvester';

/** 真实载荷片段(取自 [🔬article结构] 日志,tweet 2102084427903860755) */
function realArticlePayload() {
  return {
    data: { x: { result: {
      __typename: 'Tweet',
      rest_id: '2102084427903860755',
      core: { user_results: { result: {
        rest_id: '111', core: { screen_name: '0xEgorAI', name: 'Egor' },
      } } },
      // ⚠️ 长文的 full_text 真的就只有一个短链 —— 这正是 bug 的来源
      legacy: {
        id_str: '2102084427903860755',
        full_text: 'https://t.co/e5H5321Vh9',
        created_at: 'Sun Sep 21 17:15:57 +0000 2026',
        lang: 'en',
      },
      article: { article_results: { result: {
        title: "How I Made $4,800 in a Month With Claude and Higgsfield",
        content_state: { blocks: [
          { key: 'ffpm8', type: 'unstyled',
            text: 'Three months ago I was sitting at my kitchen table at 2am, doing math on whether I could make it to the end of the month.' },
          { key: 'iies', type: 'unstyled', text: "I couldn't." },
          { key: '8ac2s', type: 'header-two', text: 'Where it started' },
          // ⚠️ atomic(媒体占位)的 text 是**单个空格**,不滤掉会留孤立空行
          { key: 'drjff', type: 'atomic', text: ' ' },
          { key: 'ch2mo', type: 'header-two', text: 'Why this particular combo works' },
        ] },
      } } },
    } } },
  };
}

function parseOne(payload: unknown): HarvestedTweet {
  const out = new Map<string, HarvestedTweet>();
  extractTweetsFrom(payload, out);
  const rows = [...out.values()];
  expect(rows.length, '真实载荷里应当解出恰好 1 条推').toBe(1);
  return rows[0];
}

describe('长文正文不能丢', () => {
  it('⭐ 正文段落全部取回 —— 本 bug 的回归锁', () => {
    const t = parseOne(realArticlePayload());
    expect(t.text).toContain('kitchen table at 2am');
    expect(t.text).toContain("I couldn't.");
    expect(t.text).toContain('Where it started');
    expect(t.text).toContain('Why this particular combo works');
  });

  it('⭐ 绝不再退化成那个 23 字的短链', () => {
    const t = parseOne(realArticlePayload());
    expect(t.text).not.toBe('https://t.co/e5H5321Vh9');
    // 真实那篇几千字;这个片段也远超短链长度
    expect(t.text.length).toBeGreaterThan(200);
  });

  it('atomic 媒体占位不留孤立空行', () => {
    const t = parseOne(realArticlePayload());
    expect(t.text).not.toMatch(/\n\s\n/);
    expect(t.text.split('\n\n').every((s) => s.trim().length > 0)).toBe(true);
  });

  it('标题在正文之前', () => {
    const t = parseOne(realArticlePayload());
    expect(t.text.startsWith('How I Made $4,800')).toBe(true);
  });

  it('长文要标成 isLongText', () => {
    expect(parseOne(realArticlePayload()).isLongText).toBe(true);
  });

  it('⚠️ 别为了修 A 砍掉 B:普通推仍走 full_text', () => {
    const p: any = realArticlePayload();
    delete p.data.x.result.article;
    p.data.x.result.legacy.full_text = 'just a normal tweet';
    const t = parseOne(p);
    expect(t.text).toBe('just a normal tweet');
    expect(t.isLongText).toBeFalsy();
  });

  it('⚠️ 长推(note_tweet)不受影响,仍取全文', () => {
    const p: any = realArticlePayload();
    delete p.data.x.result.article;
    p.data.x.result.note_tweet = { note_tweet_results: { result: { text: 'x'.repeat(957) } } };
    const t = parseOne(p);
    expect(t.text.length).toBe(957);
    expect(t.isLongText).toBe(true);
  });
});
