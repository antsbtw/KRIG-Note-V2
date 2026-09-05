/**
 * 通知监听的「假绿灯」守卫。
 *
 * ⚠️ 2026-09-03 真机踩到:面板显示「● 监听中」、绿点亮着,
 *   而「收到载荷 0 个」一动不动 —— 因为左侧 X 停在首页(For you)。
 *   X 只在**通知页**才轮询 NotificationsTimeline,首页轮询的是 HomeTimeline,
 *   全被 `if (!u.includes('Notifications')) return` 丢掉。
 *   CDP attach 在任何 x.com 页面上都成功,所以绿灯是**真的在撒谎**:
 *   它只证明「连上了」,不证明「在听正确的频道」。
 *
 * 这一族 bug 的共同形态是「看着成功实际没有」,判据必须钉死在 URL 上。
 */

import { describe, it, expect } from 'vitest';
import { canReceiveNotifications, shouldReturnToNotifications } from '@platform/main/x/x-notification-watch';

describe('通知监听页面守卫 —— 挡「假绿灯」', () => {
  it('通知页:能收到载荷', () => {
    expect(canReceiveNotifications('https://x.com/notifications')).toBe(true);
  });

  it('通知页的子标签(All/Mentions)一样算', () => {
    // 面板实测就停在 All 上,子路由不能被判成「不是通知页」
    expect(canReceiveNotifications('https://x.com/notifications/mentions')).toBe(true);
  });

  it('⭐ 首页:必须判成收不到 —— 这正是真机踩到的那一次', () => {
    expect(canReceiveNotifications('https://x.com/home')).toBe(false);
  });

  it('其它 x.com 页面同样收不到', () => {
    expect(canReceiveNotifications('https://x.com/OTun_MyVPN/status/2092213139139854555')).toBe(false);
    expect(canReceiveNotifications('https://x.com/explore')).toBe(false);
    expect(canReceiveNotifications('https://x.com/i/bookmarks')).toBe(false);
  });

  it('页面没取到(空串)不能当成通知页', () => {
    // getURL() 可能抛,兜底是空串 —— 空串绝不能被判成「可以监听」,
    // 否则守卫在最该响的时候(webview 出问题)恰好哑掉
    expect(canReceiveNotifications('')).toBe(false);
  });

  /**
   * 反向注入(feedback-verify-guard-can-fail):
   * 把守卫掏空成恒真,上面那些用例必须变红 —— 否则「全绿」是假保证。
   */
  it('反向注入:守卫恒返回 true 时,首页用例会失败', () => {
    const broken = (_url: string): boolean => true;   // 掏空后的守卫
    // 首页在坏守卫下被判成「能收」= 假绿灯重现
    expect(broken('https://x.com/home')).toBe(true);
    // 而真守卫必须与之相反 —— 这条断言把「两者不同」钉死,
    // 将来谁把 canReceiveNotifications 改宽,这里立刻红
    expect(canReceiveNotifications('https://x.com/home'))
      .not.toBe(broken('https://x.com/home'));
  });
});

/**
 * 页面被导航走后的**自动跳回**。
 *
 * ⚠️ 2026-09-04 用户实测:「有时候它会自动跳转到其他页面而无法捕捉 notification」。
 *   同一个 X webview 被很多路径共用并 loadURL 走,最可能的是 /refresh 外部触发
 *   (x-article-replies.ts:161)—— campaign-tasks 从别的机器随时敲,本机没人在场。
 *   原先守卫只在**启动时**校验页面,跑起来后被抢走就只剩一条黄字,
 *   而无人值守时没人看得见 —— 通知静默地断了。
 */
describe('页面漂移后自动跳回', () => {
  const T0 = 1_000_000;

  it('还在通知页 → 不动', () => {
    expect(shouldReturnToNotifications('https://x.com/notifications', T0)).toBe(false);
  });

  it('⭐ 被导航到推文详情页(/refresh 抓回复会这么干)→ 必须跳回', () => {
    expect(shouldReturnToNotifications(
      'https://x.com/OTun_MyVPN/status/2095910972506427676', T0)).toBe(true);
  });

  it('被导航到首页 / compose 也要跳回', () => {
    expect(shouldReturnToNotifications('https://x.com/home', T0)).toBe(true);
    expect(shouldReturnToNotifications('https://x.com/compose/post', T0)).toBe(true);
  });

  it('⭐ 冷却期内不重复跳 —— 别跟正在干正事的流程抢 webview', () => {
    // 刚跳过 5 秒,别人可能正在发推/抓回复,这时再抢会把人家的页面弄没
    expect(shouldReturnToNotifications('https://x.com/home', T0 + 5_000, T0)).toBe(false);
  });

  it('冷却过后可以再跳', () => {
    expect(shouldReturnToNotifications('https://x.com/home', T0 + 31_000, T0)).toBe(true);
  });

  it('取不到 URL(空串)也算漂移 —— 宁可跳回,不可静默收零', () => {
    expect(shouldReturnToNotifications('', T0)).toBe(true);
  });

  /** 反向注入:守卫恒 false(从不跳回)时,漂移用例必须变红 */
  it('反向注入:从不跳回时,漂移样本会暴露差异', () => {
    const broken = (): boolean => false;
    expect(shouldReturnToNotifications('https://x.com/home', T0))
      .not.toBe(broken());
  });
});
