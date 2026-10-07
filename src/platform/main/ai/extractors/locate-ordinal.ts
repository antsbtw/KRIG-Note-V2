/**
 * 「点了第几条回复」—— 三家 AI 提取器共用的定位(L2 收口第 2 批)
 *
 * ── 收口前的样子 ──
 *
 * `chatgpt-extract-turn` / `claude-extract-turn` 各有一份**逐字节相同**的实现
 * (只差 selector 常量),`gemini-extract-turn` 是同一件事的简化版。
 * 三份都把坐标 `${x}` / `${y}` **直接插进脚本文本**。
 *
 * ⚠️ 那正是 `project-x-inject-template-escape` 那一类:
 * 求值后的样子与源码所见不同,而 **tsc 与单测都发现不了**。
 *
 * ── 收口后 ──
 *
 * 脚本本体收进 `web.dom` 的预注册表(`dom/locate-scripts.ts`),
 * 参数走 `JSON.stringify` **绑定值**;本文件只负责
 * 「把 wc 变成底座认识的 pageId」+「把返回值翻成业务类型」。
 */

import type { WebContents } from 'electron';
import { domRunner, pageRegistry } from '../../web-capability/wiring/runtime';
import { bindPageHost } from '../../web-capability/wiring/page-hosts';
import { LOCATE_SCRIPTS } from '../../web-capability/dom';
import type { PageId } from '../../web-capability/page/types';

/** 定位结果:ordinal=-1 表示没点在任何目标容器内(或附近) */
export type LocatedOrdinal = { ordinal: number; preview: string };

/**
 * 读 partition —— 与 `ai/interceptor.ts:350` 同款。
 *
 * ⚠️ `PageFacts.partition` **必填且底座不猜**:`prepare` 要挂 webRequest 得知道
 * 页面在哪个 partition。这里如实照抄现有实现,不自创第二套推法。
 */
function readPartition(wc: WebContents): string {
  try {
    const p = wc.session.storagePath;
    return p ? `persist:${p.split('/').pop()}` : 'persist:webview';
  } catch {
    return 'persist:webview';
  }
}

/** wc.id → pageId。⚠️ 同一个 wc 只登记一次,否则每次调用都新增一条页面记录 */
const pageIdByWcId = new Map<number, PageId>();

/**
 * 把一个 guest `WebContents` 登记成底座认识的页面。
 *
 * ⚠️ `register` 与 `bindPageHost` **必须成对** —— 只登记不绑定的话,
 * 引擎拿不到 wc,会回一个诚实但误导的 Failed「没有对应的渲染目标(已关闭?)」,
 * 看起来像页面关了,实际是没接线(见 `wiring/page-hosts.ts` 的告诫)。
 */
function pageIdFor(wc: WebContents): PageId {
  const cached = pageIdByWcId.get(wc.id);
  if (cached) return cached;
  const facts = pageRegistry.register({
    window: 'main',
    ws: 'ai-extract',
    slot: 'left',
    partition: readPartition(wc),
    owner: 'ai-extract',
    service: 'ai',
    url: wc.getURL(),
    state: 'complete',
  });
  bindPageHost(facts.pageId, wc);
  pageIdByWcId.set(wc.id, facts.pageId);
  wc.once('destroyed', () => pageIdByWcId.delete(wc.id));
  return facts.pageId;
}

/**
 * 在 guest 页用 (x,y) 定位被右键的回复块,返回它在同类节点中的序号与文字预览。
 *
 * ⚠️ **失败如实返回 `ordinal:-1` 并在控制台留痕** —— 三家原实现都是
 * `catch { return -1 }` 静默吞掉,于是「脚本坏了」与「没点在回复上」
 * 表现完全一样,而两者排查方向相反。
 */
export async function locateOrdinalByPoint(
  wc: WebContents,
  x: number,
  y: number,
  selector: string,
): Promise<LocatedOrdinal> {
  const res = await domRunner.run(wc, pageIdFor(wc), LOCATE_SCRIPTS.ordinalByPoint, {
    x,
    y,
    selector,
  });
  if (res.status === 'failed') {
    // 不静默:这句话是「脚本/注入出问题」与「没点在回复上」的唯一区分点
    console.warn(`[ai-extract] 坐标定位失败(不是"没点中"):${res.reason}`);
    return { ordinal: -1, preview: '' };
  }
  const v = res.value as Partial<LocatedOrdinal> | null;
  if (!v || typeof v.ordinal !== 'number') {
    console.warn('[ai-extract] 坐标定位返回了预期外的形状', v);
    return { ordinal: -1, preview: '' };
  }
  return { ordinal: v.ordinal, preview: typeof v.preview === 'string' ? v.preview : '' };
}
