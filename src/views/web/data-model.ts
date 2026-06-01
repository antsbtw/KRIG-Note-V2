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
import { getDefaultTargetLang } from './translate-view/lang-defaults';
import { getWebSettings } from './web-settings-cache';

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
  /** 选中的全局代理节点 id;空/undefined = 直连(default) */
  proxyId?: string;
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
  proxyId?: string;
}

/**
 * 默认主页 / 新 tab URL —— 改读全局设置缓存(阶段3)。
 *
 * ⚠️ 必须**函数内调用**取值(getWebSettings().defaultUrl),不能在模块顶层 const
 * 求值,否则会固化成启动那刻的缓存值(用户改主页后不生效)。默认缓存 = WEBVIEW_DEFAULT_URL,
 * 缓存未就绪时跟旧行为一致,无回归。
 */
function defaultUrl(): string {
  return getWebSettings().defaultUrl;
}

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
/**
 * cache 条目:既存上次返回的对象,也存当时的"持久化源签名"。
 *
 * ⚠️ 命门(Phase 4 Commit 1 死循环根因):hydrateWebState 对**空数据/旧
 * currentUrl 迁移**分支会 genTabId() 生成**随机 UUID**,所以"先 hydrate 再
 * 跟 cached 深比 tabs"永远不等(id 每次不同)→ getWebWsState 每次返回新引用
 * → useSyncExternalStore 死循环(webview 无限 attach / 白屏)。
 *
 * 修法:用**持久化源**(而非 hydrate 输出)作为"是否变化"的判据。源签名一致
 * 就返回 cached,绝不重新 hydrate(也就不会再生成新随机 id)。
 */
interface WsCacheEntry {
  /** 上次返回给 React 的稳定对象 */
  value: WebWorkspaceState;
  /** 当时的持久化源签名(关键字段);源没变 → 直接复用 value */
  sourceSig: string;
}

const wsStateCache = new Map<string, WsCacheEntry>();

/**
 * 计算持久化源的签名(用于判定"源是否变化")。
 *
 * 只取影响 hydrate 输出的字段:tabs(id+url 逐项)、activeTabId、currentUrl
 * (旧 schema 迁移用)、targetLang。**不含**任何 hydrate 现生成的随机 id ——
 * 这正是稳定引用的关键:源相同 → 签名相同 → 不重新 hydrate。
 */
function sourceSignature(p: Partial<PersistedWebWsState> | undefined): string {
  const s = p ?? {};
  const tabs = Array.isArray(s.tabs)
    ? s.tabs.map((t) => (t ? [t.id ?? '', t.url ?? ''] : null))
    : null;
  return JSON.stringify({
    tabs,
    activeTabId: typeof s.activeTabId === 'string' ? s.activeTabId : null,
    currentUrl: typeof s.currentUrl === 'string' ? s.currentUrl : null,
    targetLang: typeof s.targetLang === 'string' ? s.targetLang : null,
    // ⚠️ 必须纳入:proxyId 变化要触发重渲(setProxy 接入靠 WebView useEffect 依赖
    // proxyId 变化)。不加则改 proxyId 不刷新引用 → 不重设代理。proxyId 是纯持久化
    // 字符串(无随机生成),进签名安全。
    proxyId: typeof s.proxyId === 'string' ? s.proxyId : null,
  });
}

/**
 * 把持久化数据归一成 { tabs, activeTabId, targetLang }(含旧 schema 迁移)。
 * 纯函数,不读 cache(便于单测)。
 */
export function hydrateWebState(persisted: Partial<PersistedWebWsState> | undefined): WebWorkspaceState {
  const p = persisted ?? {};
  const targetLang =
    typeof p.targetLang === 'string' && p.targetLang ? p.targetLang : getDefaultTargetLang();
  // proxyId 是纯持久化字符串 — 空就 undefined,绝不 genXxx() 随机生成(随机 id 是
  // useSyncExternalStore 死循环根因)。三个 return 分支保持字段存在性一致。
  const proxyId = typeof p.proxyId === 'string' && p.proxyId ? p.proxyId : undefined;

  // 1. 新 schema:有合法 tabs → 用之
  if (Array.isArray(p.tabs) && p.tabs.length > 0) {
    const tabs = p.tabs
      .filter(
        (t): t is WebTab =>
          !!t && typeof t.id === 'string' && t.id.length > 0 && typeof t.url === 'string',
      )
      .map((t) => ({ id: t.id, url: t.url || defaultUrl() }));
    if (tabs.length > 0) {
      const activeTabId =
        typeof p.activeTabId === 'string' && tabs.some((t) => t.id === p.activeTabId)
          ? p.activeTabId
          : tabs[0].id;
      return { tabs, activeTabId, targetLang, proxyId };
    }
  }

  // 2. 旧 schema:有 currentUrl → 合成单 tab
  if (typeof p.currentUrl === 'string' && p.currentUrl) {
    const id = genTabId();
    return { tabs: [{ id, url: p.currentUrl }], activeTabId: id, targetLang, proxyId };
  }

  // 3. 空 → DEFAULT_URL 单 tab
  const id = genTabId();
  return { tabs: [{ id, url: defaultUrl() }], activeTabId: id, targetLang, proxyId };
}

/**
 * hydrate:WorkspaceState.pluginStates['web'] → WebWorkspaceState(**稳定引用**)。
 *
 * 不变量:对同一个 ws,只要持久化源(tabs/activeTabId/currentUrl/targetLang)
 * 没有实质变化,就返回**同一个对象引用**(===)。这是 useSyncExternalStore 的
 * getSnapshot,引用不稳 → 死循环。
 *
 * 实现:先按"持久化源签名"判定有无变化 —— 源没变直接复用 cached.value,
 * **绝不重新 hydrate**(避免空数据/迁移分支每次 genTabId() 生成新随机 id
 * 导致引用抖动);源变了才 hydrate 一次并连同新签名存回 cache。
 *
 * 副作用纪律:纯读,不写 workspaceManager(getSnapshot 不能在 render 期改 state)。
 */
export function getWebWsState(ws: WorkspaceState): WebWorkspaceState {
  const persisted = ws.pluginStates?.[STORE_KEY] as Partial<PersistedWebWsState> | undefined;
  const sig = sourceSignature(persisted);
  const cached = wsStateCache.get(ws.id);
  if (cached && cached.sourceSig === sig) {
    return cached.value;
  }
  const value = hydrateWebState(persisted);
  wsStateCache.set(ws.id, { value, sourceSig: sig });
  return value;
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
      proxyId: state.proxyId,
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
  const tabs = [...cur.tabs, { id, url: url || defaultUrl() }];
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
      tabs: [{ id, url: defaultUrl() }],
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

/**
 * 写选中的代理节点 id 到 pluginStates(per-ws 代理工程 · 阶段2)。
 *
 * proxyId 传 undefined / '' 表示直连(归一成 undefined 存)。WebView 的 setProxy
 * 接入 useEffect 依赖 wsState.proxyId 变化触发重设代理出口。
 *
 * ⚠️ proxyId 是纯持久化字符串(无随机生成),没变时早返回保证 getWebWsState 返回同引用。
 */
export function setWebProxyId(workspaceId: string, proxyId: string | undefined): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const cur = getWebWsState(ws);
  const next = proxyId || undefined; // '' → undefined(直连)
  if (cur.proxyId === next) return;
  persist(workspaceId, { ...cur, proxyId: next });
}
