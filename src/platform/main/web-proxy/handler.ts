/**
 * Web view per-ws 代理 IPC handler(per-ws 代理工程 · 阶段1)
 *
 * 普通浏览 webview 的 partition 已改 per-workspace(`persist:webview-${wsId}`),
 * 每个 ws 是独立 session 实例。本 handler 给某个 ws 的 partition session 设代理出口,
 * 验证「不同 ws 不同出口」。
 *
 * ⚠️ 阶段1 临时验证用:目前只在 DevTools console 手动调(window.electronAPI.setWebProxy)。
 * channel / handler / preload 用正式命名(web.set-proxy / setWebProxy),阶段2 的代理
 * UI / 节点管理 / data-model proxyId 管线直接复用本 handler,不用清理。
 *
 * rules 约定:
 * - 空字符串 / 'direct://' → 直连(mode: 'direct')
 * - 否则当作 proxyRules,如 'socks5://192.168.1.162:1080' / 'http://host:port'
 *
 * 注册入口:platform/main/index.ts createMainWindow 后调 registerWebProxyHandler()。
 */

import { ipcMain, session } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';

export function registerWebProxyHandler(): void {
  ipcMain.handle(
    IPC_CHANNELS.WEB_SET_PROXY,
    async (_event, { workspaceId, rules }: { workspaceId: string; rules: string }) => {
      const partition = `persist:webview-${workspaceId}`;
      const sess = session.fromPartition(partition);
      // 空 / 'direct://' → 直连;否则按 proxyRules 设代理出口。
      await sess.setProxy(
        rules && rules !== 'direct://' ? { proxyRules: rules } : { mode: 'direct' },
      );
      console.log(
        '[per-ws-proxy] set ws=', workspaceId,
        'partition=', partition,
        'rules=', rules || '(direct)',
      );
    },
  );
}
