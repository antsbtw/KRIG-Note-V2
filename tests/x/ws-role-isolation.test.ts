/**
 * 守卫:X per-ws 角色隔离(2026-09-03)
 *
 * 用户拍板「一个 ws 只干一件事」——定时搜索采集与活动核验分到不同 ws,
 * 各用自己的 X webview。一个 ws 里只有一个 webview,跨角色复用会互相导航打断,
 * 现象是「活动偶尔抓不到」「采集时断时续」,极难定位。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf-8');
const sched = read('src/platform/main/x/x-search-scheduler.ts');
const repo = read('src/platform/main/db/x-ws-role-repo.ts');
const schema = read('src/storage/surreal/x-schema.ts');

describe('ws 角色隔离', () => {
  it('⭐ 调度器必须按角色过滤,只在 search ws 上跑', () => {
    expect(sched).toContain('getWsRole');
    expect(sched).toMatch(/role\s*!==\s*'search'/);
  });

  it('⭐ requireWsRole 不符必须抛(不能静默降级用别人的 webview)', () => {
    const fn = repo.slice(repo.indexOf('export async function requireWsRole'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain('throw new Error');
    expect(
      /return\s+cfg;[\s\S]*throw/.test(body) === false,
      'requireWsRole 必须先校验再返回,不能先返回后抛',
    ).toBe(true);
  });

  it('未配置角色时默认 idle —— 不参与定时任务的安全默认', () => {
    expect(repo).toContain('DEFAULT_X_WS_ROLE');
    expect(read('src/shared/types/x-ws-role-types.ts'))
      .toMatch(/DEFAULT_X_WS_ROLE[^=]*=\s*'idle'/);
  });

  it('⭐ migration 必须回填存量 ws 为 search(否则升级后采集静默全停)', () => {
    const fn = schema.slice(schema.indexOf('export async function x_migration_1_0_6'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 1);
    expect(body).toContain("role = 'search'");
    expect(body, '回填判据应基于实际采集记录(x_tweet.ws_id),不凭空造').toContain('x_tweet');
  });

  it('接口 B 承接者唯一(端口冲突)', () => {
    const fn = repo.slice(repo.indexOf('export async function setWsRole'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 1);
    expect(body).toMatch(/serves_refresh\s*=\s*false[\s\S]*ws_id\s*!=\s*\$wsId/);
  });

  it('ws_id 唯一索引存在', () => {
    expect(schema).toMatch(/idx_ws_role_ws\s+ON\s+x_ws_role\s+FIELDS\s+ws_id\s+UNIQUE/);
  });
});
