/**
 * ⭐⭐ 求关前核对 X 上的现状(2026-10-21 用户:「准备发消息前要再确认用户的新状态,否则继续关注一个已经关注过的用户可不太好。」)
 * 截图:@luoyisidi 在 X 上已是 Following + Follows you,库里还当候选。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

let records: unknown[] = [];
let asked: string[] = [];
const relWrites: unknown[] = [];
vi.mock('@modules/x/x-host-registry', () => ({ getXHostState: () => ({ wcId: 7 }) }));
vi.mock('@modules/x/x-follow-queue', () => ({ followQueueStatus: () => ({}) }));
vi.mock('@modules/x/x-ops-actions-repo', () => ({ readSettings: async () => ({ settings: { 'ask.collect_pages': 2 } }) }));
vi.mock('@modules/x/x-person-collect', () => ({ collectPersonTab: async () => ({ reached: true, records }) }));
vi.mock('@modules/x/x-people-repo', () => ({ readPerson: async () => ({ display_name: 'L', bio: '#蓝V互关', follows_me: false }) }));
vi.mock('@modules/x/x-account-repo', () => ({ accountForWrite: async () => ({ kind: 'ok', restId: 'ME', handle: 'me' }) }));
vi.mock('@modules/x/x-user-repo', () => ({ writeRelations: async (_a: unknown, obs: unknown[]) => { relWrites.push(...obs); return { report: {}, before: new Map() }; } }));
vi.mock('@storage/surreal/client', () => ({ getXDB: () => ({ query: async (sql: string) => (sql.includes('x_ask') ? [asked] : [[]]) }) }));

import { prepareAskOn } from '@modules/x/x-ask-prepare';
/** 2026-10-24 认号 / 占网页挪到能力 x.ask.prepare 的执行器;这里只测「只干活」的那份(wcId 7 = 已占住的网页) */
const prepareAsk = (_ws: string, acc: string, restId: string, handle: string) => prepareAskOn(7, acc, restId, handle);

const tw = (rel: { following?: boolean; followedBy?: boolean }, id = 't1') => ({
  id, text: '出摊了,浇朋友 #蓝V互关', createdAt: '2026-10-20T00:00:00Z', authorRestId: 'P', ...rel,
});

describe('求关前核对现状', () => {
  beforeEach(() => { relWrites.length = 0; asked = []; });

  it('第一次求关,X 上已互关 → 不求关;关系写回库;不排除', async () => {
    records = [tw({ following: true, followedBy: true })];
    const r = await prepareAsk('ws-1', 'ME', 'P', 'p');
    expect(r.ok && r.plan.kind === 'skip' && r.plan.alreadyRelated).toBe(true);
    expect(r.ok && r.plan.why).toMatch(/已经互关/);
    expect(relWrites).toEqual([expect.objectContaining({ person: 'P', iFollow: true, followsMe: true })]);
  });
  it('第一次求关,我已关注、他没回关 → 也不重复求关', async () => {
    records = [tw({ following: true, followedBy: false })];
    const r = await prepareAsk('ws-1', 'ME', 'P', 'p');
    expect(r.ok && r.plan.why).toMatch(/已经关注他了/);
  });
  it('第一次求关,X 上还没关系 → 照常选推文', async () => {
    records = [tw({ following: false, followedBy: false })];
    const r = await prepareAsk('ws-1', 'ME', 'P', 'p');
    expect(r.ok && r.plan.kind).toBe('tweet');
  });
  it('再互动:他已经回关 → 不用再互动;他还没回关(我关注着)→ 照常', async () => {
    asked = ['old'];
    records = [tw({ following: true, followedBy: true })];
    const a = await prepareAsk('ws-1', 'ME', 'P', 'p');
    expect(a.ok && a.plan.why).toMatch(/已经回关了/);
    records = [tw({ following: true, followedBy: false })];
    const b = await prepareAsk('ws-1', 'ME', 'P', 'p');
    expect(b.ok && b.plan.kind).not.toBe('skip');
  });
});
