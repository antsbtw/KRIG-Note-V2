/**
 * Mail WebContents 定位 — 按活跃 ws 定向取「该 ws 的 Mail Host guest」
 *
 * 为什么不用 registry.getActive:registry 是 per-serviceId 全局单例(「最后 navigate
 * 胜出」),不分 ws。多 ws 并存(每个挂自己的邮箱 webview),或内置浏览器也开着
 * Gmail 时,操作会打到「最后 navigate 的」那个 —— 抓自 / 落进用户没在看的框。
 * (AI 问答 / X 发推都实测踩过这个坑,见 ws-webcontents-resolver 文件头。)
 *
 * 修法:renderer 侧 mail-host-registry 按 wsId 登记 guest wcId,命令侧取出后 IPC
 * 透传到这里,`webContents.fromId` 精确定位 + URL 校验。
 *
 * ⚠️ fail loud:三种未命中(wcId 非法 / wc 已销毁 / URL 不是邮箱页)一律返
 * `{ error }`,**绝不回退全局 getActive** —— 回退正是多 ws 串扰 bug 的根源。
 */

import { detectMailServiceByUrl } from '@shared/types/mail-service-types';
import { resolveWsWebContentsWithWait } from '../web-service-base';

const MAIL_LABELS = { service: 'Mail', pageName: '网页版邮箱页面' };

/**
 * 取指定 ws 的邮箱 guest webContents(带等待)。
 *
 * @param targetWcId renderer 侧 getMailHostWcId(wsId) 取出后透传的 guest wcId
 * @param timeoutMs  等待 guest 就绪的上限(默认 10s;webview 冷启动/登录跳转较慢)
 */
export async function requireMailWebContents(
  targetWcId?: number | null,
  timeoutMs = 10_000,
): Promise<{ wc: Electron.WebContents } | { error: string }> {
  return resolveWsWebContentsWithWait(
    targetWcId,
    (url) => !!detectMailServiceByUrl(url),
    MAIL_LABELS,
    timeoutMs,
  );
}
