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
}

/** webview 'context-menu' 事件 params(见 capability Host 的 onContextMenu prop)*/
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
}
