/**
 * WebView 右键菜单集成(L5-B4)
 *
 * 跟 NoteView 用 contextMenuRegistry + 命令的模式一致,但 webview 的 context-menu
 * 上下文(linkURL / srcURL / selectionText)需要 webview 特定的状态传递。
 *
 * 模式:
 * 1. WebView 监听 webview 'context-menu' 事件 → 存到模块级 currentWebContext
 * 2. 调 contextMenuController.show 弹菜单
 * 3. 菜单项的命令 handler 读 currentWebContext 拿到 linkURL 等
 *
 * 菜单项:
 * - 复制链接(条件:linkURL 非空)
 * - 复制图片地址(条件:srcURL 非空)
 * - 复制选中文字(条件:selectionText 非空)
 * - 📖 查词(条件:selectionText 非空 → learning.ui.dictionaryPanel.showLookup)
 * - 🌐 翻译(条件:selectionText 非空 → learning.ui.dictionaryPanel.showTranslate)
 */

import { contextMenuController } from '@slot/triggers/context-menu-controller';
import { contextMenuRegistry } from '@slot/interaction-registries/context-menu-registry/context-menu-registry';
import { commandRegistry } from '@slot/command-registry/command-registry';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { LearningApi } from '@capabilities/learning/types';

const VIEW = 'web-view';

interface WebContextMenuPayload {
  linkURL: string;
  srcURL: string;
  selectionText: string;
  /** webview 内部坐标(viewport 相对的 x/y)*/
  x: number;
  y: number;
}

let currentContext: WebContextMenuPayload | null = null;

/**
 * web view 失焦/Esc 关闭监听 —— teardown 句柄(单次注册,弹一次菜单挂一组,关闭即清)。
 *
 * 背景:web view 不走 use-context-menu-trigger(它在 trigger 里挂了 mousedown/Esc 关闭),
 * 而是经 Host 'context-menu' 事件 → showWebContextMenu → controller.show 直接弹,
 * 所以缺「点外部 / Esc 关闭」。这里把 trigger:68-88 的同款逻辑补到 web 路径。
 */
let closeListenersTeardown: (() => void) | null = null;

function detachCloseListeners(): void {
  if (closeListenersTeardown) {
    closeListenersTeardown();
    closeListenersTeardown = null;
  }
}

function attachCloseListeners(): void {
  // 重复弹(没点项直接换位置右键)时先清旧监听,避免泄漏 / 重复挂。
  detachCloseListeners();

  const handleClickOutside = (e: MouseEvent): void => {
    const target = e.target as HTMLElement | null;
    // 点菜单内(命令执行后由 controller.hide 关),不在此处理。
    if (target?.closest('.krig-context-menu')) return;
    contextMenuController.hide();
  };

  const handleEscape = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') contextMenuController.hide();
  };

  // 防坑:右键事件序列里 mousedown 先于菜单 show,直接挂 mousedown 会被这次右键的
  // mousedown 立即触发 → 菜单一弹就秒关。setTimeout(0) 推到下一帧再挂(同 WebToolbar 语言菜单技巧)。
  const t = setTimeout(() => {
    window.addEventListener('mousedown', handleClickOutside);
  }, 0);
  window.addEventListener('keydown', handleEscape);

  closeListenersTeardown = (): void => {
    clearTimeout(t);
    window.removeEventListener('mousedown', handleClickOutside);
    window.removeEventListener('keydown', handleEscape);
  };
}

/** WebView 监听 webview 的 context-menu 事件后调本函数
 *
 * 说明:web view 不走 use-context-menu-trigger(webview 的 DOM 在子 frame 内不可达,
 * 由 webview 'context-menu' 事件回传)— 手动构造 ContextInfo 调 controller.show。
 *
 * L4 重构后 custom 留空:
 * - text-editing / thought 等 capability provider 跑在 host DOM 上无意义
 *   (webview 内 a[href] 等不在宿主 DOM 树)
 * - web view 自己的业务字段(linkURL / srcURL / selectionText)沿用模块级 currentContext
 *   缓存(PR-α-1 保留既有模式,后续 PR 可考虑迁 custom)
 */
export function showWebContextMenu(payload: WebContextMenuPayload): void {
  currentContext = payload;
  contextMenuController.show(payload.x, payload.y, VIEW, {
    hasSelection: payload.selectionText.length > 0,
    isEditable: false,
    x: payload.x,
    y: payload.y,
    custom: {},
  });
  // 反馈3:补点外部 / Esc 关闭(web view 不走 trigger,需自挂)。
  attachCloseListeners();
}

export function getCurrentWebContext(): WebContextMenuPayload | null {
  return currentContext;
}

/** view 注册时调一次:菜单项 + 命令 */
export function registerWebContextMenu(): void {
  // 菜单一旦关闭(命令执行后的 hide / 点外部 / Esc)→ 拆掉关闭监听,防泄漏。
  // 单次订阅(view 注册一次),按可见状态切换 attach/detach 的清理。
  contextMenuController.subscribe(() => {
    if (!contextMenuController.getState().visible) {
      detachCloseListeners();
    }
  });

  // ── 简化命令 ──

  commandRegistry.register('web-view.cm-copy-link', () => {
    const ctx = currentContext;
    if (!ctx?.linkURL) return;
    void navigator.clipboard.writeText(ctx.linkURL);
    contextMenuController.hide();
  });

  commandRegistry.register('web-view.cm-copy-image-url', () => {
    const ctx = currentContext;
    if (!ctx?.srcURL) return;
    void navigator.clipboard.writeText(ctx.srcURL);
    contextMenuController.hide();
  });

  commandRegistry.register('web-view.cm-copy-selection', () => {
    const ctx = currentContext;
    if (!ctx?.selectionText) return;
    void navigator.clipboard.writeText(ctx.selectionText);
    contextMenuController.hide();
  });

  commandRegistry.register('web-view.cm-dictionary-lookup', () => {
    const ctx = currentContext;
    if (!ctx?.selectionText) return;
    const learning = requireCapabilityApi<LearningApi>('learning');
    learning.ui.dictionaryPanel.showLookup(ctx.selectionText);
    contextMenuController.hide();
  });

  commandRegistry.register('web-view.cm-translate-selection', () => {
    const ctx = currentContext;
    if (!ctx?.selectionText) return;
    const learning = requireCapabilityApi<LearningApi>('learning');
    learning.ui.dictionaryPanel.showTranslate(ctx.selectionText);
    contextMenuController.hide();
  });

  // ── 菜单项 ──
  // 注:V2 ContextMenuItem 的 enabledWhen 只支持 'always' | 'has-selection' | 'is-editable',
  // linkURL/srcURL 条件用 always 显示,命令内部判空 no-op(简化路径)。
  contextMenuRegistry.register([
    {
      id: 'web-view.cm.copy-link',
      label: '复制链接',
      command: 'web-view.cm-copy-link',
      view: VIEW,
      order: 10,
      enabledWhen: 'always',
    },
    {
      id: 'web-view.cm.copy-image-url',
      label: '复制图片地址',
      command: 'web-view.cm-copy-image-url',
      view: VIEW,
      order: 20,
      enabledWhen: 'always',
    },
    {
      id: 'web-view.cm.copy-selection',
      label: '复制选中文字',
      command: 'web-view.cm-copy-selection',
      view: VIEW,
      order: 30,
      enabledWhen: 'has-selection',
    },
    {
      id: 'web-view.cm.dictionary-lookup',
      label: '📖 查词',
      command: 'web-view.cm-dictionary-lookup',
      view: VIEW,
      order: 40,
      enabledWhen: 'has-selection',
    },
    {
      id: 'web-view.cm.translate-selection',
      label: '🌐 翻译',
      command: 'web-view.cm-translate-selection',
      view: VIEW,
      order: 41,
      enabledWhen: 'has-selection',
    },
  ]);
}
