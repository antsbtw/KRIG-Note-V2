/**
 * AIView — AI 主舞台视图(NavSide tab 🤖 AI)
 *
 * 职责(charter § 1.4):仅做"组合 + 状态订阅 + 命令注册"。webview tag 生命周期 +
 * 服务切换 + URL 同步等编排全部封装在 ai-extraction capability 的 <Host /> 组件内。
 *
 * View 持有:
 * - per-ws state 订阅(currentServiceId)
 * - slotBinding 订阅(activeRightViewId + isInRightSlot 决定 toolbar 行为)
 * - AIToolbar UI + 命令路由(命令式 ref 调 host)
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import { commandRegistry } from '@slot/command-registry/command-registry';
import type {
  AIConversationApi,
  AIHostHandle,
} from '@capabilities/ai-extraction/types';
import {
  getAIServiceProfile,
  type AIServiceId,
} from '@shared/types/ai-service-types';
import type { XExtractionApi, XHostHandle } from '@capabilities/x-extraction';
import { getAIWsState, setAIServiceId, setActiveLauncher, type LauncherId } from './data-model';
import { AIToolbar } from './AIToolbar';
import './ai.css';

const VIEW_ID = 'ai-view';

interface AIViewProps {
  workspaceId: string;
}

export function AIView({ workspaceId }: AIViewProps) {
  // 间接路由拿 capability api(useMemo 缓存避免每次渲染重 require + 保持 React identity)
  const aiApi = useMemo(
    () => requireCapabilityApi<AIConversationApi>('ai-extraction'),
    [],
  );
  const Host = aiApi.Host;
  const hostRef = useRef<AIHostHandle | null>(null);

  // X 集成:X 当 AI navSide 服务切换器里的一个入口,但走独立 x-extraction capability
  // 渲染(铁律 3:X 不是 AIServiceId,只借 AI view 外壳做导航)。
  const xApi = useMemo(
    () => requireCapabilityApi<XExtractionApi>('x-extraction'),
    [],
  );
  const XHost = xApi.Host;
  const xHostRef = useRef<XHostHandle | null>(null);

  /**
   * 把本 ws 的 X Host guest wc id 登记到 x-extraction registry(注入按活跃 ws 定向,
   * 治「多 X 实例串扰 → 注入打到内置浏览器 X / 别的 ws」的 bug)。
   * X Host dom-ready / url 变化后 getWebContentsId 才有值,故在那时机调。
   */
  const registerXWc = useCallback(() => {
    const wcId = xHostRef.current?.getWebContentsId() ?? null;
    if (wcId != null) xApi.registerXHostWcId(workspaceId, wcId);
  }, [xApi, workspaceId]);

  // 卸载时清除本 ws 登记(避免 stale wc id 残留)
  useEffect(() => {
    return () => xApi.clearXHostWcId(workspaceId);
  }, [xApi, workspaceId]);

  // 订阅 per-ws state(currentServiceId + activeLauncher)
  const wsState = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => {
      const ws = workspaceManager.get(workspaceId);
      return ws ? getAIWsState(ws) : null;
    },
  );

  /**
   * 订阅 slotBinding.right 拿当前右槽 viewId(给 SlotToggle 高亮 + close 行为用)。
   *
   * 注:useSyncExternalStore 必须返回稳定基本值,不返新对象 — 此处直接返 string|null
   * 字面值,React 默认 Object.is 比较不会死循环。
   */
  const activeRightViewId = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => workspaceManager.get(workspaceId)?.slotBinding.right ?? null,
  );

  /**
   * 判断本 AIView 是否在右槽渲染。
   * 主舞台路径:NavSide tab 点击 → ws.slotBinding.left = 'ai-view'(本 view 是左槽)
   * 右槽召唤路径:其他 view toolbar 选 🤖 → ws.slotBinding.right = 'ai-view'
   * 同 view 可能同时出现在两个槽,但每个 AIView 实例对应一个 slot 位置;
   * 这里用 slotBinding.right === 'ai-view' 作为右槽实例的判定。
   *
   * 边角:若 left=right='ai-view' 同槽 split,左右各一个实例,左槽实例此判断仍为 true —
   * 这是 V2 平等 view 框架的限制(view 不感知自身 slot)。等出现真实问题再迭代。
   */
  const isInRightSlot = activeRightViewId === VIEW_ID;

  const isX = wsState?.activeLauncher === 'x';

  // Toolbar 用的 transient state(由 Host callback 推送)
  const [loading, setLoading] = useState(false);
  const [displayUrl, setDisplayUrl] = useState(
    wsState ? getAIServiceProfile(wsState.currentServiceId).newChatUrl : '',
  );

  // 切到 X 时 displayUrl 复位(X Host dom-ready 会回推真实 URL)
  const handleSelectLauncher = useCallback(
    (id: LauncherId) => {
      if (id === 'x') {
        setActiveLauncher(workspaceId, 'x');
        setDisplayUrl('');
      } else {
        setAIServiceId(workspaceId, id);
      }
    },
    [workspaceId],
  );

  const handleNewChat = useCallback(() => {
    if (!wsState) return;
    if (isX) {
      // X 没有"新对话"语义,复用按钮回 X 主页
      xHostRef.current?.goHome();
      return;
    }
    hostRef.current?.switchService(wsState.currentServiceId);
  }, [wsState, isX]);

  const handleReload = useCallback(() => {
    if (isX) {
      xHostRef.current?.reload();
    } else {
      hostRef.current?.reload();
    }
  }, [isX]);

  /**
   * 订阅跨槽消息 'ai.paste-and-send' — Note "🤖 问 AI" 触发 ask-ai.ts 发的:
   * payload: { prompt: string, serviceId?: AIServiceId, emittedAt: number }
   *
   * 收到 → 调 host.pasteAndSend(prompt, serviceId) → 自动 paste + send。
   * Host 内部排队等 webview dom-ready,所以 ai.paste-and-send 早于 dom-ready 也可。
   *
   * mount 时 getLastValue 兜底取一次 last-known(模块级 push 必须配合 receiver init pull,
   * memory feedback_module_push_pull_both):应对"用户首次启动 app 后第一次 ask-ai 时
   * AIView 还没 mount 完 subscribe 错过 emit"边角。
   *
   * emittedAt 去重:lastHandledAtRef 跟踪最后处理的时间戳,避免 mount 时 getLastValue
   * 拿到老消息重放(SlotArea 扁平列表让 AIView 一直在 mount,但 ws 切换 / hot reload
   * 等场景仍可能重入)。
   */
  const lastHandledAtRef = useRef(0);
  useEffect(() => {
    const bus = workspaceManager.getBus(workspaceId);
    if (!bus) return;
    const handle = (payload: unknown): void => {
      const p = (payload ?? {}) as {
        prompt?: string;
        serviceId?: AIServiceId;
        emittedAt?: number;
      };
      if (typeof p.prompt !== 'string' || !p.prompt) return;
      const ts = typeof p.emittedAt === 'number' ? p.emittedAt : Date.now();
      if (ts <= lastHandledAtRef.current) return; // 已处理过(去重)
      lastHandledAtRef.current = ts;
      void hostRef.current?.pasteAndSend(p.prompt, p.serviceId);
    };
    // 1. last-known pull(若 emit 已在 mount 前发生)
    const last = bus.channels.getLastValue('ai.paste-and-send');
    if (last) handle(last);
    // 2. 后续 emit 走 subscribe
    const unsub = bus.channels.subscribe('ai.paste-and-send', handle);
    return () => unsub();
  }, [workspaceId]);

  /**
   * 订阅 'x.open-tweet' — tweet block「Open original」触发 x-view.open-tweet 命令发的:
   * payload: { url: string, emittedAt: number }
   *
   * 收到 → 把 X webview 导航到该推文(命令已先 setActiveLauncher('x') + 确保 AI view 在台上)。
   * 与 ai.paste-and-send 同款 last-known pull + emittedAt 去重(应对 mount/切 ws 边角)。
   */
  const lastXNavAtRef = useRef(0);
  useEffect(() => {
    const bus = workspaceManager.getBus(workspaceId);
    if (!bus) return;
    const handle = (payload: unknown): void => {
      const p = (payload ?? {}) as { url?: string; emittedAt?: number };
      if (typeof p.url !== 'string' || !p.url) return;
      const ts = typeof p.emittedAt === 'number' ? p.emittedAt : Date.now();
      if (ts <= lastXNavAtRef.current) return;
      lastXNavAtRef.current = ts;
      // 切到 X 入口(让 X webview 显示出来)再导航
      setActiveLauncher(workspaceId, 'x');
      xHostRef.current?.navigate(p.url);
    };
    const last = bus.channels.getLastValue('x.open-tweet');
    if (last) handle(last);
    const unsub = bus.channels.subscribe('x.open-tweet', handle);
    return () => unsub();
  }, [workspaceId]);

  /**
   * 订阅 'x.activate-launcher' — 「发到 X」(x-view.send-to-x)注入前发的:
   * 让 AIView 切到 X 入口(setActiveLauncher('x'))把 X webview 显示出来 + 注册,
   * main 侧 pasteTweet/pasteReply 才能拿到活跃 X webContents。
   *
   * 与 x.open-tweet 同款 last-known pull + emittedAt 去重(应对 mount/切 ws 边角)。
   */
  const lastXActivateAtRef = useRef(0);
  useEffect(() => {
    const bus = workspaceManager.getBus(workspaceId);
    if (!bus) return;
    const handle = (payload: unknown): void => {
      const p = (payload ?? {}) as { emittedAt?: number };
      const ts = typeof p.emittedAt === 'number' ? p.emittedAt : Date.now();
      if (ts <= lastXActivateAtRef.current) return;
      lastXActivateAtRef.current = ts;
      setActiveLauncher(workspaceId, 'x');
    };
    const last = bus.channels.getLastValue('x.activate-launcher');
    if (last) handle(last);
    const unsub = bus.channels.subscribe('x.activate-launcher', handle);
    return () => unsub();
  }, [workspaceId]);

  // 右键「📥 提取此对话到笔记」(AI_EXTRACT_TURN_REQUEST 广播)的订阅**不在此处**:
  // 它曾在 useEffect 里订阅 → 每个并存 AIView 实例各订阅一次 → 一次右键 N 次 execute、
  // 并发往右槽 Note 塞重复块。已收口为模块级单订阅,见 ai-commands.ts registerAICommands()。
  // (规则:命令型广播一律在模块级 registerXxx 订阅一次,不进 view 组件 useEffect。)

  /**
   * "提取整页对话" — 走 ai-view.extract-conversation 命令(Phase 6.5 实施)。
   *
   * 本期简化:从 SSE 缓存取最新一次 AI 完整回复 → 创 type='ai-response' thought atom
   * → 切右槽到 Thought View + activate 卡片。
   *
   * 后续 sub-phase 接 V1 重型 extractor 做完整 conversation 抓取。
   */
  const handleExtractFull = useCallback(() => {
    void commandRegistry.execute('ai-view.extract-conversation');
  }, []);

  const handleCloseRightSlot = useCallback(() => {
    const bus = workspaceManager.getBus(workspaceId);
    bus?.slot.closeRight();
  }, [workspaceId]);

  if (!wsState) {
    return <div className="krig-ai-view__empty">Workspace 未就绪</div>;
  }

  return (
    <div className="krig-ai-view">
      <AIToolbar
        serviceId={wsState.currentServiceId}
        activeLauncher={wsState.activeLauncher}
        url={displayUrl}
        loading={loading}
        activeRightViewId={activeRightViewId}
        isInRightSlot={isInRightSlot}
        onSelectLauncher={handleSelectLauncher}
        onNewChat={handleNewChat}
        onReload={handleReload}
        onExtractFull={handleExtractFull}
        onCloseRightSlot={handleCloseRightSlot}
      />
      {/* AI Host 与 X Host 都常驻,只切显隐(保留各自登录态/页面状态;切回不重载)。
          X webview 走独立 x-extraction capability(铁律 3)。 */}
      <Host
        ref={hostRef}
        workspaceId={workspaceId}
        serviceId={wsState.currentServiceId}
        className="krig-ai-view__webview"
        style={{ display: isX ? 'none' : 'flex' }}
        onUrlChanged={(u) => { if (!isX) setDisplayUrl(u); }}
        onLoadingChanged={(l) => { if (!isX) setLoading(l); }}
      />
      <XHost
        ref={xHostRef}
        workspaceId={workspaceId}
        className="krig-ai-view__webview"
        style={{ display: isX ? 'flex' : 'none' }}
        onUrlChanged={(u) => {
          if (isX) setDisplayUrl(u);
          // dom-ready / 每次导航后 guest wc id 可取 → 登记本 ws 的注入目标
          registerXWc();
        }}
        onLoadingChanged={(l) => { if (isX) setLoading(l); }}
      />
    </div>
  );
}
