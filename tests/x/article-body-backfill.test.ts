/**
 * 守卫:长文正文逐篇补全。
 *
 * ── 这组守卫要钉住的四件事 ──
 *
 * ① **`is_article` 四处都登记了** —— schema / 类型 / toRecord / 写库 SQL(SET+参数两处)。
 *    ⚠️ bug ⑥(metrics_at)就是只登记了一半:只加在 ON DUPLICATE 段,
 *    **新行永远是 NONE**,而 19 条守卫全钉在 ON DUPLICATE 上,一条都没看 INSERT 段。
 *    ⭐ 所以这里**两段分开断言**,不用整文件 toMatch(会被另一段的同名字段兜住)。
 *
 * ② **拿到正文就停** —— 不能退化成 `fetchArticleReplies` 那种滚到底
 *    (实测一篇 76.7 秒 / 23 轮,而正文在第一个响应里)。
 *
 * ③ **停止判据必须带 tweetId** —— 详情页连着回复一起下发,
 *    只判「有正文」会被别人的长推顶掉,于是没拿到这一篇却提前停了(看着还是成功的)。
 *
 * ④ **走同一个 upsertTweet** —— 合并策略(text 只许变长)全在那里,
 *    另写一条写库语句就会绕开它,而这正是本轮修掉的数据损坏的成因。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ⚠️ 剥注释的行注释正则必须写成 `(^|[^:])//` ——
 * 裸 `//.*$` 会命中 `https://` 里的那两个斜杠,把整段 URL 连同后面的代码删掉,
 * 于是扫这些代码的守卫**永远假绿**(本仓 2026-09-20 实测踩过)。
 */
function strip(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLine = noBlock.replace(/(^|[^:])\/\/.*$/gm, '$1');
  if (noLine.includes('/*') || /(^|[^:])\/\//m.test(noLine)) {
    throw new Error('strip 自检失败:还有注释残留');
  }
  return noLine;
}

const read = (rel: string) => strip(readFileSync(join(process.cwd(), rel), 'utf-8'));

const repo = read('src/platform/main/db/tweet-inbox-repo.ts');
const backfill = read('src/platform/main/x/x-article-backfill.ts');
const autoCollect = read('src/platform/main/x/x-auto-collect.ts');
const types = read('src/shared/types/x-timeline-types.ts');
const schema = read('src/storage/surreal/x-schema.ts');

/**
 * ⭐ 把写库语句切成 **INSERT 段** 与 **ON DUPLICATE 段** 两份。
 *
 * ⚠️ 不用固定字数 slice —— 注释一长就切歪(本轮修过一条这样的假红)。
 * 切到真正的边界,并断言切出来的不是空的(indexOf 返 -1 会让 slice 空转恒真)。
 */
const insertSeg = (() => {
  const a = repo.indexOf('INSERT INTO x_tweet');
  expect(a, '找不到 INSERT INTO x_tweet').toBeGreaterThan(0);
  const b = repo.indexOf('ON DUPLICATE KEY UPDATE', a);
  expect(b, '找不到 ON DUPLICATE KEY UPDATE').toBeGreaterThan(a);
  const seg = repo.slice(a, b);
  expect(seg.length, 'INSERT 段切出来是空的').toBeGreaterThan(200);
  return seg;
})();

const onDupSeg = (() => {
  const a = repo.indexOf('ON DUPLICATE KEY UPDATE');
  expect(a, '找不到 ON DUPLICATE KEY UPDATE').toBeGreaterThan(0);
  const seg = repo.slice(a, repo.indexOf('`', a));
  expect(seg.length, 'ON DUPLICATE 段切出来是空的').toBeGreaterThan(200);
  return seg;
})();

/** 参数对象段 —— 「每个 $ 变量都要真绑值」 */
const paramSeg = (() => {
  const a = repo.indexOf('tweet_id: record.tweet_id');
  expect(a, '找不到参数对象').toBeGreaterThan(0);
  const seg = repo.slice(a, a + 6000);
  expect(seg.length, '参数段切出来是空的').toBeGreaterThan(200);
  return seg;
})();

describe('① is_article 必须四处都登记(漏一处就静默丢失)', () => {
  it('⚠️⚠️ INSERT 段要有 is_article —— 否则**新行永远是 NONE**(bug ⑥ 的形态)', () => {
    expect(insertSeg, 'INSERT 段没有 is_article:新插入的行标不上长文,候选永远查不出来')
      .toMatch(/is_article:\s*\$is_article/);
  });

  it('⚠️ ON DUPLICATE 段要有 is_article —— 否则重采的老行补不上', () => {
    expect(onDupSeg, 'ON DUPLICATE 段没有 is_article').toMatch(/is_article\s*=/);
  });

  it('⚠️ 参数对象必须真绑值(SQL 写了 $is_article,这里不给就是空)', () => {
    expect(paramSeg, '参数对象里没有 is_article —— SurrealDB 拿不到值,字段静默为空')
      .toMatch(/is_article:\s*record\.is_article/);
  });

  it('⭐ 类型里要声明 —— 没有它 toRecord 根本写不进去', () => {
    expect(types, 'TweetInboxRecord 没有 is_article').toMatch(/is_article\?:\s*boolean/);
  });

  it('⭐ toRecord 要写入,且用 isArticle 不用 isLongText', () => {
    const a = autoCollect.indexOf('function toRecord');
    expect(a, '找不到 toRecord').toBeGreaterThan(0);
    const seg = autoCollect.slice(a, autoCollect.indexOf('\n}', a));
    expect(seg.length, 'toRecord 切出来是空的').toBeGreaterThan(100);
    expect(seg, 'toRecord 没写 is_article').toMatch(/is_article:\s*t\.isArticle/);
    /**
     * ⚠️ **不能用 isLongText** —— 那是「真拿到正文了」。
     * 要找的正是「是长文**但**正文还没取回」,用它当标记会把这一类恰好漏掉。
     */
    expect(seg, 'toRecord 用了 isLongText 当长文标记 —— 缺正文的长文会被漏掉')
      .not.toMatch(/is_article:\s*t\.isLongText/);
  });

  it('⭐ schema 要有字段定义', () => {
    expect(schema, 'x-schema 没有 is_article 字段').toMatch(/DEFINE FIELD IF NOT EXISTS is_article/);
  });
});

describe('② is_article 只补不抹(浅采不许把长文标记洗掉)', () => {
  it('⚠️ 不许无条件覆盖 —— DOM 兜底路径不产出这个字段', () => {
    const m = onDupSeg.match(/^\s*is_article\s*=.*$/m);
    expect(m, 'ON DUPLICATE 段里找不到 is_article 的更新行').not.toBeNull();
    /**
     * ⚠️ 必须先判新值非 NONE 才写 —— 写成 `is_article = $is_article`
     * 就是 bug ② 的形态:一趟浅采把已经标好的长文抹回 NONE。
     */
    expect(m![0], 'is_article 是无条件覆盖 —— 浅采会把长文标记抹掉')
      .toMatch(/IF\s+\$is_article\s*!=\s*NONE/);
  });
});

describe('③ 补正文:拿到就停,别退化成滚到底', () => {
  it('⭐⭐ 必须用 stopWhen 提前结束(否则一篇 76.7 秒)', () => {
    expect(backfill, '没有 stopWhen —— 会一路滚到底,正文明明在第一个响应里')
      .toMatch(/stopWhen:/);
  });

  it('⚠️⚠️ 停止判据必须**同时**判 tweetId 与正文', () => {
    const m = backfill.match(/stopWhen:\s*\(t\)\s*=>\s*(.*)$/m);
    expect(m, '找不到 stopWhen 的判据').not.toBeNull();
    const cond = m![1];
    /**
     * ⚠️ 只判 gotBody 会被**别人的长推**顶掉:详情页连着回复一起下发,
     * 于是「没拿到这一篇的正文」却提前停了 —— 而且看起来是成功的。
     */
    expect(cond, 'stopWhen 没判 tweetId —— 会被详情页里别人的长推顶掉')
      .toMatch(/t\.tweetId\s*===\s*tweetId/);
    expect(cond, 'stopWhen 没判正文').toMatch(/gotBody\(t\)/);
  });

  it('⚠️ 不许照搬 fetchArticleReplies(它为翻完回复设计,且走 campaign 的 ws)', () => {
    expect(backfill, '补正文调用了 fetchArticleReplies —— 一篇 76.7 秒,且会与 campaign 那条线缠在一起')
      .not.toMatch(/fetchArticleReplies/);
    expect(backfill, '补正文用了 resolveAnyXWebContents —— 那是 campaign 的无人值守解析,采集侧不该用')
      .not.toMatch(/resolveAnyXWebContents/);
  });
});

describe('④ 写库必须走同一个 upsertTweet(合并策略全在那)', () => {
  it('⭐ 用 upsertTweet,不另写写库语句', () => {
    expect(backfill, '补正文没走 upsertTweet').toMatch(/upsertTweet\(/);
    /**
     * ⚠️ 另写一条 INSERT/UPSERT 就绕开了「text 只许变长」,
     * 而那正是本轮修掉的数据损坏(16081 字 → 267 字)的成因。
     */
    expect(backfill, '补正文自己拼了写库语句 —— 会绕开 text 只许变长的合并策略')
      .not.toMatch(/INSERT\s+INTO|UPSERT\s+x_tweet/i);
  });

  it('⚠️ 不许碰业务字段(accepted / ai_verdict / translation 覆盖不可逆)', () => {
    for (const f of ['accepted', 'ai_verdict', 'translation', 'replied']) {
      expect(backfill, `补正文写了业务字段 ${f} —— 人工与 AI 填的,覆盖不可逆`)
        .not.toMatch(new RegExp(`${f}:`));
    }
  });
});

describe('⑤ 候选查询:不能用字数当长文判据', () => {
  it('⚠️⚠️ 必须靠 is_article,不能只看字数', () => {
    const a = repo.indexOf('export async function listArticlesMissingBody');
    expect(a, '找不到 listArticlesMissingBody').toBeGreaterThan(0);
    const seg = repo.slice(a, a + 2000);
    expect(seg.length, '候选查询切出来是空的').toBeGreaterThan(200);
    /**
     * ⚠️ 实测 10056 行里超过 2000 字的只有 3 行,
     * 而正文被摘要顶掉的长文只有 267 字 —— 与普通推**长得一模一样**。
     * 光用字数根本分不出「短推」和「被截断的长文」。
     */
    expect(seg, '候选查询没用 is_article —— 字数分不出「短推」和「被截断的长文」')
      .toMatch(/is_article\s*=\s*true/);
    /**
     * ⚠️ `string::len(NONE)` 会**抛错**(实测 "Expected string but found NONE"),
     * 整条查询失败 —— 老行 text 可能是 NONE,`?? ''` 不能省。
     */
    expect(seg, "string::len 没有 ?? '' 兜底 —— 老行 text 是 NONE 时整条查询会抛错")
      .toMatch(/string::len\(text\s*\?\?\s*''\)/);
  });

  it('⚠️ handle 必须走共用的 normalizeHandle,不许手写一套', () => {
    const a = repo.indexOf('export async function listArticlesMissingBody');
    expect(a, '找不到 listArticlesMissingBody').toBeGreaterThan(0);
    const seg = repo.slice(a, a + 2000);
    expect(seg.length, '候选查询切出来是空的').toBeGreaterThan(200);
    /**
     * ⚠️ 库里 author_handle 存的是归一化形态。写入端与比对端一旦漂移
     * (共用版会 trim 空白、剥多个 @,手写 `.replace(/^@/,'')` 两样都没有),
     * 结果是**恒查不到且不报错** —— 表现为「一篇候选都没有」,
     * 与「真的都补全了」长得一模一样。
     */
    expect(seg, '候选查询手写了 handle 归一化 —— 与写入端漂移会让筛选恒不命中且不报错')
      .toMatch(/normalizeHandle\(/);
    expect(seg, '候选查询手写了 .replace(/^@/) —— 必须用共用的 normalizeHandle')
      .not.toMatch(/replace\(\/\^@/);
  });
});

describe('⑥ 留痕:成功路径的判断依据也要留下', () => {
  it('⭐⭐ 必须落盘 —— 「下次验证能不能不靠人」', () => {
    expect(backfill, '补正文没有留痕 —— 关掉面板就查不到补了什么')
      .toMatch(/writeBackfillJournal/);
  });

  it('⚠️ 每篇要记「字数前→后」,不能只报总数', () => {
    expect(backfill, 'BackfillItem 没有 lenBefore').toMatch(/lenBefore/);
    expect(backfill, 'BackfillItem 没有 lenAfter').toMatch(/lenAfter/);
    /** ⚠️ 「采到了」与「写库了」分开 —— 采到但写库炸了必须看得见 */
    expect(backfill, 'gotBody 与 saved 没分开 —— 写库失败会被当成补上了')
      .toMatch(/gotBody:\s*boolean/);
    expect(backfill, 'gotBody 与 saved 没分开').toMatch(/saved:\s*boolean/);
  });

  it('⚠️ 留痕清理要认 backfill- 前缀(否则这一半无限堆积)', () => {
    const journal = read('src/platform/main/x/x-collect-journal.ts');
    const a = journal.indexOf('function pruneJournal');
    expect(a, '找不到 pruneJournal').toBeGreaterThan(0);
    const seg = journal.slice(a, a + 800);
    expect(seg.length, 'pruneJournal 切出来是空的').toBeGreaterThan(100);
    expect(seg, "pruneJournal 只清 collect-,backfill- 的留痕会无限堆积")
      .toMatch(/backfill-/);
  });
});

describe('⑦ 采集时当场补全(用户 2026-09-22 拍板改掉的两步)', () => {
  it('⭐⭐ autoCollect 必须调用 backfillArticlesInline —— 否则又退回「采完还要再点一次」', () => {
    expect(autoCollect, 'autoCollect 没有当场补正文 —— 人又要多点一步,且存量老行永远补不上')
      .toMatch(/backfillArticlesInline\(/);
  });

  it('⚠️ 判据必须是「是长文 && 没正文」,不能靠库里的 is_article 标记', () => {
    const a = backfill.indexOf('export async function backfillArticlesInline');
    expect(a, '找不到 backfillArticlesInline').toBeGreaterThan(0);
    const seg = backfill.slice(a, a + 1500);
    expect(seg.length, '切出来是空的').toBeGreaterThan(200);
    /**
     * ⭐ 当场补的**全部意义**就在这里:判据来自**这一趟采到的数据**
     * (`t.isArticle`),不来自库里的标记 —— 所以存量老行重采一次也能补上。
     * ⚠️ 如果这里退回查库(listArticlesMissingBody),就又回到「先采一次标记」的两步。
     */
    expect(seg, '当场补却去查库找候选 —— 那就又变回两步了')
      .not.toMatch(/listArticlesMissingBody/);
    expect(seg, '判据没用 isArticle').toMatch(/t\.isArticle/);
    expect(seg, '判据没排除「已经有正文的」—— 会对详情页来的推白跑一趟')
      .toMatch(/!gotBody\(t\)/);
  });

  it('⚠️⚠️ 补正文失败绝不能拦住采集(推文已入库,补正文是增量)', () => {
    const a = autoCollect.indexOf('backfillArticlesInline(');
    expect(a, '找不到调用点').toBeGreaterThan(0);
    const seg = autoCollect.slice(Math.max(0, a - 200), a + 400);
    expect(seg.length, '切出来是空的').toBeGreaterThan(100);
    /**
     * ⚠️ 写成 `const x = await f()` 之后只读返回值是安全的;
     * 但**绝不能**让它 throw 冲掉整趟采集 —— 函数内部已全程 try/catch,
     * 这里再钉一道:调用点不许把它塞进会上抛的位置。
     */
    expect(seg, '补正文的调用没有承接返回值 —— 它的 problems/note 会丢')
      .toMatch(/const\s+articleBackfill\s*=\s*await\s+backfillArticlesInline/);
  });

  it('⚠️ 补正文的 problems 要并进报告(只放 notes 不够醒目)', () => {
    expect(autoCollect, '补正文的 problems 没并进报告 —— 失败会被 notes 淹掉')
      .toMatch(/articleBackfill\?\.problems/);
  });

  it('⚠️ 单趟要有上限,且超出部分必须如实说「没全补」', () => {
    const a = backfill.indexOf('export async function backfillArticlesInline');
    const seg = backfill.slice(a, a + 6000);
    expect(seg.length, '切出来是空的').toBeGreaterThan(500);
    expect(seg, '没有上限 —— 一趟 72 篇长文会打 72 次详情页,必撞限流')
      .toMatch(/slice\(0,\s*limit\)/);
    /** ⚠️ 「补了 10 篇」与「这页长文都补全了」不是一回事,差额必须说出来 */
    expect(seg, '超出上限没说「并未全补」—— 会被当成补全了')
      .toMatch(/并未全补/);
  });
});