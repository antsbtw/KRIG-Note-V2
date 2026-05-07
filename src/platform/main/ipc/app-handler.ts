/**
 * app IPC handlers — L5-B4.2.2
 *
 * 翻译切语言后让 widget 用新 lang 重新初始化(widget 注入路径下运行时切 lang 不可靠)。
 *
 * 实现:**清 translate partition 的 googtrans cookie + reload 主窗口 webContents**
 *
 * 关键(踩过坑):
 * 1. 不能 app.relaunch + app.exit/quit — dev 模式下 vite dev server URL 是编译期注入的全局
 *    常量,新 instance 拿不到,loadURL 失败白屏
 * 2. 仅 reload webContents 不够 — 翻译 webview partition 是 persist:,Google 的 googtrans
 *    cookie 跨 reload 保留,widget 看到旧 cookie 后直接用旧 lang,忽略新 lang
 * 3. **必须先清 cookie 再 reload** — 让 widget init 时看到干净环境用新 lang
 *
 * 仅清 google.com 域的 googtrans / googtrans-related cookie,不动用户登录态等。
 *
 * 安全考虑:
 * - renderer 主动调,非外部触发
 */

import { ipcMain, BrowserWindow, session } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { WEBVIEW_TRANSLATE_PARTITION } from '@shared/constants/webview';

/** 清 translate partition 里 Google Translate widget 用来记忆 lang 的 cookie */
async function clearTranslateCookies(): Promise<void> {
  const ses = session.fromPartition(WEBVIEW_TRANSLATE_PARTITION);
  // googtrans 是 widget 主 cookie(格式 /auto/<lang>),Google 还会写些前缀变体
  // 用 prefix 'goog' 一锅清,不动 NID / SID 等用户登录 cookie(它们前缀是大写)
  const cookies = await ses.cookies.get({});
  await Promise.all(
    cookies
      .filter((c) => c.name.startsWith('goog'))
      .map((c) => {
        // cookies.remove 需要 url(根据 domain 拼)
        const protocol = c.secure ? 'https' : 'http';
        const domain = c.domain?.startsWith('.') ? c.domain.slice(1) : c.domain;
        const url = `${protocol}://${domain}${c.path ?? '/'}`;
        return ses.cookies.remove(url, c.name).catch(() => {});
      }),
  );
}

export function registerAppHandlers(): void {
  ipcMain.on(IPC_CHANNELS.APP_RESTART, async (event) => {
    // 1. 清翻译 widget 的 lang cookie(否则 widget 看到旧 cookie 不用新 lang)
    try {
      await clearTranslateCookies();
    } catch (err) {
      console.warn('[app-handler] clearTranslateCookies failed', err);
    }
    // 2. reload 主窗口 webContents — workspace 状态从持久化文件 hydrate
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      win.webContents.reloadIgnoringCache();
      return;
    }
    const fallback = BrowserWindow.getAllWindows()[0];
    if (fallback) {
      fallback.webContents.reloadIgnoringCache();
    }
  });
}
