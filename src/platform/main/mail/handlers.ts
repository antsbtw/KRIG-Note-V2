/**
 * 邮箱模块 IPC handlers(阶段 0)
 *
 * 模板纪律(对齐 main/note/handlers.ts):入参 typeof 严格校验,不信任 renderer 传来的
 * 任何东西;返回结构化结果而非 throw(renderer 侧据 success 决定 toast 还是落 note)。
 *
 * 注册于 main/ipc/ipc-bus.ts 的 initIpcBus()。
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { extractMail, type MailExtractResult } from './mail-extract';
import type { MailServiceId } from '@shared/types/mail-service-types';

export function registerMailHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.MAIL_EXTRACT,
    async (_e, payload: unknown): Promise<MailExtractResult> => {
      const p = payload as {
        serviceId?: unknown;
        x?: unknown;
        y?: unknown;
        targetWcId?: unknown;
      } | null;

      if (!p || typeof p !== 'object') {
        return { success: false, error: 'MAIL_EXTRACT 入参非法' };
      }
      if (typeof p.serviceId !== 'string' || !p.serviceId) {
        return { success: false, error: 'MAIL_EXTRACT 缺少 serviceId' };
      }
      if (typeof p.x !== 'number' || typeof p.y !== 'number') {
        return { success: false, error: 'MAIL_EXTRACT 坐标非法' };
      }
      const targetWcId = typeof p.targetWcId === 'number' ? p.targetWcId : null;

      return extractMail(p.serviceId as MailServiceId, p.x, p.y, targetWcId);
    },
  );
}
