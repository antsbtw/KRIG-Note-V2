/**
 * 守卫:活动留言入库的幂等与变更检测。
 *
 * 用户 2026-09-03 定的流程第 ③ 步「元数据入库,按照数据契约提供服务」。
 * 契约 §2.1 要求「同一 (article_id, tweet_id) 重复推送只更新、不新增」,
 * §2.3 要求「重启后把未确认成功的批次重推」——
 * 后者意味着**必须记录推送状态**,否则无从知道哪些没推成功。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf-8');
const repo = read('src/platform/main/db/x-campaign-repo.ts');
const schema = read('src/storage/surreal/x-schema.ts');
const handlers = read('src/platform/main/x/x-timeline-handlers.ts');

describe('活动留言入库', () => {
  it('⭐ 幂等键是 (article_id, tweet_id) 复合唯一', () => {
    expect(schema).toMatch(
      /idx_campaign_key\s+ON\s+x_campaign_reply\s+FIELDS\s+article_id,\s*tweet_id\s+UNIQUE/);
  });

  it('⭐ 内容指纹不含 last_seen_at(否则每次采集都判成变更而重推)', () => {
    const fn = repo.slice(repo.indexOf('function payloadHash'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    // 任何**随时间变化**的输入都不能进指纹 —— 否则每次采集都判成变更、
    // 无谓重推,打爆对方接口。按名字挡不住 Date.now(),故逐个点名。
    for (const forbidden of ['last_seen', 'first_seen', 'Date.now', 'time::now', 'new Date()']) {
      expect(body, `指纹不得含随时间变化的输入: ${forbidden}`).not.toContain(forbidden);
    }
    // 影响判定的字段必须在指纹里
    expect(body).toContain('has_media');
    expect(body).toContain('deleted');
  });

  it('⭐ 内容变更后必须清 pushed_at,让它重新进待推队列', () => {
    const i = repo.indexOf('res.changed++');
    const before = repo.slice(Math.max(0, i - 700), i);
    expect(before).toContain('pushed_at = NONE');
  });

  it('内容未变时只刷 last_seen_at,不动 pushed_at(避免无谓重推)', () => {
    // 精确取 else 分支的那条 UPDATE,不用宽窗口(会误抓到相邻分支的 pushed_at)
    const i = repo.indexOf('res.unchanged++');
    const stmtStart = repo.lastIndexOf('await db.query(', i);
    const stmt = repo.slice(stmtStart, i);
    expect(stmt).toContain('last_seen_at = time::now()');
    expect(stmt, 'unchanged 分支不该动 pushed_at').not.toContain('pushed_at');
  });

  it('待推队列筛 pushed_at = NONE,一次最多 500(契约 §2.1)', () => {
    expect(repo).toContain('pushed_at = NONE');
    expect(repo).toMatch(/limit\s*=\s*500/);
  });

  it('⭐ partial 时不得标记「消失=已删除」(没抓完不等于被删)', () => {
    // ⚠️ 用 lastIndexOf 找**调用处**,indexOf 会命中文件顶部的 import 行
    const i = handlers.lastIndexOf('await markMissingAsDeleted');
    expect(i, '找不到 markMissingAsDeleted 的调用').toBeGreaterThan(0);
    const before = handlers.slice(Math.max(0, i - 400), i);
    expect(before, 'partial/problems 时必须跳过删除标记').toMatch(/!r\.partial/);
  });
});
