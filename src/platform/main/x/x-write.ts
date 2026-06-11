/**
 * X 写方向注入(X 集成 阶段 2)— 发普通推 / 回复
 *
 * 铁律 1(底座复用):focus 输入框 + OS 级 Cmd+V 真粘贴 走 web-service-base/webview-input
 * 的公共原语(focusInputBox / pasteTextToWebview / locateSendButton),与 AI writer 同一套,
 * 不复制。本文件只做 X 专属编排:确保 compose/reply 框在场、取 X profile selector、
 * fail loud + 剪贴板降级。
 *
 * ⚠️⚠️ 写方向最高红线:**永远是「填充内容,用户点发布」,绝不程序自动点发布。**
 * 本文件用 locateSendButton **仅校验**发布按钮已出现(辅助确认内容落进了正确的框),
 * **绝不 click**。发布那一下永远留给用户手动操作。
 *
 * 流程:
 *   发推:确保 X webview 在 compose 态(必要时 loadURL composeUrl)→ 等 compose 框出现
 *        → pasteTextToWebview(composeBox)→ 校验落地 → 成功停在「请检查后点发布」。
 *   回复:导航到目标推文 status 页(reply 框 inline 可用)→ 点开/等 reply 框
 *        → pasteTextToWebview(replyBox)→ 同上。
 *
 * 注入失败(框没找到 / 粘贴后内容没落地 / 没有活跃 X webview / selector 未配置)→
 * 返回 fail + reason,renderer 侧据此走「复制到剪贴板 + toast 明示降级」(铁律 4 fail loud)。
 */

import { getActiveXWebContents } from './webview-registry';
import {
  detectXServiceByUrl,
  getXServiceProfile,
  type XServiceId,
} from '@shared/types/x-service-types';
import {
  pasteTextToWebview,
  locateSendButton,
} from '../web-service-base';

export interface XWriteResult {
  success: boolean;
  /** 失败原因(renderer 侧 toast + 决定是否走剪贴板降级)*/
  error?: string;
  /** 发布按钮是否已就位(成功时附带,辅助确认内容落进正确的框;不代表已发布)*/
  publishReady?: boolean;
}

/** poll 等某个 selector 在 X webview 内出现(compose / reply 框加载需要时间)*/
async function waitForSelector(
  wc: Electron.WebContents,
  selector: string,
  timeoutMs = 6000,
): Promise<boolean> {
  if (!selector) return false;
  const start = Date.now();
  const script = `
    (function() {
      var sel = ${JSON.stringify(selector)};
      var selectors = sel.split(',').map(function(s){return s.trim();});
      for (var i=0;i<selectors.length;i++){
        if (selectors[i] && document.querySelector(selectors[i])) return true;
      }
      return false;
    })();
  `;
  while (Date.now() - start < timeoutMs) {
    try {
      if (await wc.executeJavaScript(script)) return true;
    } catch { /* ignore, retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/**
 * 取活跃 X webContents + 校验是 X 页(fail loud,不静默)。
 *
 * poll 等待:renderer 侧「发到 X」会先切 X 入口让 XHost 显示 + navigate,X webview
 * did-navigate 后才注册进 registry(链路 1-3s,仿 AI 的 waitForAIWebContents)。
 */
/**
 * 取注入目标 X webContents。
 *
 * @param targetWcId 指定的 guest wc id(本活跃 ws 的 AI-view X,renderer x-host-registry
 *   按活跃 ws 查出后传来)。**优先**用它精确定位 —— 治「多 X 实例(内置浏览器 X + AI-view X)
 *   串扰,全局 active 拿错实例,注入打到用户没在看的那个」的 bug。
 *   省略 / 找不到对应 wc → 回退旧的全局 getActiveXWebContents(单实例场景仍 OK,并 warn)。
 */
async function requireXWebContents(
  serviceId: XServiceId,
  targetWcId?: number,
  timeoutMs = 10_000,
): Promise<{ wc: Electron.WebContents } | { error: string }> {
  // 优先:按 renderer 指定的 wc id 精确定位(本活跃 ws 的 X)
  if (typeof targetWcId === 'number') {
    const { webContents } = await import('electron');
    const wc = webContents.fromId(targetWcId);
    if (wc && !wc.isDestroyed()) {
      if (!detectXServiceByUrl(wc.getURL())) {
        return { error: '指定的 X 实例当前不是 X 页面,无法注入' };
      }
      return { wc };
    }
    console.warn(
      `[x-write] 指定 targetWcId#${targetWcId} 不存在/已销毁,回退全局 active(多实例可能串扰)`,
    );
  }

  // 回退:全局 active(最后 navigate 的)— 单实例场景 OK
  const start = Date.now();
  let wc = getActiveXWebContents(serviceId);
  while (!wc && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 200));
    wc = getActiveXWebContents(serviceId);
  }
  if (!wc) {
    return { error: '没有活跃的 X 页面 — 请先在右栏切到 X 并加载到 x.com' };
  }
  if (!detectXServiceByUrl(wc.getURL())) {
    return { error: '当前不是 X 页面,无法注入' };
  }
  return { wc };
}

/**
 * 发普通推:把 text 填进 X compose 框(用户随后手动点发布)。
 *
 * @param serviceId X 服务 id('x')
 * @param text 已降级好的纯文本(markdown→tweet 在 renderer 侧做)
 */
export async function pasteTweet(
  serviceId: XServiceId,
  text: string,
  targetWcId?: number,
): Promise<XWriteResult> {
  if (!text || !text.trim()) {
    return { success: false, error: '内容为空,无法发推' };
  }
  const got = await requireXWebContents(serviceId, targetWcId);
  if ('error' in got) return { success: false, error: got.error };
  const wc = got.wc;

  const profile = getXServiceProfile(serviceId);
  const composeSel = profile.selectors.composeBox;
  if (!composeSel) {
    // selector 未配置(spike 未完成)→ fail loud,renderer 走剪贴板降级
    return { success: false, error: 'X compose selector 未配置(需 spike 后填入 profile)' };
  }

  // 确保 compose 框在场:先看当前页有没有,没有就 loadURL 到 composeUrl
  let composeReady = await waitForSelector(wc, composeSel, 1200);
  if (!composeReady) {
    try {
      wc.loadURL(profile.composeUrl);
    } catch (err) {
      return { success: false, error: `打开 X 发推框失败:${String(err)}` };
    }
    // loadURL 后等页面 + compose 框就绪
    composeReady = await waitForSelector(wc, composeSel, 8000);
  }
  if (!composeReady) {
    return { success: false, error: '未能定位 X 发推框(可能 X 改版 / 未登录 / selector 失效)' };
  }

  const pasted = await pasteTextToWebview(wc, composeSel, text);
  if (!pasted) {
    return { success: false, error: '内容未能落进 X 发推框(粘贴校验失败)' };
  }

  // 仅校验发布按钮已出现(确认内容落进了正确的框)— 绝不 click(写方向红线)
  const publish = profile.selectors.publishButton
    ? await locateSendButton(wc, profile.selectors.publishButton)
    : { found: false, enabled: false };

  return { success: true, publishReady: publish.found };
}

/**
 * 回复某条推:导航到该推 status 页 → 把 text 填进 reply 框(用户随后手动点回复)。
 *
 * @param serviceId X 服务 id('x')
 * @param tweetUrl 被回复推文的 status URL(右键时抓到,renderer 透传)
 * @param text 已降级好的纯文本
 */
export async function pasteReply(
  serviceId: XServiceId,
  tweetUrl: string,
  text: string,
  targetWcId?: number,
): Promise<XWriteResult> {
  if (!text || !text.trim()) {
    return { success: false, error: '回复内容为空' };
  }
  if (!tweetUrl) {
    return { success: false, error: '缺少被回复推文的链接(无法定位 reply 框)' };
  }
  const got = await requireXWebContents(serviceId, targetWcId);
  if ('error' in got) return { success: false, error: got.error };
  const wc = got.wc;

  const profile = getXServiceProfile(serviceId);
  const replySel = profile.selectors.replyBox;
  if (!replySel) {
    return { success: false, error: 'X reply selector 未配置(需 spike 后填入 profile)' };
  }

  // 导航到目标推文详情页(若已在该页则不重载)— status 页 reply 框 inline 可用
  const current = wc.getURL();
  if (!current.includes(extractStatusPath(tweetUrl))) {
    try {
      wc.loadURL(tweetUrl);
    } catch (err) {
      return { success: false, error: `打开目标推文失败:${String(err)}` };
    }
  }

  // 等 reply 框出现。X 推文详情页顶部通常直接有 reply 框(tweetTextarea_0);
  // 若需先点「回复」激活,waitForSelector 超时后由用户在页面手动点开亦可(fail loud 提示)。
  const replyReady = await waitForSelector(wc, replySel, 8000);
  if (!replyReady) {
    return {
      success: false,
      error: '未能定位该推文的回复框(请在 X 页面点开回复输入框后重试,或 selector 失效)',
    };
  }

  const pasted = await pasteTextToWebview(wc, replySel, text);
  if (!pasted) {
    return { success: false, error: '回复内容未能落进 reply 框(粘贴校验失败)' };
  }

  const publish = profile.selectors.publishButton
    ? await locateSendButton(wc, profile.selectors.publishButton)
    : { found: false, enabled: false };

  return { success: true, publishReady: publish.found };
}

/** 从 tweet URL 取 `/<handle>/status/<id>` 片段,用于「是否已在该推页」判定 */
function extractStatusPath(url: string): string {
  const m = url.match(/\/status\/(\d+)/);
  return m ? `/status/${m[1]}` : url;
}
