/**
 * Web view 快捷键 + 弹窗导流 hook(Phase 4 Commit 2 根治）
 *
 * 背景 / 真因:
 * - Electron `<webview>` 是独立渲染进程(OS 级 surface)。当焦点落在 webview 内
 *   (用户在网页里点过、正在浏览）时,键盘事件**不冒泡到宿主 React onKeyDown** ——
 *   于是 ⌘T/⌘W/⌘L/⌘F/⌘R/⌘±/⌘[⌘] 这套 web 快捷键在网页焦点下全部失效。
 * - 唯一能在 webview 内焦点时拿到键盘的是主进程 `webContents.on('before-input-event')`。
 *   本 hook 在 guest webContents 上拦截这套快捷键,preventDefault 后 IPC 回推渲染进程
 *   (WEB_VIEW_SHORTCUT),由 WebView.tsx 分发到现有 handler —— 与 Phase 2 右键菜单
 *   同一套 did-attach-webview + shouldHandle + IPC 回推基建。
 *
 * 弹窗导流(分三类,见 setWindowOpenHandler 处详注):
 * - gapi 内嵌 widget(hovercard 等)→ deny,留在父页面当 iframe;
 * - OAuth 登录(accounts.google.com 等)→ allow 走真 popup,但钉成主窗口的子/模态 sheet
 *   (parent+modal,不飘出 app、可关闭)。GSI 的 popup 流靠 opener postMessage 回传,整页
 *   loadURL 会白屏,故只能 popup(配合 index.ts 关 FedCM 让 GIS 退回此 popup 流);
 * - 其余普通 target=_blank / window.open → 外抛成 app 内新 tab,不飞出 workspace。
 *
 * 过滤(shouldHandle,共享 web-shared):
 * - 快捷键只接管**普通浏览 webview**,绝不接管 AI / 翻译 webview。
 *
 * 调用时机:platform/main/index.ts 在 createMainWindow 后调一次,跟
 * registerWebContextMenuHook 平级。
 */

import type { BrowserWindow, WebContents, Event as ElectronEvent, Input } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { detectXServiceByUrl } from '@shared/types/x-service-types';
import { shouldHandle } from '../web-shared/should-handle';

/** 快捷键 action 字符串(与渲染进程 WebView.tsx 分发表一一对应) */
export type WebShortcutAction =
  | 'new-tab'
  | 'close-tab'
  | 'focus-url'
  | 'find'
  | 'reload'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'go-back'
  | 'go-forward';

/**
 * before-input-event 的 input → action 映射。
 *
 * 性能:每个键都进这个函数,先用「无修饰键的特例(F5 / Alt+方向)」+「非 mod 键早返回」
 * 把绝大多数普通打字快速挡在外面,再做 mod 组合判定。
 *
 * @param input Electron before-input-event 的 Input(已确认 type==='keyDown')
 * @returns 命中返回 action,否则 null(不接管,放网页正常处理)
 */
export function matchShortcut(input: Input): WebShortcutAction | null {
  const key = input.key;

  // ── 无 mod 的特例:F5 刷新 / Alt+方向 前进后退 ──
  if (key === 'F5') return 'reload';
  if (input.alt && !input.meta && !input.control) {
    if (key === 'ArrowLeft') return 'go-back';
    if (key === 'ArrowRight') return 'go-forward';
    return null;
  }

  // ── 以下全部需要 ⌘ / Ctrl(mod);非 mod 键早返回,避免影响普通打字 ──
  const mod = input.meta || input.control;
  if (!mod) return null;

  // ⌘W vs ⇧⌘W:⌘W 关 tab(本 hook 接管),⇧⌘W 关窗口(让给应用菜单 accelerator)。
  // 故带 shift 的 w 不接管。
  if (input.shift) {
    // 目前 web 快捷键层没有用到 shift 组合 —— 一律放过(含 ⇧⌘W 走菜单)。
    return null;
  }

  switch (key.toLowerCase()) {
    case 't':
      return 'new-tab';
    case 'w':
      return 'close-tab';
    case 'l':
      return 'focus-url';
    case 'f':
      return 'find';
    case 'r':
      return 'reload';
    case '0':
      return 'zoom-reset';
    case '-':
      return 'zoom-out';
    case '[':
      return 'go-back';
    case ']':
      return 'go-forward';
    case '+':
    case '=':
      return 'zoom-in';
    default:
      return null;
  }
}

/**
 * 给 OAuth popup 原生窗补「可关闭」逃生口(根治死路:popup 是 parent+modal sheet,
 * macOS 下无原生标题栏/关闭按钮,盖住整窗后用户若不想用此方式登录会被卡死 ——
 * NavSide / tab 全被遮、无法返回)。
 *
 * 两层保险:
 *  1) ESC 关闭:popup webContents before-input-event 拦 Escape → win.close()。必中、零风险。
 *  2) 注入一个 fixed 右上角「✕」关闭按钮:dom-ready 后 executeJavaScript 在页面主世界跑
 *     DOM 创建,叠一个绝对定位的按钮,点击 window.close()。executeJavaScript 是受信代码注入,
 *     不受页面 CSP script-src 限制(CSP 管的是页面自己加载/inline 的脚本,不管宿主注入);
 *     按钮纯靠 element.onclick,不依赖 inline script。失败(理论不会)也无碍,ESC 仍可关。
 *
 * 不改 modal/parent/partition —— 登录流(opener↔popup postMessage)完全不动,只加逃生口。
 */
function wireOAuthPopupEscape(popupWin: BrowserWindow): void {
  const wc = popupWin.webContents;

  // 1) ESC 关闭
  wc.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault();
      if (!popupWin.isDestroyed()) popupWin.close();
    }
  });

  // 2) 注入右上角关闭按钮(domReady 后,确保 document.body 在)
  wc.on('dom-ready', () => {
    wc.executeJavaScript(
      `(function(){
        if (document.getElementById('__krig_oauth_close__')) return;
        var b = document.createElement('button');
        b.id = '__krig_oauth_close__';
        b.textContent = '\\u2715';
        b.title = '\\u5173\\u95ed (Esc)';
        b.setAttribute('style',
          'position:fixed;top:10px;right:10px;z-index:2147483647;' +
          'width:28px;height:28px;line-height:28px;padding:0;' +
          'border:none;border-radius:50%;cursor:pointer;' +
          'background:rgba(0,0,0,.55);color:#fff;font-size:15px;' +
          'box-shadow:0 1px 4px rgba(0,0,0,.3);');
        b.onclick = function(){ window.close(); };
        document.body.appendChild(b);
      })();`,
    ).catch(() => { /* CSP/时序极端情况:静默,ESC 仍可关 */ });
  });
}

/** 在单个 guest 上挂快捷键拦截 + 弹窗导流 */
function attachGuest(mainWindow: BrowserWindow, guest: WebContents): void {
  // ── OAuth popup 逃生口:setWindowOpenHandler 返回 allow 后,Electron 用
  //    overrideBrowserWindowOptions 开 popup BrowserWindow,但 handler 返回值拿不到该
  //    window 引用 —— 用 did-create-window 捕获。仅对 OAuth popup(isOAuthPopup)挂
  //    ESC + 关闭按钮,堵住「modal sheet 盖整窗、无法返回」的死路。──
  guest.on('did-create-window', (popupWin, details) => {
    if (isOAuthPopup(details.url)) wireOAuthPopupEscape(popupWin);
  });

  // ── 快捷键:before-input-event(webview 焦点下唯一能拿到键盘的入口) ──
  guest.on('before-input-event', (event: ElectronEvent, input: Input) => {
    if (input.type !== 'keyDown') return;
    if (!shouldHandle(guest)) return; // 排除 AI / 翻译 webview
    const action = matchShortcut(input);
    if (!action) return;
    event.preventDefault(); // 阻止网页收到该键(如 ⌘F 触发网页自身查找)
    mainWindow.webContents.send(IPC_CHANNELS.WEB_VIEW_SHORTCUT, { action });
  });

  // ── 弹窗导流(实测 Gmail 白屏根因后的最终策略)──
  // 同一个 setWindowOpenHandler 要分清三类 window.open,处理各不相同:
  //
  // 1) gapi 内嵌 widget(如 Gmail 联系人 hovercard,带 usegapi=1 / /widget/):
  //    本是页面内 <iframe>,自带 `X-Frame-Options: ALLOW-FROM` + CSP
  //    `frame-ancestors`,只能嵌在父页面里。若 allow 成独立页 → 脱离父 frame
  //    上下文 → 白屏(实测 contacts.google.com/widget/hovercard 即此)。故 deny
  //    且不外抛 tab,让 Gmail 走它自己的 iframe 渲染。
  //
  // 2) OAuth / 登录弹窗(accounts.google.com 等):依赖 opener↔popup 的
  //    postMessage / window.close 完成认证,必须 allow 走原生 popup,否则
  //    外抛成 tab 会 opener 断裂 → 登录回跳 ERR_ABORTED → 白屏。
  //
  // 3) 其余普通 target=_blank / window.open:导流成 app 内新 tab,不让独立窗口
  //    飞出 workspace。
  guest.setWindowOpenHandler(({ url }) => {
    if (isEmbedWidget(url)) return { action: 'deny' }; // 1) 内嵌 widget:留在父页
    if (isOAuthPopup(url)) {
      // 2) 登录弹窗:必须 allow 走真 popup —— GSI 的 /gsi/select?ux_mode=popup&ui_mode=card
      //    这类 URL 专为 popup 设计,靠 opener↔popup postMessage 回传认证结果;若改成
      //    整页 loadURL 会脱离 opener 上下文 → 白屏(实测)。故保留 popup,但用
      //    overrideBrowserWindowOptions 钉成主窗口的子/模态窗(parent+modal):macOS 下
      //    挂成依附主窗口的 sheet,不飘出 app,登录完 window.close 自动收起。
      //    popup 继承 opener(webview)的 per-ws partition,cookie 与该 ws 的 X/AI/浏览器同源。
      //    ⚠️ 必须显式 webPreferences.javascript=true:不设的话 popup 默认 JS 关闭,
      //    Google 报「浏览器不支持/关闭了 JavaScript」无法登录(实测)。
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: mainWindow,
          modal: true,
          backgroundColor: '#1e1e1e',
          webPreferences: {
            // 必须显式开 JS:否则 Google 报「浏览器不支持 / 关闭了 JavaScript」无法登录。
            // 不显式设 partition —— popup 自动继承 opener(guest webview)的 partition,
            // AI/X/普通浏览同 ws 都走 persist:webview-${wsId},各 ws 各自 cookie 同源。
            javascript: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        },
      };
    }
    // 3) 目标是 x.com/twitter.com 的 window.open(X 内点「Read replies」/ 用户主页 /
    //    图片放大等):**在 opener guest 内同页导航**(loadURL),留在原 webview(登录态、
    //    KRIG 外壳都在);不开新窗/新 tab、不脱离 partition。只看 target 是不是 X(不依赖
    //    opener URL 判定 —— opener 可能是 X 内嵌 iframe / about:blank 中转,判不准)。
    if (detectXServiceByUrl(url)) {
      guest.loadURL(url);
      return { action: 'deny' };
    }
    mainWindow.webContents.send(IPC_CHANNELS.WEB_NEW_TAB, { url }); // 4) 普通:开 tab
    return { action: 'deny' };
  });
}

/**
 * gapi / Google widget 内嵌 iframe(本质是页面内 iframe,误经 window.open 冒出来)。
 * 判据:usegapi=1 或路径 /widget/。这类自带 frame-ancestors,单独打开必白屏,
 * 故 deny 让其留在父页面里。
 */
function isEmbedWidget(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    return u.searchParams.get('usegapi') === '1' || u.pathname.includes('/widget/');
  } catch {
    return false;
  }
}

/**
 * OAuth / 第三方登录弹窗。这类靠 opener↔popup 的 postMessage / window.close 完成
 * 认证,必须 allow 走原生 popup,外抛成 tab 会 opener 断裂 → 登录白屏。
 * 仅匹配已知认证域,避免误放普通 target=_blank。
 */
const OAUTH_HOSTS = [
  'accounts.google.com',
  'login.microsoftonline.com',
  'login.live.com',
  'appleid.apple.com',
  'github.com', // github.com/login/oauth/authorize
];

function isOAuthPopup(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname;
    return OAUTH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export function registerWebShortcutsHook(mainWindow: BrowserWindow): void {
  mainWindow.webContents.on('did-attach-webview', (_event, guest) => {
    attachGuest(mainWindow, guest);
  });
}
