/**
 * ⭐ 把留痕里的历史落库事件补进账本 `x_collect_log`(schema 1.2.19)
 *
 * 用法:
 *   node scripts/x-backfill-collect-log.mjs           # 只看,不写(默认)
 *   node scripts/x-backfill-collect-log.mjs --apply   # 真写
 * ⚠️ 要 app 在跑(库由 app 起),且 app 已重启过一次让迁移 1.2.19 建好表。
 *
 * ── 为什么能补、补得准 ──
 * 每次落库 x-data-ipc 都往 web-trace/lifecycle/*.jsonl 写一条
 * `x-save-ok` / `x-save-incomplete`(推文)或 `x-save-users-ok` / `x-save-users-incomplete`(人),
 * 带时间与 inserted / updated。2026-10-07 实测:留痕合计 人 6342 / 推文 130,与库里行数一条不差。
 *
 * ── ⚠️ 不重复的两道闸 ──
 * ① record id = `trace-<ts>` + UPSERT:同一事件跑几次都只有一行
 * ② 只补**迁移 1.2.19 跑之前**的事件:之后每次落库都同时写留痕和账本,再补就是双份
 *    ⚠️⚠️ 第一版用「账本第一条实时记录的时间」当界线 —— 2026-10-07 只看模式当场抓到双算:
 *    落库时留痕比账本**早写几毫秒**,于是那一跑的留痕落在界线之前,人数算成 6499(多出 157)。
 *    迁移时刻是「账本开始记」的真实起点,不依赖毫秒先后。
 *
 * DBN 环境变量可指定别的 database(演练用),默认 krig_x。
 */
import { Surreal } from 'surrealdb';
import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const APPLY = process.argv.includes('--apply');
const DBN = process.env.DBN ?? 'krig_x';
const APP_DIR = join(homedir(), 'Library/Application Support/KRIG Note V2');
const TRACE_DIR = process.env.TRACE_DIR ?? join(APP_DIR, 'krig-data/web-trace/lifecycle');

const EVENTS = {
  'x-save-ok': 'tweets', 'x-save-incomplete': 'tweets',
  'x-save-users-ok': 'users', 'x-save-users-incomplete': 'users',
};

/** ① 读留痕 —— 坏行跳过但**报数**,不静默 */
const events = [];
let badLines = 0;
for (const f of readdirSync(TRACE_DIR).filter((x) => x.endsWith('.jsonl')).sort()) {
  for (const line of readFileSync(join(TRACE_DIR, f), 'utf-8').split('\n')) {
    if (!line.includes('"x-save')) continue;
    let j;
    try { j = JSON.parse(line); } catch { badLines += 1; continue; }
    const kind = EVENTS[j.event];
    if (!kind) continue;
    const d = j.detail ?? {};
    events.push({
      ts: j.ts, kind,
      source: kind === 'users' ? d.listSource : (d.source || 'unknown'),
      given: d.given ?? 0, inserted: d.inserted ?? 0, updated: d.updated ?? 0, failed: d.failed ?? 0,
    });
  }
}
events.sort((a, b) => a.ts - b.ts);

const { username, password } = JSON.parse(readFileSync(join(APP_DIR, '.db-credentials'), 'utf-8'));
const db = new Surreal();
await Promise.race([
  db.connect('ws://127.0.0.1:8533/rpc'),
  new Promise((_, r) => setTimeout(() => r(new Error('连不上库 —— app 没在跑吧?先打开 app 再跑本脚本。')), 8000)),
]);
await db.signin({ username, password });
await db.use({ namespace: 'krig', database: DBN });

try {
  const tables = Object.keys((await db.query('INFO FOR DB'))[0].tables);
  if (!tables.includes('x_collect_log')) {
    throw new Error('x_collect_log 还不存在 —— 先重启 app 让迁移 1.2.19 跑完再补。');
  }

  /** ② 闸门:迁移 1.2.19 跑的时刻 = 账本开始实时记账的时刻 */
  const [[mig]] = await db.query("SELECT appliedAt FROM schema_version WHERE version = '1.2.19'");
  const cutoff = Number(mig?.appliedAt);
  if (!Number.isFinite(cutoff)) {
    throw new Error('读不到迁移 1.2.19 的时间 —— 不知道账本从何时开始记,不敢补(补错就是双份)。');
  }
  const todo = events.filter((e) => e.ts < cutoff);

  const sum = (k) => todo.filter((e) => e.kind === k).reduce((s, e) => s + e.inserted, 0);
  console.log(`留痕里找到 ${events.length} 条落库事件` + (badLines ? `(另有 ${badLines} 行解析失败,已跳过)` : ''));
  console.log(`账本从 ${new Date(cutoff).toISOString()}(迁移 1.2.19)开始实时记 —— 只补它之前的 ${todo.length} 条`);
  console.log(`待补合计:人 新增 ${sum('users')} · 推文 新增 ${sum('tweets')}`);

  if (!APPLY) {
    console.log('\n(只看模式,没写。确认无误后加 --apply 真写)');
  } else {
    for (const e of todo) {
      await db.query(
        `UPSERT type::record('x_collect_log', $id) SET
           at = type::datetime($at), kind = $kind, source = $source,
           given = $given, inserted = $inserted, updated = $updated, failed = $failed,
           origin = 'trace-backfill'`,
        { id: `trace-${e.ts}`, at: new Date(e.ts).toISOString(), ...e },
      );
    }
    console.log(`\n已写入 ${todo.length} 条(重跑不会重复)`);
  }

  /** ③ 对账 —— 账本合计 vs 表行数 */
  const [ledger, [au], [tw]] = await db.query(`
    SELECT kind, math::sum(inserted) AS ins FROM x_collect_log GROUP BY kind;
    SELECT count() AS n FROM x_author GROUP ALL;
    SELECT count() AS n FROM x_tweet GROUP ALL;`);
  const ins = (k) => ledger.find((r) => r.kind === k)?.ins ?? 0;
  const line = (label, total, l) => `${label}:表 ${total} · 账本 ${l} ${total === l ? '✓ 对上' : `⚠️ 差 ${total - l}`}`;
  console.log('\n对账(账本现状)');
  console.log('  ' + line('人', au?.n ?? 0, ins('users')));
  console.log('  ' + line('推文', tw?.n ?? 0, ins('tweets')));
} finally {
  await db.close();
}
