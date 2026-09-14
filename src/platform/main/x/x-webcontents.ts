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

import { webContents } from 'electron';
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

/**
 * 无人值守场景下自行找一个可用的 X webContents。
 *
 * ⚠️ 2026-09-03 Windows 部署实测暴露的问题:
 *   X 的 wcId 由 SocialView 在**挂载时登记、卸载时清除**
 *   (SocialView.tsx:132)。而 campaign 的 /refresh 是**外部随时敲进来**的,
 *   那台机器上不会有人一直守着 X 页面 —— 于是 getActiveWcId 返回 null,
 *   整个请求 503「未登记 wc id」,而 X 其实还活着(只是界面切走了)。
 *
 * 故这里绕过「登记表」,直接在所有存活的 webContents 里找 x.com 的那个。
 * 仅供**后台/无人值守**路径使用;交互路径仍应传显式 wcId(定向更准,
 * 多 ws 时不会抓错窗口)。
 *
 * @param preferWcId 有显式 id 就优先用它,校验通过即返回
 */
export function resolveAnyXWebContents(
  preferWcId?: number,
): { wc: Electron.WebContents } | { error: string } {
  if (preferWcId != null) {
    const r = resolveXWebContents(preferWcId);
    if (!('error' in r)) return r;
  }
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    try {
      if (detectXServiceByUrl(wc.getURL())) return { wc };
    } catch { /* 取 URL 可能抛,跳过 */ }
  }
  return { error: '找不到已加载 x.com 的 webContents —— 请确认该 workspace 里 X 页面已打开过' };
}
