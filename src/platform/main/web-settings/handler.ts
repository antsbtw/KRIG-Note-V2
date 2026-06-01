/**
 * Web 全局设置 + 清数据 IPC handler(per-ws 代理工程 · 阶段3)
 *
 * - WEB_SETTINGS_GET → webSettingsStore.get()(renderer 启动缓存初始化用)
 * - WEB_SETTINGS_UPDATE → 入参 Partial<WebGlobalSettings>,合并 + save + 返回全量
 * - WEB_CLEAR_STORAGE_DATA → 入参 { workspaceId },清该 ws partition 的
 *   cookies / 缓存 / localStorage 等(照 web-proxy/handler.ts 拼 persist:webview- 前缀)。
 *
 * 注册入口:platform/main/index.ts createMainWindow 后调 registerWebSettingsHandler()
 * (挨着 registerWebProxyHandler)。
 */

import { ipcMain, session } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import type { WebGlobalSettings } from '@shared/types/web-settings-types';
import { webSettingsStore } from './web-settings-store';

export function registerWebSettingsHandler(): void {
  ipcMain.handle(IPC_CHANNELS.WEB_SETTINGS_GET, async (): Promise<WebGlobalSettings> => {
    return webSettingsStore.get();
  });

  ipcMain.handle(
    IPC_CHANNELS.WEB_SETTINGS_UPDATE,
    async (_event, patch: Partial<WebGlobalSettings>): Promise<WebGlobalSettings> => {
      return webSettingsStore.update(patch);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.WEB_CLEAR_STORAGE_DATA,
    async (_event, { workspaceId }: { workspaceId: string }): Promise<void> => {
      const partition = `persist:webview-${workspaceId}`;
      const sess = session.fromPartition(partition);
      await sess.clearStorageData();
      console.log('[web-settings] cleared storage ws=', workspaceId);
    },
  );
}
