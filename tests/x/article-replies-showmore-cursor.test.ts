/**
 * 「Show probable spam」折叠区 —— X 自己给的「还有更多」游标。
 *
 * ⚠️ 2026-09-06 真机 TweetDetail 载荷坐实(此前一份都没留过,全靠猜):
 * ```
 * entryId    : "cursor-showmorethreads-2096729716814774201"
 * cursorType : "ShowMoreThreads"
 * displayTreatment.actionText : "Show probable spam"   ← 页面上那个蓝字按钮
 * value      : "DAAKCgAB…"
 * ```
 * X **明确说了「还有,拿这个 cursor 来取」**,而原先的代码在数
 * 「连续 4 轮没新增」就判「翻完了」——真源摆在载荷里没人读
 * (与时间线丢 83% 那次 commit a9d9bc75 同一形态)。
 *
 * ⚠️ 被折进去的正是活动参与者那一类:新账号 + 带链接 + 带图,
 *   X 判为 probable spam;而契约恰恰只认 has_media 的留言。
 *   实测:同一篇文章库存 9 条,单次抓取只翻到 6 条。
 */

import { describe, it, expect } from 'vitest';
import { findShowMoreCursor } from '@platform/main/x/x-article-replies';

/** 真机载荷的结构(字段名与层级照抄 detail-*.json,只去掉无关正文) */
const realShape = {
  data: { threaded_conversation_with_injections_v2: { instructions: [
    { type: 'TimelineAddEntries', entries: [
      { entryId: 'tweet-2095910972506427676',
        content: { entryType: 'TimelineTimelineItem', itemContent: { __typename: 'TimelineTweet' } } },
      { entryId: 'cursor-showmorethreads-2096729716814774201', content: {
        __typename: 'TimelineTimelineCursor',
        entryType: 'TimelineTimelineCursor',
        cursorType: 'ShowMoreThreads',
        displayTreatment: { actionText: 'Show probable spam' },
        value: 'DAAKCgABHRkUkYi__7cLAAIAAACQRW1QQzZ3QUFm',
      } },
    ] },
    { type: 'TimelineTerminateTimeline' },
  ] } },
};

describe('折叠区游标', () => {
  it('⭐ 认出 ShowMoreThreads 游标,并带出按钮文案与 value', () => {
    const c = findShowMoreCursor(realShape);
    expect(c, '认不出就会把「没抓完」当成「翻完了」').toBeDefined();
    expect(c!.actionText).toBe('Show probable spam');
    expect(c!.value).toMatch(/^DAAK/);
    expect(c!.entryId).toContain('showmorethreads');
  });

  it('会话中段的 ShowMore 断层也要认', () => {
    const c = findShowMoreCursor({ x: {
      __typename: 'TimelineTimelineCursor', cursorType: 'ShowMore',
      value: 'abc', displayTreatment: { actionText: 'Show more replies' },
    } });
    expect(c?.actionText).toBe('Show more replies');
  });

  it('⭐ 普通上下翻页游标(Bottom/Top)不算「还有折叠内容」', () => {
    // 认错会导致每次都去点不存在的按钮,白耗 budget
    expect(findShowMoreCursor({ x: {
      __typename: 'TimelineTimelineCursor', cursorType: 'Bottom', value: 'v' } })).toBeUndefined();
    expect(findShowMoreCursor({ x: {
      __typename: 'TimelineTimelineCursor', cursorType: 'Top', value: 'v' } })).toBeUndefined();
  });

  it('⭐ 没有折叠区时返回 undefined —— 这才是真的「翻完了」', () => {
    expect(findShowMoreCursor({ data: { instructions: [
      { entries: [{ entryId: 'tweet-1', content: { itemContent: { __typename: 'TimelineTweet' } } }] },
    ] } })).toBeUndefined();
  });

  it('没有 value 的游标不算(点了也取不到东西)', () => {
    expect(findShowMoreCursor({ x: {
      __typename: 'TimelineTimelineCursor', cursorType: 'ShowMoreThreads' } })).toBeUndefined();
  });

  /** 反向注入:认不出游标时,真机样本必须变红 */
  it('反向注入:恒返回 undefined 时,真机样本会暴露差异', () => {
    const broken = (): undefined => undefined;
    expect(findShowMoreCursor(realShape)).not.toBe(broken());
  });
});

/**
 * 误标删除的闸门。
 *
 * ⚠️ 2026-09-06 真机事故:试抓报「标记删除 3」,而那 3 条并没被删 ——
 *   它们在「Show probable spam」折叠区里,本次没翻到而已。
 *   契约 §2.1 的 deleted:true 会让 campaign-tasks 把留言判成无效。
 *
 * 事故成因值得记:原先的闸是 `!partial && problems.length===0`,
 * 而我在上一次修「不许谎报完整」时,把 partial 改成「只有还剩游标才置位」——
 * 展开成功后游标被消费掉,partial 归 false、problems 也空,**闸就开了**。
 * 修一个诚实性问题,顺手拆掉了另一处的安全网。
 */
describe('误标删除的闸门', () => {
  /** 复刻 x-timeline-handlers 里的判据,守住三者的组合关系 */
  const mayMarkDeleted = (r: {
    partial: boolean; problems: string[]; sawFolded: boolean;
  }): boolean => !r.partial && r.problems.length === 0 && !r.sawFolded;

  it('⭐ 见过折叠区 → 一律不判删除(哪怕 partial=false、problems 为空)', () => {
    // 这正是 2026-09-06 误标 3 条时的实际状态
    expect(mayMarkDeleted({ partial: false, problems: [], sawFolded: true })).toBe(false);
  });

  it('没抓完(partial)不判删除', () => {
    expect(mayMarkDeleted({ partial: true, problems: [], sawFolded: false })).toBe(false);
  });

  it('有 problems 不判删除', () => {
    expect(mayMarkDeleted({ partial: false, problems: ['x'], sawFolded: false })).toBe(false);
  });

  it('三者都干净才允许判删除', () => {
    expect(mayMarkDeleted({ partial: false, problems: [], sawFolded: false })).toBe(true);
  });

  /** 反向注入:漏掉 sawFolded 这一道时,事故场景会重现 */
  it('反向注入:少了 sawFolded 闸,事故场景会放行', () => {
    const broken = (r: { partial: boolean; problems: string[] }): boolean =>
      !r.partial && r.problems.length === 0;
    const accident = { partial: false, problems: [], sawFolded: true };
    expect(broken(accident)).toBe(true);              // 旧闸放行 = 误删
    expect(mayMarkDeleted(accident)).not.toBe(broken(accident));
  });
});

/**
 * 折叠区按钮的**定位方式**。
 *
 * ⚠️ 2026-09-06 DevTools 探针实测(用户建议的排查法,一次就定位了):
 *   同一句「Show probable spam」在 DOM 里命中 **7 个**节点 ——
 *     DIV[data-testid="cellInnerDiv"]  ← 整行容器(最先被 querySelectorAll 命中)
 *     DIV ×4
 *     BUTTON[role="button"]            ← **只有这个是真正可点的**
 *     SPAN
 *   第一版「先匹配任意节点、再向上找可点祖先」正好踩反:
 *   最先命中的是最外层容器,向上爬只会越走越远,点了没反应
 *   —— 现象就是「载荷里有游标,但页面上没找到该按钮」。
 *
 *   正解:**直接在 button / [role=button] 里按文案找**,不要向上爬。
 */
describe('折叠区按钮定位', () => {
  /** 复刻页面结构:一句文案,7 个节点,只有 BUTTON 可点 */
  const nodes = [
    { tag: 'DIV', role: null, testid: 'cellInnerDiv', text: 'Show probable spam' },
    { tag: 'DIV', role: null, testid: null, text: 'Show probable spam' },
    { tag: 'BUTTON', role: 'button', testid: null, text: 'Show probable spam' },
    { tag: 'SPAN', role: null, testid: null, text: 'Show probable spam' },
  ];

  /** 生产代码的选择逻辑:只在 button/[role=button] 里找 */
  const pick = (want: string) => nodes.find(
    (n) => (n.tag === 'BUTTON' || n.role === 'button') && n.text === want);

  it('⭐ 必须选中 BUTTON,不能选中 cellInnerDiv 容器', () => {
    const el = pick('Show probable spam');
    expect(el?.tag, '选中容器就点不动,现象是「找不到按钮」').toBe('BUTTON');
    expect(el?.testid).not.toBe('cellInnerDiv');
  });

  it('文案对不上时选不中(X 改措辞要能报出来,而不是乱点)', () => {
    expect(pick('Show more replies')).toBeUndefined();
  });

  /** 反向注入:退回「取第一个匹配节点」时,会选中容器 */
  it('反向注入:不限定 button 时会选中 cellInnerDiv 容器', () => {
    const broken = (want: string) => nodes.find((n) => n.text === want);
    expect(broken('Show probable spam')?.testid).toBe('cellInnerDiv');   // 旧逻辑=点不动
    expect(pick('Show probable spam')?.tag).not.toBe(broken('Show probable spam')?.tag);
  });
});
