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
import { getAIWsState, setAIServiceId } from './data-model';
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

  // 订阅 per-ws state(currentServiceId)
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

  // Toolbar 用的 transient state(由 Host callback 推送)
  const [loading, setLoading] = useState(false);
  const [displayUrl, setDisplayUrl] = useState(
    wsState ? getAIServiceProfile(wsState.currentServiceId).newChatUrl : '',
  );

  const handleSelectService = useCallback(
    (id: AIServiceId) => {
      setAIServiceId(workspaceId, id);
    },
    [workspaceId],
  );

  const handleNewChat = useCallback(() => {
    if (!wsState) return;
    const host = hostRef.current;
    if (!host) return;
    host.switchService(wsState.currentServiceId);
  }, [wsState]);

  const handleReload = useCallback(() => hostRef.current?.reload(), []);

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
   * 订阅原生右键菜单「📥 提取此对话到笔记」点击(main 经 AI_EXTRACT_TURN_REQUEST 推送
   * guest viewport 坐标)→ 触发 ai-view.extract-turn 命令完成「定位单条 → 抽取 → 落右槽 Note」。
   *
   * 命令内部用 workspaceManager.getActiveId 取当前 ws,与本 AIView 实例 workspaceId 可能不同
   * (多 ws 场景),但右键发生在用户当前可见的 webview = active ws,故走 active 即正确。
   */
  useEffect(() => {
    const unsub = aiApi.onExtractTurnRequest((payload) => {
      void commandRegistry.execute('ai-view.extract-turn', {
        x: payload.x,
        y: payload.y,
      });
    });
    return () => unsub();
  }, [aiApi]);

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
        url={displayUrl}
        loading={loading}
        activeRightViewId={activeRightViewId}
        isInRightSlot={isInRightSlot}
        onSelectService={handleSelectService}
        onNewChat={handleNewChat}
        onReload={handleReload}
        onExtractFull={handleExtractFull}
        onCloseRightSlot={handleCloseRightSlot}
      />
      <Host
        ref={hostRef}
        workspaceId={workspaceId}
        serviceId={wsState.currentServiceId}
        className="krig-ai-view__webview"
        onUrlChanged={setDisplayUrl}
        onLoadingChanged={setLoading}
      />
    </div>
  );
}
