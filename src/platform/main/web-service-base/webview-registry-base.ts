/**
 * 服务无关的 webview registry 底座(铁律 1:底座复用,语义分流)
 *
 * 背景:AI view 与 X view 都需要「跟踪某个前台 webview did-navigate 到目标服务 URL
 * 时,把它注册为该服务的活跃 webContents」。这套 did-navigate → detectByUrl → setActive
 * → destroy 自动清除 + onAttach 监听 的链路与具体服务语义无关,抽成泛型底座,AI / X
 * 各自传入「如何从 URL 识别 serviceKey」即可,加第三种服务不必再抄一遍。
 *
 * 设计要点:
 * - serviceKey 泛型 K(AI 用 AIServiceId,X 用 XServiceId),registry 内部只当不透明键用。
 * - per-serviceKey 单例:同一时刻每个 serviceKey 最多一个活跃 webContents(最后 navigate
 *   的胜出)。多 ws 同嵌同服务罕见,留待真实需求迭代(与原 AI registry 同策略)。
 * - 调用方在 did-attach-webview 钩子里对每个 guest 调 track();track 内对同一 wc 防重。
 *
 * 注:本底座不含 SSE / extract 等服务专属逻辑 —— 那些留在各自服务代码路径。
 */

import type { WebContents } from 'electron';

/** 泛型 webview registry 实例 */
export interface WebviewServiceRegistry<K extends string> {
  /** 取某服务的活跃 webContents;未挂载 / 已销毁返 null */
  getActive(serviceKey: K): WebContents | null;
  /** 订阅「某服务活跃 webContents 变更」(跟随 attach 切底层 wc);返 unsubscribe */
  subscribeAttach(listener: (serviceKey: K, wc: WebContents) => void): () => void;
  /** 给一个 guest webContents 挂 URL 检测,navigate 到目标服务时注册为活跃 */
  track(wc: WebContents): void;
}

/**
 * 创建一个服务无关的 webview registry。
 *
 * @param logTag         日志前缀(如 'ai-webview-registry' / 'x-webview-registry')
 * @param detectService  从 URL 识别 serviceKey;返 null 表示该 URL 不属于本服务
 */
export function createWebviewServiceRegistry<K extends string>(
  logTag: string,
  detectService: (url: string) => K | null,
): WebviewServiceRegistry<K> {
  const registry = new Map<K, WebContents>();
  const onAttachListeners = new Set<(serviceKey: K, wc: WebContents) => void>();

  function setActive(serviceKey: K, wc: WebContents): void {
    const prev = registry.get(serviceKey);
    if (prev === wc) return;
    registry.set(serviceKey, wc);
    console.log(`[${logTag}] active ${serviceKey} webview = wc#${wc.id}`);
    // wc destroy 时清除
    wc.once('destroyed', () => {
      if (registry.get(serviceKey) === wc) {
        registry.delete(serviceKey);
        console.log(`[${logTag}] ${serviceKey} webview wc#${wc.id} destroyed, cleared`);
      }
    });
    for (const listener of onAttachListeners) {
      try {
        listener(serviceKey, wc);
      } catch (err) {
        console.error(`[${logTag}] listener error:`, err);
      }
    }
  }

  function getActive(serviceKey: K): WebContents | null {
    const wc = registry.get(serviceKey);
    if (!wc || wc.isDestroyed()) {
      registry.delete(serviceKey);
      return null;
    }
    return wc;
  }

  function subscribeAttach(listener: (serviceKey: K, wc: WebContents) => void): () => void {
    onAttachListeners.add(listener);
    return () => {
      onAttachListeners.delete(listener);
    };
  }

  function track(wc: WebContents): void {
    const checkAndRegister = (url: string): void => {
      const serviceKey = detectService(url);
      if (!serviceKey) return;
      setActive(serviceKey, wc);
    };

    wc.on('did-navigate', (_e, url) => checkAndRegister(url));
    wc.on('did-navigate-in-page', (_e, url) => checkAndRegister(url));

    // 立即检查当前 URL(attach 时可能已加载到目标页)
    const currentUrl = wc.getURL();
    if (currentUrl) checkAndRegister(currentUrl);
  }

  return { getActive, subscribeAttach, track };
}
