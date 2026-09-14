/**
 * queryInbox / countInbox 隐藏过滤(屏蔽者 / 自己)。
 *
 * ⚠️ 2026-09-14 重写。本测试原来钉的是「SQL 里必须有 string::lowercase
 * + string::replace 去 @」,理由是「x_tweet 存 '@angeelfv'、x_author 存
 * 'angeelfv',不归一化就恒不命中」。**实测证否**:活库 11739 行 x_tweet
 * 带 @ 的 0 条、含大写 0 条,x_author 亦然 —— 两侧本来就同形。那层字符串
 * 包裹既无必要,又让字段吃不到 idx_tweet_author。原判据已删。
 *
 * 现在钉的是真正会坏事的两件:
 *
 * 1. **$hidden 必须由 LET 前缀定义**。少了前缀,$hidden 未定义 →
 *    条件退化成「NOT IN 空」→ **放行所有行**(屏蔽失效)且不报错。
 *
 * 2. **右侧绝不能内联 (SELECT … FROM x_author …)**。内联子查询会被
 *    按行重算:实测 11684 行 × 35 个屏蔽者 = 22.07s;换成 LET 绑定
 *    后 0.027s,约 800 倍。这不是索引问题 —— 右侧换成硬编码字面量
 *    数组同样是 26ms,真因就是「内联子查询按行重算」。
 *
 * 两种坏法都不报错(一个静默放行、一个只是慢),所以必须由测试钉住。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(
  resolve(__dirname, '../../src/platform/main/db/tweet-inbox-repo.ts'),
  'utf-8',
);

describe('隐藏过滤(屏蔽者 / 自己)', () => {
  it('排除条件存在', () => {
    expect(SRC).toContain('author_handle NOT IN $hidden');
  });

  it('⭐必须有 LET 前缀定义 $hidden —— 少了它会静默放行所有行', () => {
    expect(SRC).toMatch(/LET \$hidden\s*=\s*\(SELECT VALUE handle FROM x_author/);
  });

  it('屏蔽与自己两类都要排除', () => {
    const m = SRC.match(/LET \$hidden[\s\S]{0,200}?\);/);
    expect(m).not.toBeNull();
    expect(m![0]).toContain('blocked = true');
    expect(m![0]).toContain('is_self = true');
  });

  it('⭐条件里绝不能内联子查询 —— 按行重算 = 22s(见文件头)', () => {
    // WHERE 片段里只允许出现 $hidden 变量,不允许出现 SELECT
    const cond = SRC.match(/conditions\.push\('author_handle NOT IN[^)]*\)/);
    expect(cond).not.toBeNull();
    expect(cond![0]).not.toContain('SELECT');
  });

  it('⭐不得再把 handle 包进 lowercase/replace —— 两侧本来同形,包了反而吃不到索引', () => {
    expect(SRC).not.toContain('string::lowercase(author_handle)');
    expect(SRC).not.toMatch(/string::replace\(\s*string::lowercase\(author_handle\)/);
  });

  it('excludeHidden 默认开启(只有显式传 false 才看全量)', () => {
    expect(SRC).toContain('opts.excludeHidden !== false');
  });

  it('queryInbox / countInbox 两条路径都要发 LET 前缀', () => {
    // 两处都必须根据 needsHidden 拼 prelude,否则 $hidden 未定义
    expect(SRC).toMatch(/needsHidden \? HIDDEN_PRELUDE/);
    expect(SRC).toMatch(/anyHidden \? HIDDEN_PRELUDE/);
  });

  it('有 LET 时结果要偏移一位 —— 否则读到的是 LET 自己的结果', () => {
    expect(SRC).toMatch(/needsHidden \? res\[1\] : res\[0\]/);
    expect(SRC).toMatch(/anyHidden \? 1 : 0/);
  });

  it('只过滤不删除 —— 本函数不得出现 DELETE', () => {
    const start = SRC.indexOf('function buildInboxWhere');
    const body = SRC.slice(start, SRC.indexOf('\n}', start));
    expect(body).not.toMatch(/\bDELETE\b/);
  });
});
