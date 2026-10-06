/**
 * ⭐⭐⭐ 一跑的判断依据要**落得下来** —— 用户 2026-10-06:
 * 「这两个你没有办法自行读取吗?」
 *
 * ⚠️ 不能,因为那两行只渲染在面板上、关掉就没 ——
 * 于是每次核对我都得回头要截图。这正是
 * `feedback-maintainability-over-feature-completion` 的原病。
 * ⭐ 判据:**下次验证能不能不靠人、只靠留下的东西说清楚**。
 */
import { describe, it, expect } from 'vitest';
import { buildRunReport, hitRoundCap } from '@modules/x/x-run-report';
import type { RunResult } from '@modules/x/x-collect-run';

const base = (over: Partial<RunResult> = {}): RunResult => ({
  audits: [], totalResponses: 0, summary: null, harvest: null,
  plan: null, paging: null, fetched: [], users: [], kind: 'empty', ...over,
});

const detail = (rows: Array<[number, number, string]>) =>
  rows.map(([round, fresh, cursor]) => ({ round, fresh, cursor, responses: 1 }));

const report = (over: Partial<RunResult> = {}, page = 'x.following'): string =>
  buildRunReport({ run: base(over), page, wantPages: 100, at: '2026-10-06T01:00' });

describe('一跑的账要落得下来', () => {
  it('⭐⭐⭐ 撞轮次上限要明说「不是滚到底」', () => {
    /**
     * ⚠️⚠️ 真机 2026-10-05:面板一直写着「达到轮次上限 60」,
     * 而我盯着**翻页**那个停因,把它漏了两跑(following 卡在 150 人)。
     */
    const t = report({
      harvest: { items: [], stopReason: '达到轮次上限 60', rounds: 60, reachedBottom: false },
    });
    expect(t).toContain('达到轮次上限 60');
    expect(t, '光给停因不够 —— 结论要写出来').toContain('不是滚到底');
    expect(t).toContain('这个数不是全部');
  });

  it('⭐⭐ 滚到底了也要明说 —— 成功路径同样留痕', () => {
    const t = report({
      harvest: { items: [], stopReason: '滚到底了', rounds: 12, reachedBottom: true },
    });
    expect(t).toContain('✓ 滚到底了');
    expect(t, '滚到底就不该再喊上限').not.toContain('不是滚到底');
  });

  it('⭐⭐⭐ 零新增 + 游标每轮都变 → 判「不是游标 bug，是请求形状」', () => {
    /**
     * ⭐ 这一句就是我每次要问人的那个问题的答案。
     * 两个毛病的下一步完全不同:一个我自己改,一个要去社区查。
     * ⚠️ 样本要够厚(≥5 轮)**且零新增不止最后一轮** —— 见下面两条。
     */
    const t = report({
      paging: {
        rounds: 6, stopReason: '业务判定够了', freshTotal: 0,
        rounds_detail: detail([[1, 0, 'a'], [2, 0, 'b'], [3, 0, 'c'],
          [4, 0, 'd'], [5, 0, 'e'], [6, 0, 'f']]),
      },
    });
    expect(t).toContain('每轮都在变');
    expect(t).toContain('请求形状');
    expect(t, '游标都不一样就不该说是我们的 bug').not.toContain('是我们这边的 bug');
  });

  it('⭐⭐⭐ 零新增 + 游标重复 → 判「是我们这边的 bug」', () => {
    const t = report({
      paging: {
        rounds: 6, stopReason: '游标不再变化', freshTotal: 0,
        rounds_detail: detail([[1, 0, 'a'], [2, 0, 'a'], [3, 0, 'a'],
          [4, 0, 'a'], [5, 0, 'a'], [6, 0, 'a']]),
      },
    });
    expect(t).toContain('是我们这边的 bug');
    expect(t, '有重复游标就不该甩锅给 X').not.toContain('请求形状');
  });

  it('⭐⭐⭐ 只翻了两轮**不许**下结论 —— 样本太薄', () => {
    /**
     * ⚠️⚠️ **我自己栽的**(2026-10-06 真机第一跑):
     * 总共 2 轮、1 轮零新增,报告就断言「多半是请求形状问题，去社区查」。
     * ⭐ 而「最后一轮零新增」恰恰是**翻到底的正常现象**。
     * 拿撑不住结论的样本下结论 = **制造假线索引人改没坏的代码**
     * (`feedback-check-sample-contains-phenomenon`)。
     */
    const t = report({
      paging: {
        rounds: 2, stopReason: '游标不再变化（真的翻不动了）', freshTotal: 50,
        rounds_detail: detail([[1, 50, 'aaa'], [2, 0, 'bbb']]),
      },
    });
    expect(t, '样本薄就该说不知道').toContain('样本太薄');
    expect(t, '不许凭 2 轮把人指向社区').not.toContain('请求形状');
    expect(t).not.toContain('是我们这边的 bug');
    /** ⭐ 而且要说明「零新增只在最后一轮」是正常的 */
    expect(t).toContain('最后一轮');
  });

  it('⭐⭐⭐ 够厚但零新增只在最后一轮 → 那是翻到底,不报警', () => {
    const t = report({
      paging: {
        rounds: 6, stopReason: '没有下一页游标', freshTotal: 100,
        rounds_detail: detail([[1, 20, 'a'], [2, 20, 'b'], [3, 20, 'c'],
          [4, 20, 'd'], [5, 20, 'e'], [6, 0, 'f']]),
      },
    });
    expect(t, '最后一轮没新的 = 到底了,不是毛病').not.toContain('请求形状');
    expect(t).not.toContain('是我们这边的 bug');
  });

  it('⭐⭐ 每轮都有新增时不许瞎报警', () => {
    /** ⚠️ 判据太宽会被无视,那是另一种假绿 */
    const t = report({
      paging: {
        rounds: 2, stopReason: '已翻够', freshTotal: 40,
        rounds_detail: detail([[1, 20, 'aaa'], [2, 20, 'bbb']]),
      },
    });
    expect(t).toContain('零新增轮次：0/2');
    expect(t).not.toContain('bug');
    expect(t).not.toContain('请求形状');
  });

  it('⭐⭐⭐ 每一轮的游标都要逐行列出 —— 这是原始证据', () => {
    const t = report({
      paging: {
        rounds: 2, stopReason: 'x', freshTotal: 1,
        rounds_detail: detail([[1, 1, 'cur-A'], [2, 0, 'cur-B']]),
      },
    });
    expect(t).toContain('cur-A');
    expect(t).toContain('cur-B');
    expect(t).toMatch(/轮次\s+新增\s+响应\s+游标/);
  });

  it('⭐⭐ 覆盖率要连样本量一起写 —— 「1 个人里 1 个有」也是 100%', () => {
    const t = report({
      users: [{
        users: 1, items: [{ handle: 'a', seq: 0 } as never],
        hasCursor: false, terminated: false,
        coverage: { 粉丝数: 100 }, problems: [],
      }],
    });
    expect(t).toContain('粉丝数');
    expect(t, '光给百分比会骗人').toContain('样本：第一份账 1 人');
  });

  it('⭐⭐ 解析问题原样带出,不许吞', () => {
    const t = report({
      users: [{
        users: 0, items: [], hasCursor: false, terminated: false,
        coverage: {}, problems: ['**粉丝数 一个都没解出来**（0/50）'],
      }],
    });
    expect(t).toContain('粉丝数 一个都没解出来');
  });

  it('⭐ hitRoundCap 只认「轮次上限」,不误伤别的停因', () => {
    expect(hitRoundCap('达到轮次上限 60')).toBe(true);
    expect(hitRoundCap('滚到底了')).toBe(false);
    expect(hitRoundCap(undefined)).toBe(false);
  });
});
