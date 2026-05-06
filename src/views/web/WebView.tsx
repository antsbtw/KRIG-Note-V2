/**
 * WebView — view 主组件(L5-B4)
 *
 * Electron `<webview>` tag 嵌网页 + WebToolbar(URL bar + 前进后退刷新)
 *
 * 状态:
 * - per-ws currentUrl(持久化,通过 setWebUrl 写 pluginStates['web'])
 * - transient:loading / canGoBack / canGoForward / title(webview 事件实时驱动 UI)
 *
 * 事件:
 * - did-navigate / did-navigate-in-page → 同步 URL 到 per-ws state
 * - did-start-loading / did-stop-loading → loading 标志
 * - page-title-updated → 暂记内存(L5-B4 不显);ViewSwitcher Tab 标题留后续
 *
 * 注:webview tag 必须在 main-window webPreferences.webviewTag = true 启用
 *    (已在 platform/main/window/main-window.ts 配)
 */

import { useEffect, useRef, useState, useCallback, useSyncExternalStore } from 'react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { WEBVIEW_PARTITION } from '@shared/constants/webview';
import { getWebWsState, setWebUrl } from './data-model';
import { showWebContextMenu } from './context-menu-integration';
import { WebToolbar } from './WebToolbar';
import './web.css';

interface WebViewProps {
  workspaceId: string;
}

// Electron WebviewTag 类型(扩展 HTMLElement);
// V2 不直接 import 'electron' 类型(renderer 不该接 electron 命名空间),
// 用 minimal interface 满足实际方法调用。
interface WebviewElement extends HTMLElement {
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
}

export function WebView({ workspaceId }: WebViewProps) {
  const webviewRef = useRef<WebviewElement | null>(null);

  // 订阅 per-ws state 取持久化的 currentUrl
  const wsState = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => {
      const ws = workspaceManager.get(workspaceId);
      return ws ? getWebWsState(ws) : null;
    },
  );

  const [loading, setLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  // 当前显示给 UI 的 URL(实时同步,可能跟 wsState.currentUrl 短暂不一致)
  const [displayUrl, setDisplayUrl] = useState(wsState?.currentUrl ?? 'about:blank');

  // ── webview 事件绑定 ──

  const setupWebview = useCallback(
    (el: HTMLElement | null) => {
      if (!el) {
        webviewRef.current = null;
        return;
      }
      const wv = el as WebviewElement;
      if (webviewRef.current === wv) return;
      webviewRef.current = wv;

      const handleStartLoading = () => setLoading(true);
      const handleStopLoading = () => {
        setLoading(false);
        setCanGoBack(wv.canGoBack());
        setCanGoForward(wv.canGoForward());
      };
      const handleDidNavigate = (e: Event) => {
        const ev = e as Event & { url?: string };
        const newUrl = ev.url ?? wv.getURL();
        setDisplayUrl(newUrl);
        setCanGoBack(wv.canGoBack());
        setCanGoForward(wv.canGoForward());
        // 持久化到 per-ws state
        setWebUrl(workspaceId, newUrl);
      };
      const handleDidNavigateInPage = (e: Event) => {
        // SPA 路由变化(如 google search 翻页),也持久化
        handleDidNavigate(e);
      };

      // L5-B4 #11:右键菜单 — webview 内的 context-menu 事件
      // Electron webview 'context-menu' 事件 params 含 linkURL / srcURL / selectionText / x / y
      const handleContextMenu = (e: Event) => {
        const ev = e as Event & {
          params?: {
            linkURL?: string;
            srcURL?: string;
            selectionText?: string;
            x?: number;
            y?: number;
          };
        };
        const params = ev.params;
        if (!params) return;
        // params.x/y 是 webview 内坐标;转 viewport 坐标(加 webview 自身 left/top)
        const rect = wv.getBoundingClientRect();
        showWebContextMenu({
          linkURL: params.linkURL ?? '',
          srcURL: params.srcURL ?? '',
          selectionText: params.selectionText ?? '',
          x: rect.left + (params.x ?? 0),
          y: rect.top + (params.y ?? 0),
        });
      };

      wv.addEventListener('did-start-loading', handleStartLoading);
      wv.addEventListener('did-stop-loading', handleStopLoading);
      wv.addEventListener('did-navigate', handleDidNavigate);
      wv.addEventListener('did-navigate-in-page', handleDidNavigateInPage);
      wv.addEventListener('context-menu', handleContextMenu);
    },
    [workspaceId],
  );

  // 切 ws / 外部改 currentUrl(如 link 路由)→ 同步到 webview
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv || !wsState?.currentUrl) return;
    if (wv.getURL() === wsState.currentUrl) return;
    // 只在 wsState.currentUrl 跟实际 webview URL 不同时才 loadURL,避免循环
    try {
      wv.loadURL(wsState.currentUrl);
      setDisplayUrl(wsState.currentUrl);
    } catch {
      // webview 未就绪 — 等下次切 ref 时通过 src 属性加载(下方 src=)
    }
  }, [wsState?.currentUrl]);

  // ── toolbar 操作 ──

  const handleNavigate = useCallback(
    (url: string) => {
      const wv = webviewRef.current;
      if (!wv) return;
      wv.loadURL(url);
      setDisplayUrl(url);
    },
    [],
  );
  const handleGoBack = useCallback(() => webviewRef.current?.goBack(), []);
  const handleGoForward = useCallback(() => webviewRef.current?.goForward(), []);
  const handleReload = useCallback(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    if (loading) wv.stop();
    else wv.reload();
  }, [loading]);

  if (!wsState) {
    return <div className="krig-web-view__empty">Workspace 未就绪</div>;
  }

  return (
    <div className="krig-web-view">
      <WebToolbar
        url={displayUrl}
        loading={loading}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onNavigate={handleNavigate}
        onGoBack={handleGoBack}
        onGoForward={handleGoForward}
        onReload={handleReload}
      />
      {(() => {
        // webview tag:TS 不识别 partition/allowpopups,用 cast 一个匹配 props 类型的方式声明
        const props = {
          ref: setupWebview,
          src: wsState.currentUrl,
          partition: WEBVIEW_PARTITION,
          allowpopups: 'true',
          className: 'krig-web-view__webview',
        };
        const Tag = 'webview' as unknown as React.ComponentType<typeof props>;
        return <Tag {...props} />;
      })()}
    </div>
  );
}
