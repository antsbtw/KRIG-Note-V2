/**
 * ⭐⭐ X 的流程(Module5-04 第 4 步 4b,2026-10-26)—— 原来写在界面组件里的循环,搬到主进程
 *
 *   x.engage.screenBatch   互动先过一轮:勾的人逐个采主页看 2 小时内有没有动静,没动静的放一放(原 XTaskEngage startEngage)
 *   x.vpn.judgeAll         判求助帖:5 条一批地问 Gemma,直到判完(原 XTaskVpn judgeAll)
 *   x.blueMutual.find      找蓝V:配方「蓝V互关」搜索截获 → 扫一遍互关倾向(原 XTaskBlueMutual findOnce)
 *   x.person.collectRange  人卡当场采一段:帖子 / 回复 / 转发逐页采,第一次翻页被拒就重载再试,存库、留痕(原 XOpsPeople collectTweets)
 *
 * 每一步都是能力调用(f.call),记录挂在这次流程名下;界面只「开始 → 看进度(flow.runs)→ 可叫停(flow.stop)」。
 * 逻辑原样搬,不改判断(原代码里的注释和用户原话跟着搬过来)。
 */
import { defineFlow } from '@platform/main/capability/flow';
import type { CapResult } from '@platform/main/capability/capability';
import { traceRecorder } from '@platform/main/web-capability/wiring/runtime';
import type { SearchRecipe } from '@shared/types/x-timeline-types';
import { Bad, digits, int, str, pageNeed, type O } from './x-capabilities-common';
import { pageResource } from './x-page-lock';
import { recipeToQuery } from './x-recipe-query';
import { cancelPersonCollect, personCollectProgress } from './x-person-collect';
import { LIVE_PAGE_CAP, PERSON_TABS, TIMELINE_RANGES, rangeStart, worthReloadRetry, type TimelineRange } from './x-person-timeline';
import { readSettings } from './x-ops-actions-repo';
import type { CollectOnWebviewResult } from './x-collect-on-webview';

const obj = (raw: unknown): O => (raw && typeof raw === 'object' ? (raw as O) : {});
const parseWith = <I>(fn: (o: O) => I) => (raw: unknown): I | string => {
  try { return fn(obj(raw)); } catch (e) { if (e instanceof Bad) return e.why; throw e; }
};
const okValue = <T>(r: CapResult<unknown>): T | undefined => (r.ok ? (r.value as T) : undefined);

type Person = { readonly restId: string; readonly handle: string; readonly hisAt?: string };
type ScreenIn = { readonly wsId: string; readonly people: readonly Person[] };
type ScreenOut = { readonly active: Person[]; readonly quiet: Person[]; readonly unknown: Person[]; readonly stopped: boolean };
type WsIn = { readonly wsId: string };
type FindIn = { readonly wsId: string; readonly pages: number };
type RangeIn = { readonly wsId: string; readonly restId: string; readonly handle: string; readonly range: TimelineRange };
type RangeOut = { readonly label: string; readonly parts: string[]; readonly text: string };

export function registerXFlows(): void {
  /**
   * 用户 10-23:「应该是我勾选15人后,自动先过一轮最新的用户推文,然后再筛选出那些近期有发推的人,没有的就先放一放。」
   * · 2 小时内有动静 → 进卡;没动静 → 放一放(记进 x_defer);
   * · 没采到(网页忙 / 去不到主页)→ 不放一放,照样进卡(卡上会再采一次)—— 是我们没看到,不算他没动静
   */
  defineFlow<ScreenIn, ScreenOut>({
    id: 'x.engage.screenBatch', describe: '互动先过一轮(勾的人逐个看 2 小时内有没有动静,没动静的放一放)',
    inputDoc: { wsId: '哪个 workspace', people: '[{ restId, handle, hisAt? }],1–50 个' },
    parse: parseWith((o) => {
      if (!Array.isArray(o.people) || o.people.length === 0 || o.people.length > 50) throw new Bad('people 要 1–50 个');
      const people = (o.people as O[]).map((p, n) => {
        if (!p || typeof p.restId !== 'string' || !/^\d+$/.test(p.restId) || typeof p.handle !== 'string' || p.handle === '') throw new Bad(`people[${n}] 要数字 restId + handle`);
        return { restId: p.restId, handle: p.handle, hisAt: typeof p.hisAt === 'string' ? p.hisAt : undefined } as Person;
      });
      return { wsId: str(o, 'wsId'), people };
    }),
    scope: (i) => i.wsId,
    run: async (i, f) => {
      const active: Person[] = []; const quiet: Person[] = []; const unknown: Person[] = [];
      for (const [k, w] of i.people.entries()) {
        if (f.stopped()) { unknown.push(...i.people.slice(k)); break; }
        f.step(k + 1, i.people.length, `过一轮 ${k + 1}/${i.people.length}:@${w.handle}`);
        const r = await f.call('x.engage.screen', { wsId: i.wsId, restId: w.restId, handle: w.handle, hisAt: w.hisAt });
        const v = okValue<{ active: boolean }>(r);
        if (!v) { unknown.push(w); continue; }
        if (v.active) { active.push(w); continue; }
        const d = await f.call('x.person.defer', { wsId: i.wsId, restId: w.restId, mode: 'engage' });
        if (d.ok) quiet.push(w); else unknown.push(w);
      }
      return { active, quiet, unknown, stopped: f.stopped() };
    },
    summarize: (out) => ({ active: out.active.length, quiet: out.quiet.length, unknown: out.unknown.length, stopped: out.stopped }),
  });

  /** 判断还没判的:一次 5 条地问,直到判完或叫停 —— 进度看得见 */
  defineFlow<WsIn, { judged: number; failed: number; note?: string }>({
    id: 'x.vpn.judgeAll', describe: '判求助帖(5 条一批地问 Gemma,直到判完)',
    inputDoc: { wsId: '哪个 workspace 的号' },
    parse: parseWith((o) => ({ wsId: str(o, 'wsId') })),
    scope: (i) => i.wsId,
    run: async (i, f) => {
      let judged = 0; let failed = 0; let note: string | undefined;
      for (let round = 1; ; round += 1) {
        if (f.stopped()) { note = '叫停了'; break; }
        f.say(`Gemma 判断中…已判 ${judged} 条${failed ? `(${failed} 条没判成,下次重判)` : ''}`);
        const r = await f.call('x.vpn.judge', { wsId: i.wsId, limit: 5 });
        if (!r.ok) { note = r.why; break; }
        const v = r.value as { judged: number; failed: number; left: number };
        judged += v.judged; failed += v.failed;
        if (v.left === 0 || v.judged + v.failed === 0) break;
        if (round > 200) { note = '一轮判了 1000 条还没判完,先停(防空转)'; break; }
      }
      return { judged, failed, note };
    },
  });

  /** ⭐ 1 找人:配方「蓝V互关」→ 滚动截获(每页对账、存库回读)→ 扫一遍互关倾向 */
  defineFlow<FindIn, unknown>({
    id: 'x.blueMutual.find', describe: '找蓝V(配方「蓝V互关」搜索截获,再扫一遍互关倾向)',
    inputDoc: { wsId: '哪个 workspace 的 X 网页', pages: '最多几页,1–40' },
    parse: parseWith((o) => ({ wsId: str(o, 'wsId'), pages: int(o, 'pages', 1, 40) })),
    scope: (i) => i.wsId,
    run: async (i, f) => {
      f.say('读配方…');
      const lr = await f.call('x.recipe.list', {});
      const recipe = (okValue<SearchRecipe[]>(lr) ?? []).find((x) => x.name === '蓝V互关');
      if (!recipe) return { ok: false as const, why: '找不到配方「蓝V互关」—— 先建配方' };
      const q = recipeToQuery(recipe);
      if (q.problems.length > 0) return { ok: false as const, why: `配方有问题:${q.problems.join(';')}` };
      f.say(`找人中:让页面自己翻页,最多 ${i.pages} 页,每页对账…(左边 X 网页别动)`);
      const sr = await f.call('x.search.scroll', { wsId: i.wsId, q: q.q, f: q.resultType, wantPages: i.pages, maxMs: 10 * 60_000 });
      if (!sr.ok) return { ok: false as const, why: `找人没成:${sr.why}` };
      f.say('判断互关倾向中…');
      const sc = await f.call('x.intent.scan', {});
      return { ok: true as const, scroll: sr.value, intentScan: sc.ok ? sc.value : { why: sc.why } };
    },
  });

  /**
   * ⭐⭐ 采他的帖子 / 回复 / 转发 —— 当场采一段(2026-10-10 用户:「可以配置获取的长度」;半年以上走后台任务)。
   * 每个标签页:去那一页 → 游标翻页(主进程 collectOnWebview,每页一存、逐页账)→ 整批再存一次(作者进人表)。
   * ⭐ 最多两次:第一次翻页就被拒(翻页模板没带鉴权头)时,重载这一页再试一次(2026-10-12 真机)。
   * 整段占着网页;每个标签页的结果都留痕(成功路径也要留,2026-10-10)。叫停 → 通知正在翻页的那次停下。
   */
  defineFlow<RangeIn, RangeOut, { wcId: number }>({
    id: 'x.person.collectRange', describe: '人卡当场采一段(帖子 / 回复 / 转发,第一次翻页被拒就重载再试)',
    inputDoc: { wsId: '哪个 workspace 的 X 网页', restId: '他的数字 id', handle: '他的 handle', range: `时间范围:${TIMELINE_RANGES.map((r) => r.id).join(' / ')}` },
    parse: parseWith((o) => {
      if (!TIMELINE_RANGES.some((r) => r.id === o.range)) throw new Bad(`range 只认 ${TIMELINE_RANGES.map((r) => r.id).join(' / ')}`);
      return { wsId: str(o, 'wsId'), restId: digits(o, 'restId'), handle: str(o, 'handle'), range: o.range as TimelineRange };
    }),
    scope: (i) => i.wsId,
    subject: (i) => `x_author:${i.restId}`,
    prepare: async (i) => {
      const p = pageNeed(i.wsId, '运营正在采他的推文');
      return 'refused' in p ? p : { needs: [p.need], ctx: { wcId: p.wcId } };
    },
    run: async (i, f) => {
      const wcId = f.prep.wcId;
      const token = f.held.get(pageResource(wcId)) as string;
      const start = rangeStart(i.range, new Date());
      const label = TIMELINE_RANGES.find((r) => r.id === i.range)?.label ?? i.range;
      const pageCap = (await readSettings()).settings['collect.live_page_cap'] ?? LIVE_PAGE_CAP;
      /** 叫停 → 通知正在翻页的那次(翻页每轮开头 / 歇着时会看这个标记) */
      f.onStop(() => { cancelPersonCollect(wcId); });
      const parts: string[] = [];
      const say = (msg: string): void => f.say(`[${label}] ${parts.join(';')}${parts.length ? ';' : ''}${msg}`);
      for (const [k, tab] of PERSON_TABS.entries()) {
        if (f.stopped()) { parts.push(`${tab.label}:人点了停止`); break; }
        f.step(k + 1, PERSON_TABS.length);
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          say(`正在采${tab.label}…${attempt > 1 ? '(重载后第 2 次)' : ''}`);
          /** 翻页那一层每句进度只在主进程内存里 —— 每秒抄一句到流程进度,界面看得见 */
          let seen = 0;
          const tick = setInterval(() => {
            const pr = personCollectProgress(wcId);
            if (pr && pr.seq !== seen && pr.msg) { seen = pr.seq; say(`${tab.label}:${pr.msg}`); }
          }, 1000);
          let res: CapResult<unknown>;
          try {
            res = await f.call('x.person.collectTab', {
              wcId, page: tab.name, handle: i.handle, restId: i.restId, start: start?.toISOString(), pageCap, attempt, ownToken: token,
            });
          } finally {
            clearInterval(tick);
          }
          if (!res.ok) { parts.push(`${tab.label}:${res.why}`); break; }
          const run = res.value as CollectOnWebviewResult;
          if (!run.reached) { parts.push(`${tab.label}:没去到这一页(${run.reason})`); break; }
          const records = [...run.records];
          const pages = (run.paging?.rounds ?? 0) + 1;
          const why = run.paging?.stopReason ?? '';
          const authFail = worthReloadRetry(why, run.paging?.rounds ?? 0);
          /** ⚠️ 每页已在主进程先存过(逐页账,2026-10-16)—— 新增要加上每页累计的 */
          let inserted = run.pageInserted ?? 0;
          if (records.length > 0) {
            const sv = await f.call('x.tweet.save', { records, ctx: { source: tab.name, wcId } });
            if (!sv.ok) { parts.push(`${tab.label}没存进库:${sv.why}`); break; }
            inserted += (sv.value as { inserted: number }).inserted;
          }
          /** ⭐⭐ 每个标签页(每次尝试)的结果落留痕 —— 事后分得清「第一页就按时间停」还是「根本没翻页」 */
          const entry = { restId: i.restId, handle: i.handle, range: i.range, tab: tab.name, pages, records: records.length, inserted, stopReason: `${attempt > 1 ? '[第 2 次] ' : ''}${why}` };
          console.log(`[x.people] 采 @${entry.handle} ${entry.tab}(${entry.range}):${entry.pages} 页 ${entry.records} 条(新 ${entry.inserted})—— ${entry.stopReason || '(无停因)'}`);
          traceRecorder.lifecycle({ layer: 'web.net', event: 'x-person-collect', pageId: 'x-data', detail: { ...entry, runId: f.runId } });
          if (authFail && attempt === 1 && !f.stopped()) continue;
          parts.push(`${tab.label} ${pages} 页 ${records.length} 条(新 ${inserted})${attempt > 1 ? '[重载后]' : ''}${why ? ` —— ${why}` : ''}`);
          break;
        }
      }
      return { label, parts, text: `[${label}] 采完:${parts.join(';')}` };
    },
    summarize: (out) => ({ text: out.text }),
  });
}
