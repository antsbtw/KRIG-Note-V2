/**
 * WebView 命令注册(Wave 3.2)
 *
 * 跟 note-commands.ts 同模式,集中注册 web view 暴露给外部的命令。
 *
 * 命令字符串引用机制(charter § 1.2 注册原则):
 * - 跨 view 调用走 commandRegistry.execute('web-view.<action>', ...args),
 *   不直接 import @views/web/data-model
 * - "如何打开 url"是 web view 自己的业务,note 等其他 view 只发"我要开 url"
 */

import { commandRegistry } from '@slot/command-registry/command-registry';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { setWebUrl } from './data-model';

export function registerWebCommands(): void {
  /**
   * 在当前活跃 workspace 的 web view **活跃 tab** 打开指定 URL。
   *
   * 等价于:setWebUrl(wsId, url)(写活跃 tab 的 url)+ slotBinding.right = 'web-view'。
   * Phase 4:web view 多 tab 后,open-url 语义为"在活跃 tab 打开"(setWebUrl 内部
   * 已路由到 activeTabId)。note→web 跳转等调用方语义不变。
   *
   * 跨 ws 跳转留 ActiveResourceManager 抽象到位后处理。
   */
  commandRegistry.register('web-view.open-url', (urlArg: unknown) => {
    if (typeof urlArg !== 'string' || urlArg.length === 0) return;
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const ws = workspaceManager.get(wsId);
    if (!ws) return;
    // 1. 写 web view 活跃 tab 的 url(per-ws 持久化)
    setWebUrl(wsId, urlArg);
    // 2. 确保 web view 可见 —— 关键:若它**已在任一 slot**(left 或 right)显示,
    //    就在那个现有 web view 打开,不再动 slot(否则会在另一栏又开一个 web view,
    //    挤成左右分栏 → web 内容占不满宽度,正是用户反馈的 bug)。
    //    只有 web view 当前完全不显示时,才切一个 slot 出来(优先 right,不掩盖 left)。
    const inLeft = ws.slotBinding.left === 'web-view';
    const inRight = ws.slotBinding.right === 'web-view';
    if (!inLeft && !inRight) {
      workspaceManager.update(wsId, {
        slotBinding: { ...ws.slotBinding, right: 'web-view' },
      });
    }
  });
}
