import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractTweetsFrom, type HarvestedTweet } from '../../src/platform/main/x/x-timeline-harvester';

function strip(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLine = noBlock.replace(/(^|[^:])\/\/.*$/gm, '$1');
  if (noLine.includes('/*') || /(^|[^:])\/\//m.test(noLine)) {
    throw new Error('strip 自检失败:还有注释残留');
  }
  return noLine;
}

/**
 * ⭐⭐ 单条推的完整性 —— 用户 2026-09-21:
 * 「先观察单条推文的完整性,然后才是 item 的条数」。
 *
 * ⚠️ 这个顺序比「条数对账」更根本:每条推本身就缺字段的话,条数再对也没用。
 * 而且它**不需要分母**,任何页面都能验。
 */
describe('⭐⭐ 单条推文的完整性', () => {
  const harvester = strip(readFileSync(
    join(process.cwd(), 'src/platform/main/x/x-timeline-harvester.ts'), 'utf-8'));
  const collect = strip(readFileSync(
    join(process.cwd(), 'src/platform/main/x/x-auto-collect.ts'), 'utf-8'));

  /** 一条**真实结构**的推(照 2026-09-02 实采载荷的形状) */
  const REAL = {
    data: { timeline: { instructions: [{ entries: [{
      entryId: 'tweet-2090257762169090351',
      content: { itemContent: { tweet_results: { result: {
        rest_id: '2090257762169090351',
        core: { user_results: { result: {
          rest_id: '1234567890',
          core: { screen_name: 'Finding8964', name: 'Finding' },
          avatar: { image_url: 'https://pbs.twimg.com/profile_images/2072883597418328064/x.jpg' },
          legacy: {},
        } } },
        legacy: {
          id_str: '2090257762169090351',
          full_text: '正文',
          created_at: 'Wed Sep 02 10:00:00 +0000 2026',
          lang: 'zh',
          conversation_id_str: '2090257762169090351',
          favorite_count: 5, retweet_count: 1, reply_count: 2, quote_count: 0,
        },
        views: { count: '123' },
      } } } },
    }] }] } },
  };

  it('⭐⭐⭐ 行为测试:载荷路径必须产出 显示名/头像/URL', () => {
    /**
     * ⚠️⚠️ 2026-09-21 实测暴露:这三个字段**载荷路径从来没赋过值**,
     * 只有 DOM 路径产出 → 库里 400 条抽样 tweet_url 77% 空、avatar 80% 空,
     * 而报告显示「15/16 项 100%」(因为 coverage 表里没有它们)。
     *
     * ⚠️ 同族:x-capture-monitor 因「载荷首选、DOM 兜底」把 DOM 独有字段全丢了
     * (见记忆 feedback-dont-record-own-choices-as-user-requirements)。
     * **同一个坑,另一条路径。**
     */
    const out = new Map<string, HarvestedTweet>();
    extractTweetsFrom(REAL, out);
    const t = [...out.values()][0];
    expect(t, '真实结构的载荷里一条推都没解出来').toBeTruthy();

    expect(t.authorName, '显示名没解出来 —— 载荷里 core.name 是有的').toBe('Finding');
    expect(t.authorAvatar, '头像没解出来 —— 载荷里 avatar.image_url 是有的')
      .toMatch(/^https:\/\/pbs\.twimg\.com\//);
    expect(
      t.tweetUrl,
      '推文 URL 没产出 —— 载荷不直接给,但 handle + id 拼得出(确定规则,不是猜)',
    ).toBe('https://x.com/Finding8964/status/2090257762169090351');
  });

  it('⭐⭐ 没有 handle 时**不拼** URL(拼出 undefined 比没有更糟)', () => {
    const noHandle = JSON.parse(JSON.stringify(REAL));
    const res = noHandle.data.timeline.instructions[0].entries[0]
      .content.itemContent.tweet_results.result;
    res.core.user_results.result.core = {};
    res.core.user_results.result.legacy = {};
    const out = new Map<string, HarvestedTweet>();
    extractTweetsFrom(noHandle, out);
    const t = [...out.values()][0];
    expect(
      t?.tweetUrl,
      '没有 handle 却拼了 URL —— 会存出 x.com/undefined/status/… 这种脏数据',
    ).toBeUndefined();
  });

  it('⭐⭐⭐ 这三项必须进 coverage —— 不量的字段永远是 100%', () => {
    /**
     * ⚠️ 「清单不会自己长」在覆盖率这里同样成立:
     * 加了字段不加进 FIELD_SPEC,等于没采也看不出来。
     */
    for (const f of ['authorName', 'authorAvatar', 'tweetUrl']) {
      expect(
        collect,
        `FIELD_SPEC 里没有 ${f} —— 不量的字段永远显示 100%`,
      ).toMatch(new RegExp(`field: '${f}'`));
    }
  });

  it('⭐⭐⭐ conversation_id 必须真的写进库(schema 有列、解析有值,别在类型上断掉)', () => {
    /**
     * ⚠️ 实测:schema 有 `conversation_id`(还带索引 idx_tweet_conversation)、
     * 解析器有 `conversationId`,唯独 `TweetInboxRecord` 没声明 → 写不进去 →
     * 库里**恒空** → 回复归不到根推上。
     * ⭐ 「schema 有、解析有、类型没有」是最难发现的丢失:三处各自看都正常。
     */
    const i = collect.indexOf('function toRecord');
    expect(i, '找不到 toRecord').toBeGreaterThan(0);
    const body = collect.slice(i, collect.indexOf('\n}', i));
    expect(
      body,
      'toRecord 没写 conversation_id —— schema 有这一列却永远是空的,回复归不了根推',
    ).toMatch(/conversation_id:\s*t\.conversationId/);
    expect(
      body,
      'toRecord 没写 author_name_at_post —— 人改名后就不知道发推时叫什么了',
    ).toMatch(/author_name_at_post:/);

    const types = strip(readFileSync(
      join(process.cwd(), 'src/shared/types/x-timeline-types.ts'), 'utf-8'));
    expect(
      types,
      'TweetInboxRecord 没声明 conversation_id —— 声明缺了,toRecord 写了也进不去',
    ).toMatch(/conversation_id\?:\s*string/);
  });

  it('⭐⭐⭐ 入库后要**回读对账**(解析对了≠存对了)', () => {
    /**
     * ⭐ 可靠性纲领铁律四:成功要对账 —— 写完回读,
     * 而不是「没抛异常就当成了」。
     */
    expect(collect, '没有回读入库结果').toMatch(/readBackTweets/);
    const i = collect.indexOf("let dbCheck");
    expect(i, '找不到 dbCheck 的计算').toBeGreaterThan(0);
    const blk = collect.slice(i, i + 1800);
    /** ⚠️ 钉**只查采集该负责的字段** —— 业务后填的算进去会永远报缺 */
    expect(
      blk,
      '回读没有限定「采集该负责的字段」—— accepted/replied/ai_verdict 这些'
      + '本来就该是空的,算进去会让指标永远上不去(假指标)',
    ).toMatch(/OWNED/);
    for (const f of ['tweet_url', 'conversation_id']) {
      expect(blk, `回读没查 ${f}`).toMatch(new RegExp(f));
    }
    /** ⚠️ 业务字段不许混进来 */
    expect(
      blk.slice(blk.indexOf('OWNED'), blk.indexOf(']', blk.indexOf('OWNED'))),
      '把业务后填的字段算进了采集完整性 —— 那是假指标',
    ).not.toMatch(/accepted|replied|ai_verdict|filter_score/);
  });

  it('⭐⭐⭐ 一个字段要在**四处**都登记,漏一处就静默丢失', () => {
    /**
     * ⚠️⚠️ 2026-09-21 实测(这是同族**第四刀**):
     *
     * `conversation_id` 我在 schema(早就有,带索引)、解析器、
     * `TweetInboxRecord` 类型、`toRecord` 四处里补了**三处**,
     * 唯独漏了 **`upsertTweet` 的写库语句** —— 那条 SQL 把字段
     * **逐个写死**在 SET 子句和参数对象里。
     *
     * 结果:同一批 12 条推,`tweet_url`/`author_avatar` 都进库了,
     * **只有 conversation_id 全空** —— 因为那两个在清单里,它不在。
     * 现象极具迷惑性:看起来像「这个字段解析不出来」,实则是登记漏了。
     *
     * ⭐ 判据:**凡是 toRecord 写的字段,写库语句里必须都有** ——
     * 不是钉某一个字段(那样加新字段又会漏),而是**两张清单对照**。
     */
    const repo = strip(readFileSync(
      join(process.cwd(), 'src/platform/main/db/tweet-inbox-repo.ts'), 'utf-8'));

    /** toRecord 里写了哪些列 */
    const ti = collect.indexOf('function toRecord');
    const tbody = collect.slice(ti, collect.indexOf('\n}', ti));
    const written = [...tbody.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]);
    expect(written.length, 'toRecord 里一个字段都没解析出来(守卫锚点失效?)')
      .toBeGreaterThan(8);

    /** upsertTweet 的 SET 子句里有哪些列 */
    const ui = repo.indexOf('export async function upsertTweet');
    expect(ui, '找不到 upsertTweet').toBeGreaterThan(0);
    /**
     * ⚠️⚠️ **不许用固定字数切** —— 2026-09-22 实测假红:
     * 给 SQL 加了合并策略的注释后,函数变长,参数对象被 4000 字窗口**切掉一半**,
     * 于是 reply_draft / backfilled 被报成「没绑值」——
     * 而它们明明就在下面两行绑着。
     * ⭐ 改切到**函数真正的结尾**(与上面 toRecord 同法),长度就不再是变量。
     */
    const uEnd = repo.indexOf('\n}', ui);
    expect(uEnd, '找不到 upsertTweet 的结尾').toBeGreaterThan(ui);
    const ubody = repo.slice(ui, uEnd);
    const inSql = new Set([...ubody.matchAll(/(\w+):\s*\$\w+/g)].map((m) => m[1]));

    /**
     * ⚠️ 白名单 —— **只放「本来就不该有对应库列」的**,别拿它掩盖真丢失。
     *
     * · expires_at / filter_reason:写库时自己算,不从 record 来
     * · author_name:**内存字段,不是库列** —— 库里那列叫 `author_name_at_post`。
     *   它有别的消费者(registerSeenAuthor 的 displayName、收件箱显示),
     *   所以 toRecord 两个都赋值是对的,不是重复。
     *   ⚠️ 加新条目前先问:**这个字段真的不该进库吗?**
     *   —— conversation_id 当初要是被图省事加进白名单,这个 bug 就永远查不出来了。
     */
    const NOT_FROM_RECORD = new Set(['expires_at', 'filter_reason', 'author_name']);
    const missing = written.filter((f) => !inSql.has(f) && !NOT_FROM_RECORD.has(f));
    expect(
      missing,
      `toRecord 写了这些字段,但 upsertTweet 的 SQL 里没有 —— **会静默丢失**:`
      + `${missing.join('、')}`,
    ).toEqual([]);

    /**
     * ⭐⭐ **SET 子句引用的每个变量,参数对象里必须真的传值**。
     *
     * ⚠️ 实测假绿(本轮注入②):SET 里写着 `conversation_id: $conversation_id`、
     * 参数对象里却没有 `conversation_id:` —— SQL 引用了一个**不存在的变量**,
     * 而上面那条检查只扫 SET 子句,照样全绿。
     * ⭐ 登记一个字段要**两处都到位**:声明用哪个变量 + 真的给那个变量赋值。
     */
    /**
     * ⚠️ 锚点别用 SQL 的收尾形状 —— 实测:把结尾从 `}\`,` 改成
     * `conversation_id = $conversation_id\`,` 就锚不到了(守卫假红)。
     * ⭐ 改锚在**参数对象的第一个字段**上,它不随 SQL 写法变。
     */
    const firstParam = ubody.indexOf('tweet_id: record.tweet_id');
    expect(firstParam, '找不到参数对象(应含 tweet_id: record.tweet_id)').toBeGreaterThan(0);
    /** ⚠️ 要从**第一个字段之前**切起,否则 tweet_id 自己会被算成「没绑值」 */
    const paramsStart = ubody.lastIndexOf('{', firstParam);
    expect(paramsStart, '找不到参数对象的左括号').toBeGreaterThan(0);
    const paramsBlk = ubody.slice(paramsStart);
    const bound = new Set(
      [...paramsBlk.matchAll(/^\s{6}(\w+):/gm)].map((m) => m[1]));
    const declaredVars = [...ubody.slice(0, paramsStart)
      .matchAll(/(\w+):\s*\$(\w+)/g)].map((m) => m[2]);
    const unbound = [...new Set(declaredVars)].filter((v) => !bound.has(v));
    expect(
      unbound,
      `SQL 里用了这些 $变量,参数对象却没给值 —— 写进去的会是空:${unbound.join('、')}`,
    ).toEqual([]);
  });

  it('⭐⭐ 整片为空要**报出来**,不是只记个数', () => {
    /**
     * ⚠️ 「某字段抽查 20 条全空」= 采集链路真的断了(解析没取/没写库/类型没声明),
     * 而「20 条里空 3 条」可能只是那几条本来就没有。
     * 两者含义相反,报告必须分开说。
     */
    const i = collect.indexOf('if (dbCheck)');
    expect(i, '回读结果没有进报告').toBeGreaterThan(0);
    const blk = collect.slice(i, i + 1800);
    expect(blk, '没有区分「整片为空」和「部分为空」').toMatch(/g\.empty === g\.of/);
    expect(blk, '整片为空时没说可能的成因').toMatch(/整片为空/);
  });
});
