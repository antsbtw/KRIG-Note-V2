/**
 * ⭐ 查 `x_tweet` 核对落库结果 —— 不靠截图,直接问库。
 *
 * 用法:node scripts/x-tweet-check.mjs
 * ⚠️ 要 app 在跑(库由 app 起)。凭据从 userData/.db-credentials 读。
 */
import { Surreal } from 'surrealdb';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CRED = join(homedir(), 'Library/Application Support/KRIG Note V2/.db-credentials');
const { username, password } = JSON.parse(readFileSync(CRED, 'utf-8'));

const db = new Surreal();
try {
  await db.connect('ws://127.0.0.1:8533/rpc');
  await db.signin({ username, password });
  await db.use({ namespace: 'krig', database: 'krig_x' });

  const [[total]] = await db.query('SELECT count() AS n FROM x_tweet GROUP ALL');
  console.log(`x_tweet 总行数: ${total?.n ?? 0}`);

  /** ⭐ 五维各自有没有真落下来 —— 「不量的字段永远 100%」 */
  /**
   * ⭐ 五维各自有没有真落下来 —— 「不量的字段永远 100%」。
   * ⚠️ 别名用英文:SurrealQL **不认中文标识符**(Parse error: Invalid token)。
   */
  const [rows] = await db.query(`
    SELECT
      count() AS n,
      count(string::len(text) > 0)     AS has_text,
      count(array::len(media) > 0)     AS has_media,
      count(array::len(links) > 0)     AS has_links,
      count(array::len(hashtags) > 0)  AS has_tags,
      count(array::len(mentions) > 0)  AS has_mentions,
      count(created_at != NONE)        AS has_created,
      count(metrics_at != NONE)        AS has_metrics_at,
      count(following != NONE)         AS has_relation
    FROM x_tweet GROUP ALL`);
  const LABEL = {
    has_text: '有正文', has_media: '有媒体', has_links: '有外链',
    has_tags: '有标签', has_mentions: '有提及', has_created: '有发布时间',
    has_metrics_at: '有互动时刻', has_relation: '有关系',
  };
  const r = rows?.[0] ?? {};
  console.log('\n五维落库情况:');
  for (const [k, v] of Object.entries(r)) {
    if (k === 'n') continue;
    console.log(`  ${(LABEL[k] ?? k).padEnd(10)} ${v} / ${r.n}`);
  }

  /** ⭐⭐ 正文最长的几条 —— 长文正文有没有真的存进去 */
  const [longest] = await db.query(
    'SELECT tweet_id, author_handle, string::len(text) AS len FROM x_tweet ORDER BY len DESC LIMIT 5',
  );
  console.log('\n正文最长的 5 条:');
  for (const t of longest ?? []) console.log(`  ${t.len} 字  @${t.author_handle}  ${t.tweet_id}`);

  /** ⚠️ 重采是否真的更新了 —— 看 fetched_at,不看总数 */
  const [fresh] = await db.query(
    'SELECT count() AS n FROM x_tweet WHERE fetched_at > time::now() - 10m GROUP ALL',
  );
  console.log(`\n最近 10 分钟碰过的行: ${fresh?.[0]?.n ?? 0}`);
  console.log('⭐ 判据:重采后这个数该涨,而**总行数可以不变** ——');
  console.log('   「库里总数不变」证明不了「没入库」(upsert 更新时总数本来就不变)');
} catch (e) {
  console.error('查库失败:', String(e).slice(0, 120));
  console.error('⚠️ app 在跑吗?库由 app 启动。');
} finally {
  await db.close();
}
