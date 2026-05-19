/**
 * AI Webview Hook — 给 mainWindow 挂 did-attach-webview,任何 guest webview
 * 都丢给 ai-webview-registry 跟踪 did-navigate 到 AI URL 自动注册为活跃。
 *
 * 调用时机:platform/main/index.ts 在 createMainWindow 后调一次,
 * 跟 registerWebviewExtractionHook 平级。
 */

import type { BrowserWindow } from 'electron';
import { trackWebContentsForAIService } from './webview-registry';

export function registerAIWebviewHook(mainWindow: BrowserWindow): void {
  mainWindow.webContents.on('did-attach-webview', (_event, guestWebContents) => {
    console.log('[ai-webview-hook] did-attach-webview, guest id=', guestWebContents.id);
    trackWebContentsForAIService(guestWebContents);
  });
}
