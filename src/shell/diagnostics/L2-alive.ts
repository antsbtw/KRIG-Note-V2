/**
 * L2 层自我诊断
 *
 * L2 在 renderer 进程,通过 window.electronAPI.reportAlive 上报到主进程
 * diagnostics-bus 统一输出格式诊断行。
 *
 * 按 charter § 5.1:
 * `[L2] alive | shell rendered, workspace-bar + workspace-container`
 */

export function reportL2Alive(): void {
  window.electronAPI?.reportAlive({
    layer: 'L2',
    details: {
      shell: 'rendered',
      components: 'workspace-bar + workspace-container',
    },
  });
}
