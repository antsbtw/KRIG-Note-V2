/**
 * ⭐⭐ 搜索语法规范化 —— 2026-09-23 用户实测踩到的「看着成功实际搜的不是你想搜的」。
 *
 * ── 现象 ──
 * 面板搜索框填 `VPN,翻墙`,采回 **94 条全是不相干的**
 * (孙大午、「po文合集」垃圾推),一条 VPN 相关的都没有。
 *
 * ── 真因 ──
 * X 的搜索语法里**逗号不是「或」**:`VPN,翻墙` 被当成**一个短语**去匹配。
 * ⚠️ 而 X **不报错** —— 于是「搜的不是你想搜的」和「这个词真没人发」
 * 在结果里长得一模一样,这正是本仓最忌的形态。
 *
 * ⭐ 配方跑的时候一直是对的(`buildSearchUrl` 拼 `("VPN" OR "翻墙")`),
 * 手填这条路径**绕开了那套语法** —— 同一件事两种写法才是根子。
 */
import { describe, it, expect } from 'vitest';
import { normalizeSearchQuery } from '../../src/platform/main/x/x-timeline-scan';
import { XPageResolver } from '../../src/platform/main/x/x-pages';

describe('⭐⭐ 多个词要拼成 OR,不能原样丢给 X', () => {
  it('⚠️⚠️ 逗号分隔 → OR(这正是用户踩的那个坑)', () => {
    expect(normalizeSearchQuery('VPN,翻墙'),
      '逗号串没被拆开 —— X 会当成一个短语,采回来全是不相干的')
      .toBe('("VPN" OR "翻墙")');
  });

  it('⭐ 空格、中文逗号、顿号都要认', () => {
    for (const raw of ['VPN 翻墙', 'VPN，翻墙', 'VPN、翻墙']) {
      expect(normalizeSearchQuery(raw), `「${raw}」没被拆开`)
        .toBe('("VPN" OR "翻墙")');
    }
  });

  it('⭐ 单个词加引号即可,不套括号', () => {
    expect(normalizeSearchQuery('翻墙')).toBe('"翻墙"');
  });

  it('⭐ 多词照样全部保留(配方一整套词不能丢)', () => {
    const out = normalizeSearchQuery('VPN, 翻墙, 科学上网, 梯子');
    for (const w of ['VPN', '翻墙', '科学上网', '梯子']) {
      expect(out, `「${w}」丢了 —— 配方的词不能少`).toContain(`"${w}"`);
    }
  });
});

describe('⚠️⚠️ 人写的高级语法绝不许被改写', () => {
  /**
   * ⚠️ 误改的代价比不改更大:人明明写对了,结果被我们改坏,
   * 而现象是「我写的语法它不认」—— 极难查。
   */
  for (const raw of [
    'from:netlab2gfw filter:replies',
    '"exact phrase"',
    'VPN OR 翻墙',
    '(VPN OR proxy) lang:zh',
    'VPN since:2026-09-01',
  ]) {
    it(`⭐ 原样放行:${raw}`, () => {
      expect(normalizeSearchQuery(raw), '人写的高级语法被改写了').toBe(raw);
    });
  }
});

describe('⚠️ 空值不许造出一个搜全站的 URL', () => {
  it('空串 → 空(调用方据此返回 null)', () => {
    expect(normalizeSearchQuery('')).toBe('');
    expect(normalizeSearchQuery('   ')).toBe('');
    expect(normalizeSearchQuery(',,, ')).toBe('');
  });
});

describe('⭐⭐ 接线:x.search 必须走规范化(手填不能绕开)', () => {
  const r = new XPageResolver();

  it('⚠️⚠️ 解析出来的 URL 里必须是 OR 形态', () => {
    const out = r.resolve('x.search', { q: 'VPN,翻墙' });
    expect(out, 'x.search 解析不出来').not.toBeNull();
    const q = new URL(out!.url).searchParams.get('q');
    expect(q, '搜索 URL 里还是原始逗号串 —— 采回来会全不相干')
      .toBe('("VPN" OR "翻墙")');
  });

  it('⭐ 空查询仍然返回 null,不搜全站', () => {
    expect(r.resolve('x.search', { q: '  ' }), '空查询造出了 URL —— 会搜全站')
      .toBeNull();
  });

  it('⭐ describe 要显示**规范化之后**的串(人得看见真正搜的是什么)', () => {
    const out = r.resolve('x.search', { q: 'VPN,翻墙' });
    expect(out!.describe, 'describe 显示的还是原始串 —— 人看不出我们改写过')
      .toContain('OR');
  });
});
