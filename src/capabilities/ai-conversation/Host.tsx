/**
 * ai-conversation Host — 嵌 claude.ai / chatgpt.com / gemini.google.com 的 webview
 *
 * 与 web-rendering Host 思路一致(把 webview 编排封装到 capability,view 用 props/callbacks/ref 协作),
 * 但简化:不做翻译 / sync driver / 远端导航回环防御 — AI 网站是单方向只读浏览。
 *
 * 接口契约:
 * - props:serviceId(切换网站) + className + loading/url 回调
 * - imperative ref:switchService / reload / getURL
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
import {
  getAIServiceProfile,
  type AIServiceId,
} from '@shared/types/ai-service-types';
import { WEBVIEW_PARTITION } from '@shared/constants/webview';
import type { AIHostHandle, AIHostProps } from './types';

interface WebviewElement extends HTMLElement {
  src: string;
  loadURL(url: string): void;
  getURL(): string;
  reload(): void;
  isLoading(): boolean;
}

export const Host = forwardRef<AIHostHandle, AIHostProps>(function AIHost(
  props,
  ref,
): ReactElement {
  const { workspaceId, serviceId, className, onUrlChanged, onLoadingChanged } = props;

  const webviewRef = useRef<WebviewElement | null>(null);
  const domReadyRef = useRef(false);

  // 用 ref 缓存 callback,避免 setupWebview 因 callback 变化而反复 unbind
  const callbacksRef = useRef({ onUrlChanged, onLoadingChanged });
  useEffect(() => {
    callbacksRef.current = { onUrlChanged, onLoadingChanged };
  }, [onUrlChanged, onLoadingChanged]);

  /** mount 时锁定的初始 URL — 之后切服务走 loadURL */
  const [initialUrl] = useState(() => getAIServiceProfile(serviceId).newChatUrl);

  // webview 事件绑定
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
    const handleDidNavigateInPage = (e: Event): void => {
      // AI 网站是 SPA,路由切换走 in-page navigation
      handleDidNavigate(e);
    };
    const handleDomReady = (): void => {
      domReadyRef.current = true;
      try {
        callbacksRef.current.onUrlChanged?.(wv.getURL());
      } catch {
        /* ignore */
      }
    };

    wv.addEventListener('did-start-loading', handleStartLoading);
    wv.addEventListener('did-stop-loading', handleStopLoading);
    wv.addEventListener('did-navigate', handleDidNavigate);
    wv.addEventListener('did-navigate-in-page', handleDidNavigateInPage);
    wv.addEventListener('dom-ready', handleDomReady);
    // workspaceId 当前不直接用,保留依赖以便未来 per-ws 差异
    void workspaceId;
  }, [workspaceId]);

  // 切服务 — 外部改 serviceId → loadURL 到对应 newChatUrl
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv || !domReadyRef.current) return;
    const targetUrl = getAIServiceProfile(serviceId).newChatUrl;
    let actualUrl = '';
    try {
      actualUrl = wv.getURL();
    } catch {
      return;
    }
    // 若已在该服务页,不重 load(避免每次 useEffect 跑都重载)
    const profile = getAIServiceProfile(serviceId);
    if (new RegExp(profile.urlPattern).test(actualUrl)) return;
    try {
      wv.loadURL(targetUrl);
    } catch {
      /* ignore */
    }
  }, [serviceId]);

  // imperative API
  useImperativeHandle(
    ref,
    () => ({
      switchService: (id: AIServiceId) => {
        const wv = webviewRef.current;
        if (!wv) return;
        wv.loadURL(getAIServiceProfile(id).newChatUrl);
      },
      reload: () => webviewRef.current?.reload(),
      getURL: () => webviewRef.current?.getURL() ?? '',
    }),
    [],
  );

  // webview tag:TS 不识别 partition/allowpopups,用 cast 满足 props 类型
  const tagProps = {
    ref: setupWebview,
    src: initialUrl,
    partition: WEBVIEW_PARTITION,
    allowpopups: 'true',
    className,
  };
  const Tag = 'webview' as unknown as React.ComponentType<typeof tagProps>;
  return <Tag {...tagProps} />;
});
