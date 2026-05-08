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
import { getWebWsState, setWebUrl, setWebTargetLang } from './data-model';
import { showWebContextMenu } from './context-menu-integration';
import { WebToolbar } from './WebToolbar';
import { SyncDriver } from './sync/sync-driver';
import { SYNC_ACTION, WEB_TRANSLATE_PROTOCOL } from './sync/sync-protocol';
import { slotBus } from './slot-bus';
import { getLangLabel } from './translate-view/lang-defaults';
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
  /**
   * L5-B4.2.2:切语言后到重启 app 前的 banner 标志(transient,不持久化)
   *
   * mount 时锁定的 lang(给 TranslateDriver 用)和 wsState.targetLang(用户选的)不一致时,
   * 表示用户切了语言但还没重启 — 显示 banner。重启后 mount lang = wsState lang,banner 不显。
   * 切 ws 也会重置(useState 跟 workspaceId 走)
   */
  const [pendingRestartLang, setPendingRestartLang] = useState<string | null>(null);
  /**
   * webview ref bind tick — 每次 setupWebview 拿到新 el 就 bump
   *
   * 用途:让 SyncDriver useEffect 在 webview ref 就绪后重跑(否则首次 mount 时 isTranslateMode
   * 已经是 true,但 webviewRef.current 还没绑,useEffect 直接 return,driver 永远不创建)。
   * reload 后 slotBinding.right 持久化恢复 = web-translate-view → isTranslateMode 初始 true,
   * 触发了上述时序 bug — bump 这个 tick 修复。
   */
  const [webviewTick, setWebviewTick] = useState(0);

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
      // bump 让 SyncDriver useEffect 重跑(此时 ref 已绑,driver 才能 bind)
      setWebviewTick((v) => v + 1);

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
        // 持久化到 per-ws state(about:blank 不持久化,避免被 reset 状态覆盖)
        if (newUrl && newUrl !== 'about:blank') {
          setWebUrl(workspaceId, newUrl);
        }

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
        // L5-B4.2:翻译模式下首次 ready → 启动 SyncDriver(兜底,主路径在 SyncDriver useEffect 内)
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
    if (!wv) {
      return;
    }

    // 创建左侧 SyncDriver(W4.2 C1:bus 接口注入)
    const driver = new SyncDriver('left', slotBus);
    driver.bind(wv);
    syncDriverRef.current = driver;

    // 订阅 slot-bus 接收右栏消息
    const unsub = slotBus.subscribe('left', (msg) => {
      if (msg.protocol !== WEB_TRANSLATE_PROTOCOL) return;
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
          // 忽略 about:blank(右栏初始加载误发,会把左栏冲成空白)
          if (!url || url === 'about:blank') break;
          if (wv && domReadyRef.current) {
            remoteNavUntilRef.current = Date.now() + 2000;
            wv.loadURL(url);
          }
          break;
        }
        case SYNC_ACTION.REQUEST_URL: {
          // 右栏初始化时请求左栏发当前 URL
          const ready = !!wv && domReadyRef.current;
          const url = ready ? wv.getURL() : '';
          // 只在左栏真有页面(非 about:blank)时回发,避免误把右栏冲空
          if (ready && url && url !== 'about:blank') {
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

    // 尝试立即 start。webview 还没 dom-ready 时 executeJavaScript 会 throw,
    // 用 try/catch 兜住 — handleDomReady 会在 ready 后兜底再 start。
    //
    // 教训:reload 路径下 dom-ready 事件可能在 listener 注册之前就发了,
    // 单靠 handleDomReady 不可靠;两路并行(立即 start try/catch + handleDomReady)最稳。
    try {
      driver.start();
    } catch (err) {
      // webview 还没 dom-ready — handleDomReady 兜底
      console.warn('[WebView] driver.start failed (likely webview not ready), waiting for dom-ready', err);
    }

    return () => {
      unsub();
      driver.destroy();
      syncDriverRef.current = null;
    };
    // webviewTick:每次 webview ref 重新绑定时 bump,让此 effect 重跑(否则首次 mount 时
    // webviewRef.current 是 null,driver 永远不创建)— L5-B4.2.2 reload 路径修复
  }, [isTranslateMode, webviewTick]);

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

  // L5-B4.2.2:用户选语言
  // - 翻译已开 → 写 per-ws state + 显示 banner(需重启)
  // - 翻译未开 → 静默写 per-ws state(下次开翻译用)
  const handleSelectLang = useCallback(
    (lang: string) => {
      if (lang === wsState?.targetLang) return; // 选的同一个,不动
      setWebTargetLang(workspaceId, lang);
      if (isTranslateMode) {
        setPendingRestartLang(lang);
      }
    },
    [workspaceId, wsState?.targetLang, isTranslateMode],
  );

  // 重启 app — 触发 main 进程 app.relaunch + app.exit
  const handleRestartApp = useCallback(() => {
    window.electronAPI.restartApp();
  }, []);

  // 关闭 banner(只是不显示了,持久化的 lang 还在,下次启动应用)
  const handleDismissBanner = useCallback(() => {
    setPendingRestartLang(null);
  }, []);

  // 切 workspace → 重置 banner state(避免 ws-A 切的 lang 在 ws-B 显 banner)
  useEffect(() => {
    setPendingRestartLang(null);
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
        currentTargetLang={wsState.targetLang}
        onNavigate={handleNavigate}
        onGoBack={handleGoBack}
        onGoForward={handleGoForward}
        onReload={handleReload}
        onToggleTranslate={handleToggleTranslate}
        onSelectLang={handleSelectLang}
      />
      {pendingRestartLang && (
        <div className="krig-web-view__restart-banner">
          <span className="krig-web-view__restart-msg">
            ⚠ 已选 <strong>{getLangLabel(pendingRestartLang)}</strong>,需重启 app 才生效
          </span>
          <button
            type="button"
            className="krig-web-view__restart-btn"
            onClick={handleRestartApp}
          >
            立即重启
          </button>
          <button
            type="button"
            className="krig-web-view__restart-dismiss"
            onClick={handleDismissBanner}
            title="稍后(关闭提示,下次启动应用)"
            aria-label="关闭提示"
          >
            ×
          </button>
        </div>
      )}
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
