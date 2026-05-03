/**
 * Renderer 进程自我诊断
 *
 * 在 renderer DevTools console 输出 `[Renderer] alive`
 */

export function reportRendererAlive(): void {
  console.log('[Renderer] alive | renderer process started');
}
