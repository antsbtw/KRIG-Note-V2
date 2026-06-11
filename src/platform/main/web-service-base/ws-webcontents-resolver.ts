/**
 * ws-webcontents-resolver —— main 侧「按 renderer 传来的 guest wcId 精确定位 webContents」
 *
 * 收口 ①(2026-06-11,总指挥裁定决策 2):把 AI 的 `resolveAIWebContents` 泛化成服务无关
 * 公共原语,AI / X 发推回复 / X extract 都改用它,**统一 fail loud**(未命中明确报错,
 * 绝不静默回退全局 `getActive` —— 回退正是多 ws 串扰 bug 根源)。
 *
 * 治多实例串扰 bug:renderer 侧 ws-host-registry 按活跃 ws 查出本 ws 的 Host guest wcId,
 * 经 IPC 透传到这里 `webContents.fromId` 精确取 —— 不再用全局「最后 navigate」猜。
 *
 * fail loud 三种未命中(§3.2 + 裁定决策 2,与原 X「回退全局 + warn」不同):
 * - targetWcId 缺失(本 ws 未登记 / Host 未 dom-ready)
 * - 对应 wc 不存在 / 已销毁
 * - 当前 URL 不属期望服务(validateUrl 返 false)
 * → 一律返 `{ error }`,调用方据此 fail loud(broadcast / 返回失败 / toast)。
 */

import { webContents, type WebContents } from 'electron';

/** 定位结果:成功带 wc,失败带明确 error(fail loud)*/
export type WsResolveResult = { wc: WebContents } | { error: string };

/**
 * 按 renderer 指定的 guest wcId 精确定位 webContents(按活跃 ws 定向)。
 *
 * @param targetWcId  renderer 按活跃 ws 查出的 Host guest wcId(undefined/null = 未登记)
 * @param validateUrl 校验目标 wc 当前 URL 是否属期望服务;返 false → fail loud
 * @param labels      错误文案用的服务标签(如 'claude' / 'x'),拼进 fail loud 提示
 */
export function resolveWsWebContents(
  targetWcId: number | null | undefined,
  validateUrl: (url: string) => boolean,
  labels: { service: string; pageName: string },
): WsResolveResult {
  if (typeof targetWcId !== 'number') {
    return {
      error: `当前 workspace 的 ${labels.service} 实例未就绪(未登记 wc id)— 请确保 ${labels.pageName} 已加载`,
    };
  }
  const wc = webContents.fromId(targetWcId);
  if (!wc || wc.isDestroyed()) {
    return {
      error: `指定的 ${labels.service} 实例(wc#${targetWcId})不存在或已销毁 — 请重新打开 ${labels.pageName}`,
    };
  }
  if (!validateUrl(wc.getURL())) {
    return {
      error: `指定的 ${labels.service} 实例(wc#${targetWcId})当前不是 ${labels.pageName},无法操作`,
    };
  }
  return { wc };
}

/**
 * 同 {@link resolveWsWebContents} 但带 poll —— 给「问 AI / paste+send / 发推」用:
 * renderer 点操作后 view mount → webview navigate → dom-ready 才登记 wcId,这条链路 1-3s;
 * poll 等本 ws 的 wc 就绪(仍 fail loud,只是给足等待窗口,覆盖切到该服务的 1-3s 窗口)。
 */
export async function resolveWsWebContentsWithWait(
  targetWcId: number | null | undefined,
  validateUrl: (url: string) => boolean,
  labels: { service: string; pageName: string },
  timeoutMs = 10_000,
): Promise<WsResolveResult> {
  const start = Date.now();
  let last = resolveWsWebContents(targetWcId, validateUrl, labels);
  while ('error' in last && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    last = resolveWsWebContents(targetWcId, validateUrl, labels);
  }
  return last;
}
