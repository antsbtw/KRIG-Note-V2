#!/usr/bin/env node
/**
 * ⭐⭐ 站点说明书的修改档案(设计 04-site-manual-self-repair.md §9,P2 2026-10-19)
 *
 * 用户 10-19:「留档/列表,方便回溯,定期归档。」· 归档周期:用户 10-19 选「按月归档」。
 * 逻辑全在引擎 `src/platform/main/web-capability/manual/`(本脚本用 esbuild 当场打包载入,不另写一份)。
 *
 * 用法(<dir> 是说明书目录,如 src/modules/x/manual):
 *   node scripts/manual.mjs list <dir>                 主列表(举手置顶)+ 每月归档一行摘要
 *   node scripts/manual.mjs show <dir> <版本>           一条记录的全文(含逐项对比)
 *   node scripts/manual.mjs diff <dir> <版本a> <版本b>  任意两版对比
 *   node scripts/manual.mjs check <dir>                说明书自检 + 档案自检
 *   node scripts/manual.mjs record <dir> --by <human|claude-code|local-ai|cloud-ai> --summary "…" --reason "…"
 *        [--evidence 路径 …] [--fixed N --broken N --regression "说明"] [--cloud-sent "发了什么"] [--raised]
 *        —— 改完 <site>.manual.json(version +1)后跑:存快照、算对比、记一条
 *   node scripts/manual.mjs rollback <dir> --to <版本> --by … --reason "…"
 *        —— 当前版换成第 N 版的内容(版本号照样 +1,回滚本身也是一次修改,也记档)
 *   node scripts/manual.mjs archive <dir> [--now 2026-11-02]   把本月以前的(举手的除外)按月归档
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

async function loadEngine() {
  const r = buildSync({
    stdin: {
      contents: "export * from './index';",
      resolveDir: join(ROOT, 'src/platform/main/web-capability/manual'),
      loader: 'ts',
    },
    bundle: true, format: 'esm', platform: 'node', write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}`);
}

const die = (m) => { console.error(`✗ ${m}`); process.exit(1); };
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`); };

function args(argv) {
  const pos = []; const opt = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const k = a.slice(2);
    if (k === 'raised') { opt.raised = true; continue; }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) die(`--${k} 缺值`);
    i += 1;
    if (k === 'evidence') (opt.evidence ??= []).push(v); else opt[k] = v;
  }
  return { pos, opt };
}

function openDir(E, dir) {
  if (!dir || !existsSync(dir)) die(`说明书目录不存在:${dir}`);
  const files = readdirSync(dir).filter((f) => f.endsWith('.manual.json'));
  if (files.length !== 1) die(`${dir} 里要恰好一个 *.manual.json,实际 ${files.length} 个`);
  const manualPath = join(dir, files[0]);
  const histDir = join(dir, 'history');
  const history = {};
  if (existsSync(histDir)) for (const f of readdirSync(histDir)) {
    const m = /^v(\d+)\.json$/.exec(f);
    if (m) history[Number(m[1])] = readJson(join(histDir, f));
  }
  const changesPath = join(dir, 'changes.json');
  const archDir = join(dir, 'archive');
  const archives = existsSync(archDir) ? readdirSync(archDir).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).sort().map((f) => readJson(join(archDir, f))) : [];
  const manual = readJson(manualPath);
  const main = existsSync(changesPath) ? readJson(changesPath) : { site: manual.site, entries: [] };
  return { manualPath, histDir, history, changesPath, archDir, archives, manual, main };
}

const fmt = (v) => (v === undefined ? '(无)' : JSON.stringify(v).slice(0, 160));
const line = (e) => `${e.at.slice(5, 10)} v${e.version}  ${e.summary}  修好${e.regression.fixed}/弄坏${e.regression.broken}  ${e.by}${e.cloud.used ? ' ☁️' : ''}${e.rollbackOf ? `  (回滚到 v${e.rollbackOf})` : ''}`;

function record(E, d, opt, extra = {}) {
  const problems = E.checkManual(d.manual);
  if (problems.length) die(`说明书自检不过:\n  · ${problems.join('\n  · ')}`);
  const versions = Object.keys(d.history).map(Number);
  const last = versions.length ? Math.max(...versions) : 0;
  if (d.manual.version !== last + 1) die(`当前 version 是 ${d.manual.version},应为 ${last + 1}(上一版快照 v${last})—— 先把 version +1`);
  const diff = last === 0 ? E.diffManual({}, d.manual) : E.diffManual(d.history[last], d.manual);
  if (last > 0 && diff.length === 0) die('和上一版内容完全一样,不用记');
  for (const k of ['by', 'summary', 'reason']) if (!opt[k]) die(`缺 --${k}`);
  const entry = {
    version: d.manual.version,
    at: new Date().toISOString(),
    by: opt.by,
    summary: opt.summary,
    reason: opt.reason,
    evidence: opt.evidence ?? [],
    regression: { fixed: Number(opt.fixed ?? 0), broken: Number(opt.broken ?? 0), detail: opt.regression ?? '' },
    cloud: opt['cloud-sent'] ? { used: true, sent: opt['cloud-sent'] } : { used: false },
    diff,
    status: opt.raised ? 'raised' : 'ok',
    ...extra,
  };
  const bad = E.checkChange(entry, '新记录');
  if (bad.length) die(bad.join('\n'));
  writeJson(join(d.histDir, E.historyFile(d.manual.version)), d.manual);
  writeJson(d.changesPath, { site: d.manual.site, entries: [entry, ...d.main.entries] });
  console.log(`✓ 记档 v${entry.version}:${entry.summary}(${diff.length} 处改动)`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opt } = args(rest);
  if (!cmd || cmd === 'help') { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]); return; }
  const E = await loadEngine();
  const d = openDir(E, pos[0]);
  switch (cmd) {
    case 'list': {
      const raised = d.main.entries.filter((e) => e.status === 'raised');
      const ok = d.main.entries.filter((e) => e.status !== 'raised');
      console.log(`修改档案 · ${d.manual.site} · 当前 v${d.manual.version}`);
      console.log('─'.repeat(60));
      for (const e of raised) console.log(`🔴 举手 ${line(e)}`);
      if (raised.length) console.log('─'.repeat(60));
      for (const e of ok) console.log(line(e));
      if (!ok.length) console.log('(本月没有修改)');
      const { byMonth } = E.archiveByMonth(d.main.entries, new Date());
      const stale = Object.keys(byMonth);
      if (stale.length) console.log(`⚠️ 主列表里有 ${stale.join(' / ')} 的条目还没归档 —— 跑 archive`);
      if (d.archives.length) {
        console.log('─'.repeat(60));
        console.log('已归档:');
        for (const a of [...d.archives].reverse()) {
          const s = E.summarizeEntries(a.entries);
          console.log(`  ${a.month}  ${s.count} 条  ${s.versions}(修好 ${s.fixed} / 弄坏 ${s.broken})  → show <版本> 看明细`);
        }
      }
      return;
    }
    case 'show': {
      const v = Number(pos[1]);
      const all = [...d.main.entries, ...d.archives.flatMap((a) => a.entries)];
      const e = all.find((x) => x.version === v) ?? die(`没有 v${v} 的记录`);
      console.log(line(e));
      console.log(`为什么:${e.reason}`);
      if (e.evidence.length) console.log(`依据:${e.evidence.join(' · ')}`);
      console.log(`回归:修好 ${e.regression.fixed} / 弄坏 ${e.regression.broken}  ${e.regression.detail}`);
      if (e.cloud.used) console.log(`云端:发了 ${e.cloud.sent}`);
      console.log(`改动 ${e.diff.length} 处:`);
      for (const x of e.diff) console.log(`  ${x.path}\n    前 ${fmt(x.before)}\n    后 ${fmt(x.after)}`);
      return;
    }
    case 'diff': {
      const a = d.history[Number(pos[1])] ?? die(`没有快照 v${pos[1]}`);
      const b = d.history[Number(pos[2])] ?? die(`没有快照 v${pos[2]}`);
      const xs = E.diffManual(a, b);
      console.log(`v${pos[1]} → v${pos[2]}:${xs.length} 处`);
      for (const x of xs) console.log(`  ${x.path}\n    前 ${fmt(x.before)}\n    后 ${fmt(x.after)}`);
      return;
    }
    case 'check': {
      const p1 = E.checkManual(d.manual);
      const p2 = E.checkArchive({ manual: d.manual, history: d.history, main: d.main, archives: d.archives });
      const all = [...p1.map((x) => `说明书 ${x}`), ...p2.map((x) => `档案 ${x}`)];
      if (all.length) die(`${all.length} 处问题:\n  · ${all.join('\n  · ')}`);
      console.log(`✓ ${d.manual.site} v${d.manual.version}:说明书自检过 · 档案 ${Object.keys(d.history).length} 个快照一致`);
      return;
    }
    case 'record':
      record(E, d, opt);
      return;
    case 'rollback': {
      const to = Number(opt.to);
      const snap = d.history[to] ?? die(`没有快照 v${to}`);
      const next = { ...snap, version: d.manual.version + 1 };
      if (JSON.stringify(d.history[d.manual.version]) !== JSON.stringify(d.manual)) die('当前说明书有没记档的改动 —— 先 record 或丢弃,再回滚');
      writeJson(d.manualPath, next);
      record(E, { ...d, manual: next }, { ...opt, summary: opt.summary ?? `回滚到 v${to}` }, { rollbackOf: to });
      return;
    }
    case 'archive': {
      const now = opt.now ? new Date(opt.now) : new Date();
      const { keep, byMonth } = E.archiveByMonth(d.main.entries, now);
      const months = Object.keys(byMonth).sort();
      if (!months.length) { console.log('没有要归档的(主列表都是本月的或举手的)'); return; }
      for (const m of months) {
        const p = join(d.archDir, `${m}.json`);
        const old = existsSync(p) ? readJson(p).entries : [];
        const merged = [...byMonth[m], ...old].sort((a, b) => b.version - a.version);
        writeJson(p, { site: d.manual.site, month: m, entries: merged });
        console.log(`✓ ${m}:归档 ${byMonth[m].length} 条(该月共 ${merged.length} 条)`);
      }
      writeJson(d.changesPath, { site: d.manual.site, entries: keep });
      return;
    }
    default:
      die(`不认识的命令 ${cmd}(help 看用法)`);
  }
}

main().catch((e) => die(e instanceof Error ? e.stack : String(e)));
