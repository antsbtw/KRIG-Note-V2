/**
 * WebView per-workspace 工作位状态(L5-B4 / L5-B4.2.2 / Phase 4 tabs)
 *
 * 跟 NoteView data-model 同模式:
 * - 持久化字段(写 pluginStates['web']):tabs[], activeTabId, targetLang
 *
 * Phase 4:web view 加内部 tab(像 Chrome 标签栏)。schema 从单 currentUrl 改成
 * { tabs: WebTab[], activeTabId, targetLang }。旧 currentUrl 走迁移分支合成单 tab。
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

/** 单个 web tab(per-ws 持久化)*/
export interface WebTab {
  id: string;
  url: string;
}

export interface WebWorkspaceState {
  /** 当前打开的 tab 列表(per-ws 持久化;至少 1 个)*/
  tabs: WebTab[];
  /** 活跃 tab id(保证在 tabs 内)*/
  activeTabId: string;
  /** 翻译目标语言(per-ws 持久化;mount 时读,运行时变化要重启 app 才生效)*/
  targetLang: string;
}

/**
 * 持久化形态 — 兼容旧 schema(单 currentUrl):
 * - 新数据:有 tabs / activeTabId
 * - 旧数据:只有 currentUrl(迁移合成单 tab)
 */
interface PersistedWebWsState {
  tabs?: WebTab[];
  activeTabId?: string;
  /** 旧 schema 字段,迁移用 */
  currentUrl?: string;
  targetLang?: string;
}

const DEFAULT_URL = WEBVIEW_DEFAULT_URL;

/** 生成 tab id(crypto.randomUUID 渲染进程可用,带兜底)*/
function genTabId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * hydrate cache(避免 useSyncExternalStore 死循环 — 必须返回稳定引用)
 *
 * key: workspaceId, value: 上次返回的对象
 * 当持久化数据没变时返回**同一对象**,React 才不会判定 state 变化触发重渲。
 *
 * ⚠️ Phase 4 命门:从单 currentUrl 改成 tabs[] 后,深比必须逐 tab 比 id+url。
 * 只要任一 tab 的 id/url 变、tabs 长度变、activeTabId 变、targetLang 变 →
 * 建新对象;否则返回旧引用。深比写错会导致 getSnapshot 每次返回新引用 →
 * useSyncExternalStore 死循环(白屏 / CPU 拉满)。
 *
 * 见 src/slot/frame-bindings/use-registry.ts 顶部教训注释。
 */
const wsStateCache = new Map<string, WebWorkspaceState>();

/** 两个 tabs 数组逐项深比(id + url)*/
function tabsEqual(a: WebTab[], b: WebTab[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].url !== b[i].url) return false;
  }
  return true;
}

/**
 * 把持久化数据归一成 { tabs, activeTabId, targetLang }(含旧 schema 迁移)。
 * 纯函数,不读 cache(便于单测)。
 */
export function hydrateWebState(persisted: Partial<PersistedWebWsState> | undefined): WebWorkspaceState {
  const p = persisted ?? {};
  const targetLang =
    typeof p.targetLang === 'string' && p.targetLang ? p.targetLang : getDefaultTargetLang();

  // 1. 新 schema:有合法 tabs → 用之
  if (Array.isArray(p.tabs) && p.tabs.length > 0) {
    const tabs = p.tabs
      .filter(
        (t): t is WebTab =>
          !!t && typeof t.id === 'string' && t.id.length > 0 && typeof t.url === 'string',
      )
      .map((t) => ({ id: t.id, url: t.url || DEFAULT_URL }));
    if (tabs.length > 0) {
      const activeTabId =
        typeof p.activeTabId === 'string' && tabs.some((t) => t.id === p.activeTabId)
          ? p.activeTabId
          : tabs[0].id;
      return { tabs, activeTabId, targetLang };
    }
  }

  // 2. 旧 schema:有 currentUrl → 合成单 tab
  if (typeof p.currentUrl === 'string' && p.currentUrl) {
    const id = genTabId();
    return { tabs: [{ id, url: p.currentUrl }], activeTabId: id, targetLang };
  }

  // 3. 空 → DEFAULT_URL 单 tab
  const id = genTabId();
  return { tabs: [{ id, url: DEFAULT_URL }], activeTabId: id, targetLang };
}

/** hydrate:WorkspaceState.pluginStates['web'] → WebWorkspaceState(稳定引用)*/
export function getWebWsState(ws: WorkspaceState): WebWorkspaceState {
  const persisted = ws.pluginStates?.[STORE_KEY] as Partial<PersistedWebWsState> | undefined;
  const next = hydrateWebState(persisted);
  const cached = wsStateCache.get(ws.id);
  if (
    cached &&
    cached.activeTabId === next.activeTabId &&
    cached.targetLang === next.targetLang &&
    tabsEqual(cached.tabs, next.tabs)
  ) {
    return cached;
  }
  wsStateCache.set(ws.id, next);
  return next;
}

/** 把当前 state 写回 pluginStates(集中一处,保证 schema 一致)*/
function persist(workspaceId: string, state: WebWorkspaceState): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const nextPlugin = {
    ...(ws.pluginStates ?? {}),
    [STORE_KEY]: {
      tabs: state.tabs,
      activeTabId: state.activeTabId,
      targetLang: state.targetLang,
    } satisfies PersistedWebWsState,
  };
  workspaceManager.update(workspaceId, { pluginStates: nextPlugin });
}

/** 更新指定 tab 的 url(webview 导航时调,带 tabId)*/
export function setTabUrl(workspaceId: string, tabId: string, url: string): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const cur = getWebWsState(ws);
  const idx = cur.tabs.findIndex((t) => t.id === tabId);
  if (idx === -1 || cur.tabs[idx].url === url) return;
  const tabs = cur.tabs.map((t) => (t.id === tabId ? { ...t, url } : t));
  persist(workspaceId, { ...cur, tabs });
}

/** 加 tab(并设为 active),返回新 tabId */
export function addTab(workspaceId: string, url: string): string | null {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return null;
  const cur = getWebWsState(ws);
  const id = genTabId();
  const tabs = [...cur.tabs, { id, url: url || DEFAULT_URL }];
  persist(workspaceId, { ...cur, tabs, activeTabId: id });
  return id;
}

/** 删 tab;若删的是 active → 切相邻;若删到空 → 回 DEFAULT_URL 单 tab */
export function closeTab(workspaceId: string, tabId: string): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const cur = getWebWsState(ws);
  const idx = cur.tabs.findIndex((t) => t.id === tabId);
  if (idx === -1) return;

  // 关到空 → 回 DEFAULT_URL 单 tab(不让 view 变空)
  if (cur.tabs.length === 1) {
    const id = genTabId();
    persist(workspaceId, {
      ...cur,
      tabs: [{ id, url: DEFAULT_URL }],
      activeTabId: id,
    });
    return;
  }

  const tabs = cur.tabs.filter((t) => t.id !== tabId);
  let activeTabId = cur.activeTabId;
  if (cur.activeTabId === tabId) {
    // 切相邻:优先右侧(同 idx),否则左侧(idx-1)
    const nextIdx = Math.min(idx, tabs.length - 1);
    activeTabId = tabs[nextIdx].id;
  }
  persist(workspaceId, { ...cur, tabs, activeTabId });
}

/** 切换活跃 tab */
export function setActiveTab(workspaceId: string, tabId: string): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const cur = getWebWsState(ws);
  if (cur.activeTabId === tabId || !cur.tabs.some((t) => t.id === tabId)) return;
  persist(workspaceId, { ...cur, activeTabId: tabId });
}

/**
 * 在活跃 tab 打开 URL(web-view.open-url 命令用;note→web 跳转走这个)。
 * 等价于 setTabUrl(wsId, activeTabId, url),保留旧 setWebUrl 调用方语义。
 */
export function setWebUrl(workspaceId: string, url: string): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const cur = getWebWsState(ws);
  setTabUrl(workspaceId, cur.activeTabId, url);
}

/** 写 targetLang 到 pluginStates(用户在 WebToolbar 下拉切语言时触发)*/
export function setWebTargetLang(workspaceId: string, lang: string): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const cur = getWebWsState(ws);
  if (cur.targetLang === lang) return;
  persist(workspaceId, { ...cur, targetLang: lang });
}
