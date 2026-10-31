/**
 * X 的锚点表 —— **adapter 的活**:语义名 → selector
 *
 * ⭐ 底座只认**语义名**,不认 selector。站点改版时改这一张表,
 * 调用方(和它们的判据)一个字不动。
 *
 * ⚠️ 解释不出来返回 **null,绝不返回空串**:
 * 空 selector 会让「锚点名打错了」表现成「查了个空、什么也没找到」——
 * 两者排查方向完全相反(底座 `AnchorResolver` 的注释专门写了这条)。
 */

import type { AnchorResolver } from '@platform/main/web-capability/page/control';
import { X_ANCHORS, composeBoxAnchor } from './x-pages';
import { X_THREAD_MAX } from './x-post-compose';

/**
 * ⚠️⚠️ **这张表当前是坏的,而且我知道它坏** ——
 *
 * X 于 2026-09 前后把**未登录页面的 `data-testid` 全部去掉了**
 * (真机探针实测:整页 `[data-testid]` 元素数 = **0**,不是登录墙,
 *  `<article>` 里有完整推文但只剩 class 属性)。
 * 详见 `docs/handoff/x-testid-removed-tweet-fetcher-broken.md`。
 *
 * ⭐ 仍然先按旧 selector 登记,理由:
 * ① 本步是**接线**(证明注册表模式走得通),不是修站点适配
 * ② 登录态下 `data-testid` 很可能还在 —— 而 X 模块本来就要在登录态下跑,
 *    **这一点只有真机能验**,不该靠推断先改掉
 * ③ 真要改,判据是「换成结构选择器后,登录态与未登录都能命中」——
 *    那是独立一刀,混进接线会让「接线通没通」说不清
 */
const SELECTORS: Readonly<Record<string, string>> = {
  [X_ANCHORS.tweetArticle]: 'article[data-testid="tweet"]',
  /** ⚠️ 登录态才有 testid(求关只在登录态跑);单篇页只有一个回复框,命中多个 = 页面不是预期的样子,由调用方先查 */
  [X_ANCHORS.replyBox]: '[data-testid="tweetTextarea_0"]',
  /**
   * ⚠️ /compose/post 是盖在首页上的弹窗,首页时间线顶上还有一个同样 testid 的内嵌框 —— 只认 role=dialog 里的。
   * 待真机:弹窗是不是 role="dialog"(发推第②期 10-27 按 X 现行结构写的,没在真机上量过)。
   */
  [X_ANCHORS.composeBox]: '[role="dialog"] [data-testid="tweetTextarea_0"]',
  /**
   * ⭐ fileInput 这个 testid 2026-06 真机量过(X 文章编辑器里有,阶段 2.5-b 发图也用过)。
   * ⚠️ 首页内嵌框也有一个 —— 只认弹窗里的;弹窗里有没有,第④期真机第一次跑时确认。
   */
  [X_ANCHORS.composeFileInput]: '[role="dialog"] input[data-testid="fileInput"]',
  /** 推串的「+」—— 2026-10-28 真机:testid addButton,只在当前这条有字 / 有图时出现;⚠️ 只认真点击 */
  [X_ANCHORS.composeAddButton]: '[role="dialog"] [data-testid="addButton"]',
  /** X 文章(10-30 真机量过):正文 composer 里的块;新文章只有一块(空的)*/
  [X_ANCHORS.articleFirstLine]: '[data-testid="composer"] [data-block="true"]',
  [X_ANCHORS.articleMediaInput]: '[role="dialog"] input[data-testid="fileInput"]',
  /** 封面那个不收多张(Media 弹窗里那个 multiple)*/
  [X_ANCHORS.articleCoverInput]: 'input[data-testid="fileInput"]:not([multiple])',
  /** 推串第 2…25 条的正文框(X 按 tweetTextarea_1、_2… 编号;2026-10-28 按 X 现行结构写,待真机) */
  ...Object.fromEntries(Array.from({ length: X_THREAD_MAX - 1 }, (_, i) =>
    [composeBoxAnchor(i + 1), `[role="dialog"] [data-testid="tweetTextarea_${i + 1}"]`])),
};

/** ⭐ 本模块的锚点表 —— 启动时 **push** 给底座 */
export const xAnchorResolver: AnchorResolver & { names(): string[] } = {
  resolve: (anchor) => SELECTORS[anchor] ?? null,
  names: () => Object.keys(SELECTORS),
};
