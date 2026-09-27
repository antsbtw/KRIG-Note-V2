/**
 * ⭐⭐ **搜索水位** —— 用户 2026-09-27:
 *
 * > 「应该为上一次采集时间是什么时候，倒推12小时好了。
 * >   这样比较准确，而不重复采集数据」
 * > 「全局，无论从哪个 ws 都应该一样，取下来是共用的」
 *
 * ⚠️⚠️ 本文件钉的是**采集范围**。做错了的现象是「**采少了**」——
 * 而采少了**在数据里看不出来**（你不知道漏了什么）。
 * 所以每条判据都偏「宁可多采」那一侧。
 */
import { describe, it, expect } from 'vitest';
import {
  computeSinceDate, OVERLAP_HOURS, COLD_START_DAYS,
  type SearchWatermark,
} from '../../src/platform/main/db/x-search-watermark-repo';

const NOW = new Date('2026-09-27T20:00:00.000Z');
const wm = (newestAt: string): SearchWatermark => ({ query: 'q', newestAt });

describe('⭐⭐ 有水位:从「采到的最新一条」往前退 12 小时', () => {
  it('⭐⭐ 退 12 小时后落在前一天 → since 用前一天', () => {
    /** 最新一条是 9/27 06:00，退 12 小时 = 9/26 18:00 → since:2026-09-26 */
    const r = computeSinceDate(wm('2026-09-27T06:00:00.000Z'), NOW);
    expect(r.basis).toBe('watermark');
    expect(r.since, '没按 12 小时重叠算').toBe('2026-09-26');
  });

  it('⭐ 退 12 小时后仍在当天 → since 用当天', () => {
    /** 最新一条是 9/27 18:00，退 12 小时 = 9/27 06:00 → since:2026-09-27 */
    const r = computeSinceDate(wm('2026-09-27T18:00:00.000Z'), NOW);
    expect(r.since).toBe('2026-09-27');
  });

  it('⭐⭐ 重叠量就是用户定的 12 小时（别被悄悄改小）', () => {
    /**
     * ⚠️ 改小会漏:X 的搜索索引有延迟，刚跑完可能还没索引到最近几小时的推。
     * 重叠正是为了覆盖那一段。
     */
    expect(OVERLAP_HOURS, '重叠量被改了 —— 用户定的是 12 小时').toBe(12);
  });
});

describe('⭐⭐ 没水位:冷启动', () => {
  it('⭐ 首次搜这个词 → 回落固定窗口', () => {
    const r = computeSinceDate(null, NOW);
    expect(r.basis).toBe('cold-start');
    expect(r.since).toBe('2026-09-25');
    expect(COLD_START_DAYS).toBe(2);
  });

  it('⚠️ 水位是脏数据 → **回落冷启动**，不拿它算', () => {
    /**
     * ⚠️ 解不出日期还硬算的话，可能算出一个荒谬的 since，
     * X 返回 0 条**而且不报错** —— 现象是「突然一条都采不到」。
     */
    const r = computeSinceDate({ query: 'q', newestAt: '不是日期' }, NOW);
    expect(r.basis, '脏水位没回落 —— 会算出荒谬的 since').toBe('cold-start');
    expect(r.since).toBe('2026-09-25');
  });
});

describe('⚠️ 边界:宁可多采，不可不采', () => {
  it('⭐⭐ 水位比现在还新（时钟漂移）→ 按现在算，不落到未来', () => {
    /**
     * ⚠️ since 落到未来的话 X 返回 0 条**且不报错**，
     * 现象是「采集突然恒 0」，极难查。
     */
    const r = computeSinceDate(wm('2026-10-05T00:00:00.000Z'), NOW);
    expect(r.since, 'since 落到了未来 —— 会恒采 0 条且不报错')
      .toBe('2026-09-27');
  });

  it('⚠️ 很旧的水位照样用（不硬性截断成最近 N 天）', () => {
    /**
     * ⭐ 久没跑的词，水位很旧是**正常**的 ——
     * 硬截断会让中间那段永远补不上。宁可多采。
     */
    const r = computeSinceDate(wm('2026-09-01T00:00:00.000Z'), NOW);
    expect(r.basis).toBe('watermark');
    expect(r.since).toBe('2026-08-31');
  });

  it('⚠️ since 永远不晚于「最新一条那天」（退了就不能反而更晚）', () => {
    /** 退 12 小时只可能让 since 更早或同天，绝不可能更晚 */
    for (const iso of [
      '2026-09-27T00:30:00.000Z', '2026-09-27T11:59:00.000Z',
      '2026-09-27T12:00:00.000Z', '2026-09-27T23:59:00.000Z',
    ]) {
      const r = computeSinceDate(wm(iso), NOW);
      expect(
        r.since <= iso.split('T')[0],
        `${iso} 算出的 since=${r.since} 比推文那天还晚 —— 会漏掉那条自己`,
      ).toBe(true);
    }
  });
});
