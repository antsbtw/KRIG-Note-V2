/**
 * web-service-base — 服务无关的 webview 底座(铁律 1:底座复用,语义分流)
 *
 * AI view / X view 共用的 webview 生命周期原语:
 * - createWebviewServiceRegistry:泛型 webview 注册表(did-navigate → detect → setActive)
 * - resolveWsWebContents:按 renderer 传来的 guest wcId 精确定位 webContents(fail loud,
 *   治多 ws 串扰;AI 问答 / X 发推回复 / X extract 共用)
 * - attachWebviewContextMenu:泛型原生右键菜单(坐标上送 renderer)
 * - buildHitTestScript:按坐标 elementFromPoint → closest 容器 的纯 DOM 定位原语
 * - focusInputBox / pasteTextToWebview / locateSendButton:服务无关的「focus 输入框 +
 *   OS 级 Cmd+V 真粘贴 + 发送按钮定位(不点击)」发布原语(AI 问答 / X 发推共用)
 * - feedFilesToInput:服务无关的「把真实磁盘文件喂给网页 <input type=file>」原语
 *   (路线 B 媒体上传,X 集成 2.5-b;目前只 X 用,加在底座供未来复用)
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
  locateSendButton,
  PASTE_MODIFIER,
} from './webview-input';
export {
  feedFilesToInput,
  type FeedFilesResult,
} from './webview-file-input';
