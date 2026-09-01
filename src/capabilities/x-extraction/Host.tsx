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

    // [x-diag] 加载失败此前**完全静默** —— 没有任何 did-fail-load 监听,
    // 于是加载失败的表现就是"一片黑,什么都没有",无从判断卡在哪一步。
    // 这违背可靠性纲领的「故障必须响」。诊断期先把整条加载链路打点,
    // 定位后可保留 did-fail-load(它本就该有),其余 log 再删。
    const diag = (evt: string, extra?: unknown) => {
      console.log(`[x-diag] ${new Date().toISOString()} ${evt}`,
        extra ?? '', '| url=', (() => { try { return wv.getURL(); } catch { return '?'; } })());
    };
    // webview tag 的事件不在 HTMLElementEventMap 里,类型上只能当普通 Event 收,
    // 运行期字段靠 cast 取(与本文件既有的 Tag cast 同款妥协)。
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
    wv.addEventListener('did-start-loading', () => diag('did-start-loading'));
    wv.addEventListener('did-stop-loading', () => diag('did-stop-loading'));
    wv.addEventListener('dom-ready', () => diag('dom-ready'));

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
        // guest 内部靠 window.resize 重算响应式布局。<webview> 的 OS surface 尺寸
        // 由 Electron 跟着 DOM 元素走,但**不保证**把 resize 事件送进 guest 文档 ——
        // 尤其是从 display:none 回来、或父容器 grid track 宽度突变时。
        // 显式派发一次,x.com 才会重新判断断点(收起/展开左侧导航)。
        try {
          void wv.executeJavaScript('window.dispatchEvent(new Event("resize"))')
            .catch(() => { /* guest 还没 ready / 已销毁,下次可见时还会再来一次 */ });
        } catch { /* 同上 */ }
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
    className,
    style,
  };
  const Tag = 'webview' as unknown as React.ComponentType<typeof tagProps>;
  return <Tag {...tagProps} />;
});
