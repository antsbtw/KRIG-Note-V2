/**
 * 健康检查 IPC handlers
 *
 * 按 charter § 5.3:
 * - `ipc.invoke('health.L0')` → { alive, since, errors, details }
 * - `ipc.invoke('health.L1')` → 同上
 * - `ipc.invoke('health.platform')` → 平台层整体状态
 *
 * renderer 通过 DevTools 主动查询任意层状态。
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import type { HealthCheckResponse } from '@shared/ipc/message-types';
import { getLayerState } from '../diagnostics/diagnostics-bus';

function buildHealthResponse(layer: string): HealthCheckResponse {
  const state = getLayerState(layer);
  if (!state) {
    return {
      alive: false,
      since: 0,
      errors: [`Layer '${layer}' not initialized`],
    };
  }
  return {
    alive: state.errors.length === 0,
    since: state.since,
    errors: state.errors,
    details: state.details,
  };
}

export function registerHealthCheckHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.HEALTH_L0, () => buildHealthResponse('L0'));
  ipcMain.handle(IPC_CHANNELS.HEALTH_L1, () => buildHealthResponse('L1'));
  ipcMain.handle(IPC_CHANNELS.HEALTH_L2, () => buildHealthResponse('L2'));
  ipcMain.handle(IPC_CHANNELS.HEALTH_PLATFORM, () => {
    const l0 = getLayerState('L0');
    const l1 = getLayerState('L1');
    const l2 = getLayerState('L2');
    return {
      alive: !!l0 && !!l1 && l0.errors.length === 0 && l1.errors.length === 0,
      since: l0?.since ?? 0,
      errors: [
        ...(l0?.errors ?? []),
        ...(l1?.errors ?? []),
        ...(l2?.errors ?? []),
      ],
      details: {
        L0: l0 ? 'alive' : 'not started',
        L1: l1 ? 'alive' : 'not started',
        L2: l2 ? 'alive' : 'not started',
      },
    } satisfies HealthCheckResponse;
  });
}
