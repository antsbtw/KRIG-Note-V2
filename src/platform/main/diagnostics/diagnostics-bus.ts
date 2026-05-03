/**
 * 诊断输出统一格式
 *
 * 按 charter § 5.1 规范输出 `[Lx] alive | ...` 格式。
 */

interface LayerState {
  layer: string;
  since: number;
  errors: string[];
  details?: Record<string, unknown>;
}

const layerStates = new Map<string, LayerState>();

/**
 * 标记某层 alive(启动成功)
 * 按 charter § 5.1 输出 `[Lx] <layer> alive | <details>`
 */
export function markAlive(layer: string, details?: Record<string, unknown>): void {
  const state: LayerState = {
    layer,
    since: Date.now(),
    errors: [],
    details,
  };
  layerStates.set(layer, state);

  const detailsStr = details
    ? ' | ' + Object.entries(details).map(([k, v]) => `${k}: ${v}`).join(', ')
    : '';
  console.log(`[${layer}] alive${detailsStr}`);
}

/**
 * 标记某层 INIT FAILED(启动失败)
 * 按 charter § 5.2 输出 `[Lx] INIT FAILED | reason: ...`
 */
export function markFailed(layer: string, reason: string, location?: string): void {
  const state: LayerState = {
    layer,
    since: Date.now(),
    errors: [reason],
  };
  layerStates.set(layer, state);

  console.error(`[${layer}] INIT FAILED`);
  console.error(`  ↳ reason: ${reason}`);
  if (location) {
    console.error(`  ↳ at: ${location}`);
  }
}

/** 获取某层状态(供健康检查 IPC 使用) */
export function getLayerState(layer: string): LayerState | undefined {
  return layerStates.get(layer);
}
