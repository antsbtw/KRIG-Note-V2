/**
 * ⭐ 查 `x_author` 核对「采人」落库结果 —— **不靠截图,直接问库**。
 *
 * 用法:node scripts/x-user-check.mjs
 * ⚠️ 要 app 在跑(库由 app 起)。凭据从 userData/.db-credentials 读。
 *
 * ⭐⭐ 为什么有这个脚本:用户 2026-10-04 的原话 ——
 * 「我的建议是你在底层有读取数据的能力,而不是靠我截图,否则效率会差很多。」
 * ⚠️ 判据是「下次验证能不能不靠人、只靠留下的东西说清楚」。
 */
import { Surreal } from 'surrealdb';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CRED = join(homedir(), 'Library/Application Support/KRIG Note V2/.db-credentials');
const { username, password } = JSON.parse(readFileSync(CRED, 'utf-8'));

/**
 * ⭐⭐⭐ **app 没跑就立刻说清楚** —— 不要静默挂着。
 *
 * ⚠️⚠️ 2026-10-05 实测:app 没启动时 `db.connect` **不报错也不返回**,
 * 脚本就那么吊着,只在最后吐一句
 * 「Warning: Detected unsettled top-level await」——
 * 而那句话长得**完全不像**「app 没开」。
 * ⭐ 又是这一族:等不到的东西要有超时,
 * 而超时的话要说**人能照着做的下一步**,不是报一个 socket 错误。
 */
const CONNECT_TIMEOUT_MS = 8000;

const db = new Surreal();
try {
  await Promise.race([
    db.connect('ws://127.0.0.1:8533/rpc'),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(
        `连不上库(等了 ${CONNECT_TIMEOUT_MS / 1000}s)—— `
        + 'app 没在跑吧?库是 app 起的,先把 app 打开再跑本脚本。',
      )),
      CONNECT_TIMEOUT_MS,
    )),
  ]);
  await db.signin({ username, password });
  await db.use({ namespace: 'krig', database: 'krig_x' });

  const [[total]] = await db.query('SELECT count() AS n FROM x_author GROUP ALL');
  console.log(`x_author 总行数: ${total?.n ?? 0}`);

  /**
   * ⭐ 各字段有没有真落下来 —— 「**不量的字段永远 100%**」。
   * ⚠️ 别名用英文:SurrealQL **不认中文标识符**(Parse error: Invalid token)。
   * ⚠️⚠️ 判 option 字段要写 `IS NOT NONE` —— HTTP 返回 NONE 和 NULL
   * 都显示 null,**肉眼分不出**(project-x-handle-normalize 的附注)。
   */
  const [rows] = await db.query(`
    SELECT
      count() AS n,
      count(rest_id IS NOT NONE)          AS has_rest_id,
      count(display_name IS NOT NONE)     AS has_name,
      count(bio IS NOT NONE)              AS has_bio,
      count(avatar IS NOT NONE)           AS has_avatar,
      count(location IS NOT NONE)         AS has_location,
      count(followers_count IS NOT NONE)  AS has_followers,
      count(following_count IS NOT NONE)  AS has_following,
      count(list_source IS NOT NONE)      AS has_list_source,
      count(list_seq IS NOT NONE)         AS has_list_seq,
      count(fetched_at IS NOT NONE)       AS has_fetched_at,
      count(account_created_at IS NOT NONE) AS has_account_created
    FROM x_author GROUP ALL`);
  const LABEL = {
    has_rest_id: '有数字id', has_name: '有名字', has_bio: '有bio',
    has_avatar: '有头像', has_location: '有地点', has_followers: '有粉丝数',
    has_following: '有关注数', has_list_source: '有名单来源',
    has_list_seq: '有名次', has_fetched_at: '有采集时刻',
    has_account_created: '有注册时间',
  };
  const r = rows?.[0] ?? {};
  console.log('\n字段落库情况:');
  for (const [k, v] of Object.entries(r)) {
    if (k === 'n') continue;
    console.log(`  ${(LABEL[k] ?? k).padEnd(12)} ${v} / ${r.n}`);
  }

  /**
   * ⭐⭐ 按名单来源分组 —— 「这一跑采的是哪个名单、采了多少」。
   */
  const [bySrc] = await db.query(
    'SELECT list_source, count() AS n FROM x_author GROUP BY list_source',
  );
  console.log('\n按名单来源:');
  for (const g of bySrc ?? []) {
    console.log(`  ${String(g.list_source ?? '(无)').padEnd(20)} ${g.n}`);
  }

  /**
   * ⭐⭐⭐ **业务字段还在不在** —— 这张表最怕的就是被采集覆盖。
   * ⚠️ 屏蔽名单和追踪名单是人点出来的,覆盖掉**不可逆**。
   */
  const [[biz]] = await db.query(`
    SELECT
      count(blocked = true) AS blocked,
      count(watched = true) AS watched,
      count(is_self = true) AS self,
      count(note IS NOT NONE) AS noted
    FROM x_author GROUP ALL`);
  console.log('\n业务字段(采集绝不许碰):');
  console.log(`  屏蔽 ${biz?.blocked ?? 0} / 追踪 ${biz?.watched ?? 0}`
    + ` / 本人 ${biz?.self ?? 0} / 有备注 ${biz?.noted ?? 0}`);

  /**
   * ⭐⭐ `list_memberships` 累加对不对 —— 在多个名单里的人。
   * ⚠️ 覆盖掉的是**证据**(schema 1.2.4 的原话)。
   */
  const [multi] = await db.query(
    'SELECT handle, list_memberships FROM x_author'
    + ' WHERE array::len(list_memberships) > 1 LIMIT 5',
  );
  console.log(`\n在多个名单里的人(前 5):${(multi ?? []).length === 0 ? ' 暂无' : ''}`);
  for (const u of multi ?? []) {
    console.log(`  @${u.handle}  ${JSON.stringify(u.list_memberships)}`);
  }

  /**
   * ⭐⭐⭐ **handle 归一化对不对** —— 带 @ 或带大写就是漂了。
   * ⚠️ 漂的表现是「屏蔽点了没反应**且不报错**」。
   */
  const [bad] = await db.query(
    "SELECT handle FROM x_author WHERE handle != string::lowercase(handle)"
    + " OR string::starts_with(handle, '@') LIMIT 5",
  );
  console.log(`\nhandle 没归一化的: ${(bad ?? []).length}`
    + ((bad ?? []).length > 0 ? ` ⚠️ ${(bad ?? []).map((b) => b.handle).join(', ')}` : ' ✓'));

  /**
   * ⭐⭐ 最近采的几个人 —— 肉眼看一眼字段齐不齐。
   * ⚠️ `fetched_at` 排序:**库里总数不变证明不了「没入库」**,
   * 要看 fetched_at 变没变(我拿总数错判过三轮)。
   */
  const [recent] = await db.query(
    'SELECT handle, display_name, rest_id, followers_count, list_source, list_seq, fetched_at'
    + ' FROM x_author WHERE fetched_at IS NOT NONE ORDER BY fetched_at DESC LIMIT 8',
  );
  console.log('\n最近采到的 8 个人:');
  for (const u of recent ?? []) {
    console.log(`  seq${String(u.list_seq ?? '?').padStart(4)}`
      + `  @${String(u.handle).padEnd(20)}`
      + `  ${String(u.display_name ?? '(无名)').slice(0, 12).padEnd(14)}`
      + `  粉 ${String(u.followers_count ?? '?').padStart(8)}`
      + `  id ${u.rest_id ?? '(无)'}`
      + `  ${u.list_source ?? ''}`);
  }
} catch (e) {
  /** ⚠️ fail loud:连不上就把原因**原样**印出来,别让它看着像「库里 0 行」 */
  console.error(`\n⚠️ ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
