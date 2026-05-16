/**
 * callout lucide icon renderer — driver 端 renderer 注入点(D023 §3.3, Step 5.3 B 路径)
 *
 * NodeView 字面在 iconName != null 时调 activeRenderer.render(hostEl, iconName);
 * capability 端字面通过 setCalloutIconRenderer 注入 React/lucide 渲染逻辑
 * (与 emoji-handler 同模式 — driver 字面零 lucide-react / 零 React 依赖,
 *  renderer 走 vanilla DOM 接口接 hostEl)。
 *
 * activeRenderer null 时 NodeView 字面 fallback 到 emoji 渲染
 * (capability 未装时不挂掉,字面零行为退化)。
 */

export interface CalloutIconRenderer {
  /**
   * NodeView 字面在 iconName != null 时调本回调。
   *
   * @param hostEl 字面 NodeView 内 iconHost DOM(已 contentEditable=false),
   *   renderer 字面负责清空并填充 SVG/React tree。
   * @param iconName 字面 lucide icon 名(如 'Lightbulb' / 'AlertTriangle')。
   */
  render: (hostEl: HTMLElement, iconName: string) => void;

  /**
   * NodeView 字面在 iconName === null 时 / NodeView destroy 时调,
   * 字面让 renderer 清理 React root 等资源(防内存泄漏)。
   */
  unmount: (hostEl: HTMLElement) => void;
}

let activeRenderer: CalloutIconRenderer | null = null;

export function setCalloutIconRenderer(renderer: CalloutIconRenderer | null): void {
  activeRenderer = renderer;
}

export function getCalloutIconRenderer(): CalloutIconRenderer | null {
  return activeRenderer;
}
