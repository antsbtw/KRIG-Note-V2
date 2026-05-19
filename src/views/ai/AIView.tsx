/**
 * AIView — AI 主舞台视图(NavSide tab 🤖 AI)
 *
 * 职责(charter § 1.4):仅做"组合 + 状态订阅 + 命令注册"。webview tag 生命周期 +
 * 服务切换 + URL 同步等编排全部封装在 ai-conversation capability 的 <Host /> 组件内。
 *
 * View 持有:
 * - per-ws state 订阅(currentServiceId)
 * - slotBinding 订阅(activeRightViewId + isInRightSlot 决定 toolbar 行为)
 * - AIToolbar UI + 命令路由(命令式 ref 调 host)
 */

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  AIConversationApi,
  AIHostHandle,
} from '@capabilities/ai-conversation/types';
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
  // 间接路由拿 Host 组件(useMemo 缓存避免每次渲染重 require + 保持 React identity)
  const Host = useMemo(
    () => requireCapabilityApi<AIConversationApi>('ai-conversation').Host,
    [],
  );
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
   * "提取整页对话" — V1 batch extractor (chatgpt-content / claude-api / gemini-content,
   * 共 ~1800 行) 本期不搬,占位 alert 提示。后续 sub-phase 接打通后改为真调用。
   *
   * V1 流程参考: web-bridge browserCapabilityExtractFull → as:import-conversation
   * ViewMessage → NoteView 逐 turn 插入。
   */
  const handleExtractFull = useCallback(() => {
    window.alert(
      '提取整页对话:此功能依赖 V1 重型 extractor (~1800 行) 迁移完成,\n' +
      '本期 AI View 仅打通 askAI 端到端最小集,留待后续 sub-phase。\n\n' +
      '当前可用:在 Note 中选中文字 → 右键 🤖 问 AI(端到端真 askAI 接通)。',
    );
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
