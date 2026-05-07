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
import { SyncDriver } from './sync/sync-driver';
import { SYNC_ACTION, WEB_TRANSLATE_PROTOCOL } from './sync/sync-protocol';
import { slotBus } from './slot-bus';
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
  /** L5-B4.2 加(SyncDriver 用)*/
  isLoading(): boolean;
  /** L5-B4.2 加(SyncDriver / TranslateDriver 注入用)*/
  executeJavaScript(code: string): Promise<unknown>;
}

export function WebView({ workspaceId }: WebViewProps) {
  const webviewRef = useRef<WebviewElement | null>(null);
  /** webview dom-ready 才允许调 getURL / loadURL 等;前期通过 src 属性初始化 URL */
  const domReadyRef = useRef(false);
  /** L5-B4.2:左侧 SyncDriver(仅当右栏是 web-translate-view 时 active)*/
  const syncDriverRef = useRef<SyncDriver | null>(null);
  /** L5-B4.2:右栏 NAVIGATE 触发的导航时间窗(防回环)*/
  const remoteNavUntilRef = useRef(0);

  // 订阅 per-ws state 取持久化的 currentUrl
  const wsState = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => {
      const ws = workspaceManager.get(workspaceId);
      return ws ? getWebWsState(ws) : null;
    },
  );

  /** 订阅 slotBinding.right 判断是否在双栏翻译模式 */
  const isTranslateMode = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => {
      const ws = workspaceManager.get(workspaceId);
      return ws?.slotBinding.right === 'web-translate-view';
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

        // L5-B4.2:翻译模式下导航 → reinject sync 脚本 + 通知对面(防回环)
        const driver = syncDriverRef.current;
        if (driver) {
          driver.reinject();
          if (Date.now() < remoteNavUntilRef.current) {
            // 时间窗内 — 对面触发的,不回发
          } else {
            driver.takeControl();
            slotBus.sendFromSide('left', {
              protocol: WEB_TRANSLATE_PROTOCOL,
              action: SYNC_ACTION.NAVIGATE,
              payload: { url: newUrl },
            });
          }
        }
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

      // dom-ready 后才允许调 getURL / loadURL 等(对齐 Electron webview 生命周期)
      const handleDomReady = () => {
        domReadyRef.current = true;
        // ready 后 displayUrl 同步实际 URL
        try {
          setDisplayUrl(wv.getURL());
        } catch {
          /* ignore */
        }
        // L5-B4.2:翻译模式下首次 ready → 启动 SyncDriver
        if (syncDriverRef.current && !wv.isLoading()) {
          syncDriverRef.current.start();
        }
      };

      // L5-B4.2:did-finish-load 时(导航后页面就绪)reinject sync 脚本
      const handleFinishLoad = () => {
        syncDriverRef.current?.reinject();
      };

      wv.addEventListener('did-start-loading', handleStartLoading);
      wv.addEventListener('did-stop-loading', handleStopLoading);
      wv.addEventListener('did-navigate', handleDidNavigate);
      wv.addEventListener('did-navigate-in-page', handleDidNavigateInPage);
      wv.addEventListener('context-menu', handleContextMenu);
      wv.addEventListener('dom-ready', handleDomReady);
      wv.addEventListener('did-finish-load', handleFinishLoad);
    },
    [workspaceId],
  );

  // L5-B4.2:SyncDriver 生命周期 — 双栏翻译模式启用,离开销毁
  useEffect(() => {
    if (!isTranslateMode) {
      // 退出翻译模式,销毁 driver
      syncDriverRef.current?.destroy();
      syncDriverRef.current = null;
      return;
    }
    const wv = webviewRef.current;
    if (!wv) return;

    // 创建左侧 SyncDriver
    const driver = new SyncDriver('left');
    driver.bind(wv);
    syncDriverRef.current = driver;

    console.log('[web-view-left] isTranslateMode 激活,挂 slot-bus 监听');

    // 订阅 slot-bus 接收右栏消息
    const unsub = slotBus.subscribe('left', (msg) => {
      if (msg.protocol !== WEB_TRANSLATE_PROTOCOL) return;
      console.log('[web-view-left] 收到对面消息:', msg.action);
      switch (msg.action) {
        case SYNC_ACTION.TAKE_CONTROL:
          driver.yield();
          break;
        case SYNC_ACTION.SYNC_EVENTS: {
          const p = msg.payload as { events: unknown[]; fromSide: 'left' | 'right' };
          driver.handleRemoteEvents(p.events as Parameters<typeof driver.handleRemoteEvents>[0], p.fromSide);
          break;
        }
        case SYNC_ACTION.NAVIGATE: {
          const url = (msg.payload as { url: string }).url;
          if (url && wv && domReadyRef.current) {
            remoteNavUntilRef.current = Date.now() + 2000;
            wv.loadURL(url);
          }
          break;
        }
        case SYNC_ACTION.REQUEST_URL: {
          // 右栏初始化时请求左栏发当前 URL
          const ready = !!wv && domReadyRef.current;
          const url = ready ? wv.getURL() : '';
          console.log(
            '[web-view-left] REQUEST_URL 处理 — domReady:',
            domReadyRef.current,
            ', url:',
            url,
          );
          if (ready && url) {
            slotBus.sendFromSide('left', {
              protocol: WEB_TRANSLATE_PROTOCOL,
              action: SYNC_ACTION.NAVIGATE,
              payload: { url },
            });
          }
          break;
        }
      }
    });

    // 当前已加载 → 立刻 start 同步
    if (domReadyRef.current && !wv.isLoading()) {
      driver.start();
    }

    return () => {
      unsub();
      driver.destroy();
      syncDriverRef.current = null;
    };
  }, [isTranslateMode]);

  // 切 ws / 外部改 currentUrl(如 link 路由)→ 同步到 webview
  // 关键:webview 未 dom-ready 时不能调 getURL;此时初始 URL 已通过 src 属性加载,无需介入
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv || !wsState?.currentUrl) return;
    if (!domReadyRef.current) return; // webview 还没就绪 — 跳过(初始 src 已带 URL)
    let actualUrl = '';
    try {
      actualUrl = wv.getURL();
    } catch {
      return; // 防御:依然失败就跳过
    }
    if (actualUrl === wsState.currentUrl) return;
    try {
      wv.loadURL(wsState.currentUrl);
      setDisplayUrl(wsState.currentUrl);
    } catch {
      /* ignore — webview 不响应,下次 navigate 事件会同步 */
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

  // L5-B4.2:toggle 双栏翻译模式
  const handleToggleTranslate = useCallback(() => {
    const ws = workspaceManager.get(workspaceId);
    if (!ws) return;
    const next: 'web-translate-view' | null =
      ws.slotBinding.right === 'web-translate-view' ? null : 'web-translate-view';
    workspaceManager.update(workspaceId, {
      slotBinding: { ...ws.slotBinding, right: next },
    });
  }, [workspaceId]);

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
        translateActive={isTranslateMode}
        onNavigate={handleNavigate}
        onGoBack={handleGoBack}
        onGoForward={handleGoForward}
        onReload={handleReload}
        onToggleTranslate={handleToggleTranslate}
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
