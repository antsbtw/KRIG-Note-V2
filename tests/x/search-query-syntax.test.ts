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
import { normalizeSearchQuery, withSinceWindow } from '../../src/platform/main/x/x-timeline-scan';
import { XPageResolver } from '../../src/platform/main/x/x-pages';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
    /**
     * ⚠️ 2026-09-25 从**精确相等**改成**包含** —— 因为解析层现在会追加
     * `since:`(默认只看最近 2 天,用户拍板)。
     * ⭐ 但**不是放宽**:这条钉的是「逗号串有没有被拆成 OR」,
     *   下面那条断言仍然钉死「不许出现原始逗号串」。
     */
    expect(q, '搜索 URL 里还是原始逗号串 —— 采回来会全不相干')
      .toContain('("VPN" OR "翻墙")');
    expect(q, '原始逗号串仍在 —— 规范化没生效').not.toMatch(/VPN,\s*翻墙/);
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

describe('⭐⭐ 搜索默认只看最近几天(用户 2026-09-25 拍板)', () => {
  /**
   * > 「查询采集,建议一次不要超过 24 小时的帖子,除非有特殊约定」
   *
   * ── 查证到的事实 ──
   * **配方跑的时候一直有 `since:`**(buildSearchUrl 里),而**手填这条路完全没有**
   * —— 面板/编排档搜的是**全部历史**。
   * ⭐ 与「逗号当成短语」同一形态:同一件事两套实现,手填那套绕开了规则。
   *
   * ── ⚠️ 为什么默认 2 天而不是 24 小时 ──
   *  · X 的 `since:` **只精确到天**(语法限制)→ 填 1 天会漏掉昨晚发的
   *  · X 的**搜索索引有延迟**,刚发的推可能几小时后才进结果
   *  · ⭐ 配方那边甚至故意叠 **48h 重叠**:「**宁可重复,不可遗漏**」
   */
  const today = () => new Date().toISOString().split('T')[0];

  it('⭐⭐ 默认加 since:(不加就是搜全部历史)', () => {
    const out = withSinceWindow('("VPN")');
    expect(out, '没加时间窗 —— 会搜到几年前的老推').toMatch(/since:\d{4}-\d{2}-\d{2}/);
  });

  it('⚠️ 默认是 2 天,不是 1 天', () => {
    /** ⚠️ since: 只到天级 + 索引延迟 —— 填 1 会漏昨晚的 */
    const out = withSinceWindow('("VPN")');
    const d = out.match(/since:(\d{4}-\d{2}-\d{2})/)![1];
    const days = Math.round((Date.parse(today()) - Date.parse(d)) / 86400000);
    expect(days, `默认窗口是 ${days} 天 —— 应该是 2(1 天会漏昨晚的)`).toBe(2);
  });

  it('⭐ days 可改', () => {
    const d5 = withSinceWindow('("VPN")', 5).match(/since:(\S+)/)![1];
    const days = Math.round((Date.parse(today()) - Date.parse(d5)) / 86400000);
    expect(days).toBe(5);
  });

  it('⚠️⚠️ days=0 = 搜全部历史(逃生口,不许丢)', () => {
    /** ⚠️ 「除非有特殊约定」—— 必须留得下这条路 */
    expect(withSinceWindow('("VPN")', 0), 'days=0 仍加了时间窗 —— 搜不了历史了')
      .toBe('("VPN")');
  });

  it('⚠️⚠️ 查询自带 since:/until: 时原样放行,不叠加', () => {
    /**
     * ⚠️ 人显式写了时间条件,我们再塞一个会**互相打架而且不报错** ——
     * 现象是「我明明写了 since 却搜不到那段时间的」,极难查。
     */
    for (const q of ['VPN since:2026-01-01', 'VPN until:2026-05-01', 'VPN since_time:1700000000']) {
      expect(withSinceWindow(q), `「${q}」被叠加了第二个时间条件`).toBe(q);
    }
  });

  it('⭐ 空查询不动它(调用方据此返回 null)', () => {
    expect(withSinceWindow('')).toBe('');
  });
});

describe('⭐⭐ 接线:x.search 解析出来的 URL 真带 since', () => {
  const r = new XPageResolver();

  it('⚠️⚠️ 不填 days 也要有时间窗(默认值必须生效)', () => {
    const out = r.resolve('x.search', { q: 'VPN 翻墙' })!;
    const q = new URL(out.url).searchParams.get('q')!;
    expect(q, '解析出来的 URL 没有 since —— 默认值没生效,还是搜全历史')
      .toMatch(/since:\d{4}-\d{2}-\d{2}/);
  });

  it('⭐ days=0 时不加(特殊约定的逃生口)', () => {
    const out = r.resolve('x.search', { q: 'VPN', days: '0' })!;
    expect(new URL(out.url).searchParams.get('q'), 'days=0 仍加了时间窗')
      .not.toMatch(/since:/);
  });

  it('⚠️ days 是可选参数 —— 不填不许当成「缺参数」', () => {
    /**
     * ⚠️ 面板把「可选参数」原来写死成只有 `f`,新增 days 会被当成必填 →
     * 不填就禁用采集按钮,而人根本不知道该填什么。
     * ⭐ 清单放在页面表(真源),面板从 IPC 读,不抄一份。
     */
    const pages = readFileSync(
      join(process.cwd(), 'src/platform/main/x/x-pages.ts'), 'utf-8');
    expect(pages, '没导出可选参数清单').toMatch(/export const OPTIONAL_PAGE_PARAMS/);
    expect(pages, 'days 不在可选清单里 —— 会被当成必填').toMatch(/'days'/);
    const view = readFileSync(
      join(process.cwd(), 'src/views/web-console/WebConsoleView.tsx'), 'utf-8');
    expect(view, "面板还把可选参数写死成 'f' —— 加新参数不会自己长")
      .not.toMatch(/k !== 'f' && !valOf\(k\)/);
  });
});