/**
 * ⭐⭐ **备料**(流水线第 ③ 步)—— 用户 2026-09-26:
 *
 * > 「针对目标数据，获取对应的 bio-上下文--打包」
 * > 「这一步应该是先查询数据库，有就即可获取，没有再从 x 上定位获取。」
 *
 * ⚠️ 这一步原来**根本不在编排里** —— 两个预取只挂在收件箱面板的按钮上。
 * 手点时人就是那根接线;编排一跑,拟回复拿到的推**没 bio 也没上文**。
 * 这正是用户说的「你割裂了流程了」。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), 'utf-8');
/** ⚠️ 行注释正则要躲开 `https://` 里的 `//`(本仓踩过:整段 URL 被删→假绿) */
const strip = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('⭐⭐ 上文深度是变量,不是写死的 1 条', () => {
  const src = strip(read('src/platform/main/x/x-parent-tweet.ts'));

  it('⭐⭐ depth 参数真的进了注入脚本(不是收了不用)', () => {
    /**
     * ⚠️ 本仓最贵的死参数形态:「类型有、JSON 有、消费层零消费」。
     * 判据 = 那段浏览器脚本里**真的用到了 depth**,
     * 不能只断言函数签名上有这个参数。
     */
    const i = src.indexOf('var from = Math.max(0, idx -');
    expect(i, '注入脚本里没有按 depth 取的起点 —— 还是只读紧邻一条').toBeGreaterThan(0);
    const line = src.slice(i, src.indexOf('\n', i));
    expect(line, '起点没有用到 depth,是写死的').toMatch(/\$\{[^}]*depth[^}]*\}/);
  });

  it('⭐ 由近及远:context[0] 必须是紧邻那条', () => {
    /** 顺序错了的话,模型会把最远的那条当成直接上文 */
    const i = src.indexOf('for (var k = idx - 1;');
    expect(i, '不是从 idx-1 倒着取 —— 顺序会反').toBeGreaterThan(0);
    expect(src.slice(i, src.indexOf('\n', i)), '不是倒序(由近及远)').toMatch(/k--/);
  });

  it('⚠️ 向后兼容:老调用方只读 text,仍要拿到紧邻那条', () => {
    const i = src.indexOf("via: 'thread-page',");
    expect(i, '找不到真正的返回值').toBeGreaterThan(0);
    const blk = src.slice(Math.max(0, i - 200), i);
    expect(blk, 'text 不再是紧邻那条 —— 老调用方会拿到别的推').toMatch(/text: ctx\[0\]\.text/);
  });

  it('⚠️ 空正文的条目要丢掉(纯图片推没有 tweetText)', () => {
    expect(
      src,
      '留着空条目 → 模型读到「有一条但没内容」',
    ).toMatch(/\.filter\(\(r\) => r\.text\)/);
  });
});

describe('⭐⭐ 备料:先查库,缺了才去 X 取', () => {
  const src = strip(read('src/platform/main/x/x-prefetch-context.ts'));

  it('⭐⭐ bio:库里新鲜就跳过,不去 X 跑', () => {
    const i = src.indexOf('const fresh =');
    expect(i, '没有「新鲜就跳过」的判据 —— 每次都会重跑').toBeGreaterThan(0);
    const blk = src.slice(i, i + 300);
    expect(blk, '没用 PROFILE_STALE_HOURS 当新鲜度判据').toMatch(/PROFILE_STALE_HOURS/);
    expect(blk, '命中缓存没有 continue —— 还是会往下跑去采')
      .toMatch(/bioCached \+= 1;[\s\S]{0,40}continue/);
  });

  it('⭐⭐ 上文:库里有 parent_text 就不重抓', () => {
    expect(
      src,
      '没有「已有上文就跳过」—— 每跑一次就重抓一遍,白跳详情页',
    ).toMatch(/\.filter\(\(t\) => !t\.parent_text\)/);
  });

  it('⭐⭐ 只对真的是回复的推抓上文', () => {
    /**
     * ⚠️ 实测 60 条 worth 样本里 **39 条是孤立原创推**(天生没有上下文)。
     * 为它们白跑一次导航是纯浪费。
     */
    const i = src.indexOf('function isReply');
    expect(i, '没有 isReply 判据 —— 会给孤立原创推白跳详情页').toBeGreaterThan(0);
    const blk = src.slice(i, i + 220);
    expect(blk, '判据没看 in_reply_to_user').toMatch(/in_reply_to_user/);
    expect(src, 'isReply 算出来了却没用来筛').toMatch(/pool\.filter\(isReply\)/);
  });

  it('⚠️ handle 必须归一化(漂移 = 永远命中不上且不报错)', () => {
    const i = src.indexOf('const handles =');
    expect(i, '找不到取 handle 的地方').toBeGreaterThan(0);
    expect(
      src.slice(i, i + 200),
      'x_tweet 存 @Xxx、x_author 存小写 —— 不归一化就永远查不到,而且不报错',
    ).toMatch(/normalizeHandle/);
  });

  it('⭐ 连续失败要报机制可疑,不是默默继续', () => {
    expect(src, '没有连续失败的计数').toMatch(/maxConsecutive/);
    expect(
      src,
      '连着一串采不到多半是机制坏了 —— 继续往下拟回复,人会在毫不知情下拿到一堆「只读正文」的建议',
    ).toMatch(/mechanismSuspect: maxConsecutive >= 5/);
  });

  it('⭐ 深度有没有生效,看 avgDepth(恒为 1 就是没生效)', () => {
    expect(src, '没有回读实际抓到的深度 —— 变量填了也不知道生没生效')
      .toMatch(/avgDepth: ctxFetched > 0/);
  });
});

describe('⭐⭐ prefetch 接进了编排(不是只挂在手点按钮上)', () => {
  it('⭐⭐ 能力表里有 prefetch', () => {
    const caps = strip(read('src/platform/main/x/x-flow-capabilities.ts'));
    expect(caps, 'x 的能力适配器里没有 prefetch').toMatch(/async prefetch\(/);
    expect(caps, '没调共用函数 —— 别在适配器里写第二份实现')
      .toMatch(/prefetchReplyContext\(/);
  });

  it('⭐⭐ 契约、登记表、配方三处都登记了', () => {
    expect(
      strip(read('src/shared/types/flow-recipe-types.ts')),
      "FlowStepKind 里没登记 'prefetch'",
    ).toMatch(/\| 'prefetch'/);
    const runner = strip(read('src/platform/main/flow/flow-runner.ts'));
    expect(runner, 'FlowCapabilities 里没有 prefetch').toMatch(/prefetch\(params/);
    expect(
      runner,
      "STEP_TYPE_BY_KIND 里没登记 prefetch —— step_type 会变成 unknown",
    ).toMatch(/prefetch: 'fetch'/);
    expect(
      strip(read('src/platform/main/x/x-flow-recipes.ts')),
      "默认配方里没有 prefetch 这一步 —— 接了也不会跑",
    ).toMatch(/kind: 'prefetch'/);
  });

  it('⚠️ 备料**不当闸门**:没料也能拟回复,只是质量差', () => {
    /**
     * ⚠️ 与判断步不同:判断说「没候选」是真的无事可做;
     * 备料失败只是语境差,不该把后面整条掐掉。
     */
    const caps = read('src/platform/main/x/x-flow-capabilities.ts');
    const i = caps.indexOf('async prefetch(');
    const j = caps.indexOf('async planReply(');
    expect(i, '找不到 prefetch').toBeGreaterThan(0);
    expect(j, '找不到 planReply').toBeGreaterThan(i);
    const body = caps.slice(i, j);
    expect(body.length, 'slice 空转').toBeGreaterThan(100);
    expect(
      /hasCandidates:/.test(strip(body)),
      '备料表态了 hasCandidates —— 会把拟回复误刹',
    ).toBe(false);
  });

  it('⭐ 备料要留观察点(先查库省了多少、现采成功率)', () => {
    const caps = read('src/platform/main/x/x-flow-capabilities.ts');
    const i = caps.indexOf('async prefetch(');
    const body = strip(caps.slice(i, caps.indexOf('async planReply(')));
    expect(body, '没留 evidence —— 「先查库」到底省没省,回头查不到')
      .toMatch(/evidence: \{ items:/);
  });
});
