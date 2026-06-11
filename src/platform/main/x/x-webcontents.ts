/**
 * X 注入 / 提取目标 webContents 定位 —— 按活跃 ws 定向,fail loud(收口 ②③ + 决策 2)
 *
 * 治多实例串扰 bug:renderer x-host-registry 按活跃 ws 查出本 ws 的 X Host guest wcId,
 * IPC 透传到这里,经 web-service-base 公共 resolveWsWebContents 精确定位。
 *
 * 总指挥裁定决策 2:**删掉旧的「回退全局 getActiveXWebContents」**,与 AI 统一为 fail loud
 * —— 回退全局正是 bug 根源。但 **poll 等待逻辑保留**(覆盖「切到 X 的 1-3s 窗口」:renderer
 * 切 X 入口让 XHost 显示 + navigate,X webview did-navigate / dom-ready 后才登记 wcId)。
 *
 * 发推 / 回复用带 poll 版(requireXWebContents);extract 推文是用户右键即时触发、X 必已在台
 * (右键就发生在 X webview 上),用不带 poll 的即可,但仍走同一 fail-loud 定位。
 */

import { detectXServiceByUrl, type XServiceId } from '@shared/types/x-service-types';
import {
  resolveWsWebContents,
  resolveWsWebContentsWithWait,
} from '../web-service-base';

/** X fail-loud 文案标签 */
const X_LABELS = { service: 'X', pageName: 'X 页面(x.com)' };

/**
 * 取 X 注入目标 webContents(发推 / 回复用,带 poll 等就绪)。
 *
 * @param targetWcId 本活跃 ws 的 AI-view X Host guest wcId(renderer x-host-registry 查出)。
 *   未登记 / 已销毁 / 当前非 X 页 → **fail loud**(不回退全局 active)。
 */
export async function requireXWebContents(
  _serviceId: XServiceId,
  targetWcId?: number,
  timeoutMs = 10_000,
): Promise<{ wc: Electron.WebContents } | { error: string }> {
  return resolveWsWebContentsWithWait(
    targetWcId,
    (url) => !!detectXServiceByUrl(url),
    X_LABELS,
    timeoutMs,
  );
}

/**
 * 取 X 提取目标 webContents(右键提取推文用,即时,不 poll)。
 *
 * 右键发生在 X webview 上,wc 必已就绪,故不等待;仍 fail loud(未登记/非 X 页明确报错)。
 */
export function resolveXWebContents(
  targetWcId?: number,
): { wc: Electron.WebContents } | { error: string } {
  return resolveWsWebContents(
    targetWcId,
    (url) => !!detectXServiceByUrl(url),
    X_LABELS,
  );
}
