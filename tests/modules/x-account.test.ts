/**
 * ⭐⭐ 认号 + 关系按号存(2026-10-16,蓝V互关 M0)—— 纯逻辑
 *
 * 用户 10-16:「互相覆盖是很严重的问题哦,应该是分字段,判断起来简单吧?」认号方式选 A(从页面认)。
 * 真库行为在 x-relation.verify.test.ts;这里钉判断口径。
 */
import { describe, it, expect } from 'vitest';
import {
  parseWhoAmI, decideAccount, buildRelationUpsert, buildRelationChange, PEOPLE_WITH_RELATION, PERSON_WITH_RELATION,
} from '@modules/x/x-account';

describe('parseWhoAmI —— 从页面标记认登录号', () => {
  it('个人资料链接 → handle(归一化成小写)', () => {
    expect(parseWhoAmI({ profileHref: '/Otun_MyVPN' })).toEqual({ handle: 'otun_myvpn' });
    expect(parseWhoAmI({ profileHref: 'https://x.com/otun_myvpn?x=1' })).toEqual({ handle: 'otun_myvpn' });
  });

  it('只有账号按钮文字时用它', () => {
    expect(parseWhoAmI({ switcherText: 'OTun 加速器@otun_myvpn' })).toEqual({ handle: 'otun_myvpn' });
  });

  it('⭐⭐ 两处都有但不一致 → 报错,不挑一个(「我是谁」漂移的老坑)', () => {
    const r = parseWhoAmI({ profileHref: '/aaa', switcherText: '@bbb' });
    expect('error' in r && r.error).toMatch(/不一致/);
  });

  it('都找不到 / 脚本没返回 → 报错,带上脚本给的原因', () => {
    expect(parseWhoAmI({})).toHaveProperty('error');
    expect(parseWhoAmI(null)).toHaveProperty('error');
    const r = parseWhoAmI({ why: 'TypeError: boom' });
    expect('error' in r && r.error).toContain('boom');
  });

  it('⭐ href 是系统路径(/i/flow、/home)或不合法 → 不认,不当成名叫「i」的号', () => {
    expect(parseWhoAmI({ profileHref: '/i/flow/login' })).toHaveProperty('error');
    expect(parseWhoAmI({ profileHref: '/home' })).toHaveProperty('error');
    expect(parseWhoAmI({ profileHref: '/' })).toHaveProperty('error');
    expect(parseWhoAmI({ profileHref: '/a-b' })).toHaveProperty('error');
  });
});

describe('decideAccount —— 这批关系记到哪个号', () => {
  const row = { wsId: 'ws-1', handle: 'otun_myvpn', restId: '42' };

  it('页面与库里一致且有数字 id → ok', () => {
    expect(decideAccount(row, { handle: 'otun_myvpn' })).toEqual({ kind: 'ok', restId: '42', handle: 'otun_myvpn' });
  });

  it('⭐⭐⭐ 登录的号变了 → 不写(needIdentify),**绝不**沿用旧号的 id', () => {
    const d = decideAccount(row, { handle: 'other' });
    expect(d.kind).toBe('needIdentify');
    expect(JSON.stringify(d)).not.toContain('42');
  });

  it('没登记 / 没数字 id / 页面认不出 → 都不写,各有原因', () => {
    expect(decideAccount(null, { handle: 'a' }).kind).toBe('needIdentify');
    expect(decideAccount({ wsId: 'ws-1', handle: 'a' }, { handle: 'a' }).kind).toBe('needIdentify');
    expect(decideAccount(row, { error: '找不到' })).toEqual({ kind: 'error', reason: '找不到' });
  });
});

describe('buildRelationUpsert —— 一条关系的 SQL', () => {
  const OBS = '2026-10-16T00:00:00.000Z';

  it('⭐⭐ 按 [号, 人] 定位;不用 UPSERT … WHERE(没匹配什么都不写也不报错)', () => {
    const q = buildRelationUpsert('42', { person: '7', iFollow: true, followsMe: false, observedAt: OBS })!;
    expect(q.sql).toContain("UPSERT type::record('x_relation', [$account, $person])");
    expect(q.sql).not.toMatch(/\bWHERE\b/);
    expect(q.vars).toMatchObject({ account: '42', person: '7', i_follow: true, follows_me: false, obs: OBS });
  });

  it('⭐⭐⭐ 旧观察不覆盖新观察:标记都带时间条件;observed_at 只赋值一次且在最后', () => {
    const q = buildRelationUpsert('42', { person: '7', iFollow: true, followsMe: true, observedAt: OBS })!;
    for (const col of ['i_follow', 'follows_me']) {
      expect(q.sql).toMatch(new RegExp(`${col} = IF \\(observed_at = NONE OR observed_at <= type::datetime\\(\\$obs\\)\\) THEN`));
    }
    const sets = q.sql.slice(q.sql.indexOf(' SET ') + 5, q.sql.indexOf(' RETURN'));
    expect(sets.match(/\bobserved_at = IF\b/g)?.length).toBe(1);
    expect(sets.trim()).toMatch(/observed_at = IF [^,]+ END$/);
  });

  it('⭐⭐ 只写有值的标记:载荷没带的不冲成 NONE', () => {
    const q = buildRelationUpsert('42', { person: '7', followsMe: true, observedAt: OBS })!;
    expect(q.sql).not.toContain('i_follow');
    expect(q.vars).not.toHaveProperty('i_follow');
  });

  it('两个标记都不知道 / 自己对自己 → 不写;id 为空 → 抛', () => {
    expect(buildRelationUpsert('42', { person: '7', observedAt: OBS })).toBeNull();
    expect(buildRelationUpsert('42', { person: '42', iFollow: true, observedAt: OBS })).toBeNull();
    expect(() => buildRelationUpsert('', { person: '7', iFollow: true, observedAt: OBS })).toThrow();
  });
});

describe('读关系的来源', () => {
  it('⭐⭐ 人表 + 当前号($acct)的关系;同名字段盖住人表上停用的旧字段', () => {
    for (const src of [PEOPLE_WITH_RELATION, PERSON_WITH_RELATION]) {
      expect(src).toContain("type::record('x_relation', [$acct, rest_id]).i_follow AS i_follow");
      expect(src).toContain("type::record('x_relation', [$acct, rest_id]).follows_me AS follows_me");
    }
    expect(PERSON_WITH_RELATION).toContain("FROM type::record('x_author', $rest_id)");
  });
});

describe('⭐⭐ buildRelationChange —— 关系变了才记一条(1.2.28)', () => {
  /** 用户 10-16:「增加一个表，记录关系的变化的，不久没有这个问题啦?」 */
  const T1 = '2026-10-10T00:00:00.000Z';
  const T2 = '2026-10-16T00:00:00.000Z';
  const was = { i_follow: true, follows_me: false, observed_at: T1 };

  it('关系没变 → 不记(名单重采几千人,没变的一条不写)', () => {
    expect(buildRelationChange('42', was, { person: '7', iFollow: true, followsMe: false, observedAt: T2 }, 'followers')).toBeNull();
    /** 只带了一个标记、且与之前一致 → 也不记 */
    expect(buildRelationChange('42', was, { person: '7', followsMe: false, observedAt: T2 }, 'followers')).toBeNull();
  });

  it('⭐ 变了 → 记从什么到什么、什么时候看到的、上次看到旧关系是什么时候', () => {
    const c = buildRelationChange('42', was, { person: '7', followsMe: true, observedAt: T2 }, 'profile-refresh')!;
    expect(c.sql).toMatch(/^CREATE x_relation_change SET/);
    expect(c.vars).toMatchObject({
      account: '42', person: '7', from_i: true, from_f: false, to_i: true, to_f: true,
      obs: T2, prev: T1, source: 'profile-refresh',
    });
  });

  it('⭐ 这个号第一次记到他 → 记一条基线(from 为空,prev 为空)', () => {
    const c = buildRelationChange('42', null, { person: '7', iFollow: true, followsMe: true, observedAt: T2 }, 'migration')!;
    expect(c.vars).toMatchObject({ from_i: undefined, from_f: undefined, to_i: true, to_f: true, prev: undefined });
  });

  it('⭐⭐ 观察比库里旧(upsert 没改)→ 不记,否则会记出一条从没发生过的变化', () => {
    expect(buildRelationChange('42', { ...was, observed_at: T2 }, { person: '7', followsMe: true, observedAt: T1 }, 'tweet-authors')).toBeNull();
  });

  it('SDK 给的 DateTime 对象也能比时间', () => {
    const sdk = { ...was, observed_at: { toISOString: () => T2 } };
    expect(buildRelationChange('42', sdk, { person: '7', followsMe: true, observedAt: T1 }, 'x')).toBeNull();
    expect(buildRelationChange('42', sdk, { person: '7', followsMe: true, observedAt: T2 }, 'x')!.vars.prev).toBe(T2);
  });

  it('自己对自己 / 两个标记都不知道 → 不记(与 buildRelationUpsert 同口径)', () => {
    expect(buildRelationChange('42', null, { person: '42', iFollow: true, observedAt: T2 }, 'x')).toBeNull();
    expect(buildRelationChange('42', null, { person: '7', observedAt: T2 }, 'x')).toBeNull();
  });
});
