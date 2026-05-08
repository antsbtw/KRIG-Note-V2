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
   * 在当前活跃 workspace 的右栏打开指定 URL。
   *
   * 等价于:setWebUrl(wsId, url) + slotBinding.right = 'web-view'。
   *
   * 跨 ws 跳转留 ActiveResourceManager 抽象到位后处理。
   */
  commandRegistry.register('web-view.open-url', (urlArg: unknown) => {
    if (typeof urlArg !== 'string' || urlArg.length === 0) return;
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const ws = workspaceManager.get(wsId);
    if (!ws) return;
    // 1. 写 web view 的 currentUrl(per-ws 持久化)
    setWebUrl(wsId, urlArg);
    // 2. 切右栏到 web view(已是则 update no-op)
    if (ws.slotBinding.right !== 'web-view') {
      workspaceManager.update(wsId, {
        slotBinding: { ...ws.slotBinding, right: 'web-view' },
      });
    }
  });
}
