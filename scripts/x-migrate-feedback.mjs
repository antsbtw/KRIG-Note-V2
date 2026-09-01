#!/usr/bin/env node
/**
 * 0 期一次性迁移:krig_note_v2.tweet_feedback → krig_x.tweet_feedback
 *
 * 为什么是离线脚本而不是 app 内 IPC:
 *   app 不跑 = X 采集不可能写入 = 基准是死数字。对账才有意义。
 *   (采集在跑时每次查 count 都不一样,"迁移前后行数一致"根本无法证明。)
 *
 * 用法:**先完全退出 app**,然后
 *   node scripts/x-migrate-feedback.mjs            # 预检:只查数字,不写
 *   node scripts/x-migrate-feedback.mjs --run      # 真迁移
 *
 * 本脚本自己拉起 surreal sidecar(app 退出后它也没了),跑完自己关掉。
 * 不删任何源数据 —— 删旧表是独立的一步,用户确认后单独做。
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const USER_DATA = path.join(os.homedir(), 'Library/Application Support/KRIG Note V2');
const DB_DIR = path.join(USER_DATA, 'krig-data/surreal');
const CRED_PATH = path.join(USER_DATA, '.db-credentials');
const PORT = 8533;
const NS = 'krig';
const NOTE_DB = 'krig_note_v2';
const X_DB = 'krig_x';
const PAGE = 500;

const DRY_RUN = !process.argv.includes('--run');

const { username, password } = JSON.parse(readFileSync(CRED_PATH, 'utf-8'));
const AUTH = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

/** 对指定 db 发一条 SQL,返回第一条语句的 result。非 OK 一律 throw(fail loud)。 */
async function sql(db, query) {
  const res = await fetch(`http://127.0.0.1:${PORT}/sql`, {
    method: 'POST',
    headers: {
      Authorization: AUTH,
      Accept: 'application/json',
      'surreal-ns': NS,
      'surreal-db': db,
    },
    body: query,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  for (const stmt of json) {
    if (stmt.status !== 'OK') {
      throw new Error(`SQL failed on ${db}: ${stmt.status} ${JSON.stringify(stmt.result)}\n  query: ${query.slice(0, 200)}`);
    }
  }
  return json[0].result;
}

/**
 * datetime 字段名单 —— 这些字段必须序列化成 SurrealQL 的 d'...' 字面量。
 *
 * ⚠️ 踩过:HTTP /sql 端点把 datetime 读出来是**普通 JSON 字符串**,
 * 直接 JSON.stringify 回去写进 TYPE datetime 字段会被拒:
 *   Expected `datetime` but found `'2026-07-31T22:04:50.585Z'`
 * (JSON 没有 datetime 类型,信息在读出那一刻就丢了,只能靠字段名补回来。)
 */
const DATETIME_FIELDS = new Set(['created_at']);

/** 把一行对象序列化成 SurrealQL object 字面量,datetime 字段特殊处理 */
function toSurql(obj, datetimeFields) {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;               // undefined → 不写 → NONE(不是 NULL)
    if (datetimeFields.has(k) && typeof v === 'string') {
      parts.push(`${JSON.stringify(k)}: d${JSON.stringify(v)}`);
    } else {
      parts.push(`${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    }
  }
  return `{ ${parts.join(', ')} }`;
}

async function count(db, table) {
  const r = await sql(db, `SELECT count() FROM ${table} GROUP ALL;`);
  return r[0]?.count ?? 0;
}

// ── sidecar 启停 ───────────────────────────────────────────────

function findBinary() {
  for (const c of ['/opt/homebrew/bin/surreal', '/usr/local/bin/surreal']) {
    if (existsSync(c)) return c;
  }
  throw new Error('surreal binary not found');
}

async function isUp() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/health`);
    return r.ok;
  } catch { return false; }
}

async function startSidecar() {
  if (await isUp()) {
    throw new Error(
      `端口 ${PORT} 上已有 surreal 在跑 —— 说明 app 还没退出。\n` +
      `迁移必须在 app 完全退出后进行,否则采集会在迁移途中写入,行数对账失去意义。\n` +
      `请先退出 app 再重跑本脚本。`,
    );
  }
  const proc = spawn(findBinary(), [
    'start', '--bind', `127.0.0.1:${PORT}`,
    '--username', username, '--password', password,
    '--log', 'warn', `rocksdb://${DB_DIR}`,
  ], { stdio: ['ignore', 'ignore', 'inherit'], detached: false });

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await isUp()) return proc;
    await new Promise((r) => setTimeout(r, 300));
  }
  proc.kill('SIGKILL');
  throw new Error('surreal sidecar 15s 内没起来');
}

// ── 主流程 ─────────────────────────────────────────────────────

let proc = null;
let failed = false;
try {
  console.log(`模式: ${DRY_RUN ? '预检(不写)' : '真迁移'}`);
  proc = await startSidecar();
  console.log(`sidecar 已启动 (pid=${proc.pid})\n`);

  // ① 基准:源表行数(app 已退出,这是死数字)
  const before = await count(NOTE_DB, 'tweet_feedback');
  console.log(`① 迁移前 源表 ${NOTE_DB}.tweet_feedback = ${before} 行`);

  // verdict 分布,迁移后要逐项比对(总数对上但分布错了同样是坏迁移)
  const distBefore = await sql(NOTE_DB, `SELECT verdict, count() FROM tweet_feedback GROUP BY verdict;`);
  console.log(`   verdict 分布: ${JSON.stringify(distBefore)}`);
  const aiBefore = (await sql(NOTE_DB, `SELECT count() FROM tweet_feedback WHERE ai_verdict IS NOT NONE GROUP ALL;`))[0]?.count ?? 0;
  console.log(`   带 ai_verdict 快照: ${aiBefore} 行`);

  const xExisting = await count(X_DB, 'tweet_feedback');
  console.log(`   目标表 ${X_DB}.tweet_feedback 现有 = ${xExisting} 行`);
  if (xExisting > 0 && !DRY_RUN) {
    throw new Error(
      `目标表非空(${xExisting} 行)。拒绝在非空表上迁移 —— 会造成重复行,而重复行让对账失效。\n` +
      `若是上次迁移的残留,先手工清空 krig_x.tweet_feedback 再重跑。`,
    );
  }

  if (DRY_RUN) {
    console.log('\n预检结束。加 --run 执行真迁移。');
  } else {
    // ② 分页搬运。游标用 id 排序而非 OFFSET:
    //    OFFSET 分页在底层有变动时会漏行/重行;id 游标是稳定的。
    console.log('\n② 开始迁移...');
    let cursor = null;
    let moved = 0;
    for (;;) {
      const where = cursor ? `WHERE id > ${cursor}` : '';
      const rows = await sql(
        NOTE_DB,
        `SELECT * FROM tweet_feedback ${where} ORDER BY id ASC LIMIT ${PAGE};`,
      );
      if (rows.length === 0) break;

      // 逐行 CREATE 到目标库,**保留原 record id**(同表名同 id,便于事后核对)。
      // 注:content 里不含 id 字段本身 —— id 走 CREATE 的目标位,
      // 绝不把 id 当普通字段写(会撞内建 record id 的 readonly 语义)。
      for (const r of rows) {
        const { id, ...rest } = r;
        await sql(X_DB, `CREATE ${id} CONTENT ${toSurql(rest, DATETIME_FIELDS)};`);
      }
      moved += rows.length;
      cursor = rows[rows.length - 1].id;
      process.stdout.write(`\r   已迁 ${moved}/${before} ...`);
    }
    console.log(`\n   迁移完成,写入 ${moved} 行`);

    // ③ 对账
    console.log('\n③ 对账:');
    const afterSrc = await count(NOTE_DB, 'tweet_feedback');
    const afterDst = await count(X_DB, 'tweet_feedback');
    console.log(`   迁移前 源表 = ${before}`);
    console.log(`   迁移后 源表 = ${afterSrc}  ${afterSrc === before ? '✓ 未变(证明采集确实停了)' : '✗ 变了!'}`);
    console.log(`   迁移后 目标 = ${afterDst}  ${afterDst === before ? '✓ 与基准一致' : '✗ 不一致!'}`);

    const distAfter = await sql(X_DB, `SELECT verdict, count() FROM tweet_feedback GROUP BY verdict;`);
    const aiAfter = (await sql(X_DB, `SELECT count() FROM tweet_feedback WHERE ai_verdict IS NOT NONE GROUP ALL;`))[0]?.count ?? 0;
    const norm = (d) => JSON.stringify([...d].sort((a, b) => a.verdict.localeCompare(b.verdict)));
    const distOk = norm(distBefore) === norm(distAfter);
    console.log(`   verdict 分布: ${JSON.stringify(distAfter)}  ${distOk ? '✓' : '✗ 与源不符!'}`);
    console.log(`   ai_verdict 快照: ${aiAfter}  ${aiAfter === aiBefore ? '✓' : '✗ 丢了 ' + (aiBefore - aiAfter) + ' 条!'}`);

    if (afterSrc !== before || afterDst !== before || !distOk || aiAfter !== aiBefore) {
      throw new Error('对账失败 —— 不要删任何源数据,先查上面标 ✗ 的项。');
    }

    // ④ 抽样字段级比对:总数对上不代表内容没被 schema 吃掉。
    //    重点看 ai_verdict(FLEXIBLE object,跨库最容易丢子字段)和 created_at(datetime)。
    console.log('\n④ 抽样字段比对(20 条,优先取带 ai_verdict 的):');
    const sample = await sql(
      NOTE_DB,
      `SELECT * FROM tweet_feedback WHERE ai_verdict IS NOT NONE ORDER BY id ASC LIMIT 20;`,
    );
    let diffs = 0;
    for (const src of sample) {
      const dst = (await sql(X_DB, `SELECT * FROM ${src.id};`))[0];
      if (!dst) { console.log(`   ✗ ${src.id} 目标库找不到`); diffs++; continue; }
      for (const k of Object.keys(src)) {
        if (k === 'id') continue;
        if (JSON.stringify(src[k]) !== JSON.stringify(dst[k])) {
          console.log(`   ✗ ${src.id}.${k}: 源=${JSON.stringify(src[k])} 目标=${JSON.stringify(dst[k])}`);
          diffs++;
        }
      }
    }
    console.log(`   比对 ${sample.length} 条 × 全字段 → ${diffs === 0 ? '✓ 全部一致' : `✗ ${diffs} 处不一致`}`);
    if (diffs > 0) throw new Error('抽样比对不一致 —— 不要删源数据。');

    // ⑤ 回滚垫:删旧表这个动作本身的即时兜底(不是备份方案)。
    const dumpDir = process.env.X_MIGRATE_DUMP_DIR || path.join(os.tmpdir(), 'krig-x-migrate');
    mkdirSync(dumpDir, { recursive: true });
    const dumpPath = path.join(dumpDir, 'tweet_feedback.json');
    const all = await sql(NOTE_DB, `SELECT * FROM tweet_feedback ORDER BY id ASC;`);
    writeFileSync(dumpPath, JSON.stringify(all, null, 2), 'utf-8');
    console.log(`\n⑤ 源表快照已导出(删表用的回滚垫): ${dumpPath} (${all.length} 行)`);

    console.log('\n✓ 迁移 + 对账全部通过。旧表**未删** —— 那是单独一步,需用户确认。');
  }
} catch (err) {
  console.error(`\n✗ ${err.message}`);
  failed = true;
} finally {
  if (proc) {
    proc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 800));
    try { proc.kill('SIGKILL'); } catch { /* 已退出 */ }
    console.log('sidecar 已关闭');
  }
  // 退出码放在最后设:finally 里任何 console/await 都可能被后续代码覆盖掉
  // process.exitCode(实测踩过 —— 守卫报错了但退出码仍是 0,
  // 对包装脚本而言就是"静默成功")。
  if (failed) process.exit(1);
}
