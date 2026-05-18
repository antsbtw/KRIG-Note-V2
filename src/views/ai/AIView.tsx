/**
 * AIView — AI 主舞台视图(NavSide tab 🤖 AI)
 *
 * 职责(charter § 1.4):仅做"组合 + 状态订阅 + 命令注册"。webview tag 生命周期 +
 * 服务切换 + URL 同步等编排全部封装在 ai-conversation capability 的 <Host /> 组件内。
 *
 * View 持有:
 * - per-ws state 订阅(currentServiceId)
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

  // 订阅 per-ws state
  const wsState = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => {
      const ws = workspaceManager.get(workspaceId);
      return ws ? getAIWsState(ws) : null;
    },
  );

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

  if (!wsState) {
    return <div className="krig-ai-view__empty">Workspace 未就绪</div>;
  }

  return (
    <div className="krig-ai-view">
      <AIToolbar
        serviceId={wsState.currentServiceId}
        url={displayUrl}
        loading={loading}
        onSelectService={handleSelectService}
        onNewChat={handleNewChat}
        onReload={handleReload}
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
