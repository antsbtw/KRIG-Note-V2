/**
 * mail-service Host — 嵌网页版邮箱的 webview(邮箱模块 阶段 0)
 *
 * 与 x-extraction Host 同思路(webview 生命周期封装进 capability,view 用
 * props/callbacks/ref 协作):
 * - partition:`persist:webview-${workspaceId}` —— 与 AI / X / 内置浏览器同 ws 同名,
 *   同 ws 内共享 session(浏览器里登过的 Google 账号让 Gmail 一键认出;OAuth 弹窗
 *   行为与 AI/X 一致),跨 ws 完全隔离(工作 ws 登公司邮箱、个人 ws 登私人邮箱)。
 * - 初始 URL = 当前 serviceId 的 homeUrl。
 *
 * ## 切换服务商:导航而非重建
 *
 * serviceId 变化时**不重建 webview**(那会丢掉整个 session 的页面状态、触发重新
 * 加载登录态),而是 loadURL 到新服务的 homeUrl。webview 本身是同一个 —— 这也是
 * partition 能共享的前提。
 *
 * 初始 src 用 useState 惰性初始化锁定首次的 homeUrl:src 若跟着 serviceId 变,
 * React 会把它当 prop 更新打到 DOM 上,与我们主动的 loadURL 打架(双重导航)。
 *
 * 接口契约:
 * - props:workspaceId + serviceId + className/style + loading/url 回调
 * - imperative ref:goHome / goCompose / navigate / reload / goBack / getURL / getWebContentsId
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
import { getMailServiceProfile } from '@shared/types/mail-service-types';
import type { MailHostHandle, MailHostProps } from './types';

interface WebviewElement extends HTMLElement {
  src: string;
  loadURL(url: string): void;
  getURL(): string;
  reload(): void;
  goBack(): void;
  canGoBack(): boolean;
  isLoading(): boolean;
  /** Electron <webview> 标准方法:取 guest 的 webContents id(提取定向用) */
  getWebContentsId(): number;
}

export const Host = forwardRef<MailHostHandle, MailHostProps>(function MailHost(
  props,
  ref,
): ReactElement {
  const { workspaceId, serviceId, className, style, onUrlChanged, onLoadingChanged } = props;

  const webviewRef = useRef<WebviewElement | null>(null);
  const domReadyRef = useRef(false);

  // ref 缓存 callback,避免 setupWebview 因 callback 变化反复 unbind
  const callbacksRef = useRef({ onUrlChanged, onLoadingChanged });
  useEffect(() => {
    callbacksRef.current = { onUrlChanged, onLoadingChanged };
  }, [onUrlChanged, onLoadingChanged]);

  // 惰性初始化:只锁定**首次**的 homeUrl 作为 <webview src>。
  // 后续切服务商走下面的 loadURL effect,不动 src(见文件头「导航而非重建」)。
  const [initialUrl] = useState(() => getMailServiceProfile(serviceId).homeUrl);

  // 切换服务商 → 导航。跳过首次(src 已经是它了,再 loadURL 是多余的重复加载)。
  const prevServiceRef = useRef(serviceId);
  useEffect(() => {
    if (prevServiceRef.current === serviceId) return;
    prevServiceRef.current = serviceId;
    const wv = webviewRef.current;
    if (!wv) return;
    try {
      wv.loadURL(getMailServiceProfile(serviceId).homeUrl);
    } catch {
      /* webview 尚未 attach,忽略;attach 后 src 即为目标 */
    }
  }, [serviceId]);

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

    wv.addEventListener('did-start-loading', handleStartLoading);
    wv.addEventListener('did-stop-loading', handleStopLoading);
    wv.addEventListener('did-navigate', handleDidNavigate);
    // 网页版邮箱都是 SPA,收件箱↔单封切换走 in-page navigation(Gmail 是 hash 路由)
    wv.addEventListener('did-navigate-in-page', handleDidNavigate);
    wv.addEventListener('dom-ready', handleDomReady);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      goHome: () => {
        const wv = webviewRef.current;
        if (!wv) return;
        wv.loadURL(getMailServiceProfile(serviceId).homeUrl);
      },
      goCompose: () => {
        const wv = webviewRef.current;
        if (!wv) return;
        wv.loadURL(getMailServiceProfile(serviceId).composeUrl);
      },
      navigate: (url: string) => {
        const wv = webviewRef.current;
        if (!wv || !url) return;
        wv.loadURL(url);
      },
      reload: () => webviewRef.current?.reload(),
      goBack: () => {
        const wv = webviewRef.current;
        if (!wv) return;
        try {
          if (wv.canGoBack()) wv.goBack();
        } catch {
          /* 未 attach */
        }
      },
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
    }),
    [serviceId],
  );

  // webview tag:TS 不识别 partition/allowpopups,用 cast 满足 props 类型。
  // partition 与 AI / X / 内置浏览器同 ws 同名 → 共享登录态,跨 ws 隔离。
  // allowpopups:邮箱的 OAuth 登录、附件预览常开新窗口,不许 popup 会卡在登录页。
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
