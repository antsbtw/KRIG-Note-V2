/**
 * web-rendering capability — Host 组件(普通 webview)
 *
 * 封装 Electron `<webview>` tag 的整个生命周期 + SyncDriver lifecycle 编排,
 * 让 view 层只做"组合 + 状态订阅 + 命令注册"。
 *
 * 接口契约:
 * - props 注入:currentUrl / translateMode / partition / 各类 callbacks
 * - imperative ref:loadURL / goBack / goForward / reload / stop / isLoading
 *
 * 历史(W4.2 C3 / 设计文档 § 4.1):
 * - 原 webview 编排在 src/views/web/WebView.tsx L107-L289
 * - 本组件复制粘贴该业务逻辑,通过 props 把 view-specific 的部分抽出来
 *   (setWebUrl 等改成 callback 注入,host 不知道 view 的实现)
 *
 * Phase 2:web view 右键菜单改由主进程原生菜单接管(Menu.popup),Host 不再监听
 * webview 'context-menu' 事件、不再有 onContextMenu prop ——
 * 见 src/platform/main/web-context-menu/handler.ts。
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { SyncDriver, SYNC_ACTION, WEB_TRANSLATE_PROTOCOL } from '@drivers/web-sync-driver';
import { slotBus } from './slot-bus';
import type {
  HostHandle,
  WebviewElement,
  WebFoundInPageResult,
} from './webview-types';

/** 缩放范围(P0)*/
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.0;
const ZOOM_STEP = 0.1;
/** 浮点步进累加会漂(0.1*3 ≠ 0.3),clamp + round 到 1 位小数 */
function clampZoom(f: number): number {
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, f)) * 10) / 10;
}

export interface HostProps {
  /** 当前 ws id(SyncDriver side / partition / debug 标识用)*/
  workspaceId: string;
  /** 当前显示 URL(view 从 per-ws state 取传入)*/
  currentUrl: string;
  /** 是否处于双栏翻译模式(决定 SyncDriver 是否启动)*/
  translateMode: boolean;
  /** webview tag partition */
  partition: string;
  /** webview 容器 className(view 通过 CSS 控制布局)*/
  className?: string;
  /** webview tag inline style(Phase 4:多 tab display:none 切换用)*/
  style?: React.CSSProperties;
  /** URL 持久化(view 写入 per-ws state)*/
  onUrlChanged?: (url: string) => void;
  /** loading 状态变化(view 决定是否显示 spinner / toolbar 状态)*/
  onLoadingChanged?: (loading: boolean) => void;
  /** 导航能力变化(view 渲染 toolbar 的 back/forward 按钮 disabled 状态)*/
  onNavStateChanged?: (state: { canGoBack: boolean; canGoForward: boolean }) => void;
  /** 实时 URL 变化(view 同步显示在 toolbar URL bar)*/
  onDisplayUrlChanged?: (url: string) => void;
  /** 页内查找结果(P0)— view 渲染 `3/12` 计数 */
  onFoundInPage?: (result: WebFoundInPageResult) => void;
}

export const Host = forwardRef<HostHandle, HostProps>(function Host(props, ref): ReactElement {
  const {
    workspaceId,
    currentUrl,
    translateMode,
    partition,
    className,
    style,
    onUrlChanged,
    onLoadingChanged,
    onNavStateChanged,
    onDisplayUrlChanged,
    onFoundInPage,
  } = props;

  const webviewRef = useRef<WebviewElement | null>(null);
  /** webview dom-ready 才允许调 getURL / loadURL 等;前期通过 src 属性初始化 URL */
  const domReadyRef = useRef(false);
  /**
   * webview 初始 URL — mount 时锁定一次。
   *
   * **关键**:webview 标签的 src 属性是"受控 attribute",React 重设 src 会让
   * Chromium 重新加载页面。Google 等 SPA 站点的 did-navigate-in-page 会触发
   * onUrlChanged → workspaceManager.update → WebView 重渲 → currentUrl prop 变 →
   * 若 <webview src={currentUrl}> 是 reactive,React 把新 URL 写回 src,
   * Chromium 收到 src 变化 → 又一次 did-navigate → 自打自循环 = 抖动。
   *
   * 解决:src 只读初始 URL,之后所有变化走 useEffect [currentUrl] + wv.loadURL
   * (uncontrolled webview 模式,等同 HTML5 `<video src>` 的常规用法)。
   */
  const initialUrlRef = useRef(currentUrl);
  /** 左侧 SyncDriver(仅当 translateMode=true 时 active)*/
  const syncDriverRef = useRef<SyncDriver | null>(null);
  /** 对面 NAVIGATE 触发的导航时间窗(防回环)*/
  const remoteNavUntilRef = useRef(0);
  /** 当前 zoom factor(P0,transient,不持久化)— 导航后 dom-ready 时重新应用 */
  const zoomFactorRef = useRef(1.0);

  // 用 ref 缓存 callback,避免 setupWebview 依赖变化导致 webview 反复 unbind
  const callbacksRef = useRef({ onUrlChanged, onLoadingChanged, onNavStateChanged, onDisplayUrlChanged, onFoundInPage });
  useEffect(() => {
    callbacksRef.current = { onUrlChanged, onLoadingChanged, onNavStateChanged, onDisplayUrlChanged, onFoundInPage };
  }, [onUrlChanged, onLoadingChanged, onNavStateChanged, onDisplayUrlChanged, onFoundInPage]);

  /**
   * webview ref bind tick — 每次 setupWebview 拿到新 el 就 bump
   *
   * 用途:让 SyncDriver useEffect 在 webview ref 就绪后重跑(否则首次 mount 时 translateMode
   * 已经是 true,但 webviewRef.current 还没绑,useEffect 直接 return,driver 永远不创建)。
   * reload 后 slotBinding.right 持久化恢复 = web-translate-view → translateMode 初始 true,
   * 触发了上述时序 bug — bump 这个 tick 修复。
   */
  const [webviewTick, setWebviewTick] = useState(0);

  // ── webview 事件绑定 ──
  const setupWebview = useCallback((el: HTMLElement | null) => {
    if (!el) {
      webviewRef.current = null;
      return;
    }
    const wv = el as WebviewElement;
    if (webviewRef.current === wv) return;
    webviewRef.current = wv;
    // bump 让 SyncDriver useEffect 重跑(此时 ref 已绑,driver 才能 bind)
    setWebviewTick((v) => v + 1);

    const handleStartLoading = () => callbacksRef.current.onLoadingChanged?.(true);
    const handleStopLoading = () => {
      callbacksRef.current.onLoadingChanged?.(false);
      callbacksRef.current.onNavStateChanged?.({
        canGoBack: wv.canGoBack(),
        canGoForward: wv.canGoForward(),
      });
    };
    const handleDidNavigate = (e: Event) => {
      const ev = e as Event & { url?: string };
      const newUrl = ev.url ?? wv.getURL();
      callbacksRef.current.onDisplayUrlChanged?.(newUrl);
      callbacksRef.current.onNavStateChanged?.({
        canGoBack: wv.canGoBack(),
        canGoForward: wv.canGoForward(),
      });
      // 持久化(about:blank 不持久化,避免被 reset 状态覆盖)
      if (newUrl && newUrl !== 'about:blank') {
        callbacksRef.current.onUrlChanged?.(newUrl);
      }

      // 翻译模式下导航 → reinject sync 脚本 + 通知对面(防回环)
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

    // 右键菜单:Phase 2 起改由主进程原生菜单接管(webContents.on('context-menu')
    // + Menu.popup,见 src/platform/main/web-context-menu/handler.ts)。渲染进程不再
    // 监听 webview 的 context-menu 事件 —— HTML 菜单被 webview OS 层遮挡,根治移走。

    // found-in-page 结果(P0)— 回调给 view 渲染计数
    const handleFoundInPage = (e: Event) => {
      const ev = e as Event & {
        result?: { activeMatchOrdinal?: number; matches?: number };
      };
      const r = ev.result;
      if (!r) return;
      callbacksRef.current.onFoundInPage?.({
        activeMatchOrdinal: r.activeMatchOrdinal ?? 0,
        matches: r.matches ?? 0,
      });
    };

    // dom-ready 后才允许调 getURL / loadURL 等
    const handleDomReady = () => {
      domReadyRef.current = true;
      // 重新应用 transient zoom(navigation / 跨域会被 Chromium 复位到 1.0)
      if (zoomFactorRef.current !== 1.0) {
        try {
          wv.setZoomFactor(zoomFactorRef.current);
        } catch {
          /* ignore */
        }
      }
      try {
        callbacksRef.current.onDisplayUrlChanged?.(wv.getURL());
      } catch {
        /* ignore */
      }
      // 翻译模式下首次 ready → 启动 SyncDriver(兜底,主路径在 useEffect 内)
      if (syncDriverRef.current && !wv.isLoading()) {
        syncDriverRef.current.start();
      }
    };

    // did-finish-load:导航后页面就绪 → reinject sync 脚本
    const handleFinishLoad = () => {
      syncDriverRef.current?.reinject();
    };

    wv.addEventListener('did-start-loading', handleStartLoading);
    wv.addEventListener('did-stop-loading', handleStopLoading);
    wv.addEventListener('did-navigate', handleDidNavigate);
    wv.addEventListener('did-navigate-in-page', handleDidNavigateInPage);
    wv.addEventListener('dom-ready', handleDomReady);
    wv.addEventListener('did-finish-load', handleFinishLoad);
    wv.addEventListener('found-in-page', handleFoundInPage);
    // workspaceId 当前不直接用(SyncDriver side 写死 'left'),但保留依赖以便未来 per-ws 行为差异
    void workspaceId;
  }, [workspaceId]);

  // SyncDriver 生命周期 — 双栏翻译模式启用,离开销毁
  useEffect(() => {
    if (!translateMode) {
      // 退出翻译模式,销毁 driver
      if (syncDriverRef.current) {
        // 诊断(Phase 4 Commit 2 翻译×tab 单活跃):验证切 tab 时旧 driver 先 destroy。
        console.log('[web-rendering Host][translate-single] DESTROY driver ws=%s url=%s', workspaceId, currentUrl);
      }
      syncDriverRef.current?.destroy();
      syncDriverRef.current = null;
      return;
    }
    const wv = webviewRef.current;
    if (!wv) {
      return;
    }

    // 创建左侧 SyncDriver(bus 接口注入 — Wave 4.2 C1 决议)
    // 诊断(Phase 4 Commit 2 翻译×tab 单活跃):验证切 tab 时新 driver START 在旧 DESTROY 之后,
    // 任一时刻只一行「未配对的 START」存活(无两 driver 同时活 → 不双发 NAVIGATE / 不串台)。
    console.log('[web-rendering Host][translate-single] START driver ws=%s url=%s', workspaceId, currentUrl);
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
          driver.handleRemoteEvents(
            p.events as Parameters<typeof driver.handleRemoteEvents>[0],
            p.fromSide,
          );
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
    try {
      driver.start();
    } catch (err) {
      // webview 还没 dom-ready — handleDomReady 兜底
      console.warn('[web-rendering Host] driver.start failed (likely webview not ready), waiting for dom-ready', err);
    }

    return () => {
      unsub();
      driver.destroy();
      syncDriverRef.current = null;
    };
  }, [translateMode, webviewTick]);

  // 切 ws / 外部改 currentUrl(如 link 路由)→ 同步到 webview
  // 关键:webview 未 dom-ready 时不能调 getURL;此时初始 URL 已通过 src 属性加载,无需介入
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv || !currentUrl) return;
    if (!domReadyRef.current) return;
    let actualUrl = '';
    try {
      actualUrl = wv.getURL();
    } catch {
      return;
    }
    if (actualUrl === currentUrl) return;
    try {
      wv.loadURL(currentUrl);
      callbacksRef.current.onDisplayUrlChanged?.(currentUrl);
    } catch {
      /* ignore */
    }
  }, [currentUrl]);

  // imperative API(view 通过 ref 命令式调用 webview)
  useImperativeHandle(
    ref,
    () => ({
      loadURL: (url: string) => {
        webviewRef.current?.loadURL(url);
        callbacksRef.current.onDisplayUrlChanged?.(url);
      },
      goBack: () => webviewRef.current?.goBack(),
      goForward: () => webviewRef.current?.goForward(),
      reload: () => webviewRef.current?.reload(),
      stop: () => webviewRef.current?.stop(),
      isLoading: () => webviewRef.current?.isLoading() ?? false,
      findInPage: (text, options) => {
        const wv = webviewRef.current;
        if (!wv || !domReadyRef.current) return;
        if (!text) {
          wv.stopFindInPage('clearSelection');
          return;
        }
        wv.findInPage(text, options);
      },
      stopFindInPage: (action = 'clearSelection') => {
        const wv = webviewRef.current;
        if (!wv || !domReadyRef.current) return;
        wv.stopFindInPage(action);
      },
      zoomIn: () => {
        const next = clampZoom(zoomFactorRef.current + ZOOM_STEP);
        zoomFactorRef.current = next;
        webviewRef.current?.setZoomFactor(next);
        return next;
      },
      zoomOut: () => {
        const next = clampZoom(zoomFactorRef.current - ZOOM_STEP);
        zoomFactorRef.current = next;
        webviewRef.current?.setZoomFactor(next);
        return next;
      },
      zoomReset: () => {
        zoomFactorRef.current = 1.0;
        webviewRef.current?.setZoomFactor(1.0);
        return 1.0;
      },
      getZoom: () => zoomFactorRef.current,
    }),
    [],
  );

  // webview tag:TS 不识别 partition/allowpopups,用 cast 满足 props 类型。
  // src 用 initialUrlRef(mount 时锁定)而非 currentUrl(reactive) — 避免 React 把
  // 后续 currentUrl 变化回写到 webview src attribute,触发 Chromium 重新加载循环。
  // 见 initialUrlRef 注释。后续 URL 变化走 useEffect [currentUrl] → wv.loadURL。
  const tagProps = {
    ref: setupWebview,
    src: initialUrlRef.current,
    partition,
    allowpopups: 'true',
    className,
    style,
  };
  const Tag = 'webview' as unknown as React.ComponentType<typeof tagProps>;
  return <Tag {...tagProps} />;
});
