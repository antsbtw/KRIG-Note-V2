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
import { X_ANCHORS } from './x-pages';

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
};

/** ⭐ 本模块的锚点表 —— 启动时 **push** 给底座 */
export const xAnchorResolver: AnchorResolver & { names(): string[] } = {
  resolve: (anchor) => SELECTORS[anchor] ?? null,
  names: () => Object.keys(SELECTORS),
};
