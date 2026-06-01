/**
 * Web view per-ws 代理 IPC handler(per-ws 代理工程 · 阶段1 → 阶段2)
 *
 * 普通浏览 webview 的 partition 已改 per-workspace(`persist:webview-${wsId}`),
 * 每个 ws 是独立 session 实例。本 handler 给某个 ws 的 partition session 设代理出口,
 * 实现「不同 ws 不同出口」。
 *
 * 阶段2 升级:
 * - WEB_SET_PROXY 入参从 { workspaceId, rules } 改为 { workspaceId, proxyId };
 *   renderer 只传 proxyId,主进程查全局节点表 resolveRules → setProxy(节点表持主进程)。
 * - 新增节点表 CRUD IPC(WEB_PROXY_LIST/ADD/REMOVE),阶段3 代理 UI 复用;
 *   阶段2 无 UI,用户在 DevTools console 塞测试节点验证链路。
 *
 * rules 约定(proxyNodeStore.resolveRules 产出):
 * - 'direct://' → 直连(mode: 'direct')
 * - 否则 proxyRules,如 'socks5://192.168.1.162:1080' / 'http://host:port'
 *
 * 注册入口:platform/main/index.ts createMainWindow 后调 registerWebProxyHandler()。
 */

import { ipcMain, session } from 'electron';
import { randomUUID } from 'crypto';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import type { ProxyNode, ProxyNodeType } from '@shared/types/proxy-types';
import { proxyNodeStore } from './proxy-node-store';

export function registerWebProxyHandler(): void {
  ipcMain.handle(
    IPC_CHANNELS.WEB_SET_PROXY,
    async (_event, { workspaceId, proxyId }: { workspaceId: string; proxyId?: string }) => {
      const rules = await proxyNodeStore.resolveRules(proxyId);
      const partition = `persist:webview-${workspaceId}`;
      const sess = session.fromPartition(partition);
      await sess.setProxy(rules === 'direct://' ? { mode: 'direct' } : { proxyRules: rules });
      console.log(
        '[per-ws-proxy] set ws=', workspaceId,
        'proxyId=', proxyId || '(direct)',
        'rules=', rules,
      );
    },
  );

  // ── 全局代理节点表 CRUD(阶段2 无 UI,console 塞;阶段3 UI 复用)──
  ipcMain.handle(IPC_CHANNELS.WEB_PROXY_LIST, async (): Promise<ProxyNode[]> => {
    return proxyNodeStore.list();
  });

  ipcMain.handle(
    IPC_CHANNELS.WEB_PROXY_ADD,
    async (
      _event,
      { name, type, host }: { name: string; type: ProxyNodeType; host: string },
    ): Promise<ProxyNode> => {
      const node: ProxyNode = {
        id: randomUUID(),
        name: typeof name === 'string' ? name : '',
        type: type === 'socks5' || type === 'http' || type === 'direct' ? type : 'direct',
        host: typeof host === 'string' ? host : '',
        createdAt: Date.now(),
      };
      await proxyNodeStore.add(node);
      return node;
    },
  );

  ipcMain.handle(IPC_CHANNELS.WEB_PROXY_REMOVE, async (_event, { id }: { id: string }) => {
    await proxyNodeStore.remove(id);
  });
}
