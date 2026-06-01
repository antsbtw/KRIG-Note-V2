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
 * 弹窗导流(Commit B):
 * - 普通浏览 webview 内 target=_blank / window.open 默认弹独立 BrowserWindow(飞出
 *   workspace,用户痛点)。这里 setWindowOpenHandler 截获,deny 独立窗口 + IPC 回推
 *   (WEB_NEW_TAB)让渲染进程在 web view 内新建 tab 打开。
 *
 * 过滤(shouldHandle,共享 web-shared):
 * - 快捷键 + 弹窗都只接管**普通浏览 webview**,绝不接管 AI / 翻译 webview。
 *
 * 调用时机:platform/main/index.ts 在 createMainWindow 后调一次,跟
 * registerWebContextMenuHook 平级。
 */

import type { BrowserWindow, WebContents, Event as ElectronEvent, Input } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
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

/** 在单个 guest 上挂快捷键拦截 + 弹窗导流 */
function attachGuest(mainWindow: BrowserWindow, guest: WebContents): void {
  // ── 快捷键:before-input-event(webview 焦点下唯一能拿到键盘的入口) ──
  guest.on('before-input-event', (event: ElectronEvent, input: Input) => {
    if (input.type !== 'keyDown') return;
    if (!shouldHandle(guest)) return; // 排除 AI / 翻译 webview
    const action = matchShortcut(input);
    if (!action) return;
    event.preventDefault(); // 阻止网页收到该键(如 ⌘F 触发网页自身查找)
    mainWindow.webContents.send(IPC_CHANNELS.WEB_VIEW_SHORTCUT, { action });
  });

  // ── 弹窗导流:target=_blank / window.open → 在 web view 内新建 tab ──
  guest.setWindowOpenHandler(({ url }) => {
    if (!shouldHandle(guest)) return { action: 'allow' }; // AI / 翻译弹窗不接管
    mainWindow.webContents.send(IPC_CHANNELS.WEB_NEW_TAB, { url });
    return { action: 'deny' }; // 阻止独立 BrowserWindow 飞出 workspace
  });
}

export function registerWebShortcutsHook(mainWindow: BrowserWindow): void {
  mainWindow.webContents.on('did-attach-webview', (_event, guest) => {
    attachGuest(mainWindow, guest);
  });
}
