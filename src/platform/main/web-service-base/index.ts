/**
 * web-service-base — 服务无关的 webview 底座(铁律 1:底座复用,语义分流)
 *
 * AI view / X view 共用的 webview 生命周期原语:
 * - createWebviewServiceRegistry:泛型 webview 注册表(did-navigate → detect → setActive)
 * - resolveWsWebContents:按 renderer 传来的 guest wcId 精确定位 webContents(fail loud,
 *   治多 ws 串扰;AI 问答 / X 发推回复 / X extract 共用)
 * - attachWebviewContextMenu:泛型原生右键菜单(坐标上送 renderer)
 * - buildHitTestScript:按坐标 elementFromPoint → closest 容器 的纯 DOM 定位原语
 * - focusInputBox / pasteTextToWebview:服务无关的「focus 输入框 + OS 级 Cmd+V 真粘贴」
 *   发布原语(AI 问答在用)
 *
 * ⚠️ 2026-09-30 退役三个原语(locateSendButton / feedFilesToInput / feedVideoToInput):
 *   它们的**唯一消费者是 X**,X 推倒后零调用;而 `web-capability` 已收编同一能力
 *   (`input.feed()` + `check:{kind:'anchorAppears'}`,连「已 attach 就复用不 detach」
 *   那条约束一起搬了)。留着两份平行实现 = 下次有人改错那份。
 *
 * 加第三种 webview 服务时,只需提供「URL → serviceKey 识别」+「菜单项模板」+ selector,
 * 不必再抄注册/识别/坐标上送/粘贴链路。
 */

export {
  createWebviewServiceRegistry,
  type WebviewServiceRegistry,
} from './webview-registry-base';
export {
  resolveWsWebContents,
  resolveWsWebContentsWithWait,
  type WsResolveResult,
} from './ws-webcontents-resolver';
export {
  attachWebviewContextMenu,
  type WebviewContextMenuOptions,
} from './webview-context-menu-base';
export { buildHitTestScript } from './element-locate';
export {
  focusInputBox,
  pasteTextToWebview,
  PASTE_MODIFIER,
} from './webview-input';
