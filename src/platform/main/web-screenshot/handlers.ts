/**
 * 网页正文截图到笔记 —— 右键菜单入口(2026-11-05)
 *
 * 流程:注入框选(用户调整 + 确认)→ 分段截图拼长图 → 存媒体库 → WEB_SHOT_RESULT 推给 renderer
 * (renderer:右栏开着笔记就插到光标处,否则新建一篇)。
 * 每一步失败都推 { ok:false, error },renderer 弹提示;终端留一行。
 */

import type { BrowserWindow, WebContents } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { mediaStore } from '../media/media-store-impl';
import { buildSelectScript, RESTORE_SCRIPT, type ShotSelection } from './select-script';
import { captureSelection } from './capture';

export type WebShotResult =
  | { ok: true; mediaUrl: string; title: string; url: string; width: number; height: number }
  | { ok: false; error: string };

function send(mainWindow: BrowserWindow, payload: WebShotResult): void {
  try {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send(IPC_CHANNELS.WEB_SHOT_RESULT, payload);
  } catch (err) {
    console.error('[web-shot] WEB_SHOT_RESULT send failed:', err);
  }
}

export async function shotArticleToRenderer(mainWindow: BrowserWindow, guest: WebContents): Promise<void> {
  let sel: ShotSelection | null;
  try {
    sel = (await guest.executeJavaScript(buildSelectScript(), true)) as ShotSelection | null;
  } catch (err) {
    console.warn('[web-shot] 框选脚本失败:', err);
    send(mainWindow, { ok: false, error: `没法在这个网页上框选:${err instanceof Error ? err.message : String(err)}` });
    return;
  }
  if (!sel) {
    console.log('[web-shot] 用户取消');
    return;
  }

  const t0 = Date.now();
  try {
    const img = await captureSelection(guest, sel);
    const put = await mediaStore.putBase64(img.dataUrl, undefined, `web-shot.${img.format === 'png' ? 'png' : 'jpg'}`);
    if (!put.success || !put.mediaUrl) throw new Error(`存图片失败:${put.error ?? '未知原因'}`);
    console.log(`[web-shot] ✓ ${img.width}×${img.height} ${img.format} ${Math.round(img.dataUrl.length * 0.75 / 1024)}KB → ${put.mediaUrl}(${Date.now() - t0}ms)`);
    send(mainWindow, { ok: true, mediaUrl: put.mediaUrl, title: sel.title, url: sel.url, width: img.width, height: img.height });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[web-shot] 截图失败:', msg);
    send(mainWindow, { ok: false, error: `截图失败:${msg}` });
  } finally {
    // 还原被藏的吸顶栏等(不管截没截成)
    guest.executeJavaScript(RESTORE_SCRIPT, true).catch(() => { /* 页面已走 */ });
  }
}
