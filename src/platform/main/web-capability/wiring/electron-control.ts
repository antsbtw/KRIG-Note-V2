/**
 * `ready` / `scrollUntil` 的 Electron 接线 —— 唯一执行滚动脚本的地方
 *
 * ⭐ 能力层(`page/control.ts`)是纯逻辑:它只知道「有个能求值脚本的宿主」。
 * 真正的 `executeJavaScript` 收口在这里,于是「往页面里注入了什么」
 * **有且只有一个地方**可查、可守。
 *
 * ⚠️ **本步不接任何消费者** —— 这个类建好但没人 new 它,
 * app 行为与开工前完全一致(`09-history.md` §1.1「只加不改」)。
 *
 * ── 与那 7 个 X 滚动模块的关系 ──
 * 滚动逻辑现在散在 harvester / scan / notifications / article-replies /
 * capture-monitor / author-timeline-spike / payload-inspector 七处。
 * 本步**一个都没碰** —— 迁移是步 6 之后的事(§1.2:迁移=换调用方,不是搬代码)。
 */

import type { WebContents } from 'electron';
import type { PageId } from '../page/types';
import type { ControlHost } from '../page/control';

/** 由接线层提供:pageId → 真实 webContents。拿不到返回 null,**不抛** */
export type WebContentsLookup = (pageId: PageId) => WebContents | null;

export class ElectronControlHost implements ControlHost {
  constructor(private readonly lookup: WebContentsLookup) {}

  /**
   * 导航 —— **唯一** `loadURL` 的地方(与 evaluate 同款收口)。
   *
   * ⚠️ `loadURL` 常常**不 resolve**:站点自行接管导航时会 reject
   * (X 的 ERR_ABORTED 是常态,不是故障)。所以这里**捕获 reject 但不当失败**,
   * 把原因如实回给引擎 —— 由引擎用「等到位」判定真假。
   * 在这里吞掉原因,`goto` 就分不出「站点接管了」与「真没导航成」。
   */
  async navigate(pageId: PageId, url: string): Promise<{ landedUrl: string; rejected?: string }> {
    const wc = this.lookup(pageId);
    if (!wc) {
      // fail loud —— 与 evaluate 同款:找不到页面就抛
      throw new Error(`[web.page] 页面 ${pageId} 没有对应的渲染目标(已关闭?)`);
    }
    let rejected: string | undefined;
    await wc.loadURL(url).catch((err: unknown) => {
      rejected = err instanceof Error ? err.message : String(err);
    });
    return { landedUrl: wc.getURL(), rejected };
  }

  async evaluate(pageId: PageId, script: string): Promise<unknown> {
    const wc = this.lookup(pageId);
    if (!wc) {
      // fail loud:找不到页面就抛,由引擎翻成三态 Failed。
      // 返回 undefined 会让「页面早关了」表现为「滚了但没动」——
      // 于是 A 层自校验报「滚动没生效」,把人指向完全错误的方向
      throw new Error(`[web.page] 页面 ${pageId} 没有对应的渲染目标(已关闭?)`);
    }
    // ⚠️ 不 catch —— 注入异常必须抛给引擎:
    // `ready` 靠它决定「继续等」,`scrollUntil` 靠它区分「滚不动」与「做不了」。
    // 在这里吞掉,两者都会退化成静默失聪。
    return wc.executeJavaScript(script);
  }
}
