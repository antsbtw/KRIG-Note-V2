/**
 * L0 层自我诊断
 *
 * 按 charter § 5.1:
 * `[L0] Platform alive | electron version: X, node version: Y`
 */

import { app } from 'electron';
import { markAlive, markFailed } from './diagnostics-bus';

export function reportL0Alive(): void {
  try {
    markAlive('L0', {
      electron: process.versions.electron,
      node: process.versions.node,
      platform: process.platform,
      ready: app.isReady(),
    });
  } catch (err) {
    markFailed('L0', `Failed to report alive: ${(err as Error).message}`, 'src/platform/main/diagnostics/L0-alive.ts');
  }
}
