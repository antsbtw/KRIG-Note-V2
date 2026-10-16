/**
 * ⭐⭐ 人卡「采他的帖子 / 回复 / 转发」的主进程侧 —— 一次采一个标签页(2026-10-13,3a)
 *
 * 采集编排原来跑在 renderer;现在调主进程的 `collectOnWebview`(与后台 runner 共用)。
 * renderer 保留:三个标签页的外层循环、「第一轮 403 重载再试」、存库、采集记录、界面状态。
 *
 * ── 进度与停止怎么跨进程 ──
 * X 只有一条 invoke 通道,没有「主进程推给 renderer」的通道;加推送要动共用的 preload 与
 * channel-names(X 可装卸守卫不鼓励 X 往共用层塞东西)。所以:
 *   · 进度:这里记下最新一句,renderer **每秒问一次**(`personCollectProgress`)
 *   · 停止:renderer 发 `cancelPersonCollect`,这里立标记;翻页每轮开头、歇着时每秒都看一眼
 * ⭐ 每句进度**当场写留痕**(`x-person-progress`,字段与 renderer 旧版一致)——
 *   不依赖 renderer 问没问到,关掉面板也查得到。
 */

import { traceRecorder } from '@platform/main/web-capability/wiring/runtime';
import { collectOnWebview, type CollectOnWebviewResult } from './x-collect-on-webview';
import { webviewPorts } from './x-collect-ports';

/** 一个 webview 上正在跑的那次采集 */
type Live = { cancelled: boolean; msg?: string; seq: number };

/**
 * ⚠️ 按 **wcId** 分:一个 X 网页同一时刻只跑一次(人卡那边还有 getXHostBusy 挡着);
 * 分开记,A 窗口点停不会停掉 B 窗口(`project-host-broadcast-multi-ws-fanout` 同族)。
 */
const live = new Map<number, Live>();

/** 进度留痕 —— ⭐ 与 `logPersonProgress` op 写的是同一个事件、同一组字段 */
export function tracePersonProgress(entry: {
  readonly handle: string; readonly tab: string; readonly attempt: number; readonly msg: string;
}): void {
  traceRecorder.lifecycle({ layer: 'web.net', event: 'x-person-progress', pageId: 'x-data', detail: { ...entry } });
}

export async function collectPersonTab(input: {
  readonly wcId: number;
  readonly page: string;
  readonly handle: string;
  readonly restId: string;
  /** 范围起点(ISO);不给 = 全部 */
  readonly start?: string;
  readonly pageCap: number;
  /** 第几次尝试(只用于留痕,与 renderer 旧版一致) */
  readonly attempt: number;
  /**
   * ⭐⭐ 后台断点:第一次翻页从这里续(不给 = 从首页游标翻)。
   * ⚠️ 2026-10-14 真机:这里原来不收也不转 → 后台每段都从第一页重翻 10 页,
   * 30 页后游标还停在原地(10-10),3b 只在 collectOnWebview 一层测了续采,中间这两跳丢了它。
   */
  readonly resumeCursor?: string;
}): Promise<CollectOnWebviewResult> {
  if (live.has(input.wcId)) {
    throw new Error('这个 X 网页上已经有一次采集在跑 —— 先等它结束');
  }
  const ctl: Live = { cancelled: false, seq: 0 };
  live.set(input.wcId, ctl);
  try {
    return await collectOnWebview(webviewPorts(input.wcId), {
      page: input.page,
      handle: input.handle,
      restId: input.restId,
      start: input.start ? new Date(input.start) : undefined,
      pageCap: input.pageCap,
      resumeCursor: input.resumeCursor,
    }, {
      cancelled: () => ctl.cancelled,
      onProgress: (m) => {
        ctl.msg = m;
        ctl.seq += 1;
        tracePersonProgress({ handle: input.handle, tab: input.page, attempt: input.attempt, msg: m });
      },
      /** ⭐ 歇着时也每秒看一眼停止标记 —— 限流退避可能一等 15 分钟(与 renderer 旧版同) */
      wait: async (ms) => {
        const until = Date.now() + ms;
        while (Date.now() < until) {
          if (ctl.cancelled) return;
          await new Promise((r) => { setTimeout(r, 1000); });
        }
      },
    });
  } finally {
    live.delete(input.wcId);
  }
}

/** 最新一句进度(seq 每来一句加一,renderer 据此判「有没有新的」);没在跑回 null */
export function personCollectProgress(wcId: number): { readonly seq: number; readonly msg?: string } | null {
  const l = live.get(wcId);
  return l ? { seq: l.seq, msg: l.msg } : null;
}

/** 立停止标记。没在跑回 false(renderer 的外层循环自己也会停) */
export function cancelPersonCollect(wcId: number): boolean {
  const l = live.get(wcId);
  if (!l) return false;
  l.cancelled = true;
  return true;
}
