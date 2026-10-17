/**
 * ⭐ 开发测试指令收件箱(2026-10-16)—— **只在开发环境**(app 未打包)启用,主进程
 *
 * 用户 10-16:「权限交给你了,建议你自己配置参数自己跑测试就好了。」
 * 我不能点 app 的按钮,所以开一个收件箱:往 `<userData>/krig-data/x-dev/inbox/` 放一个指令 JSON,
 * 主进程执行,结果写到 `outbox/<同名>.json`。
 * ⚠️ 只认白名单里的指令;一次只跑一个;X 网页忙 / 后台在跑就让路(由被调函数判)。
 * ⚠️ 定时器 unref + before-quit 停(记忆 project-graceful-shutdown)。
 */
import { app } from 'electron';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { collectSearchByScroll } from './x-search-scroll';
import { collectPersonTab } from './x-person-collect';
import { getXHostBusy, getXHostState } from './x-host-registry';
import { bgRunningOn } from './x-bg-runner';
import { pageProblem } from './x-page-ledger';

let timer: NodeJS.Timeout | null = null;
let running = false;

const dirs = (): { inbox: string; outbox: string } => {
  const base = path.join(app.getPath('userData'), 'krig-data', 'x-dev');
  return { inbox: path.join(base, 'inbox'), outbox: path.join(base, 'outbox') };
};

type SearchCmd = { op: 'searchScroll'; wsId: string; q: string; f?: 'latest' | 'top'; wantPages: number; maxMs: number; recipeName?: string };
/** 人卡同一条路(主进程 collectPersonTab:游标翻页 + 一页一存回读)—— 验人卡 / 后台的逐页账 */
type PersonCmd = { op: 'personTab'; wsId: string; page: 'x.profile' | 'x.withReplies' | 'x.reposts'; handle: string; restId: string; pageCap: number };
type Cmd = SearchCmd | PersonCmd;

function validate(c: unknown): Cmd | string {
  const o = c as Partial<SearchCmd> & Partial<PersonCmd>;
  if (o?.op === 'personTab') {
    if (typeof o.wsId !== 'string' || typeof o.handle !== 'string' || typeof o.restId !== 'string' || !/^\d+$/.test(o.restId)) return 'personTab 要 wsId / handle / restId';
    if (!['x.profile', 'x.withReplies', 'x.reposts'].includes(String(o.page))) return 'personTab 的 page 只收 x.profile / x.withReplies / x.reposts';
    if (!Number.isInteger(o.pageCap) || (o.pageCap as number) < 1 || (o.pageCap as number) > 10) return 'personTab 的 pageCap 要 1–10';
    return o as PersonCmd;
  }
  if (o?.op !== 'searchScroll') return `不认识的指令 ${String(o?.op)}`;
  if (typeof o.wsId !== 'string' || typeof o.q !== 'string' || o.q === '') return 'searchScroll 要 wsId 和 q';
  if (!Number.isInteger(o.wantPages) || (o.wantPages as number) < 1 || (o.wantPages as number) > 40) return 'wantPages 要 1–40(防限流)';
  if (!Number.isInteger(o.maxMs) || (o.maxMs as number) < 10_000 || (o.maxMs as number) > 15 * 60_000) return 'maxMs 要 10s–15min';
  return o as SearchCmd;
}

async function runPersonTab(cmd: PersonCmd): Promise<unknown> {
  const wcId = getXHostState(cmd.wsId)?.wcId;
  if (wcId === undefined) return { ok: false, why: `${cmd.wsId} 的 X 网页没开` };
  const busy = getXHostBusy(wcId);
  if (busy !== null) return { ok: false, why: `X 网页正忙:${busy}` };
  if (bgRunningOn(wcId) !== null) return { ok: false, why: '后台正在采' };
  const r = await collectPersonTab({ wcId, page: cmd.page, handle: cmd.handle, restId: cmd.restId, pageCap: cmd.pageCap, attempt: 1 });
  if (!r.reached) return { ok: false, why: r.reason };
  return {
    ok: true, records: r.records.length, pageInserted: r.pageInserted, stopReason: r.paging?.stopReason,
    ledgerProblem: r.ledgerProblem,
    ledger: r.ledger.map((l) => ({ page: l.page, label: l.label, x: l.xTweets, notParsed: l.notParsed.length, notInDb: l.notInDb?.length, dir: l.directionWrong, retried: l.retried, other: l.other, ok: pageProblem(l) === undefined })),
  };
}

async function tick(): Promise<void> {
  if (running) return;
  const { inbox, outbox } = dirs();
  if (!existsSync(inbox)) return;
  const next = readdirSync(inbox).filter((f) => f.endsWith('.json')).sort()[0];
  if (!next) return;
  running = true;
  const src = path.join(inbox, next);
  const doing = `${src}.running`;
  try {
    renameSync(src, doing);
    mkdirSync(outbox, { recursive: true });
    let out: unknown;
    const cmd = validate(JSON.parse(readFileSync(doing, 'utf8')));
    const startedAt = new Date().toISOString();
    if (typeof cmd === 'string') out = { ok: false, why: cmd };
    else if (cmd.op === 'personTab') {
      console.log(`[x.dev] 执行 ${next}:personTab @${cmd.handle} ${cmd.page} 最多 ${cmd.pageCap} 页`);
      out = await runPersonTab(cmd);
    } else {
      console.log(`[x.dev] 执行 ${next}:${cmd.op}「${cmd.q.slice(0, 40)}」最多 ${cmd.wantPages} 页`);
      out = await collectSearchByScroll(cmd);
    }
    writeFileSync(path.join(outbox, next), JSON.stringify({ cmd: next, startedAt, finishedAt: new Date().toISOString(), result: out }, null, 2));
    renameSync(doing, `${doing.replace(/\.running$/, '')}.done`);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.error(`[x.dev] ${next} 出错:${why}`);
    try { writeFileSync(path.join(outbox, next), JSON.stringify({ cmd: next, error: why }, null, 2)); } catch { /* 写不了就算了,终端已打 */ }
  } finally {
    running = false;
  }
}

export function startDevInbox(): void {
  if (timer || app.isPackaged) return;
  timer = setInterval(() => { void tick(); }, 3000);
  timer.unref?.();
  console.log(`[x.dev] 开发测试收件箱已启动:${dirs().inbox}`);
}

export function stopDevInbox(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
