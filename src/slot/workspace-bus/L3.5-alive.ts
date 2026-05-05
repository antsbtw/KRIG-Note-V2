/**
 * L3.5 自我诊断
 *
 * 通过 IPC 上报到主进程 diagnostics-bus,输出:
 *   [L3.5] alive | bus instances: N
 */

export function reportL3_5Alive(busInstances: number): void {
  window.electronAPI?.reportAlive({
    layer: 'L3.5',
    details: {
      'bus instances': busInstances,
    },
  });
}
