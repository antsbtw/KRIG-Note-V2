/**
 * `web.harvest` —— ⭐⭐ **「把这一页采下来」** 这一件事的编排
 *
 * ── 用户 2026-10-03 ──
 * 「应该是反过来,**我自己选定一个页面,点击开始采集,就采集**,
 * 　采集完毕后再验证采集的内容才对。」
 *
 * ⚠️ 此前面板上有**五个**要人点的动作(goto / 开始收 / 重载 / 滚动 / 停止),
 * 而且**顺序错了就采不到** —— 那是把编排推给了人。
 *
 * ── ⚠️ 为什么是新一层,不塞进现有的两层 ──
 *
 * 用户 2026-10-02 定过:「**控制是控制,采集是采集**」。
 * · `page`(控制)  只管页面怎么动,不知道有人在收
 * · `acquire`(采集)只管收到什么,不碰页面
 * ⭐ 「先重载再滚、每轮展开、滚完再停」是**两者的协调**,
 *   塞进任何一边都会把那条分界线弄糊 —— 所以它自己一层。
 *
 * ⚠️ 本层**零 Electron、零站点知识**:
 * 它不知道什么是 X、什么是「折叠」,全靠 `HarvestDeps` 注入。
 */

import type { PageId } from '../page/types';
import type { AcquiredItem } from '../acquire/types';

/** 一次采集的**意图** —— ⭐ 上层只说这些 */
export type HarvestPlan = {
  /**
   * ⭐⭐ **采够几页就停** —— 用户 2026-10-03:「每次采集 10 页。」
   *
   * ⚠️ 「页」**不等于**「滚动轮次」:
   * 滚一轮未必触发新请求(X 要滚到接近底部才发下一批),
   * 也可能一轮出好几页。所以按**页**停才是人要的那个数。
   *
   * ⭐ 怎么算一页:命中 `pageUrlIncludes` 的响应各算一页。
   * ⚠️ 判据由**业务**给(底座不知道什么是「一页」)。
   */
  readonly wantPages?: number;
  /** ⭐ 什么样的响应算「一页」—— 业务知识,底座不猜 */
  readonly pageUrlIncludes?: readonly string[];
  /**
   * 滚动轮次**上限** —— ⚠️ 这是**安全网不是目标**
   * (`feedback-pdca-close-the-loop`:轮数当目标填 30 实采 250、
   *  填 600 有 43% 空转)。采够页数会提前停。
   */
  readonly maxRounds?: number;
  /**
   * ⭐ 每轮滚完要跑的脚本 id —— 业务自己的事(X 用它点开「Show more」)。
   * ⚠️ 只收**预注册的 id**,收不了脚本文本
   * (`project-x-inject-template-escape` 换来的那道闸)。
   */
  readonly afterRoundScriptId?: string;
  /** ⭐ 滚不动时换位置的脚本 —— 见 `ScrollOptions.onStuck` */
  readonly onStuckScriptId?: string;
  /**
   * ⚠️ 不要的 URL 子串 —— **业务给**,底座一条都不内置。
   * (本仓栽过:`s-cdn.anthropic.com/images/` 硬编码进了底层)
   */
  readonly noisyUrlSubstrings?: readonly string[];
  /** 最长跑多久 —— 安全网 */
  readonly maxMs?: number;
  /**
   * ⭐⭐ **先去这一页再采** —— 语义页名 + 参数(2026-10-03 加)。
   *
   * ⚠️ 不给就是「采当前页」(原有行为,一个字没变)。
   *
   * ── 为什么放在底座而不是面板 ──
   * 用户 2026-10-03:「我自己选定一个页面,**点击开始采集,就采集**。」
   * 面板里写「先 goto 再 harvest」等于**把编排又推回给人**;
   * 守卫「输出栏只有一个发起动作」就是钉这件事的 —— 我加按钮时
   * 第一版正是在 onClick 里串了 goto,被它逮住。
   *
   * ⭐ 放这里还顺带解一个竞态:导航**必须在装腿之后**,
   * 否则新页首屏那批请求在腿装好之前就发完了(与 reload 同一个道理)。
   * ⚠️ 只收**语义页名**不收 URL —— 那道闸(业务页表翻译)不能绕。
   */
  readonly gotoPage?: { readonly name: string; readonly params?: Record<string, string> };
};

/** 采完之后的全部事实 —— ⭐ 一次说清,不用人再去别处拼 */
export type HarvestReport = {
  readonly ok: boolean;
  readonly problems: readonly string[];
  /** 采到的响应(合并去重) */
  readonly items: readonly AcquiredItem[];
  /** ⭐ 其中算「一页」的有几条 —— 与 `wantPages` 对照 */
  readonly pages: number;
  /** ⭐ 每轮脚本的产出(如展开后的全文)—— 底座原样转,不解释 */
  readonly afterRound: readonly unknown[];
  // ── 过程事实:没有它们,「只采到 N 条」无从判断 ──
  readonly rounds: number;
  readonly scrolledPx: number;
  readonly reachedBottom: boolean;
  readonly stopReason: string;
  readonly elapsedMs: number;
  readonly legs: {
    readonly cdp: number; readonly hook: number; readonly both: number;
    readonly hookInjected: boolean; readonly cdpAttached: boolean;
  };
  /**
   * ⭐ 收尾前等 CDP 在途取回落地:等了多久、等完还剩几条(>0 = 等满上限还没到,如实说)。
   * 没走到收尾(比如导航失败)时没有这一项。
   */
  readonly cdpSettle?: { readonly waitedMs: number; readonly leftInFlight: number };
  /**
   * ⭐ 诊断(2026-10-16):这一跑里浏览器**实际发出**的接口请求(方法 路径 状态 → 次数)。
   * 与 items(收到的)对照:浏览器发了 30 次、我们只收到 2 次 = 漏采在采集层,不是站点没给。
   */
  readonly apiSeen?: Readonly<Record<string, number>>;
  /**
   * ⭐⭐ 对账(2026-10-16,用户:「配方搜索,然后把所有的推文采集下来,这是基本函数/功能,必须保证的哦。」)
   * seen = 浏览器收到的**目标数据**(命中 pageUrlIncludes、状态 200)次数;captured = 我们采到的页数。
   * seen > captured → 漏采在采集层,problems 里有一条,ok 为 false。没有计数器 / 没给判据 → 不报。
   */
  readonly completeness?: { readonly seen: number; readonly captured: number };
  /** ⭐ 诊断:收尾时两条腿池子里原始各几条(合并去重前)*/
  readonly rawHeld?: { readonly cdp: number; readonly hook: number };
};

/** 本层依赖的最小操作集 —— ⭐ 由 wiring 注入,本层零 Electron */
export interface HarvestDeps {
  // ── 采集侧 ──
  startAcquire(pageId: PageId, noisy?: readonly string[]): Promise<{
    ok: boolean; cdpAttached: boolean; hookInstalled: boolean;
  }>;
  /**
   * ⭐ **中途查看**已收到什么 —— ⚠️ 纯读,不停止。
   * 「采够页数就停」靠它:每轮问一次够了没。
   */
  peekAcquire(pageId: PageId): readonly AcquiredItem[];
  /**
   * ⭐⭐ CDP 还有几条 body 在取回途中 —— 收尾前等它归零(2026-10-16,种子没头的根因:两条腿赛跑)。
   */
  cdpInFlight(pageId: PageId): number;
  /** ⭐ 诊断:浏览器至今发出的接口请求计数(可选;没有就不报)—— 与「收到的」对照找漏采 */
  apiSeen?(pageId: PageId): Readonly<Record<string, number>>;
  /** ⭐ 诊断:两条腿池子里**原始**各有几条(合并去重之前)—— 与合并后的条数对照,看是不是去重吞了 */
  rawHeld?(pageId: PageId): { readonly cdp: number; readonly hook: number };
  finishAcquire(pageId: PageId, startedAt?: number): {
    ok: boolean; problems: readonly string[]; items: readonly AcquiredItem[];
    elapsedMs: number;
    legs: {
      cdp: number; hook: number; both: number;
      hookInjected: boolean; cdpAttached: boolean;
    };
  };
  // ── 控制侧 ──
  /** 重载当前页 —— ⭐ 解「装腿晚于首次请求」的竞态 */
  reload(pageId: PageId): void;
  /**
   * ⭐ 导航到**语义页** —— ⚠️ 与 `reload` 占同一个位置(装腿之后)。
   * 回 `false` 表示没去成,编排据此决定还要不要往下跑。
   */
  goto(pageId: PageId, name: string, params?: Record<string, string>): Promise<boolean>;
  /** 滚到底或到轮次上限;每轮滚完调 `afterRound` */
  scroll(pageId: PageId, opts: {
    maxRounds?: number;
    afterRound?: (round: number) => Promise<void> | void;
    shouldStop?: () => boolean;
    /** ⭐ 滚不动时换位置 —— 回 true 表示换过了,再给一轮 */
    onStuck?: (stuck: number) => Promise<boolean> | boolean;
  }): Promise<{
    rounds: number; scrolledPx: number; reachedBottom: boolean; stopReason: string;
  }>;
  /** 跑一个预注册脚本,返回它的产出 */
  runScript(pageId: PageId, scriptId: string): Promise<unknown>;
  wait(ms: number): Promise<void>;
  now(): number;
}
