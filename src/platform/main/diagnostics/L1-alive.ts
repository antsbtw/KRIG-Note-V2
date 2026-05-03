/**
 * L1 层自我诊断
 *
 * 按 charter § 5.1:
 * `[L1] Window alive | main BrowserWindow created (id=N, size=WxH)`
 */

import { markAlive } from './diagnostics-bus';

interface L1AliveDetails {
  windowId: number;
  width: number;
  height: number;
}

export function reportL1Alive(details: L1AliveDetails): void {
  markAlive('L1', {
    'window id': details.windowId,
    size: `${details.width}x${details.height}`,
  });
}
