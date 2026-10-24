/**
 * ⭐⭐ 任务「VPN求助」—— 主进程:找帖 → 判断 → 名单 → 准备回复卡(2026-10-23)
 * 纯逻辑在 x-vpn-help.ts。设计见 docs/10-business-design/x/vpn-help-task.md。
 */
import { getXDB } from '@storage/surreal/client';
import { callOllamaChat } from '@platform/main/local-llm/ollama-client';
import { listAllRecipes } from '@platform/main/db/search-recipe-repo';
import { recipeToQuery } from './x-recipe-query';
import { collectSearchByScroll } from './x-search-scroll';
import { readWsAccount } from './x-account-repo';
import { recordSearch, searchBudget } from './x-search-budget';
import { getXHostState } from './x-host-registry';
import { acquirePage, releasePage } from './x-page-lock';
import { readPerson } from './x-people-repo';
import { readDeferred } from './x-defer-repo';
import { loadEngageThread } from './x-engage-thread';
import { ASK_DRAFT_MODEL } from './x-ask-draft';
import { VPN_FRESH_HOURS, VPN_RECIPES, buildJudgePrompt, matchesRecipe, parseJudge, type JudgeExample, type VpnVerdict } from './x-vpn-help';
import type { AskPrepared } from './x-ask-prepare';

const since24 = (now = new Date()): string => new Date(now.getTime() - VPN_FRESH_HOURS * 3600_000).toISOString();
/** 一次找帖最多翻几页(四条配方合计)—— 不超过搜索额度账本剩的 */
const FIND_PAGES = 20;
const FULL_PAGE = 18;

export type VpnFindResult = {
  readonly runs: ReadonlyArray<{ readonly recipe: string; readonly pages: number; readonly tweets: number; readonly added: number; readonly problem?: string }>;
  readonly note?: string;
};

/**
 * ⭐ 找一轮:库里的四条 VPN 配方,各搜最近 24 小时(配方原样,时间窗按任务定的 24 小时)→ 新帖登记进 x_vpn_post。
 * 按搜索额度账本分页数;撞限流(含悄悄限流)就停,15 分钟后再来(记账本)。
 */
export async function findVpnPosts(wsId: string): Promise<{ ok: false; why: string } | ({ ok: true } & VpnFindResult)> {
  const acc = await readWsAccount(wsId);
  if (!acc?.restId) return { ok: false, why: `${wsId} 还没认出登录的号` };
  const budget = searchBudget();
  if (budget.waitUntil !== undefined) return { ok: true, runs: [], note: `刚撞过限流,${new Date(budget.waitUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} 后再找` };
  const all = await listAllRecipes();
  const recipes = VPN_RECIPES.map((n) => all.find((r) => r.name === n)).filter((r): r is NonNullable<typeof r> => r !== undefined);
  const missing = VPN_RECIPES.filter((n) => !all.some((r) => r.name === n));
  if (recipes.length === 0) return { ok: false, why: `库里没有 VPN 配方(${VPN_RECIPES.join(' / ')})` };
  let left = Math.min(FIND_PAGES, budget.freePages);
  const runs: Array<{ recipe: string; pages: number; tweets: number; added: number; problem?: string }> = [];
  for (const [i, r] of recipes.entries()) {
    const want = Math.floor(left / (recipes.length - i));
    if (want < 1) { runs.push({ recipe: r.name, pages: 0, tweets: 0, added: 0, problem: '搜索额度不够,下次再找' }); continue; }
    const q = recipeToQuery({ ...r, sinceHours: VPN_FRESH_HOURS }, Date.now());
    if (q.problems.length > 0) { runs.push({ recipe: r.name, pages: 0, tweets: 0, added: 0, problem: `配方有问题:${q.problems.join(';')}` }); continue; }
    const s = await collectSearchByScroll({ wsId, q: q.q, f: q.resultType, wantPages: want, maxMs: 4 * 60_000, recipeName: r.name });
    const pages = s.totals?.pages ?? 0;
    left -= Math.max(pages, 1);
    const bottom = (s.harvest as { reachedBottom?: boolean } | undefined)?.reachedBottom === true;
    const throttled = s.ok && !s.rateLimited && bottom && pages <= 1 && want > 1 && (s.totals?.xTweets ?? 0) >= FULL_PAGE;
    if (throttled) recordSearch(0, true);
    const added = s.ok ? await registerPosts(acc.restId, r.name, q.q, r.keywords ?? [], r.template === 'help-wanted' ? r.helpSignals ?? [] : []) : 0;
    const problem = !s.ok ? s.why : s.rateLimited ? '撞了限流' : throttled ? '疑似悄悄限流' : undefined;
    runs.push({ recipe: r.name, pages, tweets: s.totals?.uniqueTweets ?? 0, added, problem });
    console.log(`[x.vpn] 找帖「${r.name}」${pages}/${want} 页 ${s.totals?.uniqueTweets ?? 0} 条 · 新登记 ${added}${problem ? ` —— ${problem}` : ''}`);
    if (!s.ok || s.rateLimited || throttled) break;
  }
  const note = missing.length > 0 ? `库里少了配方:${missing.join(' / ')}` : undefined;
  return { ok: true, runs, note };
}

/** 这一轮搜到的、24 小时内、别人发的、**自己命中配方**的 → 登记(已登记的不动) */
async function registerPosts(account: string, recipe: string, q: string, keywords: readonly string[], signals: readonly string[]): Promise<number> {
  const db = getXDB();
  const [found] = await db.query<[Array<{ tweet_id: string; text?: string; author_rest_id?: string; author_handle?: string; created_at: string }>]>(
    `SELECT tweet_id, text, author_rest_id, author_handle, <string> created_at AS created_at FROM x_tweet
       WHERE search_recipe = $q AND author_rest_id != $a AND retweet_of_id = NONE AND created_at >= type::datetime($since)`,
    { q, a: account, since: since24() },
  );
  const rows = (found ?? []).filter((t) => matchesRecipe(t.text ?? '', keywords, signals));
  let added = 0;
  for (const t of rows) {
    const [r] = await db.query<[Array<{ fresh: boolean }>]>(
      `UPSERT type::record('x_vpn_post', $id) SET account = $a, tweet_id = $id, recipe = (IF recipe = NONE THEN $recipe ELSE recipe END),
         author_rest_id = $ar, author_handle = $ah, posted_at = type::datetime($pa),
         found_at = (IF found_at = NONE THEN time::now() ELSE found_at END) RETURN (judged_at = NONE AND human = NONE AND found_at > time::now() - 1m) AS fresh`,
      { id: t.tweet_id, a: account, recipe, ar: t.author_rest_id, ah: t.author_handle, pa: t.created_at },
    );
    if (r?.[0]?.fresh) added += 1;
  }
  return added;
}

/** 人工判过的例子(旧的 tweet_feedback 约 6900 条 —— 值得 / 不值得各取最近几条) */
async function judgeExamples(): Promise<JudgeExample[]> {
  const [acc, rej] = await getXDB().query<[Array<{ text: string }>, Array<{ text: string }>]>(
    `SELECT text, created_at FROM tweet_feedback WHERE verdict = 'accept' AND text != '' ORDER BY created_at DESC LIMIT 4;
     SELECT text, created_at FROM tweet_feedback WHERE verdict = 'reject' AND text != '' ORDER BY created_at DESC LIMIT 4;`,
  );
  return [...(acc ?? []).map((r) => ({ text: r.text, verdict: 'accept' as const })), ...(rej ?? []).map((r) => ({ text: r.text, verdict: 'reject' as const }))];
}

let judging = false;
/**
 * ⭐ 判断最多 limit 条还没判的(24 小时内,新的在前)—— 一次一条、对象契约。
 * 模型没答 / 答得不对 → 记 judge_error,下次重判;**绝不当成「不值得」**(记忆 project-x-judge-array-contract-spin)。
 */
export async function judgeVpnPosts(account: string, limit: number): Promise<{ judged: number; failed: number; left: number }> {
  if (judging) return { judged: 0, failed: 0, left: -1 };
  judging = true;
  try {
    const db = getXDB();
    const [rows] = await db.query<[Array<{ tweet_id: string }>]>(
      `SELECT tweet_id, posted_at FROM x_vpn_post WHERE account = $a AND judged_at = NONE AND human = NONE AND posted_at >= type::datetime($since)
         ORDER BY posted_at DESC LIMIT $n`,
      { a: account, since: since24(), n: limit },
    );
    const examples = await judgeExamples();
    let judged = 0; let failed = 0;
    for (const p of rows ?? []) {
      const [tw] = await db.query<[Array<{ text?: string; lang?: string; in_reply_to?: string }>]>(
        'SELECT text, lang, in_reply_to FROM x_tweet WHERE tweet_id = $id', { id: p.tweet_id },
      );
      const t = tw?.[0];
      if (!t?.text) { await db.query(`UPDATE type::record('x_vpn_post', $id) SET judge_error = '库里没有这条的正文'`, { id: p.tweet_id }); failed += 1; continue; }
      const [par] = t.in_reply_to ? await db.query<[Array<{ text?: string }>]>('SELECT text FROM x_tweet WHERE tweet_id = $id', { id: t.in_reply_to }) : [[]];
      const t0 = Date.now();
      let res: { verdict: VpnVerdict } | { problem: string };
      try {
        const raw = (await callOllamaChat({
          model: ASK_DRAFT_MODEL, messages: buildJudgePrompt({ text: t.text, lang: t.lang, parent: par?.[0]?.text, examples }),
          think: false, temperature: 0.1, timeoutMs: 60_000,
        })).content;
        res = parseJudge(raw);
      } catch (e) {
        res = { problem: `Gemma 没回:${e instanceof Error ? e.message : String(e)}` };
      }
      if ('problem' in res) {
        await db.query(`UPDATE type::record('x_vpn_post', $id) SET judge_error = $e`, { id: p.tweet_id, e: res.problem });
        failed += 1;
        console.warn(`[x.vpn] 判断 ${p.tweet_id} 没成:${res.problem}`);
        continue;
      }
      await db.query(
        `UPDATE type::record('x_vpn_post', $id) SET verdict = $v, judged_at = time::now(), judge_error = NONE`,
        { id: p.tweet_id, v: { ...res.verdict, model: ASK_DRAFT_MODEL, ms: Date.now() - t0 } },
      );
      judged += 1;
    }
    const [left] = await db.query<[Array<{ n: number }>]>(
      `SELECT count() AS n FROM x_vpn_post WHERE account = $a AND judged_at = NONE AND human = NONE AND posted_at >= type::datetime($since) GROUP ALL`,
      { a: account, since: since24() },
    );
    return { judged, failed, left: left?.[0]?.n ?? 0 };
  } finally {
    judging = false;
  }
}

/**
 * 一次性清理:已登记、还没人判过的里,自己没命中配方的(被引用 / 上文)删掉 —— 修 registerPosts 之前登记进来的
 */
export async function pruneVpnPosts(account: string): Promise<{ removed: number; kept: number }> {
  const db = getXDB();
  const recipes = await listAllRecipes();
  const [rows] = await db.query<[Array<{ tweet_id: string; recipe: string }>]>(
    'SELECT tweet_id, recipe FROM x_vpn_post WHERE account = $a AND human = NONE AND replied_at = NONE', { a: account });
  let removed = 0;
  for (const p of rows ?? []) {
    const r = recipes.find((x) => x.name === p.recipe);
    const [tw] = await db.query<[Array<{ text?: string }>]>('SELECT text FROM x_tweet WHERE tweet_id = $id', { id: p.tweet_id });
    if (r && matchesRecipe(tw?.[0]?.text ?? '', r.keywords ?? [], r.template === 'help-wanted' ? r.helpSignals ?? [] : [])) continue;
    await db.query(`DELETE type::record('x_vpn_post', $id)`, { id: p.tweet_id });
    removed += 1;
  }
  return { removed, kept: (rows ?? []).length - removed };
}

export type VpnPostRow = {
  readonly tweetId: string; readonly recipe: string; readonly text: string; readonly lang?: string;
  readonly authorRestId?: string; readonly handle?: string; readonly name?: string; readonly followers?: number;
  readonly postedAt?: string; readonly verdict?: VpnVerdict; readonly judgeError?: string; readonly human?: 'accept' | 'reject';
};

export type VpnOverview = {
  readonly worth: readonly VpnPostRow[];
  readonly notWorth: readonly VpnPostRow[];
  readonly pending: readonly VpnPostRow[];
  readonly replied: ReadonlyArray<{ readonly tweetId: string; readonly handle: string; readonly tweetText: string; readonly reply: string; readonly at: string; readonly ok: boolean; readonly source: string }>;
  readonly expired: number;
  readonly deferred: number;
  readonly lastFoundAt?: string;
  readonly freshHours: number;
};

/** ⭐ 名单:24 小时内的;你推翻过的以你为准;回过的、最近放一放的不列 */
export async function readVpnOverview(account: string, now = new Date()): Promise<VpnOverview> {
  const db = getXDB();
  const [posts, replied, expired, last] = await db.query<[
    Array<{ tweet_id: string; recipe: string; author_rest_id?: string; author_handle?: string; posted_at?: string; verdict?: VpnVerdict; judge_error?: string; human?: 'accept' | 'reject' }>,
    Array<{ tweet_id: string; person_handle: string; tweet_text: string; reply_text: string; at: string; replied?: string; reply_source: string }>,
    Array<{ n: number }>,
    Array<{ t: string }>,
  ]>(
    `SELECT tweet_id, recipe, author_rest_id, author_handle, (IF posted_at != NONE THEN <string> posted_at ELSE NONE END) AS posted_at, verdict, judge_error, human
       FROM x_vpn_post WHERE account = $a AND replied_at = NONE AND posted_at >= type::datetime($since) ORDER BY posted_at DESC;
     SELECT tweet_id, person_handle, tweet_text, reply_text, <string> at AS at, replied, reply_source FROM x_vpn_reply WHERE account = $a ORDER BY at DESC LIMIT 50;
     SELECT count() AS n FROM x_vpn_post WHERE account = $a AND replied_at = NONE AND posted_at < type::datetime($since) GROUP ALL;
     SELECT <string> found_at AS t FROM x_vpn_post WHERE account = $a ORDER BY t DESC LIMIT 1;`,
    { a: account, since: since24(now) },
  );
  const deferred = new Set(await readDeferred(account, 'vpn', now));
  const ids = (posts ?? []).map((p) => p.tweet_id);
  const authors = [...new Set((posts ?? []).map((p) => p.author_rest_id).filter((x): x is string => !!x))];
  const [tws, people] = await db.query<[Array<{ tweet_id: string; text?: string; lang?: string }>, Array<{ rest_id: string; display_name?: string; followers_count?: number }>]>(
    `SELECT tweet_id, text, lang FROM x_tweet WHERE tweet_id IN $ids;
     SELECT rest_id, display_name, followers_count FROM x_author WHERE rest_id IN $au;`,
    { ids, au: authors },
  );
  const text = new Map((tws ?? []).map((t) => [t.tweet_id, t]));
  const who = new Map((people ?? []).map((p) => [p.rest_id, p]));
  const rows: VpnPostRow[] = (posts ?? []).filter((p) => !p.author_rest_id || !deferred.has(p.author_rest_id)).map((p) => ({
    tweetId: p.tweet_id, recipe: p.recipe, text: text.get(p.tweet_id)?.text ?? '', lang: text.get(p.tweet_id)?.lang,
    authorRestId: p.author_rest_id, handle: p.author_handle, name: p.author_rest_id ? who.get(p.author_rest_id)?.display_name : undefined,
    followers: p.author_rest_id ? who.get(p.author_rest_id)?.followers_count : undefined,
    postedAt: p.posted_at ?? undefined, verdict: p.verdict ?? undefined, judgeError: p.judge_error ?? undefined, human: p.human ?? undefined,
  }));
  const isWorth = (r: VpnPostRow): boolean => (r.human ? r.human === 'accept' : r.verdict?.worth === true);
  return {
    worth: rows.filter((r) => (r.human || r.verdict) && isWorth(r)),
    notWorth: rows.filter((r) => (r.human || r.verdict) && !isWorth(r)),
    pending: rows.filter((r) => !r.human && !r.verdict),
    replied: (replied ?? []).map((r) => ({ tweetId: r.tweet_id, handle: r.person_handle, tweetText: r.tweet_text, reply: r.reply_text, at: r.at, ok: r.replied === 'ok', source: r.reply_source })),
    expired: expired?.[0]?.n ?? 0,
    deferred: (posts ?? []).filter((p) => p.author_rest_id && deferred.has(p.author_rest_id)).length,
    lastFoundAt: last?.[0]?.t,
    freshHours: VPN_FRESH_HOURS,
  };
}

/** ⭐ 你推翻 Gemma:值得 / 不值得 —— 写进 x_vpn_post,也写进 tweet_feedback(以后判断的例子从这里来) */
export async function setVpnHuman(account: string, tweetId: string, human: 'accept' | 'reject'): Promise<void> {
  const db = getXDB();
  const [rows] = await db.query<[Array<{ tweet_id: string; recipe: string; author_handle?: string; verdict?: object }>]>(
    `UPDATE type::record('x_vpn_post', $id) SET human = $h, human_at = time::now() WHERE account = $a RETURN tweet_id, recipe, author_handle, verdict`,
    { id: tweetId, h: human, a: account },
  );
  const p = rows?.[0];
  if (!p) throw new Error(`[x.vpn] 名单里没有这条(${tweetId})`);
  const [tw] = await db.query<[Array<{ text?: string; lang?: string }>]>('SELECT text, lang FROM x_tweet WHERE tweet_id = $id', { id: tweetId });
  await db.query(
    `CREATE tweet_feedback SET tweet_id = $id, text = $t, lang = $l, author_handle = $h, verdict = $v, source_recipe = $r, created_at = time::now(), ai_verdict = $ai`,
    { id: tweetId, t: tw?.[0]?.text ?? '', l: tw?.[0]?.lang, h: p.author_handle ?? '', v: human, r: p.recipe, ai: p.verdict },
  );
}

/** ⭐ 回复卡准备:这条帖子(库里)+ 他的资料 + 来龙去脉(先看上一层确认真和 VPN 相关 —— 用户 09-06 定的顺序) */
export async function prepareVpn(wsId: string, account: string, tweetId: string): Promise<AskPrepared> {
  const wcId = getXHostState(wsId)?.wcId;
  if (wcId === undefined) return { ok: false, why: 'X 网页没开' };
  /** ⭐⭐ 读来龙去脉要用 X 网页 —— 期间占住(Module5-04 §1.3 bug 2) */
  const lock = acquirePage(wcId, `求助回复卡:准备 ${tweetId}`, 'ui');
  if (!lock.ok) return lock;
  try {
    return await prepareVpnOn(wcId, account, tweetId);
  } finally {
    releasePage(lock.token);
  }
}

async function prepareVpnOn(wcId: number, account: string, tweetId: string): Promise<AskPrepared> {
  const db = getXDB();
  const [posts, tws] = await db.query<[Array<{ author_rest_id?: string; author_handle?: string; verdict?: VpnVerdict }>, Array<{ text?: string; created_at?: string }>]>(
    `SELECT author_rest_id, author_handle, verdict FROM type::record('x_vpn_post', $id);
     SELECT text, (IF created_at != NONE THEN <string> created_at ELSE NONE END) AS created_at FROM x_tweet WHERE tweet_id = $id;`,
    { id: tweetId },
  );
  const post = posts?.[0];
  const tw = tws?.[0];
  if (!post?.author_rest_id || !post.author_handle) return { ok: false, why: '名单里这条没有作者' };
  if (!tw?.text) return { ok: false, why: '库里没有这条的正文' };
  const p = await readPerson(account, post.author_rest_id);
  const tweet = { id: tweetId, text: tw.text, createdAt: tw.created_at ?? undefined, url: `https://x.com/${post.author_handle}/status/${tweetId}`, related: true };
  const thread = await loadEngageThread(wcId, account, post.author_rest_id, tweetId);
  return {
    ok: true,
    person: { restId: post.author_rest_id, handle: post.author_handle, name: p?.display_name, bio: p?.bio, followers: p?.followers_count, followsMe: p?.follows_me },
    plan: { kind: 'tweet', tweet, recent: [tweet], why: post.verdict ? `Gemma:${post.verdict.reason}` : '你选的求助帖' },
    thread,
  };
}
