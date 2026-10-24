/**
 * ⭐⭐ X 读库类能力(Module5-04 第 3 步第 1 批,2026-10-24)—— 原来 x-data-ipc 里 26 个纯读的 op
 *
 * 每个能力一条:id / 给 AI 读的一句话 / 参数 / 要不要认号 / 是不是状态轮询 / 读哪个函数。
 * 认号、参数校验在这里写一份(原来 IPC 校验、收件箱不校验)。读的函数原样调,不重写。
 * 状态轮询(界面每 1–5 秒刷新的)标 probe:记录照记、只留 7 天(用户 10-24)。
 */
import { listAllRecipes } from '@platform/main/db/search-recipe-repo';
import { readWsAccount } from './x-account-repo';
import { int, iso, modeOf, peopleFilter, str, digits, xCap, type O } from './x-capabilities-common';
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

const read = <I extends O>(def: Parameters<typeof xCap<I>>[1]): void => xCap('input', def);

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
