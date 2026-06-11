/**
 * ai-extraction Host — 嵌 claude.ai / chatgpt.com / gemini.google.com 的 webview
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
import type { AIHostHandle, AIHostProps } from './types';
import { registerAIHostWcId, getAIHostWcId } from './ai-host-registry';

interface WebviewElement extends HTMLElement {
  src: string;
  loadURL(url: string): void;
  getURL(): string;
  reload(): void;
  isLoading(): boolean;
  /** Electron <webview> 标准方法:取 guest 的 webContents id(注入按 ws 定向用)*/
  getWebContentsId(): number;
}

export const Host = forwardRef<AIHostHandle, AIHostProps>(function AIHost(
  props,
  ref,
): ReactElement {
  const { workspaceId, serviceId, className, style, onUrlChanged, onLoadingChanged } = props;

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

    /**
     * 把本 ws 的 AI Host guest wc id 登记到 ai-host-registry(注入/抓取按活跃 ws 定向,
     * 治多 ws / 内置浏览器+AI-view 并存时打错 AI 实例的 bug,对称 X)。
     * dom-ready / 每次导航后 guest wc id 才可取,故在那时机调。
     */
    const registerWc = (): void => {
      if (!domReadyRef.current) return;
      try {
        registerAIHostWcId(workspaceId, wv.getWebContentsId());
      } catch {
        /* guest 尚未就绪,忽略;下次 dom-ready / navigate 再登记 */
      }
    };

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
      // SPA 路由切换 / 重导航后 guest wc id 可能变,重登记本 ws 目标
      registerWc();
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
      // dom-ready 后 guest wc id 可取 → 登记本 ws 的注入/抓取目标
      registerWc();
      // flush pending prompt(pasteAndSend 在 dom-ready 前调时排的队)
      // 延迟 800ms 让 AI 网站脚本初始化完(否则输入框 selector 找不到)
      const flush = flushPendingRef.current;
      if (flush) {
        setTimeout(() => flush(), 800);
      }
    };

    wv.addEventListener('did-start-loading', handleStartLoading);
    wv.addEventListener('did-stop-loading', handleStopLoading);
    wv.addEventListener('did-navigate', handleDidNavigate);
    wv.addEventListener('did-navigate-in-page', handleDidNavigateInPage);
    wv.addEventListener('dom-ready', handleDomReady);
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

  /**
   * 待发送 prompt 缓存(pasteAndSend 在 webview dom-ready 前被调时排队)。
   *
   * 多次调以最后一次为准(覆盖,不排队);dom-ready 后立即 flush。
   */
  const pendingPromptRef = useRef<{ prompt: string; serviceId?: AIServiceId } | null>(null);

  /** 内部:真正发送给 main 进程的 paste+send 调用 */
  const sendNow = useCallback(async (prompt: string, targetService: AIServiceId) => {
    const api = window.electronAPI;
    if (!api?.aiPasteAndSend) {
      console.warn('[ai Host] electronAPI.aiPasteAndSend not available');
      return;
    }
    // 注入目标 = 本 ws 的 AI Host guest(治多实例串扰:不再依赖 main 全局「最后 navigate」)。
    // sendNow 只在 dom-ready 后调,故此时本 ws 已登记;未命中 → 传 null,main fail loud。
    const targetWcId = getAIHostWcId(workspaceId);
    await api.aiPasteAndSend(targetService, prompt, targetWcId ?? undefined);
  }, [workspaceId]);

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
      getWebContentsId: () => {
        const wv = webviewRef.current;
        if (!wv || !domReadyRef.current) return null;
        try {
          return wv.getWebContentsId();
        } catch {
          return null;
        }
      },
      pasteAndSend: async (prompt: string, targetServiceId?: AIServiceId) => {
        if (!prompt) return;
        const finalService = targetServiceId ?? serviceId;
        // webview 未 dom-ready,缓存等 dom-ready 后再发(防 main 拿空 webContents)
        if (!domReadyRef.current) {
          pendingPromptRef.current = { prompt, serviceId: finalService };
          return;
        }
        // 若需切服务,先 loadURL(loadURL 后页面会重 ready,把 prompt 入 pending 等)
        if (targetServiceId && targetServiceId !== serviceId) {
          pendingPromptRef.current = { prompt, serviceId: finalService };
          webviewRef.current?.loadURL(getAIServiceProfile(targetServiceId).newChatUrl);
          domReadyRef.current = false; // loadURL 会触发新一轮 dom-ready
          return;
        }
        await sendNow(prompt, finalService);
      },
    }),
    [serviceId, sendNow],
  );

  /**
   * flush pending prompt:setupWebview.handleDomReady 内调本 ref 触发 paste+send。
   *
   * 用 ref 而非闭包让最新的 sendNow / serviceId 始终可访问(避免 stale closure)。
   */
  const flushPendingRef = useRef<(() => void) | null>(null);
  flushPendingRef.current = () => {
    const pending = pendingPromptRef.current;
    if (!pending) return;
    pendingPromptRef.current = null;
    void sendNow(pending.prompt, pending.serviceId ?? serviceId);
  };

  // webview tag:TS 不识别 partition/allowpopups,用 cast 满足 props 类型。
  // partition per-ws 化(2026-06-11):用 `persist:webview-${workspaceId}`,与内置浏览器
  // (WebView.tsx)/ X Host 同 ws 同名 → 同 ws 内 AI/X/浏览器共享登录态(浏览器登的
  // Google 让 AI 一键认出)、跨 ws 完全隔离(独立身份 / 可走不同 per-ws 代理出口)。
  // 主进程钩子(右键/快捷键/下载/media://)靠 URL 判定或 per-session 实例补挂,partition
  // 改名对其透明 —— 详见 web-shared/should-handle.ts。
  const tagProps = {
    ref: setupWebview,
    src: initialUrl,
    partition: `persist:webview-${workspaceId}`,
    allowpopups: 'true',
    className,
    style,
  };
  const Tag = 'webview' as unknown as React.ComponentType<typeof tagProps>;
  return <Tag {...tagProps} />;
});
