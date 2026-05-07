/**
 * WebView per-workspace 工作位状态(L5-B4)
 *
 * 跟 NoteView data-model 同模式:
 * - 持久化字段(写 pluginStates['web']):currentUrl
 *
 * 不持久化字段(transient):
 * - canGoBack / canGoForward / loading / title — 由 webview 事件实时驱动 UI,
 *   不落 pluginStates(刷新时重新探测)
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import type { WorkspaceState } from '@workspace/workspace-state/workspace-state';
import { WEBVIEW_DEFAULT_URL } from '@shared/constants/webview';

const STORE_KEY = 'web';

export interface WebWorkspaceState {
  /** 当前 webview 加载的 URL(per-ws 持久化)*/
  currentUrl: string;
}

interface PersistedWebWsState {
  currentUrl: string;
}

const DEFAULT_WS_STATE: WebWorkspaceState = Object.freeze({
  currentUrl: WEBVIEW_DEFAULT_URL,
});

/**
 * hydrate cache(避免 useSyncExternalStore 死循环 — 必须返回稳定引用)
 *
 * key: workspaceId, value: 上次返回的对象
 * 当持久化数据没变时返回同一对象,React 才不会判定 state 变化触发重渲。
 *
 * 见 src/slot/frame-bindings/use-registry.ts 顶部教训注释。
 */
const wsStateCache = new Map<string, WebWorkspaceState>();

/** hydrate:WorkspaceState.pluginStates['web'] → WebWorkspaceState(稳定引用)*/
export function getWebWsState(ws: WorkspaceState): WebWorkspaceState {
  const persisted = (ws.pluginStates?.[STORE_KEY] as Partial<PersistedWebWsState> | undefined) ?? {};
  const currentUrl =
    typeof persisted.currentUrl === 'string' && persisted.currentUrl
      ? persisted.currentUrl
      : DEFAULT_WS_STATE.currentUrl;
  const cached = wsStateCache.get(ws.id);
  if (cached && cached.currentUrl === currentUrl) {
    return cached;
  }
  const next: WebWorkspaceState = { currentUrl };
  wsStateCache.set(ws.id, next);
  return next;
}

/** 写 currentUrl 到 pluginStates(用户导航 / 输 URL bar 时触发)*/
export function setWebUrl(workspaceId: string, url: string): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const cur = getWebWsState(ws);
  if (cur.currentUrl === url) return;
  const nextPlugin = {
    ...(ws.pluginStates ?? {}),
    [STORE_KEY]: { currentUrl: url } satisfies PersistedWebWsState,
  };
  workspaceManager.update(workspaceId, { pluginStates: nextPlugin });
}
