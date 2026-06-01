/**
 * Electron `<webview>` tag DOM 接口类型
 *
 * V2 不直接 import 'electron' 类型(renderer 不该接 electron 命名空间),
 * 用最小 interface 满足实际方法调用即可。
 *
 * 历史(W4.2 C3):接口原本散落在 WebView.tsx / TranslateWebView.tsx /
 * sync-driver.ts 各自定义,W4.2 集中到 capability 层(避免漂移)。
 */

export interface WebviewElement extends HTMLElement {
  src: string;
  loadURL(url: string): void;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  getURL(): string;
  getTitle(): string;
  /** SyncDriver / TranslateDriver 用 */
  isLoading(): boolean;
  /** SyncDriver / TranslateDriver 注入用 */
  executeJavaScript(code: string): Promise<unknown>;
  /** 页内查找(P0)— 返回 requestId,结果走 'found-in-page' 事件 */
  findInPage(text: string, options?: WebFindInPageOptions): number;
  /** 停止页内查找(P0)*/
  stopFindInPage(action: WebStopFindAction): void;
  /** 缩放(P0)*/
  setZoomFactor(factor: number): void;
  getZoomFactor(): number;
}

/** webview.findInPage 选项(P0)*/
export interface WebFindInPageOptions {
  /** 查找方向,默认 true(向前)*/
  forward?: boolean;
  /** 是否查找下一个(继续上次查找);false = 新查找 */
  findNext?: boolean;
  /** 大小写敏感,默认 false */
  matchCase?: boolean;
}

/** webview.stopFindInPage 的 action(P0)*/
export type WebStopFindAction = 'clearSelection' | 'keepSelection' | 'activateSelection';

/** 'found-in-page' 事件 result(P0)*/
export interface WebFoundInPageResult {
  /** 当前命中是第几个(1-based)*/
  activeMatchOrdinal: number;
  /** 总命中数 */
  matches: number;
}

/**
 * webview 'context-menu' 事件 params 的渲染进程形态。
 *
 * 注:Phase 2 起 web view 右键菜单改由主进程原生菜单接管(见
 * src/platform/main/web-context-menu/handler.ts),Host 不再有 onContextMenu prop,
 * 此类型当前无运行时使用方;保留是因 capability index.ts / types.ts 仍对外 re-export,
 * 删除会动到清单外的公共类型面。后续清理 capability 公共面时一并移除。
 */
export interface WebContextMenuPayload {
  linkURL: string;
  srcURL: string;
  selectionText: string;
  /** viewport 坐标(已加 webview 自身 left/top 偏移)*/
  x: number;
  y: number;
}

/** Host 命令式 API(view 通过 ref 调用)*/
export interface HostHandle {
  loadURL(url: string): void;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  /** 当前 webview 是否 loading 中 */
  isLoading(): boolean;
  /** 页内查找(P0)— 结果走 HostProps.onFoundInPage 回调 */
  findInPage(text: string, options?: WebFindInPageOptions): void;
  /** 停止页内查找(P0)*/
  stopFindInPage(action?: WebStopFindAction): void;
  /** 放大(P0,步进 0.1,上限 2.0)→ 返回新 zoom factor */
  zoomIn(): number;
  /** 缩小(P0,步进 0.1,下限 0.5)→ 返回新 zoom factor */
  zoomOut(): number;
  /** 复位 100%(P0)→ 返回 1.0 */
  zoomReset(): number;
  /** 当前 zoom factor(P0)*/
  getZoom(): number;
}
