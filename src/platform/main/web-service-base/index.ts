/**
 * web-service-base — 服务无关的 webview 底座(铁律 1:底座复用,语义分流)
 *
 * AI view / X view 共用的 webview 生命周期原语:
 * - createWebviewServiceRegistry:泛型 webview 注册表(did-navigate → detect → setActive)
 * - attachWebviewContextMenu:泛型原生右键菜单(坐标上送 renderer)
 * - buildHitTestScript:按坐标 elementFromPoint → closest 容器 的纯 DOM 定位原语
 *
 * 加第三种 webview 服务时,只需提供「URL → serviceKey 识别」+「菜单项模板」,不必再抄
 * 注册/识别/坐标上送链路。
 */

export {
  createWebviewServiceRegistry,
  type WebviewServiceRegistry,
} from './webview-registry-base';
export {
  attachWebviewContextMenu,
  type WebviewContextMenuOptions,
} from './webview-context-menu-base';
export { buildHitTestScript } from './element-locate';
