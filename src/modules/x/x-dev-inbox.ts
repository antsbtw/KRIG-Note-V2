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
import { getXHostBusy, getXHostState, setXHostBusy } from './x-host-registry';
import { bgRunningOn } from './x-bg-runner';
import { manualSummary, pageProblem } from './x-page-ledger';
import { X_MANUAL } from './x-manual';
import { setPageTap } from './x-page-tap';
import { checkFollowBack } from './x-follow-check';
import { runCollect } from './x-collect-run';
import { webviewPorts } from './x-collect-ports';
import { X_USER_LIST_PAGES } from './x-pages';

let timer: NodeJS.Timeout | null = null;
let running = false;

const dirs = (): { inbox: string; outbox: string; samples: string } => {
  const base = path.join(app.getPath('userData'), 'krig-data', 'x-dev');
  return { inbox: path.join(base, 'inbox'), outbox: path.join(base, 'outbox'), samples: path.join(base, 'samples') };
};

/**
 * ⭐ 任何指令都可带 `sample: "名字"`(P2 2026-10-19):每记一页账,把这一页的原始载荷存成
 * `samples/<时间>-<名字>/page-NNN.json` —— 说明书新旧账一致性的基线(tests/modules/x-manual-parity.test.ts 读它)。
 * ⚠️ 载荷含登录态下的内容:只在本机 userData,不进 git。
 */
type Sampling = { sample?: string };
type SearchCmd = Sampling & { op: 'searchScroll'; wsId: string; q: string; f?: 'latest' | 'top'; wantPages: number; maxMs: number; recipeName?: string };
/** 人卡同一条路(主进程 collectPersonTab:游标翻页 + 一页一存回读)—— 验人卡 / 后台的逐页账 */
type PersonCmd = Sampling & { op: 'personTab'; wsId: string; page: 'x.profile' | 'x.withReplies' | 'x.reposts'; handle: string; restId: string; pageCap: number };
/** 名单页(followers / following …):游标翻页记账,不存库 —— 只为存基线样本、看逐页账 */
type UserListCmd = Sampling & { op: 'userList'; wsId: string; page: string; handle: string; pageCap: number };
/** 查回关(与任务页「现在查」同一个函数,trigger 记 manual)—— 2026-10-19 第 4 阶段 */
type FollowCheckCmd = Sampling & { op: 'followCheck'; wsId: string };
type Cmd = SearchCmd | PersonCmd | UserListCmd | FollowCheckCmd;

function validate(c: unknown): Cmd | string {
  const o = c as Partial<SearchCmd> & Partial<PersonCmd> & Partial<UserListCmd>;
  if (o?.sample !== undefined && (typeof o.sample !== 'string' || !/^[\w.-]{1,40}$/.test(o.sample))) return 'sample 只收 1–40 个字母数字 _ . -';
  if ((o as { op?: string })?.op === 'followCheck') {
    if (typeof o.wsId !== 'string') return 'followCheck 要 wsId';
    return o as unknown as FollowCheckCmd;
  }
  if (o?.op === 'userList') {
    if (typeof o.wsId !== 'string' || typeof o.handle !== 'string' || o.handle === '') return 'userList 要 wsId / handle';
    if (X_USER_LIST_PAGES[String(o.page)] === undefined) return `userList 的 page 只收 ${Object.keys(X_USER_LIST_PAGES).join(' / ')}`;
    if (!Number.isInteger(o.pageCap) || (o.pageCap as number) < 1 || (o.pageCap as number) > 10) return 'userList 的 pageCap 要 1–10';
    return o as unknown as UserListCmd;
  }
  if (o?.op === 'personTab') {
    if (typeof o.wsId !== 'string' || typeof o.handle !== 'string' || typeof o.restId !== 'string' || !/^\d+$/.test(o.restId)) return 'personTab 要 wsId / handle / restId';
    if (!['x.profile', 'x.withReplies', 'x.reposts'].includes(String(o.page))) return 'personTab 的 page 只收 x.profile / x.withReplies / x.reposts';
    if (!Number.isInteger(o.pageCap) || (o.pageCap as number) < 1 || (o.pageCap as number) > 10) return 'personTab 的 pageCap 要 1–10';
    return o as unknown as PersonCmd;
  }
  if (o?.op !== 'searchScroll') return `不认识的指令 ${String(o?.op)}`;
  if (typeof o.wsId !== 'string' || typeof o.q !== 'string' || o.q === '') return 'searchScroll 要 wsId 和 q';
  if (!Number.isInteger(o.wantPages) || (o.wantPages as number) < 1 || (o.wantPages as number) > 40) return 'wantPages 要 1–40(防限流)';
  if (!Number.isInteger(o.maxMs) || (o.maxMs as number) < 10_000 || (o.maxMs as number) > 15 * 60_000) return 'maxMs 要 10s–15min';
  return o as unknown as SearchCmd;
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
    manual: manualSummary(r.ledger, X_MANUAL.site, X_MANUAL.version),
    ledger: r.ledger.map((l) => ({ page: l.page, label: l.label, x: l.xTweets, notParsed: l.notParsed.length, notInDb: l.notInDb?.length, dir: l.directionWrong, retried: l.retried, other: l.other, ok: pageProblem(l) === undefined })),
  };
}

async function runUserList(cmd: UserListCmd): Promise<unknown> {
  const wcId = getXHostState(cmd.wsId)?.wcId;
  if (wcId === undefined) return { ok: false, why: `${cmd.wsId} 的 X 网页没开` };
  const busy = getXHostBusy(wcId);
  if (busy !== null) return { ok: false, why: `X 网页正忙:${busy}` };
  if (bgRunningOn(wcId) !== null) return { ok: false, why: '后台正在采' };
  setXHostBusy(wcId, '开发测试:采名单');
  try {
    const ports = webviewPorts(wcId);
    const go = await ports.goto(cmd.page, { handle: cmd.handle });
    if (!go.ok) return { ok: false, why: go.reason };
    const r = await runCollect({
      harvest: ports.harvest,
      runScript: ports.runScript,
      stopPaging: (st) => ({ go: st.round < cmd.pageCap }),
    }, { wantPages: 1, depth: 'as-is', seedPages: 1, maxRounds: 20, maxMs: 60_000 });
    const ledger = r.paging?.ledger ?? [];
    return {
      ok: true, stopReason: r.paging?.stopReason, manual: manualSummary(ledger, X_MANUAL.site, X_MANUAL.version),
      ledger: ledger.map((l) => ({ page: l.page, label: l.label, xUsers: l.xUsers, notParsed: l.notParsed.length, other: l.other, manualDiff: l.manualDiff, ok: pageProblem(l) === undefined })),
    };
  } finally {
    setXHostBusy(wcId, null);
  }
}

/** 挂上旁路,把每页原始载荷存进样本目录;返回摘钩子的函数 */
function startSampling(name: string): { dir: string; pages: () => number; stop: () => void } {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(dirs().samples, `${stamp}-${name}`);
  mkdirSync(dir, { recursive: true });
  let n = 0;
  setPageTap((p) => {
    writeFileSync(path.join(dir, `page-${String(n).padStart(3, '0')}.json`), JSON.stringify({ ...p, savedAt: new Date().toISOString() }));
    n += 1;
  });
  return { dir, pages: () => n, stop: () => setPageTap(null) };
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
    else {
      const sampling = cmd.sample ? startSampling(cmd.sample) : undefined;
      try {
        if (cmd.op === 'personTab') {
          console.log(`[x.dev] 执行 ${next}:personTab @${cmd.handle} ${cmd.page} 最多 ${cmd.pageCap} 页`);
          out = await runPersonTab(cmd);
        } else if (cmd.op === 'followCheck') {
          console.log(`[x.dev] 执行 ${next}:followCheck ${cmd.wsId}`);
          out = await checkFollowBack(cmd.wsId, 'manual');
        } else if (cmd.op === 'userList') {
          console.log(`[x.dev] 执行 ${next}:userList @${cmd.handle} ${cmd.page} 最多 ${cmd.pageCap} 页`);
          out = await runUserList(cmd);
        } else {
          console.log(`[x.dev] 执行 ${next}:${cmd.op}「${cmd.q.slice(0, 40)}」最多 ${cmd.wantPages} 页`);
          out = await collectSearchByScroll(cmd);
        }
      } finally {
        sampling?.stop();
      }
      if (sampling) {
        console.log(`[x.dev] 样本 ${sampling.pages()} 页存到 ${sampling.dir}`);
        out = { ...(out as object), samples: { dir: sampling.dir, pages: sampling.pages() } };
      }
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
