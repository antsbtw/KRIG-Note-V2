/**
 * WebView 右键菜单集成(Phase 2 根治后)
 *
 * 历史:web view 右键菜单原本走渲染进程 HTML 菜单(contextMenuRegistry + 命令),
 * 但 Electron `<webview>` 是 OS 级独立渲染 surface,z-index 对它无效 —— HTML 菜单
 * 被 webview 视觉盖住,用户看到的是 Chromium 原生菜单。Phase 2 把整套菜单移到主进程
 * 用 Menu.popup() 弹原生菜单(见 src/platform/main/web-context-menu/handler.ts)。
 *
 * 本文件现在只剩一件事:
 * - 复制类(链接/图片/选中文字)由主进程 clipboard 直接做,渲染进程不参与。
 * - 查词/翻译需操作 React dictionaryPanel(只能在渲染进程跑),主进程菜单项点击后
 *   IPC(WEB_CONTEXT_MENU_ACTION)推回,这里订阅并调 learning capability。
 */

import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { LearningApi } from '@capabilities/learning/types';

/** view 注册时调一次:订阅主进程右键菜单的查词/翻译动作 */
export function registerWebContextMenu(): void {
  window.electronAPI.onWebContextMenuAction(({ action, text }) => {
    if (!text) return;
    const learning = requireCapabilityApi<LearningApi>('learning');
    if (action === 'lookup') {
      learning.ui.dictionaryPanel.showLookup(text);
    } else if (action === 'translate') {
      learning.ui.dictionaryPanel.showTranslate(text);
    }
  });
}
