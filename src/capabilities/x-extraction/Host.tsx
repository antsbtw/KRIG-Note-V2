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

export const Host = forwardRef<XHostHandle, XHostProps>(function XHost(
  props,
  ref,
): ReactElement {
  const { workspaceId, className, style, onUrlChanged, onLoadingChanged } = props;

  const webviewRef = useRef<WebviewElement | null>(null);
  const domReadyRef = useRef(false);

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
      relayout: () => {
        const wv = webviewRef.current;
        if (!wv || !domReadyRef.current) return;
        // guest 内部靠 window.resize 重算响应式布局。<webview> 是 OS 级 surface,
        // 与 EPUB/PDF/WebGL 同属命令式渲染引擎:容器宽度变了不会自愈,
        // 会一直停在上次布局算出的尺寸上,不派发就不重排。
        //
        // ⚠️ 时序:host 容器的 ResizeObserver 先于 webview 的 OS surface 完成同步,
        // 立刻派发的话 guest 量到的是旧宽度。用 guest 自己的 innerWidth 当同步信号
        // (而不是猜一个 setTimeout):对不上就下一帧重试,上限 10 帧 ≈160ms。
        const kick = (attempt: number): void => {
          try {
            void wv.executeJavaScript(
              // 合成 resize 事件 X 不一定认:React 的响应式多半接的是
              // matchMedia / ResizeObserver,而**这两者只认真实的视口变化**,
              // 手动 dispatch 的 Event('resize') 根本不会触发它们的回调。
              // 所以除了派发,还要回报 sidebar 的实际宽度用于判断是否真的重排了。
              // 除了派发 resize,还强制读一次布局并触碰一下合成层:
              // guest 常常**算对了**新布局却不重绘(被 Chromium 判为不可见时节流),
              // 屏幕上仍是旧样子 —— 一开 DevTools 就"自己好了",正是因为那强制了重绘。
              // backgroundThrottling=false 是主治,这里再补一记推动,双保险。
              `(function(){
                 window.dispatchEvent(new Event("resize"));
                 void document.documentElement.offsetHeight;   // 强制同步布局
                 var b = document.body;
                 if (b) {                                       // 触碰合成层促重绘
                   var prev = b.style.transform;
                   b.style.transform = 'translateZ(0)';
                   requestAnimationFrame(function(){ b.style.transform = prev; });
                 }
                 return window.innerWidth;
               })()`,
            ).then((raw) => {
              const m: { w?: number } = { w: typeof raw === 'number' ? raw : 0 };
              const guestWidth = m.w ?? 0;
              const hostWidth = Math.round(wv.getBoundingClientRect().width);
              if (guestWidth > 0 && hostWidth > 0
                  && Math.abs(guestWidth - hostWidth) > 2 && attempt < 10) {
                requestAnimationFrame(() => kick(attempt + 1));
              }
            }).catch(() => { /* guest 未 ready / 已销毁 */ });
          } catch { /* 同上 */ }
        };
        kick(0);
      },
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
