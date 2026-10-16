/**
 * ⭐⭐ 把人表上**旧的关系**(全库一份的 i_follow / follows_me)迁到关系表,记到它真正所属的号名下(2026-10-16,1.2.27)
 *
 * 用户 10-16:现有关系(互关蓝V 4878 等)属于「antsBTW/otun_myvpn(旧名称)」—— 现名 antsBTW;netlab2gfw 已被封。
 *
 * 用法(⚠️ 要 app 在跑、已重启过让迁移 1.2.27 建好 x_relation,且运营面板已**认号**拿到 otun_myvpn 的数字 id):
 *   npx tsx scripts/x-migrate-relation-to-account.ts --expect-handle=antsbtw            # 只看(默认)
 *   npx tsx scripts/x-migrate-relation-to-account.ts --expect-handle=antsbtw --apply    # 真写
 *   可选 --ws=ws-1(默认 ws-1);DBN 环境变量指定别的 database(演练用)
 *
 * ── 守着的几件事 ──
 * ① 号从 x_ws_account 读(认号写进去的),**必须与 --expect-handle 一致**才动手 —— 迁错号比不迁更坏
 * ② 观察时间 = 人表那一行的 fetched_at;关系表里已有更新的观察就不覆盖(与实时写入同一个纯函数 buildRelationUpsert)
 * ③ 自己与自己不建关系;两个标记都没有的人跳过
 * ④ 人表上的旧字段**不清空**(留作对照;已经没有代码读它们)
 * ⑤ 写完对账:关系表里这个号的行数、各分组人数 与 人表旧字段 逐组比
 * ⑥ 同时在关系变化表(1.2.28)记**基线**(source = migration)—— 与实时写入同一个纯函数;重跑关系没变就不再记
 * ⚠️ 用 CJS(main 函数,不用顶层 await)—— .mts 会让 SDK 双包,RecordId 被编成 {}。
 */
import { Surreal } from 'surrealdb';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildRelationChange, buildRelationUpsert, type RelationRowBefore } from '../src/modules/x/x-account';
import { buildOverviewQuery, parseOverview, PEOPLE_GROUPS } from '../src/modules/x/x-people-query';

const APPLY = process.argv.includes('--apply');
const arg = (k: string): string | undefined => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const WS = arg('ws') ?? 'ws-1';
const EXPECT = arg('expect-handle')?.toLowerCase();
const DBN = process.env.DBN ?? 'krig_x';
const PORT = process.env.PORT_DB ?? '8533';

type Legacy = { rest_id: string; i_follow?: boolean; follows_me?: boolean; fetched_at?: { toISOString?: () => string } | string };

async function main(): Promise<void> {
  if (!EXPECT) throw new Error('必须给 --expect-handle=<这份关系所属的号>(用户 10-16:antsBTW,旧名 otun_myvpn)—— 防止迁错号');
  const cred = JSON.parse(readFileSync(join(homedir(), 'Library/Application Support/KRIG Note V2/.db-credentials'), 'utf-8'));
  const db = new Surreal();
  await Promise.race([
    db.connect(`ws://127.0.0.1:${PORT}/rpc`),
    new Promise((_, reject) => setTimeout(() => reject(new Error('连不上库(8s)—— app 没在跑?')), 8000)),
  ]);
  try {
    await db.signin({ username: cred.username, password: cred.password });
    await db.use({ namespace: 'krig', database: DBN });

    const [[acc]] = await db.query<[Array<{ handle: string; rest_id?: string }>]>(
      "SELECT handle, rest_id FROM type::record('x_ws_account', $ws)", { ws: WS },
    );
    if (!acc) throw new Error(`${WS} 还没认号(x_ws_account 没有这一行)—— 先在运营面板点「认号」`);
    if (acc.handle !== EXPECT) throw new Error(`${WS} 认到的是 @${acc.handle},不是 --expect-handle=@${EXPECT} —— 不迁(迁错号比不迁更坏)`);
    if (!acc.rest_id) throw new Error(`${WS} 的 @${acc.handle} 还没数字 id —— 先在运营面板点「认号」`);
    const account = acc.rest_id;
    console.log(`号:${WS} @${acc.handle}(${account})· database ${DBN} · ${APPLY ? '真写' : '只看'}`);

    const [rows] = await db.query<[Legacy[]]>(
      `SELECT rest_id, i_follow, follows_me, fetched_at FROM x_author
         WHERE rest_id != NONE AND (i_follow != NONE OR follows_me != NONE)`,
    );
    const legacy = rows ?? [];
    let written = 0; let skipped = 0; let noTime = 0; let changed = 0;
    const failed: string[] = [];
    for (const r of legacy) {
      const f = r.fetched_at;
      const at = typeof f === 'string' ? f : f?.toISOString?.();
      if (!at) { noTime += 1; continue; }
      const o = { person: r.rest_id, iFollow: r.i_follow ?? undefined, followsMe: r.follows_me ?? undefined, observedAt: at };
      const q = buildRelationUpsert(account, o);
      if (q === null) { skipped += 1; continue; }
      if (!APPLY) { written += 1; continue; }
      try {
        const [b] = await db.query<[RelationRowBefore[]]>(q.sql, q.vars);
        written += 1;
        const got = b?.[0];
        const c = buildRelationChange(account, got === undefined ? null : got, o, 'migration');
        if (c !== null) { await db.query(c.sql, c.vars); changed += 1; }
      } catch (e) { failed.push(`${r.rest_id}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    console.log(`人表带旧关系 ${legacy.length} 人 → ${APPLY ? '写入' : '将写入'} ${written}${APPLY ? `(变化记录 ${changed})` : ''} / 跳过(自己或两标记皆空)${skipped}`
      + ` / 没有观察时间 ${noTime}${failed.length > 0 ? ` / ⚠️ 失败 ${failed.length}:${failed[0]}` : ''}`);
    if (!APPLY) { console.log('(只看模式,没写。加 --apply 真写)'); return; }

    /** ⑤ 对账:新(按号)vs 旧(人表字段),逐组比 */
    const ov = buildOverviewQuery(account);
    const now = parseOverview(await db.query<unknown[]>(ov.sql, ov.vars));
    const oldSql = ov.sql.replace(/FROM \(SELECT[\s\S]*FROM x_author\)/, 'FROM x_author');
    const before = parseOverview(await db.query<unknown[]>(oldSql));
    let diff = 0;
    for (const g of PEOPLE_GROUPS) {
      const a = before[g.id]; const b = now[g.id];
      const same = a.total === b.total && a.blue === b.blue;
      if (!same) diff += 1;
      console.log(`  ${g.label.padEnd(10)} 旧 ${a.total}/${a.blue}  新 ${b.total}/${b.blue} ${same ? '✓' : '⚠️'}`);
    }
    const [[cnt]] = await db.query<[Array<{ n: number }>]>('SELECT count() AS n FROM x_relation WHERE account = $a GROUP ALL', { a: account });
    console.log(`关系表里 @${acc.handle} 的行数 ${cnt?.n ?? 0}(应 = 写入 ${written},若之前已有新观察则相同人只一行)`);
    console.log(diff === 0 ? '对账 ✓ 各组人数一致' : `⚠️ ${diff} 组不一致 —— 可能是认号后已有新观察(更新的关系没被旧值覆盖),逐个看再说`);
  } finally {
    await db.close();
  }
}

main().catch((e) => { console.error('ERR', e instanceof Error ? e.message : String(e)); process.exit(1); });
