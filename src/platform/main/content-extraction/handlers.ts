/**
 * content-extraction IPC handlers(实现半入口)
 *
 * 触发模型与 tweet-fetcher 不同:网页剪藏由 **web view 右键菜单**(main 侧
 * web-context-menu/handler.ts)触发,不是 renderer → main invoke。故本模块对外暴露:
 *
 *  - clipPageToRenderer(mainWindow, guest):右键菜单 click 调用 —— 跑 captureFullPage,
 *    把 FullPageResult 经 WEB_CLIP_RESULT 推回 renderer(content-extraction 门面订阅后跑 pipeline)。
 *  - registerContentExtractionHandlers():在 ipc-bus.initIpcBus() 注册(仿 tweet-fetcher
 *    平铺风格)。本期无 renderer → main invoke,函数预置 hook 点 + 文档收口位置。
 *
 * 注册入口:platform/main/ipc/ipc-bus.ts initIpcBus()。
 */

import type { BrowserWindow, WebContents } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { captureFullPage } from './capture';
import { cacheClipResult } from './clip-cache';
import { resolveBlobVideos } from './blob-video';
import { expandLinkedAnswers } from './linked-answers/expand';
import type { LinkedAnswerRule } from './linked-answers/rules';
import type { FullPageResult } from './types';

/**
 * 右键菜单「📥 提取到笔记」click 回调:抓当前 guest 页面 → 推回 renderer。
 *
 * 失败(超时 / Defuddle 报错 / bundle 读不到)时 captureFullPage 返回 null,
 * 本函数仍推一条 { success:false },让 renderer 侧可提示(本期 renderer 先静默/console)。
 *
 * TODO(D5):首版完成即在 renderer 打开 note,暂不做"剪藏中…" toast。
 */
export async function clipPageToRenderer(
  mainWindow: BrowserWindow,
  guest: WebContents,
): Promise<void> {
  await sendClip(mainWindow, await captureFullPage(guest));
}

/**
 * 右键「📥 提取题目 + 解答到笔记」:先照常提取题目页,再逐题抓解答页(见 linked-answers/)。
 * 题目页本身提取失败 → 和普通提取一样推 null;个别题解答抓不到 → 照样出笔记,失败写在那题的折叠块里。
 */
export async function clipPageWithAnswersToRenderer(
  mainWindow: BrowserWindow,
  guest: WebContents,
  rule: LinkedAnswerRule,
): Promise<void> {
  const raw = await captureFullPage(guest);
  let result = raw;
  if (raw) {
    try {
      result = await expandLinkedAnswers(guest, raw, rule);
    } catch (err) {
      // 编排本身不该抛(逐题都有 catch);真抛了就只出题目,并让笔记里写明解答没抓
      console.error('[linked-answers] 展开解答出错,笔记里只有题目:', err);
      result = { ...raw, linkedAnswers: [] };
    }
  }
  await sendClip(mainWindow, result);
}

async function sendClip(mainWindow: BrowserWindow, raw: FullPageResult | null): Promise<void> {
  // 落盘缓存原始 FullPageResult(离线观察 Defuddle 真实格式 / 调优 import-pipeline);
  // fire-and-forget,失败不阻断剪藏。
  void cacheClipResult(raw);
  // blob: 视频只在原页面里能播 → 用 yt-dlp 换成真实直链(见 blob-video.ts)
  const result = raw ? await resolveBlobVideos(raw) : raw;
  // send 防护:win.isDestroyed() 只查 BrowserWindow,不查 webContents —— 抓取最长 10s,
  // 期间主窗口若开始拆除(关窗/退出),webContents 可能已销毁/崩溃,send 抛 "Object has
  // been destroyed";payload 含页面任意 schemaOrgData,极端情况结构化克隆也可能抛。
  // 本函数被调用方 `void clipPageToRenderer(...)` fire-and-forget,抛出会成未处理 rejection,
  // 故这里吞掉(剪藏失败,记日志,不崩主进程)。
  try {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send(IPC_CHANNELS.WEB_CLIP_RESULT, result);
  } catch (err) {
    console.error('[content-extraction] WEB_CLIP_RESULT send failed:', err);
  }
}

/**
 * 注册 content-extraction 的 IPC handlers(仿 tweet-fetcher 平铺风格)。
 *
 * 本期剪藏走右键菜单 → clipPageToRenderer 的 main → renderer 单向推送,
 * 无 renderer → main invoke 通道。保留本函数作 ipc-bus 注册收口 + 未来 hook 点
 * (如"renderer 主动请求剪藏当前页"的 invoke)。
 */
export function registerContentExtractionHandlers(): void {
  // 本期无 ipcMain.handle;预置注册收口,保持与 tweet-fetcher 同构。
}
