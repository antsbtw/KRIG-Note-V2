/**
 * ⭐ 后台采集任务 `x_bg_job` 读写(仅 main 进程)—— 纯判断在 `x-bg-job.ts`
 *
 * ⚠️ SurrealDB 铁律(记忆):
 *  - option 字段写库传 **undefined**(→ NONE),不传 null、不传 ''
 *  - datetime 用 `type::datetime($iso)`,不传裸字符串
 *  - 写记录用 `UPSERT type::record('x_bg_job', $id)`,不用 `UPSERT ... WHERE`(没匹配到静默不写)
 *  - 表扁平字段(profile_cursor…)↔ BgJob 的嵌套 BgTabProgress,在本文件转换(别让类型长回扁平)
 *
 * ⚠️ 断点不复用 x_collect_cursor:那张表 scope 是「账号:名单」,语义不同,混用会互相覆盖。
 */

import { getXDB } from '@storage/surreal/client';
import type { BgJob, BgKind, BgRange, BgStatus, BgTabProgress } from './x-bg-job';

/** 库里一行的扁平形状 */
type Row = {
  id: string;
  rest_id: string; handle: string; ws_id: string; range: BgRange; status: BgStatus;
  profile_cursor?: string; profile_oldest_at?: unknown; profile_done?: boolean;
  replies_cursor?: string; replies_oldest_at?: unknown; replies_done?: boolean;
  reposts_cursor?: string; reposts_oldest_at?: unknown; reposts_done?: boolean;
  kind?: BgKind;
  followers_cursor?: string; followers_done?: boolean;
  following_cursor?: string; following_done?: boolean;
  verified_cursor?: string; verified_done?: boolean;
  last_error?: string; total_pages?: number; total_saved?: number;
  created_at?: unknown; updated_at?: unknown; last_segment_at?: unknown;
};

const iso = (v: unknown): string | undefined =>
  v === undefined || v === null ? undefined : String(v);

function rowToJob(r: Row): BgJob {
  const tab = (c?: string, o?: unknown, d?: boolean): BgTabProgress => ({
    cursor: c === '' ? undefined : c,
    oldestAt: iso(o),
    done: d === true,
  });
  return {
    id: r.id,
    restId: r.rest_id, handle: r.handle, wsId: r.ws_id, range: r.range, status: r.status,
    profile: tab(r.profile_cursor, r.profile_oldest_at, r.profile_done),
    replies: tab(r.replies_cursor, r.replies_oldest_at, r.replies_done),
    reposts: tab(r.reposts_cursor, r.reposts_oldest_at, r.reposts_done),
    ...(r.kind === 'lists' ? {
      kind: 'lists' as const,
      followers: tab(r.followers_cursor, undefined, r.followers_done),
      following: tab(r.following_cursor, undefined, r.following_done),
      verifiedFollowers: tab(r.verified_cursor, undefined, r.verified_done),
    } : {}),
    lastError: r.last_error,
    totalPages: r.total_pages ?? 0,
    totalSaved: r.total_saved ?? 0,
    createdAt: iso(r.created_at) ?? '',
    updatedAt: iso(r.updated_at) ?? '',
    lastSegmentAt: iso(r.last_segment_at),
  };
}

/** ⭐ record::id 取出纯 id(不带表前缀),与 x-ops-actions-repo 同法 */
const SELECT_COLS = `record::id(id) AS id, rest_id, handle, ws_id, range, status,
  profile_cursor, profile_oldest_at, profile_done,
  replies_cursor, replies_oldest_at, replies_done,
  reposts_cursor, reposts_oldest_at, reposts_done,
  kind, followers_cursor, followers_done, following_cursor, following_done, verified_cursor, verified_done,
  last_error, total_pages, total_saved, created_at, updated_at, last_segment_at`;

/**
 * ⭐⭐ 建一个任务。**去重**:同一个人同一范围已有未完成(非 done/failed)的,
 * 不重建、返回那条的 id —— 避免右键点两下建出两个并行采同一个人(很强的自动化信号)。
 */
export async function createJob(input: {
  restId: string; handle: string; wsId: string; range: BgRange;
  /** 不给 = timeline(帖子/回复/转发);lists = 他的三个名单(2026-10-19,range 固定 all) */
  kind?: BgKind;
}): Promise<{ id: string; created: boolean }> {
  const db = getXDB();
  const kind = input.kind ?? 'timeline';
  /** ⚠️ 去重要分种类:同一个人的「采全部推文」和「采名单」是两件事,不能互相挡 */
  const [existing] = await db.query<[Array<{ id: string }>]>(
    `SELECT record::id(id) AS id FROM x_bg_job
       WHERE rest_id = $rid AND range = $range AND status != 'done' AND status != 'failed'
         AND (IF $kind = 'lists' THEN kind = 'lists' ELSE kind = NONE OR kind = 'timeline' END) LIMIT 1`,
    { rid: input.restId, range: input.range, kind },
  );
  const found = (existing ?? [])[0];
  if (found) return { id: found.id, created: false };

  const id = `${input.restId}_${kind === 'lists' ? 'lists' : input.range}_${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  const [rows] = await db.query<[unknown[]]>(
    `UPSERT type::record('x_bg_job', $id) SET
       rest_id = $rid, handle = $handle, ws_id = $ws, range = $range, status = 'queued',
       kind = $kind,
       profile_done = false, replies_done = false, reposts_done = false,
       followers_done = false, following_done = false, verified_done = false,
       total_pages = 0, total_saved = 0,
       created_at = type::datetime($now), updated_at = type::datetime($now)`,
    { id, rid: input.restId, handle: input.handle, ws: input.wsId, range: input.range, kind, now },
  );
  if (!rows || rows.length !== 1) throw new Error(`[x.bg] 任务 ${id} 没写进库`);
  console.log(`[x.bg] 建后台任务 ${id}：@${input.handle} ${kind === 'lists' ? '名单' : input.range}`);
  return { id, created: true };
}

export async function readJob(id: string): Promise<BgJob | null> {
  const [rows] = await getXDB().query<[Row[]]>(
    `SELECT ${SELECT_COLS} FROM type::record('x_bg_job', $id)`, { id },
  );
  const r = (rows ?? [])[0];
  return r ? rowToJob(r) : null;
}

/** 列出任务(可按 ws 过滤);最新的在前 */
export async function listJobs(wsId?: string): Promise<BgJob[]> {
  const where = wsId !== undefined ? 'WHERE ws_id = $ws' : '';
  const [rows] = await getXDB().query<[Row[]]>(
    `SELECT ${SELECT_COLS} FROM x_bg_job ${where} ORDER BY created_at DESC`, { ws: wsId },
  );
  return (rows ?? []).map(rowToJob);
}

/**
 * ⭐⭐ 某个 ws 当前**在跑/排队**的任务(runner 从中挑一个)。
 * ⚠️ 只取 queued/running —— paused/done/failed 不是候选。
 */
export async function activeJobsForWs(wsId: string): Promise<BgJob[]> {
  const [rows] = await getXDB().query<[Row[]]>(
    `SELECT ${SELECT_COLS} FROM x_bg_job
       WHERE ws_id = $ws AND (status = 'queued' OR status = 'running')
       ORDER BY created_at ASC`,
    { ws: wsId },
  );
  return (rows ?? []).map(rowToJob);
}

/** ⭐ 全部 ws 里有活跃任务的 ws 列表(runner 遍历用) */
export async function wsWithActiveJobs(): Promise<string[]> {
  const [rows] = await getXDB().query<[Array<{ ws_id: string }>]>(
    `SELECT ws_id FROM x_bg_job WHERE status = 'queued' OR status = 'running' GROUP BY ws_id`,
  );
  return (rows ?? []).map((r) => r.ws_id).filter((w) => typeof w === 'string' && w !== '');
}

/**
 * ⭐⭐⭐ 把一段跑完的结果写回 —— 直接存 `mergeSegment` 算好的 BgJob。
 * ⚠️ 合并逻辑(到底/完成/失败)在纯函数里,这里只负责落库。
 */
export async function saveJob(job: BgJob): Promise<void> {
  const db = getXDB();
  const now = new Date().toISOString();
  /**
   * ⚠️ datetime option 的写法(与 x-cursor-repo / 迁移里一致、已验证):
   * SQL 里用 `IF $x = NONE THEN NONE ELSE type::datetime($x) END` —— 传 ISO 字符串,
   * 有值就 cast 成 datetime,没值(undefined→NONE)就保持 NONE。
   * ⭐ 不赌「SDK 会把 Date 编成 datetime」(记忆 project-surreal-datetime-vs-string:
   *   裸字符串比 datetime 不报错却返回全表;形状只有真库答得出)。
   */
  await db.query(
    `UPSERT type::record('x_bg_job', $id) SET
       status = $status,
       profile_cursor = $pc, profile_oldest_at = (IF $po = NONE THEN NONE ELSE type::datetime($po) END), profile_done = $pd,
       replies_cursor = $rc, replies_oldest_at = (IF $ro = NONE THEN NONE ELSE type::datetime($ro) END), replies_done = $rd,
       reposts_cursor = $xc, reposts_oldest_at = (IF $xo = NONE THEN NONE ELSE type::datetime($xo) END), reposts_done = $xd,
       followers_cursor = $fc, followers_done = $fd, following_cursor = $gc, following_done = $gd,
       verified_cursor = $vc, verified_done = $vd,
       last_error = $err, total_pages = $pages, total_saved = $saved,
       updated_at = type::datetime($now),
       last_segment_at = (IF $seg = NONE THEN NONE ELSE type::datetime($seg) END)`,
    {
      id: job.id, status: job.status,
      pc: job.profile.cursor, po: job.profile.oldestAt, pd: job.profile.done,
      rc: job.replies.cursor, ro: job.replies.oldestAt, rd: job.replies.done,
      xc: job.reposts.cursor, xo: job.reposts.oldestAt, xd: job.reposts.done,
      fc: job.followers?.cursor, fd: job.followers?.done, gc: job.following?.cursor, gd: job.following?.done,
      vc: job.verifiedFollowers?.cursor, vd: job.verifiedFollowers?.done,
      err: job.lastError, pages: job.totalPages, saved: job.totalSaved,
      now,
      seg: job.lastSegmentAt,
    },
  );
}

/** 改状态(暂停/恢复/手动标失败等);paused↔queued 走这里 */
export async function setJobStatus(id: string, status: BgStatus, lastError?: string): Promise<void> {
  await getXDB().query(
    `UPSERT type::record('x_bg_job', $id) SET status = $s, last_error = $err, updated_at = type::datetime($now)`,
    { id, s: status, err: lastError, now: new Date().toISOString() },
  );
  console.log(`[x.bg] 任务 ${id} → ${status}${lastError ? `（${lastError}）` : ''}`);
}

/** 取消 = 删任务(断点是派生状态,删了无损真数据) */
export async function deleteJob(id: string): Promise<void> {
  await getXDB().query(`DELETE type::record('x_bg_job', $id)`, { id });
  console.log(`[x.bg] 删任务 ${id}`);
}
