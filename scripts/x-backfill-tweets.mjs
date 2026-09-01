#!/usr/bin/env node
/**
 * A 期存量回填:tweet_inbox + tweet_feedback → x_tweet
 *
 * 两个来源,优先级不同:
 *   ① tweet_inbox 现存行 —— 字段最全(metrics / url / 作者名 / ai_verdict),整行搬
 *   ② tweet_feedback 的采纳记录 —— 只有 9 个字段,没有 metrics/url/author_name。
 *      仅对 ① 里没有的 tweet_id 补建**骨架行**,标 backfilled=true 与真实采集区分。
 *
 * ⚠️ 骨架行是"知道采纳过但正文/互动数据已丢"的残缺记录,不是完整推文。
 *    标 backfilled 就是为了让将来做画像时能把它们和完整数据分开统计,
 *    别把残缺当完整用。
 *
 * 用法(app 必须先退出):
 *   node scripts/x-backfill-tweets.mjs          # 预检
 *   node scripts/x-backfill-tweets.mjs --run    # 真回填
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const USER_DATA = path.join(os.homedir(), 'Library/Application Support/KRIG Note V2');
const DB_DIR = path.join(USER_DATA, 'krig-data/surreal');
const CRED_PATH = path.join(USER_DATA, '.db-credentials');
const PORT = 8533;
const X_DB = 'krig_x';

const DRY_RUN = !process.argv.includes('--run');
const { username, password } = JSON.parse(readFileSync(CRED_PATH, 'utf-8'));
const AUTH = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

async function sql(query) {
  const res = await fetch(`http://127.0.0.1:${PORT}/sql`, {
    method: 'POST',
    headers: { Authorization: AUTH, Accept: 'application/json', 'surreal-ns': 'krig', 'surreal-db': X_DB },
    body: query,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  for (const st of json) {
    if (st.status !== 'OK') {
      throw new Error(`SQL failed: ${st.status} ${JSON.stringify(st.result)}\n  query: ${query.slice(0, 200)}`);
    }
  }
  return json.map((s) => s.result);
}

/** datetime 字段必须写成 d'...' 字面量 —— HTTP 读出来是普通字符串,直接写回会被拒 */
const DT = new Set(['fetched_at', 'created_at', 'expires_at', 'accepted_at', 'replied_at']);
function toSurql(obj) {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;   // 不写 → NONE(绝不写 NULL)
    parts.push(`${JSON.stringify(k)}: ${DT.has(k) && typeof v === 'string' ? 'd' + JSON.stringify(v) : JSON.stringify(v)}`);
  }
  return `{ ${parts.join(', ')} }`;
}

async function isUp() {
  try { return (await fetch(`http://127.0.0.1:${PORT}/health`)).ok; } catch { return false; }
}

async function startSidecar() {
  if (await isUp()) {
    throw new Error(`端口 ${PORT} 已有 surreal —— app 还没退出。回填期间 app 在跑会与采集写入冲突,请先退出。`);
  }
  for (const c of ['/opt/homebrew/bin/surreal', '/usr/local/bin/surreal']) {
    if (!existsSync(c)) continue;
    const proc = spawn(c, ['start', '--bind', `127.0.0.1:${PORT}`, '--username', username,
      '--password', password, '--log', 'warn', `rocksdb://${DB_DIR}`],
      { stdio: ['ignore', 'ignore', 'inherit'] });
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (await isUp()) return proc;
      await new Promise((r) => setTimeout(r, 300));
    }
    proc.kill('SIGKILL');
    throw new Error('sidecar 20s 内没起来');
  }
  throw new Error('surreal binary not found');
}

let proc = null;
let failed = false;
try {
  console.log(`模式: ${DRY_RUN ? '预检(不写)' : '真回填'}\n`);
  proc = await startSidecar();

  const [inboxRows] = await sql(`SELECT * FROM tweet_inbox ORDER BY id ASC;`);
  const [acceptedFb] = await sql(
    `SELECT * FROM tweet_feedback WHERE verdict = 'accept' ORDER BY created_at DESC;`);
  const [xtBefore] = await sql(`SELECT count() FROM x_tweet GROUP ALL;`);

  // 采纳集合(去重:同一 tweet 可能被标注多次,取最新一条)
  const acceptedById = new Map();
  for (const fb of acceptedFb) {
    if (!acceptedById.has(fb.tweet_id)) acceptedById.set(fb.tweet_id, fb);
  }
  const inboxIds = new Set(inboxRows.map((r) => r.tweet_id));
  const skeletonOnly = [...acceptedById.keys()].filter((id) => !inboxIds.has(id));

  console.log(`① tweet_inbox 现存行      : ${inboxRows.length}`);
  console.log(`   其中已采纳(会置永久)   : ${inboxRows.filter((r) => acceptedById.has(r.tweet_id)).length}`);
  console.log(`② tweet_feedback 去重采纳 : ${acceptedById.size}`);
  console.log(`   需补骨架行(inbox 已无) : ${skeletonOnly.length}`);
  console.log(`   ⚠️ 骨架行无 metrics/url/作者名 —— 那些数据已随 TTL 永久丢失`);
  console.log(`③ x_tweet 现有行           : ${xtBefore[0]?.count ?? 0}`);
  console.log(`   预计回填后             : ${(xtBefore[0]?.count ?? 0) + inboxRows.length + skeletonOnly.length}`);

  if (DRY_RUN) {
    console.log('\n预检结束。加 --run 执行真回填。');
  } else {
    console.log('\n开始回填...');
    let n1 = 0, n2 = 0;

    // ① inbox 整行搬(字段最全)
    for (const r of inboxRows) {
      const { id, author_name, ...rest } = r;
      const isAccepted = acceptedById.has(r.tweet_id);
      const row = {
        ...rest,
        author_name_at_post: author_name || undefined,
        replied: r.status === 'replied',
        backfilled: true,
        ...(isAccepted
          ? {
              accepted: true,
              accepted_at: acceptedById.get(r.tweet_id).created_at,
              expires_at: undefined,
              // 同上:采纳过的行 ai_verdict 必须是 human:*,否则会回到「Gemma建议」待表态列表
              ai_verdict: { worth: true, confidence: 1, reason: 'human:accept', tags: [], suggestReply: true },
            }
          : {}),
      };
      // 采纳行:显式不带 expires_at → NONE → 永久保留
      if (isAccepted) delete row.expires_at;
      await sql(`INSERT IGNORE INTO x_tweet ${toSurql(row)};`);
      n1++;
    }
    console.log(`   ① inbox 搬入 ${n1} 行`);

    // ② 骨架行(只有 feedback 的 9 字段)
    for (const tid of skeletonOnly) {
      const fb = acceptedById.get(tid);
      await sql(`INSERT IGNORE INTO x_tweet ${toSurql({
        tweet_id: fb.tweet_id,
        author_handle: fb.author_handle || '@unknown',
        text: fb.text || '',
        lang: fb.lang,
        metrics: {},
        fetched_at: fb.created_at,     // 真实抓取时刻已丢,用标注时刻近似
        source: 'search',
        search_recipe: fb.source_recipe,
        status: 'worth',
        filter_score: 1.0,
        // ⚠️ 必须写成 human:accept,**不能**留 Gemma 原判快照。
        // UI 的「Gemma建议」视图筛的是 status='worth' 且 ai_verdict.reason 不以 human: 开头
        // (XInboxView.tsx:22)—— 留着 Gemma 原判,617 条早就采纳过的历史推文会全部
        // 冒充成"待你表态的新建议"涌进收件箱。踩过一次,别再改回去。
        // Gemma 原判快照的真源在 tweet_feedback.ai_verdict(migration 1.8.7),不在这里,覆盖无损失。
        ai_verdict: { worth: true, confidence: 1, reason: 'human:accept', tags: [], suggestReply: true },
        accepted: true,
        accepted_at: fb.created_at,
        replied: false,
        backfilled: true,
        // expires_at 不写 → NONE → 永久
      })};`);
      n2++;
      if (n2 % 100 === 0) process.stdout.write(`\r   ② 骨架行 ${n2}/${skeletonOnly.length} ...`);
    }
    console.log(`\n   ② 骨架行补入 ${n2} 行`);

    // 对账
    const [xtAfter] = await sql(`SELECT count() FROM x_tweet GROUP ALL;`);
    const [permanent] = await sql(`SELECT count() FROM x_tweet WHERE expires_at = NONE GROUP ALL;`);
    const [acceptedCnt] = await sql(`SELECT count() FROM x_tweet WHERE accepted = true GROUP ALL;`);
    const expected = (xtBefore[0]?.count ?? 0) + n1 + n2;
    const actual = xtAfter[0]?.count ?? 0;

    console.log('\n对账:');
    console.log(`   x_tweet 行数      : ${actual}  (预期 ${expected})  ${actual === expected ? '✓' : '✗'}`);
    console.log(`   expires_at=NONE   : ${permanent[0]?.count ?? 0}  (永久保留行)`);
    console.log(`   accepted=true     : ${acceptedCnt[0]?.count ?? 0}  (应 ≈ ${acceptedById.size})`);

    if (actual !== expected) throw new Error('行数对不上 —— 检查是否有 tweet_id 唯一索引冲突被 IGNORE 掉');
    console.log('\n✓ 回填完成');
  }
} catch (err) {
  console.error(`\n✗ ${err.message}`);
  failed = true;
} finally {
  if (proc) {
    proc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 800));
    try { proc.kill('SIGKILL'); } catch { /* 已退 */ }
  }
  if (failed) process.exit(1);
}
