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
  const result = await captureFullPage(guest);
  // 落盘缓存原始 FullPageResult(离线观察 Defuddle 真实格式 / 调优 import-pipeline);
  // fire-and-forget,失败不阻断剪藏。
  void cacheClipResult(result);
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
