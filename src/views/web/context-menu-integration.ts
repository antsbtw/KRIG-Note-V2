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
 * 简化版菜单项(对齐设计 § Q7=B,4 项):
 * - 复制链接(条件:linkURL 非空)
 * - 复制图片地址(条件:srcURL 非空)
 * - 复制选中文字(条件:selectionText 非空)
 * - 翻译选中文字(条件:selectionText 非空,本阶段 placeholder)
 */

import { contextMenuController } from '@slot/triggers/context-menu-controller';
import { contextMenuRegistry } from '@slot/interaction-registries/context-menu-registry/context-menu-registry';
import { commandRegistry } from '@slot/command-registry/command-registry';

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

/** WebView 监听 webview 的 context-menu 事件后调本函数 */
export function showWebContextMenu(payload: WebContextMenuPayload): void {
  currentContext = payload;
  contextMenuController.show(payload.x, payload.y, VIEW, {
    hasSelection: payload.selectionText.length > 0,
    isEditable: false,
    // L5-B3.15:web view 不消费 has-link 条件,默认 false
    hasLink: false,
    // thought-view:web 内容无 thought anchor 概念,默认 null
    thoughtId: null,
    x: payload.x,
    y: payload.y,
  });
}

export function getCurrentWebContext(): WebContextMenuPayload | null {
  return currentContext;
}

/** view 注册时调一次:菜单项 + 命令 */
export function registerWebContextMenu(): void {
  // ── 4 个简化命令 ──

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

  commandRegistry.register('web-view.cm-translate-selection', () => {
    // L5-B4 placeholder — 翻译 driver 留 L5-B4.2(translate 变体)
    contextMenuController.hide();
    console.info('[web-view] 翻译选中文字:留 L5-B4.2 实现');
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
      id: 'web-view.cm.translate-selection',
      label: '翻译选中文字',
      command: 'web-view.cm-translate-selection',
      view: VIEW,
      order: 40,
      enabledWhen: 'has-selection',
    },
  ]);
}
