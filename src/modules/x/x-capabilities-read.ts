/**
 * ⭐⭐ X 读库类能力(Module5-04 第 3 步第 1 批,2026-10-24)—— 原来 x-data-ipc 里 26 个纯读的 op
 *
 * 每个能力一条:id / 给 AI 读的一句话 / 参数 / 要不要认号 / 是不是状态轮询 / 读哪个函数。
 * 认号、参数校验在这里写一份(原来 IPC 校验、收件箱不校验)。读的函数原样调,不重写。
 * 状态轮询(界面每 1–5 秒刷新的)标 probe:记录照记、只留 7 天(用户 10-24)。
 */
import { defineCapability } from '@platform/main/capability/capability';
import { listAllRecipes } from '@platform/main/db/search-recipe-repo';
import { readWsAccount } from './x-account-repo';
import { readCursor } from './x-cursor-repo';
import { readOpsStatus } from './x-collect-log-repo';
import { queryPeople, readFriendCircle, readPeopleOverview, readPerson, readPersonTweets, readTagCatalog } from './x-people-repo';
import { readBlueMutualOverview, readCandidates, readFollowProgress } from './x-task-blue-mutual';
import { readFollowGate, readSettings, readUnfollowGate } from './x-ops-actions-repo';
import { localDayStart } from './x-ops-settings';
import { readAskStatuses, readLastFollowCheck, readPersonTimeline } from './x-follow-check-repo';
import { followCheckRunning } from './x-follow-check';
import { listRelationJobs } from './x-relation-task';
import { readPaceViews } from './x-pace-repo';
import { readPersonLists } from './x-list-member-repo';
import { readVpnOverview } from './x-vpn-run';
import { readDraftRules } from './x-ask-draft';
import { followQueueStatus } from './x-follow-queue';
import { listJobs } from './x-bg-job-repo';
import { bgRunnerStatus } from './x-bg-runner';
import { personCollectProgress } from './x-person-collect';
import { DEFAULT_PEOPLE_FILTER, PEOPLE_GROUPS, PEOPLE_SORTS, type PeopleFilter } from './x-people-query';

type O = Record<string, unknown>;
type Acc = { readonly restId: string; readonly handle: string };

/** 认出这个 ws 登录的号(要数字 id)—— 与 x-capabilities.ts 同一句话 */
export async function wsAccount(wsId: string): Promise<Acc | { refused: string }> {
  const a = await readWsAccount(wsId);
  if (!a) return { refused: `${wsId} 还没认出登录的是哪个号 —— 打开 X 网页,在运营面板点「认号」` };
  if (!a.restId) return { refused: `${wsId} 登录的是 @${a.handle},但数字 id 还没拿到 —— 在运营面板点「认号」` };
  return { restId: a.restId, handle: a.handle };
}

// ── 参数小工具:返回值或 Bad(原因)──
class Bad { constructor(readonly why: string) {} }
const str = (o: O, k: string): string => { const v = o[k]; if (typeof v !== 'string' || v.trim() === '') throw new Bad(`要 ${k}`); return v; };
const digits = (o: O, k: string): string => { const v = o[k]; if (typeof v !== 'string' || !/^\d+$/.test(v)) throw new Bad(`${k} 要数字 id`); return v; };
const int = (o: O, k: string, lo: number, hi: number, def?: number): number => {
  const v = o[k] === undefined ? def : o[k];
  if (!Number.isInteger(v) || (v as number) < lo || (v as number) > hi) throw new Bad(`${k} 要 ${lo}–${hi} 的整数`);
  return v as number;
};
const iso = (o: O, k: string): string => { const v = o[k]; if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) throw new Bad(`${k} 要 ISO 时间`); return v; };
/**
 * 筛选条件:没给的字段用默认值(AI / 收件箱可以只给 group);分组 / 范围 / 排序认不出 → invalid
 * (2026-10-24 Windows 真机:原来不校验,跑进 queryPeople 才抛「不认识的分组」,被记成 failed)
 */
const peopleFilter = (raw: unknown): PeopleFilter => {
  const f = { ...DEFAULT_PEOPLE_FILTER, ...(raw && typeof raw === 'object' ? (raw as Partial<PeopleFilter>) : {}) };
  if (!PEOPLE_GROUPS.some((g) => g.id === f.group)) throw new Bad(`filter.group 只认 ${PEOPLE_GROUPS.map((g) => g.id).join(' / ')}`);
  if (f.scope !== 'in' && f.scope !== 'excluded') throw new Bad('filter.scope 只认 in / excluded');
  if (!PEOPLE_SORTS.some((x) => x.id === f.sort)) throw new Bad(`filter.sort 只认 ${PEOPLE_SORTS.map((x) => x.id).join(' / ')}`);
  return f;
};
const modeOf = (m: unknown): 'ask' | 'engage' | 'vpn' => (m === 'engage' || m === 'vpn' ? m : 'ask');

/**
 * 一条读库能力。
 * @param account 要认号就给「从参数里取 wsId」;认出的号作为 run 的第二个参数
 */
function read<I extends O>(def: {
  readonly id: string;
  readonly describe: string;
  readonly inputDoc: Readonly<Record<string, string>>;
  readonly parse: (o: O) => I;
  readonly account?: boolean;
  readonly probe?: boolean;
  readonly run: (i: I, acc: Acc) => Promise<unknown> | unknown;
}): void {
  defineCapability<I, unknown, Acc>({
    id: def.id,
    kind: 'input',
    describe: def.describe,
    inputDoc: def.inputDoc,
    probe: def.probe,
    parse: (raw) => {
      try {
        return def.parse(raw && typeof raw === 'object' ? (raw as O) : {});
      } catch (e) {
        if (e instanceof Bad) return e.why;
        throw e;
      }
    },
    prepare: def.account
      ? async (i) => {
        const acc = await wsAccount(i.wsId as string);
        return 'refused' in acc ? acc : { ctx: acc };
      }
      : undefined,
    run: async (i, ctx) => def.run(i, ctx.prep),
  });
}

const WS = { wsId: '哪个 workspace 的号' };

export function registerXReadCapabilities(): void {
  read({ id: 'x.recipe.list', describe: '所有搜索配方(名字 / 关键词 / 时间窗 / 模板)', inputDoc: {}, parse: () => ({}), run: () => listAllRecipes() });
  read({
    id: 'x.cursor.read', describe: '某个名单的翻页游标(断点)', inputDoc: { scope: '游标的范围名' },
    parse: (o) => ({ scope: str(o, 'scope') }), run: (i) => readCursor(i.scope),
  });
  read({
    id: 'x.ops.status', describe: '运营状态:各名单最后采集时间、增长', inputDoc: WS, account: true,
    parse: (o) => ({ wsId: str(o, 'wsId') }), run: (_i, a) => readOpsStatus(a.restId),
  });
  read({
    id: 'x.account.read', describe: '这个 workspace 认出的登录号(handle / 数字 id)', inputDoc: WS,
    parse: (o) => ({ wsId: str(o, 'wsId') }), run: (i) => readWsAccount(i.wsId),
  });
  read({
    id: 'x.people.overview', describe: '人的总览:各关系分组的人数', inputDoc: WS, account: true,
    parse: (o) => ({ wsId: str(o, 'wsId') }), run: (_i, a) => readPeopleOverview(a.restId),
  });
  read({
    id: 'x.people.query', describe: '按条件查人(关系分组 / 标签 / 排除 …),分页', account: true,
    inputDoc: { ...WS, filter: '筛选条件(同运营人页)', limit: '一页几个,1–500', start: '从第几个开始,≥0' },
    parse: (o) => ({
      wsId: str(o, 'wsId'),
      filter: peopleFilter(o.filter),
      limit: int(o, 'limit', 1, 500), start: int(o, 'start', 0, Number.MAX_SAFE_INTEGER),
    }),
    run: (i, a) => queryPeople(a.restId, i.filter, i.limit, i.start),
  });
  read({
    id: 'x.person.read', describe: '一个人的详情(资料 / 关系 / 标签)', inputDoc: { ...WS, restId: '他的数字 id' }, account: true,
    parse: (o) => ({ wsId: str(o, 'wsId'), restId: str(o, 'restId') }), run: (i, a) => readPerson(a.restId, i.restId),
  });
  read({ id: 'x.tag.catalog', describe: '人身上用过的所有标签(去重)', inputDoc: {}, parse: () => ({}), run: () => readTagCatalog() });
  read({
    id: 'x.blueMutual.overview', describe: '蓝V互关总览:候选 / 求关 / 回关的数', inputDoc: WS, account: true,
    parse: (o) => ({ wsId: str(o, 'wsId') }), run: (_i, a) => readBlueMutualOverview(a.restId),
  });
  read({
    id: 'x.blueMutual.candidates', describe: '蓝V互关候选人(按互关倾向排)', inputDoc: { ...WS, limit: '最多几个,1–500' }, account: true,
    parse: (o) => ({ wsId: str(o, 'wsId'), limit: int(o, 'limit', 1, 500) }), run: (i, a) => readCandidates(a.restId, i.limit),
  });
  read({
    id: 'x.blueMutual.followProgress', describe: '求关进度 + 今天关注了几个 / 上限 / 一批几个', inputDoc: WS, account: true,
    parse: (o) => ({ wsId: str(o, 'wsId') }),
    run: async (_i, a) => {
      const gate = await readFollowGate(localDayStart(new Date()).toISOString());
      const prog = await readFollowProgress(a.restId, gate.settings['follow.revisit_days']);
      return { ...prog, today: gate.todayCount, cap: gate.cap, burst: gate.settings['follow.burst_size'] };
    },
  });
  read({
    id: 'x.ask.followStatus', describe: '求关过的人现在回关没有 + 上次查回关的结果', inputDoc: WS, account: true,
    parse: (o) => ({ wsId: str(o, 'wsId') }),
    run: async (i, a) => {
      const { settings } = await readSettings();
      return {
        statuses: await readAskStatuses(a.restId, settings['follow.revisit_days']),
        lastCheck: await readLastFollowCheck(a.restId),
        running: followCheckRunning() === i.wsId,
        revisitDays: settings['follow.revisit_days'],
      };
    },
  });
  read({
    id: 'x.relation.jobs', describe: '关系采集任务及进度', inputDoc: WS, probe: true,
    parse: (o) => ({ wsId: str(o, 'wsId') }), run: (i) => listRelationJobs(i.wsId),
  });
  read({ id: 'x.pace.status', describe: '各类采集的节奏(每段页数 / 间隔,按限流自调)', inputDoc: {}, probe: true, parse: () => ({}), run: () => readPaceViews() });
  read({
    id: 'x.person.lists', describe: '一个人的名单(关注者 / 他关注的 / 蓝V关注者)', probe: true, account: true,
    inputDoc: { ...WS, restId: '他的数字 id', limit: '每个名单最多几个,1–500' },
    parse: (o) => ({ wsId: str(o, 'wsId'), restId: digits(o, 'restId'), limit: int(o, 'limit', 1, 500) }),
    run: (i, a) => readPersonLists(a.restId, i.restId, i.limit),
  });
  read({
    id: 'x.person.timeline', describe: '我和一个人的往来(求关 / 互动 / 关系变化)', inputDoc: { ...WS, restId: '他的数字 id' }, account: true,
    parse: (o) => ({ wsId: str(o, 'wsId'), restId: digits(o, 'restId') }), run: (i, a) => readPersonTimeline(a.restId, i.restId),
  });
  read({
    id: 'x.vpn.overview', describe: '求助帖名单(Gemma 判断 / 人的标注 / 回复过没有)', inputDoc: WS, account: true,
    parse: (o) => ({ wsId: str(o, 'wsId') }), run: (_i, a) => readVpnOverview(a.restId),
  });
  read({
    id: 'x.draft.rules', describe: '草拟留言的规则(按 求关 / 互动 / 求助 分)', inputDoc: { ...WS, mode: 'ask / engage / vpn,默认 ask' }, account: true,
    parse: (o) => ({ wsId: str(o, 'wsId'), mode: modeOf(o.mode) }), run: (i, a) => readDraftRules(a.restId, i.mode),
  });
  read({
    id: 'x.followQueue.status', describe: '关注队列:排着几个、正在关谁、暂停原因、最近结果', inputDoc: WS, probe: true,
    parse: (o) => ({ wsId: str(o, 'wsId') }), run: (i) => followQueueStatus(i.wsId),
  });
  read({
    id: 'x.bg.status', describe: '后台采集此刻在不在跑、在采谁,各状态的任务数', inputDoc: WS, probe: true,
    parse: (o) => ({ wsId: str(o, 'wsId') }),
    run: async (i) => {
      const jobs = await listJobs(i.wsId);
      const counts: Record<string, number> = { queued: 0, running: 0, paused: 0, done: 0, failed: 0 };
      for (const j of jobs) counts[j.status] = (counts[j.status] ?? 0) + 1;
      return { ...bgRunnerStatus(i.wsId), counts, now: Date.now() };
    },
  });
  read({
    id: 'x.bg.jobs', describe: '后台采集任务列表(可按人筛)', inputDoc: { wsId: '可选:哪个 workspace', restId: '可选:只看这个人的' }, probe: true,
    parse: (o) => ({
      wsId: typeof o.wsId === 'string' && o.wsId !== '' ? o.wsId : undefined,
      restId: typeof o.restId === 'string' && o.restId !== '' ? o.restId : undefined,
    }),
    run: async (i) => {
      const jobs = await listJobs(i.wsId);
      return i.restId ? jobs.filter((j) => j.restId === i.restId) : jobs;
    },
  });
  read({ id: 'x.settings.read', describe: '运营设置(节奏 / 上限 / 天数 …)', inputDoc: {}, parse: () => ({}), run: () => readSettings() });
  read({
    id: 'x.unfollow.gate', describe: '取关闸门:今天取关了几个、上限、要不要歇', inputDoc: { dayStartIso: '本地今天的开始(ISO)' },
    parse: (o) => ({ dayStartIso: iso(o, 'dayStartIso') }), run: (i) => readUnfollowGate(i.dayStartIso),
  });
  read({
    id: 'x.person.collectProgress', describe: '某个 X 网页上正在采的人的进度', inputDoc: { wcId: 'X 网页的 webContents id' }, probe: true,
    parse: (o) => ({ wcId: int(o, 'wcId', 0, Number.MAX_SAFE_INTEGER) }), run: (i) => personCollectProgress(i.wcId),
  });
  read({
    id: 'x.person.friendCircle', describe: '一个人的朋友圈(和他互动多的人)', account: true,
    inputDoc: { ...WS, restId: '他的数字 id', limit: '最多几个,1–200' },
    parse: (o) => ({ wsId: str(o, 'wsId'), restId: str(o, 'restId'), limit: int(o, 'limit', 1, 200) }),
    run: (i, a) => readFriendCircle(a.restId, i.restId, i.limit),
  });
  read({
    id: 'x.person.tweets', describe: '库里一个人的推文(新的在前)', inputDoc: { restId: '他的数字 id', limit: '最多几条,1–200' },
    parse: (o) => ({ restId: str(o, 'restId'), limit: int(o, 'limit', 1, 200) }), run: (i) => readPersonTweets(i.restId, i.limit),
  });
}
