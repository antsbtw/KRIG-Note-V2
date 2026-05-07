/**
 * WebView per-workspace 工作位状态(L5-B4 / L5-B4.2.2)
 *
 * 跟 NoteView data-model 同模式:
 * - 持久化字段(写 pluginStates['web']):currentUrl, targetLang
 *
 * 不持久化字段(transient):
 * - canGoBack / canGoForward / loading / title — 由 webview 事件实时驱动 UI,
 *   不落 pluginStates(刷新时重新探测)
 * - langPendingRestart — 切语言后到重启前的 banner 标志,内存即可,跟 ws 切换走
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import type { WorkspaceState } from '@workspace/workspace-state/workspace-state';
import { WEBVIEW_DEFAULT_URL } from '@shared/constants/webview';
import { getDefaultTargetLang } from './translate-view/lang-defaults';

const STORE_KEY = 'web';

export interface WebWorkspaceState {
  /** 当前 webview 加载的 URL(per-ws 持久化)*/
  currentUrl: string;
  /** 翻译目标语言(per-ws 持久化;mount 时读,运行时变化要重启 app 才生效)*/
  targetLang: string;
}

interface PersistedWebWsState {
  currentUrl: string;
  targetLang?: string;
}

const DEFAULT_URL = WEBVIEW_DEFAULT_URL;

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
      : DEFAULT_URL;
  const targetLang =
    typeof persisted.targetLang === 'string' && persisted.targetLang
      ? persisted.targetLang
      : getDefaultTargetLang();
  const cached = wsStateCache.get(ws.id);
  if (cached && cached.currentUrl === currentUrl && cached.targetLang === targetLang) {
    return cached;
  }
  const next: WebWorkspaceState = { currentUrl, targetLang };
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
    [STORE_KEY]: {
      currentUrl: url,
      targetLang: cur.targetLang,
    } satisfies PersistedWebWsState,
  };
  workspaceManager.update(workspaceId, { pluginStates: nextPlugin });
}

/** 写 targetLang 到 pluginStates(用户在 WebToolbar 下拉切语言时触发)*/
export function setWebTargetLang(workspaceId: string, lang: string): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const cur = getWebWsState(ws);
  if (cur.targetLang === lang) return;
  const nextPlugin = {
    ...(ws.pluginStates ?? {}),
    [STORE_KEY]: {
      currentUrl: cur.currentUrl,
      targetLang: lang,
    } satisfies PersistedWebWsState,
  };
  workspaceManager.update(workspaceId, { pluginStates: nextPlugin });
}
