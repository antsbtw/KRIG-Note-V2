/**
 * ⭐⭐ X 改库类能力(Module5-04 第 3 步第 2 批,2026-10-24)—— 只改自己的库,不碰 X 网页、不对外动作。类别 control。
 *
 * 原来 x-data-ipc 里 15 个 op。参数校验、认号写在这里一份;状态不对(暂停一个已完成的任务)→ refused,不动库。
 * ⚠️ 不在这批:关注队列(加了就会去 X 上点关注 = 对外动作,放输出类那批,要过人批复的关)、
 *   界面流程上报 logAction / logPersonProgress / logPersonCollect(第 4 步流程搬回主进程时整个去掉)。
 */
import { capRefused } from '@platform/main/capability/capability';
import { deleteRecipe, upsertRecipe } from '@platform/main/db/search-recipe-repo';
import type { SearchRecipe } from '@shared/types/x-timeline-types';
import { traceRecorder } from '@platform/main/web-capability/wiring/runtime';
import { Bad, digits, modeOf, str, xCap, type O } from './x-capabilities-common';
import { clearCursor, saveCursor } from './x-cursor-repo';
import { setExcluded, setMutualIntent, setTags } from './x-people-repo';
import { setVpnHuman } from './x-vpn-run';
import { DEFER_DAYS, recordDefer } from './x-defer-repo';
import { setDraftRuleActive } from './x-ask-draft';
import { createJob, deleteJob, readJob, setJobStatus } from './x-bg-job-repo';
import { isBgRange } from './x-bg-job';
import { kickBgRunner } from './x-bg-runner';
import { writeSetting } from './x-ops-actions-repo';
import { validateSetting } from './x-ops-settings';

const write = <I extends O>(def: Parameters<typeof xCap<I>>[1]): void => xCap('control', def);
const bool = (o: O, k: string): boolean => { if (typeof o[k] !== 'boolean') throw new Bad(`${k} 要 true / false`); return o[k] as boolean; };
const optStr = (o: O, k: string): string | undefined => (typeof o[k] === 'string' && o[k] !== '' ? (o[k] as string) : undefined);
const author = (i: { restId: string }): string => `x_author:${i.restId}`;
const bgJob = (i: { id: string }): string => `x_bg_job:${i.id}`;

/** 暂停 / 继续 / 取消后台任务:先读出来(UPSERT 不存在的 id 会建残行 —— x-bg-ui 守卫钉的那条)再看状态 */
async function jobOrRefuse(id: string): Promise<{ status: string }> {
  const job = await readJob(id);
  if (!job) throw capRefused(`后台任务 ${id} 不存在(可能已取消)`);
  return job;
}

export function registerXWriteCapabilities(): void {
  write({
    id: 'x.recipe.upsert', describe: '新建或修改一条搜索配方', inputDoc: { recipe: '配方(要有名字;有 id 就是改)' },
    parse: (o) => {
      const r = o.recipe as SearchRecipe | undefined;
      if (!r || typeof r !== 'object' || typeof r.name !== 'string' || r.name.trim() === '') throw new Bad('配方必须有名字');
      return { recipe: r };
    },
    run: (i) => upsertRecipe(i.recipe),
  });
  write({
    id: 'x.recipe.delete', describe: '删一条搜索配方', inputDoc: { recipeId: '配方 id' },
    parse: (o) => ({ recipeId: str(o, 'recipeId') }), subject: (i) => `search_recipe:${i.recipeId}`,
    run: async (i) => { await deleteRecipe(i.recipeId); return { deleted: i.recipeId }; },
  });
  write({
    id: 'x.cursor.save', describe: '存一个名单的翻页断点(下次从这续)', inputDoc: { cursor: '{ scope, bottomCursor?, exhausted, lastRound?, lastReason?, totalSeen? }' },
    parse: (o) => {
      const c = o.cursor as { scope?: unknown } | undefined;
      if (!c || typeof c.scope !== 'string' || c.scope.trim() === '') throw new Bad('cursor.scope 要非空');
      return { cursor: c as Parameters<typeof saveCursor>[0] };
    },
    run: async (i) => { await saveCursor(i.cursor); return { saved: i.cursor.scope }; },
  });
  write({
    id: 'x.cursor.clear', describe: '清掉一个名单的翻页断点(下次从头采)', inputDoc: { scope: '游标的范围名' },
    parse: (o) => ({ scope: str(o, 'scope') }),
    run: async (i) => { await clearCursor(i.scope); return { cleared: i.scope }; },
  });
  write({
    id: 'x.person.setExcluded', describe: '排除 / 取消排除一个人(排除的不再出现在候选里)',
    inputDoc: { restId: '他的数字 id', excluded: 'true 排除 / false 取消', reason: '可选:为什么' },
    parse: (o) => ({ restId: str(o, 'restId'), excluded: bool(o, 'excluded'), reason: optStr(o, 'reason') }), subject: author,
    run: async (i) => {
      await setExcluded(i.restId, i.excluded, i.reason);
      console.log(`[x.people] ${i.excluded ? '排除' : '取消排除'} ${i.restId}${i.reason ? `(${i.reason})` : ''}`);
      return { restId: i.restId, excluded: i.excluded };
    },
  });
  write({
    id: 'x.person.setTags', describe: '设一个人的标签(整组替换;空数组 = 清空)', inputDoc: { restId: '他的数字 id', tags: '标签数组' },
    parse: (o) => {
      if (!Array.isArray(o.tags) || o.tags.some((t) => typeof t !== 'string')) throw new Bad('tags 要字符串数组');
      return { restId: str(o, 'restId'), tags: o.tags as string[] };
    },
    subject: author,
    run: async (i) => {
      const tags = await setTags(i.restId, i.tags);
      console.log(`[x.people] 标签 ${i.restId} → ${tags.length > 0 ? tags.join('、') : '(清空)'}`);
      return tags;
    },
  });
  write({
    id: 'x.vpn.mark', describe: '人标注一条求助帖:值得回 / 不值得回(推翻 Gemma,进标注)', account: true,
    inputDoc: { wsId: '哪个 workspace 的号', tweetId: '推文 id', human: 'accept / reject' },
    parse: (o) => {
      if (o.human !== 'accept' && o.human !== 'reject') throw new Bad('human 只认 accept / reject');
      return { wsId: str(o, 'wsId'), tweetId: digits(o, 'tweetId'), human: o.human as 'accept' | 'reject' };
    },
    subject: (i) => `x_tweet:${i.tweetId}`,
    run: async (i, a) => { await setVpnHuman(a.restId, i.tweetId, i.human); return true; },
  });
  write({
    id: 'x.person.defer', describe: `把一个人「放一放」(${DEFER_DAYS} 天内不再出现在这类卡片里)`, account: true,
    inputDoc: { wsId: '哪个 workspace 的号', restId: '他的数字 id', mode: 'ask / engage / vpn', tweetId: '可选:因为哪条' },
    parse: (o) => ({ wsId: str(o, 'wsId'), restId: digits(o, 'restId'), mode: modeOf(o.mode), tweetId: optStr(o, 'tweetId') }),
    subject: author,
    run: async (i, a) => { await recordDefer(a.restId, i.restId, i.mode, i.tweetId); return { days: DEFER_DAYS }; },
  });
  write({
    id: 'x.draft.setRuleActive', describe: '开 / 关一条草拟留言的规则', account: true,
    inputDoc: { wsId: '哪个 workspace 的号', id: '规则 id', active: 'true / false' },
    parse: (o) => ({ wsId: str(o, 'wsId'), id: str(o, 'id'), active: bool(o, 'active') }),
    run: async (i, a) => { await setDraftRuleActive(a.restId, i.id, i.active); return true; },
  });
  write({
    id: 'x.person.setMutualIntent', describe: '人标一个人有没有互关倾向(人 > AI > 算法)', inputDoc: { restId: '他的数字 id', value: 'true 有 / false 没有' },
    parse: (o) => ({ restId: str(o, 'restId'), value: bool(o, 'value') }), subject: author,
    run: async (i) => {
      await setMutualIntent(i.restId, i.value);
      console.log(`[x.people] 人标互关倾向 ${i.restId} → ${i.value ? '有' : '无'}`);
      return { restId: i.restId, value: i.value };
    },
  });
  write({
    id: 'x.bg.createJob', describe: '建一个后台采集任务:采他的帖子 / 回复 / 转发(按时间范围),或采他的三个名单(kind = lists)',
    inputDoc: { wsId: '任务属于哪个号的 workspace', restId: '他的数字 id', handle: '他的 handle', range: 'halfYear / year / all', kind: '可选:lists = 名单任务(范围只能 all)' },
    parse: (o) => {
      const range = o.range;
      if (!isBgRange(range as Parameters<typeof isBgRange>[0])) throw new Bad(`range 只认 halfYear / year / all,收到 ${String(range)}`);
      if (o.kind !== undefined && o.kind !== 'lists') throw new Bad(`kind 只认 lists,收到 ${String(o.kind)}`);
      if (o.kind === 'lists' && range !== 'all') throw new Bad('名单任务的范围只能是 all(名单没有时间范围)');
      return { wsId: str(o, 'wsId'), restId: str(o, 'restId'), handle: str(o, 'handle'), range: range as 'halfYear' | 'year' | 'all', kind: o.kind as 'lists' | undefined };
    },
    subject: author,
    run: async (i) => {
      const r = await createJob({ restId: i.restId, handle: i.handle, wsId: i.wsId, range: i.range, kind: i.kind });
      traceRecorder.lifecycle({
        layer: 'web.net', event: 'x-bg-job-create', pageId: 'x-data',
        detail: { id: r.id, created: r.created, handle: i.handle, range: i.range, kind: i.kind ?? 'timeline', wsId: i.wsId },
      });
      kickBgRunner();
      return r;
    },
  });
  write({
    id: 'x.bg.pauseJob', describe: '暂停一个排队中 / 在跑的后台任务', inputDoc: { id: '任务 id' },
    parse: (o) => ({ id: str(o, 'id') }), subject: bgJob,
    run: async (i) => {
      const job = await jobOrRefuse(i.id);
      if (job.status !== 'queued' && job.status !== 'running') throw capRefused(`任务是「${job.status}」,不能暂停`);
      await setJobStatus(i.id, 'paused');
      return { id: i.id };
    },
  });
  write({
    id: 'x.bg.resumeJob', describe: '继续一个暂停的后台任务', inputDoc: { id: '任务 id' },
    parse: (o) => ({ id: str(o, 'id') }), subject: bgJob,
    run: async (i) => {
      const job = await jobOrRefuse(i.id);
      if (job.status !== 'paused') throw capRefused(`任务是「${job.status}」,不是暂停状态`);
      await setJobStatus(i.id, 'queued');
      kickBgRunner();
      return { id: i.id };
    },
  });
  write({
    id: 'x.bg.cancelJob', describe: '取消(删掉)一个后台任务', inputDoc: { id: '任务 id' },
    parse: (o) => ({ id: str(o, 'id') }), subject: bgJob,
    run: async (i) => { await deleteJob(i.id); return { id: i.id }; },
  });
  write({
    id: 'x.settings.write', describe: '改一项运营设置(节奏 / 上限 / 天数 …;范围不对会被拒)', inputDoc: { key: '设置名(见 x.settings.read)', value: '整数' },
    parse: (o) => {
      const key = str(o, 'key');
      const why = validateSetting(key, o.value);
      if (why !== null) throw new Bad(why);
      return { key, value: o.value as number };
    },
    run: async (i) => {
      await writeSetting(i.key, i.value);
      console.log(`[x.ops] 设置 ${i.key} = ${i.value}`);
      return { key: i.key, value: i.value };
    },
  });
}
