/**
 * ⭐⭐ 采集池满了挤谁(2026-10-16)—— 重放真机那一跑的比例:
 * 74 秒里 19 页搜索结果(各不相同)夹着 44 次一模一样的头像响应、8 次一模一样的账号信息,池子 64 条。
 * 旧规则「挤最老的」→ 只剩 2 页搜索结果(漏采 17 页,采集数不够页一直滚 → 429)。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evictOver, type PoolItem } from '@platform/main/web-capability/pool-evict';

function replay(): PoolItem[] {
  const out: PoolItem[] = [];
  let a = 0; let v = 0;
  for (let p = 0; p < 19; p += 1) {
    out.push({ url: `https://x.com/i/api/graphql/q/SearchTimeline?cursor=${p}`, status: 200, text: `{"page":${p}}` });
    for (let k = 0; k < 3 && a < 44; k += 1, a += 1) out.push({ url: 'https://x.com/i/api/fleets/v1/avatar_content', status: 200, text: '{"users":{}}' });
    if (v < 8 && p % 2 === 0) { out.push({ url: 'https://x.com/i/api/1.1/graphql/viewer_context.json', status: 200, text: '{"me":1}' }); v += 1; }
  }
  while (a < 44) { out.push({ url: 'https://x.com/i/api/fleets/v1/avatar_content', status: 200, text: '{"users":{}}' }); a += 1; }
  return out;
}

describe('evictOver', () => {
  it('⭐⭐⭐ 真机比例重放:19 页搜索结果一页不丢', () => {
    const pool: PoolItem[] = [];
    let lost = 0;
    for (const it of replay()) { pool.push(it); lost += evictOver(pool, 64); }
    expect(pool.filter((x) => x.url.includes('SearchTimeline'))).toHaveLength(19);
    expect(lost, '挤掉的都应是重复的').toBe(0);
  });

  it('没有重复时才挤最老的,并如实返回丢了几条', () => {
    const pool: PoolItem[] = [1, 2, 3, 4].map((i) => ({ url: `u${i}`, text: `${i}` }));
    expect(evictOver(pool, 2)).toBe(2);
    expect(pool.map((x) => x.url)).toEqual(['u3', 'u4']);
  });

  it('同 url 但内容不同不算重复(翻页同一个接口、不同游标)', () => {
    const pool: PoolItem[] = [{ url: 'a', text: '1' }, { url: 'a', text: '2' }, { url: 'a', text: '1' }];
    evictOver(pool, 2);
    expect(pool.map((x) => x.text)).toEqual(['2', '1']);
  });

  it('两条腿都用它(不许各写一份「挤最老」)', () => {
    for (const f of ['src/platform/main/web-capability/net/capture-session.ts', 'src/platform/main/web-capability/hook/hook-session.ts']) {
      const s = readFileSync(join(process.cwd(), f), 'utf8');
      expect(s, f).toMatch(/evictOver\(this\.(payloads|held), MAX_(PAYLOADS|HELD)\)/);
      expect(s, `${f} 又在直接挤最老的`).not.toMatch(/\.length > MAX_(PAYLOADS|HELD)\) this\.(payloads|held)\.shift\(\)/);
    }
  });
});
