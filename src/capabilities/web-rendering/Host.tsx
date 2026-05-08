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
 *   (setWebUrl / showWebContextMenu 等改成 callback 注入,host 不知道 view 的实现)
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
  WebContextMenuPayload,
  WebviewElement,
} from './webview-types';

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
  /** 右键菜单事件 — view 自己处理 contextMenuController 显示 */
  onContextMenu?: (payload: WebContextMenuPayload) => void;
  /** URL 持久化(view 写入 per-ws state)*/
  onUrlChanged?: (url: string) => void;
  /** loading 状态变化(view 决定是否显示 spinner / toolbar 状态)*/
  onLoadingChanged?: (loading: boolean) => void;
  /** 导航能力变化(view 渲染 toolbar 的 back/forward 按钮 disabled 状态)*/
  onNavStateChanged?: (state: { canGoBack: boolean; canGoForward: boolean }) => void;
  /** 实时 URL 变化(view 同步显示在 toolbar URL bar)*/
  onDisplayUrlChanged?: (url: string) => void;
}

export const Host = forwardRef<HostHandle, HostProps>(function Host(props, ref): ReactElement {
  const {
    workspaceId,
    currentUrl,
    translateMode,
    partition,
    className,
    onContextMenu,
    onUrlChanged,
    onLoadingChanged,
    onNavStateChanged,
    onDisplayUrlChanged,
  } = props;

  const webviewRef = useRef<WebviewElement | null>(null);
  /** webview dom-ready 才允许调 getURL / loadURL 等;前期通过 src 属性初始化 URL */
  const domReadyRef = useRef(false);
  /** 左侧 SyncDriver(仅当 translateMode=true 时 active)*/
  const syncDriverRef = useRef<SyncDriver | null>(null);
  /** 对面 NAVIGATE 触发的导航时间窗(防回环)*/
  const remoteNavUntilRef = useRef(0);

  // 用 ref 缓存 callback,避免 setupWebview 依赖变化导致 webview 反复 unbind
  const callbacksRef = useRef({ onContextMenu, onUrlChanged, onLoadingChanged, onNavStateChanged, onDisplayUrlChanged });
  useEffect(() => {
    callbacksRef.current = { onContextMenu, onUrlChanged, onLoadingChanged, onNavStateChanged, onDisplayUrlChanged };
  }, [onContextMenu, onUrlChanged, onLoadingChanged, onNavStateChanged, onDisplayUrlChanged]);

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

    // 右键菜单 — webview 内的 context-menu 事件
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
      callbacksRef.current.onContextMenu?.({
        linkURL: params.linkURL ?? '',
        srcURL: params.srcURL ?? '',
        selectionText: params.selectionText ?? '',
        x: rect.left + (params.x ?? 0),
        y: rect.top + (params.y ?? 0),
      });
    };

    // dom-ready 后才允许调 getURL / loadURL 等
    const handleDomReady = () => {
      domReadyRef.current = true;
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
    wv.addEventListener('context-menu', handleContextMenu);
    wv.addEventListener('dom-ready', handleDomReady);
    wv.addEventListener('did-finish-load', handleFinishLoad);
    // workspaceId 当前不直接用(SyncDriver side 写死 'left'),但保留依赖以便未来 per-ws 行为差异
    void workspaceId;
  }, [workspaceId]);

  // SyncDriver 生命周期 — 双栏翻译模式启用,离开销毁
  useEffect(() => {
    if (!translateMode) {
      // 退出翻译模式,销毁 driver
      syncDriverRef.current?.destroy();
      syncDriverRef.current = null;
      return;
    }
    const wv = webviewRef.current;
    if (!wv) {
      return;
    }

    // 创建左侧 SyncDriver(bus 接口注入 — Wave 4.2 C1 决议)
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
    }),
    [],
  );

  // webview tag:TS 不识别 partition/allowpopups,用 cast 满足 props 类型
  const tagProps = {
    ref: setupWebview,
    src: currentUrl,
    partition,
    allowpopups: 'true',
    className,
  };
  const Tag = 'webview' as unknown as React.ComponentType<typeof tagProps>;
  return <Tag {...tagProps} />;
});
