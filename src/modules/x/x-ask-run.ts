/**
 * ⭐⭐⭐ 求关:三个动作(2026-10-17,第 2 阶段)—— 主进程
 *
 * 用户 10-17:「选择一条和互关相关的,点赞、留言求关、关注。三个动作。…这些动作完毕后,要记录关注时间,
 *  定期检查对方是否回关,建立和对方互动的时间线。」「看来还是我自己先训练吧。」(留言由用户亲手写)
 *
 * 顺序:去那条推文 → ① 点赞 → ② 留言(贴进回复框、核对框里一字不差 → 点发送 → 等我的回复真的出现在页面上)
 *       → 去他主页 → ③ 关注(按钮变成 Following 才算)。
 * 保护(记忆 project-x-write-redline-cancelled):
 *  · 节奏:与关注队列同一道闸(每日上限 + 最小间隔),**动手前**先过 —— 不会点了赞、留了言却卡在关注上
 *  · 异常即停:哪一步没成就停在哪一步,不往下走,说清卡在哪
 *  · 留痕:每个动作进 x_action_log;整次求关进 x_ask(也是留言范例库)
 *  · 执行后核对:每一步都看页面上真的变了
 * ⚠️ 人一次点一个人(求关卡上的按钮),不是后台队列。
 */
import { getXDB } from '@storage/surreal/client';
import { inputEngine } from '@platform/main/web-capability/wiring/runtime';
import { resolve as resolvePage } from '@platform/main/web-capability/wiring/web-collect-engine';
import { webviewPorts } from './x-collect-ports';
import { X_SCRIPTS, replyNeedle } from './x-dom-scripts';
import { X_ANCHORS, X_PAGE_NAME } from './x-pages';
import { getXHostState } from './x-host-registry';
import { acquirePage, releasePage } from './x-page-lock';
import { accountForWrite } from './x-account-repo';
import { appendAction, readFollowGate } from './x-ops-actions-repo';
import { localDayStart } from './x-ops-settings';
import { writeRelations } from './x-user-repo';
import { followQueueStatus } from './x-follow-queue';

export type AskRunInput = {
  readonly wsId: string;
  readonly restId: string;
  readonly handle: string;
  readonly tweetId: string;
  readonly tweetText: string;
  readonly pickKind: 'tweet' | 'bio-latest' | 'other';
  readonly reply: string;
  /** ⭐ Gemma 的原稿(2026-10-21);没用 AI 草拟就没有。发出去的和原稿一字不差 = AI 写的,否则 = 你写的 */
  readonly aiText?: string;
  /**
   * ⭐ engage = 已互关的蓝V日常互动(2026-10-22,蓝V互关第 3 件事):点赞 + 回复,**不关注**、不走关注闸门,记进 x_engage;
   * 不给 = 求关(点赞 + 留言 + 关注,记进 x_ask)
   */
  readonly mode?: 'ask' | 'engage' | 'vpn';
};

export type StepState = 'ok' | 'already' | 'unseen' | 'failed';
export type AskRunResult = {
  readonly ok: boolean;
  /** 没动手就停了(闸门 / 网页忙 / 认不出号 …) */
  readonly blocked?: string;
  readonly liked?: StepState;
  readonly replied?: StepState;
  readonly followed?: StepState;
  readonly replyId?: string;
  readonly failedStep?: 'like' | 'reply' | 'follow';
  readonly detail?: string;
  /** 照做了,但超过了我们平时的量(每日上限 / 连续关注)—— 只提醒不拦(用户 10-21) */
  readonly warning?: string;
};

const BUSY = '任务:正在求关';
const running = new Set<string>();

/** 留言能不能发 —— 纯函数(空的 / 只有标点 / 太长 都不发) */
export function replyProblem(text: string): string | null {
  const t = text.trim();
  if (t === '') return '留言是空的';
  /** 只有表情也能发(用户 10-21:回一个 👍 是允许的)—— 发送后靠图片 alt 核对;连表情都没有的(纯标点)才不发 */
  if (replyNeedle(t) === '') return '留言里没有字也没有表情,发出去没法核对';
  if ([...t].length > 280) return '留言超过 280 字';
  return null;
}

export async function runAsk(p: AskRunInput): Promise<AskRunResult> {
  const why = replyProblem(p.reply);
  if (why) return { ok: false, blocked: why };
  if (!/^\d+$/.test(p.restId) || !/^\d+$/.test(p.tweetId)) return { ok: false, blocked: '人 / 推文 id 不对' };
  if (running.has(p.wsId)) return { ok: false, blocked: '上一个求关还没做完' };
  const wcId = getXHostState(p.wsId)?.wcId;
  if (wcId === undefined) return { ok: false, blocked: 'X 网页没开' };
  if (followQueueStatus(p.wsId).current) return { ok: false, blocked: '关注队列正在动作' };
  /** engage / vpn 都只点赞 + 回复,不关注;vpn = 回复求助(2026-10-23),记进 x_vpn_reply */
  const engage = p.mode === 'engage' || p.mode === 'vpn';
  const vpn = p.mode === 'vpn';
  const label = vpn ? '回复求助' : engage ? '互动' : '求关';
  /**
   * 关注的量(每日上限 / 连续满 15 个歇 15 分钟)只管求关 —— 互动不关注。
   * ⚠️⚠️ 用户 10-21:「我的任务我自己控制,有问题提示就好了」—— 超了照做,结果里带提醒,不拦
   */
  const warning = engage ? undefined : await readFollowGate(localDayStart(new Date()).toISOString()).then((g) => (g.allowed ? undefined : g.reason));
  const account = await accountForWrite(wcId);
  if (account.kind !== 'ok') return { ok: false, blocked: `认不出登录的号:${account.reason}` };
  /** ⭐⭐ 占住 X 网页(x-page-lock);被占着就不动手 —— 别人也放不掉这把锁 */
  const lock = acquirePage(wcId, BUSY, 'ui');
  if (!lock.ok) return { ok: false, blocked: lock.why };

  running.add(p.wsId);
  const ports = webviewPorts(wcId);
  const reply = p.reply.trim();
  const r: { -readonly [K in keyof AskRunResult]: AskRunResult[K] } = { ok: false, warning };
  const stop = (step: 'like' | 'reply' | 'follow', detail: string): void => { r.failedStep = step; r.detail = detail; };
  try {
    // ── 去那条推文 ──
    const go = await ports.goto(X_PAGE_NAME.status, { tweetId: p.tweetId });
    if (!go.ok) { stop('like', `去不到那条推文:${go.reason}`); r.liked = 'failed'; return r; }

    // ── ① 点赞 ──
    const lk = (await ports.runScript(X_SCRIPTS.likeTweet, { tweetId: p.tweetId })) as { state?: string; why?: string } | null;
    r.liked = lk?.state === 'liked' ? 'ok' : lk?.state === 'already-liked' ? 'already' : 'failed';
    if (r.liked !== 'already') {
      await appendAction({ action: 'like', targetRestId: p.restId, targetHandle: p.handle, decidedBy: 'human',
        result: r.liked === 'ok' ? 'ok' : 'failed', reason: `${label} · 推文 ${p.tweetId}`, detail: r.liked === 'failed' ? lk?.state : undefined, wsId: p.wsId });
    }
    if (r.liked === 'failed') { stop('like', `点赞没成:${lk?.state ?? '无返回'}${lk?.why ? `(${lk.why})` : ''}`); return r; }

    // ── ② 留言 ──
    const box = (await ports.runScript(X_SCRIPTS.replyBoxState, {})) as { found?: boolean; count?: number; text?: string } | null;
    if (!box?.found) { r.replied = 'failed'; stop('reply', '这条推文页上找不到回复框'); return r; }
    if (box.count !== 1) { r.replied = 'failed'; stop('reply', `页面上有 ${box.count} 个回复框,不知道该贴哪个`); return r; }
    if ((box.text ?? '') !== '') { r.replied = 'failed'; stop('reply', `回复框里已经有字(「${box.text!.slice(0, 30)}」),没往里贴 —— 先清掉再试`); return r; }
    const page = resolvePage({ wcId });
    if ('error' in page) { r.replied = 'failed'; stop('reply', page.error); return r; }
    const typed = await inputEngine.type(page.pageId, { anchor: X_ANCHORS.replyBox, text: reply, check: { kind: 'exact' } });
    if (typed.status === 'failed' || !typed.value.landed) {
      r.replied = 'failed';
      stop('reply', `留言没贴进框里:${typed.status === 'failed' ? typed.reason : `校验没过(试了 ${typed.value.attempts} 条路)`}`);
      return r;
    }
    const sent = (await ports.runScript(X_SCRIPTS.sendReply, { needle: replyNeedle(reply), me: account.handle })) as
      { state?: string; replyId?: string; why?: string } | null;
    r.replied = sent?.state === 'sent' ? 'ok' : sent?.state === 'unseen' ? 'unseen' : 'failed';
    r.replyId = sent?.replyId;
    await appendAction({ action: 'reply', targetRestId: p.restId, targetHandle: p.handle, decidedBy: 'human',
      result: r.replied === 'failed' ? 'failed' : 'ok', reason: `${label} · 推文 ${p.tweetId}`,
      detail: r.replied === 'ok' ? `回复 ${r.replyId}:${reply}` : `${sent?.state ?? '无返回'}:${reply}`, wsId: p.wsId });
    if (r.replied !== 'ok') {
      /** ⚠️ unseen(框清空了、页面上没看到)也停:说不清发没发出去,不能接着关注假装都成了 */
      stop('reply', r.replied === 'unseen'
        ? '点了发送,框清空了,但页面上没看到我的回复 —— 请在左边看一眼发出去没有'
        : `留言没发出去:${sent?.state ?? '无返回'}${sent?.why ? `(${sent.why})` : ''}`);
      return r;
    }

    /** 互动到这里就完了(已经互关,不关注) */
    if (engage) { r.ok = true; return r; }

    // ── ③ 关注 ──
    const goP = await ports.goto(X_PAGE_NAME.profile, { handle: p.handle });
    if (!goP.ok) { r.followed = 'failed'; stop('follow', `去不到他的主页:${goP.reason}`); return r; }
    const fo = (await ports.runScript(X_SCRIPTS.follow, { restId: p.restId })) as { state?: string; why?: string } | null;
    r.followed = fo?.state === 'followed' ? 'ok' : fo?.state === 'already-following' ? 'already' : 'failed';
    if (r.followed !== 'failed') {
      await writeRelations(account, [{ person: p.restId, iFollow: true, observedAt: new Date().toISOString() }], 'follow-action');
    }
    if (r.followed !== 'already') {
      await appendAction({ action: 'follow', targetRestId: p.restId, targetHandle: p.handle, decidedBy: 'human',
        result: r.followed === 'ok' ? 'ok' : 'failed', reason: `求关 · 推文 ${p.tweetId}`, detail: r.followed === 'failed' ? fo?.state : undefined, wsId: p.wsId });
    }
    if (r.followed === 'failed') { stop('follow', `关注没成:${fo?.state ?? '无返回'}${fo?.why ? `(${fo.why})` : ''}`); return r; }
    r.ok = true;
    return r;
  } catch (e) {
    stop(r.liked === undefined ? 'like' : r.replied === undefined ? 'reply' : 'follow', `出错:${e instanceof Error ? e.message : String(e)}`);
    return r;
  } finally {
    releasePage(lock.token);
    running.delete(p.wsId);
    await (vpn ? recordVpn(account.restId, p, reply, r) : engage ? recordEngage(account.restId, p, reply, r) : recordAsk(account.restId, p, reply, r))
      .catch((e) => console.error(`[x.ask] ${vpn ? 'x_vpn_reply' : engage ? 'x_engage' : 'x_ask'} 没写上`, e));
    console.log(`[x.ask] @${p.handle} 推文 ${p.tweetId}:赞 ${r.liked ?? '-'} · 留言 ${r.replied ?? '-'} · 关注 ${r.followed ?? '-'}${r.detail ? ` —— ${r.detail}` : ''}`);
  }
}

/**
 * 一次求关一行(只追加)。
 * reply_source:发出去的和 Gemma 原稿一字不差 → ai;改过或没用草稿 → human(你写的终稿,才进范例库)。
 * ai_text 记原稿 —— 将来算「原样通过率」(用户 10-16 同意:近 50 条 ≥80% 才可以开自动)。
 */
async function recordAsk(account: string, p: AskRunInput, reply: string, r: AskRunResult): Promise<void> {
  const [rows] = await getXDB().query<[unknown[]]>(
    `CREATE x_ask SET account = $account, person = $person, person_handle = $handle, tweet_id = $tid, tweet_text = $ttext,
       pick_kind = $kind, reply_text = $reply, reply_source = $src, ai_text = $ai, reply_id = $rid,
       liked = $liked, replied = $replied, followed = $followed, failed_step = $fstep, failed_detail = $fdetail,
       ws_id = $ws, at = time::now() RETURN id`,
    {
      account, person: p.restId, handle: p.handle, tid: p.tweetId, ttext: p.tweetText, kind: p.pickKind, reply,
      src: replySourceOf(p.aiText, reply), ai: p.aiText,
      /** ⚠️ option 字段传 undefined(→ NONE),不传 null */
      rid: r.replyId, liked: dbState(r.liked), replied: dbState(r.replied), followed: dbState(r.followed),
      fstep: r.failedStep, fdetail: r.detail, ws: p.wsId,
    },
  );
  if (!rows || rows.length !== 1) throw new Error('CREATE x_ask 没返回行');
}

const dbState = (s: StepState | undefined): string | undefined => s;

/**
 * 互动一次一行(只追加)。pick_kind:卡片传 tweet = 回他找我的那条 → his-message;其余(他最近的 / 人换的一条)→ latest。
 * ⚠️ 卡片把「他最近的」和「人换的」都传 other,这里分不开,不假装分得开。
 */
async function recordEngage(account: string, p: AskRunInput, reply: string, r: AskRunResult): Promise<void> {
  const pick = p.pickKind === 'tweet' ? 'his-message' : 'latest';
  const [rows] = await getXDB().query<[unknown[]]>(
    `CREATE x_engage SET account = $account, person = $person, person_handle = $handle, tweet_id = $tid, tweet_text = $ttext,
       pick_kind = $kind, reply_text = $reply, reply_source = $src, ai_text = $ai, reply_id = $rid,
       liked = $liked, replied = $replied, failed_step = $fstep, failed_detail = $fdetail, ws_id = $ws, at = time::now() RETURN id`,
    {
      account, person: p.restId, handle: p.handle, tid: p.tweetId, ttext: p.tweetText, kind: pick, reply,
      src: replySourceOf(p.aiText, reply), ai: p.aiText,
      rid: r.replyId, liked: dbState(r.liked), replied: dbState(r.replied), fstep: r.failedStep, fdetail: r.detail, ws: p.wsId,
    },
  );
  if (!rows || rows.length !== 1) throw new Error('CREATE x_engage 没返回行');
}

/** 回复求助一次一行(只追加);回复真发出去了 → 这条求助帖记「回过了」,名单里不再列 */
async function recordVpn(account: string, p: AskRunInput, reply: string, r: AskRunResult): Promise<void> {
  const db = getXDB();
  const [rows] = await db.query<[unknown[]]>(
    `CREATE x_vpn_reply SET account = $account, person = $person, person_handle = $handle, tweet_id = $tid, tweet_text = $ttext,
       reply_text = $reply, reply_source = $src, ai_text = $ai, reply_id = $rid,
       liked = $liked, replied = $replied, failed_step = $fstep, failed_detail = $fdetail, ws_id = $ws, at = time::now() RETURN id`,
    {
      account, person: p.restId, handle: p.handle, tid: p.tweetId, ttext: p.tweetText, reply,
      src: replySourceOf(p.aiText, reply), ai: p.aiText,
      rid: r.replyId, liked: dbState(r.liked), replied: dbState(r.replied), fstep: r.failedStep, fdetail: r.detail, ws: p.wsId,
    },
  );
  if (!rows || rows.length !== 1) throw new Error('CREATE x_vpn_reply 没返回行');
  if (r.replied === 'ok') await db.query(`UPDATE type::record('x_vpn_post', $id) SET replied_at = time::now()`, { id: p.tweetId });
}

/** ⭐ 发出去的留言算谁写的:和 Gemma 原稿一字不差(去掉首尾空白)= ai;改过 / 没用草稿 = human(只有 human 进范例库) */
export function replySourceOf(aiText: string | undefined, reply: string): 'ai' | 'human' {
  return aiText !== undefined && aiText.trim() === reply.trim() ? 'ai' : 'human';
}
