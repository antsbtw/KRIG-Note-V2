/**
 * 守卫:ws × 账号 × 角色 的自由组合。
 *
 * 用户 2026-09-03 定的架构原则:
 * 「不同的 ws 要可以不同的用户登录,做不同的操作。
 *   可以同时多个 ws 在不同的账号下做不同的操作,
 *   也可以同一个账号下做不同的操作,这才是架构合理的地方。」
 *
 * 即必须同时支持四种组合:
 *   ① 不同账号 + 不同角色(A 号搜索,B 号活动)
 *   ② **同一账号 + 不同角色**(同号开两个 ws,一个搜索一个活动)
 *   ③ 不同账号 + 相同角色(两个号各自搜索)
 *   ④ 同一账号 + 相同角色(同号两窗口分担同类工作)
 *
 * 支撑它的关键约束:**唯一性只能建在 ws_id 上,绝不能建在 handle 上**。
 * 一旦给 handle 加 UNIQUE,②④ 立刻不成立 —— 而且现象是「第二个 ws 存不进去」,
 * 排查时容易误以为是写入 bug。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const schema = readFileSync(
  resolve(__dirname, '../../src/storage/surreal/x-schema.ts'), 'utf-8');
const repo = readFileSync(
  resolve(__dirname, '../../src/platform/main/db/x-ws-role-repo.ts'), 'utf-8');

describe('ws × 账号 × 角色 自由组合', () => {
  it('⭐ x_ws_account 的唯一约束只在 ws_id 上', () => {
    expect(schema).toMatch(/idx_ws_account_ws\s+ON\s+x_ws_account\s+FIELDS\s+ws_id\s+UNIQUE/);
  });

  it('⭐ handle 绝不能有 UNIQUE —— 否则「同一账号多个 ws」不成立', () => {
    const idx = schema.split('\n').filter((l) =>
      l.includes('x_ws_account') && l.includes('UNIQUE'));
    for (const line of idx) {
      expect(
        /FIELDS\s+handle/.test(line),
        `x_ws_account 的 handle 不得加 UNIQUE,否则同号开两个 ws 会存不进去:\n  ${line}`,
      ).toBe(false);
    }
  });

  it('⭐ 角色表同理:唯一只在 ws_id,不在 role —— 允许多个 ws 同角色', () => {
    expect(schema).toMatch(/idx_ws_role_ws\s+ON\s+x_ws_role\s+FIELDS\s+ws_id\s+UNIQUE/);
    const roleIdx = schema.split('\n').filter((l) =>
      l.includes('x_ws_role') && l.includes('UNIQUE'));
    for (const line of roleIdx) {
      expect(/FIELDS\s+role\b/.test(line), `role 不得 UNIQUE:\n  ${line}`).toBe(false);
    }
  });

  it('setWsAccount 按 ws_id 定位,不按 handle —— 同号多 ws 各存各的', () => {
    const fn = repo.slice(repo.indexOf('export async function setWsAccount'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 1);
    expect(body).toMatch(/WHERE\s+ws_id\s*=\s*\$wsId/);
    expect(body, '不得按 handle 清理其它行(那会把同号的另一个 ws 抹掉)')
      .not.toMatch(/WHERE\s+handle\s*=/);
  });

  it('唯一的全局性约束是 serves_refresh(端口冲突),且按 ws 排他', () => {
    const fn = repo.slice(repo.indexOf('export async function setWsRole'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 1);
    expect(body).toMatch(/serves_refresh\s*=\s*false[\s\S]*ws_id\s*!=\s*\$wsId/);
  });
});
