/**
 * Web view 原生右键菜单 hook(Phase 2 根治)
 *
 * 背景 / 真因:
 * - 渲染进程的 HTML 右键菜单(ContextMenuBinding,z-index:1000)一直在正确渲染,
 *   但被 Electron `<webview>`(OS 级独立渲染 surface)视觉盖住 —— z-index 对 webview
 *   无效。用户实际看到的是 Chromium 原生菜单,所以之前改 blur / 坐标都打错目标。
 * - 解法:把菜单移到主进程,用 `Menu.popup()` 弹原生菜单 —— 原生菜单能盖在 webview
 *   上、点外部自动关、坐标准(params.x/y 即原生坐标,无需 getBoundingClientRect 换算),
 *   遮挡 + 坐标两个 bug 一并根治。
 *
 * 菜单项:
 * - 复制链接 / 复制图片地址 / 复制选中文字 → 主进程 clipboard.writeText 直接做
 * - 📖 查词 / 🌐 翻译 → IPC(WEB_CONTEXT_MENU_ACTION)推回渲染进程,由 learning
 *   capability 操作 React dictionaryPanel(只能在渲染进程跑)
 * - 后退 / 前进 / 刷新 / 复制页面地址 → 导航项,主进程直接调 guest webContents
 *   (navigationHistory / reload / getURL),恒在,对齐 Chrome 空白处也有菜单
 *
 * partition 过滤(头号坑):
 * - 三个 did-attach-webview 钩子(本 hook / ai/webview-hook / extraction/handlers)
 *   都收到所有 guest webview(普通浏览 / AI / 翻译)。本 hook **只对普通浏览 webview
 *   弹菜单**,绝不接管 AI / 翻译 webview(本轮用户只管普通浏览)。
 * - 判定方式(见下方 shouldHandle):
 *   1. 排除翻译 webview —— 翻译用独立 partition `persist:webview-translate`,
 *      `session.fromPartition(p)` 对同一 partition 字符串返回同一 Session 实例,
 *      故用实例身份比较 `guest.session === translateSession` 可靠识别并排除。
 *   2. 排除 AI webview —— AI webview 与普通浏览**同 ws 共用** `persist:webview-${ws}`
 *      partition(见 capabilities/ai-extraction/Host.tsx),partition 无法区分;改用 URL:
 *      右键时 `detectAIServiceByUrl(guest.getURL())` 命中 AI 服务则跳过。
 *
 * 调用时机:platform/main/index.ts 在 createMainWindow 后调一次,
 * 跟 registerWebviewExtractionHook / registerAIWebviewHook 平级。
 */

import {
  Menu,
  clipboard,
  type BrowserWindow,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
} from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
// shouldHandle 抽到 web-shared 共享(右键菜单 / 快捷键 / 弹窗导流 三处复用同一过滤)
import { shouldHandle } from '../web-shared/should-handle';
// 网页剪藏(Defuddle → Note):右键「📥 提取到笔记」click 调用,抓页 → 推回 renderer。
import { clipPageToRenderer } from '../content-extraction/handlers';

export function registerWebContextMenuHook(mainWindow: BrowserWindow): void {
  mainWindow.webContents.on('did-attach-webview', (_event, guest) => {
    guest.on('context-menu', (_e, params: ContextMenuParams) => {
      // partition 过滤:只接管普通浏览 webview(非翻译、非 AI)。
      if (!shouldHandle(guest)) return;

      const template: MenuItemConstructorOptions[] = [];

      if (params.linkURL) {
        template.push({
          label: '复制链接',
          click: () => clipboard.writeText(params.linkURL),
        });
      }
      if (params.srcURL) {
        template.push({
          label: '复制图片地址',
          click: () => clipboard.writeText(params.srcURL),
        });
      }
      if (params.selectionText) {
        template.push({
          label: '复制选中文字',
          click: () => clipboard.writeText(params.selectionText),
        });
        template.push({ type: 'separator' });
        template.push({
          label: '📖 查词',
          click: () =>
            mainWindow.webContents.send(IPC_CHANNELS.WEB_CONTEXT_MENU_ACTION, {
              action: 'lookup',
              text: params.selectionText,
            }),
        });
        template.push({
          label: '🌐 翻译',
          click: () =>
            mainWindow.webContents.send(IPC_CHANNELS.WEB_CONTEXT_MENU_ACTION, {
              action: 'translate',
              text: params.selectionText,
            }),
        });
      }

      // 网页剪藏:把当前页用 Defuddle 提取正文 + 图片/视频/音频/字幕,落成一篇 note。
      // 恒在(整页提取,不依赖选区/链接);click 在 main 抓页后经 WEB_CLIP_RESULT 推回 renderer。
      if (template.length > 0) template.push({ type: 'separator' });
      template.push({
        label: '📥 提取到笔记',
        click: () => {
          void clipPageToRenderer(mainWindow, guest);
        },
      });

      // 导航项(后退/前进/刷新/复制页面地址)—— 对齐 Chrome,空白处右键也有可用项。
      // 主进程直接持有 guest webContents,导航动作直接调,无需绕回渲染进程。
      // Electron 40 的 canGoBack/goBack 已迁到 guest.navigationHistory。
      if (template.length > 0) template.push({ type: 'separator' });
      const nav = guest.navigationHistory;
      template.push({
        label: '后退',
        enabled: nav.canGoBack(),
        click: () => nav.goBack(),
      });
      template.push({
        label: '前进',
        enabled: nav.canGoForward(),
        click: () => nav.goForward(),
      });
      template.push({
        label: '刷新',
        click: () => guest.reload(),
      });
      template.push({ type: 'separator' });
      template.push({
        label: '复制页面地址',
        click: () => clipboard.writeText(guest.getURL()),
      });

      // 导航项恒在,template 不会为空 —— 空白处右键也有菜单(对齐 Chrome)。
      if (template.length === 0) return;

      // 坐标:不传 x/y,Menu.popup 默认弹在当前鼠标光标位置 —— 这是最稳的定位
      // (params.x/y 是 guest webview 自身 viewport 坐标,需叠加 webview 在窗口内偏移
      //  才是 window 坐标;直接用光标位置免去换算且天然贴鼠标,根治坐标 bug)。
      const menu = Menu.buildFromTemplate(template);
      menu.popup({ window: mainWindow });
    });
  });
}
