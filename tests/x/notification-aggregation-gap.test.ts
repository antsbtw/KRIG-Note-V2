/**
 * 聚合通知的缺口计量。
 *
 * ⚠️ 2026-09-04 真机坐实(用户点了 2 个赞,只收到 1 条通知):
 *   X 把多次同类互动并成**一条**通知,文案里带真实次数
 *   (「liked 5 of your posts」→ 再点两个赞变成「liked 7 of your posts」),
 *   而 target_objects **恒为 1 条**。另外 N−1 条被赞的推 id 载荷里根本没有。
 *
 * 早先猜「靠会话根 + 本地推文表能补出来」——**已被数据否掉**:
 *   每条聚合通知的代表推各不相同(2090094997123092826 / 2083622516308733974 /
 *   2083535586695004169),不是同一会话簇。目前**无解法**。
 *
 * 所以本函数不补全,只把缺口变成**可读的数字**:
 * 让「X 扣着多少没给」可核对,而不是静悄悄地少。
 */

import { describe, it, expect } from 'vitest';
import { aggregationGap } from '@platform/main/x/x-notifications';

describe('聚合缺口计量', () => {
  it('真机文案:liked 7 of your posts,载荷只给 1 条 → 缺 6', () => {
    const g = aggregationGap('OBox MyCloud liked 7 of your posts', 1);
    expect(g).toEqual({ claimed: 7, got: 1, missing: 6 });
  });

  it('转发同样会聚合', () => {
    expect(aggregationGap('KRIG Note reposted 2 of your posts', 1))
      .toEqual({ claimed: 2, got: 1, missing: 1 });
  });

  it('⭐ 非聚合通知返回 undefined —— 不能给普通通知误报缺口', () => {
    // 这几条真机都见过,文案里没有「N of your posts」
    expect(aggregationGap('OBox MyCloud liked your post', 1)).toBeUndefined();
    expect(aggregationGap('KRIG Note reposted your post', 1)).toBeUndefined();
    expect(aggregationGap('yameidei liked your reply', 1)).toBeUndefined();
    expect(aggregationGap('A followed you', 0)).toBeUndefined();
  });

  it('文案缺失时不报缺口', () => {
    expect(aggregationGap(undefined, 1)).toBeUndefined();
  });

  it('载荷给足了就没有缺口(将来 X 若改成给全量,这里自动归零)', () => {
    expect(aggregationGap('liked 3 of your posts', 3))
      .toEqual({ claimed: 3, got: 3, missing: 0 });
  });

  it('给的比声称的还多也不会算出负数', () => {
    expect(aggregationGap('liked 2 of your posts', 5)?.missing).toBe(0);
  });

  /**
   * 反向注入(feedback-verify-guard-can-fail):
   * 若把缺口恒算成 0(= 假装没丢),真机那条必须与之不同。
   */
  it('反向注入:缺口恒为 0 时,真机样本会暴露差异', () => {
    const broken = (): number => 0;
    expect(aggregationGap('OBox MyCloud liked 7 of your posts', 1)?.missing)
      .not.toBe(broken());
  });
});
