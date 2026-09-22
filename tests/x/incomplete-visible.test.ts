/**
 * ⭐⭐ 「没拿全」必须看得见 —— 用户 2026-09-22 点破的形态。
 *
 * > 「不管长文短文,如果折叠起来就应该 show all,然后获取完整的内容,
 * >   就像人一样,但是现在却是分的零碎,却无法获取完整的内容。」
 *
 * ── 问题的形状 ──
 * 采集一直是「**载荷给什么存什么**」:
 *  · 长推全文在 `note_tweet`,X 不给时 `legacy.full_text` 是**截断**的
 *  · 长文正文在 `content_state`,**列表页根本不给**
 * 两种情况我们都存了残缺版,**而且不知道** ——
 * 于是「没拿全」和「本来就这么短」在库里长得一模一样。
 *
 * ⭐ 这一步只做「让缺口可见」,不改采集底座:
 * 先把「到底缺多少」从**猜**变成**数**。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectIncomplete } from '../../src/platform/main/x/x-timeline-harvester';

describe('⭐⭐ 行为:截断要认出来', () => {
  it('⚠️⚠️ 省略号结尾 = 被截断(X 截长推就是这个形态)', () => {
    expect(detectIncomplete({
      articleBody: '', fullText: '这是一条很长的推文的开头…', isArticle: false,
    }), '省略号结尾没认出来 —— 截断版会被当成全文存进库').toBe('text-truncated');
  });

  it('⚠️ 省略号 + 自链结尾 = 被截断', () => {
    expect(detectIncomplete({
      articleBody: '', fullText: 'some long tweet… https://t.co/abc123', isArticle: false,
    })).toBe('text-truncated');
  });

  it('⭐⭐ 有 note_tweet 就是拿全了 —— 不许误报', () => {
    /** ⚠️ 误报的代价:去补一条本来就完整的推,白跑一趟详情页且看不出错 */
    expect(detectIncomplete({
      articleBody: '', noteText: '完整全文……结尾也可能带省略号…', fullText: '开头…',
      isArticle: false,
    }), '有 note_tweet 却报截断 —— 会去补本来就完整的推').toBeUndefined();
  });

  it('⭐⭐ 正常结尾的短推不许报截断(宁可漏报不可错报)', () => {
    for (const t of [
      'Which signal survives a fresh wallet best?',
      'Full build in the article ↓',
      '#Deltarune #Chapter5 #AI',
      'That timing problem is exactly why I built The Funding Tape.',
    ]) {
      expect(detectIncomplete({ articleBody: '', fullText: t, isArticle: false }),
        `「${t}」被误报成截断 —— 这是完整句子`).toBeUndefined();
    }
  });

  it('⚠️⚠️ 不许用「长度接近 280」当判据', () => {
    /**
     * ⚠️ 正好写满 280 字的推是**完整**的。用长度判会把一大批完整短推
     * 错报成截断,然后我们去补一堆本来就没问题的推。
     */
    const exactly280 = 'a'.repeat(280);
    expect(detectIncomplete({ articleBody: '', fullText: exactly280, isArticle: false }),
      '按长度判截断了 —— 写满 280 字的完整推会被错报').toBeUndefined();
  });
});

describe('⭐⭐ 行为:长文没正文要认出来', () => {
  it('⚠️⚠️ 有 article 结构却没正文 = 没拿全', () => {
    expect(detectIncomplete({
      articleBody: '', fullText: 'https://t.co/xxx', isArticle: true,
    }), '长文没正文没被认出来 —— 23 字的 t.co 短链会被当成全文').toBe('article-no-body');
  });

  it('⭐ 长文有正文 = 拿全了', () => {
    expect(detectIncomplete({
      articleBody: '几千字正文'.repeat(100), fullText: 'https://t.co/x', isArticle: true,
    })).toBeUndefined();
  });

  it('⭐ 长文优先报 no-body(它比截断更确定)', () => {
    expect(detectIncomplete({
      articleBody: '', fullText: '标题…', isArticle: true,
    }), '长文没正文应报 article-no-body,不是 text-truncated').toBe('article-no-body');
  });
});

describe('⚠️ 缺口必须报出来,不能只存在字段里', () => {
  const strip = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const collect = strip(readFileSync(
    join(process.cwd(), 'src/platform/main/x/x-auto-collect.ts'), 'utf-8'));
  const harvester = strip(readFileSync(
    join(process.cwd(), 'src/platform/main/x/x-timeline-harvester.ts'), 'utf-8'));

  it('⭐⭐ 解析时要真的调 detectIncomplete(光有函数不算)', () => {
    /** ⚠️ 「类型有、函数有、消费端零调用」是本仓常见的死字段形态 */
    expect(harvester, '解析器没调 detectIncomplete —— 字段永远是 undefined')
      .toMatch(/incomplete: detectIncomplete\(/);
  });

  it('⭐⭐ 没拿全的条数要进 notes —— 人看得见才叫「可见」', () => {
    const i = collect.indexOf('stillIncomplete');
    expect(i, '没有统计「仍然没拿全的」').toBeGreaterThan(0);
    const blk = collect.slice(i, i + 1400);
    expect(blk, '统计了却不报出来 —— 等于没统计').toMatch(/notesPre\.push/);
    expect(blk, '没说清和「本来就这么短」的区别 —— 人会当成完整数据用')
      .toMatch(/本来就这么短/);
  });

  it('⭐⭐ 报告里要量它 —— 不量的字段永远是 100%', () => {
    expect(collect, '报告里没有 incomplete —— 「缺多少」又变回猜的')
      .toMatch(/incomplete: incomplete\.length/);
    /** ⚠️ 两种缺口要分开数:成因不同,补法也不同 */
    expect(collect, '两种缺口没分开数').toMatch(/incompleteTruncated/);
    expect(collect, '两种缺口没分开数').toMatch(/incompleteNoBody/);
  });
});
