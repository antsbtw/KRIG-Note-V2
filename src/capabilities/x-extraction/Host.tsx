/**
 * x-extraction Host — 嵌 x.com 的 webview(X 集成 阶段 0)
 *
 * 与 ai-extraction Host 同思路(把 webview 生命周期封装到 capability,view 用
 * props/callbacks/ref 协作),提取/产物仍走 X 独立代码路径(铁律 3):
 * - partition per-ws 化(2026-06-11):`persist:webview-${workspaceId}`,与 AI webview /
 *   内置浏览器同 ws 同名 → 同 ws 内共享 session(浏览器登的 X / Google 让 X view 一键认出;
 *   OAuth 弹窗行为跟 AI 一致),跨 ws 完全隔离(独立身份 / 可走不同 per-ws 代理出口);
 * - 初始 URL = X profile homeUrl;
 * - 无 SSE 拦截 / 无 pasteAndSend(那是 AI 问答语义,X 阶段 0 用不上)。
 *
 * 接口契约:
 * - props:className + loading/url 回调
 * - imperative ref:goHome / reload / getURL
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
import { getXServiceProfile, DEFAULT_X_SERVICE } from '@shared/types/x-service-types';
import type { XHostHandle, XHostProps } from './types';

interface WebviewElement extends HTMLElement {
  src: string;
  loadURL(url: string): void;
  getURL(): string;
  reload(): void;
  isLoading(): boolean;
  /** Electron <webview> 标准方法:取 guest 的 webContents id(注入定向用)*/
  getWebContentsId(): number;
  /** 在 guest 页面上下文执行脚本(relayout 派发 resize 用)*/
  executeJavaScript(code: string): Promise<unknown>;
}

/**
 * 派发 resize + 促重绘 + 回报导航状态。
 *
 * navW 是分辨状态的硬指标:X 左导航展开(带文字)约 275px,收起(仅图标)约 88px。
 * 此前只看容器宽度,把"收起"和"展开"混作一谈,根本判断不出改动有没有生效。
 */
const RELAYOUT_PROBE_JS = `(function(){
  window.dispatchEvent(new Event("resize"));
  void document.documentElement.offsetHeight;
  var b = document.body;
  if (b) {
    var prev = b.style.transform;
    b.style.transform = 'translateZ(0)';
    requestAnimationFrame(function(){ b.style.transform = prev; });
  }
  var hdr = document.querySelector('header[role="banner"]');
  var side = document.querySelector('[data-testid="sidebarColumn"]');
  return JSON.stringify({
    w: window.innerWidth,
    navW: hdr ? Math.round(hdr.getBoundingClientRect().width) : -1,
    rightW: side ? Math.round(side.getBoundingClientRect().width) : -1,
  });
})()`;

export const Host = forwardRef<XHostHandle, XHostProps>(function XHost(
  props,
  ref,
): ReactElement {
  const { workspaceId, className, style, onUrlChanged, onLoadingChanged } = props;

  const webviewRef = useRef<WebviewElement | null>(null);
  const domReadyRef = useRef(false);
  // setupWebview 的 deps 是 [],闭包里拿不到下面 useImperativeHandle 建的方法,
  // 用 ref 中转(与本文件既有的 callbacksRef 同款做法)。

  /**
   * 让 guest 按当前尺寸重新布局(幂等),并回报它此刻的导航状态。
   *
   * 抽成普通函数而不是只挂在 imperative handle 上 —— setupWebview 的
   * 事件回调(deps 为 [])也要调它,走 ref 中转反而绕。
   */
  const doRelayoutRef = useRef<(wsId: string) => void>(() => {});
  const doRelayout = useCallback((wsId: string) => {
    const wv = webviewRef.current;
    if (!wv || !domReadyRef.current) return;
    const kick = (attempt: number): void => {
      try {
        void wv.executeJavaScript(RELAYOUT_PROBE_JS).then((raw) => {
          let m: { w?: number; navW?: number; rightW?: number } = {};
          try { m = JSON.parse(String(raw)) as typeof m; } catch { /* ignore */ }
          const nav = m.navW ?? -1;
          const navState = nav < 0 ? '?' : nav > 200 ? '展开' : '收起';
          const hostWidth = Math.round(wv.getBoundingClientRect().width);
          console.log(
            `[x-diag][${wsId}] host=${hostWidth} guest=${m.w}`
            + ` 左导航=${navState}(${nav}px) 右栏=${m.rightW}`,
          );
          // 布局算完了还得**真的画出来**:隐藏期 <webview> 的 OS surface 脱离,
          // 复出时带的是上次那一帧。invalidate() 排一次全量重绘 ——
          // 这正是"开 DevTools 就正确了"里 DevTools 顺手做掉的那件事。
          try {
            const wcId = wv.getWebContentsId();
            if (typeof wcId === 'number') void window.electronAPI?.xTimeline?.invalidateWc?.(wcId);
          } catch { /* guest 未 attach */ }
          const guestWidth = m.w ?? 0;
          if (guestWidth > 0 && hostWidth > 0
              && Math.abs(guestWidth - hostWidth) > 2 && attempt < 10) {
            requestAnimationFrame(() => kick(attempt + 1));
          }
        }).catch(() => { /* guest 未 ready / 已销毁 */ });
      } catch { /* 同上 */ }
    };
    kick(0);
  }, []);
  doRelayoutRef.current = doRelayout;


  // ref 缓存 callback,避免 setupWebview 因 callback 变化反复 unbind
  const callbacksRef = useRef({ onUrlChanged, onLoadingChanged });
  useEffect(() => {
    callbacksRef.current = { onUrlChanged, onLoadingChanged };
  }, [onUrlChanged, onLoadingChanged]);

  const [homeUrl] = useState(() => getXServiceProfile(DEFAULT_X_SERVICE).homeUrl);

  const setupWebview = useCallback((el: HTMLElement | null) => {
    if (!el) {
      webviewRef.current = null;
      return;
    }
    const wv = el as WebviewElement;
    if (webviewRef.current === wv) return;
    webviewRef.current = wv;

    const handleStartLoading = (): void => {
      callbacksRef.current.onLoadingChanged?.(true);
    };
    const handleStopLoading = (): void => {
      callbacksRef.current.onLoadingChanged?.(false);
    };
    const handleDidNavigate = (e: Event): void => {
      const ev = e as Event & { url?: string };
      const newUrl = ev.url ?? wv.getURL();
      if (newUrl && newUrl !== 'about:blank') {
        callbacksRef.current.onUrlChanged?.(newUrl);
      }
    };
    const handleDomReady = (): void => {
      domReadyRef.current = true;
      try {
        callbacksRef.current.onUrlChanged?.(wv.getURL());
      } catch {
        /* ignore */
      }
    };

    // 加载失败此前**完全静默** —— 没有任何 did-fail-load 监听,失败的表现就是
    // "一片黑,什么都没有",无从判断卡在哪一步(2026-09-01 排查 X 白屏时,
    // 正因为缺这条只能靠猜)。违背可靠性纲领「故障必须响」,故长期保留。
    wv.addEventListener('did-fail-load', ((e: Event) => {
      const d = e as unknown as {
        errorCode: number; errorDescription: string; validatedURL: string; isMainFrame: boolean;
      };
      // errorCode -3 = ABORTED,常见于导航被新导航取代,不一定是故障
      console.error('[x-diag] ✗ did-fail-load',
        `code=${d.errorCode} desc=${d.errorDescription} url=${d.validatedURL} isMainFrame=${d.isMainFrame}`);
    }) as EventListener);
    wv.addEventListener('render-process-gone', ((e: Event) => {
      console.error('[x-diag] ✗✗ render-process-gone(webview 渲染进程没了)',
        (e as unknown as { reason?: string }).reason ?? e);
    }) as EventListener);
    wv.addEventListener('crashed', () => console.error('[x-diag] ✗✗ webview crashed'));
    wv.addEventListener('did-start-loading', handleStartLoading);
    wv.addEventListener('did-stop-loading', handleStopLoading);
    wv.addEventListener('did-navigate', handleDidNavigate);
    // X 是 SPA,路由切换走 in-page navigation
    wv.addEventListener('did-navigate-in-page', handleDidNavigate);
    wv.addEventListener('dom-ready', handleDomReady);
    // 打开 app 那一刻 X 是展开还是收起 —— 不主动量就只能靠看截图猜。
    // X 是 SPA,dom-ready 时导航还没渲染完,等一拍再量。
    wv.addEventListener('did-stop-loading', () => {
      setTimeout(() => doRelayoutRef.current(workspaceId), 800);
    });
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      goHome: () => {
        const wv = webviewRef.current;
        if (!wv) return;
        wv.loadURL(getXServiceProfile(DEFAULT_X_SERVICE).homeUrl);
      },
      navigate: (url: string) => {
        const wv = webviewRef.current;
        if (!wv || !url) return;
        wv.loadURL(url);
      },
      reload: () => webviewRef.current?.reload(),
      getURL: () => webviewRef.current?.getURL() ?? '',
      getWebContentsId: () => {
        const wv = webviewRef.current;
        if (!wv || !domReadyRef.current) return null;
        try {
          return wv.getWebContentsId();
        } catch {
          return null;
        }
      },
      relayout: () => doRelayout(workspaceId),
    }),
    [],
  );


  // webview tag:TS 不识别 partition/allowpopups,用 cast 满足 props 类型。
  // partition per-ws 化(2026-06-11):`persist:webview-${workspaceId}`,与 AI webview /
  // 内置浏览器同 ws 同名 → 同 ws 内共享 session(X 复用浏览器已有 Google/X 登录态,
  // Continue with Google 一键认出;OAuth 弹窗继承同 partition),跨 ws 完全隔离。
  const tagProps = {
    ref: setupWebview,
    src: homeUrl,
    partition: `persist:webview-${workspaceId}`,
    allowpopups: 'true',
    // backgroundThrottling=false:Chromium 对"它认为不可见"的 surface 会节流
    // 渲染与定时器。表现极具迷惑性 —— guest **算对了**新布局
    // (relayout 探针回报的 sidebarW 完全正确),但**不重绘**,屏幕上还是旧样子;
    // 一开 DevTools 就"自己好了",因为开 DevTools 强制了重绘
    // (2026-09-01 用户实测:"每次切换都需要 cmd+opt+i 采集日志时才调整")。
    // slot 切换/分栏改宽度时 webview 常处于这种被判定为不可见的中间态,故关掉节流。
    webpreferences: 'backgroundThrottling=false',
    className,
    style,
  };
  const Tag = 'webview' as unknown as React.ComponentType<typeof tagProps>;
  return <Tag {...tagProps} />;
});
