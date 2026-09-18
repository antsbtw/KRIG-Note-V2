/**
 * ⭐⭐ 卷宗盘点 —— 「附件实际能取到多少」用**真数字**回答
 *
 * ── 为什么先做这个(用户 2026-09-18 选的 B)──
 *
 * 素材是卷宗(主体 + 附件),但附件能有多厚,决定了后面一整条链的设计:
 * 如果 bio 只有 3 行、上下文只有 48 条,那 Claude 那边收到的卷宗基本是空的,
 * 「综合分析」就无从谈起 —— 得先去补采集,而不是先写判断。
 *
 * ⚠️ **不靠读代码推断**。仓里两条记忆说「x_author 只有 36 行」
 * 「in_reply_to 3782 条里只有 48 条有」,但那是 2026-09 上旬的实测,
 * 之后 `saveAuthorCounts` / `parent_text` 两条写入路径都上线了 ——
 * 现在是多少,**必须真查**(feedback-dont-guess-look-at-real-data)。
 *
 * ── 这个函数只读不写 ──
 *
 * 纯 SELECT COUNT,零写入。跑它不会动你的任何数据,
 * 所以可以在面板上随便点(与执行者同一条纪律)。
 *
 * ── 为什么数「覆盖率」而不只数总量 ──
 *
 * 「x_author 有 N 行」没有意义,「见过 3458 个作者、其中 N 个有 bio」才有意义。
 * 分母是**真正会被判断的那些推的作者**,不是全表。
 */

import { getXDB } from '@storage/surreal/client';

/** 一项附件的盘点结果 */
export interface AttachmentCoverage {
  /** 附件名(与卷宗里的键同名) */
  readonly name: string;
  /** 有这项资料的条数 */
  readonly have: number;
  /** 分母:本来应该有的条数 */
  readonly total: number;
  /** have/total,total 为 0 时是 0(不是 1 —— 没样本不等于全覆盖) */
  readonly rate: number;
  /** 人能读懂的一句话 */
  readonly note: string;
}

export interface DossierInventory {
  /** 库里推文总数 —— 一切分母的基准 */
  readonly tweets: number;
  /** 见过的不同作者数(x_tweet 里 distinct author_handle) */
  readonly authorsSeen: number;
  /** x_author 表里的行数 */
  readonly authorRows: number;
  readonly attachments: readonly AttachmentCoverage[];
  /** 盘点时刻 */
  readonly at: string;
}

/** SurrealDB SDK 已拆掉 result 外壳,所以是 res[i][0].c(实测口径) */
function countOf(res: unknown, i: number): number {
  const rows = (res as Array<Array<{ c?: number }>> | undefined)?.[i];
  return rows?.[0]?.c ?? 0;
}

const pct = (have: number, total: number) => (total > 0 ? have / total : 0);

/**
 * 跑一次盘点。
 *
 * ⚠️ 全部用 `GROUP ALL` 取计数 —— SurrealDB 3.x 下不带 GROUP ALL 的 count()
 * 会按行返回,拿到的是第一行而不是总数。
 */
export async function takeDossierInventory(): Promise<DossierInventory> {
  const db = getXDB();

  const res = await db.query(
    `SELECT count() AS c FROM x_tweet GROUP ALL;
     SELECT count() AS c FROM x_author GROUP ALL;
     SELECT count() AS c FROM x_author WHERE bio != NONE AND bio != '' GROUP ALL;
     SELECT count() AS c FROM x_author WHERE is_blue_verified != NONE GROUP ALL;
     SELECT count() AS c FROM x_author WHERE follows_me != NONE OR i_follow != NONE GROUP ALL;
     SELECT count() AS c FROM x_tweet WHERE parent_text != NONE AND parent_text != '' GROUP ALL;
     SELECT count() AS c FROM x_tweet WHERE in_reply_to != NONE AND in_reply_to != '' GROUP ALL;
     SELECT count() AS c FROM x_tweet WHERE conversation_id != NONE AND conversation_id != '' GROUP ALL;
     SELECT count() AS c FROM x_tweet WHERE replied = true GROUP ALL;
     SELECT count() AS c FROM x_tweet WHERE accepted = true GROUP ALL;`,
  );

  const tweets = countOf(res, 0);
  const authorRows = countOf(res, 1);
  const withBio = countOf(res, 2);
  const withVerified = countOf(res, 3);
  const withRelation = countOf(res, 4);
  const withParent = countOf(res, 5);
  const withInReplyTo = countOf(res, 6);
  const withConversation = countOf(res, 7);
  const replied = countOf(res, 8);
  const accepted = countOf(res, 9);

  // 见过多少不同作者 —— GROUP BY 拿分组数,不能用 count()
  const distinctRes = await db.query(
    `SELECT VALUE author_handle FROM x_tweet WHERE author_handle != NONE GROUP BY author_handle`,
  );
  const authorsSeen = Array.isArray((distinctRes as unknown[])?.[0])
    ? ((distinctRes as unknown[][])[0]).length
    : 0;

  /**
   * ⚠️ 分母的选法说明白:
   *  · 「人」类附件(bio/蓝V/关系)分母是**见过的作者数**,不是 x_author 行数 ——
   *    后者只有「对某人动过作」才建行,拿它当分母会让覆盖率虚高得离谱。
   *  · 「推」类附件(上下文/会话串)分母是推文总数。
   */
  const attachments: AttachmentCoverage[] = [
    {
      name: 'bio',
      have: withBio, total: authorsSeen, rate: pct(withBio, authorsSeen),
      note: withBio === 0
        ? '⚠️ 一条都没有 —— bio 只有「抓单个账号画像」时才写,而那要人手动触发'
        : `${withBio} 人有 bio(见过 ${authorsSeen} 人)`,
    },
    {
      name: '蓝V标记',
      have: withVerified, total: authorsSeen, rate: pct(withVerified, authorsSeen),
      note: withVerified === 0
        ? '⚠️ 一条都没有 —— 「蓝V该不该点赞」这类判断现在没有依据'
        : `${withVerified} 人有蓝V标记`,
    },
    {
      name: '关系(关注/被关注)',
      have: withRelation, total: authorsSeen, rate: pct(withRelation, authorsSeen),
      note: `${withRelation} 人有关系信息`,
    },
    {
      name: '上下文(父推正文)',
      have: withParent, total: tweets, rate: pct(withParent, tweets),
      note: withParent === 0
        ? '⚠️ 一条都没有 —— parent_text 要「取父推」这一步跑过才有'
        : `${withParent} 条推有父推正文`,
    },
    {
      name: '上下文(父推 id)',
      have: withInReplyTo, total: tweets, rate: pct(withInReplyTo, tweets),
      note: `${withInReplyTo} 条推有 in_reply_to`,
    },
    {
      name: '会话串 id',
      have: withConversation, total: tweets, rate: pct(withConversation, tweets),
      note: withConversation === 0
        ? '⚠️ 一条都没有 —— 没有 conversation_id 就串不起同一串的前后文'
        : `${withConversation} 条推有 conversation_id`,
    },
    {
      name: '我们回过没',
      have: replied, total: tweets, rate: pct(replied, tweets),
      note: `${replied} 条回过、${accepted} 条被采纳`,
    },
  ];

  return {
    tweets, authorsSeen, authorRows, attachments,
    at: new Date().toISOString(),
  };
}
