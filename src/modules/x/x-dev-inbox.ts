/**
 * ⭐ 开发测试指令收件箱(2026-10-16)—— **只在开发环境**(app 未打包)启用,主进程
 *
 * 用户 10-16:「权限交给你了,建议你自己配置参数自己跑测试就好了。」
 * 我不能点 app 的按钮,所以开一个收件箱:往 `<userData>/krig-data/x-dev/inbox/` 放一个指令 JSON,
 * 主进程执行,结果写到 `outbox/<同名>.json`。
 * ⚠️ 只认白名单里的指令;一次只跑一个;X 网页忙 / 后台在跑就让路(由被调函数判)。
 * ⚠️ 定时器 unref + before-quit 停(记忆 project-graceful-shutdown)。
 */
import { readLeftTweet } from './x-left-tweet';
import { findVpnPosts, judgeVpnPosts, pruneVpnPosts, readVpnOverview } from './x-vpn-run';
import { getXDB } from '@storage/surreal/client';
import { replyLangOf, vpnLink } from './x-vpn-help';
import { X_PAGE_NAME } from './x-pages';
import { app } from 'electron';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { collectSearchByScroll } from './x-search-scroll';
import { collectPersonTab } from './x-person-collect';
import { getXHostState } from './x-host-registry';
import { acquirePage, releasePage } from './x-page-lock';
import { manualSummary, pageProblem } from './x-page-ledger';
import { X_MANUAL } from './x-manual';
import { setPageTap } from './x-page-tap';
import { checkFollowBack } from './x-follow-check';
import { startRelationTask } from './x-relation-task';
import { draftAskReply } from './x-ask-draft';
import { collectEngagement } from './x-engage-collect';
import { readEngageOverview } from './x-engage-repo';
import { prepareEngage, screenEngage } from './x-engage-prepare';
import { readWsAccount } from './x-account-repo';
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
/** 关系采集(与任务页「读现状并开始」同一个函数)—— 2026-10-20 */
type RelationCmd = Sampling & { op: 'relationStart'; wsId: string; restId?: string; handle?: string };
/** 求关留言草拟(与求关卡同一个函数)—— 2026-10-21;tweets 一次试几条 */
type DraftCmd = Sampling & { op: 'askDraft'; wsId: string; tweets: string[]; mode?: 'ask' | 'engage'; revise?: { previous: string; note: string; keep: boolean } };
/** 第 3 件事:采互动 / 看分组(与任务页同一个函数)—— 2026-10-22 */
type EngageCmd = (Sampling & { op: 'engageCollect'; wsId: string }) | (Sampling & { op: 'engageOverview'; wsId: string })
  | (Sampling & { op: 'engagePrepare'; wsId: string; restId: string; handle: string; hisTweetId?: string })
  /** 读左边正在看的这条;goto 给了就先让左边打开这条(模拟人点开) */
  | (Sampling & { op: 'leftTweet'; wsId: string; goto?: string })
  | (Sampling & { op: 'engageScreen'; wsId: string; restId: string; handle: string })
  | (Sampling & { op: 'vpnFind'; wsId: string }) | (Sampling & { op: 'vpnJudge'; wsId: string; limit: number })
  | (Sampling & { op: 'vpnOverview'; wsId: string }) | (Sampling & { op: 'vpnDraft'; wsId: string; tweetId: string })
  | (Sampling & { op: 'vpnPrune'; wsId: string });
/** 占住 X 网页一段时间(模拟有人在用)—— 资源锁回归 */
type HoldPageCmd = Sampling & { op: 'holdPage'; wsId: string; ms: number; purpose?: string };
type SingleCmd = SearchCmd | PersonCmd | UserListCmd | FollowCheckCmd | RelationCmd | DraftCmd | EngageCmd | HoldPageCmd;
/** 同时跑 2–4 条(不能套 parallel);第 i 条晚 i × staggerMs 开跑 */
type ParallelCmd = Sampling & { op: 'parallel'; cmds: SingleCmd[]; staggerMs?: number };
type Cmd = SingleCmd | ParallelCmd;

function validate(c: unknown): Cmd | string {
  const top = c as { op?: string; cmds?: unknown; staggerMs?: unknown; wsId?: unknown; ms?: unknown; purpose?: unknown };
  if (top?.op === 'parallel') {
    if (!Array.isArray(top.cmds) || top.cmds.length < 2 || top.cmds.length > 4) return 'parallel 要 2–4 条 cmds';
    if (top.staggerMs !== undefined && (!Number.isInteger(top.staggerMs) || (top.staggerMs as number) < 0 || (top.staggerMs as number) > 60_000)) return 'parallel 的 staggerMs 要 0–60000';
    const subs: SingleCmd[] = [];
    for (const [i, x] of top.cmds.entries()) {
      if ((x as { op?: string })?.op === 'parallel') return `parallel 第 ${i + 1} 条:不能套 parallel`;
      const v = validate(x);
      if (typeof v === 'string') return `parallel 第 ${i + 1} 条:${v}`;
      subs.push(v as SingleCmd);
    }
    return { op: 'parallel', cmds: subs, staggerMs: top.staggerMs as number | undefined };
  }
  if (top?.op === 'holdPage') {
    if (typeof top.wsId !== 'string') return 'holdPage 要 wsId';
    if (!Number.isInteger(top.ms) || (top.ms as number) < 1000 || (top.ms as number) > 15 * 60_000) return 'holdPage 的 ms 要 1000–900000';
    if (top.purpose !== undefined && typeof top.purpose !== 'string') return 'holdPage 的 purpose 要字符串';
    return top as unknown as HoldPageCmd;
  }
  const o = c as Partial<SearchCmd> & Partial<PersonCmd> & Partial<UserListCmd>;
  if (o?.sample !== undefined && (typeof o.sample !== 'string' || !/^[\w.-]{1,40}$/.test(o.sample))) return 'sample 只收 1–40 个字母数字 _ . -';
  if (['engageCollect', 'engageOverview', 'engagePrepare', 'leftTweet', 'engageScreen', 'vpnFind', 'vpnJudge', 'vpnOverview', 'vpnDraft', 'vpnPrune'].includes(String((o as { op?: string })?.op))) {
    if (typeof o.wsId !== 'string') return 'engage 指令要 wsId';
    return o as unknown as EngageCmd;
  }
  if ((o as { op?: string })?.op === 'askDraft') {
    const d = o as unknown as DraftCmd;
    if (typeof d.wsId !== 'string' || !Array.isArray(d.tweets) || d.tweets.length === 0 || d.tweets.length > 10) return 'askDraft 要 wsId + 1–10 条 tweets';
    return d;
  }
  if ((o as { op?: string })?.op === 'relationStart') {
    if (typeof o.wsId !== 'string') return 'relationStart 要 wsId';
    return o as unknown as RelationCmd;
  }
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
  /** ⭐ 原来查了忙却不标忙(Module5-04 §1.2)—— 现在占住 */
  const lock = acquirePage(wcId, `开发测试:采 @${cmd.handle} ${cmd.page}`, 'inbox');
  if (!lock.ok) return { ok: false, why: lock.why };
  let r: Awaited<ReturnType<typeof collectPersonTab>>;
  try {
    r = await collectPersonTab({ wcId, page: cmd.page, handle: cmd.handle, restId: cmd.restId, pageCap: cmd.pageCap, attempt: 1 });
  } finally {
    releasePage(lock.token);
  }
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
  const lock = acquirePage(wcId, '开发测试:采名单', 'inbox');
  if (!lock.ok) return { ok: false, why: lock.why };
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
    releasePage(lock.token);
  }
}

/** 执行一条指令(单条 / parallel 里的每一条都走这里) */
async function runCmd(cmd: Cmd, next: string): Promise<unknown> {
  let out: unknown;
  if (cmd.op === 'parallel') return runParallel(cmd, next);
  if (cmd.op === 'holdPage') return runHoldPage(cmd);
  const sampling = cmd.sample ? startSampling(cmd.sample) : undefined;
  try {
    if (cmd.op === 'personTab') {
      console.log(`[x.dev] 执行 ${next}:personTab @${cmd.handle} ${cmd.page} 最多 ${cmd.pageCap} 页`);
      out = await runPersonTab(cmd);
    } else if (cmd.op === 'leftTweet') {
      const wcId = getXHostState(cmd.wsId)?.wcId;
      if (wcId === undefined) out = { ok: false, why: 'X 网页没开' };
      else {
        /** ⭐ 原来不查忙还能先跳转(Module5-04 §1.2)—— 现在占住才动 */
        const lock = acquirePage(wcId, '开发测试:读左边那条', 'inbox');
        if (!lock.ok) out = { ok: false, why: lock.why };
        else {
          try {
            if (cmd.goto) await webviewPorts(wcId).goto(X_PAGE_NAME.status, { tweetId: cmd.goto });
            out = await readLeftTweet(wcId);
          } finally {
            releasePage(lock.token);
          }
        }
      }
    } else if (cmd.op === 'vpnFind') {
      out = await findVpnPosts(cmd.wsId);
    } else if (cmd.op === 'vpnPrune') {
      const acc = await readWsAccount(cmd.wsId);
      out = acc?.restId ? await pruneVpnPosts(acc.restId) : { ok: false, why: '认不出号' };
    } else if (cmd.op === 'vpnJudge' || cmd.op === 'vpnOverview' || cmd.op === 'vpnDraft') {
      const acc = await readWsAccount(cmd.wsId);
      if (!acc?.restId) out = { ok: false, why: '认不出号' };
      else if (cmd.op === 'vpnJudge') out = await judgeVpnPosts(acc.restId, cmd.limit);
      else if (cmd.op === 'vpnOverview') out = await readVpnOverview(acc.restId);
      else {
        const [post, tw] = await getXDB().query<[Array<{ recipe?: string; verdict?: { direction?: 'out' | 'in' | 'none' } }>, Array<{ text?: string }>]>(
          `SELECT recipe, verdict FROM type::record('x_vpn_post', $id); SELECT text FROM x_tweet WHERE tweet_id = $id;`, { id: cmd.tweetId });
        const text = tw?.[0]?.text ?? '';
        const lang = replyLangOf(text);
        out = await draftAskReply({ account: acc.restId, tweet: text, person: {}, mode: 'vpn',
          vpn: { link: vpnLink(lang, acc.handle, post?.[0]?.recipe, new Date()), lang, direction: post?.[0]?.verdict?.direction } });
      }
    } else if (cmd.op === 'engageScreen') {
      out = await screenEngage(cmd.wsId, cmd.restId, cmd.handle);
    } else if (cmd.op === 'engageCollect') {
      out = await collectEngagement(cmd.wsId);
    } else if (cmd.op === 'engagePrepare') {
      const acc = await readWsAccount(cmd.wsId);
      out = acc?.restId ? await prepareEngage(cmd.wsId, acc.restId, cmd.restId, cmd.handle, cmd.hisTweetId) : { ok: false, why: '认不出号' };
    } else if (cmd.op === 'engageOverview') {
      const acc = await readWsAccount(cmd.wsId);
      out = acc?.restId ? await readEngageOverview(acc.restId, acc.handle, 10) : { ok: false, why: '认不出号' };
    } else if (cmd.op === 'askDraft') {
      const acc = await readWsAccount(cmd.wsId);
      if (!acc?.restId) out = { ok: false, why: '认不出号' };
      else {
        const drafts = [];
        for (const t of cmd.tweets) drafts.push({ tweet: t, draft: await draftAskReply({ account: acc.restId, tweet: t, person: {}, mode: cmd.mode, revise: cmd.revise }) });
        out = { ok: true, drafts };
      }
    } else if (cmd.op === 'relationStart') {
      console.log(`[x.dev] 执行 ${next}:relationStart ${cmd.wsId} ${cmd.handle ?? '(我)'}`);
      out = await startRelationTask(cmd.wsId, cmd.restId && cmd.handle ? { restId: cmd.restId, handle: cmd.handle } : undefined);
    } else if (cmd.op === 'followCheck') {
      console.log(`[x.dev] 执行 ${next}:followCheck ${cmd.wsId}`);
      out = await checkFollowBack(cmd.wsId, 'manual');
    } else if (cmd.op === 'userList') {
      console.log(`[x.dev] 执行 ${next}:userList @${cmd.handle} ${cmd.page} 最多 ${cmd.pageCap} 页`);
      out = await runUserList(cmd);
    } else {
      console.log(`[x.dev] 执行 ${next}:${cmd.op}「${cmd.q.slice(0, 40)}」最多 ${cmd.wantPages} 页`);
      out = await collectSearchByScroll({ ...cmd, ownToken: undefined, caller: 'inbox' });
    }
  } finally {
    sampling?.stop();
  }
  if (sampling) {
    console.log(`[x.dev] 样本 ${sampling.pages()} 页存到 ${sampling.dir}`);
    out = { ...(out as object), samples: { dir: sampling.dir, pages: sampling.pages() } };
  }
  return out;
}

/**
 * ⭐⭐ 同时跑几条(2026-10-23,资源锁回归):收件箱本来一次一条,造不出「A 正在用网页时 B 来抢」。
 * 第 i 条在 i × staggerMs 后开跑(让第一条先占住网页);全部跑完一起返回,每条带起止时间。
 */
async function runParallel(cmd: ParallelCmd, next: string): Promise<unknown> {
  const t0 = Date.now();
  console.log(`[x.dev] 执行 ${next}:parallel ${cmd.cmds.map((c) => c.op).join(' + ')}(间隔 ${cmd.staggerMs ?? 0}ms)`);
  const runs = await Promise.allSettled(cmd.cmds.map(async (c, i) => {
    await new Promise((r) => setTimeout(r, i * (cmd.staggerMs ?? 0)));
    const startedMs = Date.now() - t0;
    const result = await runCmd(c, `${next}#${i + 1}`);
    return { op: c.op, startedMs, finishedMs: Date.now() - t0, result };
  }));
  return { ok: true, runs: runs.map((r, i) => (r.status === 'fulfilled' ? r.value : { op: cmd.cmds[i].op, error: r.reason instanceof Error ? r.reason.message : String(r.reason) })) };
}

/** ⭐ 占住 X 网页 ms 毫秒什么都不做 —— 模拟「操作台 / 人卡正在用」,看别的任务让不让路 */
async function runHoldPage(cmd: HoldPageCmd): Promise<unknown> {
  const wcId = getXHostState(cmd.wsId)?.wcId;
  if (wcId === undefined) return { ok: false, why: 'X 网页没开' };
  const lock = acquirePage(wcId, cmd.purpose ?? '开发测试:占着网页', 'inbox');
  if (!lock.ok) return { ok: false, why: lock.why };
  try {
    await new Promise((r) => setTimeout(r, cmd.ms));
    return { ok: true, heldMs: cmd.ms };
  } finally {
    releasePage(lock.token);
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
      out = await runCmd(cmd, next);
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
