/**
 * L3 自我诊断
 *
 * 通过 IPC 上报到主进程 diagnostics-bus,输出:
 *   [L3] alive | workspaces: N, active: 'ws-X'
 */

export function reportL3Alive(workspaceCount: number, activeId: string | null): void {
  window.electronAPI?.reportAlive({
    layer: 'L3',
    details: {
      workspaces: workspaceCount,
      active: activeId ?? 'none',
    },
  });
}
