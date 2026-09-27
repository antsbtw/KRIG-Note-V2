/**
 * ⭐⭐ **搜索水位** —— 按搜索词记「采到的最新一条推是什么时候发的」。
 *
 * ── 用户 2026-09-27 拍板 ──
 * > 「应该为上一次采集时间是什么时候，倒推12小时好了。
 * >   这样比较准确，而不重复采集数据」
 * > 「全局，无论从哪个 ws 都应该一样，取下来是共用的」
 *
 * ## ⚠️ 记的是**推文时间**,不是跑的时间
 *
 * X 的搜索索引**有延迟** —— 刚跑完可能还没索引到最近几小时的推。
 * 记「跑的时间」→ 下次从那里往后采 → **中间那段永远漏掉**,
 * 而且**漏了在数据里看不出来**(你不知道少了什么)。
 *
 * ⭐ 记「采到的最新一条是什么时候发的」,下次从它**往前退一段重叠**,
 * 索引延迟期间新进来的自然会被重新覆盖。
 * 重复的靠 `tweet_id` 去重,成本只是多滚几屏 ——
 * 这与配方那边「宁可重复,不可遗漏」是同一条原则。
 *
 * ## ⚠️ 全局,不按 ws
 *
 * 推文本来就是全局的(实测:同一 `tweet_id` 在库里只有一行)。
 * 按 ws 分会让 ws-2 把 ws-1 已经采过的时间段**再采一遍** —— 纯浪费。
 */

import { getXDB } from '@storage/surreal/client';

/**
 * ⭐ 回退重叠多久 —— 用户定的 12 小时。
 *
 * ⚠️ 这是**重叠量**不是窗口长度:从「上次采到的最新一条」往前退 12 小时,
 * 覆盖 X 索引延迟期间可能漏掉的那段。
 */
export const OVERLAP_HOURS = 12;

/**
 * ⭐ 没有水位时的回退窗口(天)。
 *
 * ⚠️ 第一次搜某个词时没有任何历史,只能给个初始范围。
 * 给 2 天与 `DEFAULT_SEARCH_DAYS` 一致 —— ⚠️ 不给更长是因为
 * **X 的 `since:` 只精确到天**,窗口越长首次采集量越大,
 * 而首次本来就该采一批垫底,不必一次挖穿历史。
 */
export const COLD_START_DAYS = 2;

export interface SearchWatermark {
  query: string;
  /** 采到的最新一条推的发布时间 */
  newestAt: string;
  lastRunAt?: string;
  totalSeen?: number;
}

/** 读某个搜索词的水位 —— 没有就是 null(首次搜这个词) */
export async function getSearchWatermark(query: string): Promise<SearchWatermark | null> {
  const q = (query ?? '').trim();
  if (!q) return null;
  try {
    const res = await getXDB().query<[Array<Record<string, unknown>>]>(
      `SELECT query, newest_at, last_run_at, total_seen
         FROM x_search_watermark WHERE query = $q LIMIT 1`,
      { q },
    );
    const r = res?.[0]?.[0];
    if (!r?.newest_at) return null;
    return {
      query: String(r.query),
      newestAt: String(r.newest_at),
      lastRunAt: r.last_run_at ? String(r.last_run_at) : undefined,
      totalSeen: typeof r.total_seen === 'number' ? r.total_seen : undefined,
    };
  } catch (err) {
    /**
     * ⚠️ 读失败**不抛** —— 采集是主流程,不能被水位读取拖垮。
     * ⭐ 回落 null = 走冷启动窗口,**宁可多采不可不采**。
     * ⚠️ 但要 warn:静默回落会让「水位一直没生效」查不出来。
     */
    console.warn('[x-search-watermark] 读取失败,本次走冷启动窗口:', String(err));
    return null;
  }
}

/**
 * ⭐⭐ 算这次该从什么时候开始采。
 *
 * @returns ISO 日期串(`YYYY-MM-DD`),直接喂给 X 的 `since:`
 *
 * ⚠️ X 的 `since:` **只精确到天**(语法限制)——
 * 所以「往前退 12 小时」落到查询上会被**向下取整到那一天的 00:00**,
 * 实际覆盖只会**更宽**不会更窄。这是安全的方向。
 */
export function computeSinceDate(
  watermark: SearchWatermark | null,
  now: Date = new Date(),
): { since: string; basis: 'watermark' | 'cold-start' } {
  if (!watermark?.newestAt) {
    const d = new Date(now.getTime() - COLD_START_DAYS * 86_400_000);
    return { since: d.toISOString().split('T')[0], basis: 'cold-start' };
  }
  const newest = new Date(watermark.newestAt).getTime();
  /**
   * ⚠️ 水位**不可信时回落冷启动** —— 解不出日期(脏数据/时区怪值)
   * 就别拿它算窗口,否则可能算出一个荒谬的 since 导致整批采不到。
   */
  if (!Number.isFinite(newest)) {
    const d = new Date(now.getTime() - COLD_START_DAYS * 86_400_000);
    return { since: d.toISOString().split('T')[0], basis: 'cold-start' };
  }
  /**
   * ⚠️ 水位比现在还新(时钟漂移/X 给的时间超前)→ 按现在算,
   * 否则 since 会落到未来,X 返回 0 条而且**不报错**。
   */
  const base = Math.min(newest, now.getTime());
  const d = new Date(base - OVERLAP_HOURS * 3_600_000);
  return { since: d.toISOString().split('T')[0], basis: 'watermark' };
}

/**
 * 采完之后更新水位。
 *
 * @param newestAt 这一趟采到的**最新一条推**的发布时间
 *
 * ⚠️ **只前进不后退**:同一个词可能被不同 ws / 不同时机跑,
 * 若某趟只采到几条旧的就把水位往回拨,下次会重采一大段。
 * ⭐ 用 SQL 里的 `IF` 比较,不在应用层读-改-写 —— 后者有并发竞态。
 */
export async function bumpSearchWatermark(
  query: string,
  newestAt: string | undefined,
  opts: { seen?: number } = {},
): Promise<void> {
  const q = (query ?? '').trim();
  if (!q) return;
  /**
   * ⚠️ 没采到东西就**只记跑过一次**,不动水位 ——
   * 把水位推到「现在」会让下次跳过这段,而这段其实没采到。
   */
  const t = newestAt ? new Date(newestAt) : null;
  const valid = t && Number.isFinite(t.getTime()) ? t : null;

  try {
    await getXDB().query(
      `UPSERT x_search_watermark:[$q] SET
         query = $q,
         newest_at = IF $newest != NONE AND ($newest > newest_at OR newest_at = NONE)
           THEN $newest ELSE newest_at END,
         last_run_at = time::now(),
         total_seen = (total_seen ?? 0) + $seen,
         updated_at = time::now()`,
      {
        /** ⚠️ option 字段传 undefined 不传 null(SurrealDB 的 NONE ≠ NULL) */
        q, newest: valid ?? undefined, seen: opts.seen ?? 0,
      },
    );
  } catch (err) {
    /**
     * ⚠️ 写失败**不抛** —— 推文已经入库了,不能因为水位没记上而让整趟采集算失败。
     * ⚠️ 但要 warn:水位一直没更新的现象是「每次都重采同一段」,
     * 而那在面板上看着像「正常采集」。
     */
    console.warn('[x-search-watermark] 更新失败(不影响本次采集):', String(err));
  }
}
